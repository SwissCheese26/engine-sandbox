// Two-speed reduction and Vmax limiter of electric cars (#108, Arthur): a Taycan-like 2-speed (≈ 15:1 / 8:1) launches
// harder and reaches a higher Vmax than a single-speed; raising the limiter raises Vmax up to the rotor speed limit.
import { describe, expect, test } from "bun:test";
import { evRpmVmaxKmh } from "../../src/core/index.ts";
import { evTuningOf, tuneEv, type EvTuning } from "../../src/data/ev-tuning.ts";
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
