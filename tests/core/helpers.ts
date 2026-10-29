// Shared helpers for the specification-based core tests. Only the public API is used.
import { EngineSimulator, defaultInputs, dynoSweep } from "../../src/core/index.ts";
import type { DynoPoint, EngineConfig, EngineState, SimInputs } from "../../src/core/index.ts";

export function clone<T>(x: T): T {
  return structuredClone(x);
}

/** Deep copy + mutation in one go: `variant(cfg, c => { c.block.boreMm = 90 })`. */
export function variant(cfg: EngineConfig, mutate: (c: EngineConfig) => void): EngineConfig {
  const c = clone(cfg);
  mutate(c);
  return c;
}

export interface SweepPeaks {
  torque: DynoPoint;
  power: DynoPoint;
  minBsfc: number;
  maxPeakPressure: number;
  points: DynoPoint[];
}

export function sweepPeaks(cfg: EngineConfig, opts: { fromRpm?: number; toRpm?: number; stepRpm?: number } = {}): SweepPeaks {
  const points = dynoSweep(cfg, { fromRpm: opts.fromRpm ?? 1000, toRpm: opts.toRpm, stepRpm: opts.stepRpm ?? 100 });
  if (points.length === 0) throw new Error(`empty dyno sweep for ${cfg.id}`);
  let torque = points[0]!;
  let power = points[0]!;
  let minBsfc = Infinity;
  let maxPeakPressure = -Infinity;
  for (const p of points) {
    if (p.torqueNm > torque.torqueNm) torque = p;
    if (p.powerKw > power.powerKw) power = p;
    if (Number.isFinite(p.bsfcGkWh) && p.bsfcGkWh > 0) minBsfc = Math.min(minBsfc, p.bsfcGkWh);
    maxPeakPressure = Math.max(maxPeakPressure, p.peakPressureBar);
  }
  return { torque, power, minBsfc, maxPeakPressure, points };
}

/** Linear interpolation of a sweep quantity at a given rpm. */
export function sweepAt(points: DynoPoint[], rpm: number, key: keyof DynoPoint): number {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (rpm >= a.rpm && rpm <= b.rpm) {
      const f = (rpm - a.rpm) / (b.rpm - a.rpm || 1);
      return (a[key] as number) + f * ((b[key] as number) - (a[key] as number));
    }
  }
  return (rpm < points[0]!.rpm ? points[0]! : points[points.length - 1]!)[key] as number;
}

export type Phase = { seconds: number; input: Partial<SimInputs>; onStep?: (s: EngineState, t: number) => void };

/** Runs consecutive phases on one simulator; inputs of a phase are merged onto the defaults. */
export function runPhases(sim: EngineSimulator, phases: Phase[], dt = 1 / 60): EngineState {
  let s = sim.state;
  for (const ph of phases) {
    const input = { ...defaultInputs(), ...ph.input };
    const n = Math.round(ph.seconds / dt);
    for (let i = 0; i < n; i++) {
      s = sim.step(dt, input);
      ph.onStep?.(s, i * dt);
    }
  }
  return s;
}

/** Ignition on, starter for `crankS` seconds, then idle for `idleS` seconds. */
export function startEngine(cfg: EngineConfig, idleS = 10, crankS = 2, dt = 1 / 60): EngineSimulator {
  const sim = new EngineSimulator(cfg);
  runPhases(
    sim,
    [
      { seconds: crankS, input: { ignition: true, starter: true } },
      { seconds: idleS, input: { ignition: true } },
    ],
    dt,
  );
  return sim;
}

/** Collects one state field over a phase. */
export function sample(sim: EngineSimulator, seconds: number, input: Partial<SimInputs>, pick: (s: EngineState) => number, dt = 1 / 60): number[] {
  const out: number[] = [];
  runPhases(sim, [{ seconds, input: { ignition: true, ...input }, onStep: (s) => out.push(pick(s)) }], dt);
  return out;
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/**
 * Brings the engine to a part-load point on the dyno: hold-rpm brake at `rpm`, pedal closed-loop
 * controlled until the brake torque equals `loadFraction` × full-load torque (from dynoSweep).
 * Returns the settled state averaged over the last seconds.
 */
export function partLoadPoint(cfg: EngineConfig, rpm: number, loadFraction: number, seconds = 25): { state: EngineState; bsfc: number; torque: number; target: number } {
  const full = sweepAt(dynoSweep(cfg, { fromRpm: 1000, stepRpm: 100 }), rpm, "torqueNm");
  const target = loadFraction * full;
  const sim = startEngine(cfg, 3);
  let pedal = loadFraction;
  const dt = 1 / 60;
  const bsfcs: number[] = [];
  const torques: number[] = [];
  const n = Math.round(seconds / dt);
  let s = sim.state;
  for (let i = 0; i < n; i++) {
    s = sim.step(dt, { ...defaultInputs(), ignition: true, pedal, dynoMode: "hold-rpm", dynoTargetRpm: rpm });
    // integral pedal controller on output torque
    const err = (target - s.torqueNm) / Math.max(1, full);
    pedal = Math.min(1, Math.max(0, pedal + 0.8 * err * dt));
    if (i > n * 0.7) {
      bsfcs.push(s.bsfcGkWh);
      torques.push(s.torqueNm);
    }
  }
  return { state: s, bsfc: mean(bsfcs), torque: mean(torques), target };
}

/** Time until `boostBar` reaches 90 % of its value after `seconds` of full pedal at fixed rpm. */
export function boostRiseTime(cfg: EngineConfig, rpm: number, seconds = 15): { t90: number; final: number } {
  const sim = startEngine(cfg, 2);
  // settle at the dyno speed with closed pedal
  runPhases(sim, [{ seconds: 4, input: { ignition: true, pedal: 0.05, dynoMode: "hold-rpm", dynoTargetRpm: rpm } }]);
  const trace: number[] = [];
  const dt = 1 / 60;
  runPhases(sim, [{ seconds, input: { ignition: true, pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: rpm }, onStep: (s) => trace.push(s.boostBar) }], dt);
  const final = trace[trace.length - 1]!;
  const idx = trace.findIndex((b) => b >= 0.9 * final);
  return { t90: idx < 0 ? Infinity : idx * dt, final };
}

/** All numeric fields of the state must be finite (bsfc may be NaN at ~zero power). */
export function nonFiniteFields(s: EngineState): string[] {
  const bad: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== "number") continue;
    if (k === "bsfcGkWh" && Number.isNaN(v)) continue;
    if (!Number.isFinite(v)) bad.push(`${k}=${v}`);
  }
  return bad;
}

// ───────────────────────── random valid configs ─────────────────────────

/** Deterministic PRNG (mulberry32) so fuzz failures are reproducible from the seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const range = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const round = (x: number, step: number) => Math.round(x / step) * step;

/**
 * Random configuration inside the parameter ranges of docs/research/diesel.md §1 and
 * docs/research/petrol.md §1 (incl. their validation rules: ohv ⇒ 2 valves, layout/cylinder
 * combinations, conrod 1.4…2.2 × stroke, petrol 0.15…1.0 l per cylinder, diesel no ITB).
 */
export function randomConfig(r: () => number, i: number): EngineConfig {
  const fuel = r() < 0.5 ? "diesel" : "petrol";
  const diesel = fuel === "diesel";

  let layout: EngineConfig["block"]["layout"];
  let cylinders: number;
  let bankAngleDeg = 0;
  if (diesel) {
    layout = pick(r, ["inline", "inline", "inline", "v"] as const);
    cylinders = layout === "inline" ? pick(r, [2, 3, 4, 5, 6]) : pick(r, [6, 8, 10, 12]);
    if (layout === "v") bankAngleDeg = pick(r, [60, 72, 90]);
  } else {
    layout = pick(r, ["inline", "inline", "v", "boxer", "vr", "w"] as const);
    if (layout === "inline") cylinders = pick(r, [1, 2, 3, 4, 5, 6]);
    else if (layout === "v") cylinders = pick(r, [6, 8, 10, 12, 16]);
    else if (layout === "boxer") cylinders = pick(r, [2, 4, 6]);
    else if (layout === "vr") cylinders = pick(r, [5, 6]);
    else cylinders = pick(r, [8, 12, 16]);
    bankAngleDeg = layout === "v" ? pick(r, [60, 72, 90, 120]) : layout === "boxer" ? 180 : layout === "vr" ? 15 : layout === "w" ? 72 : 0;
  }

  // bore/stroke within the ranges, petrol per-cylinder displacement 0.15 … 1.0 l
  let boreMm: number, strokeMm: number;
  for (;;) {
    boreMm = round(diesel ? range(r, 65, 140) : range(r, 50, 110), 0.5);
    strokeMm = round(diesel ? range(r, 70, 165) : range(r, 40, 110), 0.5);
    const cylL = (Math.PI / 4) * (boreMm / 10) ** 2 * (strokeMm / 10) / 1000;
    const ratio = boreMm / strokeMm;
    if (!diesel && (cylL < 0.15 || cylL > 1.0 || ratio < 0.8 || ratio > 1.5)) continue;
    if (diesel && (cylL < 0.2 || cylL > 2.5)) continue;
    break;
  }

  const valvetrain = pick(r, ["ohv", "sohc", "dohc"] as const);
  const valvesPerCylinder = valvetrain === "ohv" ? 2 : diesel ? pick(r, [2, 4] as const) : pick(r, [2, 3, 4, 5] as const);
  const aspiration = diesel
    ? pick(r, ["naturally-aspirated", "turbo", "turbo", "twin-turbo-sequential", "twin-turbo-parallel", "e-turbo"] as const)
    : pick(r, ["naturally-aspirated", "naturally-aspirated", "turbo", "twin-turbo-parallel", "twin-turbo-sequential", "supercharger-roots", "supercharger-centrifugal", "e-turbo"] as const);
  const na = aspiration === "naturally-aspirated";

  const cfg: EngineConfig = {
    id: `fuzz-${i}`,
    name: `Fuzz ${i}`,
    fuel,
    block: {
      layout,
      cylinders,
      bankAngleDeg,
      v8Crank: pick(r, ["crossplane", "flatplane"] as const),
      boreMm,
      strokeMm,
      conrodLengthMm: round(strokeMm * range(r, 1.4, 2.2), 0.5),
      compressionRatio: round(diesel ? range(r, 12, 24) : range(r, 7.5, 14), 0.1),
      blockMaterial: pick(r, ["cast-iron", "compacted-graphite-iron", "aluminium"] as const),
      crankshaft: pick(r, ["cast", "forged", "billet"] as const),
      pistons: pick(r, ["cast-aluminium", "forged-aluminium", "steel"] as const),
      conrods: pick(r, ["cast-steel", "forged-steel", "titanium"] as const),
    },
    head: {
      valvetrain,
      valvesPerCylinder,
      camProfile: round(r(), 0.05),
      variableTiming: pick(r, ["none", "intake-cam", "dual-cam", "cam-switching"] as const),
    },
    induction: {
      aspiration,
      compressorInducerMm: round(diesel ? range(r, 25, 90) : range(r, 30, 80), 1),
      turbineAR: round(diesel ? range(r, 0.3, 1.4) : range(r, 0.35, 1.2), 0.05),
      variableGeometry: r() < 0.5,
      boostTargetBar: na ? 0 : round(diesel ? range(r, 0, 3.5) : range(r, 0, 2.5), 0.05),
      intercooler: pick(r, ["none", "air-to-air", "air-to-water"] as const),
      intakeRunnerLengthMm: round(diesel ? range(r, 150, 700) : range(r, 100, 700), 10),
      individualThrottleBodies: diesel ? false : r() < 0.25,
    },
    fuelSystem: diesel
      ? (() => {
          const injection = pick(r, ["indirect-prechamber", "indirect-swirl-chamber", "unit-injector", "common-rail"] as const);
          const chamber = injection.startsWith("indirect");
          return {
            kind: "diesel" as const,
            injection,
            injectionPressureBar: round(chamber ? range(r, 100, 500) : range(r, 100, 3000), 10),
            fuel: pick(r, ["diesel", "hvo", "biodiesel"] as const),
            smokeLimitLambda: round(range(r, 1.0, 2.0), 0.01),
            injectionTimingOffsetDeg: round(range(r, -12, 8), 0.5),
          };
        })()
      : {
          kind: "petrol" as const,
          mixture: pick(r, ["carburettor", "port-injection", "direct-injection", "dual-injection"] as const),
          fuel: pick(r, ["ron91", "ron95", "ron98", "ron102", "e85"] as const),
          fullLoadLambda: round(range(r, 0.72, 1.05), 0.01),
          ignitionAdvanceOffsetDeg: round(range(r, -20, 10), 0.5),
        },
    exhaust: {
      manifold: pick(r, ["cast-log", "tubular-short", "tubular-long"] as const),
      egr: r() < 0.5,
      catalyst: r() < 0.7,
      particulateFilter: r() < 0.4,
      scr: diesel ? r() < 0.3 : false,
    },
    cooling: {
      radiatorCapacityKw: round(diesel ? range(r, 20, 400) : range(r, 20, 150), 5),
      thermostatOpenC: round(diesel ? range(r, 70, 105) : range(r, 80, 105), 1),
      oilCooler: r() < 0.6,
    },
    revLimitRpm: round(diesel ? range(r, 2000, 6000) : range(r, 4000, 12000), 100),
    idleRpm: round(diesel ? range(r, 500, 1100) : range(r, 600, 1200), 10),
  };
  return cfg;
}
