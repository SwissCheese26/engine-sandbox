// Fuel tank (Arthur's request): realistic tank volume per vehicle, drained by the fuel flow, empty → engine stalls.
import { expect, test } from "bun:test";
import { DEFAULT_TANK_L, FuelTank, RESERVE_SHARE } from "../../src/core/index.ts";
import { VEHICLE_LIBRARY } from "../../src/data/vehicle-library.ts";
import { cruiseRig } from "./cruise-rig.ts";

test("drains by the fuel flow, reserve and empty, refill, saved state is validated", () => {
  const t = new FuelTank(50);
  t.step(3600, 10); // dt > 1 s is ignored (a stalled tab)
  expect(t.levelL).toBe(50);
  for (let i = 0; i < 3600; i++) t.step(1, 10); // 1 h at 10 l/h
  expect(t.levelL).toBeCloseTo(40, 6);
  t.setLevel(50 * RESERVE_SHARE);
  expect(t.reserve).toBe(true);
  t.setLevel(-3);
  expect(t.empty).toBe(true);
  t.refill();
  expect(t.fraction).toBe(1);
  expect(FuelTank.fromJSON({ capacityL: 35, levelL: 12 })!.levelL).toBe(12);
  expect(FuelTank.fromJSON({ capacityL: "x" })).toBeNull();
  expect(FuelTank.fromJSON({ capacityL: 35, levelL: 99 })!.levelL).toBe(35);
});

test("every library vehicle has a plausible tank; loading a car fills its tank", () => {
  for (const c of VEHICLE_LIBRARY) {
    const kind = c.setup.kind ?? "car";
    expect(c.setup.tankL).toBeGreaterThan(kind === "car" ? 30 : 10);
    expect(c.setup.tankL).toBeLessThan(kind === "car" ? 100 : 30);
  }
  const r = cruiseRig("car-citroen-c1-10");
  expect(r.dt.tank.capacityL).toBe(35);
  expect(r.dt.tank.fraction).toBe(1);
  expect(DEFAULT_TANK_L.superbike).toBeLessThan(DEFAULT_TANK_L.car);
});

test("an empty tank starves the engine: it stalls and does not start again", () => {
  const r = cruiseRig("car-vw-golf6-tdi");
  expect(r.sim.state.running).toBe(true);
  // run the engine with an empty tank flag
  for (let i = 0; i < 180; i++) r.sim.step(1 / 60, { ...r.inp, fuelEmpty: true, vehicle: r.dt.inputs(1 / 60, r.sim.state, 0) });
  expect(r.sim.state.running).toBe(false);
  for (let i = 0; i < 180; i++) r.sim.step(1 / 60, { ...r.inp, starter: true, fuelEmpty: true, vehicle: r.dt.inputs(1 / 60, r.sim.state, 0) });
  expect(r.sim.state.running).toBe(false);
});
