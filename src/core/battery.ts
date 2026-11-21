/**
 * Traction battery (issue #108). Pure functions and a small state object, no DOM. docs/research/electric.md §3.
 *
 * Equivalent circuit R_int (Plett, Battery Management Systems Vol. 1, ch. 2.2 "simple cell model"): terminal
 * voltage U = U_OCV(SoC) − I·R_i(T). Pack = seriesCells in series × parallelCells in parallel:
 * U_pack = S·U_cell, Q_pack = P·Q_cell, R_pack = R_cell·S/P.
 *  - OCV curve per chemistry (electric.md §3.1, tables from published cell data).
 *  - R_i(T) Arrhenius: R(T) = R_25·exp(E_a/R_gas·(1/T − 1/298 K)), E_a ≈ 25 kJ/mol → ≈ 2.2 × at 0 °C (§3.2).
 *  - Power for a demand P: I = (U_OCV − √(U_OCV² − 4·R·P)) / (2R) (positive root of P = (U_OCV − I·R)·I).
 *  - Limits (§3.3): discharge current ≤ maxDischargeC · Q and the cell voltage ≥ U_min; charge (regen) current
 *    ≤ maxChargeC · Q · taper(SoC) · cold factor and the cell voltage ≤ U_max. Below 15 % SoC the BMS reduces power.
 *  - Heat (§3.4): Joule heat I²·R_i into a lumped pack (c ≈ 1000 J/(kg·K)) cooled by a cold plate (UA) to 25 °C.
 *    Above 55 °C the BMS derates the discharge power, to 20 % at 65 °C.
 *  - SoC: coulomb counting dSoC/dt = −I / (3600·Q).
 */
import type { EvBatteryConfig, EvChemistry } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Cell OCV vs. SoC (0 … 1 in steps of 0.1), V (electric.md §3.1). */
const OCV: Record<EvChemistry, readonly number[]> = {
  // NMC 811 / NCA high-energy cells (e.g. LG M50, Panasonic NCR18650B data sheets) [electric.md §3.1]
  nmc: [3.0, 3.45, 3.55, 3.62, 3.68, 3.74, 3.82, 3.9, 3.98, 4.07, 4.18],
  nca: [3.0, 3.42, 3.52, 3.6, 3.66, 3.73, 3.81, 3.89, 3.97, 4.06, 4.17],
  // LFP: flat plateau ≈ 3.3 V
  lfp: [2.6, 3.18, 3.24, 3.27, 3.29, 3.3, 3.31, 3.32, 3.33, 3.36, 3.45],
};
/** Cell voltage window under load, V. */
export const CELL_V_MIN: Record<EvChemistry, number> = { nmc: 2.9, nca: 2.9, lfp: 2.5 };
export const CELL_V_MAX: Record<EvChemistry, number> = { nmc: 4.2, nca: 4.2, lfp: 3.65 };
/** Specific energy of a pack incl. housing, kWh/kg, for the default pack mass (≈ 160 Wh/kg) [electric.md §3.4]. */
export const PACK_KWH_PER_KG = 0.16;
export const BATTERY_DERATE_C = 55;
export const BATTERY_CUTOFF_C = 65;
export const BATTERY_COOLANT_C = 25;
/** Arrhenius activation energy / gas constant, K (E_a ≈ 25 kJ/mol). */
const EA_R = 3000;

export function cellOcv(chem: EvChemistry, soc: number): number {
  const t = OCV[chem];
  const x = clamp(soc, 0, 1) * 10;
  const i = Math.min(9, Math.floor(x));
  return t[i]! + (t[i + 1]! - t[i]!) * (x - i);
}

export function packOcv(b: EvBatteryConfig, soc: number): number {
  return b.seriesCells * cellOcv(b.chemistry, soc);
}

/** Pack capacity, Ah. */
export function packAh(b: EvBatteryConfig): number {
  return b.parallelCells * b.cellAh;
}

/** Nominal pack voltage (OCV at 50 % SoC), V. */
export function nominalV(b: EvBatteryConfig): number {
  return packOcv(b, 0.5);
}

/** Pack energy from 0 to `soc`, kWh (∫ U_OCV dQ). Full pack: energy(b, 1). */
export function packEnergyKwh(b: EvBatteryConfig, soc = 1): number {
  const n = 40;
  let e = 0;
  const s = clamp(soc, 0, 1);
  for (let k = 0; k < n; k++) e += packOcv(b, ((k + 0.5) / n) * s);
  return (e / n) * s * packAh(b) / 1000;
}

/** Pack internal resistance at a temperature, Ω. */
export function packResistance(b: EvBatteryConfig, tempC: number): number {
  const r25 = (b.cellResistanceMOhm / 1000) * (b.seriesCells / Math.max(1, b.parallelCells));
  return r25 * Math.exp(EA_R * (1 / (clamp(tempC, -30, 80) + 273.15) - 1 / 298.15));
}

export function packMassKg(b: EvBatteryConfig): number {
  return b.massKg ?? packEnergyKwh(b) / PACK_KWH_PER_KG;
}

/** Discharge derating 1 … 0 by temperature and low SoC (BMS). */
export function dischargeDerate(soc: number, tempC: number): number {
  const hot = clamp(1 - (0.8 * (tempC - BATTERY_DERATE_C)) / (BATTERY_CUTOFF_C - BATTERY_DERATE_C), 0.2, 1);
  const low = soc <= 0 ? 0 : clamp(0.4 + (0.6 * soc) / 0.15, 0.4, 1);
  return hot * low;
}

/** Charge (regen) acceptance 0 … 1: tapers above 90 % SoC to 0 at 100 %, reduced in the cold (lithium plating). */
export function chargeAcceptance(soc: number, tempC: number): number {
  const taper = clamp((1 - soc) / 0.1, 0, 1);
  const cold = clamp((tempC + 10) / 25, 0.1, 1);
  return taper * cold;
}

export interface BatteryLimits {
  /** Max discharge / charge current, A (positive numbers). */
  maxDischargeA: number;
  maxChargeA: number;
  /** Max discharge / charge power at the terminals, kW. */
  maxDischargeKw: number;
  maxChargeKw: number;
}

export function batteryLimits(b: EvBatteryConfig, soc: number, tempC: number): BatteryLimits {
  const ocv = packOcv(b, soc);
  const R = packResistance(b, tempC);
  const q = packAh(b);
  const vMin = b.seriesCells * CELL_V_MIN[b.chemistry];
  const vMax = b.seriesCells * CELL_V_MAX[b.chemistry];
  // the terminal power has its maximum at I = U_OCV / 2R; the BMS stays on the rising side of it
  const iDis = Math.max(0, Math.min(b.maxDischargeC * q * dischargeDerate(soc, tempC), (ocv - vMin) / R, ocv / (2 * R)));
  const iChg = Math.max(0, Math.min(b.maxChargeC * q * chargeAcceptance(soc, tempC), (vMax - ocv) / R));
  return {
    maxDischargeA: iDis,
    maxChargeA: iChg,
    maxDischargeKw: ((ocv - iDis * R) * iDis) / 1000,
    maxChargeKw: ((ocv + iChg * R) * iChg) / 1000,
  };
}

/**
 * Current for a terminal power demand (+ discharge, − charge), A, at the given OCV and R. Discharge beyond the
 * matched-load maximum U²/4R returns the current of that maximum.
 */
export function currentForPower(ocv: number, R: number, powerKw: number): number {
  const p = powerKw * 1000;
  if (Math.abs(p) < 1e-6) return 0;
  const d = ocv * ocv - 4 * R * p;
  if (d <= 0) return ocv / (2 * R);
  return (ocv - Math.sqrt(d)) / (2 * R);
}

export interface BatteryState {
  soc: number;
  tempC: number;
  /** Last terminal voltage and current. */
  v: number;
  a: number;
}

/**
 * One step: draws `powerKw` (+ discharge, − charge) from the pack for dt seconds. Updates SoC, temperature, voltage
 * and current. The caller keeps the power within batteryLimits().
 */
export function stepBattery(b: EvBatteryConfig, st: BatteryState, powerKw: number, dt: number, ambientC: number): BatteryState {
  const ocv = packOcv(b, st.soc);
  const R = packResistance(b, st.tempC);
  const i = currentForPower(ocv, R, powerKw);
  const v = ocv - i * R;
  const soc = clamp(st.soc - (i * dt) / (3600 * packAh(b)), 0, 1);
  const C = packMassKg(b) * 1000;
  const ua = b.coolingWPerK ?? 400;
  const cool = Math.max(BATTERY_COOLANT_C, Math.min(ambientC, BATTERY_COOLANT_C + 10));
  // the chiller only cools; a cold pack warms by its own losses (no heater modelled)
  const q = i * i * R - (st.tempC > cool ? ua * (st.tempC - cool) : 0);
  return { soc, tempC: st.tempC + (q / C) * dt, v, a: i };
}
