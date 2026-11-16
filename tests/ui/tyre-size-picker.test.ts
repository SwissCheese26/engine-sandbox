// Tyre size from lists (no free text): value lists per vehicle class, library coverage, hints, migration of old saves.
import { describe, expect, test } from "bun:test";
import { VEHICLES, formatTyreSize, parseTyreSize, tyreRadii } from "../../src/core/index.ts";
import type { VehicleKind } from "../../src/core/index.ts";
import { VEHICLE_LIBRARY } from "../../src/data/vehicle-library.ts";
import { CUSTOM_LIMITS, OWN_VEHICLE_KEY, defaultCustom, loadOwnVehicle, parseOwnVehicle, validateCustom } from "../../src/ui/sandbox-setup.ts";
import {
  TYRE_SIZES, isListed, migrateTyreSize, offeredSizes, sizeFromRadius, snapTyreSize, tyreClassOf, tyreHint, tyreReadout,
} from "../../src/ui/tyre-size-picker.ts";

const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
const S = (w: number, a: number, r: number) => ({ widthMm: w, aspectPct: a, rimInch: r });

describe("value lists (ETRTO steps)", () => {
  test("car: width 135–335 in 10 mm steps ending in 5, aspect 25–80 in 5 % steps, rim 13–22, every combination", () => {
    const c = TYRE_SIZES.car;
    const w = uniq(c.map((s) => s.widthMm));
    expect(w[0]).toBe(135);
    expect(w.at(-1)).toBe(335);
    expect(w.length).toBe(21);
    expect(w.every((x) => x % 10 === 5)).toBe(true);
    expect(uniq(c.map((s) => s.aspectPct))).toEqual([25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]);
    expect(uniq(c.map((s) => s.rimInch))).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    expect(c.length).toBe(21 * 12 * 10);
  });

  test("motorcycle: real rear sizes only (the core drives the rear wheel), no front sizes", () => {
    for (const s of [S(180, 55, 17), S(190, 50, 17), S(190, 55, 17), S(200, 55, 17), S(180, 65, 16), S(240, 40, 18)]) {
      expect(isListed("bike", s)).toBe(true);
    }
    for (const s of [S(120, 70, 17), S(120, 60, 17), S(120, 70, 19), S(130, 60, 21)]) expect(isListed("bike", s)).toBe(false);
    expect(validateCustom({ ...defaultCustom("bike"), tyre: "120/70 R17" }).ok).toBe(false);
    expect(uniq(TYRE_SIZES.bike.map((s) => s.rimInch))).toEqual([16, 17, 18]);
    // no car grid on a bike
    expect(isListed("bike", S(225, 45, 17))).toBe(false);
  });

  test("truck/bus: R22.5 sizes, half-inch rims", () => {
    for (const s of [S(275, 70, 22.5), S(295, 80, 22.5), S(315, 70, 22.5), S(315, 80, 22.5)]) expect(isListed("truck", s)).toBe(true);
    expect(TYRE_SIZES.truck.every((s) => s.rimInch === 22.5)).toBe(true);
  });

  test("every offered size passes the core's own check (385/65 R22.5 is above the core's 355 mm and not offered)", () => {
    for (const list of Object.values(TYRE_SIZES)) {
      for (const s of list) expect(parseTyreSize(formatTyreSize(s))).toEqual(s);
    }
    expect(isListed("truck", S(385, 65, 22.5))).toBe(false);
  });

  test("vehicle kind → class", () => {
    const cases: [VehicleKind, string][] = [["car", "car"], ["superbike", "bike"], ["tourer", "bike"], ["truck", "truck"], ["bus", "truck"]];
    for (const [k, c] of cases) expect(tyreClassOf(k)).toBe(c as never);
  });
});

describe("library coverage", () => {
  test("every tyre size of the vehicle library and the drivetrain presets is selectable for its class", () => {
    const missing: string[] = [];
    for (const car of VEHICLE_LIBRARY) {
      const cls = tyreClassOf(car.setup.kind);
      if (!isListed(cls, car.setup.tyre.size)) missing.push(`${car.id}: ${formatTyreSize(car.setup.tyre.size)} (${cls})`);
    }
    for (const [kind, p] of Object.entries(VEHICLES)) {
      const cls = tyreClassOf(kind as VehicleKind);
      if (!isListed(cls, p.tyre.size)) missing.push(`preset ${kind}: ${formatTyreSize(p.tyre.size)}`);
    }
    expect(missing).toEqual([]);
  });

  test("library car sizes get no 'unusual' hint", () => {
    for (const car of VEHICLE_LIBRARY.filter((c) => tyreClassOf(c.setup.kind) === "car")) expect(tyreHint("car", car.setup.tyre.size)).toBe("");
  });
});

describe("readout and hints", () => {
  test("readout: size, outer diameter, rolling circumference", () => {
    const s = S(225, 45, 17);
    const circ = (2 * Math.PI * tyreRadii(s).dynamicM).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(tyreReadout(s)).toBe(`225/45 R17 · Ø 634 mm · Abrollumfang ${circ} m`);
  });

  test("unrealistic combinations get a gentle hint, but stay offered", () => {
    expect(isListed("car", S(335, 25, 13))).toBe(true);
    expect(tyreHint("car", S(335, 25, 13))).toMatch(/Ungewöhnliche Kombination.*zu breit.*sehr flach/);
    expect(tyreHint("car", S(135, 80, 22))).toMatch(/zu schmal|hohe Flanke/);
    expect(tyreHint("car", S(205, 55, 16))).toBe("");
    expect(tyreHint("bike", S(190, 55, 17))).toBe("");
  });
});

describe("snap and migration of old saves", () => {
  test("off-grid size snaps to the nearest listed size of the class", () => {
    expect(snapTyreSize("car", S(230, 45, 17))).toEqual(S(225, 45, 17));
    expect(snapTyreSize("car", S(225, 45, 23))).toEqual(S(225, 45, 22));
    expect(snapTyreSize("truck", S(385, 65, 22.5)).rimInch).toBe(22.5);
    expect(snapTyreSize("bike", S(190, 60, 17))).toEqual(S(190, 55, 17));
  });

  test("radius → nearest size", () => {
    const r = tyreRadii(S(205, 55, 16)).dynamicM;
    expect(Math.abs(tyreRadii(sizeFromRadius("car", r)).dynamicM - r)).toBeLessThan(0.002);
    expect(isListed("truck", sizeFromRadius("truck", 0.48))).toBe(true);
  });

  test("text, object, radius in m or mm", () => {
    expect(migrateTyreSize("car", "225/45ZR17")).toEqual(S(225, 45, 17));
    expect(migrateTyreSize("car", "225/45-17")).toEqual(S(225, 45, 17));
    expect(migrateTyreSize("car", "225 45 17")).toEqual(S(225, 45, 17));
    expect(migrateTyreSize("truck", "315/70 R22,5")).toEqual(S(315, 70, 22.5));
    expect(migrateTyreSize("car", S(205, 55, 16))).toEqual(S(205, 55, 16));
    expect(isListed("car", migrateTyreSize("car", 0.31)!)).toBe(true);
    expect(migrateTyreSize("car", 310)).toEqual(migrateTyreSize("car", 0.31));
    expect(migrateTyreSize("car", "groß")).toBeNull();
    expect(migrateTyreSize("car", undefined)).toBeNull();
  });

  test("a stored own vehicle with free text, an off-grid size or only a radius still loads", () => {
    const base = { ...defaultCustom("car") };
    const load = (custom: Record<string, unknown>) => {
      const mem = new Map<string, string>([[OWN_VEHICLE_KEY, JSON.stringify({ custom, active: true })]]);
      return loadOwnVehicle({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
    };
    expect(load({ ...base, tyre: "205/55r16" })?.custom.tyre).toBe("205/55 R16");
    expect(load({ ...base, tyre: "230/45 R17" })?.custom.tyre).toBe("225/45 R17");
    const { tyre: _t, ...noTyre } = base;
    const r = load({ ...noTyre, radiusM: 0.3 });
    expect(r).not.toBeNull();
    expect(isListed("car", parseTyreSize(r!.custom.tyre)!)).toBe(true);
    expect(Math.abs(tyreRadii(parseTyreSize(load({ ...base, tyre: 0.3 })!.custom.tyre)!).dynamicM - 0.3)).toBeLessThan(0.003);
    expect(parseOwnVehicle({ custom: { ...base, tyre: "groß" }, active: true })).toBeNull();
  });

  test("every size the wizard offers (within the base type's radius limit) passes validateCustom", () => {
    for (const base of ["car", "truck", "bike"] as const) {
      const sizes = offeredSizes(base, CUSTOM_LIMITS[base].radiusM);
      expect(sizes.length).toBeGreaterThan(0);
      const bad = sizes.filter((s) => !validateCustom({ ...defaultCustom(base), tyre: formatTyreSize(s) }).ok).map(formatTyreSize);
      expect(bad).toEqual([]);
      // the radius filter really removes something on the car grid (e.g. 135/25 R13)
      if (base === "car") expect(sizes.length).toBeLessThan(TYRE_SIZES.car.length);
    }
  });

  test("a stored front size on a motorcycle snaps to a rear size", () => {
    expect(isListed("bike", migrateTyreSize("bike", "120/70 ZR17")!)).toBe(true);
  });

  test("the form accepts only listed sizes of the base type", () => {
    expect(validateCustom({ ...defaultCustom("car"), tyre: "230/45 R17" }).ok).toBe(false);
    expect(validateCustom({ ...defaultCustom("truck"), tyre: "315/80 R22.5" }).ok).toBe(true);
    expect(validateCustom({ ...defaultCustom("bike"), tyre: "180/65 R16" }).ok).toBe(true);
  });
});
