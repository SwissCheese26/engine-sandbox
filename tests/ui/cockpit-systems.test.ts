// Cockpit values of the vehicle systems (#83, #105): availability, formatting, gauge scales, lamps, readings.
import { describe, expect, test } from "bun:test";
import { Drivetrain, VehicleSystems, summarize, type EngineState } from "../../src/core/index.ts";
import { REFERENCE_ENGINES } from "../../src/data/reference-engines.ts";
import { gaugeAvailable, gaugeScale, gaugeUnit, gaugeValue } from "../../src/ui/layouts/extras-logic.ts";
import { formatField, type FieldInputs } from "../../src/ui/layouts/fields-logic.ts";
import { clusterLamps, type LampInput } from "../../src/ui/layouts/logic.ts";
import { hasScr, systemReadings } from "../../src/ui/layouts/systems-logic.ts";
import { PRESETS } from "../../src/ui/settings.ts";

const M = PRESETS["metric-kw"].units;
const diesel = REFERENCE_ENGINES.find((e) => e.config.fuel === "diesel")!.config;

describe("fields", () => {
  test("battery, air (with warning), retarder, AdBlue (reserve), lean (direction, grip limit)", () => {
    const v = { batteryV: 14.2, airBar: 5.2, airWarn: true, retarderStage: 3, adblueShare: 0.08, adblueReserve: true, leanDeg: -32.4, leanLimit: false } as FieldInputs;
    expect(formatField("battery", v, M)).toMatchObject({ value: "14,2", unit: "V", warn: false });
    expect(formatField("air", v, M)).toMatchObject({ value: "5,2", unit: "bar", warn: true });
    expect(formatField("retarder", v, M)).toMatchObject({ value: "3", unit: "Stufe" });
    expect(formatField("adblue", v, M)).toMatchObject({ value: "8", unit: "%", warn: true });
    expect(formatField("lean", v, M)).toMatchObject({ value: "32", unit: "° R" });
    expect(formatField("lean", { leanDeg: 10, leanLimit: true } as FieldInputs, M)).toMatchObject({ unit: "° L", warn: true });
    expect(formatField("battery", {} as FieldInputs, M).value).toBe("–");
  });
});

describe("gauges", () => {
  test("only where the vehicle has them", () => {
    const c = { turbo: true };
    for (const id of ["intake", "air", "retarder", "adblue", "lean"] as const) expect(gaugeAvailable(id, c)).toBe(false);
    expect(gaugeAvailable("battery", c)).toBe(true);
    expect(gaugeAvailable("air", { ...c, commercial: true })).toBe(true);
    expect(gaugeAvailable("intake", { ...c, intake: true })).toBe(true);
  });

  test("scales: air 0–12 bar with warning and spring zones, voltmeter doubled at 24 V", () => {
    const lim = summarize(diesel).limits;
    const air = gaugeScale("air", lim, "diesel", M);
    expect(air).toMatchObject({ min: 0, max: 12, zone: { from: 4.5, to: 5.5 }, red: { from: 0, to: 4.5 } });
    expect(gaugeScale("battery", lim, "diesel", M, undefined, 2)).toMatchObject({ min: 16, max: 32 });
    expect(gaugeUnit("air", M)).toBe("bar");
    expect(gaugeValue("adblue", { adblueShare: 0.5 } as never, M)).toBe(50);
  });
});

describe("lamps", () => {
  const base: LampInput = { ignition: true, running: true, sinceIgnitionS: 10, diesel: true, coolantC: 90, coolantMaxC: 110, oilPressureBar: 2.5, damaged: false, warnings: [] };
  test("air below warning red; AdBlue on at reserve, blinking when empty; dark without the system", () => {
    expect(clusterLamps(base)).toMatchObject({ air: "off", adblue: "off" });
    expect(clusterLamps({ ...base, airLow: true }).air).toBe("on");
    expect(clusterLamps({ ...base, adblue: { reserve: true, empty: false } }).adblue).toBe("on");
    expect(clusterLamps({ ...base, adblue: { reserve: true, empty: true } }).adblue).toBe("blink");
    expect(clusterLamps({ ...base, running: false, sinceIgnitionS: 0.5, airLow: false }).air).toBe("on");
  });
});

describe("readings", () => {
  const st = { intakeAirC: 41, vehicleSpeedMs: 20 } as EngineState;
  test("truck on the chassis dyno: air, retarder, AdBlue; engine dyno: none of them", () => {
    const d = new Drivetrain(diesel, summarize(diesel));
    d.setVehicle("truck");
    const sys = new VehicleSystems();
    sys.setKind("truck");
    sys.setRetarderStage(2);
    const r = systemReadings({ s: st, mode: "vehicle", drivetrain: d, systems: sys }, diesel);
    expect(r.has).toEqual({ intake: true, commercial: true, adblue: hasScr(diesel), lean: false, cat: Number.isFinite(st.catalystC ?? Number.NaN) });
    expect(r.airBar).toBe(10);
    expect(r.retarderStage).toBe(2);
    const off = systemReadings({ s: st, mode: "free", drivetrain: d, systems: sys }, diesel);
    expect(off.has.commercial).toBe(false);
    expect(Number.isNaN(off.airBar)).toBe(true);
  });

  test("motorcycle: lean only on a curved route", () => {
    const d = new Drivetrain(diesel, summarize(diesel));
    d.setVehicle("superbike");
    const f = { s: st, mode: "vehicle" as const, drivetrain: d, systems: new VehicleSystems() };
    expect(systemReadings(f, diesel).has.lean).toBe(false);
    d.setEnvironment({ terrain: "alps" });
    const r = systemReadings(f, diesel);
    expect(r.has.lean).toBe(true);
    expect(Number.isFinite(r.leanDeg)).toBe(true);
  });
});
