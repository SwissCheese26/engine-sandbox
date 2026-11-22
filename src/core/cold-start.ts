/**
 * Cold-start strategy of the engine ECU (issue #135, contract #134): catalyst heating, cold fast idle and the
 * catalyst substrate as a thermal mass. Specification: docs/research/petrol.md "Nachtrag: Kaltstart und Katheizen" (§K1–§K5),
 * diesel.md "Nachtrag: Kaltstart-Heizmodus". Pure functions, no DOM.
 */
import type { EmissionsStandard, EngineConfig } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

const ORDER: readonly EmissionsStandard[] = ["pre-euro", "euro1", "euro2", "euro3", "euro4", "euro5", "euro6"];

/**
 * Emissions standard of an engine: `cfg.emissions`, or a default from the hardware when unset (§K1): no catalyst or a
 * carburettor = pre-Euro; diesel with SCR = Euro 6, with DPF = Euro 5; petrol direct injection = Euro 5; other
 * injected engines with a catalyst = Euro 3.
 */
export function emissionsOf(cfg: EngineConfig): EmissionsStandard {
  if (cfg.emissions && ORDER.includes(cfg.emissions)) return cfg.emissions;
  const ex = cfg.exhaust;
  if (!ex.catalyst) return "pre-euro";
  if (cfg.fuelSystem.kind === "petrol") {
    if (cfg.fuelSystem.mixture === "carburettor") return "pre-euro";
    return cfg.fuelSystem.mixture === "port-injection" ? "euro3" : "euro5";
  }
  return ex.scr ? "euro6" : ex.particulateFilter ? "euro5" : "euro3";
}

const atLeast = (e: EmissionsStandard, min: EmissionsStandard) => ORDER.indexOf(e) >= ORDER.indexOf(min);

/**
 * Active catalyst heating after a cold start (§K2, §K5): petrol from Euro 3 (98/69/EC dropped the 40 s idle before
 * sampling, so the ECU must light the catalyst off itself) with a catalyst and spark ignition by an ECU (no
 * carburettor); diesel from Euro 5 (DPF/SCR heating mode with post-injection).
 */
export function hasCatHeating(cfg: EngineConfig): boolean {
  if (!cfg.exhaust.catalyst) return false;
  const e = emissionsOf(cfg);
  if (cfg.fuelSystem.kind === "petrol") return cfg.fuelSystem.mixture !== "carburettor" && atLeast(e, "euro3");
  return atLeast(e, "euro5");
}

/** Catalyst light-off (50 % conversion) [§K3]: three-way catalyst ≈ 250 … 300 °C, diesel oxidation catalyst ≈ 200 °C. */
export function lightOffC(cfg: EngineConfig): number {
  return cfg.fuel === "diesel" ? 200 : 300;
}

/** A start counts as cold when the coolant is below this (§K2: the ECU's start-temperature gate). */
export const COLD_START_COOLANT_C = 40;
/** Catalyst heating lasts at least / at most (§K2: typical 20 … 60 s after a cold start). */
export const CAT_HEAT_MIN_S = 20;
export const CAT_HEAT_MAX_S = 60;
/** Spark retard of the catalyst-heating mode from MBT, °CA (§K2: ≈ 5 … 15° ATDC instead of ≈ 20 … 25° BTDC). */
export const CAT_HEAT_RETARD_DEG = 30;
/** Diesel heating mode: post-injected fuel as a share of the main quantity, and the share of its heat that reaches
 *  the exhaust (late burn, no work) [§K5]. */
export const POST_INJ_SHARE = 0.3;
export const POST_INJ_HEAT = 0.7;
/** Time constant of the ECU's idle-target ramp, s (no step in the idle speed when a phase ends). */
export const IDLE_RAMP_S = 1.5;

/** Idle target while the catalyst is heated (§K2): petrol 1200 … 1500 1/min, diesel idle + 250 1/min. */
export function catHeatIdleRpm(cfg: EngineConfig): number {
  return cfg.fuel === "diesel" ? cfg.idleRpm + 250 : clamp(Math.max(cfg.idleRpm + 450, 1200), cfg.idleRpm, 1500);
}

/**
 * Cold fast idle above the warm idle speed, 1/min (§K4), from the coolant(-equivalent) temperature: linear from
 * `add20` at 20 °C to 0 at `endC`; colder engines idle up to 1.5 × `add20` higher. ECU engines (Euro 3+) +200 1/min,
 * fading out at 70 °C; older engines a choke-like +350 1/min (petrol) / +150 1/min (diesel cold-idle advance),
 * fading out at 60 °C.
 */
export function fastIdleAddRpm(cfg: EngineConfig, coolantC: number): number {
  const modern = cfg.fuel === "petrol" ? hasCatHeating(cfg) : atLeast(emissionsOf(cfg), "euro3");
  const add20 = modern ? (cfg.fuel === "diesel" ? 150 : 200) : cfg.fuel === "diesel" ? 150 : 350;
  const endC = modern ? 70 : 60;
  return add20 * clamp((endC - coolantC) / (endC - 20), 0, 1.5);
}

const CP_EXH = 1100; // J/(kg·K), exhaust gas around 400 … 600 °C
const litres = (cfg: EngineConfig) => (Math.PI / 4) * (cfg.block.boreMm / 1000) ** 2 * (cfg.block.strokeMm / 1000) * cfg.block.cylinders * 1000;

/**
 * Time constant of the catalyst substrate on the cold-start path, s (§K3): τ = C_cat/(ṁ·c_p), at least 6 s (the
 * warm-path value of issue #16). C_cat = light-off zone of the close-coupled monolith, ≈ 0.25 kJ/K + 0.25 kJ/K per litre.
 */
export function catTauS(cfg: EngineConfig, flowKgS: number): number {
  const c = 250 + 250 * litres(cfg);
  return clamp(c / Math.max(1e-6, flowKgS * CP_EXH), 6, 600);
}

/** Extra exhaust temperature of the diesel post-injection (§K5): ΔT = η·ṁ_post·H_u/(ṁ_exh·c_p). */
export function postInjectionDeltaC(postFuelGs: number, lhvJKg: number, flowKgS: number): number {
  return flowKgS > 1e-6 ? (POST_INJ_HEAT * (postFuelGs / 1000) * lhvJKg) / (flowKgS * CP_EXH) : 0;
}

/**
 * Conversion heat of a lit catalyst (§K3): oxidising the CO/HC left in the exhaust raises the substrate above the gas,
 * ΔT ≈ 90 K per % CO equivalent. Warm petrol at λ ≈ 1 ≈ 0.5 … 1 % CO-equivalent → ≈ 60 K; lean diesel ≈ 15 K.
 * Conversion rises over ±40 K around light-off (S-curve).
 */
export function conversionHeatC(cfg: EngineConfig, catC: number): number {
  const eta = 1 / (1 + Math.exp(-(catC - lightOffC(cfg)) / 20));
  return (cfg.fuel === "diesel" ? 15 : 60) * eta;
}
