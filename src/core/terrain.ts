/**
 * Road profiles (issue #48): instead of a fixed gradient the chassis dyno can drive a route with an elevation
 * profile. The position along the route comes from the distance driven; the gradient is the slope of the profile
 * and the altitude sets the air pressure and density (ISA, environment.ts) for intake air and drag.
 *
 * Profiles are smooth closed functions (sums of sines with whole periods over the route length), so the gradient
 * is continuous (no jumps in the downhill force) and the route repeats seamlessly. "Berg hoch/runter" are
 * constant ramps that start over at the foot or top after 1600 m of height.
 *
 * Typical gradients: lowland < 2 %, low mountain roads 4–8 %, Alpine pass roads 8–12 % with single ramps up to
 * ≈ 15 % (e.g. Großglockner Hochalpenstraße max. 12 %, Stilfser Joch ≈ 7–9 % average, Sustenpass ≈ 9 %) [S:
 * docs/research/vehicle.md §Umwelt/Strecke].
 */
import type { Environment } from "./environment.ts";

export type Terrain = "static" | "flat" | "hills" | "alps" | "uphill" | "downhill";

export const TERRAIN_LABELS: Record<Terrain, string> = {
  static: "Statisch (feste Steigung)",
  flat: "Flachland",
  hills: "Mittelgebirge",
  alps: "Alpen",
  uphill: "Berg hoch",
  downhill: "Berg runter",
};

export function isTerrain(v: unknown): v is Terrain {
  return typeof v === "string" && v in TERRAIN_LABELS;
}

interface Wave {
  /** Amplitude, m. */
  a: number;
  /** Whole periods over the route length. */
  k: number;
  /** Phase, rad. */
  p: number;
}

interface Profile {
  /** Route length, m (the profile repeats after it). */
  lengthM: number;
  /** Mean altitude, m above sea level. */
  baseM: number;
  waves: Wave[];
}

// amplitude · 2π·k / L = peak slope of one wave (flat: ≈ 1–1,5 %, hills: ≈ 4–5 % each, alps: 8 % + 4 %)
const PROFILES: Record<"flat" | "hills" | "alps", Profile> = {
  flat: { lengthM: 12_000, baseM: 120, waves: [{ a: 9, k: 3, p: 0.4 }, { a: 2.5, k: 11, p: 1.9 }] },
  hills: { lengthM: 20_000, baseM: 420, waves: [{ a: 70, k: 2, p: 0.2 }, { a: 22, k: 7, p: 2.1 }, { a: 6, k: 19, p: 0.9 }] },
  alps: { lengthM: 30_000, baseM: 1450, waves: [{ a: 380, k: 1, p: -Math.PI / 2 }, { a: 40, k: 5, p: 1.3 }, { a: 8, k: 23, p: 2.6 }] },
};

/** Constant ramp of "Berg hoch/runter": 8 %, starts over after 1600 m of height (next mountain). */
export const RAMP_PCT = 8;
const RAMP_SPAN_M = 1600;
const RAMP_FOOT_M = 300;

const TAU = 2 * Math.PI;

/** Route length in m (the ramps: one climb of 1600 m height). */
export function terrainLengthM(t: Exclude<Terrain, "static">): number {
  return t === "uphill" || t === "downhill" ? (RAMP_SPAN_M / RAMP_PCT) * 100 : PROFILES[t].lengthM;
}

/** Altitude (m above sea level) and gradient (%) at a position along the route. */
export function terrainAt(t: Exclude<Terrain, "static">, positionM: number): { altitudeM: number; gradePct: number } {
  const x = Number.isFinite(positionM) ? positionM : 0;
  if (t === "uphill" || t === "downhill") {
    const len = terrainLengthM(t);
    const u = ((x % len) + len) % len; // position within one climb
    const rise = (u * RAMP_PCT) / 100;
    return t === "uphill"
      ? { altitudeM: RAMP_FOOT_M + rise, gradePct: RAMP_PCT }
      : { altitudeM: RAMP_FOOT_M + RAMP_SPAN_M - rise, gradePct: -RAMP_PCT };
  }
  const p = PROFILES[t];
  let h = p.baseM;
  let slope = 0;
  for (const w of p.waves) {
    const f = (TAU * w.k) / p.lengthM;
    h += w.a * Math.sin(f * x + w.p);
    slope += w.a * f * Math.cos(f * x + w.p); // dh/dx
  }
  return { altitudeM: h, gradePct: slope * 100 };
}

/** Altitude and gradient the car drives on: the route profile, or the fixed values on "static". */
export function roadAt(env: Environment, positionM: number): { altitudeM: number; gradePct: number } {
  const t = env.terrain ?? "static";
  return t === "static" ? { altitudeM: env.altitudeM, gradePct: env.gradePct } : terrainAt(t, positionM);
}

/** Sampled profile for the elevation map: n points over one route length. */
export function terrainSamples(t: Exclude<Terrain, "static">, n = 120): { lengthM: number; altitudeM: number[] } {
  const lengthM = terrainLengthM(t);
  const altitudeM: number[] = [];
  for (let i = 0; i <= n; i++) altitudeM.push(terrainAt(t, (i / n) * lengthM * (t === "uphill" || t === "downhill" ? 0.999 : 1)).altitudeM);
  return { lengthM, altitudeM };
}
