/**
 * Vehicle helpers shared by the simulator and the drivetrain (issues #25, #22). Pure functions, no DOM.
 */
import type { VehicleParams } from "./types.ts";

const G = 9.81;

/**
 * Wheelie limit of the drive force, N (issue #25): the front wheel lifts when the pitching moment of the drive
 * force about the rear contact patch, F·h, exceeds the weight moment m·g·l_r (l_r = CG ahead of the rear axle;
 * Cossalter, Motorcycle Dynamics, ch. 3 "wheelie limit"; aero drag acts at ≈ CG height, so F_drive is the total
 * force). Infinity for vehicles without CG data (cars).
 */
export function wheelieLimitN(v: VehicleParams): number {
  if (!(v.cgHeightM && v.cgHeightM > 0 && v.cgToRearAxleM && v.cgToRearAxleM > 0)) return Infinity;
  return (v.massKg * G * v.cgToRearAxleM) / v.cgHeightM;
}

/** Static share of the weight on the front axle (cgToRearAxleM / wheelbaseM); 0.6 without chassis data. */
export function frontAxleShare(v: VehicleParams): number {
  return v.cgToRearAxleM && v.wheelbaseM ? clamp(v.cgToRearAxleM / v.wheelbaseM, 0.05, 0.95) : 0.6;
}

/**
 * Normal force on the driven axle(s), N (issue #22), with longitudinal load transfer ΔN = m·a·h/l (accelerating:
 * the rear axle gains; Mitschke/Wallentowitz, Dynamik der Kraftfahrzeuge, "Achslastverlagerung"; Gillespie,
 * Fundamentals of Vehicle Dynamics, ch. 2). Vehicles without driveLayout return Infinity (no traction limit).
 * AWD: whole weight (centre differential assumed to split the torque in proportion to the axle loads).
 */
export function drivenAxleLoadN(v: VehicleParams, accelMs2: number): number {
  const layout = v.driveLayout;
  if (!layout) return Infinity;
  const w = v.massKg * G;
  if (layout === "awd") return w;
  const dN = v.cgHeightM && v.wheelbaseM ? (v.massKg * accelMs2 * v.cgHeightM) / v.wheelbaseM : 0;
  const front = frontAxleShare(v);
  const n = layout === "fwd" ? w * front - dN : w * (1 - front) + dN;
  return clamp(n, 0, w);
}

/** Brake system force capacity at full pedal, in g: enough to lock any tyre (ABS: issue #23) [S]. */
export const BRAKE_MAX_G = 1.6;

/**
 * Service-brake force at the driven wheels, N (issue #104): full-pedal capacity BRAKE_MAX_G·m·g split between the
 * axles by the static axle load (brake balance ≈ load distribution, Breuer/Bill, Bremsenhandbuch, ch. "Bremskraft-
 * verteilung", docs/research/vehicle.md [B20]) [S]; AWD: all four wheels are driven. 530d: ≈ 0.78·m·g on the rear axle.
 */
export function drivenBrakeN(v: VehicleParams, pedalB: number, cosGrade = 1): number {
  const w = v.massKg * G;
  const share = v.driveLayout === "awd" ? 1 : clamp(drivenAxleLoadN(v, 0) / w, 0, 1);
  return clamp(pedalB, 0, 1) * BRAKE_MAX_G * w * cosGrade * share;
}

/** Drive force the braked driven wheels hold at standstill before they spin: own brake + static tyre force μ·N_d, N (issue #104). */
export function brakeStandHoldN(v: VehicleParams, pedalB: number, mu: number, cosGrade = 1): number {
  return drivenBrakeN(v, pedalB, cosGrade) + Math.max(0, mu) * Math.min(v.massKg * G, drivenAxleLoadN(v, 0)) * cosGrade;
}

function clamp(x: number, lo: number, hi: number) {
  return x < lo ? lo : x > hi ? hi : x;
}
