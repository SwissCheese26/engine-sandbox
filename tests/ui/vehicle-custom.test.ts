// Per-vehicle customisations ("Dubletten" / settings count once per car): src/ui/vehicle-custom.ts.
import { describe, expect, test } from "bun:test";
import { AFTERMARKET_OIL_COOLER_WK, Drivetrain, gradedRatios, summarize } from "../../src/core/index.ts";
import type { CarSetup } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { VEHICLE_LIBRARY } from "../../src/data/vehicle-library.ts";
import { OWN_VEHICLE_KEY, customSetup, defaultCustom } from "../../src/ui/sandbox-setup.ts";
import {
  CUSTOM_KEY, LEGACY_LIMIT_KEY, LEGACY_RATIOS_KEY, TANK_KEY, captureCustom, clearCustom, loadAll, loadCustom, loadVehicle,
  migrateLegacy, oilCoolerChoices, parseCustom, saveCustom, setOilCooler, setupSig, vehicleKey, type Store,
} from "../../src/ui/vehicle-custom.ts";

function memStore(init: Record<string, string> = {}): Store & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

const cars = VEHICLE_LIBRARY.filter((c) => (c.setup.kind ?? "car") === "car" && c.setup.gearbox !== "cvt");
const A = cars[0]!;
const B = cars.find((c) => c.id !== A.id)!;

function rig() {
  const cfg = defaultConfig();
  return new Drivetrain(cfg, summarize(cfg), "manual");
}
/** What the vehicle panel does on "Laden": factory state of the library car, then its own stored changes. */
const loadLib = (d: Drivetrain, car: typeof A, st: Store) => loadVehicle(d, () => d.applyCar(structuredClone(car.setup)), vehicleKey(car.id, car.setup.kind ?? "car"), undefined, st);
const factoryRatios = (d: Drivetrain, car: typeof A) => {
  d.applyCar(structuredClone(car.setup));
  return [...d.gearbox.ratios];
};

describe("own changes stay with their vehicle", () => {
  test("car A with 9 own gears → car B shows its factory gears → back to A: the 9 gears again", () => {
    const st = memStore();
    const d = rig();
    const bFactory = factoryRatios(rig(), B);
    loadLib(d, A, st);
    const r = d.gearbox.ratios;
    const nine = gradedRatios(r[0]!, r[r.length - 1]!, 9, 1);
    expect(d.setRatios(nine)).toBeNull();
    saveCustom(A.id, captureCustom(d), st);

    expect(loadLib(d, B, st).custom).toBe(false);
    expect(d.gearbox.ratios).toEqual(bFactory);
    expect(d.state.gearCount).toBe(bFactory.length);

    expect(loadLib(d, A, st).custom).toBe(true);
    expect(d.gearbox.ratios).toEqual(nine);
    expect(d.state.gearCount).toBe(9);
    // nothing global left behind
    expect(st.data.has(LEGACY_RATIOS_KEY)).toBe(false);
  });

  test("tyres, drive layout, final drive, tank size and governor count per vehicle too", () => {
    const st = memStore();
    const d = rig();
    loadLib(d, A, st);
    d.setTyre({ ...d.tyre, type: "winter", size: { widthMm: 205, aspectPct: 55, rimInch: 16 } });
    d.setVehicleParams({ driveLayout: "awd", dragCoefficient: 0.4 });
    d.setFinalDrive(4.2);
    d.tank.setCapacity(80);
    d.setSpeedLimit(null);
    saveCustom(A.id, captureCustom(d), st);
    loadLib(d, B, st);
    const b = rig();
    b.applyCar(structuredClone(B.setup));
    expect(d.tyre).toEqual(b.tyre);
    expect(d.vehicle.driveLayout).toBe(b.vehicle.driveLayout);
    expect(d.state.finalDrive).toBe(b.state.finalDrive);
    expect(d.tank.capacityL).toBe(b.tank.capacityL);
    expect(d.state.speedLimitKmh).toBe(B.setup.speedLimitKmh);
    loadLib(d, A, st);
    expect(d.tyre.size.widthMm).toBe(205);
    expect(d.vehicle.driveLayout).toBe("awd");
    expect(d.vehicle.dragCoefficient).toBe(0.4);
    expect(d.state.finalDrive).toBe(4.2);
    expect(d.tank.capacityL).toBe(80);
    expect(d.state.speedLimitKmh).toBeNull();
  });

  test("Auf Werkszustand zurücksetzen: the vehicle's changes are forgotten, other vehicles keep theirs", () => {
    const st = memStore();
    const d = rig();
    saveCustom(A.id, { kind: "car", finalDrive: 4.4 }, st);
    saveCustom(B.id, { kind: "car", finalDrive: 2.9 }, st);
    clearCustom(A.id, st);
    expect(loadLib(d, A, st).custom).toBe(false);
    expect(d.gearbox.ratios).toEqual(factoryRatios(rig(), A));
    expect(loadLib(d, B, st).custom).toBe(true);
    expect(d.state.finalDrive).toBe(2.9);
    clearCustom(B.id, st);
    expect(st.data.has(CUSTOM_KEY)).toBe(false);
  });

  test("own vehicle: under its own key, only for the setup it was built from", () => {
    const st = memStore();
    const own: CarSetup = structuredClone(A.setup);
    const other: CarSetup = { ...structuredClone(A.setup), tankL: 33 };
    expect(vehicleKey("", "car")).toBe("own:car");
    expect(setupSig(own)).not.toBe(setupSig(other));
    saveCustom("own:car", { kind: "car", sig: setupSig(own), finalDrive: 4.1 }, st);
    expect(loadCustom("own:car", setupSig(own), st)?.finalDrive).toBe(4.1);
    expect(loadCustom("own:car", setupSig(other), st)).toBeNull();
    // the library car A is a different vehicle
    expect(loadCustom(A.id, undefined, st)).toBeNull();
  });

  test("corrupt entry: out-of-range tyre, body, governor and ratios are dropped, valid parts stay", () => {
    const st = memStore({
      [CUSTOM_KEY]: JSON.stringify({
        [A.id]: {
          kind: "car",
          tyre: { type: "rocket", speedIndex: "W", size: { widthMm: 225, aspectPct: 45, rimInch: 17 } },
          body: { massKg: -5, dragCoefficient: 9, frontalAreaM2: 2.1, wheelbaseM: Number.MAX_VALUE, driveLayout: "6x6" },
          speedLimitKmh: 999,
          ratios: { type: "manual", ratios: [3.5, 2, 1.3, 1, 1e9] },
          finalDrive: 40,
          tankL: 0,
          oilCooler: "zubehoer",
        },
        broken: { kind: "spaceship", finalDrive: 3.5 },
        badTyre: { kind: "car", tyre: { type: "winter", speedIndex: "Z9", size: { widthMm: 5000, aspectPct: 45, rimInch: 17 } } },
      }),
    });
    const all = loadAll(st);
    expect(all[A.id]).toEqual({ kind: "car", body: { frontalAreaM2: 2.1 }, oilCooler: "zubehoer" });
    expect(all.broken).toBeUndefined();
    expect(all.badTyre).toEqual({ kind: "car" });
    // loading the car with the corrupt entry: factory values everywhere except the valid parts
    const d = rig();
    const f = rig();
    f.applyCar(structuredClone(A.setup));
    expect(loadLib(d, A, st).custom).toBe(true);
    expect(d.vehicle.massKg).toBe(f.vehicle.massKg);
    expect(d.state.speedLimitKmh).toBe(f.state.speedLimitKmh);
    expect(d.gearbox.ratios).toEqual(f.gearbox.ratios);
    expect(d.tyre).toEqual(f.tyre);
    expect(d.vehicle.frontalAreaM2).toBe(2.1);
  });

  test("stored data is shape-checked: broken entries and parts are dropped", () => {
    expect(parseCustom(null)).toBeNull();
    expect(parseCustom({ kind: 3 })).toBeNull();
    const c = parseCustom({ kind: "car", gearbox: "warp", ratios: { type: "manual", ratios: [3, "x"] }, finalDrive: "4", tankL: 50, oilCooler: "nitro" })!;
    expect(c).toEqual({ kind: "car", tankL: 50 });
    expect(loadAll(memStore({ [CUSTOM_KEY]: "{broken" }))).toEqual({});
    expect(loadAll(memStore({ [CUSTOM_KEY]: JSON.stringify({ a: { kind: "car" }, b: 7 }) }))).toEqual({ a: { kind: "car" } });
  });
});

describe("migration of the old global keys", () => {
  test("global ratios and governor go to the vehicle that was active (tank record), then the old keys are gone", () => {
    const st = memStore({
      [LEGACY_RATIOS_KEY]: JSON.stringify({ kind: "car", type: "manual", ratios: [3.6, 2.1, 1.4, 1.1, 0.9, 0.75, 0.62, 0.52, 0.45] }),
      [LEGACY_LIMIT_KEY]: "off",
      [TANK_KEY]: JSON.stringify({ capacityL: 50, levelL: 20, vehicle: A.id, kind: "car" }),
    });
    migrateLegacy(st);
    expect(st.data.has(LEGACY_RATIOS_KEY)).toBe(false);
    expect(st.data.has(LEGACY_LIMIT_KEY)).toBe(false);
    const c = loadAll(st)[A.id]!;
    expect(c.ratios?.ratios).toHaveLength(9);
    expect(c.gearbox).toBe("manual");
    expect(c.speedLimitKmh).toBeNull();
    // and it loads on that car only
    const d = rig();
    loadLib(d, A, st);
    expect(d.state.type).toBe("manual");
    expect(d.state.gearCount).toBe(9);
    loadLib(d, B, st);
    expect(d.state.gearCount).toBe(factoryRatios(rig(), B).length);
  });

  test("own vehicle active: attached to that own vehicle only (its signature), not to every own vehicle of the kind", () => {
    const legacy = JSON.stringify({ kind: "car", type: "manual", ratios: [3.5, 2, 1.3, 1, 0.8] });
    const tank = JSON.stringify({ capacityL: 50, levelL: 50, vehicle: "", kind: "car" });
    // no wizard vehicle stored: the Fahrzeugtyp preset "Auto" was active
    const preset = memStore({ [LEGACY_RATIOS_KEY]: legacy, [TANK_KEY]: tank });
    expect(loadCustom("own:car", "preset:car", preset)?.ratios?.ratios).toHaveLength(5);
    expect(loadCustom("own:car", "some-other-own-car", preset)).toBeNull();
    // the wizard-built own vehicle was the last setup: the ratios go to exactly that one
    const own = defaultCustom("car");
    const wizard = memStore({ [LEGACY_RATIOS_KEY]: legacy, [TANK_KEY]: tank, [OWN_VEHICLE_KEY]: JSON.stringify({ custom: own, active: true }) });
    const sig = setupSig(customSetup(own));
    expect(loadCustom("own:car", sig, wizard)?.ratios?.ratios).toHaveLength(5);
    expect(loadCustom("own:car", "preset:car", wizard)).toBeNull();
  });

  test("unknown active vehicle (no tank record) or another kind: dropped", () => {
    const none = memStore({ [LEGACY_RATIOS_KEY]: JSON.stringify({ kind: "car", type: "manual", ratios: [3.5, 2, 1.3, 1, 0.8] }) });
    migrateLegacy(none);
    expect(none.data.has(LEGACY_RATIOS_KEY)).toBe(false);
    expect(none.data.has(CUSTOM_KEY)).toBe(false);
    const other = memStore({
      [LEGACY_RATIOS_KEY]: JSON.stringify({ kind: "car", type: "manual", ratios: [3.5, 2, 1.3, 1, 0.8] }),
      [TANK_KEY]: JSON.stringify({ capacityL: 18, levelL: 9, vehicle: "", kind: "superbike" }),
    });
    migrateLegacy(other);
    expect(loadAll(other)).toEqual({});
    // broken old data is dropped too
    const broken = memStore({ [LEGACY_RATIOS_KEY]: "{", [TANK_KEY]: JSON.stringify({ vehicle: A.id, kind: "car" }) });
    migrateLegacy(broken);
    expect(broken.data.has(LEGACY_RATIOS_KEY)).toBe(false);
    expect(loadAll(broken)).toEqual({});
  });
});

describe("gearbox oil cooler choice (per vehicle)", () => {
  test("Serie / Ölkühler (Zubehör) / Aus only where the factory has one; stored and restored with the car", () => {
    const st = memStore();
    const d = rig();
    d.setType("manual");
    expect(oilCoolerChoices(d)).toEqual(["serie", "zubehoer"]);
    d.setType("dsg");
    expect(oilCoolerChoices(d)).toEqual(["serie", "zubehoer", "aus"]);
    loadLib(d, A, st);
    setOilCooler(d, "zubehoer");
    expect(d.gearboxAuxCoolerWK).toBe(AFTERMARKET_OIL_COOLER_WK);
    saveCustom(A.id, captureCustom(d), st);
    loadLib(d, B, st);
    expect(d.gearboxAuxCoolerWK).toBe(0);
    expect(d.gearboxCooler).toBe(true);
    loadLib(d, A, st);
    expect(d.gearboxAuxCoolerWK).toBe(AFTERMARKET_OIL_COOLER_WK);
    // "Aus" on a box without a factory cooler falls back to "Serie"
    d.setType("manual");
    setOilCooler(d, "aus");
    expect(d.gearboxCooler).toBe(true);
    expect(d.gearboxAuxCoolerWK).toBe(0);
  });
});
