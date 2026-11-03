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

function clamp(x: number, lo: number, hi: number) {
  return x < lo ? lo : x > hi ? hi : x;
}
