/**
 * Vehicle helpers shared by the simulator and the drivetrain (issue #25). Pure functions, no DOM.
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
