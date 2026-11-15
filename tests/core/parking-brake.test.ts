// Issue #91: parking brake and Auto-Hold (Arthur's report: the car rolled by itself at standstill and the gear plate
// stayed locked while it rolled). docs/research/vehicle.md §7.
import { describe, expect, test } from "bun:test";
import {
  AUTO_HOLD_MAX_KMH, Drivetrain, EngineSimulator, PARK_BRAKE_HOLD_PCT, autoHoldEngages, defaultInputs, holdCapN, gradedRatios, parkBrakeCapN,
  summarize, terrainAt, terrainLengthM, DEFAULT_VEHICLE,
} from "../../src/core/index.ts";
import type { GearboxType, Terrain } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { cruiseRig } from "./cruise-rig.ts";

const H = 1 / 60;

function rig(type: GearboxType, fuel: "diesel" | "petrol" = "petrol", cfg = defaultConfig(fuel)) {
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg), type);
  const inp = { ...defaultInputs(), ignition: true, starter: true, startWarm: true, dynoMode: "vehicle" as const };
  const step = (pedal: number, brake = 0) => {
    const vehicle = dt.inputs(H, sim.state, pedal, brake);
    sim.step(H, { ...inp, ...dt.simInputs(), vehicle, pedal: dt.effectivePedal(pedal) });
    return vehicle;
  };
  const start = () => {
    inp.starter = true;
    for (let i = 0; i < 240; i++) {
      if (i === 90) inp.starter = false;
      step(0, 1);
    }
  };
  return { sim, dt, inp, step, start };
}

/** Position of the steepest downhill (most negative gradient) on a route. */
function steepestDown(t: Exclude<Terrain, "static">): { pos: number; grade: number } {
  let best = { pos: 0, grade: 0 };
  const len = terrainLengthM(t);
  for (let x = 0; x < len; x += 10) {
    const g = terrainAt(t, x).gradePct;
    if (g < best.grade) best = { pos: x, grade: g };
  }
  return best;
}

describe("Auto-Hold rules (issue #91)", () => {
  test("engages at walking pace without throttle when braking, engine off, in N or stopped", () => {
    const base = { speedKmh: 3, pedal: 0, brake: 0, running: true, gear: 1 };
    expect(autoHoldEngages(base)).toBe(false); // rolling at 3 km/h in gear without brake: no
    expect(autoHoldEngages({ ...base, brake: 1 })).toBe(true);
    expect(autoHoldEngages({ ...base, running: false })).toBe(true);
    expect(autoHoldEngages({ ...base, gear: 0 })).toBe(true);
    expect(autoHoldEngages({ ...base, speedKmh: 0.5 })).toBe(true);
    expect(autoHoldEngages({ ...base, speedKmh: 0.5, pedal: 0.3 })).toBe(false);
    expect(autoHoldEngages({ ...base, speedKmh: AUTO_HOLD_MAX_KMH + 0.1, brake: 1 })).toBe(false);
  });

  test("holding limit: 30 % on dry road, less on ice (tyre limit of the rear axle)", () => {
    const m = DEFAULT_VEHICLE.massKg;
    const cap = parkBrakeCapN(DEFAULT_VEHICLE, 1);
    expect(cap).toBeCloseTo(m * 9.81 * Math.sin(Math.atan(PARK_BRAKE_HOLD_PCT / 100)), 3);
    expect(PARK_BRAKE_HOLD_PCT).toBeGreaterThanOrEqual(20); // ECE R13-H minimum
    expect(parkBrakeCapN(DEFAULT_VEHICLE, 0.1)).toBeLessThan(0.1 * m * 9.81);
    // engine running: Auto-Hold adds the ESP hydraulic pressure, up to the tyre limit
    expect(holdCapN(DEFAULT_VEHICLE, 1, 1, true)).toBeGreaterThan(cap + 0.4 * m * 9.81);
    expect(holdCapN(DEFAULT_VEHICLE, 0.3, 1, true)).toBeCloseTo(0.3 * m * 9.81, 3);
    expect(holdCapN(DEFAULT_VEHICLE, 1, 1, false)).toBe(cap);
  });
});

describe("parking brake in the simulation (issue #91)", () => {
  for (const t of ["hills", "alps"] as const) {
    test(`${t}: stopped on the steepest downhill the car is held, no rolling away`, () => {
      const { sim, dt, step, start } = rig("dsg");
      const d = steepestDown(t);
      expect(d.grade).toBeLessThan(-3);
      dt.setEnvironment({ terrain: t });
      dt.setPosition(d.pos);
      start();
      expect(dt.state.parkingBrake).toBe(true);
      let vmax = 0;
      for (let i = 0; i < 20 * 60; i++) {
        step(0);
        vmax = Math.max(vmax, dt.state.speedKmh);
      }
      expect(vmax).toBe(0);
      expect(dt.state.parkingBrake).toBe(true);
      expect(sim.state.running).toBe(true);
      expect(dt.ratiosEditable).toBe(true);
    });
  }

  test("releases on throttle with a gear engaged and the car drives off", () => {
    const { dt, step, start } = rig("manual");
    dt.setEnvironment({ gradePct: 8 });
    start();
    for (let i = 0; i < 60; i++) step(0);
    expect(dt.state.parkingBrake).toBe(true);
    step(0.5);
    expect(dt.state.parkingBrake).toBe(false);
    for (let i = 0; i < 4 * 60; i++) step(0.5);
    expect(dt.state.speedKmh).toBeGreaterThan(10);
    expect(dt.state.parkingBrake).toBe(false);
  });

  test("engine off on −8 %: no rolling, in gear or in N", () => {
    for (const neutral of [false, true]) {
      const { dt, inp, step, start } = rig("manual", "diesel");
      dt.setEnvironment({ gradePct: -8 });
      start();
      if (neutral) dt.shift(-1);
      inp.ignition = false;
      let vmax = 0;
      for (let i = 0; i < 20 * 60; i++) {
        step(0);
        vmax = Math.max(vmax, dt.state.speedKmh);
      }
      expect(vmax).toBe(0);
      expect(dt.state.parkingBrake).toBe(true);
    }
  });

  test("does not engage above 5 km/h, also when braking; engages after braking to a stop", () => {
    const { dt, step, start } = rig("manual");
    start();
    for (let i = 0; i < 4 * 60 && dt.state.speedKmh < 25; i++) step(0.6);
    expect(dt.state.speedKmh).toBeGreaterThan(AUTO_HOLD_MAX_KMH);
    expect(dt.state.parkingBrake).toBe(false);
    let heldAbove = false;
    for (let i = 0; i < 6 * 60; i++) {
      step(0, 0.3);
      if (dt.state.parkingBrake && dt.state.speedKmh > AUTO_HOLD_MAX_KMH + 0.5) heldAbove = true;
    }
    expect(heldAbove).toBe(false);
    expect(dt.state.speedKmh).toBe(0);
    expect(dt.state.parkingBrake).toBe(true);
  });

  test("automatic in D held: converter loaded against the brake, no creep, the engine does not stall", () => {
    const cfg = libraryConfig("lib-bmw-m57d30tu2");
    const { sim, dt, step, start } = rig("automatic", "diesel", cfg);
    start();
    expect(dt.gearLabel()).toBe("D1");
    for (let i = 0; i < 30 * 60; i++) step(0);
    expect(dt.state.parkingBrake).toBe(true);
    expect(dt.state.speedKmh).toBe(0);
    expect(sim.state.running).toBe(true);
    expect(sim.state.rpm).toBeGreaterThan(0.8 * cfg.idleRpm);
    expect(sim.state.torqueNm).toBeGreaterThan(20); // pump torque at stall
    // drive-away from the hold
    for (let i = 0; i < 3 * 60; i++) step(0.4);
    expect(dt.state.parkingBrake).toBe(false);
    expect(dt.state.speedKmh).toBeGreaterThan(5);
  });

  test("released by hand on −8 % in N the car rolls; a fresh brake press holds it again", () => {
    const { dt, step, start } = rig("manual");
    dt.setEnvironment({ gradePct: -8 });
    start();
    dt.shift(-1);
    for (let i = 0; i < 30; i++) step(0);
    expect(dt.toggleParkingBrake()).toBe(false);
    for (let i = 0; i < 60; i++) step(0);
    expect(dt.state.speedKmh).toBeGreaterThan(1);
    expect(dt.state.speedKmh).toBeLessThan(AUTO_HOLD_MAX_KMH);
    for (let i = 0; i < 2 * 60; i++) step(0, 1);
    expect(dt.state.parkingBrake).toBe(true);
    expect(dt.state.speedKmh).toBe(0);
  });

  test("Auto-Hold off: nothing engages by itself; the P button still holds", () => {
    const { dt, step, start } = rig("dsg");
    dt.setAutoHold(false);
    dt.setEnvironment({ gradePct: -5 });
    expect(dt.state.autoHold).toBe(false);
    start();
    expect(dt.state.parkingBrake).toBe(false);
    for (let i = 0; i < 3 * 60; i++) step(0);
    expect(dt.state.speedKmh).toBeGreaterThan(1);
    dt.setParkingBrake(true);
    for (let i = 0; i < 3 * 60; i++) step(0);
    expect(dt.state.speedKmh).toBe(0);
  });

  test("engine off, parking brake alone: beyond the holding limit (−40 %) the car slides, at −25 % it stays", () => {
    const run = (gradePct: number) => {
      const { sim, dt, step, start } = rig("manual");
      start();
      dt.shift(-1); // N: only the parking brake holds
      const inp = { ...defaultInputs(), ignition: false, dynoMode: "vehicle" as const };
      for (let i = 0; i < 3 * 60; i++) {
        const c = dt.inputs(H, sim.state, 0, 0);
        sim.step(H, { ...inp, vehicle: { ...c, gradePct } });
      }
      void step;
      return sim.state.vehicleSpeedMs ?? 0;
    };
    expect(run(-25)).toBe(0);
    expect(run(-40)).toBeGreaterThan(0.5);
  });

  test("gear plate: own ratios while held", () => {
    const { dt, step, start } = rig("manual");
    dt.setEnvironment({ gradePct: -6 });
    start();
    for (let i = 0; i < 60; i++) step(0);
    expect(dt.state.parkingBrake).toBe(true);
    expect(dt.ratiosEditable).toBe(true);
    expect(dt.setRatios(gradedRatios(3.6, 0.7, 7, 1.1))).toBeNull();
  });

  test("library car on hills: no rolling at standstill (Arthur's report)", () => {
    const r = cruiseRig("car-vw-golf6-tdi");
    const d = steepestDown("hills");
    r.dt.setEnvironment({ terrain: "hills" });
    r.dt.setPosition(d.pos);
    for (let i = 0; i < 10 * 60; i++) r.step(0);
    expect(r.dt.state.speedKmh).toBe(0);
  });
});
