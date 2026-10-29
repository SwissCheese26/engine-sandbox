/**
 * Charging subsystem: exhaust turbochargers (single, twin parallel, twin sequential, e-turbo) and
 * mechanically driven superchargers (Roots, centrifugal), plus charge-air temperature.
 *
 * Specification: docs/research/diesel.md §3.1 (compressor outlet temperature, intercooler),
 * §3.9 (turbocharger: shaft balance, inertia, Euler work, choke line), §4.4 (shaft speed limit);
 * docs/research/petrol.md §3.12 (wastegate, e-turbo, supercharger behaviour).
 *
 * Model (mean value, one shaft state):
 *   J·ω·dω/dt = P_T − P_C − P_loss                                   (diesel.md §3.9 "Vollmodell")
 *   P_C = ṁ_air·c_p·T1·(PR^((κ−1)/κ) − 1)/η_C                        (diesel.md §3.9)
 *   P_T = ṁ_exh·c_p,exh·T3·(1 − (p4/p3)^((κ−1)/κ))·η_T               (diesel.md §3.9)
 *   p3 follows from the turbine acting as a nozzle of effective area A_T (Saint-Venant flow
 *   function, standard compressible-flow relation); A_T ∝ D²·A/R, VTG closes it to 55 %.
 *   Boost follows from shaft speed via Euler work with μ·η_C = 0.7·0.7 (diesel.md §3.9 u2 formula).
 *   Boost control (wastegate/VTG) throttles the turbine power so that boost → demand
 *   (= boostTargetBar at full pedal); it can never exceed what the exhaust delivers.
 *   Lag therefore scales automatically with J ∝ D⁵ (diesel.md §3.9) and with A_T (A/R, VTG).
 *
 * Pure functions, no DOM.
 */
import type { EngineConfig } from "./types.ts";

// ---------------------------------------------------------------- constants (diesel.md §3.0)
const CP_AIR = 1005; // J/(kg K)
const KAPPA_AIR = 1.4;
const CP_EXH = 1150; // J/(kg K)
const KAPPA_EXH = 1.33;
const R_GAS = 287; // J/(kg K), air and exhaust (close enough for this model)
const EX_AIR = (KAPPA_AIR - 1) / KAPPA_AIR; // 0.2857
const EX_EXH = (KAPPA_EXH - 1) / KAPPA_EXH; // 0.248
/** Compressor inlet temperature used where the signature has no ambient temperature (ISO 25 °C). */
const T1_STD_K = 298.15;
/** μ·η_C in the Euler relation (diesel.md §3.9: work coefficient 0.7, η_C 0.7). */
const EULER_MU_ETA = 0.7 * 0.7;
/** Permissible compressor tip speed for aluminium wheels, m/s (diesel.md §4.4). */
const U2_MAX_MS = 520;
/** Turbine effective nozzle area coefficient: A_T = C_AREA · A/R · D² [S, calibrated: 2.0 l petrol
 *  with 45 mm / 0.55 wastegate turbo builds 1 bar at ~2000 rpm, 2.0 TDI 38 mm VTG 1.3 bar at ~1600 rpm]. */
const C_AREA = 0.3;
/** VTG vanes fully closed: fraction of the nominal turbine area [S]. */
const VTG_MIN_AREA = 0.55;
/** Boost controller time constant (wastegate/VTG actuator + ECU), s [S]. */
const TAU_CONTROL_S = 0.12;
/** Specific choke mass flow through the inducer, kg/(s m²) (diesel.md §3.9). */
const CHOKE_FLUX = 140;
/** Filling of intercooler, pipes and plenum between compressor and intake valves, s [S; petrol.md §2:
 *  intercooler pipe volume adds a little lag]. */
const TAU_PLENUM_IC_S = 0.1;
const TAU_PLENUM_S = 0.05;
/** Roots blower drive ratio (rotor rpm / crank rpm) [S, Eaton M-series 2 … 3]. */
const ROOTS_DRIVE_RATIO = 2.5;

export interface TurboState {
  shaftRpm: number;
  boostBar: number;
}

/** Equivalent single-shaft charger used internally for all exhaust-driven variants. */
interface ChargerUnit {
  /** Compressor outlet (tip) diameter in m: D2 ≈ inducer / 0.7 (diesel.md §3.9). */
  d2M: number;
  /** Rotor inertia, kg m²: J ≈ 2e-5 · (D/45)⁵ (diesel.md §3.9). */
  inertia: number;
  /** Nominal turbine nozzle area, m². */
  turbineAreaM2: number;
  vtg: boolean;
  etaT: number;
  /** Compressor choke mass flow, kg/s (diesel.md §3.9). */
  chokeKgS: number;
  /** Electric assist power (e-turbo), W. */
  electricW: number;
  /** Windage/bearing drag coefficient, W/(rad/s)³. */
  windage: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function isExhaustDriven(cfg: EngineConfig): boolean {
  const a = cfg.induction.aspiration;
  return a === "turbo" || a === "twin-turbo-parallel" || a === "twin-turbo-sequential" || a === "e-turbo";
}

function singleUnit(inducerMm: number, ar: number, vtg: boolean): ChargerUnit {
  const d = inducerMm / 1000;
  const scale = inducerMm / 45;
  return {
    d2M: d / 0.7,
    inertia: 2.0e-5 * scale ** 5,
    turbineAreaM2: C_AREA * ar * d * d,
    vtg,
    etaT: vtg ? 0.68 : 0.7, // diesel.md §3.9: η_T 0.65 … 0.75; vanes cost a little efficiency [S]
    chokeKgS: CHOKE_FLUX * (Math.PI / 4) * d * d,
    electricW: 0,
    // ≈ 200 W drag at 150 000 rpm for a 45 mm charger, ∝ D⁵ ω³ (disc windage) [S]
    windage: (200 / 15708 ** 3) * scale ** 5,
  };
}

/**
 * Builds the equivalent charger for the configured aspiration.
 * - twin-turbo-parallel: two chargers of D/√2 (same total flow area), J_total = 2·J(D/√2) ≈ 0.35·J(D).
 * - twin-turbo-sequential: small charger (0.75·D) alone at low exhaust flow, the large one (D) is
 *   blended in between 75 % and 100 % of the small charger's choke flow (diesel.md §3.9, N57 Tx).
 * - e-turbo: single charger plus 7 kW electric assist (diesel.md §3.9, petrol.md §3.12: 5 … 10 kW).
 */
function chargerUnit(cfg: EngineConfig, exhaustMassFlowKgS: number, largeStage?: number): ChargerUnit {
  const ind = cfg.induction;
  const D = Math.max(15, ind.compressorInducerMm);
  const ar = Math.max(0.2, ind.turbineAR);
  switch (ind.aspiration) {
    case "twin-turbo-parallel": {
      const u = singleUnit(D / Math.SQRT2, ar, ind.variableGeometry);
      return {
        ...u,
        inertia: 2 * u.inertia,
        turbineAreaM2: 2 * u.turbineAreaM2,
        chokeKgS: 2 * u.chokeKgS,
        windage: 2 * u.windage,
      };
    }
    case "twin-turbo-sequential": {
      const s = singleUnit(SEQ_SMALL * D, ar, ind.variableGeometry);
      const l = singleUnit(D, ar, ind.variableGeometry);
      const w = largeStage ?? sequentialLargeStage(cfg, exhaustMassFlowKgS);
      return {
        d2M: (1 - w) * s.d2M + w * l.d2M,
        inertia: s.inertia + w * l.inertia,
        turbineAreaM2: s.turbineAreaM2 + w * l.turbineAreaM2,
        vtg: s.vtg,
        etaT: s.etaT,
        chokeKgS: s.chokeKgS + w * l.chokeKgS,
        electricW: 0,
        windage: s.windage + w * l.windage,
      };
    }
    case "e-turbo": {
      const u = singleUnit(D, ar, ind.variableGeometry);
      return { ...u, electricW: 7000 * Math.max(1, (D / 45) ** 2) };
    }
    default:
      return singleUnit(D, ar, ind.variableGeometry);
  }
}

/** Small stage of a sequential twin relative to the configured inducer [S]. */
const SEQ_SMALL = 0.75;

/** Share 0 … 1 of the large stage of a sequential twin at an exhaust flow (switch-over valve). */
function sequentialLargeStage(cfg: EngineConfig, exhaustMassFlowKgS: number): number {
  const dSmall = (SEQ_SMALL * Math.max(15, cfg.induction.compressorInducerMm)) / 1000;
  const chokeSmall = CHOKE_FLUX * (Math.PI / 4) * dSmall * dSmall;
  return smoothstep(0.75, 1.0, exhaustMassFlowKgS / chokeSmall);
}

/** Compressor isentropic efficiency vs. flow relative to choke (diesel.md §3.1 η_C ≈ 0.70, §3.9 choke). */
function compressorEfficiency(airKgS: number, chokeKgS: number): number {
  const x = airKgS / Math.max(1e-6, chokeKgS);
  const eta = 0.72 * (1 - 0.6 * Math.max(0, 0.2 - x)) - 4 * Math.max(0, x - 0.9) ** 2;
  return clamp(eta, 0.35, 0.72);
}

/** Pressure ratio delivered at a shaft speed (Euler work, diesel.md §3.9). */
function prFromShaft(shaftRpm: number, d2M: number, t1K: number): number {
  const u2 = (shaftRpm * Math.PI * d2M) / 60;
  return (1 + (EULER_MU_ETA * u2 * u2) / (CP_AIR * t1K)) ** (1 / EX_AIR);
}

/** Shaft speed needed for a pressure ratio (inverse of prFromShaft). */
function shaftFromPr(pr: number, d2M: number, t1K: number): number {
  const u2 = Math.sqrt(Math.max(0, (pr ** EX_AIR - 1) * CP_AIR * t1K) / EULER_MU_ETA);
  return (u2 * 60) / (Math.PI * d2M);
}

/** Compressor inlet pressure, Pa. The air-filter loss (diesel.md §3.1, ≈ 2 kPa at rated flow) depends on
 *  the air flow and is applied by the air path (Kern-Physik); boost here is relative to ambient. */
function inletPressurePa(ambientKpa: number): number {
  return ambientKpa * 1000;
}

function boostFromPr(pr: number, ambientKpa: number): number {
  return Math.max(0, (inletPressurePa(ambientKpa) * pr - ambientKpa * 1000) / 1e5);
}

function prFromBoost(boostBar: number, ambientKpa: number): number {
  return (ambientKpa * 1000 + boostBar * 1e5) / inletPressurePa(ambientKpa);
}

/** Compressor power, W (diesel.md §3.9). */
function compressorPowerW(airKgS: number, pr: number, etaC: number, t1K: number): number {
  return (airKgS * CP_AIR * t1K * (Math.max(1, pr) ** EX_AIR - 1)) / etaC;
}

/** Saint-Venant flow function for a nozzle, pr = p_down / p_up (standard compressible flow). */
function flowFunction(pr: number): number {
  const k = KAPPA_EXH;
  const crit = (2 / (k + 1)) ** (k / (k - 1));
  const p = Math.max(pr, crit);
  return Math.sqrt(((2 * k) / (k - 1)) * (p ** (2 / k) - p ** ((k + 1) / k)));
}

/** Pressure downstream of the turbine (exhaust system back pressure), Pa [S, diesel.md §3.4, ExhaustConfig]. */
function turbineOutletPa(cfg: EngineConfig, ambientKpa: number): number {
  return ambientKpa * 1000 + 3000 + (cfg.exhaust.catalyst ? 3000 : 0) + (cfg.exhaust.particulateFilter ? 8000 : 0);
}

/**
 * Maximum turbine power with wastegate closed / VTG vanes closed, W.
 * p3 is found from ṁ = A_T·p3·Ψ(p4/p3)/√(R·T3) by bisection.
 */
function turbinePowerMaxW(cfg: EngineConfig, u: ChargerUnit, exhKgS: number, egtC: number, ambientKpa: number): number {
  if (exhKgS <= 1e-6) return 0;
  const t3 = Math.max(300, egtC + 273.15);
  const p4 = turbineOutletPa(cfg, ambientKpa);
  const area = u.turbineAreaM2 * (u.vtg ? VTG_MIN_AREA : 1);
  const sq = Math.sqrt(R_GAS * t3);
  let lo = p4;
  let hi = 25 * p4;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    const m = (area * mid * flowFunction(p4 / mid)) / sq;
    if (m > exhKgS) hi = mid;
    else lo = mid;
  }
  const p3 = 0.5 * (lo + hi);
  // Pulse energy: short tubular manifolds feed the turbine better (petrol.md §2 manifold row, diesel.md §1 ExhaustConfig).
  const manifold = { "cast-log": 1.0, "tubular-short": 1.05, "tubular-long": 1.02 }[cfg.exhaust.manifold];
  return exhKgS * CP_EXH * t3 * (1 - (p4 / p3) ** EX_EXH) * u.etaT * manifold;
}

/** Boost demand of the controller at a pedal position (diesel: boost map over injected quantity) [S]. */
function boostDemandBar(cfg: EngineConfig, pedal: number): number {
  return Math.max(0, cfg.induction.boostTargetBar) * clamp((pedal - 0.15) / 0.75, 0, 1);
}

/** Roots blower: boost rises linearly with rpm until the bypass valve holds the target at half the rev limit. */
function rootsBoostBar(cfg: EngineConfig, rpm: number): number {
  return Math.max(0, cfg.induction.boostTargetBar) * clamp(rpm / (0.5 * cfg.revLimitRpm), 0, 1);
}

/** Centrifugal supercharger: drive ratio chosen so the target is reached at the rev limit; PR from Euler (∝ rpm²). */
function centrifugalShaftRpm(cfg: EngineConfig, rpm: number, ambientKpa: number): number {
  const d2 = Math.max(15, cfg.induction.compressorInducerMm) / 1000 / 0.7;
  const atRedline = shaftFromPr(prFromBoost(Math.max(0, cfg.induction.boostTargetBar), ambientKpa), d2, T1_STD_K);
  return (atRedline * Math.max(0, rpm)) / Math.max(1, cfg.revLimitRpm);
}

function centrifugalBoostBar(cfg: EngineConfig, rpm: number, ambientKpa: number): number {
  const d2 = Math.max(15, cfg.induction.compressorInducerMm) / 1000 / 0.7;
  return boostFromPr(prFromShaft(centrifugalShaftRpm(cfg, rpm, ambientKpa), d2, T1_STD_K), ambientKpa);
}

/** Maximum permissible charger shaft speed, rpm: u2 = 520 m/s (diesel.md §4.4). 0 for naturally aspirated. */
export function turboMaxRpm(cfg: EngineConfig): number {
  const a = cfg.induction.aspiration;
  if (a === "naturally-aspirated") return 0;
  if (a === "supercharger-roots") return 18000; // Roots rotor limit [S, Eaton TVS ≈ 18 000 rpm]
  const D = Math.max(15, cfg.induction.compressorInducerMm);
  // The most exposed wheel: half-size wheels for parallel twins, the small stage for sequential twins.
  const dCrit = a === "twin-turbo-parallel" ? D / Math.SQRT2 : a === "twin-turbo-sequential" ? SEQ_SMALL * D : D;
  return (U2_MAX_MS * 60) / (Math.PI * (dCrit / 1000 / 0.7));
}

/**
 * Steady-state full-load boost (gauge bar) for dyno sweeps: power balance P_T,max (+ e-assist) = P_C + losses,
 * capped at boostTargetBar. The caller may iterate with the resulting exhaust flow (fixed point).
 */
export function steadyBoostBar(cfg: EngineConfig, rpm: number, exhaustMassFlowKgS: number, egtC: number, ambientKpa: number): number {
  const a = cfg.induction.aspiration;
  const target = Math.max(0, cfg.induction.boostTargetBar);
  if (a === "naturally-aspirated" || target <= 0) return 0;
  if (a === "supercharger-roots") return rootsBoostBar(cfg, rpm);
  if (a === "supercharger-centrifugal") return Math.min(target, centrifugalBoostBar(cfg, rpm, ambientKpa));
  if (a === "twin-turbo-sequential") {
    // The ECU switches registers where it pays off: take the better of small-only and both stages.
    return Math.max(
      steadyExhaustBoost(cfg, chargerUnit(cfg, exhaustMassFlowKgS, 0), exhaustMassFlowKgS, egtC, ambientKpa, target),
      steadyExhaustBoost(cfg, chargerUnit(cfg, exhaustMassFlowKgS, 1), exhaustMassFlowKgS, egtC, ambientKpa, target),
    );
  }
  return steadyExhaustBoost(cfg, chargerUnit(cfg, exhaustMassFlowKgS), exhaustMassFlowKgS, egtC, ambientKpa, target);
}

function steadyExhaustBoost(cfg: EngineConfig, u: ChargerUnit, exhaustMassFlowKgS: number, egtC: number, ambientKpa: number, target: number): number {
  const air = 0.95 * Math.max(0, exhaustMassFlowKgS); // ≈ 5 % of the exhaust mass is fuel
  if (air <= 1e-6) return 0;
  const etaC = compressorEfficiency(air, u.chokeKgS);
  // 2 % bearing loss. E-turbo assist is transient (battery), so the steady dyno curve equals the plain turbo.
  const pt = turbinePowerMaxW(cfg, u, exhaustMassFlowKgS, egtC, ambientKpa) * 0.98;
  // Fixed point including windage (depends on the shaft speed reached).
  let pr = 1;
  for (let i = 0; i < 4; i++) {
    const omega = (shaftFromPr(pr, u.d2M, T1_STD_K) * Math.PI) / 30;
    const avail = Math.max(0, pt - u.windage * omega ** 3);
    pr = (1 + (avail * etaC) / (air * CP_AIR * T1_STD_K)) ** (1 / EX_AIR);
    if (boostFromPr(pr, ambientKpa) >= target) return target;
  }
  return Math.min(target, boostFromPr(pr, ambientKpa));
}

/**
 * Advances the charger by dt seconds (sub-stepped internally at ≤ 5 ms).
 * Exhaust turbos: shaft power balance with inertia; superchargers: mechanically coupled, near-instant.
 */
export function stepTurbo(
  s: TurboState,
  cfg: EngineConfig,
  dt: number,
  exhaustMassFlowKgS: number,
  egtC: number,
  pedal: number,
  rpm: number,
  ambientKpa: number,
): TurboState {
  const a = cfg.induction.aspiration;
  if (a === "naturally-aspirated" || !(dt > 0)) return a === "naturally-aspirated" ? { shaftRpm: 0, boostBar: 0 } : { ...s };
  const demand = boostDemandBar(cfg, pedal);
  const target = Math.max(0, cfg.induction.boostTargetBar);

  if (a === "supercharger-roots" || a === "supercharger-centrifugal") {
    // Positive displacement / gear-driven: boost follows crank speed, only the manifold filling lags (τ ≈ 80 ms) [S].
    const avail = a === "supercharger-roots" ? rootsBoostBar(cfg, rpm) : Math.min(target, centrifugalBoostBar(cfg, rpm, ambientKpa));
    const set = target > 0 ? avail * (demand / target) : 0;
    const k = 1 - Math.exp(-dt / 0.08);
    const shaftRpm = a === "supercharger-roots" ? ROOTS_DRIVE_RATIO * Math.max(0, rpm) : centrifugalShaftRpm(cfg, rpm, ambientKpa);
    return { shaftRpm, boostBar: Math.max(0, s.boostBar + (set - s.boostBar) * k) };
  }

  const u = chargerUnit(cfg, exhaustMassFlowKgS);
  const air = 0.95 * Math.max(0, exhaustMassFlowKgS);
  const etaC = compressorEfficiency(air, u.chokeKgS);
  const ptMax = turbinePowerMaxW(cfg, u, exhaustMassFlowKgS, egtC, ambientKpa);
  const omegaTarget = (shaftFromPr(prFromBoost(demand, ambientKpa), u.d2M, T1_STD_K) * Math.PI) / 30;
  const n = Math.max(1, Math.ceil(dt / 0.005));
  const h = dt / n;
  let omega = Math.max(0, (s.shaftRpm * Math.PI) / 30);
  for (let i = 0; i < n; i++) {
    const pr = prFromShaft((omega * 30) / Math.PI, u.d2M, T1_STD_K);
    const pc = compressorPowerW(air, pr, etaC, T1_STD_K);
    const drag = u.windage * omega ** 3;
    // Controller wants: hold compressor + losses, plus accelerate towards the target speed.
    const want = (pc + drag + (u.inertia * omega * (omegaTarget - omega)) / TAU_CONTROL_S) / 0.98;
    // Wastegate fully open / VTG fully open still passes a little power through the turbine [S].
    const turbine = clamp(want, 0.08 * ptMax, ptMax);
    const electric = want > ptMax && omega < omegaTarget ? Math.min(u.electricW, want - ptMax) : 0;
    const net = 0.98 * turbine + electric - pc - drag;
    omega = Math.max(0, omega + (net / (u.inertia * Math.max(omega, 500))) * h);
  }
  const shaftRpm = (omega * 30) / Math.PI;
  const compressorBoost = boostFromPr(prFromShaft(shaftRpm, u.d2M, T1_STD_K), ambientKpa);
  const tauPlenum = cfg.induction.intercooler === "none" ? TAU_PLENUM_S : TAU_PLENUM_IC_S;
  const boostBar = s.boostBar + (compressorBoost - s.boostBar) * (1 - Math.exp(-dt / tauPlenum));
  return { shaftRpm, boostBar: Math.max(0, boostBar) };
}

/**
 * Mechanical drive power of a supercharger at a crank speed and boost, kW (petrol.md §3.12: 10 … 15 % of
 * engine power). Air flow estimated from displacement with η_vol 0.9 at the charge density after the
 * compressor. 0 for exhaust-driven chargers and naturally aspirated engines.
 */
export function superchargerPowerKw(cfg: EngineConfig, rpm: number, boostBar: number): number {
  const a = cfg.induction.aspiration;
  if (a !== "supercharger-roots" && a !== "supercharger-centrifugal") return 0;
  if (rpm <= 0) return 0;
  const { boreMm, strokeMm, cylinders } = cfg.block;
  const vh = (Math.PI / 4) * (boreMm / 1000) ** 2 * (strokeMm / 1000) * cylinders; // m³
  const pr = prFromBoost(Math.max(0, boostBar), 101.325);
  // Roots: adiabatic efficiency ≈ 0.55 (internal back-flow), centrifugal ≈ 0.70; belt/gear drive 0.95 [S].
  const eta = a === "supercharger-roots" ? 0.55 : 0.7;
  const t2 = T1_STD_K * (1 + (pr ** EX_AIR - 1) / eta);
  const rho = (101325 + Math.max(0, boostBar) * 1e5) / (R_GAS * t2);
  const air = 0.9 * rho * vh * (rpm / 120);
  const idleDrag = a === "supercharger-roots" ? 0.3 * (rpm / 6000) ** 2 : 0; // rotor/bearing drag even with bypass open [S]
  return compressorPowerW(air, pr, eta, T1_STD_K) / 0.95 / 1000 + idleDrag;
}

/**
 * Charge-air temperature in the intake manifold, °C (diesel.md §3.1):
 * T2 = T1·(1 + (PR^((κ−1)/κ) − 1)/η_C), then intercooler effectiveness T3 = T2 − ε·(T2 − T_sink)
 * with ε = 0 / 0.75 / 0.85 and T_sink = ambient (air-to-air) or ambient + 15 K (air-to-water LT circuit).
 */
export function chargeAirTempC(cfg: EngineConfig, boostBar: number, ambientC: number): number {
  const a = cfg.induction.aspiration;
  if (a === "naturally-aspirated" || boostBar <= 0) return ambientC;
  const etaC = a === "supercharger-roots" ? 0.55 : a === "supercharger-centrifugal" ? 0.72 : 0.7;
  const t1 = ambientC + 273.15;
  const pr = prFromBoost(boostBar, 101.325);
  const t2 = t1 * (1 + (pr ** EX_AIR - 1) / etaC);
  const ic = cfg.induction.intercooler;
  const eps = { none: 0, "air-to-air": 0.75, "air-to-water": 0.85 }[ic];
  const sink = ic === "air-to-water" ? t1 + 15 : t1;
  return t2 - eps * (t2 - sink) - 273.15;
}

/** Compressor outlet temperature before the intercooler, °C (diesel.md §4.4: > 190 °C warning). */
export function compressorOutletTempC(cfg: EngineConfig, boostBar: number, ambientC: number): number {
  if (cfg.induction.aspiration === "naturally-aspirated" || boostBar <= 0) return ambientC;
  const noIc: EngineConfig = { ...cfg, induction: { ...cfg.induction, intercooler: "none" } };
  return chargeAirTempC(noIc, boostBar, ambientC);
}

/** Exposed for tests and the adapter: whether the charger is exhaust driven (has turbo lag). */
export function hasTurboLag(cfg: EngineConfig): boolean {
  return isExhaustDriven(cfg);
}
