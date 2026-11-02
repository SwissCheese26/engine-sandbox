/**
 * Adapter to the subsystems of team "Thermik & Aufladung" (issue #4, PR #12). The physics core imports
 * turbo, thermal, limits and mass ONLY from here, so the coupling stays a thin, replaceable seam.
 */
export { chargeAirTempC, steadyBoostBar, stepTurbo, superchargerPowerKw, turboMaxRpm } from "./turbo.ts";
export type { TurboState } from "./turbo.ts";
export { oilPressureBar, stepThermal } from "./thermal.ts";
export type { ThermalState } from "./thermal.ts";
export { createLimitTracker, engineLimits, evaluateLimits, safeMaxRpm } from "./limits.ts";
export type { LimitTracker } from "./limits.ts";
export { engineMassKg, reliabilityScore } from "./mass.ts";
