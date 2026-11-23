// Issue #144: tyre heat, damage and blowout above the speed index (src/core/tyre-heat.ts, vehicle.md §11).
import { describe, expect, test } from "bun:test";
import { SPEED_INDEX, TYRE_HEAT, timeToTyreFailure, tyreDamageRate, tyreHeatTarget } from "../../src/core/index.ts";
import { EV_LIBRARY } from "../../src/data/ev-library.ts";
import { VEHICLE_LIBRARY, libraryCar } from "../../src/data/vehicle-library.ts";
import { driveCar } from "./vehicle-run.ts";

describe("tyre heat model", () => {
  test("ECE R30 speed symbols", () => {
    expect([SPEED_INDEX.Q, SPEED_INDEX.R, SPEED_INDEX.S, SPEED_INDEX.T, SPEED_INDEX.H, SPEED_INDEX.V, SPEED_INDEX.W, SPEED_INDEX.Y]).toEqual([160, 170, 180, 190, 210, 240, 270, 300]);
    expect(SPEED_INDEX["(Y)"]).toBeGreaterThan(300);
  });

  test("no warning and no damage at or below the index, even on a hot day and overloaded by 10 %", () => {
    for (const rated of [160, 210, 240, 270, 300]) {
      for (const r of [0.5, 0.8, 1]) {
        expect(tyreHeatTarget(r * rated, rated, 35, 1.1)).toBeLessThan(TYRE_HEAT.limitC);
        expect(tyreHeatTarget(r * rated, rated, 20)).toBeLessThan(TYRE_HEAT.warnC);
      }
    }
    expect(timeToTyreFailure(1)).toBe(Infinity);
    expect(tyreDamageRate(TYRE_HEAT.limitC)).toBe(0);
  });

  test("warning shortly above the index", () => {
    expect(tyreHeatTarget(1.06 * 270, 270, 20)).toBeGreaterThan(TYRE_HEAT.warnC);
  });

  test("time to failure: minutes at +10 %, under 2 min at +25 %, seconds at +50 %, falling with overspeed", () => {
    const t = [1.1, 1.15, 1.2, 1.25, 1.5].map((r) => timeToTyreFailure(r));
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeLessThan(t[i - 1]!);
    expect(t[0]!).toBeGreaterThan(180);
    expect(t[0]!).toBeLessThan(1200);
    expect(t[2]!).toBeGreaterThan(60);
    expect(t[3]!).toBeLessThan(120);
    expect(t[4]!).toBeLessThan(40);
    // more load fails sooner
    expect(timeToTyreFailure(1.1, 270, 20, 1.1)).toBeLessThan(t[0]!);
  });
});

describe("library: speed index at or above the factory Vmax", () => {
  for (const car of [...VEHICLE_LIBRARY, ...EV_LIBRARY]) {
    test(car.name, () => {
      expect(SPEED_INDEX[car.setup.tyre.speedIndex]).toBeGreaterThanOrEqual(car.factory.vmaxKmh);
    });
  }
});

describe("tyres in the drivetrain (Golf GTI on a Q tyre, 160 km/h)", () => {
  const golf = libraryCar("car-vw-golf7-gti");
  const onQ = { ...golf, setup: { ...golf.setup, tyre: { ...golf.setup.tyre, speedIndex: "Q" as const } } };

  test("factory tyre: no warning, no damage at Vmax", () => {
    const r = driveCar(golf, 90);
    expect(r.dt.state.tyreWarn).toBe(false);
    expect(r.dt.state.tyreDamage).toBe(0);
    expect(r.dt.state.tyreFailed).toBe(false);
  });

  test("real: blowout, Vmax collapses; repair resets", () => {
    const ref = driveCar(golf, 90).vmax;
    const r = driveCar(onQ, 180);
    expect(r.dt.state.tyreFailed).toBe(true);
    expect(r.dt.state.speedKmh).toBeLessThan(0.8 * ref);
    r.dt.repairTyres();
    expect(r.dt.state.tyreFailed).toBe(false);
    expect(r.dt.state.tyreDamage).toBe(0);
  });

  test("lenient: warning and grip loss, no blowout; off: no damage", () => {
    const l = driveCar(onQ, 180, 3, 0.5, 10, 1, 0.1, "lenient");
    expect(l.dt.state.tyreFailed).toBe(false);
    expect(l.dt.state.tyreWarn).toBe(true);
    expect(l.dt.state.tyreVibration).toBe(true);
    const o = driveCar(onQ, 180, 3, 0.5, 10, 1, 0.1, "off");
    expect(o.dt.state.tyreFailed).toBe(false);
    expect(o.dt.state.tyreDamage).toBe(0);
  });
});
