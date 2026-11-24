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

/**
 * Frictional slip heating of the tread (issue #149, docs/research/vehicle.md §12). Spinning (burnout) or locked
 * (skid) wheels slide over the road with v_slip = |ω·r − v|; the friction power P = F_x · v_slip turns into heat in
 * the contact patch, about 60 % of it into the tread, the rest into the road [S: §12, R5–R7]. Two nodes on top of the
 * rolling-heat models (linear heat conduction, so the slip part superposes on them):
 *
 *   C_t · dΔT_t/dt = s·P/n − C_t/τ_t · (ΔT_t − ΔT_c)       tread surface layer, τ_t ≈ 5 s
 *   C_c · dΔT_c/dt = k · C_t/τ_t · (ΔT_t − ΔT_c) − C_c/τ_c · ΔT_c   carcass, τ_c = TYRE_HEAT.tauS
 *   C_t = ρ·c · δ · b · 2π·r  (δ ≈ 1 mm: thermal penetration depth √(α·t) of rubber over ≈ 10 s, α ≈ 1·10⁻⁷ m²/s)
 *
 * Wear: the abraded tread volume grows with the friction energy (Schallamach/Grosch [R6]); above ≈ 150 °C the
 * compound degrades and the rate doubles every 25 K (calibrated so a full burnout of a ≈ 300 kW rear-drive car
 * wears the tread through in ≈ 40–60 s [K: §12]).
 */
export const TYRE_SLIP = {
  /** Share of the friction power that goes into the tyre (rest: road surface) [S: §12, R5]. */
  treadShare: 0.6,
  /** Volumetric heat capacity of tread rubber, J/(m³·K): ρ ≈ 1150 kg/m³, c ≈ 1.8 kJ/(kg·K) [S: R7]. */
  rhoC: 1150 * 1800,
  /** Effective heated surface layer, m (thermal penetration depth, see above). */
  layerM: 0.001,
  /** Time constant of the tread surface towards carcass and air, s [S: §12]. */
  tauTreadS: 5,
  /** Share of the heat leaving the tread that soaks into the carcass (rest: air and road). */
  toCarcass: 0.5,
  /** Heat capacity of a 225/45 R17 carcass (≈ 10 kg rubber, steel, textile, c ≈ 1.5 kJ/(kg·K)), J/K [S]. */
  carcassRefJK: 15000,
  /** Friction energy per m² of tread that wears it through at moderate temperature, J/m² [K: §12]. */
  wearJPerM2: 25e6,
  /** Wear acceleration: from wearHotC on, ×2 every wearDoubleK [K: §12]. */
  wearHotC: 150,
  wearDoubleK: 25,
  /** Contact patch length of a car tyre, m (F_z / (p·b) ≈ 4 kN / (2.5 bar · 0.2 m) ≈ 0.08 m, tread pressure peaks ≈ 0.12 m) [S: R2]. */
  lockedBandM: 0.9,
  /** Wear acceleration cap (thermal degradation saturates; flat spots of one emergency stop do not destroy a tyre). */
  wearHotMax: 8,
  /** "Lauffläche überhitzt" from this surface temperature (over the hot zone of #144), °C, with TYRE_HEAT.hystK. */
  warnC: 130,
} as const;

/** Slip-heat state per (hottest) driven tyre: tread and carcass excess over the rolling-heat models (K), wear 0 … 1. */
export interface TyreSlipHeat {
  treadK: number;
  carcassK: number;
  wear: number;
}

export const NO_SLIP_HEAT: Readonly<TyreSlipHeat> = { treadK: 0, carcassK: 0, wear: 0 };

/** Tread area (contact band around the circumference), m². */
function treadAreaM2(widthMm: number, radiusM: number): number {
  return Math.max(0.05, widthMm / 1000) * 2 * Math.PI * Math.max(0.15, radiusM);
}

/**
 * Heat capacity of the heated tread surface layer, J/K. A spinning wheel spreads the heat over the whole
 * circumference; a locked wheel only over its contact patch (flat spot, length ≈ TYRE_SLIP.lockedBandM).
 */
export function treadHeatCapJK(widthMm: number, radiusM: number, locked = false): number {
  const band = locked ? TYRE_SLIP.lockedBandM / (2 * Math.PI * Math.max(0.15, radiusM)) : 1;
  return TYRE_SLIP.rhoC * TYRE_SLIP.layerM * treadAreaM2(widthMm, radiusM) * band;
}

/** Heat capacity of the carcass, scaled from the 225/45 R17 reference with width × radius, J/K. */
export function carcassHeatCapJK(widthMm: number, radiusM: number): number {
  return TYRE_SLIP.carcassRefJK * (Math.max(50, widthMm) * Math.max(0.15, radiusM)) / (225 * 0.315);
}

/**
 * One step of the slip heat of one tyre. frictionW: friction power F_x·v_slip at this tyre (all of it, the tread
 * share is applied here); treadC: current tread surface temperature for the wear rate. sliding: the tyre slides
 * (spin or lock); below the μ peak the contact patch mostly adheres (creep) and does not abrade [R6]. locked: the heat
 * stays in the flat spot. dt is split so τ_t stays resolved at any frame rate.
 */
export function stepTyreSlipHeat(st: TyreSlipHeat, dt: number, frictionW: number, widthMm: number, radiusM: number, treadC: number, sliding = true, locked = false): TyreSlipHeat {
  const Ct = treadHeatCapJK(widthMm, radiusM, locked);
  const Cc = carcassHeatCapJK(widthMm, radiusM);
  const P = Math.max(0, Number.isFinite(frictionW) ? frictionW : 0);
  const G = Ct / TYRE_SLIP.tauTreadS;
  let { treadK, carcassK } = st;
  const n = Math.max(1, Math.ceil(Math.max(0, dt) / 0.05));
  const h = Math.max(0, dt) / n;
  for (let k = 0; k < n; k++) {
    const q = G * (treadK - carcassK);
    treadK += ((TYRE_SLIP.treadShare * P - q) / Ct) * h;
    carcassK += ((TYRE_SLIP.toCarcass * q - (Cc / TYRE_HEAT.tauS) * carcassK) / Cc) * h;
  }
  const hot = Math.min(TYRE_SLIP.wearHotMax, Math.pow(2, Math.max(0, (treadC - TYRE_SLIP.wearHotC) / TYRE_SLIP.wearDoubleK)));
  const wear = st.wear + (sliding ? 1 : 0) * (P * hot * Math.max(0, dt)) / (TYRE_SLIP.wearJPerM2 * treadAreaM2(widthMm, radiusM));
  return { treadK: Math.min(500, Math.max(0, treadK)), carcassK: Math.min(300, Math.max(0, carcassK)), wear: Math.min(1, wear) };
}

/**
 * Constant-power burnout of one tyre from ambient (tests, research note): tread surface °C after `seconds` and the time
 * until the tread is worn through (s, Infinity if not within `maxS`). frictionW per tyre.
 */
export function burnoutRun(frictionW: number, seconds: number, widthMm = 245, radiusM = 0.33, ambientC = 20, maxS = 600) {
  let st: TyreSlipHeat = { ...NO_SLIP_HEAT };
  let treadC = ambientC;
  let atT = Number.NaN;
  let failS = Infinity;
  const dt = 0.05;
  for (let t = 0; t < Math.max(seconds, maxS) - 1e-9; t += dt) {
    st = stepTyreSlipHeat(st, dt, frictionW, widthMm, radiusM, ambientC + st.treadK);
    treadC = ambientC + st.treadK;
    if (Number.isNaN(atT) && t + dt >= seconds - 1e-9) atT = treadC;
    if (st.wear >= 1 && !Number.isFinite(failS)) failS = t + dt;
    if (!Number.isNaN(atT) && Number.isFinite(failS)) break;
  }
  return { treadC: atT, failS };
}
