/**
 * Air path: volumetric efficiency, charge-air temperature, throttle flow and manifold pressure.
 * Pure functions, no DOM.
 */
import { CP_AIR, KAPPA_AIR, R_AIR } from "./fuels.ts";
import { rpmAtPistonSpeed } from "./geometry.ts";
import type { EngineConfig } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Static VE parameters, precomputed once per config. */
export interface VeParams {
  fuel: "diesel" | "petrol";
  // petrol (petrol.md §3.2)
  vePeak: number;
  nPeak: number;
  wLo: number;
  wHi: number;
  /** cam-switching: second (high) cam curve, 0 = none */
  nPeakHigh: number;
  wLoHigh: number;
  wHiHigh: number;
  nSwitch: number;
  lowRpmPenalty: number;
  resonanceScale: number;
  runnerLeffM: number;
  // diesel (diesel.md §3.1)
  dVeMax: number;
  dNPeak: number;
  dWidth: number;
  /** valve float onset rpm (petrol.md §4 / diesel.md §4.1) */
  nFloat: number;
  /** exhaust manifold gain on VE above the VE peak (petrol.md §2 "manifold log → tubular-long"; diesel.md §1 Exhaust) */
  manifoldGain: number;
}

const VVT_WIDEN = { none: 1.0, "intake-cam": 1.15, "dual-cam": 1.3, "cam-switching": 1.35 } as const;

/** Valve float rpm. Petrol: petrol.md §4 "Ventilflattern"; diesel: diesel.md §4.1. */
export function valveFloatRpm(cfg: EngineConfig): number {
  const h = cfg.head;
  if (cfg.fuel === "diesel") {
    // diesel.md §4.1: nFloat ≈ 5600 · (1 − 0.15·ohv) · (1 + 0.1·cam)
    return 5600 * (h.valvetrain === "ohv" ? 0.85 : 1) * (1 + 0.1 * h.camProfile);
  }
  const base = { ohv: 6600, sohc: 7400, dohc: 8200 }[h.valvetrain];
  return base * (h.valvesPerCylinder >= 4 ? 1.08 : 1.0) * (1 + 0.1 * h.camProfile) * Math.sqrt(86 / cfg.block.boreMm);
}

export function veParams(cfg: EngineConfig): VeParams {
  const h = cfg.head;
  const ind = cfg.induction;
  const S = cfg.block.strokeMm;
  const p: VeParams = {
    fuel: cfg.fuel,
    vePeak: 1, nPeak: 4000, wLo: 0.5, wHi: 0.4, nPeakHigh: 0, wLoHigh: 0, wHiHigh: 0, nSwitch: Infinity,
    lowRpmPenalty: 0, resonanceScale: 1, runnerLeffM: ind.intakeRunnerLengthMm / 1000 + 0.08,
    dVeMax: 0.9, dNPeak: 3000, dWidth: 0.25, nFloat: valveFloatRpm(cfg),
    manifoldGain: { "cast-log": 0, "tubular-short": 0.01, "tubular-long": 0.03 }[cfg.exhaust.manifold],
  };
  if (cfg.fuel === "petrol") {
    const mixture = cfg.fuelSystem.kind === "petrol" ? cfg.fuelSystem.mixture : "port-injection";
    // §3.2a base level
    const veValves = { 2: 0.92, 3: 0.94, 4: 0.97, 5: 0.98 }[h.valvesPerCylinder] ?? 0.97;
    p.vePeak = veValves + 0.05 * h.camProfile + (ind.individualThrottleBodies ? 0.02 : 0)
      + (mixture === "carburettor" ? -0.04 : 0)
      + (mixture === "direct-injection" || mixture === "dual-injection" ? 0.02 : 0);
    // §3.2b cam curve located via mean piston speed
    const camCurve = (cam: number) => {
      const cmPeak = 10 + 10 * cam;
      const w = (0.55 - 0.2 * cam) * VVT_WIDEN[h.variableTiming];
      return { nPeak: rpmAtPistonSpeed(S, cmPeak), wLo: 1.25 * w, wHi: 0.8 * w };
    };
    const lo = camCurve(h.camProfile);
    p.nPeak = lo.nPeak; p.wLo = lo.wLo; p.wHi = lo.wHi;
    if (h.variableTiming === "cam-switching") {
      const hi = camCurve(Math.min(1, h.camProfile + 0.3));
      p.nPeakHigh = hi.nPeak; p.wLoHigh = hi.wLo; p.wHiHigh = hi.wHi;
      p.nSwitch = 0.7 * hi.nPeak;
    }
    // §3.2b: race cam (> 0.7) loses VE below 2000 rpm
    p.lowRpmPenalty = h.camProfile > 0.7 ? 0.25 * (h.camProfile - 0.7) / 0.3 : 0;
    // §3.2c: turbo damps the runner resonance ×0.5
    p.resonanceScale = ind.aspiration === "naturally-aspirated" ? 1 : 0.5;
  } else {
    // diesel.md §3.1 bell curve around runner resonance
    p.dVeMax = ({ 2: 0.85, 3: 0.88, 4: 0.92, 5: 0.93 }[h.valvesPerCylinder] ?? 0.92) * (1 + 0.04 * h.camProfile);
    p.dNPeak = (1.2e6 / Math.max(50, ind.intakeRunnerLengthMm)) * (0.85 + 0.4 * h.camProfile);
    let width = 0.25 * (1 - 0.5 * h.camProfile);
    if (h.variableTiming !== "none") width *= 0.7;
    p.dWidth = width;
  }
  return p;
}

function camShape(n: number, nPeak: number, wLo: number, wHi: number): number {
  // petrol.md §3.2b asymmetric Gaussian, floor 55 %
  const x = (n - nPeak) / (nPeak * (n < nPeak ? wLo : wHi));
  return 0.55 + 0.45 * Math.exp(-0.5 * x * x);
}

/** Volumetric efficiency η_L at rpm n with intake temperature TinK. */
export function volumetricEfficiency(p: VeParams, n: number, TinK: number): number {
  let ve: number;
  if (p.fuel === "petrol") {
    let cam = camShape(n, p.nPeak, p.wLo, p.wHi);
    if (p.nPeakHigh > 0 && n > p.nSwitch) cam = Math.max(cam, camShape(n, p.nPeakHigh, p.wLoHigh, p.wHiHigh));
    let base = p.vePeak * cam;
    if (p.lowRpmPenalty > 0 && n < 2000) base *= 1 - p.lowRpmPenalty;
    // §3.2c λ/4 runner resonance: nRes = 5·a/Leff
    const a = 20.05 * Math.sqrt(TinK);
    const nRes = (30 * a) / (p.runnerLeffM * 6);
    const r = (n - nRes) / (0.18 * nRes);
    const d = (n - 0.75 * nRes) / (0.1 * nRes);
    const veRes = (0.06 * Math.exp(-r * r) - 0.03 * Math.exp(-d * d)) * p.resonanceScale;
    ve = Math.min(1.15, base + veRes);
    if (n > p.nPeak) ve *= 1 + p.manifoldGain;
  } else {
    // diesel.md §3.1
    const x = (n - p.dNPeak) / p.dNPeak;
    ve = clamp(p.dVeMax * (1 - p.dWidth * x * x), 0.55, 1.0);
    if (n > p.dNPeak) ve *= 1 + 0.5 * p.manifoldGain; // diesel.md §1: tubular only +1 … 2 %
  }
  // valve float: VE ×0.8 above nFloat (petrol.md §4), ramped over 5 %
  if (n > p.nFloat) ve *= 1 - 0.2 * clamp((n - p.nFloat) / (0.05 * p.nFloat), 0, 1);
  return ve;
}

/** Intercooler effectiveness (diesel.md §3.1, petrol.md §3.12). */
export function intercoolerEffectiveness(cfg: EngineConfig): number {
  return { none: 0, "air-to-air": 0.75, "air-to-water": 0.85 }[cfg.induction.intercooler];
}

/**
 * Charge-air temperature after compressor and intercooler [K] (diesel.md §3.1):
 * T2 = T1·(1 + (PR^((κ−1)/κ) − 1)/ηC), T3 = T2 − ε·(T2 − Tsink).
 * Naturally aspirated: ambient + 10 K intake heating (petrol.md §3.2c).
 */
export function chargeAirTempK(cfg: EngineConfig, pr: number, TambK: number, etaC = 0.7): number {
  if (pr <= 1.0001) return TambK + 10;
  const T2 = TambK * (1 + (Math.pow(pr, (KAPPA_AIR - 1) / KAPPA_AIR) - 1) / etaC);
  const eps = intercoolerEffectiveness(cfg);
  const Tsink = cfg.induction.intercooler === "air-to-water" ? TambK + 15 : TambK;
  return T2 - eps * (T2 - Tsink) + 5; // + 5 K pick-up in the intake manifold [S]
}

/** Compressor power [W] (diesel.md §3.9): PC = ṁ·cp·T1·(PR^0.2857 − 1)/ηC. */
export function compressorPowerW(mDotAir: number, TambK: number, pr: number, etaC = 0.7): number {
  return (mDotAir * CP_AIR * TambK * (Math.pow(Math.max(1, pr), 0.2857) - 1)) / etaC;
}

/** Compressible-orifice flow function ψ with the ellipse approximation (petrol.md §3.3). */
export function throttlePsi(pr: number): number {
  const prCrit = 0.528;
  if (pr <= prCrit) return 1;
  const x = (pr - prCrit) / (1 - prCrit);
  return Math.sqrt(Math.max(0, 1 - x * x));
}

/**
 * Steady manifold pressure ratio pMan/pUp where throttle flow equals engine flow (petrol.md §3.3,
 * "Fixpunkt pMan aus mDotTh = mDotEng"). Engine flow is linear in pMan: ṁEng = cEng·pMan.
 *   φ·kTh·pUp/√(R·T)·ψ(pr) = cEng·pr·pUp   →  solve for pr by bisection.
 * @param thrK φ·kTh/√(R·Tup) [m²·s/m]
 * @param cEng ηL·Vh·n/120/(R·TMan) [kg/(s·Pa)]
 */
export function steadyManifoldRatio(thrK: number, cEng: number): number {
  if (cEng <= 0) return 1;
  const a = thrK / cEng; // pr must satisfy a·ψ(pr) = pr; ψ(1) = 0 so the root is always < 1
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = 0.5 * (lo + hi);
    if (a * throttlePsi(mid) > mid) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export { R_AIR };
