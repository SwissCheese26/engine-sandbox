// Limit values the instruments use to draw their yellow ranges ("Gelb heißt Grenze").
//
// TEMPORARY: these are physics, not UI. They belong in the core (src/core/limits.ts, team
// "Thermik & Aufladung") and should reach the UI via summarize() / EngineSummary, so that the
// yellow ranges and the core's warnings can never disagree. Requested under "Wünsche an die
// Architektur" in PR #8. Until then every limit the UI uses lives here and nowhere else.
import type { EngineConfig } from "../core/index.ts";

export const FALLBACK_LIMITS = {
  /** Coolant boiling margin under ~1.2 bar cap pressure. */
  coolantMaxC: 110,
  oilMaxC: 135,
  /** Exhaust gas temperature before turbine: diesel turbines/DPF vs. petrol turbines. */
  egtMaxC: { diesel: 750, petrol: 950 } as Record<EngineConfig["fuel"], number>,
  /** Minimum oil pressure while running. */
  oilPressureMinBar: 1,
  /** Knock intensity / smoke opacity (0 … 1) from which the meter turns yellow. */
  knockMax: 0.5,
  smokeMax: 0.5,
  /** Petrol: richer than this at full load is outside the useful range. */
  petrolLambdaMin: 0.75,
  /** Boost gauge turns yellow above target × this factor (overboost). */
  boostOvershoot: 1.15,
  /** Mean piston speed limit shown on the nameplate. */
  meanPistonSpeedMaxMs: 22,
  /** Nameplate reliability below this is marked. */
  reliabilityMin: 0.4,
} as const;

export function egtLimitC(cfg: EngineConfig): number {
  return FALLBACK_LIMITS.egtMaxC[cfg.fuel];
}

/** Lower λ limit: diesel smoke limit from the config, petrol fixed. */
export function lambdaLimit(cfg: EngineConfig): number {
  return cfg.fuelSystem.kind === "diesel" ? cfg.fuelSystem.smokeLimitLambda : FALLBACK_LIMITS.petrolLambdaMin;
}
