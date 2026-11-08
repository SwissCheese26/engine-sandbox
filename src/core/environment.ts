/**
 * Environment of the chassis dyno / test track (issue #23). Pure TypeScript, no DOM.
 *
 * - Weather → road surface and water film (tyres.ts tyreGrip, aquaplaningFactor)
 * - Outside temperature → intake air of the engine (SimInputs.ambientC) and the tyre tread
 * - Altitude → air pressure (SimInputs.ambientKpa) and air density for the aerodynamic drag
 * - Road gradient in % → downhill force in the longitudinal dynamics (VehicleCoupling.gradePct)
 */
import type { RoadSurface } from "./tyres.ts";

import type { Terrain } from "./terrain.ts";

export type Weather = "dry" | "wet" | "heavy-rain" | "snow" | "ice";

export interface Environment {
  weather: Weather;
  /** Outside air temperature, °C. */
  ambientC: number;
  /** Altitude above sea level, m (sets the air pressure, ISA). */
  altitudeM: number;
  /** Road gradient in % (rise per 100 m); + = uphill, − = downhill. Used with terrain "static". */
  gradePct: number;
  /**
   * Route with an elevation profile (issue #48, terrain.ts); "static" (default) = the fixed altitude and gradient
   * above. With a profile the altitude and gradient follow the position along the route.
   */
  terrain?: Terrain;
}

export const DEFAULT_ENVIRONMENT: Environment = { weather: "dry", ambientC: 20, altitudeM: 0, gradePct: 0 };

export const WEATHER_LABELS: Record<Weather, string> = {
  dry: "Trocken",
  wet: "Nass",
  "heavy-rain": "Starker Regen",
  snow: "Schnee",
  ice: "Eis",
};

/**
 * Weather → road surface and a water-film factor on the wet μ [S]: heavy rain with standing water lowers the wet
 * peak by ≈ 10 % even below the aquaplaning speed (Bosch KTB, "Kraftschlussbeiwerte": μ wet 0.5–0.8, water film
 * 1–2 mm ≈ 0.4–0.6 at 90 km/h); above it aquaplaningFactor() applies.
 */
export function weatherSurface(w: Weather): { surface: RoadSurface; factor: number; aquaplaning: boolean } {
  switch (w) {
    case "wet": return { surface: "wet", factor: 1, aquaplaning: false };
    case "heavy-rain": return { surface: "wet", factor: 0.9, aquaplaning: true };
    case "snow": return { surface: "snow", factor: 1, aquaplaning: false };
    case "ice": return { surface: "ice", factor: 1, aquaplaning: false };
    default: return { surface: "dry", factor: 1, aquaplaning: false };
  }
}

/**
 * Air pressure from altitude, ISA troposphere: p = p0·(1 − L·h/T0)^(g·M/(R·L)) = 101.325·(1 − 2.25577e-5·h)^5.25588 kPa
 * (ISO 2533 / ICAO standard atmosphere) [S].
 */
export function altitudeToKpa(altitudeM: number): number {
  const h = Math.min(9000, Math.max(-500, Number.isFinite(altitudeM) ? altitudeM : 0));
  return 101.325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
}

/** Air density ρ = p / (R_s·T), R_s = 287.05 J/(kg·K) (ideal gas, dry air) [S]. 101.3 kPa / 20 °C → 1.204 kg/m³. */
export function airDensity(kpa: number, tempC: number): number {
  return (kpa * 1000) / (287.05 * (Math.max(-60, tempC) + 273.15));
}

/** Black-ice warning of the instrument cluster: outside temperature below +3 °C (typical OEM threshold, e.g. VW/BMW) [S]. */
export const ICE_WARNING_C = 3;

export function iceWarning(ambientC: number): boolean {
  return ambientC < ICE_WARNING_C;
}

/** Simulator inputs (ambientC / ambientKpa) for an environment. */
export function environmentInputs(env: Environment): { ambientC: number; ambientKpa: number } {
  return { ambientC: env.ambientC, ambientKpa: altitudeToKpa(env.altitudeM) };
}
