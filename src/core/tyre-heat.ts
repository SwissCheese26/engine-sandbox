/**
 * Tyre heat, damage and blowout at overspeed (issue #144). Pure TypeScript, no DOM. docs/research/vehicle.md §11.
 *
 * One lumped temperature per vehicle: the hottest zone of the carcass (belt edge / shoulder) of the most loaded
 * tyre. Heat comes from the rolling-resistance hysteresis, which grows with speed, wheel load and low inflation
 * pressure; above the rated speed of the speed index the standing wave behind the contact patch makes it grow much
 * faster. Airflow cools it. Above TYRE_HEAT.limitC the rubber–cord bond degrades (reversion) and a damage value
 * builds up; at 1 the tread separates / the tyre bursts.
 *
 *   T_ss − T_amb = ΔT_R · L^1.2 · (p/p₀)^−0.8 · (r^1.3 + K_SW · max(0, r − 1)²),   r = v / v_index
 *   dT/dt        = (T_ss − T) / τ
 *   dD/dt        = x · 2^x / D₀ for T > limitC,  x = (T − limitC) / 10 K   (rate doubles every 10 K, Arrhenius)
 */

export const TYRE_HEAT = {
  /** Rise of the hot zone over ambient at the rated speed and the design load, K [S: vehicle.md §11, ECE R30 Annex 7]. */
  riseAtRatedK: 75,
  /** Standing-wave term above the rated speed [S: vehicle.md §11]. */
  standingWaveK: 40,
  /** Thermal time constant of the belt/shoulder zone, s [S]. */
  tauS: 240,
  /** Warning ("Reifen überhitzen") from this temperature, °C, with HYST_K hysteresis. */
  warnC: 105,
  hystK: 3,
  /** Damage threshold: reversion of the skim rubber / loss of rubber–steel adhesion, °C [S]. */
  limitC: 120,
  /** Damage time constant at limitC + 10 K, s. */
  damageS: 300,
  /** Stage (b): from this damage on the tyre vibrates (local separation, out-of-round) and grips less. */
  vibrationAt: 0.25,
  /** Grip left on the axle of a tyre that has failed, per vehicle class [S, vehicle.md §11]. */
  blownGrip: { car: 0.45, motorcycle: 0.25, commercial: 0.8 },
  /** Share of the vehicle's wheels on the failed one (car 4, motorcycle 2, truck/bus ≥ 6 tyres incl. twin tyres). */
  wheelShare: { car: 0.25, motorcycle: 0.5, commercial: 1 / 6 },
} as const;

export type TyreHeatClass = keyof typeof TYRE_HEAT.blownGrip;

/** Steady-state hot-zone temperature at speed (°C). load and pressure are relative to the design point (1). */
export function tyreHeatTarget(speedKmh: number, ratedKmh: number, ambientC: number, load = 1, pressure = 1): number {
  const r = Math.max(0, speedKmh) / Math.max(1, ratedKmh);
  const sw = Math.max(0, r - 1);
  const k = Math.pow(Math.max(0.2, load), 1.2) * Math.pow(Math.max(0.3, pressure), -0.8);
  return ambientC + TYRE_HEAT.riseAtRatedK * k * (Math.pow(r, 1.3) + TYRE_HEAT.standingWaveK * sw * sw);
}

/** One step of the hot-zone temperature (first order towards tyreHeatTarget). */
export function stepTyreHeat(tempC: number, dt: number, speedKmh: number, ratedKmh: number, ambientC: number, load = 1, pressure = 1): number {
  const target = tyreHeatTarget(speedKmh, ratedKmh, ambientC, load, pressure);
  const a = Math.min(1, Math.max(0, dt) / TYRE_HEAT.tauS);
  return Math.min(400, tempC + (target - tempC) * a);
}

/** Damage per second at a hot-zone temperature (0 up to limitC). */
export function tyreDamageRate(tempC: number): number {
  const x = (tempC - TYRE_HEAT.limitC) / 10;
  return x > 0 ? (x * Math.pow(2, Math.min(x, 20))) / TYRE_HEAT.damageS : 0;
}

/** Grip factor of the damaged tyre: 1 up to the vibration stage, then down to 0.7 before failure; blown: the class value. */
export function tyreGripFactor(damage: number, failed: boolean, cls: TyreHeatClass = "car"): number {
  if (failed) return TYRE_HEAT.blownGrip[cls];
  const v = TYRE_HEAT.vibrationAt;
  return damage <= v ? 1 : 1 - 0.3 * Math.min(1, (damage - v) / (1 - v));
}

/**
 * Extra rolling-resistance coefficient of the whole vehicle with one failed tyre [S, vehicle.md §11]: the flat tyre /
 * rim runs with f ≈ 0.1 at walking pace, the flailing tread and the rim on the road rise with v²
 * (f = 0.1·(1 + (v/25 m/s)²)), weighted with the wheel's share of the load.
 */
export function blowoutRollingExtra(speedMs: number, cls: TyreHeatClass = "car"): number {
  const v = Math.max(0, speedMs) / 25;
  return TYRE_HEAT.wheelShare[cls] * 0.1 * (1 + v * v);
}

/**
 * Time to failure at a constant speed ratio r = v / v_index, starting from the steady state at the rated speed, s;
 * Infinity when the tyre never fails (≤ 10 h). For tests and the research note.
 */
export function timeToTyreFailure(ratio: number, ratedKmh = 270, ambientC = 20, load = 1): number {
  let T = tyreHeatTarget(ratedKmh, ratedKmh, ambientC, load);
  let d = 0;
  const dt = 0.1;
  for (let t = 0; t < 36000; t += dt) {
    T = stepTyreHeat(T, dt, ratio * ratedKmh, ratedKmh, ambientC, load);
    d += tyreDamageRate(T) * dt;
    if (d >= 1) return t + dt;
  }
  return Infinity;
}
