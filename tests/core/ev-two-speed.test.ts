// Two-speed reduction and Vmax limiter of electric cars (#108, Arthur): a Taycan-like 2-speed (≈ 15:1 / 8:1) launches
// harder and reaches a higher Vmax than a single-speed; raising the limiter raises Vmax up to the rotor speed limit.
import { describe, expect, test } from "bun:test";
import { evRpmVmaxKmh, motorLossKw } from "../../src/core/index.ts";
import { evTopSpeed, evTuningOf, tuneEv, type EvTuning } from "../../src/data/ev-tuning.ts";
import { libraryCar, type LibraryCar } from "../../src/data/vehicle-library.ts";
import { driveEv } from "./ev-run.ts";

/** The library car rebuilt with a tuning (motors, reduction, limiter). */
function tuned(car: LibraryCar, change: Partial<EvTuning>): LibraryCar {
  const f = evTuningOf(car.setup.ev!, car.setup.tyre.type, car.setup.speedLimitKmh);
  const t = tuneEv(car.setup.ev!, { ...f, ...change }, car.setup.vehicle.wheelRadiusM);
  return { ...car, setup: { ...car.setup, ev: t.ev, speedLimitKmh: t.governorKmh, vehicle: { ...car.setup.vehicle, massKg: car.setup.vehicle.massKg + t.deltaKg } } };
}

describe("two-speed reduction (Taycan-like)", () => {
  const id3 = libraryCar("ev-vw-id3-pro-performance");
  const one = tuned(id3, { gears: 1, firstRatio: 11.5, vmaxKmh: null });
  const two = tuned(id3, { gears: 2, firstRatio: 15, secondRatio: 8, shiftKmh: 120, vmaxKmh: null });

  test("the rotor speed limit follows the top gear", () => {
    const r = id3.setup.vehicle.wheelRadiusM;
    expect(evRpmVmaxKmh(two.setup.ev!, r)).toBeGreaterThan(evRpmVmaxKmh(one.setup.ev!, r) * 1.3);
  });

  test("better acceleration and a higher Vmax than the single-speed", () => {
    const a = driveEv(one, 90);
    const b = driveEv(two, 90);
    expect(b.t100).not.toBeNull();
    expect(b.t100!).toBeLessThan(a.t100!);
    expect(b.vmax).toBeGreaterThan(a.vmax + 5);
    // it shifted (second gear at the end) and the shift took a short torque gap, not a stall
    expect(b.sim.state.ev!.gear).toBe(2);
    expect(b.dt.state.gearCount).toBe(2);
  });
});

describe("Vmax limiter (electric)", () => {
  const plaid = libraryCar("ev-tesla-model-s-plaid");
  test("raising the limiter raises Vmax up to the rotor speed limit", () => {
    const rpmLimit = evRpmVmaxKmh(plaid.setup.ev!, plaid.setup.vehicle.wheelRadiusM);
    const at250 = driveEv(tuned(plaid, { vmaxKmh: 250 }), 60);
    expect(at250.vmax).toBeLessThan(256);
    const off = tuned(plaid, { vmaxKmh: 450 });
    expect(off.setup.speedLimitKmh).toBeNull();
    const r = driveEv(off, 90);
    expect(r.vmax).toBeGreaterThan(at250.vmax + 30);
    expect(r.vmax).toBeLessThanOrEqual(rpmLimit + 2);
  });

  test("a limiter above the rotor speed limit is off: the motor speed limits", () => {
    const t = tuneEv(plaid.setup.ev!, { ...evTuningOf(plaid.setup.ev!, "uhp", 300), firstRatio: 12, vmaxKmh: 400 }, plaid.setup.vehicle.wheelRadiusM);
    expect(t.rpmVmaxKmh).toBeLessThan(400);
    expect(t.governorKmh).toBeNull();
    expect(t.vmaxBy).toBe("rpm");
    const r = driveEv(tuned(plaid, { firstRatio: 12, vmaxKmh: 400 }), 60);
    expect(r.sim.state.ev!.limitedBy).toBe("speed");
    expect(r.vmax).toBeLessThanOrEqual(t.rpmVmaxKmh + 2);
  });
});

describe("max. motor speed (#139)", () => {
  const plaid = libraryCar("ev-tesla-model-s-plaid");
  const id3 = libraryCar("ev-vw-id3-pro-performance");
  const factory = (car: LibraryCar) => evTuningOf(car.setup.ev!, car.setup.tyre.type, car.setup.speedLimitKmh);
  const top = (car: LibraryCar, change: Partial<EvTuning>) => evTopSpeed(car.setup, tuneEv(car.setup.ev!, { ...factory(car), ...change }, car.setup.vehicle.wheelRadiusM));

  test("factory values are unchanged", () => {
    expect(factory(plaid).maxRpm).toBe(20000);
    const t = tuneEv(plaid.setup.ev!, factory(plaid), plaid.setup.vehicle.wheelRadiusM);
    expect(t.ev.motors.map((m) => m.maxRpm)).toEqual(plaid.setup.ev!.motors.map((m) => m.maxRpm));
    expect(t.ev.motors.every((m) => m.lossRefRpm === undefined)).toBe(true);
    expect(t.sleeveKg).toBe(0);
    expect(t.deltaKg).toBeCloseTo(0, 6);
  });

  test("a faster rotor costs mass and keeps its factory loss map (losses rise above it)", () => {
    const t = tuneEv(plaid.setup.ev!, { ...factory(plaid), maxRpm: 25000 }, plaid.setup.vehicle.wheelRadiusM);
    const m = t.ev.motors[0]!;
    const m0 = { ...plaid.setup.ev!.motors[0]!, inverterA: m.inverterA, peakTorqueNm: m.peakTorqueNm, peakPowerKw: m.peakPowerKw };
    expect(m.maxRpm).toBe(25000);
    expect(t.sleeveKg).toBeCloseTo(3 * 0.8 * 5, 6);
    expect(motorLossKw(m, 20000, 100)).toBeCloseTo(motorLossKw(m0, 20000, 100), 9);
    expect(motorLossKw(m, 24000, 100)).toBeGreaterThan(motorLossKw(m, 20000, 100) * 1.3);
  });

  test("limiter off, higher rpm: Vmax rises until drag meets the drive power", () => {
    const f = top(id3, { vmaxKmh: null });
    const r20 = top(id3, { vmaxKmh: null, maxRpm: 20000 });
    const r22 = top(id3, { vmaxKmh: null, maxRpm: 22000 });
    const r25 = top(id3, { vmaxKmh: null, maxRpm: 25000 });
    expect(f.by).toBe("rpm");
    expect(r20.kmh).toBeGreaterThan(f.kmh + 30);
    expect(r22.by).toBe("drag");
    expect(r25.by).toBe("drag");
    expect(Math.abs(r25.kmh - r22.kmh)).toBeLessThan(1);
    // the simulator agrees: no speed limit at the end, the motors are out of torque against the drag
    const run = driveEv(tuned(id3, { vmaxKmh: null, maxRpm: 25000 }), 120);
    expect(Math.abs(run.vmax - r25.kmh)).toBeLessThan(5);
    expect(run.sim.state.ev!.limitedBy).not.toBe("speed");
  });

  test("Plaid: 25 000 1/min lifts Vmax far above the factory rotor limit", () => {
    const f = top(plaid, { vmaxKmh: null });
    const fast = top(plaid, { vmaxKmh: null, maxRpm: 25000 });
    expect(f.kmh).toBeGreaterThan(320);
    expect(fast.kmh).toBeGreaterThan(f.kmh + 60);
    expect(top(plaid, { vmaxKmh: 300, maxRpm: 25000 })).toEqual({ kmh: 300, by: "governor" });
    const run = driveEv(tuned(plaid, { vmaxKmh: null, maxRpm: 25000 }), 150);
    expect(Math.abs(run.vmax - fast.kmh)).toBeLessThan(6);
  });
});
