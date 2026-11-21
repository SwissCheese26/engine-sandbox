import { describe, expect, test } from "bun:test";
import { EvSimulator, defaultInputs } from "../../src/core/index.ts";
import type { EngineState } from "../../src/core/index.ts";
import { libraryCar } from "../../src/data/vehicle-library.ts";
import { COCKPIT_DESIGNS, DESIGN_CHOICES, FIELD_IDS, resolveDesign } from "../../src/ui/layouts/designs.ts";
import { consumptionText, evField, evLamps, nextDriveMode, powerMeterScale, rangeText, socText } from "../../src/ui/layouts/ev-logic.ts";
import { clusterLamps } from "../../src/ui/layouts/logic.ts";
import type { UnitPrefs } from "../../src/ui/settings.ts";

// Electric cars in the cockpit (#108): every design has an EV variant, the E-Tacho is picked automatically.

const plaid = libraryCar("ev-tesla-model-s-plaid").setup.ev!;
const U: UnitPrefs = { power: "kW", torque: "Nm", pressure: "bar", temp: "°C", fuel: "l/100 km", speed: "km/h", distance: "km", length: "mm", volume: "cm³" };

function driving(): EngineState {
  const sim = new EvSimulator(plaid);
  const inp = { ...defaultInputs(), ignition: true, pedal: 1 };
  for (let i = 0; i < 30; i++) sim.step(1 / 60, inp);
  return sim.state;
}

describe("E-Tacho design", () => {
  test("listed, picked by Automatisch for electric cars only", () => {
    expect(COCKPIT_DESIGNS.some((d) => d.id === "etacho")).toBe(true);
    expect(DESIGN_CHOICES.map((d) => d.id)).toContain("etacho");
    expect(resolveDesign("auto", "car", true)).toBe("etacho");
    expect(resolveDesign("auto", "car")).toBe("classic");
    expect(resolveDesign("auto", "truck")).toBe("truck");
    // an explicit choice stays, also in an EV
    expect(resolveDesign("race", "car", true)).toBe("race");
  });
});

describe("power meter, texts", () => {
  test("scale from regen below zero to the system power", () => {
    const s = powerMeterScale(plaid);
    expect(s.min).toBeLessThan(0);
    expect(s.max).toBeGreaterThanOrEqual(750);
    expect(s.max).toBeLessThanOrEqual(1000);
    const id3 = powerMeterScale(libraryCar("ev-vw-id3-pro-performance").setup.ev!);
    expect(id3.max).toBeGreaterThanOrEqual(150);
    expect(id3.max).toBeLessThanOrEqual(200);
  });
  test("SoC, range and consumption in the chosen units", () => {
    expect(socText(0.873)).toBe("87 %");
    expect(rangeText(400, U)).toBe("400 km");
    expect(rangeText(160.9344, { distance: "mi" })).toBe("100 mi");
    expect(consumptionText(18, U)).toEqual({ value: "18,0", unit: "kWh/100 km" });
    expect(consumptionText(Number.NaN, U).value).toBe("–");
    expect(nextDriveMode("chill")).toBe("sport");
    expect(nextDriveMode("plaid")).toBe("chill");
  });
});

describe("lamps of an electric car", () => {
  const base = clusterLamps({ ignition: true, running: true, sinceIgnitionS: 10, diesel: false, coolantC: 160, coolantMaxC: 120, oilPressureBar: 0, damaged: false, warnings: [] });
  test("no oil, coolant, glow or alternator lamp; Ready on; low charge and power reduction", () => {
    expect(base.oil).toBe("on"); // what a combustion cluster would show with 0 bar
    const l = evLamps(base, { ready: true, ignition: true, soc: 0.5, warnings: [] });
    expect([l.oil, l.coolant, l.glow, l.battery]).toEqual(["off", "off", "off", "off"]);
    expect(l.ready).toBe("on");
    expect(l.fuel).toBe("off");
    const low = evLamps(base, { ready: true, ignition: true, soc: 0.05, warnings: ["battery-low"] });
    expect(low.fuel).toBe("on");
    expect(low.engine).toBe("on");
    expect(evLamps(base, { ready: false, ignition: false, soc: 0.5, warnings: [] }).ready).toBe("off");
  });
});

describe("digital fields with an EV", () => {
  test("every field slot shows something sensible (EV value or the shared one)", () => {
    const s = driving();
    const mapped = FIELD_IDS.map((id) => [id, evField(id, s, U)] as const);
    const byId = Object.fromEntries(mapped);
    expect(byId.coolant?.label).toBe("Akku");
    expect(byId.oilT?.label).toBe("E-Motor");
    expect(byId.oilP?.unit).toBe("V");
    expect(byId.boost?.unit).toBe("A");
    expect(byId.range?.label).toBe("Reichweite");
    expect(byId.fuelNow?.unit).toBe("kWh/100 km");
    // the others (speed, power, torque, road, sprint, ambient) are the same as in a combustion car
    for (const id of ["power", "torque", "road", "sprint", "ambient"] as const) expect(byId[id]).toBeNull();
  });
});
