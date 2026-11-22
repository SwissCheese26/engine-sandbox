import { describe, expect, test } from "bun:test";
import { EV_FIELDS, EV_GROUPS, evConsumption, formValue, readForm } from "../../src/ui/ev-fields.ts";
import { MAX_MOTORS, estimateEv, evTuningOf, tuneEv, validTuning } from "../../src/data/ev-tuning.ts";
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
  // Arthur: "4 Motoren kann man nicht auswählen": the clamp took motors off the axle just picked
  const combos: [number, number][] = [];
  for (let f = 0; f <= MAX_MOTORS; f++) for (let r = 0; r <= MAX_MOTORS - f; r++) if (f + r >= 1) combos.push([f, r]);
  test.each(combos)("every real combination is buildable: %i front + %i rear", (f, r) => {
    const vals = Object.fromEntries(EV_FIELDS.map((x) => [x.key, formValue(x, factory)]));
    const t = readForm({ ...vals, frontMotors: String(f), rearMotors: String(r) }, factory);
    expect([t.frontMotors, t.rearMotors]).toEqual([f, r]);
    const tuned = tuneEv(plaid.setup.ev!, t, plaid.setup.vehicle.wheelRadiusM);
    expect(tuned.ev.motors.filter((m) => m.axle === "front").length).toBe(f);
    expect(tuned.ev.motors.filter((m) => m.axle === "rear").length).toBe(r);
    // power stays capped by the pack (C-rate, contactors): more motors never exceed what the battery delivers
    expect(tuned.systemKw).toBeLessThanOrEqual(tuned.ev.motors.reduce((a, m) => a + m.peakPowerKw, 0) + 1e-6);
  });
  test("picking a count keeps it, the other axle gives way (Plaid 1 + 2)", () => {
    const pick = (from: [number, number], key: "frontMotors" | "rearMotors", v: number) => {
      const t = validTuning({ ...factory, frontMotors: from[0], rearMotors: from[1], [key]: v }, factory, key);
      return [t.frontMotors, t.rearMotors];
    };
    expect(pick([1, 2], "rearMotors", 4)).toEqual([0, 4]);
    expect(pick([1, 2], "frontMotors", 4)).toEqual([4, 0]);
    expect(pick([1, 2], "frontMotors", 2)).toEqual([2, 2]);
    expect(pick([2, 2], "frontMotors", 3)).toEqual([3, 1]);
    expect(pick([2, 2], "rearMotors", 3)).toEqual([1, 3]);
    expect(pick([0, 1], "rearMotors", 0)).toEqual([1, 0]);
    expect(pick([1, 0], "frontMotors", 0)).toEqual([0, 1]);
    // without a picked axle (stored values) the larger axle gives way, as before
    expect(validTuning({ ...factory, frontMotors: 4, rearMotors: 4 }, factory)).toMatchObject({ frontMotors: 2, rearMotors: 2 });
  });
  test("a Rimac-style 2 + 2 is traction limited and quicker than front-only 4 + 0", () => {
    const run = (f: number, r: number) => estimateEv(plaid.setup, tuneEv(plaid.setup.ev!, { ...factory, frontMotors: f, rearMotors: r }, plaid.setup.vehicle.wheelRadiusM));
    const awd = run(2, 2);
    const fwd = run(4, 0);
    expect(awd.tractionLimited).toBe(true);
    expect(awd.t100!).toBeLessThan(fwd.t100!);
    // still physical: μ·g caps the launch (semi-slick ≈ 1.3 g at best), no sub-1.5 s sprint
    expect(awd.t100!).toBeGreaterThan(1.5);
  });
  test("consumption shown is the trip average, never negative", () => {
    expect(evConsumption({ tripKwhPer100: 21.4, kwhPer100: -56.2 })).toBe(21.4);
    expect(evConsumption({ tripKwhPer100: -3, kwhPer100: -56.2 })).toBe(0);
    expect(Number.isNaN(evConsumption({ tripKwhPer100: Number.NaN, kwhPer100: 10 }))).toBe(true);
  });
});
