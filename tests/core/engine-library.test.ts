import { describe, expect, test } from "bun:test";
import { summarize, validateConfig } from "../../src/core/index.ts";
import { ENGINE_LIBRARY } from "../../src/data/engine-library.ts";

/**
 * Library engines (#15). Reference engines are held to ±10 % by calibration.test.ts. The further library
 * engines have more estimated construction details, so they get ±15 %. Known larger deviations of the model
 * would be listed in KNOWN (not hidden); currently all fit.
 */
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
});
