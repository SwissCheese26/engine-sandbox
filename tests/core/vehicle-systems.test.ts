// Vehicle systems (#83, docs/research/commercial.md §5–8; vehicle.md §10): air brake, retarder, AdBlue, battery,
// curves and lean angle, and the charge-air temperature in the engine state (#105).
import { describe, expect, test } from "bun:test";
import {
  ADBLUE_LIMP_PEDAL, AIR_CUT_IN_BAR, AIR_CUT_OUT_BAR, AIR_SPRING_BAR, AIR_WARN_BAR, ALTERNATOR_V, AdBlueTank, AirBrake, BATTERY_REST_V, RETARDER_MAX_NM,
  VehicleSystems, batteryTargetV, curvatureAt, leanAngle, retarderForceN, retarderTorqueNm, terrainCurved, terrainLengthM, type SystemsInput,
} from "../../src/core/index.ts";
import { REFERENCE_ENGINES } from "../../src/data/reference-engines.ts";
import { runPhases, startEngine } from "./helpers.ts";

const dt = 1 / 60;

describe("air brake", () => {
  test("compressor fills 0 → cut-out in a few minutes at 1500 rpm (R13 Annex 7 order of magnitude)", () => {
    const a = new AirBrake();
    a.reset(0);
    let t = 0;
    while (a.pressureBar < AIR_CUT_OUT_BAR && t < 600) {
      a.step(dt, 1500, true, 0);
      t += dt;
    }
    expect(t).toBeGreaterThan(60);
    expect(t).toBeLessThan(360);
  });

  test("governor: idles at cut-out, delivers again only below cut-in", () => {
    const a = new AirBrake();
    a.step(dt, 1500, true, 0);
    expect(a.compressing).toBe(false);
    // two full applications: 10 → ≈ 9 bar, still above cut-in → no delivery
    for (const b of [1, 0, 1, 0]) for (let i = 0; i < 10; i++) a.step(dt, 0, false, b);
    expect(a.pressureBar).toBeGreaterThan(AIR_CUT_IN_BAR);
    const p = a.pressureBar;
    a.step(1, 1500, true, 0);
    expect(a.pressureBar).toBe(p);
    for (const b of [1, 0, 1, 0]) for (let i = 0; i < 10; i++) a.step(dt, 0, false, b);
    expect(a.pressureBar).toBeLessThan(AIR_CUT_IN_BAR);
    const q = a.pressureBar;
    a.step(1, 1500, true, 0);
    expect(a.pressureBar).toBeGreaterThan(q);
  });

  test("a full application draws ≈ 0.5 bar; 8 full applications leave > warning pressure (R13 Annex 7)", () => {
    const a = new AirBrake();
    for (let n = 0; n < 8; n++) {
      a.step(dt, 0, false, 1);
      a.step(dt, 0, false, 0);
    }
    expect(a.pressureBar).toBeGreaterThan(AIR_WARN_BAR);
    expect(a.pressureBar).toBeLessThan(7);
    // holding the brake does not draw more air
    const p = a.pressureBar;
    for (let i = 0; i < 60; i++) a.step(dt, 0, false, 1);
    expect(a.pressureBar).toBeCloseTo(p - 0, 0);
  });

  test("warning below 5.5 bar, spring brakes from 4.5 bar, service brake weaker without air", () => {
    const a = new AirBrake();
    a.reset(6);
    expect(a.warning).toBe(false);
    expect(a.serviceShare).toBeCloseTo(6 / 6.5, 5);
    a.reset(5);
    expect(a.warning).toBe(true);
    expect(a.springShare).toBe(0);
    a.reset(AIR_SPRING_BAR - 1);
    expect(a.springShare).toBeGreaterThan(0);
    expect(a.springShare).toBeLessThan(1);
    a.reset(0.5);
    expect(a.springShare).toBe(1);
    expect(a.serviceShare).toBeLessThan(0.1);
  });
});

describe("retarder", () => {
  test("stage 0 off; torque grows with n² and is capped by the stage and the power limit", () => {
    expect(retarderTorqueNm(0, 1500)).toBe(0);
    expect(retarderTorqueNm(5, 500) / retarderTorqueNm(5, 250)).toBeCloseTo(4, 5);
    expect(retarderTorqueNm(5, 1000)).toBeCloseTo(RETARDER_MAX_NM, 3);
    expect(retarderTorqueNm(2, 1000)).toBeCloseTo((RETARDER_MAX_NM * 2) / 5, 3);
    // power limit: 600 kW at 2500 rpm → 2292 Nm
    expect(retarderTorqueNm(5, 2500)).toBeCloseTo(600_000 / ((2500 * Math.PI) / 30), 0);
    expect(retarderTorqueNm(9, 1000)).toBe(retarderTorqueNm(5, 1000));
  });

  test("40 t truck at 80 km/h, stage 5: ≈ 0.04–0.08 g; nothing at walking pace", () => {
    const f = retarderForceN(5, 80 / 3.6, 2.533, 0.49);
    expect(f / (40000 * 9.81)).toBeGreaterThan(0.03);
    expect(f / (40000 * 9.81)).toBeLessThan(0.1);
    expect(retarderForceN(5, 1, 2.533, 0.49)).toBeLessThan(100);
  });
});

describe("AdBlue", () => {
  test("drains 5 % of the diesel flow once the exhaust is hot", () => {
    const t = new AdBlueTank();
    t.setCapacity(10);
    t.step(3600, 20, 150);
    expect(t.levelL).toBe(10);
    t.step(3600, 20, 350);
    expect(t.levelL).toBeCloseTo(9, 5);
    t.step(36000, 20, 350);
    expect(t.empty).toBe(true);
    t.refill();
    expect(t.levelL).toBe(10);
  });
});

describe("battery", () => {
  test("12.6 V off, ≈ 10.5 V cranking, 14.2 V running; 24 V on trucks", () => {
    expect(batteryTargetV({ running: false, starter: false, rpm: 0, ignition: true })).toBe(BATTERY_REST_V);
    expect(batteryTargetV({ running: false, starter: true, rpm: 200, ignition: true })).toBeLessThan(11);
    expect(batteryTargetV({ running: true, starter: false, rpm: 800, ignition: true })).toBe(ALTERNATOR_V);
    expect(batteryTargetV({ running: true, starter: false, rpm: 800, ignition: true }, 2)).toBeCloseTo(28.4, 5);
  });
});

const base = (o: Partial<SystemsInput> = {}): SystemsInput => ({
  ignition: true, running: true, starter: false, rpm: 1200, fuelFlowLh: 30, egtC: 400, scr: true, vehicle: true, kind: "truck",
  brake: 0, speedMs: 20, massKg: 40000, finalDrive: 2.533, wheelRadiusM: 0.49, ...o,
});

describe("VehicleSystems", () => {
  test("truck: retarder adds braking, spring brakes act on an empty reservoir", () => {
    const v = new VehicleSystems();
    expect(v.step(dt, base()).retarderG).toBe(0);
    v.setRetarderStage(3);
    expect(v.step(dt, base()).retarderG).toBeGreaterThan(0);
    v.air.reset(0.5);
    const o = v.step(dt, base({ running: false }));
    expect(o.brake).toBeCloseTo(0.18, 5);
  });

  test("car: no air brake or retarder; AdBlue empty → limp pedal; engine dyno: only the battery", () => {
    const v = new VehicleSystems();
    v.setRetarderStage(5);
    const car = base({ kind: "car" });
    expect(v.step(dt, car).retarderG).toBe(0);
    expect(v.step(dt, { ...car, brake: 1 }).brake).toBe(1);
    v.adblue.setCapacity(1, 0);
    expect(v.step(dt, car).pedalCap).toBe(ADBLUE_LIMP_PEDAL);
    expect(v.step(dt, { ...car, vehicle: false }).pedalCap).toBe(1);
    for (let i = 0; i < 120; i++) v.step(dt, car);
    expect(v.batteryV).toBeCloseTo(ALTERNATOR_V, 1);
  });
});

describe("curves and lean angle", () => {
  test("curved routes repeat seamlessly; static and ramps are straight", () => {
    for (const t of ["flat", "hills", "alps"] as const) {
      expect(terrainCurved(t)).toBe(true);
      expect(curvatureAt(t, terrainLengthM(t))).toBeCloseTo(curvatureAt(t, 0), 9);
    }
    expect(curvatureAt("static", 500)).toBe(0);
    expect(curvatureAt("uphill", 500)).toBe(0);
  });

  test("smallest radii: flat ≥ 500 m, hills ≥ 120 m, alps ≥ 50 m", () => {
    const minR = (t: "flat" | "hills" | "alps") => {
      let k = 0;
      for (let x = 0; x < terrainLengthM(t); x += 5) k = Math.max(k, Math.abs(curvatureAt(t, x)));
      return 1 / k;
    };
    expect(minR("flat")).toBeGreaterThan(500);
    expect(minR("hills")).toBeGreaterThan(120);
    expect(minR("alps")).toBeGreaterThan(50);
  });

  test("tan φ = v²/(R·g): 100 km/h on R 200 m ≈ 21°; beyond μ flagged", () => {
    const l = leanAngle(100 / 3.6, 1 / 200, 1.1);
    expect(l.deg).toBeCloseTo((Math.atan((100 / 3.6) ** 2 / 200 / 9.81) * 180) / Math.PI, 6);
    expect(l.deg).toBeGreaterThan(20);
    expect(l.deg).toBeLessThan(23);
    expect(l.limit).toBe(false);
    expect(leanAngle(30, -1 / 50, 1.1)).toEqual({ deg: expect.any(Number), limit: true });
    expect(leanAngle(30, -1 / 50).deg).toBeLessThan(0);
  });
});

describe("intake air temperature (#105)", () => {
  test("reported (manifoldTempK − 273.15): at or above the 20 °C ambient, at idle and at full load", () => {
    const cfg = REFERENCE_ENGINES.find((e) => e.config.induction.aspiration !== "naturally-aspirated")!.config;
    const sim = startEngine(cfg);
    const idle = sim.state.intakeAirC!;
    expect(Number.isFinite(idle)).toBe(true);
    expect(Math.abs(idle - 20)).toBeLessThan(25);
    const s = runPhases(sim, [{ seconds: 6, input: { ignition: true, pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: 3000 } }]);
    expect(s.intakeAirC!).toBeGreaterThanOrEqual(20);
    expect(s.intakeAirC!).toBeLessThan(120);
    expect(s.boostBar).toBeGreaterThan(0.3);
  });
});
