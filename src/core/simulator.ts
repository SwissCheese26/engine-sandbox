/**
 * Real-time transient simulator (mean value engine model with crank train dynamics).
 * docs/research/diesel.md §3.11 (inertia, starter, idle governor, stall), petrol.md §3.3 (manifold filling),
 * §3.6 (knock control), §3.4 (overrun fuel cut). Turbo, thermal and limits via subsystems.ts (issue #4).
 * Fixed internal step of 1 ms for the fast states (crank speed, manifold pressure, controllers);
 * turbo, thermal and limits are advanced once per call (they sub-step internally). No DOM.
 */
import { R_AIR, steadyManifoldRatio, throttlePsi, volumetricEfficiency } from "./airpath.ts";
import { dieselFires } from "./combustion-diesel.ts";
import { chokeLimitedUpKpa, evaluateCycle, fullLoadAt, getModel, knockBoostCutBar, manifoldTempK, newOpPoint, torqueLimitCaps } from "./cycle.ts";
import type { CycleOut, Model, OpPoint } from "./cycle.ts";
import { meanPistonSpeed } from "./geometry.ts";
import { createLimitTracker, evaluateLimits, oilPressureBar, stepThermal, stepTurbo } from "./subsystems.ts";
import type { LimitTracker, ThermalState, TurboState } from "./subsystems.ts";
import { isAirCooled } from "./thermal.ts";
import { PEAK_SLIP, tyreForceFactor } from "./tyres.ts";
import { drivenAxleLoadN, wheelieLimitN } from "./vehicle.ts";
import type { EngineConfig, EngineState, SimInputs, VehicleCoupling, Warning } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const fin = (x: number, fallback: number) => (Number.isFinite(x) ? x : fallback);
const RPM_PER_RADS = 30 / Math.PI;
const H = 0.001; // internal step [s]
/** Largest dt handled per call; longer frames (tab in background) are clamped. */
const MAX_DT = 0.25;

/**
 * Overrun afterfire calibrations (issue #16) [S, tuner maps]: fuel share of the stoichiometric air charge and the
 * intensity handed to the sound engine. Active above idle + 500 1/min, faded in over the next 500 1/min.
 */
/**
 * `throttle`: pops maps crack the throttle open in overrun so there is oxygen for the afterfire, expressed as a
 * multiple of the idle throttle feed-forward (less engine braking as a side effect, as on real pops maps).
 */
const POPS: Record<"mild" | "popcorn" | "brutal", { fuel: number; intensity: number; throttle: number }> = {
  mild: { fuel: 0.17, intensity: 0.35, throttle: 0.6 },
  popcorn: { fuel: 0.25, intensity: 0.65, throttle: 1.0 },
  brutal: { fuel: 0.4, intensity: 1, throttle: 1.5 },
};
/** Catalyst substrate temperature from which ageing accelerates sharply [S: cordierite/washcoat ≈ 900 … 1000 °C]. */
const CAT_OVERHEAT_C = 900;

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
  boostCut: number;
  relLoad: number;
  load: number;
  initialised: boolean;
  wear: number;
  destroyed: boolean;
  /** Vehicle speed m/s (dynoMode "vehicle"). */
  vSpeed: number;
  /** Catalyst substrate temperature °C (issue #16, only tracked with exhaust.catalyst). */
  catC: number;
  /** Issue #22: driven-wheel circumferential speed m/s, wheel spin / locked flags, last tyre force and acceleration. */
  vWheel: number;
  spin: boolean;
  locked: boolean;
  tyreF: number;
  aLong: number;
  /**
   * Issue #23: circumferential speed of the braked wheels (lumped, all four), m/s; ABS brake force N (the modulated
   * pressure), the force at the last pressure release, release phase flag, time since the last ABS cycle, cycle counter.
   */
  vBrk: number;
  absF: number;
  absRef: number;
  absRelease: boolean;
  absT: number;
  absCycles: number;
  grip: number;
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

  /**
   * Replaces the configuration and resets the engine. Configs are treated as immutable: derived model data is
   * cached per config object, so pass a new object (e.g. structuredClone) instead of mutating the old one.
   */
  setConfig(cfg: EngineConfig) {
    this.config = cfg;
    this.init();
  }

  /** Vehicle back to standstill (chassis dyno), engine state untouched. */
  resetVehicle() {
    Object.assign(this.x, { vSpeed: 0, vWheel: 0, spin: false, locked: false, tyreF: 0, aLong: 0, vBrk: 0, absF: 0, absRelease: false, absT: 9 });
  }

  reset() {
    this.tracker = createLimitTracker();
    const amb = 20;
    this.x = {
      rpm: 0, crank: 0, pManKpa: 101.325, turbo: { shaftRpm: 0, boostBar: 0 },
      thermal: { coolantC: amb, oilC: amb, egtC: amb }, knockRetard: 0, idleI: this.idleU0, dynoI: 0,
      running: false, armed: false, stallT: 0, stalled: false, limiterCut: false, relLoad: 0, load: 0, boostCut: 0,
      initialised: false, wear: 0, destroyed: false, vSpeed: 0, catC: amb, vWheel: 0, spin: false, locked: false, tyreF: 0, aLong: 0,
      vBrk: 0, absF: 0, absRef: 0, absRelease: false, absT: 9, absCycles: 0, grip: 1,
    };
    this.lastOut = null;
    this.s = {
      t: 0, running: false, destroyed: false, rpm: 0, crankAngleDeg: 0, torqueNm: 0, powerKw: 0, imepBar: 0, bmepBar: 0,
      fmepBar: 0, load: 0, manifoldAbsKpa: 101.325, boostBar: 0, turboRpm: 0, airMassFlowKgS: 0, fuelMassFlowGS: 0,
      fuelFlowLh: 0, bsfcGkWh: Number.NaN, efficiency: 0, lambda: this.config.fuel === "diesel" ? 99 : 1, egtC: amb,
      coolantC: amb, oilC: amb, oilPressureBar: 0, peakPressureBar: 0, meanPistonSpeedMs: 0, knock: 0, smoke: 0, wear: 0,
      warnings: [], damage: [], starterEngaged: false, afterfire: 0, torqueLimited: false,
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
      // lead decision: temperatures start at the ambient of the first step after reset();
      // "warm start" (Arthur's wish): engine at operating temperature, exhaust manifold still warm
      x.thermal = input.startWarm
        ? { coolantC: Math.max(ambientC, isAirCooled(cfg) ? 140 : cfg.cooling.thermostatOpenC), oilC: Math.max(ambientC, 90), egtC: Math.max(ambientC, 150) }
        : { coolantC: ambientC, oilC: ambientC, egtC: ambientC };
      x.pManKpa = ambientKpa;
      x.catC = x.thermal.egtC;
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
    // air cooling (#25): the state holds the head temperature, which runs ≈ 90 K above a coolant jacket; the
    // combustion model (warm-up enrichment, knock) expects a coolant-equivalent temperature [S]
    op.coolantC = isAirCooled(cfg) ? Math.max(Math.min(x.thermal.coolantC, ambientC), x.thermal.coolantC - 90) : x.thermal.coolantC;
    op.oilC = x.thermal.oilC;
    op.boostBar = x.turbo.boostBar;
    const TManK = manifoldTempK(m, x.turbo.boostBar, ambientC);
    op.TManK = TManK;
    // knock control boost cut (petrol.md §3.6) acts on the wastegate: follows with τ ≈ 0.3 s
    x.boostCut += (knockBoostCutBar(m, x.knockRetard) - x.boostCut) * (1 - Math.exp(-dt / 0.3));
    const pUpKpa = chokeLimitedUpKpa(m, ambientKpa - 2 + 100 * Math.max(0, x.turbo.boostBar - x.boostCut), x.rpm, TManK, ambientKpa);
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
    let fuelCycSum = 0;
    let afterfireSum = 0;
    let afFuelSum = 0;
    let limitedAny = false;
    const pops = m.p && cfg.exhaust.overrunPops && cfg.exhaust.overrunPops !== "off" ? POPS[cfg.exhaust.overrunPops] : null;
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
      // all-speed governor: may command the full quantity to avoid stalling (diesel); petrol idle valve ≤ 30 %
      const uMaxIdle = m.fuel === "diesel" ? 1 : 0.3;
      // gains relative to the idle feed-forward; diesel with an extra absolute anti-stall share [S]
      const kp = m.fuel === "diesel" ? 4 * this.idleU0 + 1.5 : 4 * this.idleU0;
      const ki = m.fuel === "diesel" ? 3 * this.idleU0 + 1.0 : 3 * this.idleU0;
      if (combust) x.idleI = clamp(x.idleI + ki * e * h, 0, uMaxIdle);
      const uIdle = clamp(x.idleI + kp * e, 0, uMaxIdle);
      op.rpm = rpm;
      // petrol idle torque reserve (review #17 B3) [S]: the ECU idles ≈ 15 °CA retarded from MBT so that
      // spark advance can catch load steps instantly; fades out over 300 rpm above idle / with pedal.
      const reserve = m.p && x.running ? 15 * clamp(1 - pedal / 0.05, 0, 1) * clamp(1 - (rpm - idle) / 300, 0, 1) : 0;
      op.knockRetardDeg = x.knockRetard + reserve;
      op.combust = combust;
      op.fuelCut = x.limiterCut || (overrun && m.fuel === "petrol");
      // pops & bangs (issue #16): in overrun (pedal 0, rpm > idle + 500) a little fuel with very late spark instead
      // of the full fuel cut; never on the rev limiter and only with a running, firing engine
      const popW = pops && overrun && !x.limiterCut && combust ? clamp((rpm - idle - 500) / 500, 0, 1) : 0;
      op.afterfireFuel = pops ? pops.fuel * popW : 0;
      afterfireSum += pops ? pops.intensity * popW : 0;
      // ECU torque limit (issue #18): quantity cap (diesel) / manifold pressure cap (petrol) from the steady table
      const caps = torqueLimitCaps(m, rpm);
      op.fuelCapKg = caps.fuelKg;
      op.loadPrev = x.load;
      op.cranking = starter;
      // diesel.md §3.1 EGR, part load only. Load taken from the fuel command (the ECU closes the valve as soon as
      // the driver asks for torque); shape (1 − load)³ instead of (1 − load) [S, PR] so that λ stays > 2.5 at 25 % load.
      const uCmd = Math.max(pedal * (2 - pedal), uIdle);
      op.egrRate = m.d && cfg.exhaust.egr && rpm < 3000 && x.running ? 0.35 * (1 - Math.min(1, Math.max(x.load, uCmd))) ** 3 * clamp(x.thermal.coolantC / 60, 0, 1) : 0;
      if (m.fuel === "diesel") {
        op.pManKpa = pUpKpa;
        x.pManKpa = pUpKpa;
        // progressive pedal map (pedal → torque request, typical diesel ECU) [S]: 50 % pedal = 75 % quantity
        op.fuelCmd = Math.max(pedal * (2 - pedal), uIdle);
        op.relLoad = op.fuelCmd;
      } else {
        // throttle (petrol.md §3.3): φ = φidle + (1 − φidle)·pedal^1.8, manifold filling, semi-implicit
        const phi = Math.max(uIdle + (1 - uIdle) * Math.pow(pedal, 1.8), pops ? pops.throttle * this.idleU0 * popW : 0);
        const veEff = volumetricEfficiency(m.ve, Math.max(rpm, 30), TManK);
        const k = (R_AIR * TManK) / m.VMan / 1000; // kPa per kg
        const cTh = (phi * m.throttleA0 * m.Vh) / (120 * R_AIR * TManK); // kg/(s·kPa) · ψ
        const cEng = (veEff * m.Vh * Math.max(rpm, 0)) / 120 / (R_AIR * TManK) * 1000; // kg/s per kPa
        // Filling/emptying of the manifold (petrol.md §3.3 mass balance) solved as first-order relaxation to the
        // throttle/engine flow equilibrium with the linearised time constant VMan/(R·T·(c_eng + c_throttle)).
        // Unconditionally stable (explicit Euler oscillated with ITB plenums at high rpm, review of #17).
        let pSteady = pUpKpa * (cEng > 0 ? steadyManifoldRatio((cTh * 1000) / cEng, 1) : 1);
        // ECU torque limit (issue #18): throttle / wastegate hold the manifold pressure at the cap
        if (pSteady > caps.pManKpa) {
          pSteady = caps.pManKpa;
          limitedAny = true;
        }
        const tau = 1 / (k * (cEng + cTh * 1000));
        x.pManKpa += (pSteady - x.pManKpa) * (1 - Math.exp(-h / tau));
        x.pManKpa = clamp(x.pManKpa, 5, pUpKpa + 5);
        op.pManKpa = x.pManKpa;
        op.relLoad = x.relLoad;
      }
      out = evaluateCycle(m, op);
      if (m.d && out.mFuelCyc >= op.fuelCapKg * 0.999) limitedAny = true;
      if (op.afterfireFuel > 0) afFuelSum += out.mFuelCyc;
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
      const veh = input.dynoMode === "vehicle" ? input.vehicle : undefined;
      if (veh) {
        // ASR ignition retard (issue #23): petrol engines lose torque within one firing when the spark is retarded
        // (≈ 3–4 %/°CA, up to ≈ 60 % with 15–20 °CA retard; Bosch, Gasoline Engine Management, "torque-based ECU") [S]
        const cut = m.p && out.torqueNm > 0 ? clamp(fin(veh.torqueCut ?? 0, 0), 0, 0.7) : 0;
        stepVehicle(x, veh, out.torqueNm * (1 - cut) + tStarter, m.J, h);
      } else {
        const net = out.torqueNm + tStarter - brake;
        let omega = x.rpm / RPM_PER_RADS + (net / m.J) * h;
        if (omega < 0) omega = 0;
        x.rpm = omega * RPM_PER_RADS;
      }
      x.crank = (x.crank + x.rpm * 6 * h) % 720;
      tOutSum += out.torqueNm;
      fuelSum += out.fuelMassFlowGS;
      airSum += out.airMassFlowKgS;
      if (out.mFuelCyc > 0) anyFire = true;
      fuelCycSum += out.mFuelCyc;
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
    // Boost request from the actual load, not the pedal (review #17 B2): diesel from the injected quantity
    // relative to the (ungoverned) full-load quantity, petrol from the torque load (×1.1 so full load demands
    // the full target), capped by the pedal. Free revving without brake (torque ≈ 0 at the limiter) builds
    // almost no boost; under load the turbo still lags physically.
    let boostReq = 0;
    if (x.running) {
      boostReq = m.fuel === "diesel"
        ? clamp(fuelCycSum / nSub / Math.max(1e-9, out.mFuelMax), 0, 1)
        : Math.min(pedal, clamp(1.1 * x.load, 0, 1));
      // ECU torque limit (issue #18): the boost target follows the manifold pressure cap (+3 % throttle reserve)
      const capP = torqueLimitCaps(m, rpm).pManKpa;
      if (m.p && m.exhaustDriven && Number.isFinite(capP) && cfg.induction.boostTargetBar > 0) {
        boostReq = Math.min(boostReq, clamp((capP * 1.03 - ambientKpa + 2) / 100 / cfg.induction.boostTargetBar, 0, 1));
      }
    }
    x.turbo = stepTurbo(x.turbo, cfg, dt, out.exhaustMassFlowKgS, x.thermal.egtC, boostReq, rpm, ambientKpa);
    if (!Number.isFinite(x.turbo.boostBar) || !Number.isFinite(x.turbo.shaftRpm)) x.turbo = { shaftRpm: 0, boostBar: 0 };
    // --- thermal (PR #12 stepThermal)
    x.thermal = stepThermal(x.thermal, cfg, dt, out.heatToCoolantKw, out.egtC, rpm, ambientC, input.dynoMode === "vehicle" ? x.vSpeed : 0);
    if (!Number.isFinite(x.thermal.coolantC + x.thermal.oilC + x.thermal.egtC)) x.thermal = { coolantC: ambientC, oilC: ambientC, egtC: ambientC };
    // --- catalyst temperature (issue #16) [S]: substrate follows the exhaust gas with τ ≈ 6 s; afterfire fuel that
    // did not burn in the manifold (≈ 15 %, cycle.ts) oxidises in the catalyst: ΔT = 0.15·ṁF·Hu/(ṁ·cp)
    const afterfire = afterfireSum / nSub;
    let catOver = false;
    if (cfg.exhaust.catalyst) {
      const afFuel = (afFuelSum / nSub) * (rpm / 120);
      const exo = afFuel > 0 && out.exhaustMassFlowKgS > 1e-6 ? (0.15 * afFuel * out.fuelLhv) / (out.exhaustMassFlowKgS * 1200) : 0;
      x.catC += (x.thermal.egtC + exo - x.catC) * (1 - Math.exp(-dt / 6));
      catOver = x.catC > CAT_OVERHEAT_C;
    } else x.catC = x.thermal.egtC;
    const full = fullLoadAt(m, Math.max(rpm, 300)).torque;
    x.load = clamp(torque / Math.max(1, full), 0, 1);
    const powerKw = (torque * rpm * Math.PI) / 30 / 1000;
    s.t = this.s.t + dt;
    s.rpm = rpm;
    s.crankAngleDeg = x.crank;
    s.running = x.running;
    s.starterEngaged = starter;
    s.vehicleSpeedMs = input.dynoMode === "vehicle" ? x.vSpeed : 0;
    if (input.dynoMode === "vehicle" && input.vehicle?.grip !== undefined) {
      s.wheelSpeedMs = x.vWheel;
      s.wheelSlip = (x.vWheel - x.vSpeed) / Math.max(1, x.vSpeed);
      s.wheelSpin = x.spin;
      s.wheelsLocked = x.locked;
      s.tyreForceN = x.tyreF;
      s.accelMs2 = x.aLong;
      s.brakeSlip = slipRatio(x.vBrk, x.vSpeed);
      s.absActive = x.absT < 0.3;
      s.absCycles = x.absCycles;
      const demand = clamp(input.vehicle.brake ?? 0, 0, 1) * BRAKE_MAX_G * input.vehicle.vehicle.massKg * G;
      s.absPressure = demand > 1 ? clamp(x.absF / demand, 0, 1) : 0;
      s.roadGrip = x.grip;
    }
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
    s.lambda = anyFire ? clamp(out.lambda, 0.3, 99) : 99;
    s.egtC = x.thermal.egtC;
    s.coolantC = x.thermal.coolantC;
    s.oilC = x.thermal.oilC;
    s.oilPressureBar = oilPressureBar(cfg, rpm, x.thermal.oilC);
    s.peakPressureBar = out.peakPressureBar;
    s.meanPistonSpeedMs = meanPistonSpeed(cfg.block.strokeMm, rpm);
    s.knock = m.fuel === "petrol" ? out.knock : 0;
    s.smoke = m.fuel === "diesel" ? out.smoke : 0;
    s.afterfire = x.running ? clamp(afterfire, 0, 1) : 0;
    s.torqueLimited = limitedAny && pedal > 0.5;
    // --- limits (PR #12 evaluateLimits): warnings, wear, fatal damage
    const lim = evaluateLimits(cfg, s, this.tracker);
    // overheated catalyst ages the exhaust aftertreatment (issue #16) [S]: counted into the wear figure
    x.wear = clamp(x.wear + (lim.wearRatePerS + (catOver ? 2e-4 : 0)) * dt, 0, 1);
    s.wear = x.wear;
    let warns = x.stalled && rpm < 0.5 * idle ? [...lim.warnings, this.stallWarn] : lim.warnings;
    if (catOver) warns = [...warns, { code: "catalyst-overheat", severity: "warning", message: `Kat überhitzt (${Math.round(x.catC)} °C): Nachbrennen im Katalysator` }];
    s.warnings = warns;
    if (lim.fatal && !x.destroyed) {
      x.destroyed = true;
      x.running = false;
      x.armed = false;
      s.damage = [...this.s.damage, lim.fatal];
    }
    s.destroyed = x.destroyed;
    if (x.destroyed) s.running = false;
    this.s = s;
    return s;
  }
}

const G = 9.81;
const RHO_AIR = 1.2;

/** Road load at the wheel in N (rolling + aerodynamic), opposing motion. Vehicle at rest: no force. */
export function roadLoadN(v: VehicleCoupling["vehicle"], speedMs: number, rho = RHO_AIR, cosGrade = 1): number {
  if (speedMs <= 0) return 0;
  return v.rollingResistance * v.massKg * G * cosGrade + 0.5 * rho * v.dragCoefficient * v.frontalAreaM2 * speedMs * speedMs;
}

/**
 * Road gradient (issue #23): slope angle θ = atan(p/100); downhill force F = m·g·sin θ (+ = against an uphill
 * drive), normal force m·g·cos θ (Mitschke/Wallentowitz, Dynamik der Kraftfahrzeuge, "Steigungswiderstand") [S].
 */
function gradeOf(c: VehicleCoupling): { sin: number; cos: number } {
  const p = clamp(fin(c.gradePct ?? 0, 0), -40, 40);
  if (p === 0) return { sin: 0, cos: 1 };
  const th = Math.atan(p / 100);
  return { sin: Math.sin(th), cos: Math.cos(th) };
}

/** Brake system force capacity at full pedal, in g: enough to lock any tyre (ABS: issue #23) [S]. */
const BRAKE_MAX_G = 1.6;
/** Rotating inertia of all four braked wheels, kg·m² (4 × ≈ 1.0, see WHEEL_INERTIA) [S]. */
const BRAKED_INERTIA = 4;
/**
 * ABS hydraulic unit (issue #23) [S]: Bosch ABS control cycle (Bosch, Kraftfahrtechnisches Taschenbuch, "ABS
 * Regelzyklus"; Burckhardt, Fahrwerktechnik: Radschlupf-Regelsysteme): pressure release when the wheel slip passes
 * the μ peak (here PEAK_SLIP + 5 %), re-apply once the wheel has re-accelerated (slip back to half the peak slip).
 * Release is fast (outlet valve to the low-pressure accumulator, ≈ 50 ms full → 0); re-apply in a steep first step
 * to ≈ 90 % of the last lock pressure, then a slow pulsed ramp (inlet valve) that finds the peak again; relative to the pressure at the last release, so the cycle rate is μ-independent and lands
 * at ≈ 8–15 Hz like real systems. Below ≈ 7 km/h ABS is passive (wheels may lock just before standstill).
 */
const ABS_MIN_SPEED_MS = 2;
const ABS_RELEASE_SLIP = -(PEAK_SLIP + 0.04);
const ABS_REAPPLY_SLIP = -0.7 * PEAK_SLIP;
const ABS_RELEASE_RATE = 20;
const ABS_BUILD_RATE = 2;
const ABS_STEP_RATE = 25;
/** Rotating inertia of one wheel incl. tyre, brake disc and half shaft, kg·m² (17–18" car wheel ≈ 0.8–1.2) [S]. */
const WHEEL_INERTIA = 1.0;
/** Driven-wheel slip below which the wheels count as "gripping" for the flags (beyond the μ peak) [S]. */
const SPIN_SLIP = 0.2;
const LOCK_SLIP = -0.3;

/**
 * One sub-step of engine + vehicle (dynoMode "vehicle"). Longitudinal dynamics: m·dv/dt = F_tyre − F_roll − F_aero
 * − F_brake (no gradient).
 *
 * Without tyre data (c.grip unset) the driven wheels roll without slip (tiedStep, the pre-#22 model).
 * With c.grip (issue #22, review PR #37) the driven wheels are a body of their own (circumferential speed vWheel):
 * the tyre force follows the force–slip curve of tyres.ts (tyreForceFactor: peak μ at ≈ 10 % slip, falling to
 * 0.9·μ when spinning or locked), N from drivenAxleLoadN (load transfer from the last acceleration). The tyre
 * curve is stiff (the wheel side is light), so engine, wheel side and vehicle are integrated with one linearised
 * backward-Euler step (3×3, or 2×2 with the clutch closed) – stable at h = 1 ms, no chatter around zero slip.
 * Clutch: closed and synchronised = engine reflected to the wheel (rigid); otherwise a friction torque
 * cap·tanh(slip/3), linearised in the same implicit step. Engine braking on a low-μ road can drive the slip
 * negative (locked driven wheels). The service brake acts on the vehicle, limited to μ·m·g (above: locked,
 * 0.9·μ·m·g); at standstill it holds the car like before (tiedStep).
 */
function stepVehicle(x: Internal, c: VehicleCoupling, engineTorqueNm: number, J: number, h: number) {
  const veh = c.vehicle;
  const pedalB = clamp(c.brake ?? 0, 0, 1);
  const atRest = x.vSpeed <= 1e-3;
  const traction = c.grip !== undefined && Number.isFinite(c.grip) && veh.driveLayout !== undefined;
  x.absT = Math.min(9, x.absT + h);
  if (!traction || (atRest && pedalB > 0.05 && x.vWheel <= 0.05)) {
    tiedStep(x, c, engineTorqueNm, J, h, traction ? Math.max(0.01, c.grip!) : undefined);
    return;
  }
  const gr = gradeOf(c);
  const mu = Math.max(0.01, c.grip!) * gr.cos;
  x.grip = mu;
  const r = veh.wheelRadiusM;
  const i = c.totalRatio;
  const eta = clamp(c.efficiency, 0.5, 1);
  const m = veh.massKg;
  const lock = clamp(c.clutch, 0, 1);
  const cap = lock * c.clutchCapacityNm;
  const fWheelie = wheelieLimitN(veh);
  const cut = (f: number) => (f > fWheelie ? fWheelie : f);
  // service brake through the braked wheels' tyre force (issue #23: brake slip, ABS)
  const fBrake = atRest ? 0 : stepBrakes(x, c, pedalB, mu, h);
  const brakeLocked = fBrake > 0 && x.vSpeed > 0.5 && slipRatio(x.vBrk, x.vSpeed) < LOCK_SLIP;
  const R = roadLoadN(veh, x.vSpeed, airRho(c), gr.cos) + m * G * gr.sin + fBrake;
  const N = drivenAxleLoadN(veh, x.aLong);
  const mW = (veh.drivenWheelInertiaKgM2 ?? (veh.driveLayout === "awd" ? 4 : 2) * WHEEL_INERTIA) / (r * r);
  // tyre force and its slope d F / d vWheel (only the rising part is used for the implicit step)
  const v0 = x.vSpeed;
  const w0 = x.vWheel;
  const tyre = (vw: number) => mu * N * tyreForceFactor(slipRatio(vw, v0));
  const Ft0 = tyre(w0);
  const eps = 0.01;
  const kt = Math.max(0, (tyre(w0 + eps) - tyre(w0 - eps)) / (2 * eps));
  const wEng = x.rpm / RPM_PER_RADS;
  const a = i > 0 ? i / r : 0; // gearbox input rad/s per m/s wheel speed
  const rigid = i > 0 && lock > 0.98 && Math.abs(wEng - w0 * a) < 2 && Math.abs(engineTorqueNm) <= cap * 1.2;
  let dv: number;
  let dw: number;
  if (rigid) {
    // engine + driven side as one body: mD·dw = h(Fd − Ft), m·dv = h(Ft − R), Ft ≈ Ft0 + kt(dw − dv)
    const mD = J * a * a + mW;
    const Fd = cut(engineTorqueNm * a * (engineTorqueNm >= 0 ? eta : 1 / eta));
    [dw, dv] = solve2(mD + h * kt, -h * kt, -h * kt, m + h * kt, h * (Fd - Ft0), h * (Ft0 - R));
    x.vWheel = Math.max(0, w0 + dw);
    x.rpm = x.vWheel * a * RPM_PER_RADS;
  } else {
    // engine | clutch | driven side | tyre | vehicle, clutch torque tc ≈ tc0 + kc·Δrel (rel = ωe − a·vw)
    const rel = wEng - a * w0;
    const tc0 = i > 0 ? cap * Math.tanh(rel / 3) : 0;
    const kc = i > 0 ? (cap / 3) / Math.cosh(rel / 3) ** 2 : 0;
    const g = i > 0 ? (a * (tc0 >= 0 ? eta * Math.max(1, c.torqueRatio ?? 1) : 1 / eta)) : 0; // N per Nm
    const Fd0 = cut(g * tc0);
    // unknowns dωe, dw, dv
    const A = [
      [J + h * kc, -h * kc * a, 0],
      [-h * g * kc, mW + h * g * kc * a + h * kt, -h * kt],
      [0, -h * kt, m + h * kt],
    ];
    const b = [h * (engineTorqueNm - tc0), h * (Fd0 - Ft0), h * (Ft0 - R)];
    const [de, dW, dV] = solve3(A, b);
    dw = dW;
    dv = dV;
    x.rpm = Math.max(0, wEng + de) * RPM_PER_RADS;
    x.vWheel = Math.max(0, w0 + dw);
  }
  // at rest the vehicle does not roll backwards (brake / road load are friction)
  x.vSpeed = Math.max(0, v0 + dv);
  const s = slipRatio(x.vWheel, x.vSpeed);
  x.tyreF = tyre(x.vWheel);
  x.spin = s > SPIN_SLIP;
  x.locked = brakeLocked || (x.vSpeed > 1 && s < LOCK_SLIP);
  if (fBrake === 0) x.vBrk = x.vSpeed;
  // acceleration for the load transfer, low-pass 20 ms against single-step spikes
  x.aLong += ((x.vSpeed - v0) / h - x.aLong) * Math.min(1, h / 0.02);
}

function airRho(c: VehicleCoupling): number {
  const r = c.airDensityKgM3;
  return r !== undefined && Number.isFinite(r) ? clamp(r, 0.3, 1.6) : RHO_AIR;
}

/**
 * Braked wheels (issue #23), lumped into one body with all four wheels' inertia and an ideal brake balance (every
 * wheel at the same slip, total normal force m·g·cos θ): BRAKED_INERTIA/r² · dv_B/dt = F_tyre(s_B) − F_brake,
 * F_tyre = −μ·N·tyreForceFactor(s_B) (same force–slip curve as the driven wheels). Implicit in v_B (the curve is
 * stiff), the vehicle speed is taken from the start of the step (it changes ≈ 30× slower). The brake is Coulomb
 * friction: a stopped wheel stays locked while the tyre force is below the brake force. With c.abs the brake force
 * is the modulated pressure of the ABS unit (see ABS_* above). Returns the tyre force on the vehicle (≥ 0, against
 * the motion). Without ABS a full brake locks the wheels: F → SLIDE_FACTOR·μ·N, as in the issue #22 model.
 */
function stepBrakes(x: Internal, c: VehicleCoupling, pedalB: number, mu: number, h: number): number {
  const m = c.vehicle.massKg;
  const r = c.vehicle.wheelRadiusM;
  const v = x.vSpeed;
  const demand = pedalB * BRAKE_MAX_G * m * G;
  if (!(demand > 0)) {
    x.vBrk = v;
    x.absF = 0;
    x.absRelease = false;
    return 0;
  }
  if (x.vBrk > v || !Number.isFinite(x.vBrk)) x.vBrk = v;
  let fb = demand;
  if (c.abs && v > ABS_MIN_SPEED_MS) {
    const sB = slipRatio(x.vBrk, v);
    if (!x.absRelease && sB < ABS_RELEASE_SLIP) {
      x.absRelease = true;
      // lock pressure: the pressure at which the wheel just passed the μ peak (adapts every cycle)
      x.absRef = clamp(x.absF > 0 ? x.absF : demand, 1, demand);
      x.absCycles++;
      x.absT = 0;
    } else if (x.absRelease && sB > ABS_REAPPLY_SLIP) x.absRelease = false;
    if (x.absRelease) {
      // outlet valve: the pressure falls ≈ exponentially (τ = 1/ABS_RELEASE_RATE), never slower than towards the
      // estimated lock pressure
      x.absF = Math.max(0, x.absF - ABS_RELEASE_RATE * Math.max(x.absF, x.absRef) * h);
      x.absT = 0;
    }
    else if (x.absT > 0.5) x.absF = demand; // not regulating: driver pressure passes straight through
    else {
      // re-apply: a steep first step up to ≈ 90 % of the last lock pressure, then a slow ramp that finds the peak
      const rate = x.absF < 0.9 * x.absRef ? ABS_STEP_RATE : ABS_BUILD_RATE;
      x.absF = Math.min(demand, x.absF + rate * x.absRef * h);
    }
    fb = x.absF;
  } else {
    x.absF = demand;
    x.absRelease = false;
  }
  const N = m * G;
  const mB = BRAKED_INERTIA / (r * r);
  const tyre = (w: number) => -mu * N * tyreForceFactor(slipRatio(w, v));
  const w0 = x.vBrk;
  const F0 = tyre(w0);
  if (w0 <= 1e-6 && F0 <= fb) x.vBrk = 0; // locked wheel, held by static brake friction
  else {
    const eps = 0.01;
    const k = Math.max(0, (tyre(w0 - eps) - tyre(w0 + eps)) / (2 * eps));
    x.vBrk = clamp(w0 + (h * (F0 - fb)) / (mB + h * k), 0, v);
  }
  return Math.max(0, tyre(x.vBrk));
}

/** Longitudinal slip (v_wheel − v) / max(|v_wheel|, |v|, 1 m/s): 0 rolling, → 1 spinning, < 0 braking / locking. */
export function slipRatio(vWheel: number, v: number): number {
  return (vWheel - v) / Math.max(Math.abs(vWheel), Math.abs(v), 1);
}

function solve2(a11: number, a12: number, a21: number, a22: number, b1: number, b2: number): [number, number] {
  const det = a11 * a22 - a12 * a21;
  return [(b1 * a22 - a12 * b2) / det, (a11 * b2 - a21 * b1) / det];
}

/** 3×3 linear solve (Cramer's rule; the matrix is diagonally dominant). */
function solve3(A: number[][], b: number[]): [number, number, number] {
  const d = (M: number[][]) =>
    M[0]![0]! * (M[1]![1]! * M[2]![2]! - M[1]![2]! * M[2]![1]!) -
    M[0]![1]! * (M[1]![0]! * M[2]![2]! - M[1]![2]! * M[2]![0]!) +
    M[0]![2]! * (M[1]![0]! * M[2]![1]! - M[1]![1]! * M[2]![0]!);
  const D = d(A);
  const col = (k: number) => A.map((row, j) => row.map((v, c) => (c === k ? b[j]! : v)));
  return [d(col(0)) / D, d(col(1)) / D, d(col(2)) / D];
}

/**
 * Driven wheels rolling without slip (pre-#22 model; also used at standstill with the brake held). Clutch closed and
 * synchronised: rigid coupling, engine inertia reflected to the wheel; otherwise a slipping clutch friction torque.
 * With mu set, the service brake is limited to μ·m·g.
 */
function tiedStep(x: Internal, c: VehicleCoupling, engineTorqueNm: number, J: number, h: number, mu?: number) {
  const veh = c.vehicle;
  const r = veh.wheelRadiusM;
  const i = c.totalRatio;
  const eta = clamp(c.efficiency, 0.5, 1);
  const wEng = x.rpm / RPM_PER_RADS;
  const wIn = i > 0 ? (x.vSpeed / r) * i : 0;
  const lock = clamp(c.clutch, 0, 1);
  const cap = lock * c.clutchCapacityNm;
  // service brake: friction brake up to μ·m·g (μ ≈ 1.0 without tyre data, road tyre on dry asphalt) [S]. While
  // moving it opposes the motion; at rest it acts as static friction and holds the car against drive force (review #20).
  const pedalB = clamp(c.brake ?? 0, 0, 1);
  const brakeCapN = mu === undefined ? pedalB * 1.0 * veh.massKg * G : Math.min(pedalB * BRAKE_MAX_G, mu) * veh.massKg * G;
  const atRest = x.vSpeed <= 1e-3;
  // gradient (issue #23): at rest the car only starts to roll downhill or when the drive beats the slope; it never
  // rolls backwards (vehicle speed ≥ 0: like a hill-hold assistant, see PR #23 decisions)
  const gr = gradeOf(c);
  const fGrade = veh.massKg * G * gr.sin;
  const fRes = roadLoadN(veh, x.vSpeed, airRho(c), gr.cos) + fGrade + (atRest ? 0 : brakeCapN);
  const net = (fDrive: number) => (atRest ? Math.max(0, fDrive - fGrade - brakeCapN) : fDrive - fRes);
  x.grip = mu ?? 1;
  const slip = wEng - wIn;
  const fWheelie = wheelieLimitN(veh);
  const cut = (f: number) => (f > fWheelie ? fWheelie : f);
  const v0 = x.vSpeed;
  if (i > 0 && lock > 0.98 && Math.abs(slip) < 2 && Math.abs(engineTorqueNm) <= cap * 1.2) {
    const mEff = veh.massKg + (J * i * i) / (r * r);
    const fDrive = cut((engineTorqueNm * i * (engineTorqueNm >= 0 ? eta : 1 / eta)) / r);
    x.vSpeed = Math.max(0, x.vSpeed + (net(fDrive) / mEff) * h);
    x.rpm = ((x.vSpeed / r) * i) * RPM_PER_RADS;
    x.tyreF = fDrive;
  } else {
    const tc = i > 0 ? cap * Math.tanh(slip / 3) : 0;
    let wE = wEng + ((engineTorqueNm - tc) / J) * h;
    if (wE < 0) wE = 0;
    x.rpm = wE * RPM_PER_RADS;
    const kConv = tc > 0 ? Math.max(1, c.torqueRatio ?? 1) : 1;
    const fDrive = i > 0 ? cut((tc * kConv * i * (tc >= 0 ? eta : 1 / eta)) / r) : 0;
    x.vSpeed = Math.max(0, x.vSpeed + (net(fDrive) / veh.massKg) * h);
    x.tyreF = fDrive;
  }
  x.vWheel = x.vSpeed;
  x.vBrk = x.vSpeed;
  x.absF = 0;
  x.spin = false;
  x.locked = false;
  x.aLong += ((x.vSpeed - v0) / h - x.aLong) * Math.min(1, h / 0.02);
}
