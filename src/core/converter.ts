/**
 * Hydrodynamic torque converter (Trilok type) of the converter automatic ("Wandlerautomatik", issue #14).
 * Characteristic per docs/research/vehicle.md §4 (Naunheimer et al., Fahrzeuggetriebe, ch. "Hydrodynamische
 * Wandler"; SAE J643 for the capacity factor K = n_P / √T_P):
 *  - speed ratio ν = n_T / n_P (turbine / pump = engine)
 *  - pump torque T_P = λ(ν) · (n_P / K)², K the capacity factor at stall (rpm/√Nm), λ(ν) relative capacity:
 *    1 at stall, falling gently (−20 %) to the coupling point ν_K, then linearly to 0 at ν = 1
 *  - torque ratio μ(ν) = μ₀ − (μ₀ − 1) · ν / ν_K below the coupling point, 1 above (stator freewheels)
 *  - turbine torque T_T = μ(ν) · T_P; efficiency η = μ · ν
 *  - overrun (ν > 1, the wheels drive the engine): reverse flow with ≈ half the capacity, μ = 1
 * Pure TypeScript, no DOM.
 */
import type { ConverterCoupling } from "./types.ts";

/** Converter data of a gearbox (GearboxSpec.converter). */
export interface ConverterSpec {
  /** Stall speed at full load, rpm (engine held at full throttle, turbine at rest). Sets K for the fitted engine. */
  stallRpm: number;
  /** Torque ratio μ₀ at stall (ν = 0), typically 1.8–2.5. */
  stallTorqueRatio: number;
  /** Coupling point ν_K (μ = 1, stator starts to freewheel), typically 0.85–0.9. */
  couplingPoint: number;
  /** Turbine speed above which the lock-up clutch closes, rpm. */
  lockUpRpm: number;
}

/** Relative capacity drop from stall to the coupling point (vehicle.md §4) [S]. */
const LAMBDA_DROP = 0.2;
/** Overrun capacity relative to drive (reverse flow through the turbine) [S]. */
const REVERSE_CAPACITY = 0.5;

/** Relative pump capacity λ(ν)/λ₀ for 0 ≤ ν ≤ 1. */
export function converterCapacity(nu: number, couplingPoint: number): number {
  const cp = Math.min(0.97, Math.max(0.5, couplingPoint));
  const v = Math.max(0, nu);
  if (v <= cp) return 1 - LAMBDA_DROP * (v / cp) ** 2;
  return v >= 1 ? 0 : (1 - LAMBDA_DROP) * ((1 - v) / (1 - cp));
}

/** Torque ratio μ(ν) = T_T / T_P. */
export function converterTorqueRatio(nu: number, stallTorqueRatio: number, couplingPoint: number): number {
  const mu0 = Math.max(1, stallTorqueRatio);
  const cp = Math.min(0.97, Math.max(0.5, couplingPoint));
  const v = Math.max(0, nu);
  return v >= cp ? 1 : mu0 - ((mu0 - 1) * v) / cp;
}

/**
 * Capacity factor K (rpm/√Nm) so the converter stalls at stallRpm: pass the engine's full-load torque AT stallRpm
 * (the drivetrain takes it from the steady full-load curve).
 */
export function converterK(stallRpm: number, engineTorqueAtStallNm: number): number {
  return stallRpm / Math.sqrt(Math.max(10, engineTorqueAtStallNm));
}

/**
 * Pump (engine side) and turbine (gearbox side) torque in Nm for pump and turbine speed in rpm. Positive = the
 * engine drives. Engine stopped (n_P ≤ 0): no torque.
 */
export function converterTorques(c: ConverterCoupling, pumpRpm: number, turbineRpm: number): { pumpNm: number; turbineNm: number } {
  const nP = Math.max(0, pumpRpm);
  const nT = Math.max(0, turbineRpm);
  const K = Math.max(1, c.kFactor);
  if (nP <= 0) return { pumpNm: 0, turbineNm: 0 };
  if (nT <= nP) {
    const nu = nT / nP;
    const tp = converterCapacity(nu, c.couplingPoint) * (nP / K) ** 2;
    return { pumpNm: tp, turbineNm: converterTorqueRatio(nu, c.stallTorqueRatio, c.couplingPoint) * tp };
  }
  // overrun: the turbine works as a pump against the engine; s = n_P / n_T plays the role of ν
  const s = nP / nT;
  const cp = Math.min(0.97, Math.max(0.5, c.couplingPoint));
  const t = -REVERSE_CAPACITY * Math.min(1, (1 - s) / (1 - cp)) * (nT / K) ** 2;
  return { pumpNm: t, turbineNm: t };
}
