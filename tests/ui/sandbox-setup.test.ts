// Issue #93: guided start of the Sandbox – vehicle filter, own-vehicle validation, pending setup, setting.
import { describe, expect, test } from "bun:test";
import { VEHICLES, isCommercialKind, isMotorcycleKind, tyreRadii } from "../../src/core/index.ts";
import { ENGINE_LIBRARY } from "../../src/data/engine-library.ts";
import { VEHICLE_LIBRARY } from "../../src/data/vehicle-library.ts";
import {
  CUSTOM_LIMITS, buildSetup, customSetup, defaultCustom, enginesFor, gearboxesFor, setPendingSetup, takePendingSetup,
  validateCustom, vehicleFacts, vehiclesOf, type CustomBase,
} from "../../src/ui/sandbox-setup.ts";
import { DEFAULT_SETTINGS, validateSettings } from "../../src/ui/settings.ts";

describe("vehicle filter by kind", () => {
  test("every library vehicle is in exactly one group", () => {
    const all = [...vehiclesOf("car"), ...vehiclesOf("commercial"), ...vehiclesOf("bike")];
    expect(all.length).toBe(VEHICLE_LIBRARY.length);
    expect(new Set(all.map((c) => c.id)).size).toBe(VEHICLE_LIBRARY.length);
  });

  test("groups hold the right kinds", () => {
    expect(vehiclesOf("bike").length).toBeGreaterThan(0);
    for (const c of vehiclesOf("bike")) expect(isMotorcycleKind(c.setup.kind ?? "car")).toBe(true);
    expect(vehiclesOf("commercial").map((c) => c.setup.kind).sort()).toEqual(["bus", "truck"]);
    for (const c of vehiclesOf("car")) expect(c.setup.kind ?? "car").toBe("car");
    expect(vehiclesOf("car").some((c) => c.id === "car-vw-golf7-gti")).toBe(true);
  });

  test("facts: PS from the engine's rated power, published weight, gearbox, tank", () => {
    const golf = vehicleFacts(VEHICLE_LIBRARY.find((c) => c.id === "car-vw-golf7-gti")!);
    expect(golf.ps).toBe(220); // 162 kW
    expect(golf.kg).toBe(1382);
    expect(golf.drive).toBe("Frontantrieb");
    expect(golf.gearbox).toBe("Doppelkupplung, 6 Gänge");
    expect(golf.tankL).toBe(50);
    const truck = vehicleFacts(vehiclesOf("commercial").find((c) => c.setup.kind === "truck")!);
    expect(truck.gearbox).toContain("AMT");
    for (const c of VEHICLE_LIBRARY) {
      const f = vehicleFacts(c);
      expect(f.ps).toBeGreaterThan(40);
      expect(f.tankL).toBeGreaterThan(0);
    }
  });
});

describe("own vehicle", () => {
  const bases: CustomBase[] = ["car", "truck", "bike"];

  test("defaults are valid for every base type", () => {
    for (const b of bases) {
      const d = defaultCustom(b);
      const r = validateCustom(d);
      expect(r.ok).toBe(true);
      expect(enginesFor(b).some((e) => e.config.id === d.engineId)).toBe(true);
      expect(gearboxesFor(b)).toContain(d.gearbox);
    }
  });

  test("form strings with a German decimal comma are accepted", () => {
    const r = validateCustom({ ...defaultCustom("car"), massKg: "1350", cw: "0,29", areaM2: "2,1", tankL: "45", tyre: "205/55r16" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.cw).toBeCloseTo(0.29);
      expect(r.value.tyre).toBe("205/55 R16");
    }
  });

  test("bad values get a message per field", () => {
    const r = validateCustom({ base: "car", massKg: "abc", cw: "2", areaM2: "", tankL: "-5", tyre: "groß", drive: "xwd", gearbox: "sequential", engineId: "lib-mercedes-om471" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["areaM2", "cw", "drive", "engineId", "gearbox", "massKg", "tankL", "tyre"]);
      expect(r.errors.massKg).toContain("Zahl");
      expect(r.errors.cw).toContain("0,15 bis 0,9");
    }
  });

  test("ranges depend on the base type", () => {
    expect(validateCustom({ ...defaultCustom("car"), massKg: 20000 }).ok).toBe(false);
    expect(validateCustom({ ...defaultCustom("truck"), massKg: 20000 }).ok).toBe(true);
    expect(validateCustom({ ...defaultCustom("bike"), massKg: CUSTOM_LIMITS.bike.massKg.max + 1 }).ok).toBe(false);
    // a motorcycle drives the rear wheel only
    expect(validateCustom({ ...defaultCustom("bike"), drive: "fwd" }).ok).toBe(false);
  });

  test("customSetup carries the player's values", () => {
    const c = { ...defaultCustom("car"), massKg: 1300, cw: 0.27, areaM2: 2.05, tyre: "205/55 R16", drive: "rwd" as const, gearbox: "automatic" as const, tankL: 60 };
    const s = customSetup(c);
    expect(s.kind).toBe("car");
    expect(s.vehicle.massKg).toBe(1300);
    expect(s.vehicle.dragCoefficient).toBe(0.27);
    expect(s.vehicle.frontalAreaM2).toBe(2.05);
    expect(s.vehicle.driveLayout).toBe("rwd");
    expect(s.vehicle.wheelRadiusM).toBeCloseTo(tyreRadii({ widthMm: 205, aspectPct: 55, rimInch: 16 }).dynamicM, 6);
    expect(s.gearbox).toBe("automatic");
    expect(s.tankL).toBe(60);
    expect(s.fullMassKg).toBeUndefined();
    const truck = customSetup(defaultCustom("truck"));
    expect(isCommercialKind(truck.kind!)).toBe(true);
    expect(truck.speedLimitKmh).toBe(85);
    expect(truck.gearboxSpec!.ratios.length).toBe(VEHICLES.truck.gearboxSpec!.ratios.length);
    const bike = customSetup(defaultCustom("bike"));
    expect(bike.kind).toBe("superbike");
    expect(bike.gearbox).toBe("sequential");
    expect(bike.vehicle.driveLayout).toBe("rwd");
  });
});

describe("pending setup", () => {
  test("library vehicle brings its engine and the route", () => {
    const golf = VEHICLE_LIBRARY.find((c) => c.id === "car-vw-golf7-gti")!;
    expect(buildSetup("car", { vehicleId: golf.id, route: "alps" })).toEqual({ kind: "car", vehicleId: golf.id, engineId: golf.engineId, route: "alps" });
    // every library vehicle's engine is in the engine library
    for (const c of VEHICLE_LIBRARY) expect(ENGINE_LIBRARY.some((e) => e.config.id === c.engineId)).toBe(true);
  });

  test("a vehicle of another kind, a missing route or a missing vehicle give nothing", () => {
    expect(buildSetup("bike", { vehicleId: "car-vw-golf7-gti", route: "flat" })).toBeNull();
    expect(buildSetup("car", { vehicleId: "car-vw-golf7-gti" })).toBeNull();
    expect(buildSetup("custom", { route: "flat" })).toBeNull();
  });

  test("engine dyno: no vehicle, no route", () => {
    expect(buildSetup("engine", { route: "alps" })).toEqual({ kind: "engine", route: null });
  });

  test("own vehicle: engine from the form", () => {
    const c = defaultCustom("bike");
    expect(buildSetup("custom", { custom: c, route: "hills" })).toEqual({ kind: "custom", custom: c, engineId: c.engineId, route: "hills" });
  });

  test("taken once", () => {
    setPendingSetup({ kind: "engine", route: null });
    expect(takePendingSetup()).toEqual({ kind: "engine", route: null });
    expect(takePendingSetup()).toBeNull();
    setPendingSetup(null);
    expect(takePendingSetup()).toBeNull();
  });
});

test("setting \"Kurz erklärt\" (Nicht mehr anzeigen) is validated", () => {
  expect(DEFAULT_SETTINGS.sandboxIntro).toBe(true);
  expect(validateSettings({}).sandboxIntro).toBe(true);
  expect(validateSettings({ sandboxIntro: false }).sandboxIntro).toBe(false);
  for (const junk of ["no", 0, 1, null, {}]) expect(validateSettings({ sandboxIntro: junk }).sandboxIntro).toBe(true);
});
