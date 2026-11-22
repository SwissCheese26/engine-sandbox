/**
 * Gearbox oil temperature (issue #53): one lumped heat capacity (oil + half the casing), heat from the transmission
 * losses, cooling through the casing (ram air), the bell housing (engine) and an optional oil-to-water cooler.
 *
 * Specification: docs/research/vehicle.md §8 (heat input, heat capacities, cooling, viscosity, typical temperatures,
 * damage), §4 (converter slip). Same approach as thermal.ts (lumped capacities, linearly implicit step, stable for
 * any dt), but one node, so the implicit step is solved exactly.
 *
 * Pure functions, no DOM.
 */
import type { GearboxType, VehicleKind } from "./drivetrain.ts";

export type GearboxThermalKind = "manual" | "dct" | "automatic" | "cvt" | "sequential" | "truck" | "bus";

export interface GearboxThermalSpec {
  /** m·c of oil plus half the casing, J/K (vehicle.md §8). */
  heatCapacityJK: number;
  /** Casing to ambient at standstill (natural convection + radiation), W/K. */
  ua0WK: number;
  /** Additional casing convection at 25 m/s ram air, W/K (∝ (v/25)^0.8, vehicle.md §8 [B16]). */
  uaRamWK: number;
  /** Bell housing / flange coupling to the engine (coolant temperature), W/K [S]. */
  uaEngineWK: number;
  /** Oil-to-water heat exchanger on the engine coolant circuit, W/K; 0 = none (vehicle.md §8 [B14, B17]). */
  coolerWK: number;
  /** Load-independent losses (churning, bearings, seals, pump) at nRefRpm input speed with warm oil, W. */
  churnW: number;
  nRefRpm: number;
  /** Share of the clutch slip heat that ends up in the oil: wet clutch 1, dry clutch ≈ 0.15 [S]. */
  clutchOilShare: number;
  /** Warning threshold, °C. */
  warnC: number;
  /** TCU protection mode (torque reduction) from this temperature, °C; null = no TCU (manual). */
  protectC: number | null;
  /** Damage reference: wear rate 1/600 s at this temperature, halving per −10 K (vehicle.md §8 [B18]). */
  damageC: number;
  /** Motorcycle: gearbox in the engine sump, the gearbox oil is the engine oil. */
  sharedSump?: boolean;
}

/** Oil ρ·c ≈ 0.87 kg/l · 2.0 kJ/(kg K); aluminium casing 0.9 kJ/(kg K), half of the casing mass (vehicle.md §8). */
const oilJK = (litres: number) => litres * 0.87 * 2000;
const caseJK = (kg: number) => 0.5 * kg * 900;
/** Gears and shafts run in the oil and follow it fully: steel c ≈ 0.46 kJ/(kg K) (vehicle.md §8). */
const steelJK = (kg: number) => kg * 460;

/**
 * Per gearbox type (vehicle.md §8): MQ350 manual, DQ381 wet DCT, ZF 8HP converter automatic, chain CVT, motorcycle
 * (shared sump), Mercedes PowerShift G281-12 truck AMT, ZF EcoLife bus automatic. UA values [S], calibrated so a
 * compact car on the motorway at 120 km/h settles at ≈ 85 °C (manual) and ≈ 90 °C (automatic, cooler on).
 */
export const GEARBOX_THERMAL: Record<GearboxThermalKind, GearboxThermalSpec> = {
  manual: { heatCapacityJK: oilJK(2) + caseJK(45) + steelJK(18), ua0WK: 6, uaRamWK: 16, uaEngineWK: 4, coolerWK: 0, churnW: 300, nRefRpm: 3000, clutchOilShare: 0.15, warnC: 130, protectC: null, damageC: 150 },
  dct: { heatCapacityJK: oilJK(5.2) + caseJK(90), ua0WK: 7, uaRamWK: 18, uaEngineWK: 4, coolerWK: 120, churnW: 600, nRefRpm: 3000, clutchOilShare: 1, warnC: 120, protectC: 130, damageC: 150 },
  automatic: { heatCapacityJK: oilJK(8.5) + caseJK(85), ua0WK: 7, uaRamWK: 16, uaEngineWK: 4, coolerWK: 150, churnW: 500, nRefRpm: 3000, clutchOilShare: 1, warnC: 120, protectC: 130, damageC: 150 },
  cvt: { heatCapacityJK: oilJK(7) + caseJK(80), ua0WK: 7, uaRamWK: 16, uaEngineWK: 4, coolerWK: 120, churnW: 600, nRefRpm: 3000, clutchOilShare: 1, warnC: 120, protectC: 130, damageC: 150 },
  sequential: { heatCapacityJK: oilJK(3) + caseJK(20), ua0WK: 4, uaRamWK: 10, uaEngineWK: 0, coolerWK: 0, churnW: 150, nRefRpm: 6000, clutchOilShare: 1, warnC: 130, protectC: null, damageC: 150, sharedSump: true },
  truck: { heatCapacityJK: oilJK(13) + caseJK(260), ua0WK: 15, uaRamWK: 40, uaEngineWK: 8, coolerWK: 300, churnW: 1500, nRefRpm: 1500, clutchOilShare: 0.15, warnC: 120, protectC: 130, damageC: 150 },
  bus: { heatCapacityJK: oilJK(26) + caseJK(350), ua0WK: 15, uaRamWK: 35, uaEngineWK: 8, coolerWK: 600, churnW: 2000, nRefRpm: 1500, clutchOilShare: 1, warnC: 120, protectC: 130, damageC: 150 },
};

/** Thermal spec of a gearbox: commercial presets by vehicle kind, otherwise by gearbox type. */
export function gearboxThermalKind(type: GearboxType, kind: VehicleKind = "car"): GearboxThermalKind {
  if (kind === "truck") return "truck";
  if (kind === "bus") return "bus";
  return type === "dsg" ? "dct" : type;
}

/** Warm-start temperature, °C (vehicle.md §8): 80 °C, or the coolant when that is lower. */
export const GEARBOX_WARM_C = 80;
/** Hysteresis of the warning and the protection mode, K. */
export const GEARBOX_HYST_K = 5;

/**
 * Relative oil viscosity φ(T) = ν(T)/ν(80 °C) ≈ exp(0.025·(80 − T)), limited to 0.7 … 12 (vehicle.md §8 [B13]).
 */
export function gearboxViscosityFactor(oilC: number): number {
  const t = Number.isFinite(oilC) ? oilC : 80;
  return Math.min(12, Math.max(0.7, Math.exp(0.025 * (80 - t))));
}

/** Efficiency loss of cold oil, Δη = 0.015·(√φ − 1), 0 … 0.05 (vehicle.md §8). */
export function gearboxDragPenalty(oilC: number): number {
  return Math.min(0.05, Math.max(0, 0.015 * (Math.sqrt(gearboxViscosityFactor(oilC)) - 1)));
}

export interface GearboxOilInput {
  /** Power through the gear set (input side, after the clutch/converter), W, any sign. */
  powerW: number;
  /** Gearbox efficiency with warm oil (GearboxSpec.efficiency). */
  efficiency: number;
  /** Slip power of the clutch (dry or wet), W ≥ 0. */
  clutchSlipW: number;
  /** Slip power of the torque converter (incl. a slipping lock-up clutch), W ≥ 0; always fully into the oil. */
  converterSlipW: number;
  /** Fastest shaft in the gearbox (input or output side), rpm. */
  shaftRpm: number;
  /** Ram air speed under the car, m/s. */
  airSpeedMs: number;
  ambientC: number;
  /** Engine coolant temperature (bell housing and oil-to-water cooler), °C. */
  coolantC: number;
  /** Oil cooler fitted (only acts where the spec has one). */
  cooler: boolean;
  /**
   * Aftermarket air-to-oil cooler (#100 addendum): UA in W/K at 25 m/s road speed, 0/undefined = none. It sits in the
   * ram air, so it scales with (v / 25 m/s)^AUX_COOLER_EXPONENT and does nothing at standstill (no fan), vehicle.md §8 [B19].
   */
  auxCoolerWK?: number;
}

/**
 * Aftermarket stacked-plate air-to-oil cooler, Setrab ProLine STD Series 6 with 19 rows (vehicle.md §8 [B19]):
 * ≈ 5 W/K per row at 3 m/s face velocity → 95 W/K, ×1.7 at 8 m/s → ≈ 160 W/K. A front-mounted cooler sees roughly a
 * third of the road speed as face velocity [S], so 8 m/s ≈ 25 m/s (90 km/h) on the road.
 */
export const AFTERMARKET_OIL_COOLER_WK = 160;
/** Air-side scaling of that cooler with face velocity: 1.7 from 3 to 8 m/s → ln 1.7 / ln(8/3) ≈ 0.54 [B19]. */
export const AUX_COOLER_EXPONENT = 0.54;

/** Heat into the oil, W (vehicle.md §8): (1 − η_eff)·|P| + churning(n, φ) + a·P_clutch + P_converter. */
export function gearboxHeatW(spec: GearboxThermalSpec, oilC: number, x: GearboxOilInput): number {
  const eta = Math.max(0.5, x.efficiency - gearboxDragPenalty(oilC));
  const n = Math.max(0, x.shaftRpm) / spec.nRefRpm;
  const churn = spec.churnW * n ** 1.5 * Math.sqrt(gearboxViscosityFactor(oilC));
  return (1 - eta) * Math.abs(x.powerW) + churn + spec.clutchOilShare * Math.max(0, x.clutchSlipW) + Math.max(0, x.converterSlipW);
}

/**
 * Advances the oil temperature by dt seconds (vehicle.md §8). Linearly implicit: the heat input is taken at the old
 * temperature, the heat rejection Σ UA_i·(T − T_i) is implicit, so any dt is stable.
 */
export function stepGearboxOil(spec: GearboxThermalSpec, oilC: number, dt: number, x: GearboxOilInput): number {
  const t0 = Number.isFinite(oilC) ? oilC : x.ambientC;
  if (!(dt > 0)) return t0;
  const q = gearboxHeatW(spec, t0, x);
  const uaAir = spec.ua0WK + spec.uaRamWK * (Math.max(0, x.airSpeedMs) / 25) ** 0.8;
  const uaCool = spec.uaEngineWK + (x.cooler ? spec.coolerWK : 0);
  // the aftermarket air cooler rejects to ambient air like the casing (vehicle.md §8 [B19])
  const uaAux = Math.max(0, x.auxCoolerWK ?? 0) * (Math.max(0, x.airSpeedMs) / 25) ** AUX_COOLER_EXPONENT;
  const k = dt / spec.heatCapacityJK;
  return (t0 + k * (q + (uaAir + uaAux) * x.ambientC + uaCool * x.coolantC)) / (1 + k * (uaAir + uaAux + uaCool));
}

/** Oil ageing / damage rate, 1/s (vehicle.md §8 [B18]): 2^((T − damageC)/10 K) / 600 s above the warning threshold. */
export function gearboxWearRate(spec: GearboxThermalSpec, oilC: number): number {
  if (!(oilC > spec.warnC)) return 0;
  return 2 ** ((oilC - spec.damageC) / 10) / 600;
}
