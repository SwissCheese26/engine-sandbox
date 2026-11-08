import { describe, expect, test } from "bun:test";
import { GEARBOXES } from "../../src/core/index.ts";
import { ENGINE_LIBRARY } from "../../src/data/engine-library.ts";
import { VEHICLE_LIBRARY, libraryCar } from "../../src/data/vehicle-library.ts";
import { driveCar } from "./vehicle-run.ts";

/**
 * Ready-made cars (issue #22): simulated 0–100 km/h and Vmax against the factory data, ±12 %.
 *
 * Test driver: vehicle-run.ts (full throttle, shifts at the limiter, traction-control stand-in on ≈ 10 % slip).
 * Known 0–100 outliers are engine/data deviations, each pinned to its own narrow band around the measured value
 * (so a model change shows up), not a widened tolerance (review PR #37):
 *  - R34: RB26DETT model 178 instead of 206 kW, power peak at 4600 instead of 6800 rpm (engine library #15).
 *  - Corvette C6: LS3 model 289 instead of 321 kW (−10 %), torque peak ≈ 750 rpm too early, so 1st gear runs out of
 *    power above ≈ 70 km/h; plus RWD traction at μ 1.15.
 *  - Ferrari 458: F136 model 391 instead of 419 kW (−7 %); the factory 3.4 s needs launch control and ≈ 1.3 μ on
 *    warm Pilot Sport tyres – physical limit with μ 1.15 (42 % front) ≈ 3.7 s.
 */
const TOL = 0.12;
const KNOWN_0_100_OUTLIERS: Record<string, { expected: number; band: number; reason: string }> = {
  "car-nissan-skyline-r34": { expected: 0.46, band: 0.08, reason: "RB26 model −14 % power, peak 2200 rpm too low" },
  "car-chevrolet-corvette-c6": { expected: 0.22, band: 0.06, reason: "LS3 model −10 % power + RWD traction" },
  "car-ferrari-458": { expected: 0.19, band: 0.06, reason: "F136 model −7 %, factory with launch control" },
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
      const dt100 = r.t100! / car.factory.t0to100S - 1;
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
