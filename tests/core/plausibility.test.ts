// Physical plausibility: relationships taken from the specifications (docs/research/petrol.md §2–§4,
// docs/research/diesel.md §2–§4). Every case names the section it comes from.
//
// Cases the placeholder physics on main cannot satisfy are `test.failing`:
// scharf schalten nach Integration (#3/#4) – after integration make `spec()` always use plain `test`.
// Some cases in PASS_ON_PLACEHOLDER hold only trivially on main (e.g. smoke is always 0); they are
// still correct per spec and stay active as regression guards.
import { describe, expect, test } from "bun:test";
import { EngineSimulator, displacementL, summarize, validateConfig } from "../../src/core/index.ts";
import type { EngineConfig, EngineState, SimInputs } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { referenceConfig } from "../../src/data/reference-engines.ts";
import { boostRiseTime, mean, partLoadPoint, runPhases, startEngine, sweepAt, sweepPeaks, variant } from "./helpers.ts";

/**
 * Cases that already hold with the placeholder physics (they run as normal tests). All others are
 * expected to fail on main and are registered with `test.failing`.
 */
const PASS_ON_PLACEHOLDER = new Set<string>([
  "displacement grows with bore, stroke and cylinders",
  "diesel: larger bore → more peak torque",
  "petrol: larger bore → more peak torque",
  "torque scales roughly with displacement: 6 instead of 4 equal cylinders → ×1.35 … 1.65",
  "summary: mean piston speed at the limiter = 2·S·n/60",
  "best BSFC in the literature bands: CR diesel 190 … 235, petrol 220 … 290 g/kWh",
  "diesel is more efficient than petrol at full load (best BSFC)",
  "diesel: no throttle → manifold ≥ ambient and λ > 2.5 at 25 % load",
  "petrol: λ ≈ 1 at part load (catalyst), enriched at full load",
  "diesel peak cylinder pressure > petrol",
  "peak pressure bands: diesel 120 … 220 bar, NA petrol 50 … 110 bar",
  "full-load EGT: diesel colder than petrol",
  "petrol turbo: more boost → more peak power",
  "diesel: more boost → more peak torque (nearly linear)",
  "diesel: turbo vs naturally aspirated → ×1.6 or more peak torque",
  "diesel never knocks, petrol never smokes",
  "diesel: particulate filter removes visible smoke",
  "no false alarms: default engines at 3000 rpm / half load have no critical warning",
  "summary: firing intervals — crossplane V8 even 90°, R4 180°",
]);

const SLOW = 30_000;
function spec(name: string, fn: () => void, timeout = SLOW) {
  // scharf schalten nach Integration (#3/#4)
  (PASS_ON_PLACEHOLDER.has(name) ? test : test.failing)(name, fn, timeout);
}

const diesel = () => defaultConfig("diesel");
const petrol = () => defaultConfig("petrol");
/** Naturally aspirated port-injection petrol 2.0 (petrol.md §1 defaults). */
const petrolNA = () =>
  variant(petrol(), (c) => {
    c.induction.aspiration = "naturally-aspirated";
    c.induction.boostTargetBar = 0;
    c.induction.intercooler = "none";
    c.induction.intakeRunnerLengthMm = 350;
    c.block.compressionRatio = 10.5;
    if (c.fuelSystem.kind === "petrol") {
      c.fuelSystem.mixture = "port-injection";
      c.fuelSystem.fuel = "ron95";
    }
  });
/** Carburettor petrol: no knock control (petrol.md §3.6), so raw knock becomes visible. */
const petrolCarb = (fuel: "ron91" | "ron95" | "ron98" | "ron102" | "e85", advance: number) =>
  variant(petrolNA(), (c) => {
    c.block.compressionRatio = 11;
    if (c.fuelSystem.kind === "petrol") {
      c.fuelSystem.mixture = "carburettor";
      c.fuelSystem.fuel = fuel;
      c.fuelSystem.ignitionAdvanceOffsetDeg = advance;
    }
  });

function petrolFuel(c: EngineConfig) {
  if (c.fuelSystem.kind !== "petrol") throw new Error("not petrol");
  return c.fuelSystem;
}
function dieselFuel(c: EngineConfig) {
  if (c.fuelSystem.kind !== "diesel") throw new Error("not diesel");
  return c.fuelSystem;
}

/** Runs the engine on the dyno at `rpm` with `pedal` and returns per-step states of the last `avgS` seconds. */
function dynoRun(cfg: EngineConfig, rpm: number, pedal: number, seconds = 8, avgS = 2, extra: Partial<SimInputs> = {}): EngineState[] {
  const sim = startEngine(cfg, 2);
  const out: EngineState[] = [];
  const dt = 1 / 60;
  runPhases(sim, [
    {
      seconds,
      input: { ignition: true, pedal, dynoMode: "hold-rpm", dynoTargetRpm: rpm, ...extra },
      onStep: (s, t) => {
        if (t >= seconds - avgS) out.push({ ...s });
      },
    },
  ], dt);
  return out;
}
const avg = (xs: EngineState[], k: keyof EngineState) => mean(xs.map((s) => s[k] as number));
const max = (xs: EngineState[], k: keyof EngineState) => Math.max(...xs.map((s) => s[k] as number));

// ───────────────────────────── geometry & size ─────────────────────────────
describe("size and geometry (diesel.md §2, petrol.md §2)", () => {
  spec("displacement grows with bore, stroke and cylinders", () => {
    const base = petrol();
    expect(displacementL(variant(base, (c) => (c.block.boreMm += 5)))).toBeGreaterThan(displacementL(base));
    expect(displacementL(variant(base, (c) => (c.block.strokeMm += 5)))).toBeGreaterThan(displacementL(base));
    expect(displacementL(variant(base, (c) => (c.block.cylinders = 6)))).toBeCloseTo(displacementL(base) * 1.5, 6);
  });

  spec("diesel: larger bore → more peak torque", () => {
    const small = sweepPeaks(diesel()).torque.torqueNm;
    const big = sweepPeaks(variant(diesel(), (c) => (c.block.boreMm = 88))).torque.torqueNm;
    expect(big).toBeGreaterThan(small * 1.08);
  });

  spec("petrol: larger bore → more peak torque", () => {
    const small = sweepPeaks(petrolNA()).torque.torqueNm;
    const big = sweepPeaks(variant(petrolNA(), (c) => (c.block.boreMm = 90))).torque.torqueNm;
    expect(big).toBeGreaterThan(small * 1.08);
  });

  spec("torque scales roughly with displacement: 6 instead of 4 equal cylinders → ×1.35 … 1.65", () => {
    const four = sweepPeaks(petrolNA()).torque.torqueNm;
    const six = sweepPeaks(variant(petrolNA(), (c) => (c.block.cylinders = 6))).torque.torqueNm;
    expect(six / four).toBeGreaterThan(1.35);
    expect(six / four).toBeLessThan(1.65);
  });

  spec("summary: mean piston speed at the limiter = 2·S·n/60", () => {
    const c = petrol();
    const s = summarize(c);
    expect(s.maxMeanPistonSpeedMs).toBeCloseTo((2 * c.block.strokeMm / 1000 * c.revLimitRpm) / 60, 3);
  });
});

// ───────────────────────────── efficiency ─────────────────────────────
describe("efficiency and BSFC (petrol.md §3.5/§3.9, diesel.md §3.3/§3.5)", () => {
  spec("petrol: higher compression ratio → better best BSFC (high-octane fuel, no knock limit)", () => {
    const mk = (eps: number) =>
      variant(petrolNA(), (c) => {
        c.block.compressionRatio = eps;
        petrolFuel(c).fuel = "ron102";
      });
    expect(sweepPeaks(mk(12)).minBsfc).toBeLessThan(sweepPeaks(mk(9)).minBsfc * 0.97);
  });

  spec("diesel: higher compression ratio → better best BSFC", () => {
    const lo = sweepPeaks(variant(diesel(), (c) => (c.block.compressionRatio = 14))).minBsfc;
    const hi = sweepPeaks(variant(diesel(), (c) => (c.block.compressionRatio = 19))).minBsfc;
    expect(hi).toBeLessThan(lo * 0.99);
  });

  spec("best BSFC in the literature bands: CR diesel 190 … 235, petrol 220 … 290 g/kWh", () => {
    const d = sweepPeaks(diesel()).minBsfc;
    const p = sweepPeaks(petrolNA()).minBsfc;
    expect(d).toBeGreaterThan(190);
    expect(d).toBeLessThan(235);
    expect(p).toBeGreaterThan(220);
    expect(p).toBeLessThan(290);
  });

  spec("diesel is more efficient than petrol at full load (best BSFC)", () => {
    expect(sweepPeaks(diesel()).minBsfc).toBeLessThan(sweepPeaks(petrolNA()).minBsfc * 0.92);
  });

  spec("petrol part load: throttling → manifold < 70 kPa and BSFC at 25 % load ≥ 1.25 × diesel", () => {
    const p = partLoadPoint(petrolNA(), 2000, 0.25);
    const d = partLoadPoint(diesel(), 2000, 0.25);
    expect(p.state.manifoldAbsKpa).toBeLessThan(70);
    expect(Number.isFinite(p.bsfc) && Number.isFinite(d.bsfc)).toBe(true);
    expect(p.bsfc).toBeGreaterThan(d.bsfc * 1.25);
  });

  spec("petrol: BSFC at 25 % load clearly worse than at full load (pumping losses)", () => {
    const part = partLoadPoint(petrolNA(), 2000, 0.25).bsfc;
    const full = sweepAt(sweepPeaks(petrolNA()).points, 2000, "bsfcGkWh");
    expect(part).toBeGreaterThan(full * 1.2);
  });

  spec("diesel: no throttle → manifold ≥ ambient and λ > 2.5 at 25 % load", () => {
    const d = partLoadPoint(diesel(), 2000, 0.25);
    expect(d.state.manifoldAbsKpa).toBeGreaterThan(95);
    expect(d.state.lambda).toBeGreaterThan(2.5);
  });

  spec("petrol: λ ≈ 1 at part load (catalyst), enriched at full load", () => {
    const part = partLoadPoint(petrolNA(), 2500, 0.4).state.lambda;
    expect(part).toBeGreaterThan(0.95);
    expect(part).toBeLessThan(1.05);
    expect(sweepAt(sweepPeaks(petrolNA()).points, 4000, "lambda")).toBeLessThan(0.95);
  });

  spec("diesel: pre-chamber has worse BSFC than common rail (≥ +8 %)", () => {
    const cr = sweepPeaks(diesel()).minBsfc;
    const idi = sweepPeaks(
      variant(diesel(), (c) => {
        c.block.compressionRatio = 22;
        dieselFuel(c).injection = "indirect-prechamber";
        dieselFuel(c).injectionPressureBar = 300;
      }),
    ).minBsfc;
    expect(idi).toBeGreaterThan(cr * 1.08);
  });

  spec("petrol: rich full-load λ 0.75 → worse BSFC than λ 0.88", () => {
    const rich = sweepPeaks(variant(petrolNA(), (c) => (petrolFuel(c).fullLoadLambda = 0.75))).minBsfc;
    const opt = sweepPeaks(petrolNA()).minBsfc;
    expect(rich).toBeGreaterThan(opt * 1.05);
  });
});

// ───────────────────────────── pressures & temperatures ─────────────────────────────
describe("peak pressure and exhaust temperature (petrol.md §3.10/§3.11, diesel.md §3.6/§3.7)", () => {
  spec("diesel peak cylinder pressure > petrol", () => {
    expect(sweepPeaks(diesel()).maxPeakPressure).toBeGreaterThan(sweepPeaks(petrolNA()).maxPeakPressure * 1.4);
  });

  spec("peak pressure bands: diesel 120 … 220 bar, NA petrol 50 … 110 bar", () => {
    const d = sweepPeaks(diesel()).maxPeakPressure;
    const p = sweepPeaks(petrolNA()).maxPeakPressure;
    expect(d).toBeGreaterThan(120);
    expect(d).toBeLessThan(220);
    expect(p).toBeGreaterThan(50);
    expect(p).toBeLessThan(110);
  });

  spec("full-load EGT: diesel colder than petrol", () => {
    const d = Math.max(...sweepPeaks(diesel()).points.map((p) => p.egtC));
    const p = Math.max(...sweepPeaks(petrolNA()).points.map((p) => p.egtC));
    expect(d).toBeLessThan(p);
    expect(d).toBeGreaterThan(550);
    expect(d).toBeLessThan(850);
  });

  spec("diesel: retarded injection (−8 °CA) → higher EGT, lower peak pressure", () => {
    const base = sweepPeaks(diesel()).points;
    const late = sweepPeaks(variant(diesel(), (c) => (dieselFuel(c).injectionTimingOffsetDeg = -8))).points;
    expect(sweepAt(late, 3000, "egtC")).toBeGreaterThan(sweepAt(base, 3000, "egtC") + 20);
    expect(sweepAt(late, 3000, "peakPressureBar")).toBeLessThan(sweepAt(base, 3000, "peakPressureBar"));
  });

  spec("petrol: retarded ignition (−15 °CA) → less torque, hotter exhaust", () => {
    const base = sweepPeaks(petrolNA()).points;
    const late = sweepPeaks(variant(petrolNA(), (c) => (petrolFuel(c).ignitionAdvanceOffsetDeg = -15))).points;
    expect(sweepAt(late, 4000, "torqueNm")).toBeLessThan(sweepAt(base, 4000, "torqueNm") * 0.95);
    expect(sweepAt(late, 4000, "egtC")).toBeGreaterThan(sweepAt(base, 4000, "egtC") + 30);
  });
});

// ───────────────────────────── charging ─────────────────────────────
describe("charging (petrol.md §3.12, diesel.md §3.9)", () => {
  spec("petrol turbo: more boost → more peak power", () => {
    const lo = sweepPeaks(variant(petrol(), (c) => (c.induction.boostTargetBar = 0.6))).power.powerKw;
    const hi = sweepPeaks(variant(petrol(), (c) => (c.induction.boostTargetBar = 1.2))).power.powerKw;
    expect(hi).toBeGreaterThan(lo * 1.15);
  });

  spec("diesel: more boost → more peak torque (nearly linear)", () => {
    const lo = sweepPeaks(variant(diesel(), (c) => (c.induction.boostTargetBar = 0.8))).torque.torqueNm;
    const hi = sweepPeaks(variant(diesel(), (c) => (c.induction.boostTargetBar = 1.6))).torque.torqueNm;
    expect(hi).toBeGreaterThan(lo * 1.2);
  });

  spec("diesel: turbo vs naturally aspirated → ×1.6 or more peak torque", () => {
    const na = sweepPeaks(variant(diesel(), (c) => {
      c.induction.aspiration = "naturally-aspirated";
      c.induction.boostTargetBar = 0;
      c.induction.intercooler = "none";
    })).torque.torqueNm;
    expect(sweepPeaks(diesel()).torque.torqueNm).toBeGreaterThan(na * 1.6);
  });

  spec("turbo has a low-end torque hole vs. Roots supercharger (share of peak at 1200 rpm)", () => {
    const mk = (a: EngineConfig["induction"]["aspiration"]) =>
      variant(petrol(), (c) => {
        c.induction.aspiration = a;
        c.induction.variableGeometry = false;
        c.induction.compressorInducerMm = 50;
      });
    const turbo = sweepPeaks(mk("turbo"), { fromRpm: 1000 });
    const roots = sweepPeaks(mk("supercharger-roots"), { fromRpm: 1000 });
    const shareTurbo = sweepAt(turbo.points, 1200, "torqueNm") / turbo.torque.torqueNm;
    const shareRoots = sweepAt(roots.points, 1200, "torqueNm") / roots.torque.torqueNm;
    expect(shareTurbo).toBeLessThan(shareRoots - 0.1);
  });

  spec("intercooler → more power (turbo petrol)", () => {
    const none = sweepPeaks(variant(petrol(), (c) => (c.induction.intercooler = "none"))).power.powerKw;
    expect(sweepPeaks(petrol()).power.powerKw).toBeGreaterThan(none * 1.04);
  });

  spec("simulator: bigger turbo (inducer 56 vs 36 mm) → longer turbo lag", () => {
    const mk = (d: number) =>
      variant(diesel(), (c) => {
        c.induction.compressorInducerMm = d;
        c.induction.variableGeometry = false;
      });
    const small = boostRiseTime(mk(36), 2500);
    const big = boostRiseTime(mk(56), 2500);
    expect(small.final).toBeGreaterThan(0.3);
    expect(big.t90).toBeGreaterThan(small.t90 * 1.3);
  });

  spec("simulator: VTG responds faster than wastegate", () => {
    const vtg = boostRiseTime(diesel(), 2000);
    const wg = boostRiseTime(variant(diesel(), (c) => (c.induction.variableGeometry = false)), 2000);
    expect(vtg.t90).toBeLessThan(wg.t90);
  });

  spec("simulator: Roots supercharger has (almost) no lag compared to turbo", () => {
    const roots = boostRiseTime(variant(petrol(), (c) => (c.induction.aspiration = "supercharger-roots")), 2500);
    const turbo = boostRiseTime(petrol(), 2500);
    expect(roots.t90).toBeLessThan(turbo.t90 * 0.5);
  });

  spec("thinner air (70 kPa ambient) → less torque for a naturally aspirated engine", () => {
    const sea = avg(dynoRun(petrolNA(), 3500, 1), "torqueNm");
    const high = avg(dynoRun(petrolNA(), 3500, 1, 8, 2, { ambientKpa: 70 }), "torqueNm");
    expect(high).toBeLessThan(sea * 0.8);
  });
});

// ───────────────────────────── VE / cam ─────────────────────────────
describe("volumetric efficiency (petrol.md §3.2)", () => {
  spec("longer intake runner moves the torque peak to lower rpm", () => {
    const short = sweepPeaks(variant(petrolNA(), (c) => (c.induction.intakeRunnerLengthMm = 180))).torque.rpm;
    const long = sweepPeaks(variant(petrolNA(), (c) => (c.induction.intakeRunnerLengthMm = 600))).torque.rpm;
    expect(long).toBeLessThan(short);
  });

  spec("sharper cam moves the power peak to higher rpm", () => {
    const mk = (cam: number) => variant(petrolNA(), (c) => {
      c.head.camProfile = cam;
      c.revLimitRpm = 9000;
    });
    expect(sweepPeaks(mk(0.9)).power.rpm).toBeGreaterThan(sweepPeaks(mk(0.1)).power.rpm);
  });
});

// ───────────────────────────── fuels & knock ─────────────────────────────
describe("fuels and knock (petrol.md §3.4/§3.6, diesel.md §2)", () => {
  spec("more ignition advance → more knock (carburettor, no knock control)", () => {
    const k0 = max(dynoRun(petrolCarb("ron95", 0), 2000, 1), "knock");
    const k6 = max(dynoRun(petrolCarb("ron95", 6), 2000, 1), "knock");
    expect(k6).toBeGreaterThan(k0 + 0.1);
  });

  spec("higher octane → less knock", () => {
    const k91 = max(dynoRun(petrolCarb("ron91", 6), 2000, 1), "knock");
    const k102 = max(dynoRun(petrolCarb("ron102", 6), 2000, 1), "knock");
    expect(k91).toBeGreaterThan(0.2);
    expect(k102).toBeLessThan(k91 - 0.2);
  });

  spec("diesel never knocks, petrol never smokes", () => {
    expect(max(dynoRun(diesel(), 2000, 1), "knock")).toBe(0);
    expect(max(dynoRun(petrolNA(), 2000, 1), "smoke")).toBe(0);
  });

  spec("E85 → ~40 % more fuel volume per kWh than RON 98", () => {
    const run = (f: "ron98" | "e85") => {
      const xs = dynoRun(variant(petrolNA(), (c) => (petrolFuel(c).fuel = f)), 3500, 1);
      return avg(xs, "fuelFlowLh") / avg(xs, "powerKw");
    };
    const ratio = run("e85") / run("ron98");
    expect(ratio).toBeGreaterThan(1.25);
    expect(ratio).toBeLessThan(1.6);
  });

  spec("E85: power similar to petrol (±8 %), BSFC (g/kWh) ≥ 1.3×", () => {
    const e = sweepPeaks(variant(petrolNA(), (c) => (petrolFuel(c).fuel = "e85")));
    const g = sweepPeaks(variant(petrolNA(), (c) => (petrolFuel(c).fuel = "ron98")));
    expect(Math.abs(e.power.powerKw / g.power.powerKw - 1)).toBeLessThan(0.08);
    expect(e.minBsfc).toBeGreaterThan(g.minBsfc * 1.3);
  });

  spec("biodiesel → less torque (−5 … −13 %) and higher BSFC than diesel", () => {
    const bio = sweepPeaks(variant(diesel(), (c) => (dieselFuel(c).fuel = "biodiesel")));
    const d = sweepPeaks(diesel());
    expect(bio.torque.torqueNm / d.torque.torqueNm).toBeLessThan(0.95);
    expect(bio.torque.torqueNm / d.torque.torqueNm).toBeGreaterThan(0.87);
    expect(bio.minBsfc).toBeGreaterThan(d.minBsfc * 1.05);
  });

  spec("diesel: lower smoke limit λ → more torque and more smoke (no DPF)", () => {
    const mk = (l: number) =>
      variant(diesel(), (c) => {
        dieselFuel(c).smokeLimitLambda = l;
        c.exhaust.particulateFilter = false;
      });
    const rich = dynoRun(mk(1.05), 2500, 1);
    const lean = dynoRun(mk(1.45), 2500, 1);
    expect(avg(rich, "torqueNm")).toBeGreaterThan(avg(lean, "torqueNm") * 1.1);
    expect(avg(rich, "smoke")).toBeGreaterThan(avg(lean, "smoke") + 0.2);
  });

  spec("diesel: particulate filter removes visible smoke", () => {
    const mk = (dpf: boolean) =>
      variant(diesel(), (c) => {
        dieselFuel(c).smokeLimitLambda = 1.05;
        c.exhaust.particulateFilter = dpf;
      });
    expect(avg(dynoRun(mk(true), 2500, 1), "smoke")).toBeLessThan(0.05);
  });
});

// ───────────────────────────── limits, damage, oil ─────────────────────────────
describe("limits and damage (petrol.md §4, diesel.md §4)", () => {
  spec("over-revving beyond the mechanical limit → warning or damage", () => {
    // limiter far above safeMaxRpm: stroke 100 mm, cast parts → cm at 11 000 rpm ≈ 37 m/s (fatal > 23)
    const cfg = variant(petrolNA(), (c) => {
      c.block.strokeMm = 100;
      c.block.boreMm = 80;
      c.block.crankshaft = "cast";
      c.block.conrods = "cast-steel";
      c.revLimitRpm = 11000;
    });
    const sim = startEngine(cfg, 2);
    const codes = new Set<string>();
    runPhases(sim, [{ seconds: 20, input: { ignition: true, pedal: 1 }, onStep: (s) => s.warnings.forEach((w) => codes.add(w.code)) }]);
    const s = sim.state;
    const hit = ["over-rev", "piston-speed", "valve-float", "conrod-stress"].some((c) => codes.has(c)) || s.damage.length > 0 || s.destroyed;
    expect(hit).toBe(true);
  });

  spec("no false alarms: default engines at 3000 rpm / half load have no critical warning", () => {
    for (const cfg of [diesel(), petrol()]) {
      const xs = dynoRun(cfg, 3000, 0.5);
      expect(xs.flatMap((s) => s.warnings).filter((w) => w.severity === "critical")).toEqual([]);
      expect(xs[xs.length - 1]!.destroyed).toBe(false);
    }
  });

  spec("diesel: too much boost on cast pistons → peak-pressure warning", () => {
    const cfg = variant(diesel(), (c) => {
      c.induction.boostTargetBar = 3.5;
      c.induction.compressorInducerMm = 50;
      c.block.compressionRatio = 19;
      dieselFuel(c).smokeLimitLambda = 1.05;
      dieselFuel(c).injectionTimingOffsetDeg = 6;
    });
    const sim = startEngine(cfg, 2);
    const codes = new Set<string>();
    runPhases(sim, [{ seconds: 15, input: { ignition: true, pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: 2500 }, onStep: (s) => s.warnings.forEach((w) => codes.add(w.code)) }]);
    expect(codes.has("peak-pressure") || sim.state.damage.some((d) => d.code === "peak-pressure" || d.code === "conrod-stress")).toBe(true);
  });

  spec("cold oil → higher oil pressure and higher friction than warm oil", () => {
    const at = (ambientC: number) => dynoRun(diesel(), 2500, 0.3, 4, 1, { ambientC });
    const cold = at(-10);
    const warm = at(40);
    expect(avg(cold, "oilPressureBar")).toBeGreaterThan(avg(warm, "oilPressureBar") * 1.05);
    expect(avg(cold, "fmepBar")).toBeGreaterThan(avg(warm, "fmepBar") * 1.05);
  });

  spec("oil pressure rises with rpm (≈ 1 bar / 1000 rpm, capped)", () => {
    const lo = avg(dynoRun(petrol(), 1500, 0.3), "oilPressureBar");
    const hi = avg(dynoRun(petrol(), 4000, 0.3), "oilPressureBar");
    expect(lo).toBeGreaterThan(0.5);
    expect(hi).toBeGreaterThan(lo * 1.5);
    expect(hi).toBeLessThanOrEqual(6);
  });

  spec("validateConfig flags an impossible config (ohv with 4 valves)", () => {
    const bad = variant(petrol(), (c) => {
      c.head.valvetrain = "ohv";
      c.head.valvesPerCylinder = 4;
    });
    expect(validateConfig(bad).length).toBeGreaterThan(0);
    expect(validateConfig(referenceConfig("ref-gm-ls3-62")).filter((w) => w.severity === "critical")).toEqual([]);
  });

  spec("summary: safeMaxRpm is lower for a long stroke and cast parts", () => {
    const short = summarize(variant(petrolNA(), (c) => (c.block.strokeMm = 75))).safeMaxRpm;
    const long = summarize(variant(petrolNA(), (c) => (c.block.strokeMm = 100))).safeMaxRpm;
    expect(long).toBeLessThan(short);
    const forged = summarize(variant(petrolNA(), (c) => {
      c.block.crankshaft = "billet";
      c.block.pistons = "forged-aluminium";
      c.block.conrods = "titanium";
    })).safeMaxRpm;
    const cast = summarize(variant(petrolNA(), (c) => {
      c.block.crankshaft = "cast";
      c.block.pistons = "cast-aluminium";
      c.block.conrods = "cast-steel";
    })).safeMaxRpm;
    expect(forged).toBeGreaterThan(cast);
  });

  spec("summary: mass grows with displacement, aluminium block is lighter than cast iron", () => {
    const small = summarize(diesel()).massKg;
    const big = summarize(referenceConfig("ref-cummins-6bt-59")).massKg;
    expect(big).toBeGreaterThan(small * 1.8);
    const alu = summarize(variant(diesel(), (c) => (c.block.blockMaterial = "aluminium"))).massKg;
    expect(alu).toBeLessThan(small);
  });

  spec("summary: firing intervals — crossplane V8 even 90°, R4 180°", () => {
    expect(summarize(referenceConfig("ref-gm-ls3-62")).firingIntervalsDeg).toEqual([90, 90, 90, 90, 90, 90, 90, 90]);
    expect(summarize(petrol()).firingIntervalsDeg).toEqual([180, 180, 180, 180]);
  });
});

// Keep EngineSimulator import used for type-only builds.
void EngineSimulator;
