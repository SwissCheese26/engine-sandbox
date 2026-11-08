// Issue #26: pure helpers of the sandbox views – scales, shift point from the full-load curve, shift lights,
// warning-lamp logic – and the layout field of the settings.
import { beforeEach, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, LAYOUTS, getSettings, resetSettingsCache, setSettings, validateSettings } from "../../src/ui/settings.ts";
import {
  BULB_CHECK_S, avgL100, fuelScale, tachoZones, clusterLamps, dialAngle, glowTimeS, ledColors, limitZoneRpm, shiftLights, shiftPoints, speedoMax, speedoScaleMax, clampSpeedoKmh,
  speedoTicks, tachoMax, torqueAt, type LampInput,
} from "../../src/ui/layouts/logic.ts";

beforeEach(() => resetSettingsCache());

test("settings: layout is validated and defaults to the Prüfzelle", () => {
  expect(DEFAULT_SETTINGS.layout).toBe("pruefzelle");
  expect(validateSettings(null).layout).toBe("pruefzelle");
  expect(validateSettings({ layout: "cockpit" }).layout).toBe("cockpit");
  expect(validateSettings({ layout: "Cockpit" }).layout).toBe("pruefzelle");
  expect(validateSettings({ layout: 3 }).layout).toBe("pruefzelle");
  // old stored settings (before #26) keep their units and get the default view
  const old = validateSettings({ preset: "imperial", custom: DEFAULT_SETTINGS.custom });
  expect(old.preset).toBe("imperial");
  expect(old.layout).toBe("pruefzelle");
  for (const l of LAYOUTS) expect(validateSettings({ layout: l.id }).layout).toBe(l.id);
});

test("settings: a partial change keeps the rest (units stay when the view changes and vice versa)", () => {
  setSettings({ preset: "imperial" });
  setSettings({ layout: "race" });
  expect(getSettings().preset).toBe("imperial");
  expect(getSettings().layout).toBe("race");
  setSettings({ preset: "metric-ps" });
  expect(getSettings().layout).toBe("race");
  setSettings(DEFAULT_SETTINGS);
});

test("speedometer scale: about 1,2 × Vmax, at least 200 km/h / 120 mph", () => {
  expect(speedoMax(150, "km/h")).toBe(200);
  expect(speedoMax(212, "km/h")).toBe(260);
  expect(speedoMax(305, "km/h")).toBe(400);
  expect(speedoMax(Number.NaN, "km/h")).toBe(200);
  expect(speedoMax(130, "mph")).toBe(160);
  expect(speedoMax(1000, "km/h")).toBe(400);
  expect(speedoTicks(200, "km/h")).toEqual({ major: 20, minor: 10 });
  expect(speedoTicks(260, "km/h")).toEqual({ major: 40, minor: 10 });
  expect(speedoTicks(360, "km/h").major).toBe(40);
});

test("rev counter: full scale above the limiter, limit zone from the lower of limiter and safe rpm", () => {
  expect(tachoMax(4800)).toBe(6000);
  expect(tachoMax(6500)).toBe(7000);
  expect(tachoMax(7000)).toBe(8000);
  expect(tachoMax(1500)).toBe(4000);
  expect(limitZoneRpm(6500, 7200)).toBe(6500);
  expect(limitZoneRpm(6500, 6130)).toBe(6000);
  expect(limitZoneRpm(4800, Number.NaN)).toBe(4750);
});

test("dial angle: 270° sweep from 135°, clamped", () => {
  expect(dialAngle(0, 100)).toBeCloseTo((135 * Math.PI) / 180, 9);
  expect(dialAngle(100, 100)).toBeCloseTo((405 * Math.PI) / 180, 9);
  expect(dialAngle(50, 100)).toBeCloseTo((270 * Math.PI) / 180, 9);
  expect(dialAngle(200, 100)).toBe(dialAngle(100, 100));
  expect(dialAngle(Number.NaN, 100)).toBe(dialAngle(0, 100));
});

test("torqueAt interpolates and holds the end values", () => {
  const c = [{ rpm: 1000, torqueNm: 100 }, { rpm: 2000, torqueNm: 200 }];
  expect(torqueAt(c, 1500)).toBeCloseTo(150, 9);
  expect(torqueAt(c, 500)).toBe(100);
  expect(torqueAt(c, 3000)).toBe(200);
  expect(torqueAt([], 1500)).toBe(0);
});

test("shift point: flat torque → shift at the limiter; falling torque → earlier shift where the next gear pulls harder", () => {
  const ratios = [3.77, 2.09, 1.47, 1.1, 0.87, 0.71];
  const flat = Array.from({ length: 61 }, (_, i) => ({ rpm: 1000 + i * 100, torqueNm: 300 }));
  const p = shiftPoints(flat, ratios, 7000);
  expect(p.length).toBe(6);
  expect(p.every((r) => r === 7000)).toBe(true);
  // torque falls steeply above 4000 rpm (turbo diesel like): the upshift pays off before the limiter
  const diesel = Array.from({ length: 41 }, (_, i) => {
    const rpm = 1000 + i * 100;
    return { rpm, torqueNm: rpm <= 4000 ? 400 : 400 - (rpm - 4000) * 0.35 };
  });
  const d = shiftPoints(diesel, ratios, 5000);
  expect(d[0]!).toBeLessThan(5000);
  expect(d[0]!).toBeGreaterThan(4000);
  // check the rule itself at the found point: wheel force in gear 1 ≤ gear 2 just after it
  const r = d[0]!;
  expect(torqueAt(diesel, r + 50) * ratios[0]!).toBeLessThan(torqueAt(diesel, ((r + 50) * ratios[1]!) / ratios[0]!) * ratios[1]! + 1);
  expect(d[5]).toBe(5000);
});

test("shift lights: green → yellow → red, all lit and flashing at the shift point", () => {
  const colors = ledColors(10);
  expect(colors.slice(0, 4).every((c) => c === "green")).toBe(true);
  expect(colors.slice(4, 7).every((c) => c === "yellow")).toBe(true);
  expect(colors.slice(7).every((c) => c === "red")).toBe(true);
  expect(shiftLights(3000, 6000, 10)).toEqual({ lit: 0, flash: false });
  expect(shiftLights(4500, 6000, 10)).toEqual({ lit: 0, flash: false });
  expect(shiftLights(4501, 6000, 10).lit).toBe(1);
  expect(shiftLights(5250, 6000, 10).lit).toBe(5);
  expect(shiftLights(5999, 6000, 10).lit).toBe(10);
  expect(shiftLights(6000, 6000, 10)).toEqual({ lit: 10, flash: true });
  expect(shiftLights(Number.NaN, 6000, 10).lit).toBe(0);
});

const base: LampInput = {
  ignition: true, running: true, sinceIgnitionS: 10, diesel: false, coolantC: 90, coolantMaxC: 110, oilPressureBar: 2.5,
  damaged: false, warnings: [], abs: { enabled: true, active: false }, esp: { esp: true, asr: true, active: false }, ice: false,
};

test("lamps: ignition off → all dark", () => {
  const l = clusterLamps({ ...base, ignition: false });
  expect(Object.values(l).every((v) => v === "off")).toBe(true);
});

test("lamps: bulb check right after ignition on, then charge, oil and MIL while the engine stands", () => {
  const check = clusterLamps({ ...base, running: false, sinceIgnitionS: 0.5, oilPressureBar: 0 });
  expect(check.abs).toBe("on");
  expect(check.coolant).toBe("on");
  expect(check.battery).toBe("on");
  const after = clusterLamps({ ...base, running: false, sinceIgnitionS: BULB_CHECK_S + 1, oilPressureBar: 0 });
  expect(after.battery).toBe("on");
  expect(after.oil).toBe("on");
  expect(after.engine).toBe("on");
  expect(after.abs).toBe("off");
  expect(after.coolant).toBe("off");
});

test("lamps: running engine is dark; faults light their lamps", () => {
  const ok = clusterLamps(base);
  expect(Object.values(ok).every((v) => v === "off")).toBe(true);
  expect(clusterLamps({ ...base, oilPressureBar: 0.1 }).oil).toBe("on");
  expect(clusterLamps({ ...base, warnings: ["low-oil-pressure"] }).oil).toBe("on");
  expect(clusterLamps({ ...base, coolantC: 118 }).coolant).toBe("on");
  expect(clusterLamps({ ...base, damaged: true }).engine).toBe("on");
  expect(clusterLamps({ ...base, ice: true }).ice).toBe("on");
});

test("lamps: ABS off / regulating, ESP blinking while it intervenes, ESP OFF", () => {
  expect(clusterLamps({ ...base, abs: { enabled: false, active: false } }).abs).toBe("on");
  expect(clusterLamps({ ...base, abs: { enabled: true, active: true } }).abs).toBe("blink");
  expect(clusterLamps({ ...base, esp: { esp: true, asr: true, active: true } }).esp).toBe("blink");
  const off = clusterLamps({ ...base, esp: { esp: false, asr: true, active: false } });
  expect(off.espOff).toBe("on");
  // engine dyno: no ABS/ESP information
  const dyno = clusterLamps({ ...base, abs: undefined, esp: undefined });
  expect(dyno.abs).toBe("off");
  expect(dyno.espOff).toBe("off");
});

test("lamps: diesel pre-glow only while cold and before the start", () => {
  expect(glowTimeS(90)).toBe(0);
  expect(glowTimeS(-20)).toBeGreaterThan(glowTimeS(10));
  expect(glowTimeS(-40)).toBeLessThanOrEqual(5);
  const cold = { ...base, diesel: true, running: false, coolantC: 0, oilPressureBar: 0 };
  expect(clusterLamps({ ...cold, sinceIgnitionS: BULB_CHECK_S + 0.01 }).glow).toBe(glowTimeS(0) > BULB_CHECK_S + 0.01 ? "on" : "off");
  expect(clusterLamps({ ...cold, sinceIgnitionS: 4.5 }).glow).toBe("off");
  expect(clusterLamps({ ...cold, coolantC: -20, sinceIgnitionS: 3 }).glow).toBe("on");
  expect(clusterLamps({ ...cold, running: true, coolantC: -20, sinceIgnitionS: 3 }).glow).toBe("off");
  expect(clusterLamps({ ...base, running: false, sinceIgnitionS: 3 }).glow).toBe("off");
});

test("average consumption needs 0,1 km", () => {
  expect(Number.isNaN(avgL100(0.05, 0.01))).toBe(true);
  expect(avgL100(10, 0.6)).toBeCloseTo(6, 9);
});

test("rev counter zones: yellow pre-warning, red from the limiter", () => {
  expect(tachoZones(6500, 7200)).toEqual({ warnFrom: 6000, redFrom: 6500 });
  expect(tachoZones(6500, 5900)).toEqual({ warnFrom: 5750, redFrom: 6500 });
  expect(tachoZones(4800, Number.NaN)).toEqual({ warnFrom: 4250, redFrom: 4800 });
});

test("consumption dial follows the chosen unit", () => {
  expect(fuelScale("l/100 km", true)).toEqual({ unit: "l/100 km", max: 30, major: 10 });
  expect(fuelScale("mpg", true).unit).toBe("mpg");
  expect(fuelScale("km/l", true).max).toBe(40);
  expect(fuelScale("mpg", false).unit).toBe("gal/h");
  expect(fuelScale("km/l", false).unit).toBe("l/h");
});

test("speedometer scale presets: Standard 240 … Vmax-Killer 500, own scale, auto (after #26)", () => {
  expect(speedoScaleMax("standard", 0, 100, "km/h")).toBe(240);
  expect(speedoScaleMax("sporty", 0, 100, "km/h")).toBe(280);
  expect(speedoScaleMax("rs", 0, 100, "km/h")).toBe(320);
  expect(speedoScaleMax("hyper", 0, 100, "km/h")).toBe(400);
  expect(speedoScaleMax("killer", 0, 100, "km/h")).toBe(500);
  expect(speedoScaleMax("custom", 333, 100, "km/h")).toBe(340);
  expect(speedoScaleMax("custom", 5000, 100, "km/h")).toBe(600);
  expect(speedoScaleMax("auto", 0, 212, "km/h")).toBe(speedoMax(212, "km/h"));
  // in mph the km/h scale is converted and rounded up to 10
  expect(speedoScaleMax("standard", 0, 100, "mph")).toBe(150);
  expect(speedoScaleMax("killer", 0, 100, "mph")).toBe(320);
  expect(clampSpeedoKmh(Number.NaN)).toBe(240);
  expect(clampSpeedoKmh(10)).toBe(100);
  // every scale gets ticks that end on the scale end and at most 12 numerals
  for (const unit of ["km/h", "mph"]) {
    for (const id of ["standard", "sporty", "rs", "hyper", "killer"] as const) {
      const max = speedoScaleMax(id, 0, 0, unit);
      const t = speedoTicks(max, unit);
      expect(max % t.minor).toBe(0);
      expect(max / t.major).toBeLessThanOrEqual(12.5);
    }
  }
  expect(speedoTicks(500, "km/h")).toEqual({ major: 50, minor: 25 });
  for (let kmh = 100; kmh <= 600; kmh += 20) {
    const max = speedoScaleMax("custom", kmh, 0, "km/h");
    expect(max % speedoTicks(max, "km/h").minor).toBe(0);
  }
});

test("settings: speedometer scale defaults to Standard and is validated", () => {
  expect(DEFAULT_SETTINGS.speedo).toBe("standard");
  expect(validateSettings({ speedo: "warp", speedoCustomKmh: "x" })).toMatchObject({ speedo: "standard", speedoCustomKmh: 240 });
  expect(validateSettings({ speedo: "killer", speedoCustomKmh: 451 })).toMatchObject({ speedo: "killer", speedoCustomKmh: 460 });
});

test("settings: gas lever on the chassis dyno springs back by default, 'hold' is kept", () => {
  expect(DEFAULT_SETTINGS.throttle).toBe("spring");
  expect(validateSettings({ throttle: "hold" }).throttle).toBe("hold");
  expect(validateSettings({ throttle: "x" }).throttle).toBe("spring");
});

test("settings: shift buttons in the control bar default to automatic (touch), on/off kept", () => {
  expect(DEFAULT_SETTINGS.shiftPad).toBe("auto");
  expect(validateSettings({ shiftPad: "on" }).shiftPad).toBe("on");
  expect(validateSettings({ shiftPad: "off" }).shiftPad).toBe("off");
  expect(validateSettings({ shiftPad: 3 }).shiftPad).toBe("auto");
});
