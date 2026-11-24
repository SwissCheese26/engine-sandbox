// Issue #149: frictional slip heating of the tread (burnout, locked-wheel skid), grip window, wear and failure
// (src/core/tyre-heat.ts, docs/research/vehicle.md §12).
import { describe, expect, test } from "bun:test";
import { Drivetrain, drivenAxleLoadN, summarize, tyreTempFactor } from "../../src/core/index.ts";
import type { EngineState } from "../../src/core/index.ts";
import { TYRE_SLIP, burnoutRun } from "../../src/core/tyre-heat.ts";
import { TYRE_HOT_C } from "../../src/core/tyres.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { VEHICLE_LIBRARY, libraryCar } from "../../src/data/vehicle-library.ts";
import { driveCar } from "./vehicle-run.ts";

const H = 1 / 60;

function rig(id: string, damage?: "real" | "lenient" | "off") {
  const lc = libraryCar(id);
  const cfg = lc.engineId ? libraryConfig(lc.engineId) : defaultConfig("petrol");
  const dt = new Drivetrain(cfg, summarize(cfg));
  dt.applyCar(lc.setup);
  if (damage) dt.setDamageLevel(damage);
  return dt;
}

/**
 * Standing burnout as the simulator reports it (simulator.ts stepVehicle): car at rest, driven wheels spinning at
 * `wheelMs`, the tyres pass their sliding force 0.9·μ·N_driven. Returns the state after `seconds`.
 */
function burnout(dt: Drivetrain, seconds: number, wheelMs = 20) {
  const N = drivenAxleLoadN(dt.vehicle, 0);
  for (let i = 0; i < Math.round(seconds / H); i++) {
    const engine = { running: true, rpm: 6000, vehicleSpeedMs: 0, wheelSpeedMs: wheelMs, wheelSpin: true, wheelsLocked: false, tyreForceN: 0.9 * dt.state.grip * N } as unknown as EngineState;
    dt.inputs(H, engine, 1);
  }
  return dt.state;
}

/** Seconds of standing burnout until the tyre fails (Infinity after maxS). */
function burnoutToFailure(dt: Drivetrain, maxS = 180) {
  for (let t = 0; t < maxS; t += 1) {
    burnout(dt, 1);
    if (dt.state.tyreFailed) return t + 1;
  }
  return Infinity;
}

describe("slip heating (issue #149)", () => {
  test("5 s burnout of a high-power RWD car (Corvette C6): tread 100–200 °C, tyre field and lamp show it", () => {
    const dt = rig("car-chevrolet-corvette-c6");
    expect(dt.vehicle.driveLayout).toBe("rwd");
    const s = burnout(dt, 5);
    expect(s.tyreTempC).toBeGreaterThan(100);
    expect(s.tyreTempC).toBeLessThan(200);
    // the tyre field/gauge (tyreHotC) and the tyre lamp (tyreWarn) follow the tread
    expect(s.tyreHotC!).toBeGreaterThan(100);
    expect(s.tyreTreadHot).toBe(true);
    expect(s.tyreWarn).toBe(true);
    expect(s.tyreFailed).toBe(false);
  });

  test("the tread cools within seconds once the wheels grip again; the carcass stays warm longer", () => {
    const dt = rig("car-chevrolet-corvette-c6");
    const hot = burnout(dt, 10).tyreTempC;
    const carcass = dt.state.tyreCarcassC!;
    burnout(dt, 15, 0);
    expect(dt.state.tyreTempC).toBeLessThan(hot - 60);
    expect(dt.state.tyreCarcassC!).toBeGreaterThan(carcass - 10);
  });

  test("overheated tread loses grip; the burnout tyre grips less after 20 s than at 5 s", () => {
    for (const ty of ["standard", "uhp", "semi-slick", "slick"] as const) {
      expect(tyreTempFactor(ty, TYRE_HOT_C[ty] + 60)).toBeLessThan(0.8);
      expect(tyreTempFactor(ty, TYRE_HOT_C[ty])).toBe(1);
    }
    const dt = rig("car-chevrolet-corvette-c6", "off");
    const g5 = burnout(dt, 5).grip;
    const g20 = burnout(dt, 15).grip;
    expect(g20).toBeLessThan(0.92 * g5);
  });

  test("cold-tyre grip penalty; semi-slicks and slicks work at higher temperatures than street tyres", () => {
    expect(tyreTempFactor("semi-slick", 20)).toBeLessThan(0.9);
    expect(tyreTempFactor("slick", 20)).toBeLessThan(0.75);
    expect(tyreTempFactor("slick", 90)).toBe(1);
    expect(TYRE_HOT_C["semi-slick"]).toBeGreaterThan(TYRE_HOT_C.standard);
    expect(TYRE_HOT_C.slick).toBeGreaterThan(TYRE_HOT_C["semi-slick"]);
    // at 140 °C a slick is still in its window, a street tyre is overheated
    expect(tyreTempFactor("slick", 140)).toBeGreaterThan(tyreTempFactor("standard", 140));
  });

  test("realism: a long burnout destroys the tyre after tens of seconds (real); lenient: grip loss only; off: no wear", () => {
    const tReal = burnoutToFailure(rig("car-chevrolet-corvette-c6", "real"));
    expect(tReal).toBeGreaterThan(20);
    expect(tReal).toBeLessThan(120);
    const m3 = burnoutToFailure(rig("car-bmw-m3-e46", "real"));
    expect(m3).toBeGreaterThan(20);
    expect(m3).toBeLessThan(120);
    const len = rig("car-chevrolet-corvette-c6", "lenient");
    const g0 = len.state.grip;
    expect(burnoutToFailure(len, 150)).toBe(Infinity);
    expect(len.state.tyreWear!).toBeGreaterThan(0.9);
    expect(len.state.tyreVibration).toBe(true);
    expect(len.state.grip).toBeLessThan(0.8 * g0);
    const off = rig("car-chevrolet-corvette-c6", "off");
    expect(burnoutToFailure(off, 150)).toBe(Infinity);
    expect(off.state.tyreWear).toBe(0);
    // new tyres repair it
    const r = rig("car-bmw-m3-e46", "real");
    burnoutToFailure(r);
    r.repairTyres();
    expect(r.state.tyreFailed).toBe(false);
    expect(r.state.tyreWear).toBe(0);
    expect(r.state.tyreTempC).toBeLessThan(40);
  });

  test("every vehicle heats its driven tyres in a 5 s burnout (FWD, RWD, AWD, EV, motorcycle, truck, bus)", () => {
    const layouts = new Set<string>();
    for (const c of VEHICLE_LIBRARY) {
      const dt = rig(c.id);
      layouts.add(`${dt.vehicle.driveLayout}${c.engineId ? "" : "-ev"}`);
      const s = burnout(dt, 5, 15);
      expect({ id: c.id, rise: s.tyreTempC - 20 > 25 }).toEqual({ id: c.id, rise: true });
      expect(s.tyreHotC!).toBeGreaterThan(40);
    }
    expect(layouts.has("awd-ev") || layouts.has("rwd-ev")).toBe(true);
    expect(layouts.has("fwd")).toBe(true);
    expect(layouts.has("awd")).toBe(true);
  });

  test("locked-wheel skid from 100 km/h heats the tread (flat spot)", () => {
    const dt = rig("car-vw-golf7-gti");
    const t0 = dt.state.tyreTempC;
    let v = 100 / 3.6;
    while (v > 0) {
      const engine = { running: true, rpm: 800, vehicleSpeedMs: v, wheelSpeedMs: 0, wheelSpin: false, wheelsLocked: true, tyreForceN: 0 } as unknown as EngineState;
      dt.inputs(H, engine, 0, 1);
      v -= 0.9 * 9.81 * H;
    }
    expect(dt.state.tyreTempC - t0).toBeGreaterThan(40);
  });

  test("model: constant-power burnout per tyre (245/40 R18), tread °C and time to wear-through", () => {
    const r60 = burnoutRun(60e3, 5);
    expect(r60.treadC).toBeGreaterThan(100);
    expect(r60.treadC).toBeLessThan(200);
    expect(burnoutRun(60e3, 20).treadC).toBeGreaterThan(r60.treadC);
    expect(r60.failS).toBeGreaterThan(20);
    expect(burnoutRun(10e3, 5).failS).toBe(Infinity);
    expect(TYRE_SLIP.treadShare).toBeGreaterThanOrEqual(0.5);
    expect(TYRE_SLIP.treadShare).toBeLessThanOrEqual(0.7);
  });
});

describe("normal driving unchanged by the slip model (issue #149)", () => {
  test("factory launches: hardly any wear, no tread warning, tread stays in the grip window", () => {
    for (const id of ["car-vw-golf7-gti", "car-bmw-m3-e46", "car-chevrolet-corvette-c6", "car-ferrari-458"]) {
      const r = driveCar(libraryCar(id), 40);
      expect({ id, wear: r.dt.state.tyreWear! < 0.01 }).toEqual({ id, wear: true });
      expect(r.dt.state.tyreTreadHot).toBe(false);
      expect(r.dt.state.tyreTempC).toBeLessThan(TYRE_HOT_C[libraryCar(id).setup.tyre.type]);
    }
  });

  test("library 0–100 km/h and Vmax match origin/main (before #149) within 0.05 s / 1.5 km/h", () => {
    // reference: tests/core/vehicle-run.ts driveCar(car, 70) on main at ef0c1a5
    const ref: Record<string, [number, number]> = {
      "car-vw-golf7-gti": [5.87, 251.0], "car-bmw-m3-e46": [5.67, 251.1], "car-bmw-m3-e92": [5.2, 250.6],
      "car-chevrolet-corvette-c6": [5.17, 313.8], "car-ferrari-458": [4.03, 337.0], "car-bmw-530d-e60": [6.8, 242.3],
      "car-honda-integra-dc5": [6.72, 253.6], "moto-honda-cbr1000rr-sc59": [3.5, 151.8],
    };
    for (const [id, [t100, vmax]] of Object.entries(ref)) {
      const r = driveCar(libraryCar(id), 70);
      expect({ id, t100: Math.abs(r.t100! - t100) <= 0.05 }).toEqual({ id, t100: true });
      expect({ id, vmax: Math.abs(r.vmax - vmax) <= 1.5 }).toEqual({ id, vmax: true });
    }
  });
});
