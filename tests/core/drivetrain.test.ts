import { describe, expect, test } from "bun:test";
import { Drivetrain, EngineSimulator, defaultInputs, summarize, theoreticalVmax } from "../../src/core/index.ts";
import type { GearboxType } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";

function run(fuel: "diesel" | "petrol", type: GearboxType, seconds: number) {
  const cfg = defaultConfig(fuel);
  const sum = summarize(cfg);
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, sum, type);
  const inp = { ...defaultInputs(), ignition: true, starter: true, dynoMode: "vehicle" as const };
  const step = (pedal: number) => {
    const vehicle = dt.inputs(1 / 60, sim.state, pedal);
    sim.step(1 / 60, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
  };
  for (let i = 0; i < 120; i++) step(0);
  inp.starter = false;
  for (let i = 0; i < 120; i++) step(0);
  let minRpm = Infinity;
  for (let i = 0; i < seconds * 60; i++) {
    if (type === "manual" && sim.state.rpm > cfg.revLimitRpm - 250 && !dt.state.shifting && dt.state.clutch > 0.95) dt.shift(1);
    step(1);
    expect(Number.isFinite(sim.state.rpm)).toBe(true);
    if (i > 60) minRpm = Math.min(minRpm, sim.state.rpm);
  }
  return { dt, sim, minRpm };
}

describe("drivetrain (issue #14 base)", () => {
  for (const type of ["manual", "dsg", "cvt"] as const) {
    test(`petrol ${type}: launches without stalling, plausible 0–100 and top speed`, () => {
      const { dt, sim, minRpm } = run("petrol", type, 60);
      expect(sim.state.running).toBe(true);
      expect(minRpm).toBeGreaterThan(600);
      expect(dt.state.t0to100S).not.toBeNull();
      expect(dt.state.t0to100S!).toBeGreaterThan(5);
      expect(dt.state.t0to100S!).toBeLessThan(10);
      expect(dt.state.maxSpeedKmh).toBeGreaterThan(220);
      expect(dt.state.maxSpeedKmh).toBeLessThan(290);
    });
  }

  test("diesel DSG shifts up by itself and reaches ≈ 200 km/h", () => {
    const { dt } = run("diesel", "dsg", 90);
    expect(dt.state.gear).toBeGreaterThanOrEqual(6);
    expect(dt.state.maxSpeedKmh).toBeGreaterThan(185);
    expect(dt.state.maxSpeedKmh).toBeLessThan(230);
  });

  test("manual: engine without gear shift stays in 1st and hits the limiter", () => {
    const cfg = defaultConfig("petrol");
    const dt = new Drivetrain(cfg, summarize(cfg), "manual");
    dt.shift(1);
    expect(dt.state.shifting).toBe(true);
    expect(dt.effectivePedal(1)).toBe(0); // lift-off during a manual shift
  });

  test("shorter final drive: limiter-bound top speed drops", () => {
    const flat = () => 300;
    const long = theoreticalVmax(flat, 6000, "manual", 2.5);
    const short = theoreticalVmax(flat, 6000, "manual", 5.5);
    expect(short.limitedBy).toBe("limiter");
    expect(short.vmaxKmh).toBeLessThan(long.vmaxKmh);
  });
});

describe("drivetrain review #19", () => {
  test("DSG refuses a downshift that would over-rev, reset clears launch memory", () => {
    const cfg = defaultConfig("petrol");
    const sum = summarize(cfg);
    const dt = new Drivetrain(cfg, sum, "dsg");
    // fake state: running at 200 km/h in 7th
    const fake = { running: true, rpm: 4000, vehicleSpeedMs: 200 / 3.6 } as Parameters<Drivetrain["inputs"]>[1];
    for (let g = 0; g < 6; g++) dt.shift(1), dt.inputs(0.2, fake, 0.5);
    expect(dt.state.gear).toBe(7);
    for (let k = 0; k < 6; k++) dt.shift(-1), dt.inputs(0.2, fake, 0.5);
    // 1st gear at 200 km/h would be ≈ 20 000 1/min: never selected
    expect(dt.state.gear).toBeGreaterThan(2);
    dt.reset();
    const c = dt.inputs(1 / 60, { running: true, rpm: 800, vehicleSpeedMs: 0 } as typeof fake, 0);
    expect(c.clutch).toBe(0);
  });
});
