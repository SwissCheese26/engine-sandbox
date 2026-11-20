// Cockpit extras (#83): additional gauges, truck/bus design, tuning bar and the intake-air field. Only values the
// core reports (or the engine configuration) are shown; what the core does not model is not offered.
import { beforeEach, describe, expect, test } from "bun:test";
import type { EngineConfig, EngineLimits } from "../../src/core/index.ts";
import { COCKPIT_DESIGNS, DESIGN_CHOICES, GAUGE_IDS, dialTheme, isGaugeId, resolveDesign, validateGauges } from "../../src/ui/layouts/designs.ts";
import {
  economyBand, engineBrakeInfo, gaugeAvailable, gaugeFraction, gaugeScale, gaugeValue, toggleGauge, truckSpeedScale, truckTachoScale, tuneItems,
} from "../../src/ui/layouts/extras-logic.ts";
import { fieldLabel, formatField, intakeAirOf, type FieldInputs } from "../../src/ui/layouts/fields-logic.ts";
import { DEFAULT_SETTINGS, PRESETS, resetSettingsCache, validateSettings } from "../../src/ui/settings.ts";
import { REFERENCE_ENGINES } from "../../src/data/reference-engines.ts";

beforeEach(() => resetSettingsCache());

const METRIC = PRESETS["metric-kw"].units;
const IMPERIAL = PRESETS.imperial.units;
const LIM: EngineLimits = {
  coolantMaxC: 110, oilMaxC: 140, egtMaxC: 950, oilPressureMinBar: 0.8, boostMaxBar: 1.6, peakPressureMaxBar: 140, turboMaxRpm: 200000, meanPistonSpeedMaxMs: 22,
};
const petrol: EngineConfig = REFERENCE_ENGINES.map((e) => e.config).find((c) => c.fuel === "petrol" && c.induction.aspiration !== "naturally-aspirated")!;
const diesel: EngineConfig = REFERENCE_ENGINES.map((e) => e.config).find((c) => c.fuel === "diesel")!;

describe("design selection: truck/bus design", () => {
  test("the truck design is a design (data only) and offered in the picker", () => {
    expect(COCKPIT_DESIGNS.some((d) => d.id === "truck")).toBe(true);
    expect(DESIGN_CHOICES.map((d) => d.id)).toContain("truck");
    expect(dialTheme("truck").needle).toBe("bar");
    expect(validateSettings({ cockpitDesign: "truck" }).cockpitDesign).toBe("truck");
  });
  test("auto → truck for trucks and buses, motorcycle and car unchanged", () => {
    expect(resolveDesign("auto", "truck")).toBe("truck");
    expect(resolveDesign("auto", "bus")).toBe("truck");
    expect(resolveDesign("auto", "car")).toBe("classic");
    expect(resolveDesign("auto", "superbike")).toBe("motorrad");
  });
  test("speedometer 0–125 km/h (0–80 mph), last numeral and minor tick on the scale end", () => {
    expect(truckSpeedScale("km/h")).toEqual({ max: 125, major: 20, minor: 5 });
    expect(truckSpeedScale("mph")).toEqual({ max: 80, major: 10, minor: 5 });
    for (const u of ["km/h", "mph"]) {
      const s = truckSpeedScale(u);
      expect(s.max % s.minor).toBe(0);
      expect(s.major % s.minor).toBe(0);
    }
  });
  test("rev counter: limiter + head room on a 500 step, numerals in hundreds", () => {
    expect(truckTachoScale(2100)).toEqual({ max: 2500, major: 500, minor: 100, labelDiv: 100 });
    expect(truckTachoScale(2400)).toMatchObject({ max: 3000 });
    expect(truckTachoScale(1500).max).toBe(2500);
  });
  test("green band = torque plateau (≥ 95 % of peak) of the full-load curve", () => {
    // OM 471-like: 2200 Nm from 1000 to 1400 rpm, falling off on both sides
    const curve = [
      { rpm: 600, torqueNm: 1400 }, { rpm: 900, torqueNm: 2000 }, { rpm: 1000, torqueNm: 2200 }, { rpm: 1400, torqueNm: 2200 },
      { rpm: 1800, torqueNm: 1750 }, { rpm: 2100, torqueNm: 1400 },
    ];
    const b = economyBand(curve)!;
    expect(b.from).toBeGreaterThanOrEqual(950);
    expect(b.from).toBeLessThanOrEqual(1000);
    expect(b.to).toBeGreaterThanOrEqual(1400);
    expect(b.to).toBeLessThanOrEqual(1500);
    expect(economyBand([])).toBeNull();
    expect(economyBand([{ rpm: 1000, torqueNm: 0 }, { rpm: 2000, torqueNm: 0 }])).toBeNull();
  });
  test("engine brake: none, ready, braking power while it acts; no retarder stages", () => {
    const off = engineBrakeInfo({ ...diesel, engineBrake: undefined }, false, 0, METRIC);
    expect(off).toEqual({ state: "none", kind: "", value: "nicht verbaut" });
    const cfg: EngineConfig = { ...diesel, engineBrake: { kind: "decompression", maxKw: 400 } };
    expect(engineBrakeInfo(cfg, false, -10, METRIC)).toMatchObject({ state: "ready", kind: "Dekompressionsbremse", value: "bereit" });
    expect(engineBrakeInfo(cfg, true, -312.4, METRIC)).toMatchObject({ state: "active", value: "312 kW" });
    expect(engineBrakeInfo({ ...cfg, engineBrake: { kind: "exhaust-flap", maxKw: 300 } }, true, -100, { ...METRIC, power: "PS" })).toMatchObject({ kind: "Auspuffklappe", value: "136 PS" });
  });
});

describe("additional gauges", () => {
  test("ids: boost, oil pressure, oil temperature, lambda, EGT; no voltage (not in the core)", () => {
    expect([...GAUGE_IDS]).toEqual(["boost", "oilP", "oilT", "lambda", "egt"]);
    expect(isGaugeId("voltage")).toBe(false);
    expect(isGaugeId("intake")).toBe(false);
  });
  test("stored choice: valid ids once each, in strip order; default none", () => {
    expect(DEFAULT_SETTINGS.ckGauges).toEqual([]);
    expect(validateSettings(null)).toMatchObject({ ckGauges: [], ckGaugeStyle: "round", ckTuneBar: false });
    expect(validateGauges(["egt", "boost", "egt", "volt", 3])).toEqual(["boost", "egt"]);
    expect(validateGauges("boost")).toEqual([]);
    expect(validateSettings({ ckGauges: ["oilT", "lambda"], ckGaugeStyle: "bar", ckTuneBar: true })).toMatchObject({ ckGauges: ["oilT", "lambda"], ckGaugeStyle: "bar", ckTuneBar: true });
    expect(validateSettings({ ckGaugeStyle: "needle", ckTuneBar: "yes" })).toMatchObject({ ckGaugeStyle: "round", ckTuneBar: false });
    expect(toggleGauge(["egt"], "boost", true)).toEqual(["boost", "egt"]);
    expect(toggleGauge(["boost", "egt"], "boost", false)).toEqual(["egt"]);
  });
  test("boost only on charged engines", () => {
    expect(gaugeAvailable("boost", { turbo: false })).toBe(false);
    expect(gaugeAvailable("boost", { turbo: true })).toBe(true);
    expect(gaugeAvailable("lambda", { turbo: false })).toBe(true);
  });
  test("scales in the chosen units with the engine's limit zones", () => {
    expect(gaugeScale("boost", LIM, "petrol", METRIC)).toMatchObject({ min: 0, max: 2, zone: { from: 1.6, to: 2 } });
    expect(gaugeScale("oilP", LIM, "petrol", METRIC)).toMatchObject({ min: 0, max: 6, zone: { from: 0, to: 0.8 } });
    expect(gaugeScale("oilT", LIM, "petrol", METRIC)).toMatchObject({ min: 50, max: 150, zone: { from: 140, to: 150 } });
    expect(gaugeScale("egt", LIM, "diesel", METRIC)).toMatchObject({ min: 100, max: 1100, zone: { from: 950 } });
    expect(gaugeScale("lambda", LIM, "petrol", METRIC)).toMatchObject({ min: 0.7, max: 1.3 });
    expect(gaugeScale("lambda", LIM, "diesel", METRIC)).toMatchObject({ min: 1, max: 4 });
    const f = gaugeScale("oilT", LIM, "petrol", IMPERIAL);
    expect(f.min).toBeCloseTo(122, 5);
    expect(f.max).toBeCloseTo(302, 5);
    expect(gaugeScale("boost", LIM, "petrol", IMPERIAL).max).toBeCloseTo(29.0, 0);
  });
  test("values and bar fill", () => {
    const v = { boostBar: -0.4, oilPressureBar: 3, oilC: 100, lambda: 0.88, egtC: 800 };
    expect(gaugeValue("boost", v, METRIC)).toBe(0);
    expect(gaugeValue("oilT", v, IMPERIAL)).toBeCloseTo(212, 5);
    expect(gaugeValue("lambda", v, IMPERIAL)).toBe(0.88);
    expect(gaugeFraction(100, { min: 50, max: 150 })).toBe(0.5);
    expect(gaugeFraction(200, { min: 50, max: 150 })).toBe(1);
    expect(gaugeFraction(Number.NaN, { min: 0, max: 1 })).toBe(0);
  });
});

describe("tuning bar", () => {
  const st = { boostBar: 1.05, knock: 0.2, torqueLimited: false, warnings: [] as never[] };
  test("petrol turbo: boost target vs actual, ignition offset, full-load λ, knock, limit", () => {
    const cfg: EngineConfig = { ...petrol, induction: { ...petrol.induction, boostTargetBar: 1.2 }, fuelSystem: { ...(petrol.fuelSystem as Extract<EngineConfig["fuelSystem"], { kind: "petrol" }>), ignitionAdvanceOffsetDeg: 2, fullLoadLambda: 0.85 }, ecuTorqueLimitNm: 380, ecuPowerLimitKw: undefined };
    const items = tuneItems(cfg, st, METRIC);
    expect(items.map((i) => i.key)).toEqual(["boost", "map", "mix", "knock", "limit"]);
    expect(items[0]).toMatchObject({ label: "Ladedruck Soll / Ist", value: "1,20 / 1,05 bar", warn: false });
    expect(items[1]).toMatchObject({ value: "+2,0 °KW" });
    expect(items[2]).toMatchObject({ value: "0,85" });
    expect(items[3]).toMatchObject({ value: "20 %", warn: false });
    expect(items[4]).toMatchObject({ value: "380 Nm", active: false });
    const hot = tuneItems(cfg, { ...st, torqueLimited: true, warnings: ["knock", "overboost"] }, METRIC);
    expect(hot[0]!.warn).toBe(true);
    expect(hot[3]!.warn).toBe(true);
    expect(hot[4]).toMatchObject({ value: "380 Nm · greift", active: true });
  });
  test("diesel: start of injection and smoke limit, power limit in the chosen unit; no limit reads 'keine'", () => {
    const fs = diesel.fuelSystem as Extract<EngineConfig["fuelSystem"], { kind: "diesel" }>;
    const cfg: EngineConfig = { ...diesel, fuelSystem: { ...fs, injectionTimingOffsetDeg: -1.5, smokeLimitLambda: 1.3 }, ecuPowerLimitKw: 330, ecuTorqueLimitNm: undefined };
    const items = tuneItems(cfg, st, { ...METRIC, power: "PS" });
    expect(items.find((i) => i.key === "map")).toMatchObject({ label: "Förderbeginn zum Kennfeld", value: "−1,5 °KW" });
    expect(items.find((i) => i.key === "mix")).toMatchObject({ value: "1,30" });
    expect(items.some((i) => i.key === "knock")).toBe(false);
    expect(items.find((i) => i.key === "limit")).toMatchObject({ value: "449 PS" });
    const none = tuneItems({ ...cfg, ecuPowerLimitKw: undefined }, { ...st, torqueLimited: true }, METRIC);
    expect(none.find((i) => i.key === "limit")).toMatchObject({ value: "keine", active: false });
  });
  test("naturally aspirated: no boost item", () => {
    const na: EngineConfig = { ...petrol, induction: { ...petrol.induction, aspiration: "naturally-aspirated" } };
    expect(tuneItems(na, st, METRIC).some((i) => i.key === "boost")).toBe(false);
  });
});

describe("intake air field", () => {
  test("label and value in the chosen unit; unknown reads –", () => {
    const v = { intakeAirC: 45 } as FieldInputs;
    expect(fieldLabel("intake")).toBe("Ansaugluft");
    expect(formatField("intake", v, METRIC)).toEqual({ label: "Ansaugluft", value: "45", unit: "°C", warn: false });
    expect(formatField("intake", v, IMPERIAL)).toMatchObject({ value: "113", unit: "°F" });
    expect(formatField("intake", {} as FieldInputs, METRIC).value).toBe("–");
  });
  test("read from the engine state only when the core reports it", () => {
    expect(intakeAirOf({ rpm: 800 })).toBeNaN();
    expect(intakeAirOf({ intakeAirC: Number.NaN })).toBeNaN();
    expect(intakeAirOf({ intakeAirC: "40" })).toBeNaN();
    expect(intakeAirOf({ intakeAirC: 38.5 })).toBe(38.5);
  });
});
