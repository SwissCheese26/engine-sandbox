// Issue #91: Auto-Hold setting, parking-brake lamp and the gear-plate hint.
import { expect, test } from "bun:test";
import { BULB_CHECK_S, clusterLamps, type LampInput } from "../../src/ui/layouts/logic.ts";
import { DEFAULT_SETTINGS, validateSettings } from "../../src/ui/settings.ts";
import { GEAR_HELD_HINT, GEAR_LOCKED_HINT, gearLockHint } from "../../src/ui/gear-plate.ts";
import { ICON, parkLampLabel } from "../../src/ui/environment-panel.ts";

const base: LampInput = {
  ignition: true, running: true, sinceIgnitionS: 10, diesel: false, coolantC: 90, coolantMaxC: 110, oilPressureBar: 2.5,
  damaged: false, warnings: [], abs: { enabled: true, active: false }, esp: { esp: true, asr: true, active: false }, ice: false,
};

test("settings: Auto-Hold defaults on, a stored boolean is kept, junk falls back to on", () => {
  expect(DEFAULT_SETTINGS.autoHold).toBe(true);
  expect(validateSettings({}).autoHold).toBe(true);
  expect(validateSettings({ autoHold: false }).autoHold).toBe(false);
  expect(validateSettings({ autoHold: true }).autoHold).toBe(true);
  for (const junk of ["no", 0, 1, null, {}, []]) expect(validateSettings({ autoHold: junk }).autoHold).toBe(true);
});

test("lamp: red (P) while the parking brake is applied, dark when released or on the engine dyno", () => {
  expect(clusterLamps({ ...base, parkingBrake: true }).park).toBe("on");
  expect(clusterLamps({ ...base, parkingBrake: false }).park).toBe("off");
  expect(clusterLamps({ ...base, parkingBrake: undefined }).park).toBe("off");
  expect(clusterLamps({ ...base, ignition: false, parkingBrake: true }).park).toBe("off");
  // bulb check lights it on the chassis dyno only
  expect(clusterLamps({ ...base, running: false, sinceIgnitionS: 0.5, parkingBrake: false }).park).toBe("on");
  expect(clusterLamps({ ...base, running: false, sinceIgnitionS: 0.5 }).park).toBe("off");
  expect(clusterLamps({ ...base, running: false, sinceIgnitionS: BULB_CHECK_S + 1, parkingBrake: false }).park).toBe("off");
});

test("lamp symbol and labels", () => {
  expect(ICON.park).toContain("<svg");
  expect(ICON.park).toContain("circle");
  expect(parkLampLabel(true, true)).toBe("Feststellbremse angezogen");
  expect(parkLampLabel(false, true)).toMatch(/Auto-Hold bereit/);
  expect(parkLampLabel(false, false)).toMatch(/Auto-Hold aus/);
});

test("gear plate hint: locked → stop or N; held → editable; otherwise none", () => {
  expect(gearLockHint(false, false)).toBe(GEAR_LOCKED_HINT);
  expect(GEAR_LOCKED_HINT).toBe("Anhalten (Handbremse) oder N");
  expect(gearLockHint(true, true)).toBe(GEAR_HELD_HINT);
  expect(GEAR_HELD_HINT).toBe("Handbremse aktiv – Übersetzungen änderbar");
  expect(gearLockHint(true, false)).toBe("");
});
