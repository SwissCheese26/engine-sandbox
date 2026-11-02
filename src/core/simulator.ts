/**
 * Real-time transient simulator (mean value engine model with crank train dynamics).
 * docs/research/diesel.md §3.11 (inertia, starter, idle governor, stall), petrol.md §3.3 (manifold filling),
 * §3.6 (knock control), §3.4 (overrun fuel cut). Turbo, thermal and limits via subsystems.ts (issue #4).
 * Fixed internal step of 1 ms for the fast states (crank speed, manifold pressure, controllers);
 * turbo, thermal and limits are advanced once per call (they sub-step internally). No DOM.
 */
import { R_AIR, throttlePsi, volumetricEfficiency } from "./airpath.ts";
import { dieselFires } from "./combustion-diesel.ts";
import { evaluateCycle, fullLoadAt, getModel, manifoldTempK, newOpPoint, steadyFullLoad } from "./cycle.ts";
import type { CycleOut, Model, OpPoint } from "./cycle.ts";
import { meanPistonSpeed } from "./geometry.ts";
import { createLimitTracker, evaluateLimits, oilPressureBar, stepThermal, stepTurbo, turboMaxRpm } from "./subsystems.ts";
import type { LimitTracker, ThermalState, TurboState } from "./subsystems.ts";
import type { EngineConfig, EngineState, SimInputs, Warning } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const fin = (x: number, fallback: number) => (Number.isFinite(x) ? x : fallback);
const RPM_PER_RADS = 30 / Math.PI;
const H = 0.001; // internal step [s]
/** Largest dt handled per call; longer frames (tab in background) are clamped. */
const MAX_DT = 0.25;

interface Internal {
  rpm: number;
  crank: number;
  pManKpa: number;
  turbo: TurboState;
  thermal: ThermalState;
  knockRetard: number;
  idleI: number;
  dynoI: number;
  running: boolean;
  /** Engine may combust: armed by the starter, cleared by stall / ignition off / damage. */
  armed: boolean;
  stallT: number;
  stalled: boolean;
  limiterCut: boolean;
  relLoad: number;
  load: number;
  initialised: boolean;
  wear: number;
  destroyed: boolean;
}

/** Steady idle command (feed-forward for the idle governor) found by bisection at warm conditions. */
function idleFeedForward(m: Model): number {
  const cfg = m.cfg;
  const op = newOpPoint();
  op.rpm = cfg.idleRpm;
  op.loadPrev = 0;
  op.TManK = manifoldTempK(m, 0, 20);
  let lo = 0;
  let hi = m.fuel === "diesel" ? 1 : 0.5;
  for (let i = 0; i < 30; i++) {
    const u = 0.5 * (lo + hi);
    setCommand(m, op, u, 0, cfg.idleRpm, op.TManK);
    const o = evaluateCycle(m, op);
    if (o.torqueNm > 0) hi = u;
    else lo = u;
  }
  return 0.5 * (lo + hi);
}

/** Petrol: steady manifold pressure for throttle φ (used for feed-forward only). */
function setCommand(m: Model, op: OpPoint, u: number, boostBar: number, rpm: number, TManK: number) {
  if (m.fuel === "diesel") {
    op.fuelCmd = u;
    op.pManKpa = op.ambientKpa - 2 + 100 * boostBar;
  } else {
    const pUp = op.ambientKpa - 2 + 100 * boostBar;
    const veEff = volumetricEfficiency(m.ve, Math.max(rpm, 50), TManK);
    const a = (u * m.throttleA0) / (veEff * Math.max(rpm, 50));
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = 0.5 * (lo + hi);
      if (a * throttlePsi(mid) > mid) lo = mid;
      else hi = mid;
    }
    op.pManKpa = pUp * 0.5 * (lo + hi);
    op.relLoad = clamp((op.pManKpa / pUp) * 0.9, 0, 1);
  }
}

export class EngineSimulator {
  private s!: EngineState;
  private x!: Internal;
  private m!: Model;
  private tracker: LimitTracker = createLimitTracker();
  private op: OpPoint = newOpPoint();
  private idleU0 = 0.1;
  private lastOut: CycleOut | null = null;
  private stallWarn: Warning = { code: "stall", severity: "warning", message: "Motor abgewürgt" };

  constructor(public config: EngineConfig) {
    this.init();
  }

  setConfig(cfg: EngineConfig) {
    this.config = cfg;
    this.init();
  }

  reset() {
    this.tracker = createLimitTracker();
    const amb = 20;
    this.x = {
      rpm: 0, crank: 0, pManKpa: 101.325, turbo: { shaftRpm: 0, boostBar: 0 },
      thermal: { coolantC: amb, oilC: amb, egtC: amb }, knockRetard: 0, idleI: this.idleU0, dynoI: 0,
      running: false, armed: false, stallT: 0, stalled: false, limiterCut: false, relLoad: 0, load: 0,
      initialised: false, wear: 0, destroyed: false,
    };
    this.lastOut = null;
    this.s = {
      t: 0, running: false, destroyed: false, rpm: 0, crankAngleDeg: 0, torqueNm: 0, powerKw: 0, imepBar: 0, bmepBar: 0,
      fmepBar: 0, load: 0, manifoldAbsKpa: 101.325, boostBar: 0, turboRpm: 0, airMassFlowKgS: 0, fuelMassFlowGS: 0,
      fuelFlowLh: 0, bsfcGkWh: Number.NaN, efficiency: 0, lambda: this.config.fuel === "diesel" ? 99 : 1, egtC: amb,
      coolantC: amb, oilC: amb, oilPressureBar: 0, peakPressureBar: 0, meanPistonSpeedMs: 0, knock: 0, smoke: 0, wear: 0,
      warnings: [], damage: [], starterEngaged: false,
    };
  }

  get state(): EngineState {
    return this.s;
  }

  private init() {
    this.m = getModel(this.config);
    fullLoadAt(this.m, this.config.idleRpm); // fill the full-load table once
    this.idleU0 = idleFeedForward(this.m);
    this.reset();
  }

  step(dtIn: number, input: SimInputs): EngineState {
    const dt = clamp(fin(dtIn, 0), 0, MAX_DT);
    const cfg = this.config;
    const m = this.m;
    const x = this.x;
    const ambientC = fin(input.ambientC, 20);
    const ambientKpa = clamp(fin(input.ambientKpa, 101.325), 30, 120);
    if (!x.initialised) {
      // lead decision: temperatures start at the ambient of the first step after reset()
      x.thermal = { coolantC: ambientC, oilC: ambientC, egtC: ambientC };
      x.pManKpa = ambientKpa;
      x.initialised = true;
    }
    const s: EngineState = { ...this.s, warnings: this.s.warnings, damage: this.s.damage };
    if (dt <= 0) return (this.s = s);
    const pedal = clamp(fin(input.pedal, 0), 0, 1);
    const starter = !!input.starter && !x.destroyed;
    const ignition = !!input.ignition && !x.destroyed;
    if (!ignition) {
      x.armed = false;
      x.running = false;
      x.stalled = false;
    }
    if (starter && ignition) {
      x.armed = true;
      x.stalled = false;
    }
    const op = this.op;
    op.ambientKpa = ambientKpa;
    op.TambK = ambientC + 273.15;
    op.coolantC = x.thermal.coolantC;
    op.oilC = x.thermal.oilC;
    op.boostBar = x.turbo.boostBar;
    const TManK = manifoldTempK(m, x.turbo.boostBar, ambientC);
    op.TManK = TManK;
    const pUpKpa = ambientKpa - 2 + 100 * x.turbo.boostBar;
    const Vl = m.Vh * 1000;
    const T0 = 80 + 60 * Vl; // starter torque at standstill (diesel.md §3.11)
    const idle = cfg.idleRpm;
    const peakBrake = 5 * fullLoadAt(m, cfg.revLimitRpm * 0.6).torque + 200;
    const kpDyno = m.J * 0.105 * 30; // Nm/rpm, ≈ 30 rad/s bandwidth
    const kiDyno = kpDyno * 8;
    const nSub = Math.max(1, Math.round(dt / H));
    const h = dt / nSub;
    let out: CycleOut | null = this.lastOut;
    let brake = 0;
    let tOutSum = 0;
    let fuelSum = 0;
    let airSum = 0;
    let anyFire = false;
    for (let i = 0; i < nSub; i++) {
      const rpm = x.rpm;
      // --- combustion permission
      let combust = ignition && x.armed && !x.stalled;
      if (combust && m.d) combust = dieselFires(m.d, rpm, TManK, x.thermal.coolantC);
      if (combust && m.p) combust = rpm > 80;
      // --- rev limiter: petrol hard cut with hysteresis (stutter), diesel governor ramp + hard cut safeguard
      if (m.fuel === "petrol") {
        if (rpm > cfg.revLimitRpm) x.limiterCut = true;
        else if (rpm < cfg.revLimitRpm - 150) x.limiterCut = false;
      } else {
        if (rpm > cfg.revLimitRpm + 150) x.limiterCut = true;
        else if (rpm < cfg.revLimitRpm) x.limiterCut = false;
      }
      // overrun fuel cut (petrol.md §3.4), diesel: zero quantity anyway at zero pedal above idle
      const overrun = pedal < 0.01 && rpm > idle + 300 && x.running;
      // --- idle governor (PI, diesel.md §3.11), acts as a minimum command
      const e = (idle - rpm) / idle;
      const uMaxIdle = m.fuel === "diesel" ? 0.6 : 0.3;
      if (combust) x.idleI = clamp(x.idleI + 3 * this.idleU0 * e * h, 0, uMaxIdle);
      const uIdle = clamp(x.idleI + 4 * this.idleU0 * e, 0, uMaxIdle);
      op.rpm = rpm;
      op.knockRetardDeg = x.knockRetard;
      op.combust = combust;
      op.fuelCut = x.limiterCut || (overrun && m.fuel === "petrol");
      op.loadPrev = x.load;
      op.cranking = starter;
      op.egrRate = cfg.exhaust.egr && rpm < 3000 && x.running ? 0.35 * (1 - x.load) * clamp(x.thermal.coolantC / 60, 0, 1) : 0;
      if (m.fuel === "diesel") {
        op.pManKpa = pUpKpa;
        x.pManKpa = pUpKpa;
        op.fuelCmd = Math.max(pedal, uIdle);
        op.relLoad = op.fuelCmd;
      } else {
        // throttle (petrol.md §3.3): φ = φidle + (1 − φidle)·pedal^1.8, manifold filling, semi-implicit
        const phi = uIdle + (1 - uIdle) * Math.pow(pedal, 1.8);
        const veEff = volumetricEfficiency(m.ve, Math.max(rpm, 30), TManK);
        const k = (R_AIR * TManK) / m.VMan / 1000; // kPa per kg
        const cTh = (phi * m.throttleA0 * m.Vh) / (120 * R_AIR * TManK); // kg/(s·kPa) · ψ
        const cEng = (veEff * m.Vh * Math.max(rpm, 0)) / 120 / (R_AIR * TManK) * 1000; // kg/s per kPa
        const mTh = cTh * 1000 * pUpKpa * throttlePsi(clamp(x.pManKpa / pUpKpa, 0, 1));
        // reverse flow when the manifold is above the upstream pressure (boost collapse)
        const back = x.pManKpa > pUpKpa ? (x.pManKpa - pUpKpa) * cTh * 1000 * 5 : 0;
        x.pManKpa = (x.pManKpa + k * (mTh - back) * h) / (1 + k * cEng * h);
        x.pManKpa = clamp(x.pManKpa, 5, pUpKpa + 5);
        op.pManKpa = x.pManKpa;
        op.relLoad = x.relLoad;
      }
      out = evaluateCycle(m, op);
      // --- knock control (petrol.md §3.6): fast retard 30 °/s, slow advance 1 °/s
      if (m.p) {
        const need = out.mFuelCyc > 0 ? clamp(-out.knockMargin / 0.8, 0, m.p.maxRetard) : x.knockRetard;
        x.knockRetard = need > x.knockRetard ? Math.min(need, x.knockRetard + 30 * h) : Math.max(need, x.knockRetard - 1 * h);
        const full = fullLoadAt(m, rpm).air;
        x.relLoad = clamp(out.mAirCyc / full, 0, 1.2);
      }
      // --- torques on the crank (diesel.md §3.11: J·dω/dt = T − T_brake − T_starter,loss)
      const tStarter = starter ? T0 * Math.max(0, 1 - rpm / 400) : 0;
      if (input.dynoMode === "hold-rpm") {
        const err = rpm - fin(input.dynoTargetRpm, 2000);
        x.dynoI = clamp(x.dynoI + kiDyno * err * h, 0, peakBrake);
        brake = clamp(kpDyno * err + x.dynoI, 0, peakBrake);
      } else if (input.dynoMode === "torque") {
        x.dynoI = 0;
        // eddy-current brake: no torque at standstill
        brake = Math.max(0, fin(input.dynoBrakeTorqueNm, 0)) * clamp(rpm / 300, 0, 1);
      } else {
        x.dynoI = 0;
        brake = 0;
      }
      const net = out.torqueNm + tStarter - brake;
      let omega = x.rpm / RPM_PER_RADS + (net / m.J) * h;
      if (omega < 0) omega = 0;
      x.rpm = omega * RPM_PER_RADS;
      x.crank = (x.crank + x.rpm * 6 * h) % 720;
      tOutSum += out.torqueNm;
      fuelSum += out.fuelMassFlowGS;
      airSum += out.airMassFlowKgS;
      if (out.mFuelCyc > 0) anyFire = true;
      // --- running / stall (diesel.md §3.11: rpm < 0.5·idle without starter → stall)
      if (combust && out.mFuelCyc > 0 && x.rpm > 0.6 * idle) x.running = true;
      if (x.running && !starter && x.rpm < 0.5 * idle) {
        x.stallT += h;
        if (x.stallT > 0.2) {
          x.running = false;
          x.stalled = ignition;
          x.armed = false;
        }
      } else x.stallT = 0;
    }
    this.lastOut = out;
    if (!out) return (this.s = s);
    const rpm = x.rpm;
    const torque = tOutSum / nSub;
    const fuelGs = fuelSum / nSub;
    // --- turbo (PR #12 stepTurbo): pedal demand; idle governor fuel does not demand boost
    x.turbo = stepTurbo(x.turbo, cfg, dt, out.exhaustMassFlowKgS, x.thermal.egtC, x.running ? pedal : 0, rpm, ambientKpa);
    if (!Number.isFinite(x.turbo.boostBar) || !Number.isFinite(x.turbo.shaftRpm)) x.turbo = { shaftRpm: 0, boostBar: 0 };
    // --- thermal (PR #12 stepThermal)
    x.thermal = stepThermal(x.thermal, cfg, dt, out.heatToCoolantKw, out.egtC, rpm, ambientC);
    if (!Number.isFinite(x.thermal.coolantC + x.thermal.oilC + x.thermal.egtC)) x.thermal = { coolantC: ambientC, oilC: ambientC, egtC: ambientC };
    const full = fullLoadAt(m, Math.max(rpm, 300)).torque;
    x.load = clamp(torque / Math.max(1, full), 0, 1);
    const powerKw = (torque * rpm * Math.PI) / 30 / 1000;
    s.t = this.s.t + dt;
    s.rpm = rpm;
    s.crankAngleDeg = x.crank;
    s.running = x.running;
    s.starterEngaged = starter;
    s.torqueNm = torque;
    s.powerKw = powerKw;
    s.imepBar = out.imepBar;
    s.fmepBar = out.fmepBar + out.pmepBar;
    s.bmepBar = out.bmepBar;
    s.load = x.load;
    s.manifoldAbsKpa = x.pManKpa;
    s.boostBar = x.turbo.boostBar;
    s.turboRpm = x.turbo.shaftRpm;
    s.airMassFlowKgS = airSum / nSub;
    s.fuelMassFlowGS = fuelGs;
    s.fuelFlowLh = (fuelGs * 3.6) / out.fuelDensity;
    s.bsfcGkWh = powerKw > 0.5 ? (fuelGs * 3600) / powerKw : Number.NaN;
    s.efficiency = powerKw > 0.5 && fuelGs > 0 ? (powerKw * 1000) / ((fuelGs / 1000) * out.fuelLhv) : 0;
    s.lambda = anyFire ? clamp(out.lambda, 0.3, 99) : m.fuel === "diesel" ? 99 : 99;
    s.egtC = x.thermal.egtC;
    s.coolantC = x.thermal.coolantC;
    s.oilC = x.thermal.oilC;
    s.oilPressureBar = oilPressureBar(cfg, rpm, x.thermal.oilC);
    s.peakPressureBar = out.peakPressureBar;
    s.meanPistonSpeedMs = meanPistonSpeed(cfg.block.strokeMm, rpm);
    s.knock = m.fuel === "petrol" ? out.knock : 0;
    s.smoke = m.fuel === "diesel" ? out.smoke : 0;
    // --- limits (PR #12 evaluateLimits): warnings, wear, fatal damage
    const lim = evaluateLimits(cfg, s, this.tracker);
    x.wear = clamp(x.wear + lim.wearRatePerS * dt, 0, 1);
    s.wear = x.wear;
    s.warnings = x.stalled && rpm < 0.5 * idle ? [...lim.warnings, this.stallWarn] : lim.warnings;
    if (lim.fatal && !x.destroyed) {
      x.destroyed = true;
      x.running = false;
      x.armed = false;
      s.damage = [...this.s.damage, lim.fatal];
    }
    s.destroyed = x.destroyed;
    if (x.destroyed) s.running = false;
    void turboMaxRpm;
    void steadyFullLoad;
    this.s = s;
    return s;
  }
}
