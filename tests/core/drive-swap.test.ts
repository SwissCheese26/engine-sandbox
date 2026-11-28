import { describe, expect, test } from "bun:test";
import { evRpmVmaxKmh } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { bodyMassKg, driveMassKg, engineDrive, factoryDrive, withDrive } from "../../src/data/drive-swap.ts";
import { VEHICLE_LIBRARY, libraryCar } from "../../src/data/vehicle-library.ts";
import { driveCar } from "./vehicle-run.ts";
import { driveEv } from "./ev-run.ts";

// Free drive swap (issue #154): body = factory mass − factory drive; a new drive brings its own mass and gearing.
describe("drive swap: body / drive split", () => {
  test("every library vehicle: body + factory drive = factory mass, body a plausible share", () => {
    for (const c of VEHICLE_LIBRARY) {
      const body = bodyMassKg(c);
      expect(body + driveMassKg(factoryDrive(c))).toBeCloseTo(c.setup.vehicle.massKg, 6);
      // a body without drive keeps 40 … 92 % of the kerb mass (bikes: frame + rider; EVs: the pack is a big share)
      expect(body / c.setup.vehicle.massKg).toBeGreaterThan(0.4);
      expect(body / c.setup.vehicle.massKg).toBeLessThan(0.92);
    }
  });

  test("factory setups stay untouched (the swap builds a new setup)", () => {
    const ms = libraryCar("ev-tesla-model-s-lr");
    const before = JSON.stringify(ms.setup);
    withDrive(ms, engineDrive(libraryConfig("ref-gm-ls3-62")));
    expect(JSON.stringify(ms.setup)).toBe(before);
  });
});

describe("drive swap: drives", () => {
  test("Tesla Model S drive in the Citaro: lighter bus, motors on the rear axle, reduction for 100 km/h, drives", () => {
    const bus = libraryCar("bus-mercedes-citaro-o530");
    const s = withDrive(bus, factoryDrive(libraryCar("ev-tesla-model-s-lr")));
    expect(s.vehicle.massKg).toBeGreaterThan(10500);
    expect(s.vehicle.massKg).toBeLessThan(bus.setup.vehicle.massKg);
    // payload stays: gross − empty as at the factory
    expect(s.fullMassKg! - s.vehicle.massKg).toBeCloseTo(bus.setup.fullMassKg! - bus.setup.vehicle.massKg, 6);
    expect(s.ev!.motors.every((m) => m.axle === "rear" && m.ratio > 15 && m.ratio < 45)).toBe(true);
    expect(evRpmVmaxKmh(s.ev!, s.vehicle.wheelRadiusM)).toBeCloseTo(100, 0);
    const r = driveEv({ ...bus, setup: s }, 90, "sport");
    expect(r.vmax).toBeGreaterThan(95);
    expect(r.vmax).toBeLessThan(101);
  });

  test("LS3 V8 in a Model S: gearbox of the Corvette, final drive for the new wheel, ≈ 1.65 t, drives", () => {
    const ms = libraryCar("ev-tesla-model-s-lr");
    const s = withDrive(ms, engineDrive(libraryConfig("ref-gm-ls3-62")));
    expect(s.ev).toBeUndefined();
    expect(s.gearbox).toBe(libraryCar("car-chevrolet-corvette-c6").setup.gearbox);
    expect(s.tankL).toBe(libraryCar("car-chevrolet-corvette-c6").setup.tankL);
    expect(s.vehicle.massKg).toBeGreaterThan(1550);
    expect(s.vehicle.massKg).toBeLessThan(1800);
    expect(s.gearboxSpec!.finalDrive).toBeGreaterThan(2.5);
    expect(s.gearboxSpec!.finalDrive).toBeLessThan(8);
    const r = driveCar({ ...ms, engineId: "ref-gm-ls3-62", setup: s }, 90);
    expect(r.running).toBe(true);
    expect(r.t100!).toBeGreaterThan(3.5);
    expect(r.t100!).toBeLessThan(7);
    expect(r.vmax).toBeGreaterThan(220);
  });

  test("ID.3 drive on a superbike: rear motor, heavy bike, still drives", () => {
    const bike = libraryCar("moto-honda-cbr1000rr-sc59");
    const s = withDrive(bike, factoryDrive(libraryCar("ev-vw-id3-pro-performance")));
    expect(s.kind).toBe("superbike");
    expect(s.ev!.motors.every((m) => m.axle === "rear")).toBe(true);
    expect(s.vehicle.massKg).toBeGreaterThan(450);
    expect(s.vehicle.massKg).toBeLessThan(750);
    const r = driveEv({ ...bike, setup: s }, 90, "sport");
    expect(r.t100!).toBeGreaterThan(2.5);
    expect(r.t100!).toBeLessThan(8);
    expect(r.vmax).toBeGreaterThan(180);
  });
});
