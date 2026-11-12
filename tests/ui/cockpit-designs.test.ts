// Cockpit designs (#83): stored design and field assignment are validated; the switchable fields cycle and read in
// the chosen units.
import { beforeEach, describe, expect, test } from "bun:test";
import {
  COCKPIT_DESIGNS, DEFAULT_DIAL_THEME, DEFAULT_FIELDS, FIELD_IDS, FIELD_PRESETS, dialTheme, isCockpitChoice, resolveDesign, validateFields,
} from "../../src/ui/layouts/designs.ts";
import { driveModeWord, fieldAriaLabel, fieldAvailable, fieldLabel, formatField, nextField, rangeKm, type FieldInputs } from "../../src/ui/layouts/fields-logic.ts";
import { DEFAULT_SETTINGS, PRESETS, resetSettingsCache, validateSettings } from "../../src/ui/settings.ts";

beforeEach(() => resetSettingsCache());

const METRIC = PRESETS["metric-kw"].units;
const IMPERIAL = PRESETS.imperial.units;
const ALL = { turbo: true, vehicle: true, intakeKnown: true };

const inputs = (o: Partial<FieldInputs> = {}): FieldInputs => ({
  coolantC: 92, oilC: 104, oilPressureBar: 3.4, boostBar: 1.25, egtC: 720, intakeC: Number.NaN, fuelFlowLh: 6, speedKmh: 100, running: true,
  tankLevelL: 40, avgL100: 6.5, powerKw: 110, torqueNm: 340, lambda: 1.02, altitudeM: Number.NaN, gradePct: 0, t0to100S: null,
  t0to100Running: null, ambientC: 20, airCooled: false, ...o,
});

describe("settings: cockpit design and fields", () => {
  test("defaults: classic look and the everyday fields", () => {
    expect(DEFAULT_SETTINGS.cockpitDesign).toBe("classic");
    expect(validateSettings(null).cockpitDesign).toBe("classic");
    expect(validateSettings(null).ckFields).toEqual(DEFAULT_FIELDS);
  });
  test("every design id and auto are kept, unknown ids fall back", () => {
    for (const d of COCKPIT_DESIGNS) expect(validateSettings({ cockpitDesign: d.id }).cockpitDesign).toBe(d.id);
    expect(validateSettings({ cockpitDesign: "auto" }).cockpitDesign).toBe("auto");
    for (const bad of ["Classic", "retro", 3, null, {}]) expect(validateSettings({ cockpitDesign: bad }).cockpitDesign).toBe("classic");
    expect(isCockpitChoice("hud")).toBe(true);
    expect(isCockpitChoice("toString")).toBe(false);
  });
  test("field assignment: three valid ids, broken slots fall back one by one", () => {
    expect(validateSettings({ ckFields: ["oilT", "egt", "lambda"] }).ckFields).toEqual(["oilT", "egt", "lambda"]);
    expect(validateFields(["oilT", "nope", 5])).toEqual(["oilT", DEFAULT_FIELDS[1], DEFAULT_FIELDS[2]]);
    expect(validateFields(["power"])).toEqual(["power", DEFAULT_FIELDS[1], DEFAULT_FIELDS[2]]);
    expect(validateFields("oilT")).toEqual(DEFAULT_FIELDS);
    expect(validateFields(["a", "b", "c", "d"])).toHaveLength(3);
  });
  test("presets: track = oil, water, boost; daily = range, consumption, outside", () => {
    expect(FIELD_PRESETS.track.fields).toEqual(["oilT", "coolant", "boost"]);
    expect(FIELD_PRESETS.daily.fields).toEqual(["range", "fuelNow", "ambient"]);
  });
  test("designs are data: classic draws the default dial", () => {
    expect(dialTheme("classic")).toEqual(DEFAULT_DIAL_THEME);
    expect(dialTheme("italian").ring).toBe("tunnel");
    expect(dialTheme("oldschool")).toMatchObject({ ring: "chrome", needle: "tip", glass: true });
    expect(new Set(COCKPIT_DESIGNS.map((d) => d.id)).size).toBe(COCKPIT_DESIGNS.length);
    expect(COCKPIT_DESIGNS.length).toBeGreaterThanOrEqual(5);
  });
  test("auto: motorcycle display on a motorcycle, classic elsewhere; a fixed choice wins", () => {
    expect(resolveDesign("auto", "superbike")).toBe("motorrad");
    expect(resolveDesign("auto", "tourer")).toBe("motorrad");
    expect(resolveDesign("auto", "car")).toBe("classic");
    expect(resolveDesign("auto", "truck")).toBe("classic");
    expect(resolveDesign("digital", "superbike")).toBe("digital");
  });
});

describe("field cycling", () => {
  test("next and previous step through all fields and wrap", () => {
    expect(nextField("coolant", 1, ALL)).toBe("oilT");
    expect(nextField("coolant", -1, ALL)).toBe(FIELD_IDS[FIELD_IDS.length - 1]!);
    expect(nextField(FIELD_IDS[FIELD_IDS.length - 1]!, 1, ALL)).toBe("coolant");
    let id = FIELD_IDS[0]!;
    const seen = new Set<string>();
    for (let i = 0; i < FIELD_IDS.length; i++) {
      seen.add(id);
      id = nextField(id, 1, ALL);
    }
    expect(seen.size).toBe(FIELD_IDS.length);
  });
  test("unavailable values are skipped: no boost without turbo, no range/road/0–100 on the engine dyno", () => {
    const na = { turbo: false, vehicle: false, intakeKnown: false };
    expect(nextField("oilP", 1, na)).toBe("egt");
    expect(nextField("egt", 1, na)).toBe("fuelNow");
    expect(nextField("fuelNow", 1, na)).toBe("power");
    expect(nextField("lambda", 1, na)).toBe("ambient");
    expect(fieldAvailable("range", na)).toBe(false);
    expect(fieldAvailable("coolant", na)).toBe(true);
  });
});

describe("field values in the chosen units", () => {
  test("temperatures, pressures and limits", () => {
    expect(formatField("oilT", inputs(), METRIC)).toEqual({ label: "Öltemperatur", value: "104", unit: "°C", warn: false });
    expect(formatField("oilT", inputs({ oilC: 151 }), METRIC, { oilMaxC: 150 }).warn).toBe(true);
    expect(formatField("coolant", inputs(), IMPERIAL)).toMatchObject({ value: "198", unit: "°F" });
    expect(formatField("coolant", inputs({ airCooled: true }), METRIC).label).toBe("Zylinderkopf");
    expect(formatField("oilP", inputs(), METRIC)).toMatchObject({ value: "3,4", unit: "bar" });
    expect(formatField("oilP", inputs({ oilPressureBar: 0.3 }), METRIC, { oilPressureMinBar: 0.5 }).warn).toBe(true);
    expect(formatField("boost", inputs(), METRIC)).toMatchObject({ label: "Ladedruck", value: "1,25", unit: "bar" });
    expect(formatField("boost", inputs(), IMPERIAL)).toMatchObject({ value: "18,1", unit: "psi" });
    expect(formatField("egt", inputs({ egtC: 900 }), METRIC, { egtMaxC: 850 })).toMatchObject({ value: "900", warn: true });
    expect(formatField("intake", inputs(), METRIC).value).toBe("–");
  });
  test("consumption: per distance while driving, per hour at standstill", () => {
    expect(formatField("fuelNow", inputs(), METRIC)).toMatchObject({ value: "6,0", unit: "l/100 km" });
    expect(formatField("fuelNow", inputs({ speedKmh: 0, fuelFlowLh: 0.8 }), METRIC)).toMatchObject({ value: "0,8", unit: "l/h" });
    expect(formatField("fuelNow", inputs(), IMPERIAL)).toMatchObject({ value: "39,2", unit: "mpg" });
    expect(formatField("fuelNow", inputs({ speedKmh: 0, fuelFlowLh: 3.785411784 }), IMPERIAL)).toMatchObject({ value: "1,00", unit: "gal/h" });
  });
  test("range from tank and average", () => {
    expect(rangeKm(40, 6.5)).toBeCloseTo(615.38, 1);
    expect(rangeKm(40, Number.NaN)).toBeNaN();
    expect(rangeKm(Number.NaN, 6)).toBeNaN();
    expect(formatField("range", inputs(), METRIC)).toMatchObject({ value: "615", unit: "km" });
    expect(formatField("range", inputs(), IMPERIAL)).toMatchObject({ value: "382", unit: "mi" });
  });
  test("power, torque, lambda, road, 0–100, outside", () => {
    expect(formatField("power", inputs(), { ...METRIC, power: "PS" })).toMatchObject({ value: "150", unit: "PS" });
    expect(formatField("torque", inputs(), IMPERIAL)).toMatchObject({ value: "251", unit: "lb·ft" });
    expect(formatField("lambda", inputs(), METRIC)).toMatchObject({ value: "1,02", unit: "λ" });
    expect(formatField("road", inputs({ gradePct: 4 }), METRIC)).toMatchObject({ value: "+4,0", unit: "%" });
    expect(formatField("road", inputs({ altitudeM: 512, gradePct: -2.5 }), METRIC)).toMatchObject({ value: "512", unit: "m · −2,5 %" });
    expect(formatField("sprint", inputs({ t0to100S: 8.234 }), METRIC)).toMatchObject({ label: "0–100 km/h", value: "8,23", unit: "s" });
    expect(formatField("sprint", inputs({ t0to100Running: 3.27 }), IMPERIAL)).toMatchObject({ label: "0–62 mph", value: "3,3" });
    expect(formatField("ambient", inputs(), METRIC)).toMatchObject({ label: "Außentemperatur", value: "20", unit: "°C" });
  });
  test("accessible name and labels", () => {
    expect(fieldAriaLabel(0, formatField("oilT", inputs({ oilC: 92 }), METRIC))).toBe("Feld 1: Öltemperatur 92 °C – antippen zum Wechseln");
    expect(fieldAriaLabel(2, formatField("intake", inputs(), METRIC))).toBe("Feld 3: Ansaugluft kein Wert – antippen zum Wechseln");
    for (const id of FIELD_IDS) expect(fieldLabel(id).length).toBeGreaterThan(2);
  });
  test("drive mode word follows the gas response", () => {
    expect(driveModeWord(0)).toBe("Sport");
    expect(driveModeWord(1)).toBe("Normal");
    expect(driveModeWord(3)).toBe("Eco");
  });
});
