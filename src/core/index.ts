/**
 * Public API of the physics core. UI, sound and tests import ONLY from here.
 *
 * NOTE: the current implementations are crude placeholders so UI and sound can start in parallel.
 * Team "Kern-Physik" replaces them (see issue "Kern-Physik"). Keep these signatures stable.
 */
import type { DynoPoint, EngineConfig, EngineState, EngineSummary, SimInputs, Warning } from "./types.ts";

export type * from "./types.ts";

export function displacementL(cfg: EngineConfig): number {
  const { boreMm, strokeMm, cylinders } = cfg.block;
  return (Math.PI / 4) * (boreMm / 10) ** 2 * (strokeMm / 10) * cylinders / 1000;
}

/** Steady-state full-load sweep (what a classic dyno run produces). */
export function dynoSweep(cfg: EngineConfig, opts: { fromRpm?: number; toRpm?: number; stepRpm?: number } = {}): DynoPoint[] {
  const from = opts.fromRpm ?? 1000;
  const to = opts.toRpm ?? cfg.revLimitRpm;
  const step = opts.stepRpm ?? 250;
  const pts: DynoPoint[] = [];
  for (let rpm = from; rpm <= to; rpm += step) {
    const torqueNm = placeholderTorque(cfg, rpm, 1);
    pts.push({
      rpm,
      torqueNm,
      powerKw: (torqueNm * rpm * 2 * Math.PI) / 60 / 1000,
      boostBar: cfg.induction.aspiration === "naturally-aspirated" ? 0 : cfg.induction.boostTargetBar,
      bsfcGkWh: cfg.fuel === "diesel" ? 210 : 250,
      lambda: cfg.fuelSystem.kind === "diesel" ? cfg.fuelSystem.smokeLimitLambda : cfg.fuelSystem.fullLoadLambda,
      egtC: cfg.fuel === "diesel" ? 650 : 850,
      peakPressureBar: cfg.fuel === "diesel" ? 160 : 80,
    });
  }
  return pts;
}

export function summarize(cfg: EngineConfig): EngineSummary {
  const sweep = dynoSweep(cfg, { stepRpm: 100 });
  let pt = sweep[0]!;
  let pp = sweep[0]!;
  for (const p of sweep) {
    if (p.torqueNm > pt.torqueNm) pt = p;
    if (p.powerKw > pp.powerKw) pp = p;
  }
  const n = cfg.block.cylinders;
  return {
    displacementL: displacementL(cfg),
    boreStrokeRatio: cfg.block.boreMm / cfg.block.strokeMm,
    maxMeanPistonSpeedMs: (2 * cfg.block.strokeMm / 1000 * cfg.revLimitRpm) / 60,
    massKg: 40 + displacementL(cfg) * 45,
    peakTorqueNm: pt.torqueNm,
    peakTorqueRpm: pt.rpm,
    peakPowerKw: pp.powerKw,
    peakPowerRpm: pp.rpm,
    safeMaxRpm: (20 * 60) / (2 * cfg.block.strokeMm / 1000),
    firingIntervalsDeg: Array.from({ length: n }, () => 720 / n),
    reliability: 0.8,
  };
}

/** Problems that are visible already from the config (before running). */
export function validateConfig(_cfg: EngineConfig): Warning[] {
  return [];
}

export function defaultInputs(): SimInputs {
  return {
    pedal: 0,
    ignition: false,
    starter: false,
    dynoMode: "free",
    dynoTargetRpm: 2000,
    dynoBrakeTorqueNm: 0,
    ambientC: 20,
    ambientKpa: 101.325,
  };
}

/** Real-time transient simulator. Call step() every animation frame (dt in seconds, may be sub-stepped internally). */
export class EngineSimulator {
  private s: EngineState;
  constructor(public config: EngineConfig) {
    this.s = initialState(config);
  }
  setConfig(cfg: EngineConfig) {
    this.config = cfg;
    this.reset();
  }
  reset() {
    this.s = initialState(this.config);
  }
  get state(): EngineState {
    return this.s;
  }
  step(dt: number, input: SimInputs): EngineState {
    const s = { ...this.s };
    const cfg = this.config;
    s.t += dt;
    if (input.ignition && !s.running && input.starter) s.running = true;
    if (!input.ignition) s.running = false;
    const pedal = s.running ? Math.max(input.pedal, (cfg.idleRpm - s.rpm) / 400) : 0;
    const drive = s.running ? placeholderTorque(cfg, Math.max(s.rpm, 600), Math.min(1, Math.max(0, pedal))) : 0;
    const starterTq = input.starter && s.rpm < 300 ? 60 : 0;
    const friction = 0.004 * s.rpm + (s.rpm > 0 ? 8 : 0);
    let brake = 0;
    if (input.dynoMode === "torque") brake = input.dynoBrakeTorqueNm;
    if (input.dynoMode === "hold-rpm") brake = Math.max(0, (s.rpm - input.dynoTargetRpm) * 2);
    const net = drive + starterTq - friction - brake;
    s.rpm = Math.max(0, Math.min(cfg.revLimitRpm + 100, s.rpm + (net / 0.25) * dt * 60 / (2 * Math.PI)));
    if (s.rpm >= cfg.revLimitRpm) s.rpm = cfg.revLimitRpm - 50;
    s.crankAngleDeg = (s.crankAngleDeg + s.rpm * 6 * dt) % 720;
    s.torqueNm = drive - friction;
    s.powerKw = (s.torqueNm * s.rpm * 2 * Math.PI) / 60000;
    s.load = Math.min(1, Math.max(0, pedal));
    s.coolantC += ((s.running ? 90 : input.ambientC) - s.coolantC) * dt * 0.01;
    s.oilC += ((s.running ? 100 : input.ambientC) - s.oilC) * dt * 0.006;
    s.egtC = input.ambientC + s.load * (cfg.fuel === "diesel" ? 600 : 800) + s.rpm * 0.03;
    s.fuelFlowLh = s.running ? 0.6 + Math.max(0, s.powerKw) * 0.25 : 0;
    s.meanPistonSpeedMs = (2 * cfg.block.strokeMm / 1000 * s.rpm) / 60;
    s.boostBar = cfg.induction.aspiration === "naturally-aspirated" ? 0 : cfg.induction.boostTargetBar * s.load * Math.min(1, s.rpm / 2500);
    this.s = s;
    return s;
  }
}

function placeholderTorque(cfg: EngineConfig, rpm: number, load: number): number {
  const d = displacementL(cfg);
  const boost = cfg.induction.aspiration === "naturally-aspirated" ? 0 : cfg.induction.boostTargetBar * Math.min(1, rpm / 2000);
  const bmep = (cfg.fuel === "diesel" ? 9 : 11) * (1 + boost);
  const peak = cfg.fuel === "diesel" ? 2200 : 4500;
  const shape = Math.max(0.2, 1 - ((rpm - peak) / (cfg.revLimitRpm * 0.9)) ** 2);
  return ((bmep * 1e5 * d * 1e-3) / (4 * Math.PI)) * shape * load;
}

function initialState(cfg: EngineConfig): EngineState {
  return {
    t: 0, running: false, destroyed: false, rpm: 0, crankAngleDeg: 0, torqueNm: 0, powerKw: 0,
    imepBar: 0, bmepBar: 0, fmepBar: 0, load: 0, manifoldAbsKpa: 101.3, boostBar: 0, turboRpm: 0,
    airMassFlowKgS: 0, fuelMassFlowGS: 0, fuelFlowLh: 0, bsfcGkWh: Number.NaN, efficiency: 0,
    lambda: cfg.fuel === "diesel" ? 10 : 1, egtC: 20, coolantC: 20, oilC: 20, oilPressureBar: 0,
    peakPressureBar: 0, meanPistonSpeedMs: 0, knock: 0, smoke: 0, wear: 0, warnings: [], damage: [],
  };
}
