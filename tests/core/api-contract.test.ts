import { describe, expect, test } from "bun:test";
import { EngineSimulator, defaultInputs, displacementL, dynoSweep, summarize } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";

// Contract tests: the public API exists and returns sane shapes. Physics accuracy is tested elsewhere.
describe("core API contract", () => {
  for (const fuel of ["diesel", "petrol"] as const) {
    test(`${fuel}: displacement ≈ 2.0 l`, () => {
      expect(displacementL(defaultConfig(fuel))).toBeCloseTo(2.0, 0);
    });
    test(`${fuel}: dyno sweep returns finite points`, () => {
      const pts = dynoSweep(defaultConfig(fuel));
      expect(pts.length).toBeGreaterThan(5);
      for (const p of pts) {
        expect(Number.isFinite(p.torqueNm)).toBe(true);
        expect(Number.isFinite(p.powerKw)).toBe(true);
      }
    });
    test(`${fuel}: summary has firing intervals summing to 720°`, () => {
      const s = summarize(defaultConfig(fuel));
      expect(s.firingIntervalsDeg.reduce((a, b) => a + b, 0)).toBeCloseTo(720, 5);
    });
    test(`${fuel}: simulator starts and idles`, () => {
      const cfg = defaultConfig(fuel);
      const sim = new EngineSimulator(cfg);
      const input = { ...defaultInputs(), ignition: true, starter: true };
      for (let i = 0; i < 120; i++) sim.step(1 / 60, input);
      input.starter = false;
      for (let i = 0; i < 600; i++) sim.step(1 / 60, input);
      expect(sim.state.running).toBe(true);
      expect(sim.state.rpm).toBeGreaterThan(cfg.idleRpm * 0.6);
      expect(sim.state.rpm).toBeLessThan(cfg.idleRpm * 1.6);
    });
  }
});
