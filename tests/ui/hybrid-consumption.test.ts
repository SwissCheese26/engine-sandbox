import { describe, expect, test } from "bun:test";
import { consumptionLine, driveConsumption, evField, fuelConsumptionText } from "../../src/ui/layouts/ev-logic.ts";
import type { UnitPrefs } from "../../src/ui/settings.ts";
import type { EngineState } from "../../src/core/index.ts";

// Hybrid consumption (#164): fuel in l/100 km first, a plug-in adds its kWh/100 km, an EV stays in kWh.

const U: UnitPrefs = { power: "kW", torque: "Nm", pressure: "bar", temp: "°C", fuel: "l/100 km", speed: "km/h", distance: "km", length: "mm", volume: "cm³" };
const US: UnitPrefs = { ...U, fuel: "mpg", distance: "mi" };
const ev = { tripKwhPer100: 8.34, kwhPer100: 12 };
const state = { ev: { ...ev, soc: 0.5, rangeKm: 400 } } as unknown as EngineState;

describe("hybrid consumption text", () => {
  test("pure EV stays kWh/100 km", () => {
    expect(driveConsumption(ev, null, U)).toEqual({ value: "8,3", unit: "kWh/100 km" });
  });
  test("full hybrid: fuel only, l/100 km", () => {
    const c = driveConsumption(ev, { tripL100: 4.46, plugIn: false }, U);
    expect(c).toEqual({ value: "4,5", unit: "l/100 km" });
    expect(consumptionLine(c)).toBe("4,5 l/100 km");
  });
  test("plug-in: fuel plus electric share", () => {
    const c = driveConsumption(ev, { tripL100: 4.46, plugIn: true }, U);
    expect(c.extra).toEqual({ value: "8,3", unit: "kWh/100 km" });
    expect(consumptionLine(c)).toBe("4,5 l/100 km + 8,3 kWh/100 km");
  });
  test("imperial: mpg for the fuel, kWh/100 mi for the battery", () => {
    expect(fuelConsumptionText(5, US)).toEqual({ value: "47,0", unit: "mpg" });
    expect(consumptionLine(driveConsumption(ev, { tripL100: 5, plugIn: true }, US))).toBe("47,0 mpg + 13,4 kWh/100 mi");
  });
  test("unknown average shows a dash", () => {
    expect(fuelConsumptionText(Number.NaN, U).value).toBe("–");
  });
  test("digital field of a hybrid shows fuel, of an EV kWh", () => {
    expect(evField("fuelNow", state, U, { tripL100: 4.46, plugIn: false })).toMatchObject({ value: "4,5", unit: "l/100 km" });
    expect(evField("fuelNow", state, U, { tripL100: 4.46, plugIn: true })).toMatchObject({ value: "4,5", unit: "l/100 km + 8,3 kWh/100 km" });
    expect(evField("fuelNow", state, U)).toMatchObject({ value: "8,3", unit: "kWh/100 km" });
  });
});
