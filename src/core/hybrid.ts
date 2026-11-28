/**
 * Hybrid drive (issue #157, docs/research/hybrid.md). Same interface as EvSimulator, so the app, the drivetrain
 * (electric path) and the views run it in place of an electric car. No DOM.
 *
 * - The motors, the battery, regeneration, blended braking and the tyre model are the EvSimulator's (electric.ts).
 * - The combustion engine is the normal EngineSimulator on its own shaft, held at the speed the topology gives it
 *   (dyno mode "hold-rpm": the load is the gearbox, the ring gear or the generator; hybrid.md §2). Its torque reaches
 *   the EvSimulator's reference shaft (`link.refNm`), generator power its DC bus (`link.dcKw`).
 * - Strategy (hybrid.md §3): a rule-based approximation of the ECMS (equivalent consumption minimisation, Paganelli
 *   et al. 2002; Sciarretta & Guzzella 2007): electric below a power and speed threshold, load-point shift towards the
 *   target SoC, boost from the battery above the engine's capacity, regeneration before the friction brake, engine
 *   stop at standstill, a minimum on-time against hunting, and a SoC window.
 */
import { dynoSweep } from "./dyno.ts";
import { EvSimulator } from "./electric.ts";
import { EngineSimulator } from "./simulator.ts";
import type { EngineConfig, EngineState, EvConfig, HybridConfig, HybridMode, HybridState, SimInputs } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const fin = (x: number, fb: number) => (Number.isFinite(x) ? x : fb);
const RPM = 30 / Math.PI;
/** Pedal travel below which the pedal is lift-off regen (same as electric.ts). */
const PEDAL_ZERO = 0.1;

export const HYBRID_MODES: Record<HybridMode, { label: string; hint: string }> = {
  hybrid: { label: "Hybrid", hint: "Automatisch: elektrisch anfahren, Motor bei Bedarf" },
  ev: { label: "EV", hint: "Elektrisch, solange Akku und Tempo reichen" },
  sport: { label: "Sport", hint: "Motor läuft immer, volle Boost-Leistung" },
  charge: { label: "Laden", hint: "Motor lädt den Akku bis zum oberen Ladefenster" },
};
export const HYBRID_MODE_IDS = Object.keys(HYBRID_MODES) as HybridMode[];
/** Modes the topology offers: a mild hybrid cannot drive electrically, a range extender has no sport boost. */
export function hybridModes(hy: HybridConfig): HybridMode[] {
  if (hy.topology === "mild") return ["hybrid", "sport"];
  if (hy.topology === "series") return ["hybrid", "ev", "charge"];
  return HYBRID_MODE_IDS;
}

/** Engine stays on at least this long once started, s (against start/stop hunting) [S, hybrid.md §3.5]. */
export const ENGINE_MIN_ON_S = 3;
/** Engine → DC efficiency of a generator path (MG1 / REx generator + inverter) [hybrid.md §2.3]. */
export const GEN_EFFICIENCY = 0.9;
/** Lowest engine load the strategy runs the engine at (below: load-point shift or off), share of peak power [§3.3]. */
const MIN_LOAD_SHARE = 0.18;
/** Load-point shift: charge power at a SoC 0.1 below target, share of peak power (charge mode 0.4) [§3.3]. */
const SHIFT_SHARE = 0.2;
/** Electric driving power of a full hybrid in mode "hybrid", share of the battery-limited motor power [§3.1]. */
const EV_POWER_SHARE = 0.35;

interface Curve {
  cfg: EngineConfig;
  rpm: number[];
  nm: number[];
  peakKw: number;
  peakKwRpm: number;
}

export class HybridSimulator extends EvSimulator {
  readonly engine: EngineSimulator;
  private curve: Curve | null = null;
  private on = false;
  private onT = 0;
  private startT = 0;
  private ePedal = 0;
  private eI = 0;
  private eGear = 1;
  private gearT = 0;
  private perf = false;
  private hs: HybridState | null = null;

  constructor(ev: EvConfig, public hy: HybridConfig, engine: EngineSimulator | EngineConfig) {
    super(ev);
    this.engine = engine instanceof EngineSimulator ? engine : new EngineSimulator(engine);
    this.engine.reset();
    // a full hybrid is delivered in the middle of its window, a plug-in charged to the top of it
    this.setSoc(hy.plugIn ? hy.socMax : (hy.socMin + hy.socMax) / 2);
  }

  override reset() {
    super.reset();
    this.engine?.reset();
    this.on = false;
    this.onT = this.startT = this.ePedal = this.eI = this.gearT = 0;
    this.eGear = 1;
    this.hs = null;
  }

  get hybridState(): HybridState | null {
    return this.hs;
  }

  /** Full-load curve of the engine as it is now (the bench may change it). */
  private full(): Curve {
    const cfg = this.engine.config;
    if (this.curve?.cfg === cfg) return this.curve;
    const pts = dynoSweep(cfg, { fromRpm: 800, stepRpm: 100 });
    let pk = pts[0]!;
    for (const p of pts) if (p.powerKw > pk.powerKw) pk = p;
    this.curve = { cfg, rpm: pts.map((p) => p.rpm), nm: pts.map((p) => Math.max(0, p.torqueNm)), peakKw: pk.powerKw, peakKwRpm: pk.rpm };
    return this.curve;
  }

  private tMax(rpm: number): number {
    const c = this.full();
    const n = clamp(rpm, c.rpm[0]!, c.rpm[c.rpm.length - 1]!);
    const i = Math.min(c.rpm.length - 2, Math.max(0, Math.floor((n - c.rpm[0]!) / 100)));
    const f = (n - c.rpm[i]!) / 100;
    return c.nm[i]! + (c.nm[i + 1]! - c.nm[i]!) * clamp(f, 0, 1);
  }

  /** Total ratio crank → wheel in gear g (p2 / mild). */
  private gearRatio(g: number): number {
    const r = this.hy.ratios ?? [1];
    return r[clamp(g, 1, r.length) - 1]! * (this.hy.finalDrive ?? 3.5);
  }

  /**
   * Gear of the engine-side gearbox (p2 / mild), at most every 0.4 s: full pedal → the lowest gear below 93 % of the
   * limiter (most power), Sport → highest gear above 3000 1/min, else the highest gear above 1500 1/min [§2.1].
   */
  private pickGear(dt: number, wheelRpm: number, pedal: number, sport: boolean): number {
    const n = this.hy.ratios?.length ?? 1;
    this.gearT -= dt;
    if (this.gearT > 0) return this.eGear;
    const lim = this.engine.config.revLimitRpm;
    const crank = (g: number) => wheelRpm * this.gearRatio(g);
    let g = 1;
    // traction control may hold the pedal back: once on full load, the gearbox stays in the power range
    this.perf = pedal > 0.6 || (this.perf && pedal > 0.25);
    if (this.perf) {
      while (g < n && crank(g) > 0.93 * lim) g++;
    } else {
      const floor = sport ? 3000 : Math.max(1500, this.engine.config.idleRpm + 600);
      for (let k = n; k >= 1; k--) if (crank(k) >= floor || k === 1) { g = k; break; }
      while (g < n && crank(g) > 0.93 * lim) g++;
    }
    if (g !== this.eGear) {
      this.eGear = g;
      this.gearT = 0.4;
    }
    return g;
  }

  override step(dtIn: number, input: SimInputs): EngineState {
    const dt = clamp(fin(dtIn, 0), 0, 0.25);
    const c = input.dynoMode === "vehicle" ? input.vehicle : undefined;
    if (!c || dt <= 0) return this.benchStep(dt, input);
    const hy = this.hy;
    const ev = this.ev;
    const L = this.link;
    const topo = hy.topology;
    const allowed = hybridModes(hy);
    const mode: HybridMode = allowed.includes(input.hybridMode ?? "hybrid") ? (input.hybridMode ?? "hybrid") : "hybrid";
    const prev = this.state;
    const soc = this.battery.soc;
    const ready = !!input.ignition && soc > 0;
    const pedal = clamp(fin(input.pedal, 0), 0, 1);
    const brake = clamp(c.brake ?? 0, 0, 1);
    const r = c.vehicle.wheelRadiusM;
    const v = Math.max(0, prev.vehicleSpeedMs ?? 0);
    const kmh = v * 3.6;
    const eta = ev.gearEfficiency;
    const geared = topo === "p2" || topo === "mild";
    const belt = topo === "mild" ? (hy.beltRatio ?? 2.8) : 1;
    const wheelRpm = (v / r) * RPM;
    const cfg = this.engine.config;
    const idle = cfg.idleRpm;
    const lim = cfg.revLimitRpm;
    const cur = this.full();
    const pMaxW = cur.peakKw * 1000;
    // --- engine-side gear: motor 0 sits in front of the gearbox (p2) or on the belt (mild)
    if (geared) {
      const g = this.pickGear(dt, wheelRpm, pedal, mode === "sport");
      this.setMotorRatio(this.gearRatio(g) * belt);
    }
    const ratio = geared ? this.gearRatio(this.eGear) : 0;
    const nCoupled = wheelRpm * ratio;
    // P2 launch: the clutch slips with the engine at a pedal-dependent speed (DCT / converter launch) [§2.1]
    const nLaunch = Math.min(0.55 * lim, idle + 400 + 1600 * pedal);
    // --- engine force capacity at the wheels
    const ringK = (hy.ringShare ?? 0.72) * (hy.ringRatio ?? 3.3);
    let fECap = 0;
    if (geared) fECap = (this.tMax(Math.max(nCoupled, nLaunch)) * ratio * eta) / r;
    else if (topo === "power-split") fECap = Math.min((pMaxW * 0.9) / Math.max(v, 1), (this.tMax(cur.peakKwRpm) * ringK * eta) / r);
    const fMCap = L.capN;
    const drive = ready && pedal > PEDAL_ZERO && brake < 0.05;
    const want = drive ? Math.pow((pedal - PEDAL_ZERO) / (1 - PEDAL_ZERO), 1.2) * (fMCap + fECap) : 0;
    const vEff = Math.max(v, 2);
    const pDem = want * vEff;
    // --- SoC target and window [§3.6]
    const mid = (hy.socMin + hy.socMax) / 2;
    const depleting = !!hy.plugIn && soc > hy.socMin + 0.04 && mode !== "charge" && mode !== "sport";
    const target = mode === "charge" ? hy.socMax : mode === "sport" ? Math.min(hy.socMax, mid + 0.1) : depleting ? soc : hy.plugIn ? hy.socMin + 0.05 : mid;
    const socLow = soc < hy.socMin;
    // --- engine on / off [§3.1, §3.5]
    const motorKw = Math.max(1, prev.ev?.maxDischargeKw ?? 30);
    const evKw = (hy.plugIn && depleting) || mode === "ev" ? 0.95 * motorKw : EV_POWER_SHARE * motorKw;
    const evKmh = mode === "ev" || (hy.plugIn && depleting) ? hy.evMaxKmh : 0.85 * hy.evMaxKmh;
    let wantOn: boolean;
    if (!ready) wantOn = false;
    else if (topo === "mild") wantOn = !(v < 0.3 && !drive);
    else if (topo === "series") wantOn = mode === "charge" ? soc < hy.socMax : soc < hy.socMin + (this.on ? 0.08 : 0) || (mode !== "ev" && soc < mid - 0.15);
    else {
      const kick = pedal > 0.97 && want > 0.95 * fMCap;
      const over = pDem > evKw * 1000 || kmh > evKmh || kick;
      const need = socLow || mode === "sport" || (mode === "charge" && soc < hy.socMax) || (!hy.plugIn && soc < target - 0.12);
      const stopped = v < 0.3 && !drive;
      wantOn = need || (mode === "ev" ? kick || kmh > hy.evMaxKmh : over) || (this.on && this.onT < ENGINE_MIN_ON_S && !stopped);
      // with the engine running it stays on until the demand falls well below the threshold (hysteresis)
      if (this.on && !wantOn && !stopped && drive && pDem > 0.7 * evKw * 1000) wantOn = true;
      if (stopped && !(socLow || mode === "charge" || mode === "sport")) wantOn = topo === "power-split" && soc < hy.socMin + 0.02;
    }
    if (wantOn && !this.on) {
      this.on = true;
      this.onT = 0;
      this.startT = 0;
    } else if (!wantOn && this.on) this.on = false;
    if (this.on) this.onT += dt;
    // --- engine operating point
    const es0 = this.engine.state;
    const firing = es0.running;
    let coupled = false;
    let targetRpm = idle;
    let pE = 0;
    if (this.on && firing) {
      // load-point shift: charge towards the target SoC, at least MIN_LOAD_SHARE when the engine runs at all
      const chg = clamp((target - soc) / 0.1, 0, 1) * (mode === "charge" ? 0.4 : SHIFT_SHARE) * pMaxW;
      const chgCap = 0.8 * (prev.ev?.maxChargeKw ?? 0) * 1000 * clamp((hy.socMax + 0.03 - soc) / 0.03, 0, 1);
      const full = pedal > 0.9;
      pE = full && drive ? pMaxW : clamp(Math.max(pDem + Math.min(chg, chgCap), soc < hy.socMax ? MIN_LOAD_SHARE * pMaxW : 0), 0, pMaxW);
      if (!drive && topo !== "series" && topo !== "power-split") pE = 0;
      // power-split: what neither the ring gear nor MG2 can take at this speed has to fit into the battery [§2.2]
      if (topo === "power-split") pE = Math.min(pE, (want * v) / 0.85 + (full ? 0 : chgCap));
    }
    const cut = 1 - clamp(c.torqueCut ?? 0, 0, 0.9);
    let tTarget = 0;
    if (topo === "series") {
      targetRpm = 0.8 * cur.peakKwRpm;
      pE = this.on ? Math.min(pMaxW, ((hy.generatorKw ?? 25) * 1000) / GEN_EFFICIENCY) : 0;
      tTarget = pE / (targetRpm / RPM);
    } else if (topo === "power-split") {
      // operating line: speed rises with the power (best-BSFC line of an Atkinson engine) [§2.2]
      const share = clamp(pE / pMaxW, 0, 1);
      targetRpm = Math.max(idle + 300, 1000 + (cur.peakKwRpm - 1000) * Math.sqrt(share));
      tTarget = Math.min(this.tMax(targetRpm), pE / (targetRpm / RPM)) * cut;
      coupled = this.on && firing;
    } else if (this.on && firing && drive) {
      const fTarget = Math.min(fECap, pE / vEff) * cut;
      targetRpm = Math.max(nCoupled, nLaunch);
      tTarget = (fTarget * r) / (ratio * eta);
      coupled = true;
    }
    if (!this.on || !firing) tTarget = 0;
    const tMaxNow = Math.max(1, this.tMax(Math.max(es0.rpm, idle)));
    const err = (tTarget - Math.max(0, es0.torqueNm)) / tMaxNow;
    this.eI = tTarget > 0 ? clamp(this.eI + 3 * err * dt, -0.5, 0.6) : 0;
    this.ePedal = tTarget >= 0.99 * this.tMax(targetRpm) ? 1 : clamp(tTarget / tMaxNow + this.eI, 0, 1);
    // --- start: the motor (MG1 / P2 / belt) cranks the engine; short delay until it fires [§3.5]
    if (this.on && !firing) this.startT += dt;
    const starter = this.on && !firing && this.startT < 2;
    // clutch closed above the launch speed: the crank turns with the gearbox input shaft
    if (coupled && geared && nCoupled >= nLaunch && nCoupled <= lim) this.engine.syncRpm(nCoupled);
    const es = this.engine.step(dt, {
      ...input, vehicle: undefined, ignition: this.on, starter, pedal: coupled || (topo === "series" && this.on && firing) ? this.ePedal : 0,
      dynoMode: coupled || (this.on && firing && topo === "series") ? "hold-rpm" : "free", dynoTargetRpm: Math.min(targetRpm, 0.97 * lim),
    });
    // --- engine torque to the wheels and generator power to the bus
    const tE = es.running ? es.torqueNm : 0;
    const wE = es.rpm / RPM;
    const pEng = Math.max(0, tE * wE);
    let refNm = 0;
    let dcKw = 0;
    let toWheelW = 0;
    const shaft = this.shaft;
    if (topo === "series") dcKw = es.running ? (-pEng * GEN_EFFICIENCY) / 1000 : 0;
    else if (topo === "power-split" && coupled) {
      const tRing = ringK * Math.max(0, tE);
      refNm = tRing / shaft.ratio;
      toWheelW = (tRing * eta * v) / r;
      // what does not go mechanically to the ring goes through MG1 to the DC bus (− charges) [§2.2]
      const rest = pEng - tRing * (wheelRpm / RPM);
      dcKw = (rest > 0 ? -rest * GEN_EFFICIENCY : -rest / GEN_EFFICIENCY) / 1000;
    } else if (geared && coupled && nCoupled <= lim) {
      // above the limiter in top gear the engine cuts (no torque through a locked clutch)
      refNm = tE / belt;
      toWheelW = (tE * ratio * eta * v) / r;
    }
    const fE = (refNm * shaft.ratio * eta) / r;
    L.refNm = refNm;
    L.dcKw = dcKw;
    // --- motor: what the engine does not deliver (boost +, load-point shift −); SoC window [§3.2, §3.6]
    let dem = drive ? want - fE : 0;
    if (topo === "mild" && !es.running) dem = Math.min(dem, 0);
    if (soc < hy.socMin - 0.03) dem = Math.min(dem, 0);
    L.demandN = drive ? dem : null;
    L.chargeShare = clamp((hy.socMax + 0.03 - soc) / 0.03, 0, 1);
    // the hybrid modes replace the EV drive modes: the motors may use their full envelope
    const s = super.step(dt, { ...input, evDriveMode: "plaid" });
    const out: EngineState = {
      ...s,
      torqueNm: s.torqueNm,
      powerKw: s.powerKw + toWheelW / 1000,
      fuelFlowLh: es.fuelFlowLh, fuelMassFlowGS: es.fuelMassFlowGS, airMassFlowKgS: es.airMassFlowKgS, lambda: es.lambda,
      bsfcGkWh: es.bsfcGkWh, egtC: es.egtC, coolantC: es.coolantC, oilC: es.oilC, oilPressureBar: es.oilPressureBar,
      starterEngaged: es.starterEngaged, afterfire: es.afterfire, damage: es.damage, catalystC: es.catalystC,
      warnings: [...s.warnings, ...es.warnings],
    };
    const wheelKw = (s.ev ? (s.ev.frontNm + s.ev.rearNm) * (v / r) / 1000 : 0) + toWheelW / 1000;
    this.hs = {
      mode, topology: topo, engineOn: es.running, engineStarting: starter, engineCoupled: coupled && es.running, evDrive: ready && !es.running && topo !== "mild",
      engineRpm: es.rpm, engineKw: pEng / 1000, engineToWheelKw: toWheelW / 1000, batteryKw: s.ev?.powerKw ?? 0, motorKw: s.ev?.motorKw ?? 0,
      wheelKw, fuelLh: es.fuelFlowLh, gear: geared ? this.eGear : 1, engine: es,
    };
    out.hybrid = this.hs;
    return this.replace(out);
  }

  /**
   * Engine and chassis dynos without a vehicle: Ready starts the combustion engine, which runs on the brake as on the
   * engine bench; the motors stand (the E-Tuner measures them). The battery keeps its charge.
   */
  private benchStep(dt: number, input: SimInputs): EngineState {
    Object.assign(this.link, { demandN: null, refNm: 0, dcKw: 0, chargeShare: 1 });
    const s = super.step(dt, { ...input, pedal: 0, dynoMode: "free" });
    const e0 = this.engine.state;
    this.on = !!input.ignition;
    const es = this.engine.step(dt, { ...input, starter: this.on && !e0.running && e0.rpm < 0.8 * this.engine.config.idleRpm });
    const hs: HybridState = {
      mode: input.hybridMode ?? "hybrid", topology: this.hy.topology, engineOn: es.running, engineStarting: es.starterEngaged, engineCoupled: false,
      evDrive: false, engineRpm: es.rpm, engineKw: Math.max(0, es.powerKw), engineToWheelKw: 0, batteryKw: s.ev?.powerKw ?? 0, motorKw: 0, wheelKw: 0,
      fuelLh: es.fuelFlowLh, gear: 1, engine: es,
    };
    this.hs = hs;
    return this.replace({ ...es, ev: s.ev, hybrid: hs });
  }
}
