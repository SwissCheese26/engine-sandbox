import { describe, expect, test } from "bun:test";
import { GEARBOXES } from "../../src/core/index.ts";
import { ENGINE_LIBRARY } from "../../src/data/engine-library.ts";
import { VEHICLE_LIBRARY, libraryCar } from "../../src/data/vehicle-library.ts";
import { driveCar } from "./vehicle-run.ts";

/**
 * Ready-made cars (issue #22): simulated 0–100 km/h and Vmax against the factory data, ±12 %.
 *
 * Test driver: vehicle-run.ts (full throttle, shifts at the limiter, traction-control stand-in on ≈ 10 % slip).
 * Known 0–100 outliers are deviations outside the engine, each pinned to its own narrow band around the measured
 * value (so a model change shows up), not a widened tolerance (review PR #37). Issue #38 fixed the engines (R34 is
 * back in the band); the remaining two are traction-limited – +9 % LS3 power (289 → 316 kW) gains only 2 %, +6 % F136
 * power 4.03 → 4.02 s, but +15 % tyre grip gains ≈ 10 %:
 *  - Corvette C6: RWD launch at μ 1.15 (wheel spin when the clutch locks, then the test driver's TC cuts to 50 %).
 *  - Ferrari 458: the factory 3.4 s needs launch control and ≈ 1.3 μ on warm Pilot Sport tyres – physical limit
 *    with μ 1.15 (42 % front) ≈ 3.7 s.
 */
const TOL = 0.12;
const KNOWN_0_100_OUTLIERS: Record<string, { expected: number; band: number; reason: string }> = {
  "car-chevrolet-corvette-c6": { expected: 0.175, band: 0.06, reason: "RWD traction at launch (engine at rated power since #38)" },
  "car-ferrari-458": { expected: 0.19, band: 0.06, reason: "traction / factory with launch control (engine −7 %, not the cause, #38)" },
};

describe("vehicle library: data", () => {
  test("at least 10 of the cars within ±12 % by construction of the outlier list", () => {
    const cars = VEHICLE_LIBRARY.filter((c) => (c.setup.kind ?? "car") === "car");
    expect(cars.length - Object.keys(KNOWN_0_100_OUTLIERS).length).toBeGreaterThanOrEqual(10);
  });

  test("at least 13 cars with unique ids, engines from the engine library, sources", () => {
    expect(VEHICLE_LIBRARY.filter((c) => (c.setup.kind ?? "car") === "car").length).toBeGreaterThanOrEqual(13);
    expect(new Set(VEHICLE_LIBRARY.map((c) => c.id)).size).toBe(VEHICLE_LIBRARY.length);
    for (const c of VEHICLE_LIBRARY) {
      expect(ENGINE_LIBRARY.some((e) => e.config.id === c.engineId)).toBe(true);
      expect(c.source.length).toBeGreaterThan(10);
      const g = c.setup.gearboxSpec ?? GEARBOXES[c.setup.gearbox];
      // ratios strictly falling, plausible final drive
      for (let i = 1; i < g.ratios.length; i++) expect(g.ratios[i]!).toBeLessThan(g.ratios[i - 1]!);
      expect(g.finalDrive).toBeGreaterThan(2);
      expect(g.finalDrive).toBeLessThan(6);
      expect(c.setup.vehicle.driveLayout).toBeDefined();
    }
  });

  test("required layouts and tyres (issue #22)", () => {
    expect(libraryCar("car-nissan-skyline-r34").setup.vehicle.driveLayout).toBe("awd");
    expect(libraryCar("car-subaru-impreza-sti").setup.vehicle.driveLayout).toBe("awd");
    expect(libraryCar("car-honda-integra-dc5").setup.vehicle.driveLayout).toBe("fwd");
    expect(libraryCar("car-bmw-530d-e60").setup.vehicle.driveLayout).toBe("rwd");
    const lc = libraryCar("car-toyota-land-cruiser-120");
    expect(lc.setup.tyre.type).toBe("offroad");
    expect(lc.setup.vehicle.driveLayout).toBe("awd");
    expect(libraryCar("car-vw-golf7-gti").setup.speedLimitKmh).toBe(250);
    expect(libraryCar("car-vw-golf6-tdi").setup.gearbox).toBe("manual");
  });

  test("libraryCar returns a copy", () => {
    const a = libraryCar("car-vw-golf7-gti");
    a.setup.vehicle.massKg = 1;
    expect(libraryCar("car-vw-golf7-gti").setup.vehicle.massKg).toBe(1382);
  });
});

describe("vehicle library: simulated 0–100 and Vmax vs. factory (±12 %)", () => {
  // cars only: the motorcycles have their own rider/launch model and test (motorcycle.test.ts)
  for (const car of VEHICLE_LIBRARY.filter((c) => (c.setup.kind ?? "car") === "car")) {
    test(car.name, () => {
      const r = driveCar(car, 90);
      expect(r.running).toBe(true);
      expect(r.t100).not.toBeNull();
      const dt100 = r.t100! / car.factory.t0to100S! - 1;
      const dv = r.vmax / car.factory.vmaxKmh - 1;
      expect(Math.abs(dv)).toBeLessThan(TOL);
      const out = KNOWN_0_100_OUTLIERS[car.id];
      if (out) {
        expect(Math.abs(dt100 - out.expected)).toBeLessThan(out.band);
      } else {
        expect(Math.abs(dt100)).toBeLessThan(TOL);
      }
    }, 30000);
  }
});
