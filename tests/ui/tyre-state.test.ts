// Issue #144: tyre lamp, toasts, field and gauge, smoke, vibration and rumble.
import { describe, expect, test } from "bun:test";
import { TYRE_HEAT } from "../../src/core/index.ts";
import { tyreRumbleVoice } from "../../src/audio/tyre-rumble.ts";
import { Haptics } from "../../src/ui/device.ts";
import { clusterLamps } from "../../src/ui/layouts/logic.ts";
import { formatField, fieldAvailable, type FieldInputs } from "../../src/ui/layouts/fields-logic.ts";
import { gaugeAvailable, gaugeScale, gaugeValue } from "../../src/ui/layouts/extras-logic.ts";
import { FIELD_IDS, GAUGE_IDS } from "../../src/ui/layouts/designs.ts";
import { emission } from "../../src/ui/smoke-emitters.ts";
import { toastInputs, tyreNote } from "../../src/ui/toasts.ts";
import { FALLBACK_LIMITS } from "../../src/ui/limits-fallback.ts";
import type { EngineState } from "../../src/core/index.ts";

const u = { temp: "°C", pressure: "bar", speed: "km/h", fuel: "l/100km", distance: "km", power: "kW", torque: "Nm" } as never;
const lampBase = { ignition: true, running: true, sinceIgnitionS: 10, diesel: false, coolantC: 90, coolantMaxC: 110, oilPressureBar: 3, damaged: false, warnings: [] };

describe("tyre lamp", () => {
  test("off, on at the warning, blinking with vibration or blowout; dark on the engine dyno", () => {
    expect(clusterLamps({ ...lampBase, tyre: { hot: false, vibration: false, failed: false } }).tyre).toBe("off");
    expect(clusterLamps({ ...lampBase, tyre: { hot: true, vibration: false, failed: false } }).tyre).toBe("on");
    expect(clusterLamps({ ...lampBase, tyre: { hot: true, vibration: true, failed: false } }).tyre).toBe("blink");
    expect(clusterLamps({ ...lampBase, tyre: { hot: true, vibration: false, failed: true } }).tyre).toBe("blink");
    expect(clusterLamps(lampBase).tyre).toBe("off");
  });
});

describe("tyre toasts", () => {
  const state = { destroyed: false, damage: [], warnings: [], running: true } as unknown as EngineState;
  test("warning is calm (setting), blowout always", () => {
    const hot = toastInputs({ state, outOfFuel: false, tyre: { tyreWarn: true, tyreVibration: false, tyreFailed: false } });
    expect(hot.find((t) => t.key === "tyre-hot")?.always).toBeFalsy();
    const blown = toastInputs({ state, outOfFuel: false, tyre: { tyreWarn: true, tyreVibration: false, tyreFailed: true } });
    expect(blown.find((t) => t.key === "tyre-failed")?.always).toBe(true);
    expect(tyreNote({ tyreWarn: true, tyreVibration: false, tyreFailed: false })).toContain("Reifen überhitzen");
    expect(tyreNote({ tyreWarn: false, tyreVibration: false, tyreFailed: false })).toBe("");
  });
});

describe("tyre field and gauge", () => {
  test("in the field and gauge lists, vehicle only", () => {
    expect(FIELD_IDS).toContain("tyre");
    expect(GAUGE_IDS).toContain("tyre");
    expect(fieldAvailable("tyre", { turbo: false, vehicle: false })).toBe(false);
    expect(fieldAvailable("tyre", { turbo: false, vehicle: true })).toBe(true);
    expect(gaugeAvailable("tyre", { turbo: false, tyre: true })).toBe(true);
    expect(gaugeAvailable("tyre", { turbo: false })).toBe(false);
  });
  test("temperature, warn colour, Platzer", () => {
    const v = { tyreCarcassC: 112, tyreWarn: true } as FieldInputs;
    expect(formatField("tyre", v, u)).toMatchObject({ label: "Reifen", value: "112", warn: true });
    expect(formatField("tyre", { ...v, tyreFailed: true }, u).value).toBe("Platzer");
    expect(gaugeValue("tyre", { tyreCarcassC: 90 } as never, u)).toBe(90);
    const sc = gaugeScale("tyre", FALLBACK_LIMITS as never, "petrol", u);
    expect(sc.zone?.from).toBe(TYRE_HEAT.warnC);
    expect(sc.red?.from).toBe(TYRE_HEAT.limitC);
  });
});

describe("blowout effects", () => {
  const base = { running: true, vehicle: true, vehicleSpeedMs: 30, liquidCooled: true, coolantC: 90, coolantMaxC: 110, oilC: 100, oilMaxC: 140, warnings: [], damaged: false, diesel: false, smoke: 0, smokeMax: 0.5 };
  test("smoke from a blown tyre while rolling", () => {
    expect(emission(base).tyre).toBe(0);
    expect(emission({ ...base, tyreFailed: true }).tyre).toBeGreaterThan(0.3);
    expect(emission({ ...base, tyreFailed: true, vehicleSpeedMs: 0 }).tyre).toBe(0);
  });
  test("vibration: jolt at the blowout, rumble with damage", () => {
    const got: unknown[] = [];
    const h = new Haptics((p) => got.push(p));
    const s = { destroyed: false, running: true, rpm: 2000, absActive: false } as unknown as EngineState;
    h.update(0.1, s, 7000, 0, true, { vibration: true, failed: false, moving: true });
    expect(got).toEqual([Haptics.TYRE]);
    h.update(0.5, s, 7000, 0, true, { vibration: false, failed: true, moving: true });
    expect(got.at(-1)).toEqual(Haptics.BLOWOUT);
  });
  test("rumble at the wheel frequency, silent without damage", () => {
    expect(tyreRumbleVoice({ vibration: false, failed: false, speedMs: 30, wheelRadiusM: 0.3 }).gain).toBe(0);
    const v = tyreRumbleVoice({ vibration: true, failed: false, speedMs: 30, wheelRadiusM: 0.3 });
    expect(v.gain).toBeGreaterThan(0);
    expect(v.wheelHz).toBeCloseTo(30 / (2 * Math.PI * 0.3), 5);
    expect(tyreRumbleVoice({ vibration: false, failed: true, speedMs: 30, wheelRadiusM: 0.3 }).gain).toBeGreaterThan(v.gain);
  });
});
