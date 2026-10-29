/**
 * Fuel property tables. Pure data, no DOM.
 * Petrol: docs/research/petrol.md §3.4 (Kraftstofftabelle, E85 computed from blend).
 * Diesel: docs/research/diesel.md §3.0 (FUEL table).
 */
import type { DieselFuel, PetrolFuel } from "./types.ts";

export interface FuelProps {
  /** Lower heating value [J/kg]. */
  lhvJkg: number;
  /** Stoichiometric air/fuel ratio [kg air / kg fuel]. */
  afr: number;
  densityKgL: number;
}

export interface PetrolFuelProps extends FuelProps {
  /** Research octane number used by the knock model (petrol.md §3.6). */
  ron: number;
  /** Heat of vaporisation [kJ/kg]. */
  hvapKJkg: number;
}

export interface DieselFuelProps extends FuelProps {
  /** Relative soot tendency (diesel.md §3.8). */
  sootFactor: number;
}

// petrol.md §3.4 table: RON, Hu, AFR, density, heat of vaporisation
export const PETROL_FUELS: Record<PetrolFuel, PetrolFuelProps> = {
  ron91: { ron: 91, lhvJkg: 43.0e6, afr: 14.7, densityKgL: 0.74, hvapKJkg: 350 },
  ron95: { ron: 95, lhvJkg: 43.0e6, afr: 14.7, densityKgL: 0.745, hvapKJkg: 350 },
  ron98: { ron: 98, lhvJkg: 42.8e6, afr: 14.6, densityKgL: 0.75, hvapKJkg: 350 },
  ron102: { ron: 102, lhvJkg: 42.5e6, afr: 14.4, densityKgL: 0.755, hvapKJkg: 360 },
  // E85: mass fraction ethanol 0.857 → Hu 29.2 MJ/kg, AFR 9.8 (petrol.md §3.4)
  e85: { ron: 105, lhvJkg: 29.2e6, afr: 9.8, densityKgL: 0.782, hvapKJkg: 840 },
};

// diesel.md §3.0 FUEL table
export const DIESEL_FUELS: Record<DieselFuel, DieselFuelProps> = {
  diesel: { lhvJkg: 42.6e6, densityKgL: 0.832, afr: 14.5, sootFactor: 1.0 },
  hvo: { lhvJkg: 44.0e6, densityKgL: 0.78, afr: 15.0, sootFactor: 0.75 },
  biodiesel: { lhvJkg: 37.2e6, densityKgL: 0.88, afr: 12.5, sootFactor: 0.55 },
};

/** Gas constants (diesel.md §3.0). */
export const R_AIR = 287;
export const CP_AIR = 1005;
export const KAPPA_AIR = 1.4;
export const CP_EXH = 1150;
export const KAPPA_EXH = 1.33;
