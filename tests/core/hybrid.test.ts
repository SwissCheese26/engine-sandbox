import { describe, expect, test } from "bun:test";
import { ENGINE_MIN_ON_S, hybridModes } from "../../src/core/index.ts";
import { HYBRID_LIBRARY } from "../../src/data/hybrid-library.ts";
import { factoryDrive, mildHybridDrive, rangeExtenderDrive, withDrive } from "../../src/data/drive-swap.ts";
import { libraryCar, type LibraryCar } from "../../src/data/vehicle-library.ts";
import { hybridRig } from "./hybrid-run.ts";

/** Operating strategy (issue #157, docs/research/hybrid.md §3) on the Prius (power-split) and the 330e (P2). */
const prius = HYBRID_LIBRARY.find((c) => c.id === "hy-toyota-prius-4")!;
const bmw = HYBRID_LIBRARY.find((c) => c.id === "hy-bmw-330e-g20")!;
const run = (r: ReturnType<typeof hybridRig>, s: number, pedal: number, brake = 0) => {
  let st = r.sim.state;
  for (let i = 0; i < s * 60; i++) st = r.step(pedal, brake);
  return st;
};
const to = (r: ReturnType<typeof hybridRig>, kmh: number) => {
  for (let i = 0; i < 6000 && r.dt.state.speedKmh < kmh; i++) r.step(0.5);
};

describe("hybrid strategy", () => {
  for (const car of [prius, bmw]) {
    test(`${car.name}: electric launch, engine off, no fuel`, () => {
      const r = hybridRig(car);
      run(r, 1, 0, 1);
      const s = run(r, 4, 0.4);
      expect(r.dt.state.speedKmh).toBeGreaterThan(10);
      expect(s.hybrid!.engineOn).toBe(false);
      expect(s.hybrid!.evDrive).toBe(true);
      expect(r.fuel()).toBe(0);
      expect(s.ev!.powerKw).toBeGreaterThan(1);
    });

    test(`${car.name}: full throttle starts the engine after a short start delay, the motor boosts`, () => {
      const r = hybridRig(car);
      run(r, 1, 0, 1);
      let started = -1;
      let cranking = false;
      for (let i = 0; i < 120; i++) {
        const s = r.step(1);
        if (s.hybrid!.engineStarting) cranking = true;
        if (s.hybrid!.engineOn && started < 0) started = i / 60;
      }
      expect(cranking).toBe(true);
      expect(started).toBeGreaterThan(0.01);
      expect(started).toBeLessThan(1.2);
      const s = run(r, 1, 1);
      expect(s.hybrid!.engineKw).toBeGreaterThan(30);
      expect(s.ev!.motorKw).toBeGreaterThan(5);
    });
  }

  test("regen first: braking from 60 km/h charges the battery, friction brake only for the rest", () => {
    const r = hybridRig(prius);
    to(r, 60);
    const soc0 = r.sim.battery.soc;
    const s = run(r, 1.5, 0, 0.2);
    expect(s.ev!.regenKw).toBeGreaterThan(5);
    expect(s.ev!.powerKw).toBeLessThan(-5);
    expect(r.sim.battery.soc).toBeGreaterThan(soc0);
    expect(s.hybrid!.engineCoupled).toBe(false);
  });

  test("SoC window: below the window the engine charges even at standstill; at the top no more charge", () => {
    const hy = prius.setup.hybrid!;
    const low = hybridRig(prius, "hybrid", hy.socMin - 0.05);
    const s = run(low, 6, 0, 1);
    expect(s.hybrid!.engineOn).toBe(true);
    expect(low.sim.battery.soc).toBeGreaterThan(hy.socMin - 0.05);
    const full = hybridRig(prius, "hybrid", hy.socMax + 0.03);
    to(full, 60);
    for (let i = 0; i < 300; i++) {
      full.step(0, 0.2);
      expect(full.sim.battery.soc).toBeLessThan(hy.socMax + 0.035);
    }
  });

  test("EV mode: electric up to its speed limit, then the engine joins; a plug-in sustains at the bottom", () => {
    const r = hybridRig(bmw, "ev");
    to(r, 100);
    expect(r.sim.state.hybrid!.engineOn).toBe(false);
    const low = hybridRig(bmw, "ev", bmw.setup.hybrid!.socMin - 0.02);
    to(low, 50);
    run(low, 3, 0.3);
    expect(low.sim.state.hybrid!.engineOn).toBe(true);
  });

  test("Charge mode charges while driving, Sport keeps the engine running", () => {
    const c = hybridRig(bmw, "charge", 0.3);
    to(c, 80);
    run(c, 20, 0.35);
    expect(c.sim.battery.soc).toBeGreaterThan(0.3);
    const sp = hybridRig(bmw, "sport");
    run(sp, 3, 0.15);
    expect(sp.sim.state.hybrid!.engineOn).toBe(true);
  });

  test(`minimum on-time ${ENGINE_MIN_ON_S} s against start/stop hunting`, () => {
    const r = hybridRig(prius);
    run(r, 0.5, 0, 1);
    run(r, 1.2, 1);
    expect(r.sim.state.hybrid!.engineOn).toBe(true);
    run(r, 0.8, 0.2);
    expect(r.sim.state.hybrid!.engineOn).toBe(true);
  });
});

describe("hybrid kits: 48 V mild hybrid and range extender", () => {
  const golf = libraryCar("car-vw-golf7-gti");
  const kit = (f: typeof mildHybridDrive): LibraryCar => ({ ...golf, setup: withDrive(golf, f(factoryDrive(golf))!) });

  test("mild: start-stop at standstill, no electric driving, belt boost under load", () => {
    const car = kit(mildHybridDrive);
    expect(hybridModes(car.setup.hybrid!)).toEqual(["hybrid", "sport"]);
    const r = hybridRig(car);
    let s = run(r, 1, 0.5);
    expect(s.hybrid!.engineOn).toBe(true);
    s = run(r, 3, 1);
    expect(s.ev!.motorKw).toBeGreaterThan(5);
    s = run(r, 15, 0, 0.6);
    expect(r.dt.state.speedKmh).toBeLessThan(0.5);
    s = run(r, 1, 0, 0.6);
    expect(s.hybrid!.engineOn).toBe(false);
    expect(s.fuelFlowLh).toBe(0);
  });

  test("range extender: drives electrically, the engine only charges and never drives the wheels", () => {
    const car = kit(rangeExtenderDrive);
    const r = hybridRig(car, "hybrid", car.setup.hybrid!.socMin - 0.02);
    to(r, 60);
    const s = run(r, 10, 0.4);
    expect(s.hybrid!.engineOn).toBe(true);
    expect(s.hybrid!.engineToWheelKw).toBe(0);
    expect(s.hybrid!.engineKw).toBeGreaterThan(10);
    expect(r.sim.battery.soc).toBeGreaterThan(car.setup.hybrid!.socMin - 0.02);
  });
});
