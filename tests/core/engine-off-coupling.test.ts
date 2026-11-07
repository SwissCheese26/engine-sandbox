// Engine off with a gear engaged (Arthur's report: the car rolled downhill in 1st with the engine dead at 0 rpm).
// Manual: the clutch stays engaged, the rolling car drags the engine (engine braking), parked in gear it holds.
import { expect, test } from "bun:test";
import { cruiseRig } from "./cruise-rig.ts";

const settle = (r: ReturnType<typeof cruiseRig>, s: number, pedal = 0, brake = 0) => {
  for (let i = 0; i < s * 60; i++) r.step(pedal, brake);
};

test("ignition off in gear on the flat: the dragged engine brakes the car and turns with the wheels", () => {
  const r = cruiseRig("car-vw-golf6-tdi");
  r.accelerateTo(60, 0.7, 2600, 3);
  r.inp.ignition = false;
  settle(r, 5);
  const v5 = r.dt.state.speedKmh;
  expect(r.sim.state.running).toBe(false);
  expect(r.sim.state.rpm).toBeGreaterThan(1000); // turned by the wheels, not 0
  expect(v5).toBeLessThan(55);
  // neutral for comparison: rolls on much further without engine braking
  const n = cruiseRig("car-vw-golf6-tdi");
  n.accelerateTo(60, 0.7, 2600, 3);
  n.inp.ignition = false;
  for (let k = 0; k < 8; k++) n.dt.shift(-1); // down to N (pending gear counts down)
  settle(n, 5);
  expect(n.dt.state.speedKmh).toBeGreaterThan(v5 + 3);
});

test("parked in 1st with the engine off on a 15 % slope: the car does not roll away", () => {
  const r = cruiseRig("car-vw-golf6-tdi");
  r.dt.setEnvironment({ gradePct: -15 });
  r.inp.ignition = false;
  settle(r, 2, 0, 1);
  settle(r, 20);
  expect(r.dt.state.gear).toBe(1);
  expect(r.dt.state.speedKmh).toBeLessThan(1);
});

test("in neutral the same car rolls down the slope (gravity, no engine braking)", () => {
  const r = cruiseRig("car-vw-golf6-tdi");
  r.dt.setEnvironment({ gradePct: -15 });
  r.inp.ignition = false;
  for (let k = 0; k < 8; k++) r.dt.shift(-1);
  settle(r, 2, 0, 1);
  settle(r, 10);
  expect(r.dt.state.speedKmh).toBeGreaterThan(30);
});

test("the engine still starts with 1st engaged (clutch held down while cranking)", () => {
  const r = cruiseRig("car-vw-golf6-tdi"); // the rig cranks with gear 1 engaged
  expect(r.dt.state.gear).toBe(1);
  expect(r.sim.state.running).toBe(true);
  expect(r.dt.state.speedKmh).toBeLessThan(1);
});

test("automatic gearboxes: no oil pressure without a running engine, the clutches stay open", () => {
  const r = cruiseRig("car-vw-golf7-gti"); // DSG
  r.accelerateTo(60);
  r.inp.ignition = false;
  settle(r, 2);
  expect(r.dt.state.clutch).toBe(0);
});
