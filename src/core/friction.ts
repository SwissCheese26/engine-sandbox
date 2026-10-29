/**
 * Friction mean effective pressure (Chen-Flynn) and gas-exchange (pumping) losses.
 * Pure functions, no DOM.
 */
import type { EngineConfig } from "./types.ts";

export interface FrictionParams {
  A: number;
  B: number;
  C: number;
  D: number;
  /** multiplicative factor (valvetrain, valves, pistons) */
  k: number;
  fuel: "diesel" | "petrol";
}

export function frictionParams(cfg: EngineConfig): FrictionParams {
  const h = cfg.head;
  if (cfg.fuel === "petrol") {
    // petrol.md §3.8: game calibration of Chen-Flynn, fmep = 0.30 + 0.006·pMax + 0.060·cm + 0.0012·cm²
    let k = { ohv: 0.92, sohc: 1.0, dohc: 1.04 }[h.valvetrain];
    k *= 1 + (0.03 * (h.valvesPerCylinder - 2)) / 3;
    return { A: 0.3, B: 0.006, C: 0.06, D: 0.0012, k, fuel: "petrol" };
  }
  // diesel.md §3.4 coefficient table (car ≤ 90 mm bore vs. truck > 100 mm, interpolated in between)
  const t = Math.min(1, Math.max(0, (cfg.block.boreMm - 90) / 10));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  let A = lerp(0.4, 0.5);
  const inj = cfg.fuelSystem.kind === "diesel" ? cfg.fuelSystem.injection : "common-rail";
  if (inj === "unit-injector") A += 0.05;
  if (inj === "indirect-prechamber" || inj === "indirect-swirl-chamber") A -= 0.05;
  if (inj === "mechanical-pump") A -= 0.02; // [S] cam-driven pump, lower pressure than CR high-pressure pump
  let k = { ohv: 1.03, sohc: 1.0, dohc: 1.02 }[h.valvetrain];
  k *= h.valvesPerCylinder <= 2 ? 0.97 : 1.0;
  if (cfg.block.pistons === "steel") k *= 1.03;
  return { A, B: lerp(0.005, 0.004), C: lerp(0.09, 0.08), D: lerp(0.0009, 0.0012), k, fuel: "diesel" };
}

/**
 * FMEP [bar] = (A + B·pMax + C·cm + D·cm²)·k·cold-oil factor.
 * Cold oil: petrol.md §3.8 (×(1 + 1.5·(90 − oil)/70)), diesel.md §3.4 (×(1 + 1.5·(80 − oil)/100)).
 */
export function fmepBar(p: FrictionParams, peakPressureBar: number, cm: number, oilC: number): number {
  const base = p.A + p.B * peakPressureBar + p.C * cm + p.D * cm * cm;
  const cold = p.fuel === "petrol" ? 1 + 1.5 * Math.max(0, (90 - oilC) / 70) : 1 + 1.5 * Math.max(0, (80 - oilC) / 100);
  return base * p.k * Math.min(cold, 3.5);
}
