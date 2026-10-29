/**
 * Engine sound DSP: a plain class without Web Audio, used by the AudioWorklet (engine-worklet.ts),
 * the ScriptProcessor fallback (engine-sound.ts) and the offline renderer (tests/audio/render-demo.ts).
 *
 * Signal flow (docs/research/petrol.md §6.1, §6.3, §6.6):
 *   crank angle ─► per slot: exhaust blowdown pulse (∝ load, jitter, header delay) ─► bank bus
 *   bank bus ─► comb resonator (primary pipe round trip 2L/a) ─► pan L/R
 *   L/R ─► silencer low-pass (cutoff rises with load) + 2 pipe resonances ─► saturation (load)
 *   + pulse-modulated flow noise ("rasp"), intake snorkel (band-passed noise ∝ air flow),
 *     mechanical noise ∝ rpm + valve ticks, diesel nail bursts 1–3 kHz, knock ringing (Draper mode),
 *     conrod knock, turbo whistle (blade passing), blow-off, supercharger whine, starter, crash
 *   ─► DC blocker ─► master gain ─► peak limiter ─► soft clip (|y| < 0.97, never 0 dBFS).
 */
import { type ControlFrame, EXHAUST_OPEN_AFTER_TDC_DEG, type Voice, bladePassingHz, clamp, foldToAudible, onePoleCoef, silentFrame } from "./model.ts";

/** Topology-preserving state variable filter (A. Simper, "Linear trapezoidal integrated SVF", 2013). */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  lp = 0;
  /** Band-pass with unity peak gain. */
  bp = 0;
  hp = 0;
  set(hz: number, q: number, fs: number) {
    const f = clamp(hz, 10, 0.45 * fs);
    const g = Math.tan((Math.PI * f) / fs);
    this.k = 1 / Math.max(0.05, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  run(v0: number): number {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = this.k * v1;
    this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
}

const K_EXHAUST = 0;
const K_NAIL = 1;
const K_KNOCK = 2;
const K_POP = 3;
const K_ROD = 4;
const K_TICK = 5;

class Ev {
  active = false;
  kind = 0;
  delay = 0;
  t = 0;
  len = 1;
  amp = 0;
  bank = 0;
  /** Exhaust: shape exponent; ringing: angular frequency per sample. */
  p1 = 0;
  /** Decay per sample (multiplier) for ringing/bursts. */
  p2 = 0;
  env = 1;
}

const POOL = 96;
const MAX_PIPE_SAMPLES = 4096;

export class EngineDsp {
  readonly fs: number;
  private voice: Voice | null = null;
  private frame: ControlFrame = silentFrame();
  private rng = 0x9e3779b9;

  // Smoothed controls (per sample).
  private rpm = 0;
  private load = 0;
  private pedal = 0;
  private air = 0;
  private turbo = 0;
  private nail = 0;
  private knock = 0;
  private rod = 0;
  private starterG = 0;
  private engineG = 1;
  private master = 0;
  private volume = 0.8;
  private cRpm: number;
  private cFast: number;
  private cMid: number;
  private cSlow: number;

  private angle = 0;
  private limiterPhase = 0;
  private wasStarter = false;
  private evs: Ev[] = Array.from({ length: POOL }, () => new Ev());

  // Buses (per sample).
  private bankIn = [0, 0];
  private flowEnv = 0;
  private nailIn = 0;
  private direct = 0;
  private mechIn = 0;

  // Filters and delay lines.
  private pipes = [new Float32Array(MAX_PIPE_SAMPLES), new Float32Array(MAX_PIPE_SAMPLES)];
  private pipeW = 0;
  private lpL = new Svf();
  private lpR = new Svf();
  private lp2L = 0;
  private lp2R = 0;
  private res = [new Svf(), new Svf(), new Svf(), new Svf()];
  private resGain = [0, 0];
  private rasp = new Svf();
  private intake1 = new Svf();
  private intake2 = new Svf();
  private mech = new Svf();
  private nailBp = new Svf();
  private bov = new Svf();
  private crashLp = new Svf();
  private starterBp = new Svf();
  private dcL = { x: 0, y: 0 };
  private dcR = { x: 0, y: 0 };
  private dcCoef: number;
  private limEnv = 0;
  private limAtt: number;
  private limRel: number;

  // Oscillators.
  private phTurbo = 0;
  private phShaft = 0;
  private phSc = 0;
  private phStarter = 0;
  private fTurbo = 0;
  private bovEnv = 0;
  private crashEnv = 0;
  private crashModes = [0, 0, 0];
  private crashPh = [0, 0, 0];

  /** Peak of the last processed block (after limiter), for meters/tests. */
  lastPeak = 0;

  constructor(sampleRate: number, seed = 1) {
    this.fs = sampleRate;
    this.rng = (0x9e3779b9 ^ (seed * 0x85ebca6b)) >>> 0 || 1;
    this.cRpm = onePoleCoef(0.035, sampleRate);
    this.cFast = onePoleCoef(0.02, sampleRate);
    this.cMid = onePoleCoef(0.06, sampleRate);
    this.cSlow = onePoleCoef(0.15, sampleRate);
    this.dcCoef = Math.exp((-2 * Math.PI * 18) / sampleRate);
    this.limAtt = onePoleCoef(0.0008, sampleRate);
    this.limRel = onePoleCoef(0.18, sampleRate);
  }

  setVoice(v: Voice) {
    this.voice = v;
    const fs = this.fs;
    this.res[0]!.set(v.resonances[0]?.hz ?? 80, v.resonances[0]?.q ?? 1, fs);
    this.res[1]!.set(v.resonances[0]?.hz ?? 80, v.resonances[0]?.q ?? 1, fs);
    this.res[2]!.set(v.resonances[1]?.hz ?? 300, v.resonances[1]?.q ?? 1, fs);
    this.res[3]!.set(v.resonances[1]?.hz ?? 300, v.resonances[1]?.q ?? 1, fs);
    this.resGain = v.resonances.slice(0, 2).map((r) => Math.pow(10, r.gainDb / 20) - 1);
    this.intake1.set(v.intakeHz, 2.5, fs);
    this.intake2.set(v.intakeHz * 2.1, 2, fs);
    this.mech.set(v.fuel === "diesel" ? 2200 : 2800, 0.8, fs);
    this.nailBp.set(Math.sqrt(v.nailHz[0] * v.nailHz[1]), Math.sqrt(v.nailHz[0] * v.nailHz[1]) / (v.nailHz[1] - v.nailHz[0]), fs);
    this.bov.set(2400, 0.9, fs);
    this.crashLp.set(900, 0.7, fs);
    this.starterBp.set(900, 1.2, fs);
    this.rasp.set(v.fuel === "diesel" ? 1800 : 2600, 0.7, fs);
  }

  setControl(f: ControlFrame) {
    const v = this.voice;
    if (f.blowOff > 0) this.bovEnv = Math.max(this.bovEnv, f.blowOff);
    if (f.crash && v) {
      this.crashEnv = 1;
      for (let i = 0; i < 3; i++) this.crashModes[i] = (2 * Math.PI * (420 + 1900 * this.rand01() + i * 700)) / this.fs;
    }
    if (f.starter && !this.wasStarter) this.trigger(K_ROD, 0, 0.6, 0); // pinion engages: clunk
    this.wasStarter = f.starter;
    this.frame = f;
  }

  setVolume(v: number) {
    this.volume = clamp(v, 0, 1);
  }

  /** Renders n samples into the two channels (overwrites). */
  process(outL: Float32Array, outR: Float32Array, n = outL.length) {
    const v = this.voice;
    if (!v) {
      outL.fill(0, 0, n);
      outR.fill(0, 0, n);
      this.lastPeak = 0;
      return;
    }
    const fs = this.fs;
    const f = this.frame;
    const diesel = v.fuel === "diesel";

    // Per block: targets and filter coefficients.
    const rpmT = f.destroyed ? 0 : f.rpm;
    const engineT = f.destroyed ? 0 : 1;
    const lpHz = v.exhaustLpHz * (0.75 + 0.7 * this.load) * (1 + 0.35 * Math.min(1.5, this.rpm / 4000));
    this.lpL.set(lpHz, 0.75, fs);
    this.lpR.set(lpHz, 0.75, fs);
    const lp2c = onePoleCoef(1 / (2 * Math.PI * lpHz * 1.6), fs);
    const pipeD = v.bankPipeDelayS.map((d) => clamp(Math.round(d * fs), 2, MAX_PIPE_SAMPLES - 1));
    // Equal-power pan: L = cos((p+1)·π/4), R = sin((p+1)·π/4).
    const panL = v.bankPan.map((p) => Math.cos(((p + 1) * Math.PI) / 4));
    const panR = v.bankPan.map((p) => Math.sin(((p + 1) * Math.PI) / 4));
    const fb = v.combFeedback;
    const drive = 1 + v.drive * this.load;
    const driveNorm = 1 / Math.tanh(drive * 0.5) * 0.5;

    // Turbo whistle: blade passing, folded into the audible range; shaft order underneath.
    const fBlade = foldToAudible(bladePassingHz(this.turbo, v.turboBlades));
    const fShaft = foldToAudible(this.turbo / 60);
    this.fTurbo = fBlade;
    const turboNorm = clamp(this.turbo / 160000, 0, 1.4);
    const turboAmp = v.turboGain * turboNorm * turboNorm * (0.35 + 0.65 * clamp(this.air, 0, 1.5));
    // Supercharger: Roots 2 rotors × 3 lobes per rotor rev, centrifugal impeller 8 blades.
    const scHz = v.scRatio > 0 ? foldToAudible((this.rpm / 60) * v.scRatio * (v.forced === "roots" ? 6 : 8)) : 0;
    const scAmp = v.scGain * clamp(this.rpm / Math.max(1, v.revLimitRpm), 0, 1.2) ** 2 * (0.4 + 0.6 * this.load);
    // Starter: commutator/gear whine rising with cranking speed.
    const starterHz = 70 + this.rpm * 0.55;

    const degPerSample0 = 6 / fs; // × rpm
    const mechAmp = v.mechGain * Math.pow(clamp(this.rpm / Math.max(1, v.revLimitRpm), 0, 1.3), 1.4) * 1.8;
    const lim = f.limiter && f.combustion;
    const limHz = diesel ? 7 : 13;

    let peak = 0;
    for (let i = 0; i < n; i++) {
      // --- smoothing ---------------------------------------------------------------------
      this.rpm += (rpmT - this.rpm) * this.cRpm;
      this.load += (f.load - this.load) * this.cMid;
      this.pedal += (f.pedal - this.pedal) * this.cMid;
      this.air += (f.airFlow - this.air) * this.cSlow;
      this.turbo += (f.turboRpm - this.turbo) * this.cMid;
      this.nail += (f.nail - this.nail) * this.cSlow;
      this.knock += (f.knock - this.knock) * this.cFast;
      this.rod += (f.rodKnock - this.rod) * this.cSlow;
      this.starterG += ((f.starter ? 1 : 0) - this.starterG) * this.cFast;
      this.engineG += (engineT - this.engineG) * this.cMid;
      this.master += (this.volume - this.master) * this.cMid;
      if (lim) this.limiterPhase = (this.limiterPhase + limHz / fs) % 1;

      // --- crank angle and events ----------------------------------------------------------
      const dAng = this.rpm * degPerSample0;
      if (this.rpm > 25) {
        const prev = this.angle;
        this.angle = (this.angle + dAng) % 720;
        this.scheduleEvents(v, f, prev, dAng, lim);
      }

      // --- render events into buses ------------------------------------------------------
      this.bankIn[0] = 0;
      this.bankIn[1] = 0;
      this.flowEnv = 0;
      this.nailIn = 0;
      this.direct = 0;
      this.mechIn = 0;
      this.renderEvents();

      // --- exhaust banks: comb resonator → pan -------------------------------------------
      let exL = 0;
      let exR = 0;
      const w = this.pipeW;
      for (let b = 0; b < v.bankCount; b++) {
        const line = this.pipes[b]!;
        const r = (w - pipeD[b]! + MAX_PIPE_SAMPLES) % MAX_PIPE_SAMPLES;
        // Open end reflects with inverted sign (petrol.md §6.6, pipe as wave guide).
        const y = this.bankIn[b]! - fb * line[r]!;
        line[w] = y;
        const g = v.bankGain[b] ?? 1;
        exL += y * g * (panL[b] ?? 0.7);
        exR += y * g * (panR[b] ?? 0.7);
      }
      this.pipeW = (w + 1) % MAX_PIPE_SAMPLES;

      // --- silencer + resonances + saturation --------------------------------------------
      let yl = this.lpL.run(exL);
      let yr = this.lpR.run(exR);
      this.lp2L += (yl - this.lp2L) * lp2c;
      this.lp2R += (yr - this.lp2R) * lp2c;
      yl = this.lp2L;
      yr = this.lp2R;
      this.res[0]!.run(yl);
      this.res[1]!.run(yr);
      this.res[2]!.run(yl);
      this.res[3]!.run(yr);
      yl += this.resGain[0]! * this.res[0]!.bp + (this.resGain[1] ?? 0) * this.res[2]!.bp;
      yr += this.resGain[0]! * this.res[1]!.bp + (this.resGain[1] ?? 0) * this.res[3]!.bp;
      yl = Math.tanh(yl * drive * 0.5) * driveNorm;
      yr = Math.tanh(yr * drive * 0.5) * driveNorm;

      // Flow noise modulated by the pulses (turbulent blowdown).
      const nz = this.noise();
      this.rasp.run(nz * this.flowEnv);
      const rasp = this.rasp.bp;
      const raspA = v.raspGain * (0.4 + 0.6 * this.load);
      yl += rasp * raspA;
      yr += rasp * raspA;

      // --- intake snorkel ∝ air mass flow, opened by the pedal --------------------------
      const nz2 = this.noise();
      this.intake1.run(nz2);
      this.intake2.run(nz2);
      const intakeA = v.intakeGain * clamp(this.air, 0, 1.6) * (0.25 + 0.75 * this.pedal) * (0.7 + 0.6 * clamp(this.flowEnv, 0, 1));
      const intake = (this.intake1.bp + 0.5 * this.intake2.bp) * intakeA;

      // --- mechanical noise ∝ rpm, valve ticks ------------------------------------------
      this.mech.run(this.noise() * mechAmp + this.mechIn);
      const mech = this.mech.bp + this.mech.hp * 0.3 * this.mechIn;

      // --- diesel nail bursts -------------------------------------------------------------
      this.nailBp.run(this.nailIn);
      const nail = this.nailBp.bp + 0.25 * this.nailIn;

      // --- turbo, supercharger -------------------------------------------------------------
      let aux = 0;
      if (turboAmp > 1e-5) {
        this.phTurbo += (2 * Math.PI * fBlade) / fs;
        this.phShaft += (2 * Math.PI * fShaft) / fs;
        if (this.phTurbo > 6.283185307) this.phTurbo -= 6.283185307;
        if (this.phShaft > 6.283185307) this.phShaft -= 6.283185307;
        aux += turboAmp * (Math.sin(this.phTurbo) + 0.35 * Math.sin(this.phShaft) + 0.15 * nz2);
      }
      if (scAmp > 1e-5) {
        this.phSc += (2 * Math.PI * scHz) / fs;
        if (this.phSc > 6.283185307) this.phSc -= 6.283185307;
        aux += scAmp * (Math.sin(this.phSc) + 0.4 * Math.sin(2 * this.phSc));
      }

      // --- blow-off valve "Pssscht" ------------------------------------------------------
      if (this.bovEnv > 1e-4) {
        this.bov.run(this.noise());
        aux += this.bov.bp * this.bovEnv * 0.5;
        this.bovEnv *= 1 - 1 / (0.32 * fs);
      }

      // --- starter -----------------------------------------------------------------------
      if (this.starterG > 1e-4) {
        this.phStarter += starterHz / fs;
        if (this.phStarter >= 1) this.phStarter -= 1;
        const saw = 2 * this.phStarter - 1;
        this.starterBp.run(saw + 0.4 * this.noise());
        aux += this.starterG * 0.11 * (Math.tanh(3 * saw) * 0.5 + this.starterBp.bp);
      }

      // --- crash (fatal damage) ------------------------------------------------------------
      let crash = 0;
      if (this.crashEnv > 1e-4) {
        this.crashLp.run(this.noise());
        crash = this.crashLp.lp * this.crashEnv * 1.2;
        for (let k = 0; k < 3; k++) {
          this.crashPh[k] = (this.crashPh[k]! + this.crashModes[k]!) % 6.283185307;
          crash += 0.25 * this.crashEnv * this.crashEnv * Math.sin(this.crashPh[k]!);
        }
        this.crashEnv *= 1 - 1 / (0.45 * fs);
      }

      // --- mix -------------------------------------------------------------------------------
      const eg = this.engineG;
      const common = (intake + mech + nail + this.direct + aux) * eg + crash;
      let l = yl * eg + common;
      let r = yr * eg + common;

      // DC blocker (one-pole high-pass 18 Hz): y = x − x₁ + R·y₁.
      const dl = l - this.dcL.x + this.dcCoef * this.dcL.y;
      this.dcL.x = l;
      this.dcL.y = dl;
      const dr = r - this.dcR.x + this.dcCoef * this.dcR.y;
      this.dcR.x = r;
      this.dcR.y = dr;
      l = dl * this.master;
      r = dr * this.master;

      // Peak limiter (fast attack, slow release) + soft clip safety net.
      const a = Math.max(Math.abs(l), Math.abs(r));
      this.limEnv += (a - this.limEnv) * (a > this.limEnv ? this.limAtt : this.limRel);
      const thr = 0.6;
      const gr = this.limEnv > thr ? thr / this.limEnv : 1;
      l = softClip(l * gr);
      r = softClip(r * gr);
      outL[i] = l;
      outR[i] = r;
      const pa = Math.max(Math.abs(l), Math.abs(r));
      if (pa > peak) peak = pa;
    }
    this.lastPeak = peak;
  }

  /** Current turbo whistle frequency (for tests/meters). */
  get turboWhistleHz(): number {
    return this.fTurbo;
  }

  // ------------------------------------------------------------------------------------------

  private scheduleEvents(v: Voice, f: ControlFrame, prev: number, dAng: number, lim: boolean) {
    const diesel = v.fuel === "diesel";
    const rpm = this.rpm;
    const degPerSample = dAng;
    const load = this.load;
    // Loudness grows ≈ +6 dB per rpm doubling (petrol.md §6.6), tamed to keep idle audible.
    const rpmGain = clamp(Math.sqrt(rpm / 3000), 0.22, 1.7);
    for (let s = 0; s < v.slots.length; s++) {
      const slot = v.slots[s]!;
      // Exhaust pulse at exhaust-valve opening.
      if (crossed(prev, dAng, slot.angleDeg + EXHAUST_OPEN_AFTER_TDC_DEG)) {
        let burn = f.combustion;
        let cut = false;
        if (burn && lim && this.limiterPhase < (diesel ? 0.5 : 0.6)) {
          burn = false;
          cut = true;
        }
        let amp: number;
        if (burn) amp = diesel ? 0.55 + 0.45 * load : 0.22 + 0.78 * load;
        else amp = 0.1 + (cut && diesel ? 0.2 : 0); // compression/expansion only (starter, coast, cut)
        const jit = 1 - 0.65 * Math.max(load, clamp((rpm - v.idleRpm) / 3000, 0, 1));
        amp *= rpmGain * v.pulseGain * slot.gain * (1 + v.jitterAmp * jit * (2 * this.rand01() - 1));
        const delay = slot.headerDelayS * this.fs + (v.jitterDeg * jit * this.rand01()) / Math.max(1e-6, degPerSample);
        const len = clamp(v.pulseWidthDeg / Math.max(1e-6, degPerSample), 0.0015 * this.fs, 0.04 * this.fs);
        const e = this.trigger(K_EXHAUST, slot.bank, amp, delay);
        if (e) {
          e.len = len;
          e.p1 = v.pulseSkew;
        }
        // Petrol: unburnt mixture ignites in the hot exhaust → pop (cut ignition, overrun).
        if (!diesel && rpm > 2500) {
          const overrun = f.combustion && this.pedal < 0.05 && rpm > 3200;
          const chance = cut ? 0.12 : overrun ? v.popChance : 0;
          if (chance > 0 && this.rand01() < chance) this.trigger(K_POP, slot.bank, 0.5 + 0.5 * this.rand01(), delay + this.fs * 0.003 * this.rand01());
        }
      }
      if (!f.combustion) continue;
      // Combustion-synchronous structure noise shortly after TDC.
      if (crossed(prev, dAng, slot.angleDeg + 6)) {
        if (diesel && this.nail > 0.01 && !(lim && this.limiterPhase < 0.5)) {
          this.trigger(K_NAIL, 0, this.nail * (0.8 + 0.4 * this.rand01()) * (0.6 + 0.4 * rpmGain), 0);
        }
        if (!diesel && this.knock > 0.01 && this.rand01() < 0.25 + 0.75 * this.knock) {
          this.trigger(K_KNOCK, 0, this.knock * (0.5 + 0.5 * this.rand01()), this.fs * 0.0006 * this.rand01());
        }
      }
      // Valve ticks (intake + exhaust event of this cylinder).
      if (crossed(prev, dAng, slot.angleDeg + 250) || crossed(prev, dAng, slot.angleDeg + 470)) {
        this.trigger(K_TICK, 0, v.tickGain * (0.7 + 0.6 * this.rand01()), 0);
      }
    }
    // Conrod bearing knock: once per crank revolution, loud under load change.
    if (this.rod > 0.01 && (crossed(prev, dAng, 10) || crossed(prev, dAng, 370))) {
      this.trigger(K_ROD, 0, this.rod * (0.6 + 0.4 * load), 0);
    }
    // Without combustion (starter, coasting down) the valvetrain still ticks.
    if (!f.combustion && rpm > 25) {
      for (let s = 0; s < v.slots.length; s++) {
        if (crossed(prev, dAng, v.slots[s]!.angleDeg + 250)) this.trigger(K_TICK, 0, v.tickGain * 0.8, 0);
      }
    }
  }

  private trigger(kind: number, bank: number, amp: number, delay: number): Ev | null {
    for (let i = 0; i < POOL; i++) {
      const e = this.evs[i]!;
      if (e.active) continue;
      e.active = true;
      e.kind = kind;
      e.bank = bank;
      e.amp = amp;
      e.delay = Math.max(0, Math.round(delay));
      e.t = 0;
      e.env = 1;
      const fs = this.fs;
      const v = this.voice;
      switch (kind) {
        case K_EXHAUST:
          e.len = 0.02 * fs;
          break;
        case K_NAIL:
          e.p2 = Math.exp(-1 / ((v?.nailDecayS ?? 0.0015) * fs));
          e.len = 7 * (v?.nailDecayS ?? 0.0015) * fs;
          break;
        case K_KNOCK: {
          const hz = (v?.knockHz ?? 6000) * (0.95 + 0.1 * this.rand01());
          e.p1 = (2 * Math.PI * Math.min(hz, 0.45 * fs)) / fs;
          e.p2 = Math.exp(-1 / (0.0016 * fs));
          e.len = 0.012 * fs;
          break;
        }
        case K_POP:
          e.p2 = Math.exp(-1 / (0.006 * fs));
          e.len = 0.04 * fs;
          break;
        case K_ROD:
          e.p1 = (2 * Math.PI * 380) / fs;
          e.p2 = Math.exp(-1 / (0.012 * fs));
          e.len = 0.08 * fs;
          break;
        case K_TICK:
          e.p2 = Math.exp(-1 / (0.0004 * fs));
          e.len = 0.003 * fs;
          break;
      }
      return e;
    }
    return null; // pool exhausted: drop (only at absurd rpm × cylinders)
  }

  private renderEvents() {
    for (let i = 0; i < POOL; i++) {
      const e = this.evs[i]!;
      if (!e.active) continue;
      if (e.delay > 0) {
        e.delay--;
        continue;
      }
      switch (e.kind) {
        case K_EXHAUST: {
          // Blowdown: steep rise, longer tail. sin²(π·x^k) with k < 1 skews the peak forward.
          const x = e.t / e.len;
          const s = Math.sin(Math.PI * Math.pow(x, e.p1));
          const y = e.amp * s * s;
          this.bankIn[e.bank] = (this.bankIn[e.bank] ?? 0) + y;
          this.flowEnv += y;
          break;
        }
        case K_NAIL: {
          const y = e.amp * e.env * (e.t === 0 ? 1.5 : this.noise());
          this.nailIn += y * 0.55;
          e.env *= e.p2;
          break;
        }
        case K_KNOCK: {
          const y = e.amp * e.env * (Math.sin(e.p1 * e.t) + 0.5 * Math.sin(1.66 * e.p1 * e.t + 1));
          this.direct += y * 0.18;
          e.env *= e.p2;
          break;
        }
        case K_POP: {
          const y = e.amp * e.env * (0.6 * this.noise() + 0.8);
          this.bankIn[e.bank] = (this.bankIn[e.bank] ?? 0) + y * 0.9;
          this.flowEnv += y;
          e.env *= e.p2;
          break;
        }
        case K_ROD: {
          const y = e.amp * e.env * (Math.sin(e.p1 * e.t) + 0.4 * Math.sin(2.7 * e.p1 * e.t));
          this.direct += y * 0.2;
          e.env *= e.p2;
          break;
        }
        case K_TICK: {
          this.mechIn += e.amp * e.env * this.noise() * 3;
          e.env *= e.p2;
          break;
        }
      }
      e.t++;
      if (e.t >= e.len) e.active = false;
    }
  }

  private noise(): number {
    // xorshift32
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 2147483648 - 1;
  }

  private rand01(): number {
    return (this.noise() + 1) * 0.5;
  }
}

/** True if the crank moved over `targetDeg` (mod 720) in the step prev → prev + d. */
export function crossed(prevDeg: number, dDeg: number, targetDeg: number): boolean {
  const rel = (((targetDeg - prevDeg) % 720) + 720) % 720;
  return rel < dDeg && dDeg > 0;
}

/** Soft clip: linear below 0.75, approaches 0.97 asymptotically. Continuous and monotonic. */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.75) return x;
  const y = 0.75 + 0.22 * Math.tanh((a - 0.75) / 0.22);
  return x < 0 ? -y : y;
}
