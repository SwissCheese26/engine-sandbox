import { describe, expect, test } from "bun:test";
import { EV_FIELDS, EV_GROUPS, evConsumption, formValue, readForm } from "../../src/ui/ev-fields.ts";
import { evTuningOf } from "../../src/data/ev-tuning.ts";
import { VEHICLE_LIBRARY } from "../../src/data/vehicle-library.ts";

const plaid = VEHICLE_LIBRARY.find((c) => c.id === "ev-tesla-model-s-plaid")!;
const factory = evTuningOf(plaid.setup.ev!, plaid.setup.tyre.type);

describe("Werkbank Elektroantrieb fields (#108)", () => {
  test("every tuning value has exactly one field in a known group", () => {
    expect(EV_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(factory).sort());
    for (const f of EV_FIELDS) expect(EV_GROUPS.some((g) => g.id === f.group)).toBe(true);
  });
  test("no unit is a bare symbol that reads like a stray character", () => {
    for (const f of EV_FIELDS) if (f.kind === "number") expect(f.unit).not.toBe("×");
  });
  test("form round trip keeps the tuning, percent fields scale", () => {
    const vals = Object.fromEntries(EV_FIELDS.map((f) => [f.key, formValue(f, factory)]));
    expect(vals.motorScale).toBe("100");
    expect(readForm(vals, factory)).toEqual(factory);
    expect(readForm({ ...vals, currentScale: "150", highVoltage: "1" }, factory)).toMatchObject({ currentScale: 1.5, highVoltage: true });
  });
  test("motor counts are validated together (1 … 4)", () => {
    const vals = Object.fromEntries(EV_FIELDS.map((f) => [f.key, formValue(f, factory)]));
    const t = readForm({ ...vals, frontMotors: "4", rearMotors: "4" }, factory);
    expect(t.frontMotors + t.rearMotors).toBe(4);
    expect(readForm({ ...vals, frontMotors: "0", rearMotors: "0" }, factory).rearMotors).toBe(1);
  });
  test("consumption shown is the trip average, never negative", () => {
    expect(evConsumption({ tripKwhPer100: 21.4, kwhPer100: -56.2 })).toBe(21.4);
    expect(evConsumption({ tripKwhPer100: -3, kwhPer100: -56.2 })).toBe(0);
    expect(Number.isNaN(evConsumption({ tripKwhPer100: Number.NaN, kwhPer100: 10 }))).toBe(true);
  });
});
