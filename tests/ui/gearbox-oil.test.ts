// Issue #53: gearbox oil temperature in the UI – toast (calm setting), cockpit lamp and digital field.
import { describe, expect, test } from "bun:test";
import type { EngineState } from "../../src/core/index.ts";
import { gearboxOilNote, toastInputs } from "../../src/ui/toasts.ts";
import { clusterLamps, type LampInput } from "../../src/ui/layouts/logic.ts";
import { fieldAvailable, formatField, type FieldInputs } from "../../src/ui/layouts/fields-logic.ts";
import { FIELD_IDS } from "../../src/ui/layouts/designs.ts";
import { PRESETS } from "../../src/ui/settings.ts";

const quiet = { state: { destroyed: false, damage: [], warnings: [] } as unknown as EngineState, outOfFuel: false };
const gb = (x: { warn?: boolean; protect?: boolean; failed?: boolean }) => ({
  gearboxOilWarn: !!x.warn, gearboxProtect: !!x.protect, gearboxFailed: !!x.failed,
});

describe("gearbox oil toast", () => {
  test("hot oil follows the calm setting, protection mode and failure always show", () => {
    expect(toastInputs({ ...quiet, gearbox: gb({}) })).toEqual([]);
    const hot = toastInputs({ ...quiet, gearbox: gb({ warn: true }) });
    expect(hot).toHaveLength(1);
    expect(hot[0]).toMatchObject({ key: "gearbox-hot", severity: "warning" });
    expect(hot[0]!.always).toBeFalsy();
    const prot = toastInputs({ ...quiet, gearbox: gb({ warn: true, protect: true }) });
    expect(prot.map((t) => t.key)).toEqual(["gearbox-protect"]);
    expect(prot[0]!.always).toBe(true);
    expect(toastInputs({ ...quiet, gearbox: gb({ warn: true, failed: true }) })[0]).toMatchObject({ key: "gearbox-failed", severity: "critical", always: true });
    // engine dyno: no gearbox
    expect(toastInputs(quiet)).toEqual([]);
  });

  test("note text per state", () => {
    expect(gearboxOilNote(gb({}))).toBe("");
    expect(gearboxOilNote(gb({ warn: true }))).toMatch(/heiß/);
    expect(gearboxOilNote(gb({ protect: true }))).toMatch(/Notlauf/);
    expect(gearboxOilNote(gb({ failed: true }))).toMatch(/Getriebeschaden/);
  });
});

describe("gearbox lamp", () => {
  const base: LampInput = {
    ignition: true, running: true, sinceIgnitionS: 10, diesel: false, coolantC: 90, coolantMaxC: 110, oilPressureBar: 2.5,
    damaged: false, warnings: [],
  };
  const g = (x: { hot?: boolean; protect?: boolean; failed?: boolean }) => ({ hot: !!x.hot, protect: !!x.protect, failed: !!x.failed });

  test("dark on the engine dyno, also in the bulb check; on the chassis dyno part of the bulb check", () => {
    expect(clusterLamps({ ...base, running: false, sinceIgnitionS: 0.5 }).gearbox).toBe("off");
    expect(clusterLamps({ ...base, running: false, sinceIgnitionS: 0.5, gearbox: g({}) }).gearbox).toBe("on");
  });

  test("off when cool, on when hot, blinking in the protection mode, on after a failure", () => {
    expect(clusterLamps({ ...base, gearbox: g({}) }).gearbox).toBe("off");
    expect(clusterLamps({ ...base, gearbox: g({ hot: true }) }).gearbox).toBe("on");
    expect(clusterLamps({ ...base, gearbox: g({ hot: true, protect: true }) }).gearbox).toBe("blink");
    expect(clusterLamps({ ...base, gearbox: g({ hot: true, failed: true }) }).gearbox).toBe("on");
  });
});

describe("digital cockpit field 'Getriebeöl'", () => {
  const v = { gearboxOilC: 92, gearboxOilWarn: false } as FieldInputs;

  test("selectable on the chassis dyno only", () => {
    expect(FIELD_IDS).toContain("gearOil");
    expect(fieldAvailable("gearOil", { turbo: false, vehicle: true })).toBe(true);
    expect(fieldAvailable("gearOil", { turbo: true, vehicle: false })).toBe(false);
  });

  test("value in the chosen temperature unit, signal colour from the warning", () => {
    expect(formatField("gearOil", v, PRESETS["metric-kw"].units)).toEqual({ label: "Getriebeöl", value: "92", unit: "°C", warn: false });
    expect(formatField("gearOil", v, PRESETS.imperial.units)).toMatchObject({ value: "198", unit: "°F" });
    expect(formatField("gearOil", { ...v, gearboxOilC: 124, gearboxOilWarn: true }, PRESETS["metric-kw"].units).warn).toBe(true);
    expect(formatField("gearOil", {} as FieldInputs, PRESETS["metric-kw"].units).value).toBe("–");
  });
});
