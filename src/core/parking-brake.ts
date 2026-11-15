/**
 * Parking brake and Auto-Hold (issue #91), docs/research/vehicle.md §7. No DOM.
 *
 * Holding limit: UN ECE R13-H §5.2.2.3 asks the parking brake to hold the laden car on a 20 % up- or down-gradient
 * (StVZO §41, type approval); series electric parking brakes are laid out with a margin, here 30 % [S]. The brake acts
 * through the tyres, so it can never hold more than μ·N of the braked (rear) axle (Bosch, Kraftfahrtechnisches
 * Taschenbuch, "Elektromechanische Feststellbremse") [B2].
 *
 * Auto-Hold (vehicle.md §7): engages at walking pace without throttle when the driver brakes, the engine is off, the
 * gearbox is in N or the car has (almost) stopped; it releases on drive-away (throttle with a gear engaged) or by hand.
 */
import { frontAxleShare } from "./vehicle.ts";
import type { VehicleParams } from "./types.ts";

/** Auto-Hold engages at or below this speed, km/h. */
export const AUTO_HOLD_MAX_KMH = 5;
/** Below this speed without throttle the car counts as stopped and Auto-Hold engages, km/h. */
export const AUTO_HOLD_STOP_KMH = 1;
/** Holding limit of the parking brake, % gradient (ECE R13-H: ≥ 20 %, with margin) [S]. */
export const PARK_BRAKE_HOLD_PCT = 30;
/**
 * Auto-Hold with the engine running holds with the ESP hydraulic unit on all four wheels; the parking brake takes over
 * when the engine is off (Bosch, Kraftfahrtechnisches Taschenbuch, "ESP-Zusatzfunktionen: Auto-Hold") [B2]. Hydraulic
 * holding pressure in g of the vehicle weight, ≈ a firm stop pedal [S]. The sum is limited by μ·m·g (tyres).
 */
export const AUTO_HOLD_HYDRAULIC_G = 0.5;
/** Pedal above which drive-away releases the brake (the automated clutch starts to bite at 0.02). */
export const HOLD_RELEASE_PEDAL = 0.02;
/** Pedal below which the throttle counts as closed for Auto-Hold. */
export const HOLD_ENGAGE_PEDAL = 0.01;

const G = 9.81;

/** What Auto-Hold looks at in one frame. */
export interface AutoHoldInput {
  speedKmh: number;
  /** Commanded accelerator pedal 0 … 1. */
  pedal: number;
  /** Service brake 0 … 1. */
  brake: number;
  running: boolean;
  /** Gear 0 = N. */
  gear: number;
}

/** Auto-Hold engages: walking pace, no throttle, and braking / engine off / N / already stopped. */
export function autoHoldEngages(x: AutoHoldInput): boolean {
  if (!(x.speedKmh <= AUTO_HOLD_MAX_KMH) || !(x.pedal < HOLD_ENGAGE_PEDAL)) return false;
  return x.brake > 0.05 || !x.running || x.gear === 0 || x.speedKmh < AUTO_HOLD_STOP_KMH;
}

/**
 * Holding force of the applied parking brake on the road, N: the smaller of the design limit
 * m·g·sin(atan(PARK_BRAKE_HOLD_PCT/100)) and the tyre limit μ·N_rear (rear axle share from the CG position,
 * vehicle.ts; a car without chassis data uses 45 % rear) [S]. cosGrade scales the normal force on a slope.
 */
export function parkBrakeCapN(veh: VehicleParams, mu: number, cosGrade = 1): number {
  const m = veh.massKg;
  const design = m * G * Math.sin(Math.atan(PARK_BRAKE_HOLD_PCT / 100));
  const share = veh.cgToRearAxleM !== undefined && veh.wheelbaseM !== undefined ? 1 - frontAxleShare(veh) : 0.45;
  const tyre = Math.max(0, mu) * m * G * cosGrade * Math.min(1, Math.max(0.2, share));
  return Math.min(design, tyre);
}

/**
 * Total static holding force while held, N: parking brake (parkBrakeCapN) plus, with the engine running, the Auto-Hold
 * hydraulic pressure on all wheels (AUTO_HOLD_HYDRAULIC_G); never more than the tyres carry, μ·m·g·cos θ.
 */
export function holdCapN(veh: VehicleParams, mu: number, cosGrade = 1, engineRunning = false): number {
  const m = veh.massKg;
  const hyd = engineRunning ? AUTO_HOLD_HYDRAULIC_G * m * G * cosGrade : 0;
  return Math.min(Math.max(0, mu) * m * G * cosGrade, parkBrakeCapN(veh, mu, cosGrade) + hyd);
}
