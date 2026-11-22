import { describe, expect, test } from "bun:test";
import { libraryCar } from "../../src/data/vehicle-library.ts";
import { evTuningOf, maxTuning } from "../../src/data/ev-tuning.ts";
import { EV_TUNING_KEY, clearEvTuning, loadEvTuning, saveEvTuning } from "../../src/ui/ev-tuning-store.ts";

// E-Tuner (#108): the tuning is stored per vehicle.
function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("E-Tuner storage", () => {
  const plaid = libraryCar("ev-tesla-model-s-plaid");
  const id3 = libraryCar("ev-vw-id3-pro-performance");
  test("per vehicle: save, load, clear", () => {
    const st = mem();
    expect(loadEvTuning(plaid, st)).toBeNull();
    saveEvTuning(plaid.id, maxTuning(), st);
    expect(loadEvTuning(plaid, st)).toEqual(maxTuning());
    expect(loadEvTuning(id3, st)).toBeNull();
    clearEvTuning(plaid.id, st);
    expect(loadEvTuning(plaid, st)).toBeNull();
  });
  test("broken or edited records are repaired, combustion cars have none", () => {
    const st = mem();
    st.setItem(EV_TUNING_KEY, JSON.stringify({ [plaid.id]: { frontMotors: 9, cRate: "x", tyre: 3 } }));
    const t = loadEvTuning(plaid, st)!;
    const f = evTuningOf(plaid.setup.ev!, plaid.setup.tyre.type);
    expect(t.frontMotors + t.rearMotors).toBeLessThanOrEqual(8);
    expect(t.cRate).toBe(f.cRate);
    expect(t.tyre).toBe(f.tyre);
    st.setItem(EV_TUNING_KEY, "{oops");
    expect(loadEvTuning(plaid, st)).toBeNull();
    expect(loadEvTuning(libraryCar("car-vw-golf7-gti"), st)).toBeNull();
  });
});
