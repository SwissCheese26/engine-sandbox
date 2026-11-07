// Issue #24: global unit choice – conversions, settings validation, instrument defaults.
import { beforeEach, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, PRESETS, QUANTITIES, resetSettingsCache, setSettings, unitsOf, validateSettings, prefs } from "../../src/ui/settings.ts";
import { CONV, UNITS, defaultUnitIndex, fmtQ, fromUnit, toUnit } from "../../src/ui/units.ts";

beforeEach(() => {
  resetSettingsCache();
});

test("conversions to display units", () => {
  expect(toUnit("speed", 100, "mph")).toBeCloseTo(62.1371, 4);
  expect(toUnit("distance", 1.609344, "mi")).toBeCloseTo(1, 5);
  expect(toUnit("fuel", 5, "mpg")).toBeCloseTo(47.043, 3); // 235,215 / 5
  expect(toUnit("fuel", 5, "km/l")).toBeCloseTo(20, 9);
  expect(Number.isNaN(toUnit("fuel", 0, "mpg"))).toBe(true);
  expect(Number.isNaN(toUnit("fuel", Number.NaN, "l/100 km"))).toBe(true);
  expect(toUnit("power", 100, "hp")).toBeCloseTo(134.102, 3);
  expect(toUnit("power", 100, "PS")).toBeCloseTo(135.962, 3);
  expect(toUnit("torque", 100, "lb·ft")).toBeCloseTo(73.7562, 4);
  expect(toUnit("pressure", 1, "psi")).toBeCloseTo(14.5038, 4);
  expect(toUnit("temp", 100, "°F")).toBeCloseTo(212, 9);
  expect(toUnit("temp", -40, "°F")).toBeCloseTo(-40, 9);
  expect(toUnit("length", 25.4, "in")).toBeCloseTo(1, 9);
  expect(toUnit("volume", 1.968, "cm³")).toBeCloseTo(1968, 6);
  expect(toUnit("volume", 5.7, "cui")).toBeCloseTo(347.8, 1); // the classic 350 cui V8 is 5,7 l
  expect(toUnit("speed", 100, "km/h")).toBe(100);
});

test("fromUnit inverts toUnit", () => {
  for (const [q, u] of [["speed", "mph"], ["temp", "°F"], ["power", "hp"], ["fuel", "mpg"], ["fuel", "km/l"], ["volume", "cui"]] as const) {
    expect(fromUnit(q, toUnit(q, 7.3, u), u)).toBeCloseTo(7.3, 9);
  }
});

test("mpg and l/100 km agree with the gauge conversion", () => {
  // 6 l/h at 100 km/h = 6 l/100 km = 39,2 mpg (US)
  const s = { vehicleSpeedMs: 100 / 3.6 } as never;
  const mpgGauge = UNITS.fuelFlow.find((u) => u.unit === "mpg")!.conv(6, s);
  expect(mpgGauge).toBeCloseTo(CONV.l100ToMpg / 6, 2);
  expect(UNITS.fuelFlow.find((u) => u.unit === "gal/h")!.conv(CONV.lPerGalUs)).toBeCloseTo(1, 9);
});

test("fmtQ formats in German with the unit", () => {
  expect(fmtQ("fuel", 6.54, undefined, "l/100 km")).toBe("6,5 l/100 km");
  expect(fmtQ("power", 110, undefined, "PS")).toBe("150 PS");
  expect(fmtQ("fuel", 0, undefined, "mpg")).toBe("– mpg");
});

test("validateSettings repairs broken or old data", () => {
  expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(validateSettings("x")).toEqual(DEFAULT_SETTINGS);
  expect(validateSettings({ preset: "lightyears" }).preset).toBe("metric-kw");
  expect(validateSettings({ preset: "imperial" }).preset).toBe("imperial");
  const v = validateSettings({ preset: "custom", custom: { power: "PS", speed: "furlong/fortnight", temp: 3 } });
  expect(v.preset).toBe("custom");
  expect(v.custom.power).toBe("PS");
  expect(v.custom.speed).toBe("km/h");
  expect(v.custom.temp).toBe("°C");
  // every quantity has a valid default
  for (const { q, units } of QUANTITIES) expect(units).toContain(v.custom[q]);
});

test("presets and custom units", () => {
  expect(unitsOf({ preset: "metric-ps", custom: DEFAULT_SETTINGS.custom }).power).toBe("PS");
  const imp = unitsOf({ preset: "imperial", custom: DEFAULT_SETTINGS.custom });
  expect([imp.power, imp.torque, imp.pressure, imp.temp, imp.fuel, imp.speed, imp.distance]).toEqual(["hp", "lb·ft", "psi", "°F", "mpg", "mph", "mi"]);
  // every preset unit is one of the offered choices
  for (const p of Object.values(PRESETS)) for (const { q, units } of QUANTITIES) expect(units).toContain(p.units[q]);
  expect(unitsOf({ preset: "custom", custom: { ...DEFAULT_SETTINGS.custom, speed: "mph" } }).speed).toBe("mph");
});

test("setSettings updates prefs() (no localStorage in tests: best effort)", () => {
  setSettings({ preset: "imperial", custom: DEFAULT_SETTINGS.custom });
  expect(prefs().speed).toBe("mph");
  setSettings(DEFAULT_SETTINGS);
  expect(prefs().speed).toBe("km/h");
});

test("instrument default follows the global choice", () => {
  const imp = PRESETS.imperial.units;
  const ps = PRESETS["metric-ps"].units;
  const kw = PRESETS["metric-kw"].units;
  expect(UNITS.power[defaultUnitIndex(UNITS.power, ps)]!.unit).toBe("PS");
  expect(UNITS.power[defaultUnitIndex(UNITS.power, imp)]!.unit).toBe("hp");
  expect(UNITS.torque[defaultUnitIndex(UNITS.torque, imp)]!.unit).toBe("lb·ft");
  expect(UNITS.temp[defaultUnitIndex(UNITS.temp, imp)]!.unit).toBe("°F");
  expect(UNITS.pressure(2)[defaultUnitIndex(UNITS.pressure(2), imp)]!.unit).toBe("psi");
  expect(UNITS.fuelFlow[defaultUnitIndex(UNITS.fuelFlow, imp)]!.unit).toBe("gal/h");
  expect(UNITS.fuelFlow[defaultUnitIndex(UNITS.fuelFlow, kw)]!.unit).toBe("l/h");
  expect(UNITS.bsfc[defaultUnitIndex(UNITS.bsfc, ps)]!.unit).toBe("g/PSh");
  expect(UNITS.power[defaultUnitIndex(UNITS.power, kw)]!.unit).toBe("kW");
});
