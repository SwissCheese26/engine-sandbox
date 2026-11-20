import { describe, expect, test } from "bun:test";
import { dynoSweep, summarize, validateConfig } from "../../src/core/index.ts";
import { ENGINE_LIBRARY } from "../../src/data/engine-library.ts";

/**
 * Library engines (#15). Reference engines are held to ±10 % by calibration.test.ts. The further library
 * engines have more estimated construction details, so they get ±15 %. Known larger deviations of the model
 * are listed in KNOWN (not hidden) as test.failing, so a fix shows up.
 */
// Empty since #89: the RB26DETT with its sourced valve timing (camProfile 0.1) makes 216 kW @ 6000 / 386 Nm @ 4700
// with stock turbos and stock boost (docs/research/petrol.md §7a).
const KNOWN: Record<string, string> = {};

describe("engine library", () => {
  test("ids are unique and every entry has maker, cars and source", () => {
    const ids = ENGINE_LIBRARY.map((e) => e.config.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ENGINE_LIBRARY) {
      expect(e.maker.length).toBeGreaterThan(0);
      expect(e.cars.length).toBeGreaterThan(0);
      expect(e.source.length).toBeGreaterThan(0);
    }
  });
  for (const e of ENGINE_LIBRARY.filter((x) => x.config.id.startsWith("lib-"))) {
    const t = KNOWN[e.config.id] ? test.failing : test;
    t(`${e.config.name}: datasheet torque and power within ±15 %`, () => {
      expect(validateConfig(e.config).filter((w) => w.severity === "critical")).toHaveLength(0);
      const s = summarize(e.config);
      expect(Math.abs(s.peakTorqueNm / e.expected.peakTorqueNm - 1)).toBeLessThan(0.15);
      expect(Math.abs(s.peakPowerKw / e.expected.peakPowerKw - 1)).toBeLessThan(0.15);
    });
  }

  // Issue #89: shape of the RB26DETT curve with stock hardware (Nissan: 392 Nm @ 4400, 206 kW @ 6800). The peak rpm
  // itself is ill-conditioned on a flat plateau, so the test checks the plateau like calibration.test.ts.
  test("RB26DETT: torque plateau covers 4400 rpm, full boost by 3500 rpm, power not above the late-engine estimate", () => {
    const e = ENGINE_LIBRARY.find((x) => x.config.id === "lib-nissan-rb26dett")!;
    const pts = dynoSweep(e.config, { fromRpm: 2000, stepRpm: 100 });
    const at = (rpm: number) => pts.find((p) => p.rpm === rpm)!;
    const peak = Math.max(...pts.map((p) => p.torqueNm));
    expect(at(4400).torqueNm).toBeGreaterThanOrEqual(0.98 * peak);
    const peakRpm = pts.find((p) => p.torqueNm === peak)!.rpm;
    expect(Math.abs(peakRpm / 4400 - 1)).toBeLessThan(0.12);
    expect(at(3500).boostBar).toBeGreaterThan(0.65);
    // ≈ 235 kW Wikipedia estimate for late engines is the upper bound; the old model made 244 kW
    expect(Math.max(...pts.map((p) => p.powerKw))).toBeLessThan(235);
  });
});
