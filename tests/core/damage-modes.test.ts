// Realism level SimInputs.damage (issue #66): "real" destroys, "lenient" warns only, "off" counts no wear.
import { describe, expect, test } from "bun:test";
import { EngineSimulator, defaultInputs } from "../../src/core/index.ts";
import type { EngineConfig, EngineState, SimInputs } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";

/** Same knock-prone petrol engine as physics-core "destroyed engine stops": dies within 30 s at full load. */
function fragile(): EngineConfig {
  const c = defaultConfig("petrol");
  c.block.compressionRatio = 11;
  c.induction.boostTargetBar = 1.6;
  if (c.fuelSystem.kind === "petrol") {
    c.fuelSystem.fuel = "ron91";
    c.fuelSystem.mixture = "carburettor";
    c.fuelSystem.ignitionAdvanceOffsetDeg = 10;
  }
  return c;
}

function abuse(damage: SimInputs["damage"]): { last: EngineState; criticals: Set<string> } {
  const sim = new EngineSimulator(fragile());
  const dt = 1 / 60;
  const base = { ...defaultInputs(), ...(damage ? { damage } : {}) };
  for (let i = 0; i < 120; i++) sim.step(dt, { ...base, ignition: true, starter: true });
  const criticals = new Set<string>();
  let last = sim.state;
  for (let i = 0; i < 30 * 60; i++) {
    last = sim.step(dt, { ...base, ignition: true, pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: 3000 });
    for (const w of last.warnings) if (w.severity === "critical") criticals.add(w.message);
  }
  return { last, criticals };
}

describe("realism level (SimInputs.damage)", () => {
  test("default (field missing) and 'real' destroy the engine", () => {
    for (const mode of [undefined, "real"] as const) {
      const { last } = abuse(mode);
      expect(last.destroyed).toBe(true);
      expect(last.damage.length).toBe(1);
      expect(last.running).toBe(false);
    }
  }, 60_000);

  test("'lenient': warnings and wear, but the engine keeps running", () => {
    const { last, criticals } = abuse("lenient");
    expect(last.destroyed).toBe(false);
    expect(last.damage).toEqual([]);
    expect(last.running).toBe(true);
    expect(last.wear).toBeGreaterThan(0);
    expect(last.wear).toBeLessThan(1);
    expect([...criticals].some((m) => m.startsWith("Im Modus „Realistisch“ wäre der Motor jetzt kaputt"))).toBe(true);
  }, 60_000);

  test("'off': no wear and no damage, warnings still shown", () => {
    const { last } = abuse("off");
    expect(last.destroyed).toBe(false);
    expect(last.damage).toEqual([]);
    expect(last.running).toBe(true);
    expect(last.wear).toBe(0);
    expect(last.warnings.length).toBeGreaterThan(0);
  }, 60_000);
});
