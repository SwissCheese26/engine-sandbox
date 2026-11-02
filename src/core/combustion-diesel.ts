/**
 * Diesel combustion (qualitative load control): fuel quantity limits, Seiliger efficiency,
 * peak pressure, exhaust temperature, smoke. docs/research/diesel.md §3.2 … §3.8.
 * Pure functions, no DOM.
 */
import { DIESEL_FUELS } from "./fuels.ts";
import type { DieselFuelSystem, DieselInjection, EngineConfig } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Injection system table (diesel.md §3.3): piK, phiK, Gütegrad, reference pressure. */
export const INJECTION_SYSTEMS: Record<DieselInjection, { piK: number; phiK: number; guete: number; pInjRef: number }> = {
  "common-rail": { piK: 0.7, phiK: 0.9, guete: 0.8, pInjRef: 1800 },
  "unit-injector": { piK: 0.8, phiK: 0.85, guete: 0.78, pInjRef: 2050 },
  "indirect-swirl-chamber": { piK: 0.4, phiK: 1.1, guete: 0.68, pInjRef: 350 },
  "indirect-prechamber": { piK: 0.35, phiK: 1.2, guete: 0.65, pInjRef: 300 },
  // Lead decision (mechanical inline/distributor pump): diesel.md §7 suggests Gütegrad ≈ 0.74,
  // no pilot injection → slightly more pressure rise than CR; pInjRef 900 bar [S].
  // pInjRef 1800 bar: delivery capacity referenced like a CR system, so a 1000 bar pump is fuel-limited
  // (old fuel-plate calibrations, e.g. Cummins 6BT bmep ≈ 12.7 bar) [S, PR].
  "mechanical-pump": { piK: 0.75, phiK: 0.95, guete: 0.74, pInjRef: 1800 },
};

/** Seiliger (dual) cycle efficiency (diesel.md §3.3, Pischinger/Merker, Heywood). */
export function etaSeiliger(eps: number, pi: number, phi: number, kappa = 1.35): number {
  return 1 - (1 / eps ** (kappa - 1)) * (pi * phi ** kappa - 1) / (pi - 1 + kappa * pi * (phi - 1));
}

export interface DieselConsts {
  fs: DieselFuelSystem;
  eps: number;
  bore: number;
  lhv: number;
  afr: number;
  density: number;
  sootFactor: number;
  sys: (typeof INJECTION_SYSTEMS)[DieselInjection];
  /** Gütegrad without the λ term (injection pressure, timing, bore). */
  guete0: number;
  /** Injection capacity coefficient: mFuelInjMax = kInj·√p·window (diesel.md §3.2c), set in cycle.ts. */
  kInj: number;
  /** Reference speed for kInj [rpm] (end of the torque plateau). */
  nC: number;
  lambda50: number;
  egr: boolean;
  dpf: boolean;
  revLimit: number;
}

export function dieselConsts(cfg: EngineConfig): DieselConsts {
  if (cfg.fuelSystem.kind !== "diesel") throw new Error("dieselConsts: not a diesel config");
  const fs = cfg.fuelSystem;
  const f = DIESEL_FUELS[fs.fuel];
  const sys = INJECTION_SYSTEMS[fs.injection] ?? INJECTION_SYSTEMS["common-rail"];
  // Calibration factor 0.96 on the Gütegrad of diesel.md §3.3 [S]: centres the reference engines'
  // peak torque (N57, OM654, DV6, VW PD) inside ±10 % (PR calibration table); BSFC stays at 195 … 205 g/kWh.
  let g = sys.guete * 0.96;
  // diesel.md §3.3: injection pressure refines atomisation (DI only)
  if (fs.injection === "common-rail" || fs.injection === "unit-injector" || fs.injection === "mechanical-pump") {
    g *= 1 + 0.03 * Math.log(Math.max(50, fs.injectionPressureBar) / sys.pInjRef);
  }
  // diesel.md §3.3: quadratic loss around the optimum start of injection
  g *= Math.max(0.5, 1 - 0.0012 * fs.injectionTimingOffsetDeg ** 2);
  // diesel.md §3.3: small combustion chambers lose more wall heat
  g *= 1 - 0.04 * Math.max(0, (80 - cfg.block.boreMm) / 20);
  // diesel.md §3.8: λ at 50 % opacity
  let lambda50 = 0.95 + 0.3 * Math.sqrt(500 / Math.max(50, fs.injectionPressureBar));
  lambda50 += 0.004 * Math.max(0, -fs.injectionTimingOffsetDeg);
  if (fs.injection === "mechanical-pump") lambda50 += 0.05; // no pilot/multiple injection → more soot [S]
  return {
    fs, eps: cfg.block.compressionRatio, bore: cfg.block.boreMm, lhv: f.lhvJkg, afr: f.afr, density: f.densityKgL,
    sootFactor: f.sootFactor, sys, guete0: g, kInj: 0, nC: 3000, lambda50, egr: cfg.exhaust.egr, dpf: cfg.exhaust.particulateFilter,
    revLimit: cfg.revLimitRpm,
  };
}

/** Smoke-limited full-load fuel mass per cycle [kg] (diesel.md §3.2b): mAir/(AFR_st·λ_smoke). */
export function smokeLimitFuel(c: DieselConsts, mAirCyc: number): number {
  return mAirCyc / (c.afr * c.fs.smokeLimitLambda);
}

/**
 * Injection capacity per cycle [kg] (diesel.md §3.2c): ∝ √Δp · injection time.
 * Deviation [S, PR]: the spec's fixed 35 °CA window (time ∝ 1/n) makes the torque fall so fast that the
 * power peak sits right at the end of the plateau; real calibrations widen the window in °CA with speed.
 * Time ∝ n^−0.7 puts the power peak at ≈ 0.75 … 0.85·revLimit like the reference engines.
 * `kInj` is defined against the reference speed n_c (cycle.ts).
 */
export function injectionCapacity(c: DieselConsts, rpm: number): number {
  // mechanical (plunger) pumps meter a fixed stroke per cycle: capacity independent of rpm [S]
  const time = c.fs.injection === "mechanical-pump" ? 1 : Math.pow(c.nC / Math.max(200, rpm), 0.7);
  return c.kInj * Math.sqrt(Math.max(50, c.fs.injectionPressureBar)) * time;
}

/** Governor ramp (diesel.md §3.2d): quantity ramps to 0 over ≈ 250 rpm around the limit. */
export function governor(c: DieselConsts, rpm: number): number {
  return clamp((c.revLimit + 50 - rpm) / 250, 0, 1);
}

export interface DieselCombustion {
  lambda: number;
  etaI: number;
  pi: number;
  imepBar: number;
  peakPressureBar: number;
  egtC: number;
  smoke: number;
  xWall: number;
}

/**
 * Indicated cycle for given air and fuel (diesel.md §3.3, §3.6, §3.7, §3.8).
 * @param pIntBar manifold pressure abs [bar], TintK charge temperature
 */
export function dieselCombustion(c: DieselConsts, mAirCyc: number, mFuelCyc: number, Vh: number, pIntBar: number, TintK: number, coolantC: number, egrRate: number): DieselCombustion {
  const fuelOk = mFuelCyc > 1e-9;
  const lambda = fuelOk ? clamp(mAirCyc / (mFuelCyc * c.afr), 0.3, 99) : 99;
  // §3.3 pressure rise / cut-off ratios grow with fuel per air
  const pi = 1 + c.sys.piK / lambda;
  const phi = 1 + c.sys.phiK / lambda;
  let g = c.guete0;
  g *= 1 - Math.min(0.08, 0.02 * Math.max(0, lambda - 3)); // very lean part load burns slower/colder
  if (egrRate > 0) g *= 1 - 0.04 * egrRate; // EGR costs ~1–2 % η_i at typical rates (diesel.md §3.1)
  const etaI = Math.max(0.05, etaSeiliger(c.eps, pi, phi) * g);
  const imepBar = fuelOk ? (etaI * mFuelCyc * c.lhv) / Vh / 1e5 : 0;
  // §3.6 peak pressure: compression end pressure × pressure rise, timing ±3 %/°CA
  const pComp = pIntBar * c.eps ** 1.33;
  let pMax = fuelOk ? pComp * pi * (1 + 0.03 * c.fs.injectionTimingOffsetDeg) : pComp;
  pMax = Math.max(pComp, pMax);
  // §3.7 exhaust temperature from the energy balance
  const xWall = 0.18 + 0.1 * clamp((lambda - 1.2) / 4, 0, 1);
  const Qfuel = mFuelCyc * c.lhv;
  // late injection: lower η_i already moves energy to the exhaust; extra after-burning share [S]
  const late = Math.max(0, -c.fs.injectionTimingOffsetDeg) * 0.006;
  const dT = (Qfuel * Math.max(0, 1 - etaI - xWall + late)) / ((mAirCyc + mFuelCyc) * 1150);
  const egtC = TintK + dT - 273.15;
  // §3.8 smoke opacity (logistic in λ)
  let smoke = 0;
  if (fuelOk) {
    const l50 = c.lambda50 + (egrRate > 0.05 ? 0.03 : 0);
    smoke = (1 / (1 + Math.exp((lambda - l50) / 0.06))) * c.sootFactor;
    if (coolantC < 40) smoke = Math.max(smoke, 0.15 * (1 - Math.max(0, coolantC) / 40));
    if (c.dpf) smoke *= 0.02;
  }
  return { lambda, etaI, pi, imepBar, peakPressureBar: pMax, egtC, smoke: clamp(smoke, 0, 1), xWall };
}

/**
 * Diesel compression ignition condition (diesel.md §3.11). Glow plugs are assumed fitted
 * (lead decision: glow plugs not in v0.1 scope, behaviour as in the spec).
 */
export function dieselFires(c: DieselConsts, rpm: number, TintK: number, coolantC: number): boolean {
  const indirect = c.fs.injection === "indirect-prechamber" || c.fs.injection === "indirect-swirl-chamber";
  if (rpm < (indirect ? 150 : 100)) return false;
  const nCrank = 1.25 + 0.08 * Math.min(1, rpm / 250);
  const Tcomp = TintK * c.eps ** (nCrank - 1);
  const glow = coolantC < 60;
  return Tcomp > 650 || (glow && Tcomp > 540);
}
