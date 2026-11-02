/**
 * Steady-state dyno sweep and nameplate summary. Pure functions, no DOM.
 * Full-load points come from cycle.steadyFullLoad (diesel.md §3, petrol.md §3).
 */
import { getModel, steadyFullLoad } from "./cycle.ts";
import { displacementLiters, firingIntervalsDeg, firingOrder, meanPistonSpeed } from "./geometry.ts";
import { engineLimits, engineMassKg, reliabilityScore, safeMaxRpm } from "./subsystems.ts";
import type { DynoPoint, EngineConfig, EngineSummary } from "./types.ts";

/** Steady full-load sweep (what a classic dyno run produces). */
export function dynoSweep(cfg: EngineConfig, opts: { fromRpm?: number; toRpm?: number; stepRpm?: number } = {}): DynoPoint[] {
  const m = getModel(cfg);
  const from = Math.max(300, opts.fromRpm ?? 1000);
  const to = opts.toRpm ?? cfg.revLimitRpm;
  const step = Math.max(10, opts.stepRpm ?? 250);
  const pts: DynoPoint[] = [];
  for (let rpm = from; rpm <= to + 1e-9; rpm += step) {
    const sp = steadyFullLoad(m, rpm);
    const o = sp.out;
    const powerKw = (o.torqueNm * rpm * 2 * Math.PI) / 60000;
    pts.push({
      rpm,
      torqueNm: o.torqueNm,
      powerKw,
      boostBar: sp.boostBar,
      // petrol.md §3.9 / diesel.md §3.5: BSFC = ṁfuel·3600/P (NaN at ~zero power)
      bsfcGkWh: powerKw > 0.5 ? (o.fuelMassFlowGS * 3600) / powerKw : Number.NaN,
      lambda: o.lambda,
      egtC: o.egtC,
      peakPressureBar: o.peakPressureBar,
    });
  }
  return pts;
}

export function summarize(cfg: EngineConfig): EngineSummary {
  const sweep = dynoSweep(cfg, { fromRpm: Math.min(1000, cfg.idleRpm), stepRpm: 100 });
  let pt = sweep[0];
  let pp = sweep[0];
  for (const p of sweep) {
    if (!pt || p.torqueNm > pt.torqueNm) pt = p;
    if (!pp || p.powerKw > pp.powerKw) pp = p;
  }
  const lim = engineLimits(cfg);
  return {
    displacementL: displacementLiters(cfg),
    boreStrokeRatio: cfg.block.boreMm / cfg.block.strokeMm,
    maxMeanPistonSpeedMs: meanPistonSpeed(cfg.block.strokeMm, cfg.revLimitRpm),
    massKg: engineMassKg(cfg),
    peakTorqueNm: pt?.torqueNm ?? 0,
    peakTorqueRpm: pt?.rpm ?? 0,
    peakPowerKw: pp?.powerKw ?? 0,
    peakPowerRpm: pp?.rpm ?? 0,
    safeMaxRpm: safeMaxRpm(cfg),
    firingIntervalsDeg: firingIntervalsDeg(cfg),
    firingOrder: firingOrder(cfg),
    reliability: reliabilityScore(cfg),
    limits: {
      coolantMaxC: lim.coolantMaxC,
      oilMaxC: lim.oilMaxC,
      egtMaxC: lim.egtMaxC,
      oilPressureMinBar: lim.oilPressureMinBar,
      boostMaxBar: lim.boostMaxBar,
      peakPressureMaxBar: lim.peakPressureMaxBar,
      turboMaxRpm: lim.turboMaxRpm,
      meanPistonSpeedMaxMs: lim.meanPistonSpeedMaxMs,
    },
  };
}
