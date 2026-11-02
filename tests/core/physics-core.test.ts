// Kern-Physik own unit tests (issue #3). Public API plus the pure sub-models of src/core.
import { describe, expect, test } from "bun:test";
import { EngineSimulator, defaultInputs, dynoSweep, summarize, validateConfig } from "../../src/core/index.ts";
import type { EngineConfig } from "../../src/core/index.ts";
import { etaSeiliger } from "../../src/core/combustion-diesel.ts";
import { knockIntensity, lambdaWorkFactor } from "../../src/core/combustion-petrol.ts";
import { firingIntervalsDeg, firingOrder, meanPistonSpeed } from "../../src/core/geometry.ts";
import { steadyManifoldRatio, throttlePsi } from "../../src/core/airpath.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { referenceConfig } from "../../src/data/reference-engines.ts";

const v = (fuel: "diesel" | "petrol", f: (c: EngineConfig) => void) => {
  const c = defaultConfig(fuel);
  f(c);
  return c;
};

describe("geometry", () => {
  const cases: [EngineConfig["block"]["layout"], number, number[]][] = [
    ["inline", 1, [720]],
    ["inline", 3, [240, 240, 240]],
    ["inline", 5, [144, 144, 144, 144, 144]],
    ["inline", 6, [120, 120, 120, 120, 120, 120]],
    ["boxer", 4, [180, 180, 180, 180]],
    ["v", 12, Array(12).fill(60)],
    ["w", 16, Array(16).fill(45)],
    ["vr", 6, Array(6).fill(120)],
  ];
  for (const [layout, n, iv] of cases) {
    test(`${layout}${n}: firing intervals ${iv[0]}°`, () => {
      const c = v("petrol", (c) => {
        c.block.layout = layout;
        c.block.cylinders = n;
      });
      expect(firingIntervalsDeg(c)).toEqual(iv);
      expect(firingOrder(c).length).toBe(n);
    });
  }
  test("V10 90° common crankpin: 90/54 alternating, V-twin 45°: 405/315", () => {
    const v10 = v("petrol", (c) => {
      c.block.layout = "v";
      c.block.cylinders = 10;
      c.block.bankAngleDeg = 90;
    });
    expect(firingIntervalsDeg(v10)).toEqual([90, 54, 90, 54, 90, 54, 90, 54, 90, 54]);
    const twin = v("petrol", (c) => {
      c.block.layout = "v";
      c.block.cylinders = 2;
      c.block.bankAngleDeg = 45;
    });
    expect(firingIntervalsDeg(twin)).toEqual([405, 315]);
  });
  test("V8 crossplane vs flatplane firing order (petrol.md §6.2)", () => {
    expect(firingOrder(referenceConfig("ref-gm-ls3-62"))).toEqual([1, 8, 7, 2, 6, 5, 4, 3]);
    expect(firingOrder(referenceConfig("ref-ferrari-f136fb-458"))).toEqual([1, 5, 3, 7, 4, 8, 2, 6]);
    expect(summarize(referenceConfig("ref-ferrari-f136fb-458")).firingOrder).toEqual([1, 5, 3, 7, 4, 8, 2, 6]);
  });
  test("mean piston speed", () => {
    expect(meanPistonSpeed(90, 4000)).toBeCloseTo(12, 6);
  });
});

describe("sub-models", () => {
  test("Seiliger efficiency matches the diesel.md §3.3 check (ε 16, λ 1.3 → ≈ 0.59)", () => {
    expect(etaSeiliger(16, 1 + 0.7 / 1.3, 1 + 0.9 / 1.3)).toBeGreaterThan(0.56);
    expect(etaSeiliger(16, 1 + 0.7 / 1.3, 1 + 0.9 / 1.3)).toBeLessThan(0.62);
  });
  test("λ work factor peaks rich of stoichiometric (petrol.md §3.5)", () => {
    expect(lambdaWorkFactor(0.88)).toBeGreaterThan(lambdaWorkFactor(1));
    expect(lambdaWorkFactor(0.7)).toBeLessThan(lambdaWorkFactor(0.88));
  });
  test("knock intensity is cut by retard", () => {
    expect(knockIntensity(-8, 0)).toBe(1);
    expect(knockIntensity(-8, 10)).toBe(0);
  });
  test("throttle: choked below 0.528, steady manifold ratio monotonic in opening", () => {
    expect(throttlePsi(0.3)).toBe(1);
    expect(throttlePsi(1)).toBe(0);
    expect(steadyManifoldRatio(0.1, 1)).toBeLessThan(steadyManifoldRatio(0.5, 1));
  });
});

describe("summary and validation", () => {
  test("summary carries limits (#9) consistent with the config", () => {
    const d = summarize(defaultConfig("diesel"));
    const p = summarize(defaultConfig("petrol"));
    expect(d.limits.egtMaxC).toBeLessThan(p.limits.egtMaxC);
    expect(d.limits.boostMaxBar).toBeGreaterThan(1.3);
    expect(summarize(referenceConfig("ref-gm-ls3-62")).limits.turboMaxRpm).toBe(0);
    expect(d.firingOrder).toEqual([1, 3, 4, 2]);
  });
  test("validateConfig: German messages with field paths", () => {
    const w = validateConfig(v("diesel", (c) => (c.block.compressionRatio = 11)));
    const cr = w.find((x) => x.field === "block.compressionRatio");
    expect(cr?.severity).toBe("critical");
    expect(cr?.message).toContain("Verdichtung");
    const t = validateConfig(v("petrol", (c) => (c.block.compressionRatio = 13)));
    expect(t.some((x) => x.code === "knock" && x.severity === "critical")).toBe(true);
    const cyl = validateConfig(v("petrol", (c) => {
      c.block.layout = "boxer";
      c.block.cylinders = 5;
    }));
    expect(cyl.some((x) => x.field === "block.cylinders")).toBe(true);
    for (const fuel of ["diesel", "petrol"] as const) {
      expect(validateConfig(defaultConfig(fuel)).filter((x) => x.severity === "critical")).toEqual([]);
    }
  });
  test("dyno sweep: diesel torque falls above the plateau, governor cuts at the limit", () => {
    const pts = dynoSweep(defaultConfig("diesel"), { fromRpm: 1500, toRpm: 5000, stepRpm: 100 });
    const at = (r: number) => pts.find((p) => p.rpm === r)!.torqueNm;
    expect(at(4500)).toBeLessThan(at(2500));
    expect(at(5000)).toBeLessThan(at(4500) * 0.5);
  });
});

describe("simulator", () => {
  const run = (sim: EngineSimulator, s: number, input: Partial<ReturnType<typeof defaultInputs>>, dt = 1 / 60) => {
    const out = [];
    for (let i = 0; i < Math.round(s / dt); i++) out.push(sim.step(dt, { ...defaultInputs(), ...input }));
    return out;
  };
  test("temperatures start at ambient of the first step (lead decision)", () => {
    const sim = new EngineSimulator(defaultConfig("diesel"));
    const s = sim.step(1 / 60, { ...defaultInputs(), ambientC: -15 });
    expect(s.coolantC).toBeCloseTo(-15, 0);
    expect(s.oilC).toBeCloseTo(-15, 0);
  });
  test("starterEngaged mirrors the starter, petrol limiter stutters (fuel cut with hysteresis)", () => {
    const cfg = defaultConfig("petrol");
    const sim = new EngineSimulator(cfg);
    expect(run(sim, 0.5, { ignition: true, starter: true }).at(-1)!.starterEngaged).toBe(true);
    run(sim, 3, { ignition: true });
    const rpm = run(sim, 6, { ignition: true, pedal: 1 }).slice(-120).map((s) => s.rpm);
    expect(Math.max(...rpm)).toBeLessThan(cfg.revLimitRpm * 1.03);
    expect(Math.max(...rpm) - Math.min(...rpm)).toBeGreaterThan(30);
  });
  test("diesel stalls under a huge brake torque and needs the starter again", () => {
    const sim = new EngineSimulator(defaultConfig("diesel"));
    run(sim, 2, { ignition: true, starter: true });
    run(sim, 2, { ignition: true });
    const s = run(sim, 5, { ignition: true, dynoMode: "torque", dynoBrakeTorqueNm: 800 }).at(-1)!;
    expect(s.running).toBe(false);
    expect(s.warnings.some((w) => w.code === "stall")).toBe(true);
    const back = run(sim, 3, { ignition: true }).at(-1)!;
    expect(back.running).toBe(false);
  });
  test("destroyed engine stops, stays finite", () => {
    // forged-free petrol, RON 91, lots of advance and boost → knock → fatal damage
    const cfg = v("petrol", (c) => {
      c.block.compressionRatio = 11;
      c.induction.boostTargetBar = 1.6;
      if (c.fuelSystem.kind === "petrol") {
        c.fuelSystem.fuel = "ron91";
        c.fuelSystem.mixture = "carburettor";
        c.fuelSystem.ignitionAdvanceOffsetDeg = 10;
      }
    });
    const sim = new EngineSimulator(cfg);
    run(sim, 2, { ignition: true, starter: true });
    const states = run(sim, 30, { ignition: true, pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: 3000 });
    const last = states.at(-1)!;
    expect(last.destroyed).toBe(true);
    expect(last.damage.length).toBe(1);
    expect(last.running).toBe(false);
    for (const [k, val] of Object.entries(last)) if (typeof val === "number" && k !== "bsfcGkWh") expect(Number.isFinite(val)).toBe(true);
  });
});
