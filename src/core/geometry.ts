/**
 * Crank train geometry: displacement, piston speed, firing intervals and firing order, inertia.
 * Pure functions, no DOM.
 */
import type { EngineConfig } from "./types.ts";

/** Total swept volume [m³] (petrol.md §3.1, diesel.md §3.0; Pischinger/Heywood). */
export function sweptVolumeM3(cfg: EngineConfig): number {
  const B = cfg.block.boreMm / 1000;
  const S = cfg.block.strokeMm / 1000;
  return (Math.PI / 4) * B * B * S * cfg.block.cylinders;
}

export function displacementLiters(cfg: EngineConfig): number {
  return sweptVolumeM3(cfg) * 1000;
}

/** Mean piston speed cm = 2·S·n/60 [m/s] (petrol.md §3.1). */
export function meanPistonSpeed(strokeMm: number, rpm: number): number {
  return (2 * (strokeMm / 1000) * rpm) / 60;
}

/** Rpm at which the mean piston speed reaches `cm` (inverse of meanPistonSpeed). */
export function rpmAtPistonSpeed(strokeMm: number, cm: number): number {
  return (30 * cm) / (strokeMm / 1000);
}

const even = (n: number) => Array.from({ length: n }, () => 720 / n);

/**
 * Firing intervals in crank degrees, sum 720 (petrol.md §6.2 table).
 * Decisions where the table offers alternatives (documented in the PR):
 * - V6 at any bank angle: even 120° (modern split-pin crank); the common-pin 90° Buick pattern is not modelled.
 * - V10 at 90°: common crankpins → alternating 90/54° (Viper); otherwise even 72°.
 * - V-twin: common crankpin → 360+α / 360−α (e.g. 45° → 405/315).
 * - V8 crossplane and flatplane both fire evenly every 90°; the difference is the per-bank pattern (firing order).
 */
export function firingIntervalsDeg(cfg: EngineConfig): number[] {
  const { layout, cylinders: n, bankAngleDeg } = cfg.block;
  if (n <= 1) return [720];
  if (layout === "v") {
    if (n === 2) {
      const a = Math.min(180, Math.max(0, bankAngleDeg));
      return [360 + a, 360 - a];
    }
    if (n === 10 && Math.abs(bankAngleDeg - 90) < 1) return [90, 54, 90, 54, 90, 54, 90, 54, 90, 54];
  }
  return even(n);
}

const FIRING_ORDERS: Record<string, number[]> = {
  inline2: [1, 2],
  inline3: [1, 2, 3],
  inline4: [1, 3, 4, 2],
  inline5: [1, 2, 4, 5, 3],
  inline6: [1, 5, 3, 6, 2, 4],
  inline8: [1, 6, 2, 5, 8, 3, 7, 4],
  boxer2: [1, 2],
  boxer4: [1, 3, 2, 4],
  boxer6: [1, 6, 2, 4, 3, 5],
  v2: [1, 2],
  v4: [1, 3, 2, 4],
  v6: [1, 4, 2, 5, 3, 6],
  // GM LS (petrol.md §6.2 [B]); bank left = 1,3,5,7, right = 2,4,6,8
  v8crossplane: [1, 8, 7, 2, 6, 5, 4, 3],
  // Ferrari flatplane (petrol.md §6.2 [S]); bank A = 1–4, B = 5–8
  v8flatplane: [1, 5, 3, 7, 4, 8, 2, 6],
  v10: [1, 6, 5, 10, 2, 7, 3, 8, 4, 9],
  v12: [1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10],
  vr5: [1, 2, 4, 5, 3],
  vr6: [1, 5, 3, 6, 2, 4],
};

/** Firing order (1-based cylinder numbers), petrol.md §6.2; unknown combinations fall back to 1…n. */
export function firingOrder(cfg: EngineConfig): number[] {
  const { layout, cylinders: n, v8Crank } = cfg.block;
  const key = layout === "v" && n === 8 ? `v8${v8Crank}` : `${layout}${n}`;
  const order = FIRING_ORDERS[key];
  if (order && order.length === n) return order.slice();
  return Array.from({ length: Math.max(1, n) }, (_, i) => i + 1);
}

/**
 * Rotating inertia of crank train + flywheel [kg·m²] (diesel.md §3.11, Pkw 0.15 … 0.4).
 * Petrol engines use the same law ×0.8 (lighter single-mass flywheels) [S].
 */
export function crankInertia(cfg: EngineConfig): number {
  const Vl = displacementLiters(cfg);
  let J = 0.1 + 0.07 * Vl;
  if (cfg.block.boreMm > 100) J *= 1.8;
  if (cfg.block.crankshaft === "billet") J *= 0.92;
  if (cfg.block.crankshaft === "forged") J *= 0.97;
  if (cfg.fuel === "petrol") J *= 0.8;
  return J;
}
