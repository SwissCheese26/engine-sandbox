/**
 * Petrol (spark ignition) combustion: λ strategy, Otto efficiency with Gütegrad, ignition timing,
 * knock model, exhaust temperature, peak pressure. docs/research/petrol.md §3.4 … §3.11.
 * Pure functions, no DOM.
 */
import { PETROL_FUELS } from "./fuels.ts";
import type { EngineConfig, PetrolFuelSystem } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export interface PetrolConsts {
  fs: PetrolFuelSystem;
  eps: number;
  bore: number;
  lhv: number;
  afr: number;
  density: number;
  ronFuel: number;
  etaOtto: number;
  etaG0: number;
  epsEff: number;
  maxRetard: number;
  egr: boolean;
}

export function petrolConsts(cfg: EngineConfig): PetrolConsts {
  if (cfg.fuelSystem.kind !== "petrol") throw new Error("petrolConsts: not a petrol config");
  const fs = cfg.fuelSystem;
  const f = PETROL_FUELS[fs.fuel];
  const eps = cfg.block.compressionRatio;
  // §3.5 Otto cycle with effective κ = 1.30
  const etaOtto = 1 - Math.pow(eps, 1 - 1.3);
  // §3.5 Gütegrad
  let etaG = 0.84; // spec 0.82, fine calibration 0.82 → 0.85 allowed by §3.8 "Fazit"; 0.84 chosen (PR table)
  if (cfg.head.valvesPerCylinder === 2) etaG -= 0.03;
  if (fs.mixture === "carburettor") etaG -= 0.04;
  if (cfg.block.boreMm > 95) etaG -= 0.001 * (cfg.block.boreMm - 95);
  if (cfg.exhaust.egr) etaG *= 0.99; // petrol.md §1 Exhaust: EGR −1 % power
  // §3.6 effective compression for knock: DI evaporative cooling ≈ 1 compression point
  let epsEff = eps;
  if (fs.mixture === "direct-injection" || fs.mixture === "dual-injection") epsEff -= 1.0;
  const ronFuel = f.ron + (fs.fuel === "e85" && (fs.mixture === "direct-injection" || fs.mixture === "dual-injection") ? 2 : 0);
  return {
    fs, eps, bore: cfg.block.boreMm, lhv: f.lhvJkg, afr: f.afr, density: f.densityKgL, ronFuel, etaOtto, etaG0: etaG,
    epsEff, maxRetard: fs.mixture === "carburettor" ? 0 : 15, egr: cfg.exhaust.egr,
  };
}

/**
 * λ strategy (§3.4): stoichiometric below 80 % load (catalyst), enrichment to fullLoadLambda by 95 %,
 * cold-start enrichment ×0.85 below 20 °C coolant, linear to 1 at 60 °C.
 */
export function petrolLambda(c: PetrolConsts, load: number, coolantC: number): number {
  let lam = load < 0.8 ? 1.0 : 1.0 + (c.fs.fullLoadLambda - 1.0) * Math.min(1, (load - 0.8) / 0.15);
  lam *= 0.85 + 0.15 * clamp((coolantC - 20) / 40, 0, 1);
  return lam;
}

/** Relative indicated work at equal air mass vs. λ (§3.5). */
export function lambdaWorkFactor(lam: number): number {
  const d = 1 - lam;
  if (lam <= 1) return 1 + 0.6 * d - 2.5 * d * d;
  const e = lam - 1;
  return Math.max(0.1, 1 - 0.55 * e - 0.5 * e * e);
}

/**
 * Required octane number (§3.6), evaluated at the calibrated ignition (no knock retard).
 * Returns the margin ronFuel − ronReq (> 0 knock-free).
 */
export function knockMargin(c: PetrolConsts, manifoldAbsKpa: number, TManC: number, coolantC: number, rpm: number, lam: number): number {
  const pAbs = manifoldAbsKpa / 100;
  const ronReq = 90
    + 4.0 * (c.epsEff - 10)
    + 22 * Math.log(Math.max(pAbs, 0.2))
    + 0.2 * (TManC - 40)
    + 0.1 * Math.max(0, coolantC - 90)
    + 0.8 * c.fs.ignitionAdvanceOffsetDeg
    - 1.5 * Math.min(4, Math.max(-1, (rpm - 2000) / 1000))
    - 20 * Math.max(0, 1 - lam)
    + 0.15 * (c.bore - 86)
    - (c.egr ? 2 : 0); // petrol.md §1: EGR cools, −2 RON requirement
  return c.ronFuel - ronReq;
}

/** Knock control target retard [°CA] (§3.6): enough to bring the margin to 0, limited to maxRetard. */
export function neededRetard(c: PetrolConsts, margin: number): number {
  return Math.min(c.maxRetard, Math.max(0, -margin / 0.8));
}

/** Remaining knock intensity 0 … 1 (§3.6). */
export function knockIntensity(margin: number, retardDeg: number): number {
  const residual = -margin - 0.8 * retardDeg;
  return clamp(residual / 5, 0, 1);
}

export interface PetrolCombustion {
  imepBar: number;
  peakPressureBar: number;
  egtC: number;
  dIgn: number;
}

/** Indicated work, peak pressure and exhaust temperature (§3.5, §3.9 … §3.11). */
export function petrolCombustion(c: PetrolConsts, rpm: number, mAirCyc: number, mFuelCyc: number, lam: number, Vh: number, retardDeg: number, manifoldAbsKpa: number, TManC: number, load: number): PetrolCombustion {
  const dIgn = c.fs.ignitionAdvanceOffsetDeg - retardDeg;
  if (mFuelCyc <= 1e-9) {
    const pComp = (manifoldAbsKpa / 100) * Math.pow(c.eps, 1.3);
    return { imepBar: 0, peakPressureBar: pComp, egtC: TManC, dIgn };
  }
  const etaG = c.etaG0 * (1 - 0.1 * Math.exp(-rpm / 1500)); // wall heat at low rpm
  const etaLam = lam * lambdaWorkFactor(lam);
  const etaIgn = Math.max(0.3, 1 - 0.0005 * dIgn * dIgn);
  // lean misfire beyond λ 1.35 (§3.5)
  const misfire = lam > 1.35 ? clamp(1 - (lam - 1.35) / 0.3, 0, 1) : 1;
  const Wi = c.etaOtto * etaG * etaLam * etaIgn * misfire * mFuelCyc * c.lhv;
  const imepBar = Wi / Vh / 1e5;
  // §3.11 peak pressure
  const pComp = (manifoldAbsKpa / 100) * Math.pow(c.eps, 1.3);
  const peakPressureBar = pComp + 3.6 * imepBar * Math.max(0.3, 1 + 0.03 * dIgn);
  // §3.10 exhaust temperature
  const Qrel = (mAirCyc / c.afr) * c.lhv * Math.min(1, 1 / lam);
  let fExh = 0.36 + 0.006 * Math.max(0, -dIgn) + (0.02 * rpm) / 6000;
  fExh *= 0.75 + 0.25 * clamp(load, 0, 1);
  let egtC = TManC + (fExh * Qrel) / ((mAirCyc + mFuelCyc) * 1200);
  egtC -= 600 * Math.max(0, 1 - lam);
  return { imepBar, peakPressureBar, egtC, dIgn };
}
