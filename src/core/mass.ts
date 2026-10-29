/**
 * Dry engine mass and a static reliability indicator.
 *
 * Specification: docs/research/diesel.md §2 "Masse" and §4.7 "Zuverlässigkeit",
 * docs/research/petrol.md §2 (weight column) and §7 "Massen-Richtwerte".
 *
 * Mass model [S]: the diesel.md formula alone overshoots the 2.0 TDI (≈ 184 kg with DPF/AGR vs. ≈ 160 kg)
 * and has no petrol calibration, so the block term was refitted. It is sub-linear in displacement
 * (wall thickness does not grow with bore). Calibration targets (dry, without radiator):
 *   R4 2.0 TDI cast iron ≈ 160 kg · EA888 2.0 TSI cast iron ≈ 140 kg · K20A alu ≈ 110–130 kg ·
 *   LS3 6.2 alu OHV ≈ 180 kg · V8 alu DOHC ≈ 200 kg · Cummins 6BT ≈ 470–500 kg.
 *
 * Pure functions, no DOM.
 */
import type { EngineConfig } from "./types.ts";
import { estimatedFullLoad, limitThresholds, valveFloatRpm } from "./limits.ts";

function displacementL(cfg: EngineConfig): number {
  const { boreMm, strokeMm, cylinders } = cfg.block;
  return ((Math.PI / 4) * (boreMm / 10) ** 2 * (strokeMm / 10) * cylinders) / 1000;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Estimated dry engine mass in kg (long block + charger + intake/exhaust aftertreatment hardware). */
export function engineMassKg(cfg: EngineConfig): number {
  const { block, head, induction, exhaust } = cfg;
  const vl = displacementL(cfg);
  const n = Math.max(1, block.cylinders);

  // Block, crank, head castings: (44 + 30.6·V^0.75) kg for cast iron [S, fitted to the targets above].
  // Aluminium −22 % on this term (petrol.md §2: cast iron ≈ +25 … 35 % block mass), CGI −8 % (diesel.md §2).
  const matF = { "cast-iron": 1.0, "compacted-graphite-iron": 0.92, aluminium: 0.78 }[block.blockMaterial];
  let structure = (44 + 30.6 * vl ** 0.75) * matF;
  if (cfg.fuel === "diesel") {
    structure *= 1.05; // thicker walls / bulkheads for 2× peak pressure [S]
    // Heavy-duty construction (bore > 100 mm, diesel.md §2: "Nfz-Bauweise"): wet liners, massive crank.
    structure *= 1 + 1.5 * smoothstep(92, 102, block.boreMm);
  }
  if (block.layout === "boxer" || block.layout === "v" || block.layout === "w") structure *= 1.04; // two heads/banks
  let m = structure;

  // Per-cylinder hardware: pistons, rods, valves, injectors, coils [S]. Valvetrain: DOHC has 2 cams/bank.
  const vt = { ohv: 0, sohc: 1.0, dohc: 2.0 }[head.valvetrain] * (head.valvesPerCylinder >= 4 ? 1 : 0.75);
  m += n * (5.5 + vt);
  if (block.pistons === "steel") m += 0.3 * n * (block.boreMm / 82) ** 2; // OM654 steel pistons are heavier [S]
  if (block.conrods === "titanium") m -= 0.2 * n;
  if (head.variableTiming !== "none") m += 3; // petrol.md §2: VVT +3 kg
  if (induction.individualThrottleBodies) m += 3; // petrol.md §2: ITB +2 … 4 kg

  // Charging (diesel.md §2: Lader + Rohre 8 + 0.12·D; petrol.md §2: Kompressor +10 … 15 kg).
  const turboUnit = 6 + 0.12 * induction.compressorInducerMm; // −2 kg vs. diesel.md: pipes partly counted in the block term
  switch (induction.aspiration) {
    case "turbo":
      m += turboUnit + (induction.variableGeometry ? 1 : 0);
      break;
    case "e-turbo":
      m += turboUnit + 5; // electric motor on the shaft
      break;
    case "twin-turbo-parallel":
    case "twin-turbo-sequential":
      m += 1.7 * turboUnit + (induction.variableGeometry ? 2 : 0);
      break;
    case "supercharger-roots":
      m += 14;
      break;
    case "supercharger-centrifugal":
      m += 10;
      break;
    default:
      break;
  }
  if (induction.aspiration !== "naturally-aspirated") {
    m += { none: 0, "air-to-air": 3, "air-to-water": 6 }[induction.intercooler];
  }

  // Exhaust aftertreatment mounted on the engine (diesel.md §2 / mass block).
  m += (exhaust.catalyst ? 3 : 0) + (exhaust.particulateFilter ? 8 : 0) + (exhaust.scr ? 15 : 0) + (exhaust.egr ? 3 : 0);
  if (cfg.cooling.oilCooler) m += 2;
  return m;
}

/**
 * Static reliability indicator 0 … 1 (EngineSummary.reliability): load versus material.
 * Multiplicative penalties after diesel.md §4.7, extended analogously for petrol (petrol.md §2 / §4).
 */
export function reliabilityScore(cfg: EngineConfig): number {
  const th = limitThresholds(cfg);
  const est = estimatedFullLoad(cfg);
  let r = 1;

  // Peak-pressure reserve at rated load (diesel.md §4.7: reserve < 5 % → ×0.8). Over-design costs more.
  const reserve = (th.peakPressureDesignBar - est.peakPressureBar) / th.peakPressureDesignBar;
  if (reserve < 0.05) r *= 0.8;
  if (reserve < -0.05) r *= 0.75;
  if (reserve < -0.2) r *= 0.6;

  // Mean piston speed at the rev limit vs. the warning threshold of this hardware (diesel.md §4.7: > 14 m/s → ×0.85).
  const cmLimiter = (2 * (cfg.block.strokeMm / 1000) * cfg.revLimitRpm) / 60;
  if (cmLimiter > th.pistonSpeed.warning) r *= 0.85;
  if (cmLimiter > th.pistonSpeed.critical) r *= 0.7;
  // Rev limiter above valve float onset.
  const nFloat = valveFloatRpm(cfg);
  if (cfg.revLimitRpm > 0.95 * nFloat) r *= 0.85;
  if (cfg.revLimitRpm > 1.08 * nFloat) r *= 0.6;

  const boost = cfg.induction.aspiration === "naturally-aspirated" ? 0 : Math.max(0, cfg.induction.boostTargetBar);
  if (cfg.block.blockMaterial === "aluminium" && boost > 2) r *= 0.9; // diesel.md §4.7
  if (!cfg.cooling.oilCooler && est.specificPowerKwL > 60) r *= 0.85; // diesel.md §4.7
  if (cfg.block.crankshaft === "cast" && est.bmepBar > 18) r *= 0.8; // diesel.md §4.7
  if (cfg.block.pistons === "cast-aluminium" && est.bmepBar > 20 && cfg.fuel === "petrol") r *= 0.85; // petrol.md §1: forged > 90 kW/l
  // Undersized radiator for the expected heat (≈ 0.5 × rated power, petrol.md §1 CoolingConfig).
  if (cfg.cooling.radiatorCapacityKw < 0.4 * est.ratedPowerKw) r *= 0.85;
  if (cfg.cooling.radiatorCapacityKw < 0.25 * est.ratedPowerKw) r *= 0.7;

  if (cfg.fuelSystem.kind === "diesel") {
    if (cfg.fuelSystem.smokeLimitLambda < 1.15) r *= 0.9; // diesel.md §4.7 (EGT, piston crowns)
    if (est.egtC > 780) r *= 0.85; // diesel.md §4.7
    if (cfg.fuelSystem.injectionTimingOffsetDeg > 4) r *= 0.9; // early SOI: pMax ↑ (diesel.md §2)
  } else {
    // Knock margin at full load (petrol.md §3.6): knock control covers ≈ 12 RON (15 °CA × 0.8).
    const control = cfg.fuelSystem.mixture === "carburettor" ? 0 : 12;
    if (est.knockMarginRon < 0) r *= 0.95;
    if (est.knockMarginRon < -control) r *= 0.6;
    if (cfg.fuelSystem.ignitionAdvanceOffsetDeg > 3) r *= 0.9;
    if (cfg.fuelSystem.fullLoadLambda > 0.95 && boost > 0.5) r *= 0.85; // no enrichment cooling → EGT
    if (est.egtC > 980) r *= 0.85;
  }
  return Math.min(1, Math.max(0.05, r));
}
