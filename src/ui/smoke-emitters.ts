// Smoke and steam effects: which emitter runs how strongly. Pure logic, no DOM, so it runs in unit tests.
//
// Every intensity comes from a state value the core already exposes; no threshold is invented here:
// - tyre smoke: the core's wheel-spin / locked-wheel flags (the same as the "Räder drehen durch" /
//   "Räder blockieren" indicator in gearbox-panel.ts) gate it, the sliding speed sets its strength.
//   Sliding speed = slip × speed: for spinning wheels wheelSlip·max(v, 1 m/s) = v_wheel − v (simulator.ts),
//   for locked wheels |brakeSlip|·v.
// - steam: the coolant warning lamp rule of the cockpit (clusterLamps in layouts/logic.ts): coolant above the
//   limit of summarize().limits or an "overheat-coolant" warning. Denser at the critical level (boil-over) or
//   after engine damage.
// - bluish-grey oil smoke: "overheat-oil" at critical severity (oil far too hot), or engine damage (MIL on).
// - exhaust: diesel smoke opacity above the yellow mark of the smoke meter (FALLBACK_LIMITS.smokeMax).
import type { Warning } from "../core/index.ts";

export interface SmokeInput {
  running: boolean;
  /** Chassis dyno with tyre model; tyre values are ignored otherwise. */
  vehicle: boolean;
  vehicleSpeedMs?: number;
  wheelSlip?: number;
  wheelSpin?: boolean;
  wheelsLocked?: boolean;
  brakeSlip?: number;
  /** Liquid cooling; an air-cooled engine has no coolant to boil. */
  liquidCooled: boolean;
  coolantC: number;
  /** Coolant limit of the warning lamp (summary.limits.coolantMaxC). */
  coolantMaxC: number;
  oilC: number;
  /** Oil limit of the oil gauge (summary.limits.oilMaxC). */
  oilMaxC: number;
  warnings: readonly Pick<Warning, "code" | "severity">[];
  /** Damage happened (MIL lit) or engine destroyed, as for the cluster lamps. */
  damaged: boolean;
  diesel: boolean;
  /** Diesel smoke opacity 0 … 1 (EngineState.smoke). */
  smoke: number;
  /** Opacity from which the smoke meter turns yellow. */
  smokeMax: number;
}

/** Strength 0 … 1 of each emitter. */
export interface Emission {
  tyre: number;
  steam: number;
  oilSmoke: number;
  exhaust: number;
}

export type EmitterKind = keyof Emission;
export const EMITTERS: readonly EmitterKind[] = ["tyre", "steam", "oilSmoke", "exhaust"];

/** Particles per second at strength 1. Kept low: the effect is a hint, never a curtain over the gauges. */
export const MAX_RATE: Readonly<Record<EmitterKind, number>> = { tyre: 70, steam: 30, oilSmoke: 12, exhaust: 18 };

/** Pool size of the overlay: at most this many particles live at once. */
export const MAX_PARTICLES = 150;

/** Sliding speed (m/s) at which tyre smoke is at full strength (≈ 40 km/h of wheel speed over road speed). */
export const TYRE_FULL_SLIDE_MS = 11;
/** Below this sliding speed the rubber does not smoke visibly. */
export const TYRE_MIN_SLIDE_MS = 0.5;

const clamp01 = (x: number) => (x > 1 ? 1 : x > 0 ? x : 0);
const fin = (x: number | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

export const NO_EMISSION: Readonly<Emission> = { tyre: 0, steam: 0, oilSmoke: 0, exhaust: 0 };

/** Sliding speed of the tyres in m/s (0 when they roll or the core reports neither spin nor lock). */
export function slideSpeedMs(x: Pick<SmokeInput, "vehicle" | "vehicleSpeedMs" | "wheelSlip" | "wheelSpin" | "wheelsLocked" | "brakeSlip">): number {
  if (!x.vehicle) return 0;
  const v = Math.abs(fin(x.vehicleSpeedMs));
  let slide = 0;
  if (x.wheelSpin) slide = Math.abs(fin(x.wheelSlip)) * Math.max(v, 1);
  if (x.wheelsLocked) slide = Math.max(slide, Math.abs(fin(x.brakeSlip)) * v);
  return slide;
}

export function emission(x: SmokeInput): Emission {
  const slide = slideSpeedMs(x);
  const tyre = slide < TYRE_MIN_SLIDE_MS ? 0 : clamp01(slide / TYRE_FULL_SLIDE_MS);

  const warn = (code: Warning["code"]) => x.warnings.find((w) => w.code === code);
  const coolantWarn = warn("overheat-coolant");
  let steam = 0;
  if (x.liquidCooled && (x.coolantC > x.coolantMaxC || coolantWarn)) {
    const boilOver = coolantWarn?.severity === "critical";
    // light at the lamp, a little more with every degree above it, dense on boil-over or with a damaged engine
    steam = boilOver || x.damaged ? 1 : 0.3 + 0.4 * clamp01((x.coolantC - x.coolantMaxC) / 10);
  }

  const oilCritical = warn("overheat-oil")?.severity === "critical";
  // a damaged engine smokes while it runs or while its oil is still hot
  const damagedHot = x.damaged && (x.running || x.oilC > x.oilMaxC);
  const oilSmoke = oilCritical && damagedHot ? 1 : oilCritical ? 0.6 : damagedHot ? 0.45 : 0;

  const exhaust = x.diesel && x.running && x.smoke > x.smokeMax ? 0.25 + 0.75 * clamp01((x.smoke - x.smokeMax) / Math.max(0.05, 1 - x.smokeMax)) : 0;

  return { tyre, steam, oilSmoke, exhaust };
}

/** Particles per second over all emitters. 0 means idle: the overlay draws nothing and costs nothing. */
export function emissionRate(e: Emission): number {
  let r = 0;
  for (const k of EMITTERS) r += e[k] * MAX_RATE[k];
  return r;
}

export function isIdle(e: Emission): boolean {
  return emissionRate(e) === 0;
}

/**
 * Whole particles to spawn this frame at `rate` per second; the fraction is carried to the next frame so low
 * rates still emit evenly. Returns [count, new carry].
 */
export function spawnCount(rate: number, dt: number, carry: number): [number, number] {
  if (!(rate > 0) || !(dt > 0)) return [0, 0];
  const total = carry + rate * dt;
  const n = Math.floor(total);
  return [n, total - n];
}
