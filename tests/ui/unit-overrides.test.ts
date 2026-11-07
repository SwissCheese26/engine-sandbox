// Issue #24 review: overrides equal to the global unit are not stored; old #21 overrides are dropped once.
import { afterAll, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, PRESETS, SETTINGS_KEY, UNIT_OVERRIDES_KEY, getSettings, resetSettingsCache, setSettings } from "../../src/ui/settings.ts";
import { UNITS, overrideCount, saveUnit, savedUnit } from "../../src/ui/units.ts";

const mem = new Map<string, string>();
const g = globalThis as { localStorage?: unknown };
const before = g.localStorage;
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};

beforeEach(() => {
  mem.clear();
  resetSettingsCache();
});
afterAll(() => {
  g.localStorage = before;
  resetSettingsCache();
});

test("first load with settings drops the old per-instrument choices once", () => {
  mem.set(UNIT_OVERRIDES_KEY, JSON.stringify({ power: 1, torque: 2 }));
  expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  expect(mem.has(UNIT_OVERRIDES_KEY)).toBe(false);
  expect(mem.has(SETTINGS_KEY)).toBe(true);
  // later overrides survive the next load
  saveUnit("power", UNITS.power, 2);
  resetSettingsCache();
  getSettings();
  expect(overrideCount()).toBe(1);
});

test("a choice equal to the global unit is no override", () => {
  getSettings();
  saveUnit("power", UNITS.power, 1); // PS while global is kW: override
  expect(savedUnit("power", UNITS.power)).toBe(1);
  saveUnit("power", UNITS.power, 0); // back to kW = global: removed
  expect(overrideCount()).toBe(0);
  setSettings({ preset: "metric-ps", custom: PRESETS["metric-ps"].units });
  expect(savedUnit("power", UNITS.power)).toBe(1); // follows the global PS
  saveUnit("power", UNITS.power, 1);
  expect(overrideCount()).toBe(0);
});
