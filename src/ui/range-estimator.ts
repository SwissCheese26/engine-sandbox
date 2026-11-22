// Live range of every vehicle (#108, generalised for fuel in "Reichweite für alle"): remaining energy ÷ a rolling
// consumption, like the board computer of a real car ("Guess-o-Meter"):
//   electric: range = SoC × usable kWh ÷ consumption (kWh/100 km)
//   fuel:     range = tank litres ÷ consumption (l/100 km)
// The consumption is a weighted average over roughly the last 8 km or 5 minutes: energy and distance are summed with
// exponential forgetting (each step fades the old sums by e^−(Δs/8 km + Δt/300 s)). The sums start with the rated
// consumption over 5 km, which fades the same way, so the estimate starts at the rated value and moves smoothly to the
// driven one. Regen (EV) lowers the energy sum; the consumption used follows the average with a 30 s lag, so the
// range moves but never jumps (refuelling, a charge or a new SoC still shows at once). Pure, no DOM; unit-tested.
import type { FuelKind, VehicleParams } from "../core/index.ts";

export const RANGE_WINDOW_KM = 8;
export const RANGE_WINDOW_S = 300;
/** Distance the rated consumption counts for at the start, km. */
export const RANGE_PRIOR_KM = 5;
/** Lowest consumption the estimate uses, kWh/100 km (long regen downhill must not promise endless range). */
export const MIN_KWH_PER_100 = 8;
/** Lowest consumption for fuel, l/100 km (a long coast with fuel cut-off must not promise endless range). */
export const MIN_L_PER_100 = 2;
/** Lag of the shown consumption behind the rolling average, s. */
export const RANGE_LAG_S = 30;

export type RangeKind = "fuel" | "electric";

export class RangeEstimator {
  private e: number;
  private d: number;
  private shown: number;
  private readonly floor: number;

  /**
   * @param rated rated consumption per 100 km (kWh for "electric", litres for "fuel"): the value at the start
   * @param kind what the energy is counted in; sets the consumption floor
   */
  constructor(
    private rated: number,
    readonly kind: RangeKind = "electric",
  ) {
    this.floor = kind === "fuel" ? MIN_L_PER_100 : MIN_KWH_PER_100;
    if (!(rated > 0) || !Number.isFinite(rated)) this.rated = rated = this.floor;
    this.shown = Math.max(this.floor, rated);
    this.d = RANGE_PRIOR_KM;
    this.e = (rated / 100) * RANGE_PRIOR_KM;
  }

  /**
   * One frame: energy flow (kW of battery power, + = discharge, − = regen; or l/h of fuel flow), speed (km/h),
   * time step (s).
   */
  step(dt: number, rate: number, speedKmh: number) {
    if (!(dt > 0) || !Number.isFinite(rate) || !Number.isFinite(speedKmh)) return;
    // fuel never flows back into the tank
    const flow = this.kind === "fuel" ? Math.max(0, rate) : rate;
    const dKm = (Math.max(0, speedKmh) * dt) / 3600;
    // standing still: the energy still counts (idling, air-con, heating), it fades by time only
    const k = Math.exp(-(dKm / RANGE_WINDOW_KM + dt / RANGE_WINDOW_S));
    this.e = this.e * k + (flow * dt) / 3600;
    this.d = this.d * k + dKm;
    // after a long stop the distance sum fades away: keep the rated value as a floor of weight
    if (this.d < 0.5) {
      const add = 0.5 - this.d;
      this.d += add;
      this.e += (this.rated / 100) * add;
    }
    this.shown += (this.average - this.shown) * Math.min(1, dt / RANGE_LAG_S);
  }

  /** Rolling weighted consumption per 100 km (kWh or l). */
  get average(): number {
    return Math.max(this.floor, (this.e / this.d) * 100);
  }

  /** Consumption the range is computed with (the average, 30 s lag), per 100 km. */
  get per100(): number {
    return this.shown;
  }

  /** Range in km from the remaining energy (usable kWh in the pack, or litres in the tank); never negative. */
  rangeKm(remaining: number): number {
    return Number.isFinite(remaining) ? (Math.max(0, remaining) * 100) / this.shown : Number.NaN;
  }
}

/** Usable energy left in a pack, kWh: state of charge (0 … 1) × usable capacity. */
export function packKwhLeft(soc: number, usableKwh: number): number {
  return Math.max(0, Math.min(1, soc)) * usableKwh;
}

/**
 * Rated consumption of a combustion vehicle, l/100 km, for the start of the range estimate (cars carry no WLTP value
 * here). Road load at a steady reference speed (100 km/h, 80 km/h for trucks and buses):
 *   F = ½·ρ·cW·A·v² + m·g·f_R   (driving resistance, Mitschke/Wallentowitz, Dynamik der Kraftfahrzeuge, ch. 2)
 *   V = F·100 km ÷ (η · Hu · ρ_fuel) × 1.15
 * with η the tank-to-wheel efficiency at part load (petrol 0.25, diesel 0.30; a heavy diesel near its best point on the
 * motorway 0.40: best point ≈ 190 g/kWh ≈ 45 % effective, less the drivetrain), Hu and density from
 * docs/research/petrol.md §3.4 (petrol 43.0 MJ/kg, 0.745 kg/l) and diesel EN 590 (42.6 MJ/kg, 0.835 kg/l), and 15 %
 * for accelerating and idling in a mixed cycle (5 % for heavy vehicles, mostly steady motorway). Compact petrol car ≈ 7 l, diesel ≈ 5 l, 40 t truck ≈ 30 l.
 */
export function ratedLPer100(v: Pick<VehicleParams, "massKg" | "dragCoefficient" | "frontalAreaM2" | "rollingResistance">, fuel: FuelKind, heavy = false): number {
  const ms = (heavy ? 80 : 100) / 3.6;
  const fN = 0.5 * 1.2 * v.dragCoefficient * v.frontalAreaM2 * ms * ms + v.massKg * 9.81 * v.rollingResistance;
  const mjPerL = fuel === "diesel" ? 42.6 * 0.835 : 43.0 * 0.745;
  const eta = fuel === "diesel" ? (heavy ? 0.4 : 0.3) : 0.25;
  const l = ((fN * 1e5) / 1e6 / (eta * mjPerL)) * (heavy ? 1.05 : 1.15);
  return Number.isFinite(l) && l > 0 ? Math.max(MIN_L_PER_100, l) : 7;
}
