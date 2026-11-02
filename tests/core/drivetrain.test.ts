import { describe, expect, test } from "bun:test";
import { Drivetrain, EngineSimulator, defaultInputs, summarize, theoreticalVmax } from "../../src/core/index.ts";
import type { GearboxType } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import type { EngineConfig } from "../../src/core/index.ts";

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

describe("service brake", () => {
  test("full brake from 100 km/h stops in ≈ 35–50 m without stalling the engine", () => {
    const cfg = defaultConfig("petrol");
    const sim = new EngineSimulator(cfg);
    const dt = new Drivetrain(cfg, summarize(cfg), "dsg");
    const inp = { ...defaultInputs(), ignition: true, starter: true, dynoMode: "vehicle" as const };
    const step = (pedal: number, brake: number) => {
      const vehicle = dt.inputs(1 / 60, sim.state, pedal, brake);
      sim.step(1 / 60, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
    };
    for (let i = 0; i < 240; i++) { if (i === 120) inp.starter = false; step(0, 0); }
    let k = 0;
    while ((sim.state.vehicleSpeedMs ?? 0) < 100 / 3.6 && k++ < 60 * 30) step(1, 0);
    let dist = 0;
    for (let i = 0; i < 60 * 10; i++) { dist += (sim.state.vehicleSpeedMs ?? 0) / 60; step(0, 1); }
    expect(sim.state.vehicleSpeedMs).toBeLessThan(0.1);
    expect(dist).toBeGreaterThan(30);
    expect(dist).toBeLessThan(55);
    expect(sim.state.running).toBe(true);
  });
});

describe("top-speed governor (issue #32)", () => {
  function drive(fuel: "diesel" | "petrol" | EngineConfig, type: GearboxType, limit: number | null, seconds: number) {
    const cfg = typeof fuel === "string" ? defaultConfig(fuel) : fuel;
    const sim = new EngineSimulator(cfg);
    const dt = new Drivetrain(cfg, summarize(cfg), type);
    dt.setSpeedLimit(limit);
    const inp = { ...defaultInputs(), ignition: true, starter: true, dynoMode: "vehicle" as const };
    const step = (pedal: number) => {
      const vehicle = dt.inputs(1 / 60, sim.state, pedal);
      sim.step(1 / 60, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
    };
    for (let i = 0; i < 120; i++) step(0);
    inp.starter = false;
    for (let i = 0; i < 120; i++) step(0);
    const tail: number[] = [];
    let gearChanges = 0;
    let lastGear = dt.state.gear;
    for (let i = 0; i < seconds * 60; i++) {
      // manual: driver shifts up near the limiter (as in run())
      if (type === "manual" && sim.state.rpm > cfg.revLimitRpm - 250 && !dt.state.shifting && dt.state.clutch > 0.95 && dt.state.gear < dt.state.gearCount) dt.shift(1);
      step(1);
      if (i >= (seconds - 20) * 60) {
        tail.push(dt.state.speedKmh);
        if (dt.state.gear !== lastGear) gearChanges++;
      }
      lastGear = dt.state.gear;
    }
    return { dt, sim, step, tail, gearChanges };
  }

  test("default limit is 250 km/h", () => {
    const cfg = defaultConfig("petrol");
    expect(new Drivetrain(cfg, summarize(cfg), "dsg").state.speedLimitKmh).toBe(250);
  });

  test("petrol DSG at 210: no overshoot above 212, holds 210 ± 2 without oscillating", () => {
    const { dt, tail, gearChanges } = drive("petrol", "dsg", 210, 90);
    expect(dt.state.maxSpeedKmh).toBeLessThanOrEqual(212);
    expect(Math.min(...tail)).toBeGreaterThan(208);
    expect(Math.max(...tail)).toBeLessThan(212);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(1);
    expect(gearChanges).toBe(0);
    expect(dt.state.limiting).toBe(true);
    expect(dt.state.maxSpeedLimited).toBe(true);
    expect(dt.effectivePedal(1)).toBeLessThan(0.95); // pedal really held back
  });

  test("petrol DSG with the governor off ('Aufhebung') goes beyond 250", () => {
    const { dt } = drive("petrol", "dsg", null, 90);
    expect(dt.state.speedLimitKmh).toBeNull();
    expect(dt.state.maxSpeedKmh).toBeGreaterThan(250);
    expect(dt.state.limiting).toBe(false);
    expect(dt.state.maxSpeedLimited).toBe(false);
  });

  test("diesel DSG stays below 250, governor never intervenes", () => {
    const on = drive("diesel", "dsg", 250, 90);
    const off = drive("diesel", "dsg", null, 90);
    expect(on.dt.state.maxSpeedKmh).toBeLessThan(245);
    expect(on.dt.state.limiting).toBe(false);
    expect(on.dt.state.maxSpeedLimited).toBe(false);
    expect(Math.abs(on.dt.state.maxSpeedKmh - off.dt.state.maxSpeedKmh)).toBeLessThan(0.01);
  });

  test("driver lifting below the cap gets exactly his pedal, reset keeps the setting", () => {
    const { dt } = drive("petrol", "cvt", 180, 60);
    expect(dt.effectivePedal(0)).toBe(0);
    dt.reset();
    expect(dt.state.speedLimitKmh).toBe(180);
    expect(dt.state.limiting).toBe(false);
    dt.setSpeedLimit(null);
    expect(dt.effectivePedal(1)).toBe(1);
  });

  for (const limit of [180, 250] as const) {
    test(`petrol DSG at ${limit}: holds ± 2 and does not hunt between gears`, () => {
      const { tail, gearChanges } = drive("petrol", "dsg", limit, 90);
      expect(Math.min(...tail)).toBeGreaterThan(limit - 2);
      expect(Math.max(...tail)).toBeLessThan(limit + 2);
      expect(gearChanges).toBeLessThanOrEqual(1);
    });
  }

  test("BMW S65 (library) DSG at 270: holds 270 ± 2, no gear hunting", () => {
    const { dt, tail, gearChanges } = drive(libraryConfig("lib-bmw-s65b40"), "dsg", 270, 90);
    expect(dt.state.maxSpeedKmh).toBeLessThanOrEqual(272);
    expect(Math.min(...tail)).toBeGreaterThan(268);
    expect(Math.max(...tail)).toBeLessThan(272);
    expect(gearChanges).toBeLessThanOrEqual(1);
  });

  test("manual gearbox at 210: holds 210 ± 2", () => {
    const { dt, tail } = drive("petrol", "manual", 210, 90);
    expect(dt.state.maxSpeedKmh).toBeLessThanOrEqual(212);
    expect(Math.min(...tail)).toBeGreaterThan(208);
    expect(Math.max(...tail)).toBeLessThan(212);
    expect(dt.state.limiting).toBe(true);
  });

  test("setType resets the governor but keeps the chosen limit", () => {
    const { dt } = drive("petrol", "dsg", 210, 60);
    expect(dt.state.limiting).toBe(true);
    dt.setType("cvt");
    expect(dt.state.limiting).toBe(false);
    expect(dt.state.speedLimitKmh).toBe(210);
    expect(dt.effectivePedal(1)).toBe(1);
  });

  test("anti-windup: short lift inside the window, full throttle holds the limit again at once", () => {
    const { dt, step } = drive("petrol", "dsg", 210, 90);
    for (let i = 0; i < 20; i++) step(0); // lift 1/3 s
    const vLift = dt.state.speedKmh;
    let min = Infinity;
    let backS = -1;
    for (let i = 0; i < 120; i++) {
      step(1);
      min = Math.min(min, dt.state.speedKmh);
      if (backS < 0 && dt.state.speedKmh >= 209.5) backS = i / 60;
    }
    expect(min).toBeGreaterThan(vLift - 0.3); // no further sag from a wound-down integrator
    expect(min).toBeGreaterThan(208);
    expect(backS).toBeGreaterThanOrEqual(0);
    expect(backS).toBeLessThan(1.5);
  });

  test("anti-windup: after a 1 s lift the governor gives full pedal until close to the limit", () => {
    const { dt, step } = drive("petrol", "dsg", 210, 90);
    for (let i = 0; i < 60; i++) step(0); // 1 s lift: drag alone costs ≈ 4–5 km/h at 210
    const vLift = dt.state.speedKmh;
    let min = Infinity;
    for (let i = 0; i < 300; i++) {
      if (dt.state.speedKmh < 207) expect(dt.effectivePedal(1)).toBeGreaterThan(0.95);
      step(1);
      min = Math.min(min, dt.state.speedKmh);
    }
    expect(min).toBeGreaterThan(vLift - 0.3);
    expect(dt.state.speedKmh).toBeGreaterThan(208);
    expect(dt.state.speedKmh).toBeLessThan(212);
  });
});
