// Live range of an electric car (#108, Arthur's review): remaining energy ÷ a rolling consumption, like the range
// estimate of real EVs ("Guess-o-Meter"): range = SoC × usable kWh ÷ consumption. The consumption is a weighted
// average over roughly the last 8 km or 5 minutes: energy and distance are summed with exponential forgetting (each
// step fades the old sums by e^−(Δs/8 km + Δt/300 s)). The sums start with the rated consumption over 5 km, which
// fades the same way, so the estimate starts at the rated value and moves smoothly to the driven one. Regen lowers
// the energy sum; the consumption used follows the average with a 30 s lag, so the range rises a little but never
// jumps (a charge or a new SoC still shows at once). Pure, no DOM; unit-tested.

export const RANGE_WINDOW_KM = 8;
export const RANGE_WINDOW_S = 300;
/** Distance the rated consumption counts for at the start, km. */
export const RANGE_PRIOR_KM = 5;
/** Lowest consumption the estimate uses, kWh/100 km (long regen downhill must not promise endless range). */
export const MIN_KWH_PER_100 = 8;
/** Lag of the shown consumption behind the rolling average, s. */
export const RANGE_LAG_S = 30;

export class RangeEstimator {
  private e: number;
  private d: number;
  private shown: number;

  constructor(private ratedKwhPer100: number) {
    this.shown = Math.max(MIN_KWH_PER_100, ratedKwhPer100);
    this.d = RANGE_PRIOR_KM;
    this.e = (ratedKwhPer100 / 100) * RANGE_PRIOR_KM;
  }

  /** One frame: battery power (kW, + = discharge, − = regen), speed (km/h), time step (s). */
  step(dt: number, powerKw: number, speedKmh: number) {
    if (!(dt > 0) || !Number.isFinite(powerKw) || !Number.isFinite(speedKmh)) return;
    const dKm = (Math.max(0, speedKmh) * dt) / 3600;
    // standing still: the energy still counts (air-con, heating), it fades by time only
    const k = Math.exp(-(dKm / RANGE_WINDOW_KM + dt / RANGE_WINDOW_S));
    this.e = this.e * k + (powerKw * dt) / 3600;
    this.d = this.d * k + dKm;
    // after a long stop the distance sum fades away: keep the rated value as a floor of weight
    if (this.d < 0.5) {
      const add = 0.5 - this.d;
      this.d += add;
      this.e += (this.ratedKwhPer100 / 100) * add;
    }
    this.shown += (this.average - this.shown) * Math.min(1, dt / RANGE_LAG_S);
  }

  /** Rolling weighted consumption, kWh/100 km. */
  get average(): number {
    return Math.max(MIN_KWH_PER_100, (this.e / this.d) * 100);
  }

  /** Consumption the range is computed with (the average, 30 s lag), kWh/100 km. */
  get kwhPer100(): number {
    return this.shown;
  }

  /** Range in km from the state of charge (0 … 1) and the usable energy of the pack (kWh). */
  rangeKm(soc: number, usableKwh: number): number {
    return (Math.max(0, Math.min(1, soc)) * usableKwh * 100) / this.kwhPer100;
  }
}
