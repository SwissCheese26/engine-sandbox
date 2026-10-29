/**
 * Pure, DOM-free sound model: derives synthesis parameters ("voice") from the engine config and
 * per-frame control values from the simulator state. Shared by the main thread (engine-sound.ts),
 * the AudioWorklet (engine-worklet.ts → dsp.ts) and the offline renderer (tests/audio/render-demo.ts).
 *
 * Physics/acoustics references: docs/research/petrol.md §6 (Akustik), docs/research/diesel.md
 * "Sound-Hinweise". Coefficients marked [S] are estimates for calibration by ear.
 *
 * Only type imports from the core here, so the worklet bundle stays small and self-contained.
 */
import type {
  Aspiration,
  CylinderLayout,
  DieselInjection,
  EngineConfig,
  EngineState,
  EngineSummary,
  ExhaustManifold,
  FuelKind,
  V8Crank,
} from "../core/index.ts";

/** Speed of sound in hot exhaust gas before the silencer (≈ 700 °C, κ 1.33): √(κRT) ≈ 610 m/s. petrol.md §6.3 */
export const SOUND_SPEED_HOT_MS = 600;
/** Speed of sound in the tail pipe (≈ 250 °C): ≈ 450 m/s. petrol.md §6.6 */
export const SOUND_SPEED_TAIL_MS = 450;
/** Speed of sound in burnt gas inside the cylinder for the knock mode (petrol.md §6.4, a ≈ 900–1000 m/s). */
export const SOUND_SPEED_BURNT_MS = 950;
/** Exhaust valve opens ≈ 130 °CA after firing TDC; the blowdown pulse starts there. [S] */
export const EXHAUST_OPEN_AFTER_TDC_DEG = 130;
/** Arrival-time difference between the two tail pipes at the listener (2-bank engines). [S] */
export const BANK_LISTENER_OFFSET_S = 0.0009;

// ---------------------------------------------------------------------------------------------
// Frequencies
// ---------------------------------------------------------------------------------------------

/** Firing frequency of a 4-stroke: rpm/60 · z/2 (petrol.md §6.1). R4 @ 3000 → 100 Hz. */
export function firingFrequencyHz(rpm: number, cylinders: number): number {
  return (Math.max(0, rpm) / 60) * (cylinders / 2);
}

/** 1st engine order (crank rotation). */
export function crankFrequencyHz(rpm: number): number {
  return Math.max(0, rpm) / 60;
}

/** 0.5th order: one working cycle (720 °CA). */
export function cycleFrequencyHz(rpm: number): number {
  return Math.max(0, rpm) / 120;
}

/** Pipe resonance, open–open: f_k = k·a/(2L) (petrol.md §6.6). */
export function pipeResonanceHz(lengthM: number, soundSpeedMs: number, k = 1): number {
  return (k * soundSpeedMs) / (2 * lengthM);
}

/** First circumferential knock mode after Draper: f = 1.841·a/(π·B) (petrol.md §6.4). B = 86 mm → ≈ 6.5 kHz. */
export function knockFrequencyHz(boreMm: number, soundSpeedMs = SOUND_SPEED_BURNT_MS): number {
  return (1.841 * soundSpeedMs) / (Math.PI * (boreMm / 1000));
}

/** Compressor blade passing frequency: blades · turboRpm/60 (petrol.md §6.5). */
export function bladePassingHz(turboRpm: number, blades: number): number {
  return (blades * Math.max(0, turboRpm)) / 60;
}

/**
 * Maps a (possibly ultrasonic) tone smoothly into the audible range: f_max·tanh(f/f_max).
 * Monotonic and continuous, so a spooling turbo glides instead of jumping octaves. Below ≈ f_max/3
 * the frequency is practically unchanged.
 */
export function foldToAudible(hz: number, maxHz = 11000): number {
  if (!(hz > 0)) return 0;
  return maxHz * Math.tanh(hz / maxHz);
}

/**
 * Turbo shaft speed estimated from boost when the core does not deliver `turboRpm` yet.
 * Isentropic compressor work Δh = c_p·T₁·(Π^((κ−1)/κ) − 1)/η, tip speed U = √(Δh/ψ) (work coefficient ψ ≈ 0.75
 * incl. slip), n = U/(π·D₂)·60 with exducer D₂ ≈ inducer/0.7. A freewheeling base speed driven by exhaust
 * enthalpy is added in quadrature. [Standard turbomachinery relations; ψ, η, base speed: S]
 * 1.3 bar on a 38 mm inducer → ≈ 140 000 1/min.
 */
export function estimateTurboRpm(boostBar: number, inducerMm: number, exhaustFlowNorm: number): number {
  const pr = 1 + Math.max(0, boostBar);
  const dh = (1005 * 293 * (Math.pow(pr, 0.2857) - 1)) / 0.72;
  const tip = Math.sqrt(dh / 0.75);
  const exducerM = Math.max(0.02, inducerMm / 0.7 / 1000);
  const boostRpm = (tip / (Math.PI * exducerM)) * 60;
  const freewheel = (20000 + 60000 * clamp(exhaustFlowNorm, 0, 1.5)) * (38 / Math.max(20, inducerMm));
  return Math.hypot(boostRpm, freewheel);
}

/**
 * Diesel combustion knock ("Nageln") intensity 0…1. Structure from docs/research/diesel.md (Sound-Hinweise):
 * 0.3 + 0.04·timing offset + 0.3·cold, masked by load (1 − 0.5·load); injection factor from petrol.md §6.4
 * (common rail with pilot injection quiet, unit injector loud, prechamber in between but duller).
 */
export function nailIntensity(injection: DieselInjection, timingOffsetDeg: number, coolantC: number, load: number): number {
  const cold = clamp((60 - coolantC) / 30, 0, 1); // fully "cold" below 30 °C, gone above 60 °C
  const factor = INJECTION_NAIL_FACTOR[injection];
  const raw = (0.3 + 0.04 * timingOffsetDeg + 0.3 * cold) * factor;
  return clamp(raw, 0, 1) * (1 - 0.5 * clamp(load, 0, 1));
}

const INJECTION_NAIL_FACTOR: Record<DieselInjection, number> = {
  "common-rail": 0.45,
  "indirect-prechamber": 0.6,
  "indirect-swirl-chamber": 0.65,
  "unit-injector": 1.0,
};

// ---------------------------------------------------------------------------------------------
// Pulse plan
// ---------------------------------------------------------------------------------------------

/** One combustion event per working cycle. */
export interface PulseSlot {
  /** Firing angle within the 720 ° cycle. */
  angleDeg: number;
  /** Exhaust path (0 = left / single, 1 = right bank). */
  bank: number;
  /** Extra runner length to the collector as travel time (unequal-length headers → Boxer rumble). */
  headerDelayS: number;
  /** Fixed cylinder-to-cylinder spread (≈ ±3 %). */
  gain: number;
}

/**
 * Cumulative firing angles from the firing intervals (`EngineSummary.firingIntervalsDeg`).
 * Invalid input (empty, non-finite, ≤ 0) falls back to even spacing; sums ≠ 720 are rescaled.
 */
export function firingAnglesDeg(intervalsDeg: readonly number[], cylinders = intervalsDeg.length): number[] {
  const n = Math.max(1, Math.round(cylinders));
  let iv = intervalsDeg.length === n && intervalsDeg.every((x) => Number.isFinite(x) && x > 0) ? [...intervalsDeg] : [];
  if (iv.length === 0) iv = Array.from({ length: n }, () => 720 / n);
  const sum = iv.reduce((a, b) => a + b, 0);
  const k = 720 / sum;
  const out: number[] = [];
  let acc = 0;
  for (const x of iv) {
    out.push(acc);
    acc += x * k;
  }
  return out;
}

/**
 * Which exhaust bank each firing (in firing order) feeds. Summary has no firing order yet (issue #9),
 * so the typical order per layout is assumed (petrol.md §6.2/6.3):
 * - V8 crossplane, GM LS 1-8-7-2-6-5-4-3 with odd cylinders left → L R L R R L R L.
 *   Per bank 180-270-180-90 ° → the classic burble.
 * - V8 flatplane (Ferrari 1-5-3-7-4-8-2-6) and every other V/W: banks alternate.
 * - Boxer, inline, VR: one common collector (Boxer rumble comes from header lengths, not banks).
 */
export function bankSequence(layout: CylinderLayout, cylinders: number, v8Crank: V8Crank): number[] {
  const n = Math.max(1, Math.round(cylinders));
  if ((layout === "v" || layout === "w") && n >= 2) {
    if (layout === "v" && n === 8 && v8Crank === "crossplane") return [0, 1, 0, 1, 1, 0, 1, 0];
    return Array.from({ length: n }, (_, i) => i % 2);
  }
  return Array.from({ length: n }, () => 0);
}

/**
 * Extra primary-pipe length per firing slot in metres. Unequal-length boxer headers (everything but
 * `tubular-long`, which we read as equal-length headers): ΔL ≈ 0.3–0.5 m (petrol.md §6.3, SlashGear).
 * Others: a small spread by cylinder position, more for a cast log manifold. [S]
 */
export function headerExtraLengthsM(layout: CylinderLayout, manifold: ExhaustManifold, cylinders: number): number[] {
  const n = Math.max(1, Math.round(cylinders));
  if (layout === "boxer" && manifold !== "tubular-long") {
    // Subaru EJ order 1-3-2-4: pairs arrive at the collector unevenly delayed.
    const pattern = [0, 0.42, 0.12, 0.48];
    return Array.from({ length: n }, (_, i) => pattern[i % 4]!);
  }
  const spread = manifold === "cast-log" ? 0.08 : manifold === "tubular-short" ? 0.04 : 0.01;
  return Array.from({ length: n }, (_, i) => spread * hash01(i * 7 + 3));
}

/** True if at least one bank sees unequal gaps between its own firings (tolerance 1°). */
export function banksFireUnevenly(anglesDeg: readonly number[], banks: readonly number[]): boolean {
  for (const b of new Set(banks)) {
    const a = anglesDeg.filter((_, i) => (banks[i] ?? 0) === b);
    if (a.length < 2) continue;
    const gaps = a.map((x, i) => (((a[(i + 1) % a.length]! - x) % 720) + 720) % 720 || 720);
    if (Math.max(...gaps) - Math.min(...gaps) > 1) return true;
  }
  return false;
}

/** Builds the per-cycle pulse plan from firing intervals, bank sequence and header lengths. */
export function buildPulsePlan(
  intervalsDeg: readonly number[],
  banks: readonly number[],
  extraLengthsM: readonly number[],
  soundSpeedMs = SOUND_SPEED_HOT_MS,
): PulseSlot[] {
  const n = Math.max(1, banks.length);
  const angles = firingAnglesDeg(intervalsDeg, n);
  return angles.map((angleDeg, i) => ({
    angleDeg,
    bank: banks[i] ?? 0,
    headerDelayS: (extraLengthsM[i] ?? 0) / soundSpeedMs,
    gain: 1 + 0.06 * (hash01(i * 13 + 1) - 0.5),
  }));
}

// ---------------------------------------------------------------------------------------------
// Voice: everything static that the DSP needs
// ---------------------------------------------------------------------------------------------

export type ForcedInduction = "none" | "turbo" | "twin-turbo" | "e-turbo" | "roots" | "centrifugal";

export interface Resonance {
  hz: number;
  q: number;
  gainDb: number;
}

export interface Voice {
  fuel: FuelKind;
  cylinders: number;
  displacementL: number;
  slots: PulseSlot[];
  bankCount: 1 | 2;
  /** Per bank: pan −1 … 1, gain, primary-pipe round-trip delay (comb resonator). */
  bankPan: number[];
  bankGain: number[];
  bankPipeDelayS: number[];
  combFeedback: number;
  /** Blowdown pulse length in crank degrees. */
  pulseWidthDeg: number;
  /** Shape exponent: x^k inside sin² → smaller k = steeper attack, brighter. */
  pulseSkew: number;
  /** Cycle-to-cycle jitter (timing in °CA, amplitude relative) at idle; shrinks with rpm/load. */
  jitterDeg: number;
  jitterAmp: number;
  exhaustLpHz: number;
  resonances: Resonance[];
  /** Saturation drive at full load. */
  drive: number;
  raspGain: number;
  pulseGain: number;
  intakeHz: number;
  intakeGain: number;
  mechGain: number;
  tickGain: number;
  /** Diesel: base nail factor without load/temperature (for the DSP the final intensity comes per frame). */
  nailHz: [number, number];
  nailDecayS: number;
  knockHz: number;
  forced: ForcedInduction;
  turboBlades: number;
  turboGain: number;
  inducerMm: number;
  /** Petrol turbo: blow-off valve "Pssscht" when lifting off under boost. */
  blowOff: boolean;
  /** Supercharger drive ratio to the crank. */
  scRatio: number;
  scGain: number;
  /** Overrun pops (petrol only). */
  popChance: number;
  revLimitRpm: number;
  idleRpm: number;
  /** Diesel: nail inputs. */
  injection: DieselInjection | null;
  injectionTimingOffsetDeg: number;
}

export function forcedInduction(a: Aspiration): ForcedInduction {
  switch (a) {
    case "naturally-aspirated":
      return "none";
    case "turbo":
      return "turbo";
    case "twin-turbo-parallel":
    case "twin-turbo-sequential":
      return "twin-turbo";
    case "e-turbo":
      return "e-turbo";
    case "supercharger-roots":
      return "roots";
    case "supercharger-centrifugal":
      return "centrifugal";
  }
}

/** Derives the static synthesis parameters from config + summary. Pure and serialisable (postMessage). */
export function deriveVoice(cfg: EngineConfig, summary: EngineSummary): Voice {
  const b = cfg.block;
  const n = Math.max(1, Math.round(b.cylinders));
  const diesel = cfg.fuel === "diesel";
  const dispL = summary.displacementL > 0 ? summary.displacementL : (Math.PI / 4) * (b.boreMm / 10) ** 2 * (b.strokeMm / 10) * n / 1000;
  const banksSeq = bankSequence(b.layout, n, b.v8Crank);
  const bankCount: 1 | 2 = banksSeq.some((x) => x === 1) ? 2 : 1;
  // Banks that fire unevenly on their own (crossplane V8: 180-270-180-90 per bank, petrol.md §6.3) get
  // slightly different pipe paths: the test-cell microphone is ≈ 0.3 m closer to one tail pipe (0.9 ms)
  // and the pipes differ in length/level. Without that the two uneven bank trains would sum to a perfectly
  // even 90° train in mono. Evenly firing banks (flatplane V8, V6, V10, V12) stay symmetric, so they give
  // a clean firing order with hardly any half orders ("two R4"). [S]
  const asym = bankCount === 2 && banksFireUnevenly(firingAnglesDeg(summary.firingIntervalsDeg, n), banksSeq);
  const extra = headerExtraLengthsM(b.layout, cfg.exhaust.manifold, n).map(
    (L, i) => L + (asym && banksSeq[i] === 1 ? (BANK_LISTENER_OFFSET_S * SOUND_SPEED_HOT_MS) : 0),
  );
  const slots = buildPulsePlan(summary.firingIntervalsDeg, banksSeq, extra);
  const forced = forcedInduction(cfg.induction.aspiration);
  const turbo = forced === "turbo" || forced === "twin-turbo" || forced === "e-turbo";

  // Primary pipes: header length → comb resonator delay 2L/a (petrol.md §6.6). [S lengths]
  const primaryM = cfg.exhaust.manifold === "tubular-long" ? 0.85 : cfg.exhaust.manifold === "tubular-short" ? 0.45 : 0.28;
  const pipeDelay = (2 * primaryM) / SOUND_SPEED_HOT_MS;
  // Whole system & middle silencer lengths grow with displacement. [S]
  const systemM = 2.6 + 0.5 * dispL;
  const midM = 0.55 + 0.1 * dispL;
  const resonances: Resonance[] = [
    { hz: pipeResonanceHz(systemM, SOUND_SPEED_TAIL_MS), q: 1.1, gainDb: diesel ? 7 : 6 },
    { hz: pipeResonanceHz(midM, SOUND_SPEED_TAIL_MS), q: 1.4, gainDb: 4 },
  ];

  // Silencer low-pass: Kat + middle silencer 300–800 Hz (petrol.md §6.6); turbine damps further.
  let lp = diesel ? 520 : 720;
  if (turbo) lp *= 0.78;
  if (cfg.exhaust.catalyst) lp *= 0.92;
  if (cfg.exhaust.particulateFilter) lp *= 0.82;
  if (cfg.exhaust.manifold !== "cast-log") lp *= 1.12;
  lp *= 1 + 0.04 * Math.min(8, n - 4); // many small pulses: brighter

  let rasp = diesel ? 0.05 : 0.12;
  if (cfg.exhaust.manifold === "tubular-long") rasp *= 1.4;
  if (turbo) rasp *= 0.55;
  if (cfg.exhaust.catalyst) rasp *= 0.75;
  if (cfg.exhaust.particulateFilter) rasp *= 0.6;

  // Intake: runner as quarter-wave resonator f = a/(4L) at a ≈ 343 m/s, kept in an audible band.
  const runner = Math.max(80, cfg.induction.intakeRunnerLengthMm) / 1000;
  const intakeHz = clamp(343 / (4 * runner), 150, 900);
  let intakeGain = diesel ? 0.35 : 0.55;
  if (cfg.induction.individualThrottleBodies && !diesel) intakeGain *= 1.8;
  if (forced === "roots") intakeGain *= 1.2;
  if (turbo) intakeGain *= 0.7;

  const vt = cfg.head.valvetrain;
  const mechGain = (diesel ? 0.05 : 0.035) * (vt === "ohv" ? 1.3 : 1) * (b.blockMaterial === "aluminium" ? 1.15 : 1);
  const tickGain = vt === "ohv" ? 0.05 : vt === "sohc" ? 0.03 : 0.018;

  const cam = clamp(cfg.head.camProfile, 0, 1);
  const injection = cfg.fuelSystem.kind === "diesel" ? cfg.fuelSystem.injection : null;
  const idi = injection === "indirect-prechamber" || injection === "indirect-swirl-chamber";

  // Blade count grows with compressor size (6 small … 11 large). [S]
  const turboBlades = Math.round(clamp(6 + (cfg.induction.compressorInducerMm - 35) / 6, 6, 11));
  const fuelPetrol = cfg.fuelSystem.kind === "petrol";

  return {
    fuel: cfg.fuel,
    cylinders: n,
    displacementL: dispL,
    slots,
    bankCount,
    bankPan: bankCount === 2 ? [-0.45, 0.45] : [0],
    bankGain: bankCount === 2 ? (asym ? [1, 0.8] : [1, 1]) : [1],
    bankPipeDelayS: bankCount === 2 ? [pipeDelay, asym ? pipeDelay * 1.13 : pipeDelay] : [pipeDelay],
    combFeedback: cfg.exhaust.manifold === "tubular-long" ? 0.42 : 0.3,
    pulseWidthDeg: (diesel ? 125 : 105) * (1 + 0.25 * cam),
    pulseSkew: diesel ? 0.75 : 0.6,
    jitterDeg: 0.8 + 3.5 * cam * (diesel ? 0.5 : 1),
    jitterAmp: (diesel ? 0.07 : 0.04) + 0.12 * cam,
    exhaustLpHz: lp,
    resonances,
    drive: diesel ? 1.2 : 2.0,
    raspGain: rasp,
    pulseGain: (turbo ? 0.75 : 1) * (diesel ? 1.05 : 1) * Math.sqrt(dispL / n / 0.5),
    intakeHz,
    intakeGain,
    mechGain,
    tickGain,
    nailHz: idi ? [900, 1800] : [1600, 2900],
    nailDecayS: idi ? 0.0022 : 0.0013,
    knockHz: knockFrequencyHz(b.boreMm),
    forced,
    turboBlades,
    turboGain: (forced === "none" || forced === "roots" || forced === "centrifugal" ? 0 : 0.05) * (cfg.induction.variableGeometry ? 0.6 : 1),
    inducerMm: cfg.induction.compressorInducerMm,
    blowOff: turbo && !diesel,
    scRatio: forced === "roots" ? 2 : forced === "centrifugal" ? 12 : 0,
    scGain: forced === "roots" ? 0.06 : forced === "centrifugal" ? 0.04 : 0,
    popChance: fuelPetrol ? 0.05 + 0.1 * cam : 0,
    revLimitRpm: cfg.revLimitRpm,
    idleRpm: cfg.idleRpm,
    injection,
    injectionTimingOffsetDeg: cfg.fuelSystem.kind === "diesel" ? cfg.fuelSystem.injectionTimingOffsetDeg : 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Control frames (per animation frame, main thread → DSP)
// ---------------------------------------------------------------------------------------------

export interface ControlFrame {
  rpm: number;
  load: number;
  pedal: number;
  /** Fuel is burnt (running, not destroyed). */
  combustion: boolean;
  /** Starter motor cranking. */
  starter: boolean;
  /** Rev limiter active → ignition/fuel cut stutter. */
  limiter: boolean;
  turboRpm: number;
  boostBar: number;
  /** Air mass flow relative to the naturally aspirated full-load flow at rev limit (0 … ~1.5). */
  airFlow: number;
  knock: number;
  /** Diesel nail intensity 0 … 1 (already includes temperature, load, injection). */
  nail: number;
  /** Conrod bearing knock 0 … 1 (wear / conrod-stress). */
  rodKnock: number;
  destroyed: boolean;
  /** One-shot: blow-off amplitude 0 … 1 (0 = none). */
  blowOff: number;
  /** One-shot: engine just got destroyed. */
  crash: boolean;
}

export function silentFrame(): ControlFrame {
  return {
    rpm: 0, load: 0, pedal: 0, combustion: false, starter: false, limiter: false, turboRpm: 0, boostBar: 0,
    airFlow: 0, knock: 0, nail: 0, rodKnock: 0, destroyed: false, blowOff: 0, crash: false,
  };
}

/** Is the rev limiter cutting? Placeholder physics parks at revLimit − 50, so a small band is used. */
export function limiterActive(rpm: number, revLimitRpm: number, pedal: number, running: boolean): boolean {
  return running && pedal > 0.2 && rpm >= revLimitRpm - Math.max(80, 0.015 * revLimitRpm);
}

/**
 * Turns successive EngineStates into ControlFrames. Holds the little history that one-shots need
 * (blow-off on fast lift under boost, crash edge, starter detection, estimated turbo lag).
 */
export class ControlTracker {
  private lastT = Number.NaN;
  private pedalSlow = 0;
  private boostPeak = 0;
  private bovCooldown = 0;
  private wasDestroyed = false;
  private prevRpm = 0;
  private rising = 0;
  private turboEst = 0;

  constructor(private voice: Voice) {}

  setVoice(v: Voice) {
    this.voice = v;
  }

  next(s: EngineState, pedal: number): ControlFrame {
    const v = this.voice;
    let dt = Number.isFinite(this.lastT) ? s.t - this.lastT : 1 / 60;
    if (!(dt > 0) || dt > 0.5) dt = 1 / 60;
    this.lastT = s.t;
    const rpm = Number.isFinite(s.rpm) ? Math.max(0, s.rpm) : 0;
    const p = clamp(pedal, 0, 1);
    const load = clamp(Number.isFinite(s.load) ? s.load : p, 0, 1);
    const boost = Number.isFinite(s.boostBar) ? Math.max(0, s.boostBar) : 0;

    // Starter: explicit field once the core has it (issue #9), else "not running and rpm rising".
    const explicit = (s as Partial<{ starterEngaged: boolean }>).starterEngaged;
    this.rising = rpm > this.prevRpm + 0.2 ? 0.25 : Math.max(0, this.rising - dt);
    this.prevRpm = rpm;
    const starter = typeof explicit === "boolean"
      ? explicit && rpm < 450 && !s.destroyed
      : !s.running && !s.destroyed && rpm > 5 && rpm < 400 && this.rising > 0;

    // Air flow: from the core if available, else a crude estimate.
    const dispM3 = v.displacementL / 1000;
    const naFlowMax = 1.2 * dispM3 * (v.revLimitRpm / 120) * 0.9; // ρ·V_d·n/2·λ_a, kg/s
    const airFlow = s.airMassFlowKgS > 0 && naFlowMax > 0
      ? s.airMassFlowKgS / naFlowMax
      : (rpm / Math.max(1, v.revLimitRpm)) * (0.15 + 0.85 * load) * (1 + boost);

    // Turbo speed: from the core, else estimated from boost with ≈ 0.5 s spool lag.
    let turboRpm = 0;
    if (v.forced === "turbo" || v.forced === "twin-turbo" || v.forced === "e-turbo") {
      if (s.turboRpm > 0) turboRpm = s.turboRpm;
      else {
        const target = rpm > 50 ? estimateTurboRpm(boost, v.inducerMm, airFlow) * Math.min(1, rpm / Math.max(1, v.idleRpm)) : 0;
        const tau = target > this.turboEst ? 0.5 : 1.2;
        this.turboEst += (target - this.turboEst) * (1 - Math.exp(-dt / tau));
        turboRpm = this.turboEst;
      }
    }

    // Blow-off: pedal falls fast (vs. 0.15 s smoothed) while there was boost in the last ≈ 0.4 s.
    this.boostPeak = Math.max(boost, this.boostPeak * Math.exp(-dt / 0.4));
    let blowOff = 0;
    this.bovCooldown = Math.max(0, this.bovCooldown - dt);
    if (v.blowOff && this.bovCooldown === 0 && this.pedalSlow - p > 0.35 && this.boostPeak > 0.3) {
      blowOff = clamp(this.boostPeak / 1.4, 0.2, 1);
      this.bovCooldown = 0.6;
    }
    this.pedalSlow += (p - this.pedalSlow) * (1 - Math.exp(-dt / 0.15));

    const crash = s.destroyed && !this.wasDestroyed;
    this.wasDestroyed = s.destroyed;

    const nail = v.fuel === "diesel" && v.injection
      ? nailIntensity(v.injection, v.injectionTimingOffsetDeg, s.coolantC, load)
      : 0;
    const stress = s.warnings?.find((w) => w.code === "conrod-stress");
    const rodKnock = Math.max(clamp((s.wear - 0.6) / 0.4, 0, 1), stress ? (stress.severity === "critical" ? 0.7 : 0.3) : 0);

    return {
      rpm,
      load,
      pedal: p,
      combustion: s.running && !s.destroyed,
      starter,
      limiter: limiterActive(rpm, v.revLimitRpm, p, s.running),
      turboRpm,
      boostBar: boost,
      airFlow: clamp(airFlow, 0, 2),
      knock: v.fuel === "petrol" ? clamp(s.knock, 0, 1) : 0,
      nail,
      rodKnock,
      destroyed: s.destroyed,
      blowOff,
      crash,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------------------------

/** One-pole low-pass coefficient for time constant τ: 1 − e^(−1/(τ·fs)). */
export function onePoleCoef(tauS: number, sampleRate: number): number {
  if (!(tauS > 0)) return 1;
  return 1 - Math.exp(-1 / (tauS * sampleRate));
}

/** Exponential parameter smoother (no zipper noise / clicks). */
export class Smoother {
  value: number;
  target: number;
  private coef: number;
  constructor(initial: number, tauS: number, sampleRate: number) {
    this.value = initial;
    this.target = initial;
    this.coef = onePoleCoef(tauS, sampleRate);
  }
  setTau(tauS: number, sampleRate: number) {
    this.coef = onePoleCoef(tauS, sampleRate);
  }
  step(): number {
    this.value += (this.target - this.value) * this.coef;
    return this.value;
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : Number.isFinite(x) ? x : lo;
}

/** Deterministic 0 … 1 hash for fixed per-cylinder variation. */
function hash01(i: number): number {
  let h = (i * 2654435761) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
