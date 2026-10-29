// Calibration against the reference engines (docs/research/diesel.md §5, docs/research/petrol.md §7).
// Spec: peak torque and peak power within ±10 % (lead decision; research proposed ±7 % / ±10 %),
// rpm of the peaks within ±25 % (test-team tolerance: plateau engines and the cam/resonance model
// shift the exact peak; petrol.md §3.2 itself reports ~8 % deviations of the VE peak).
//
// All cases run against the placeholder physics on main and are therefore expected to fail:
// scharf schalten nach Integration (#3/#4) – replace `test.failing` by `test`.
import { describe, expect, test } from "bun:test";
import { REFERENCE_DIESELS, REFERENCE_ENGINES, REFERENCE_PETROLS } from "../../src/data/reference-engines.ts";
import type { ReferenceEngine } from "../../src/data/reference-engines.ts";
import { sweepAt, sweepPeaks } from "./helpers.ts";

const VALUE_TOL = 0.1;
const RPM_TOL = 0.25;
/** A point counts as "on the plateau" if it reaches this fraction of the model's own peak. */
const PLATEAU = 0.98;

function within(actual: number, expected: number, tol: number): boolean {
  return Math.abs(actual - expected) <= tol * expected;
}

function describeMiss(ref: ReferenceEngine, what: string, actual: number, expected: number, unit: string) {
  return `${ref.config.name}: ${what} ${actual.toFixed(1)} ${unit}, expected ${expected} ${unit} (source: ${ref.source})`;
}

/**
 * Peak rpm check that tolerates torque/power plateaus: passes when the model's peak lies within
 * ±25 % of the data-sheet rpm, or when the model is still on its own plateau at the data-sheet rpm.
 */
function peakRpmOk(points: ReturnType<typeof sweepPeaks>["points"], key: "torqueNm" | "powerKw", peakRpm: number, peakValue: number, expectedRpm: number) {
  if (within(peakRpm, expectedRpm, RPM_TOL)) return true;
  return sweepAt(points, expectedRpm, key) >= PLATEAU * peakValue;
}

describe("reference engine data", () => {
  // These are pure data checks on src/data/reference-engines.ts – they pass on main.
  test("at least 4 diesel and 5 petrol reference engines", () => {
    expect(REFERENCE_DIESELS.length).toBeGreaterThanOrEqual(4);
    expect(REFERENCE_PETROLS.length).toBeGreaterThanOrEqual(5);
  });
  test("ids are unique and fuel kinds are consistent", () => {
    const ids = new Set(REFERENCE_ENGINES.map((r) => r.config.id));
    expect(ids.size).toBe(REFERENCE_ENGINES.length);
    for (const r of REFERENCE_ENGINES) expect(r.config.fuelSystem.kind).toBe(r.config.fuel);
  });
  test("expected values are consistent: P = M·ω never exceeds the peaks", () => {
    for (const r of REFERENCE_ENGINES) {
      const e = r.expected;
      // power at the torque peak cannot be higher than peak power
      const pAtTorquePeak = (e.peakTorqueNm * e.peakTorqueRpm * 2 * Math.PI) / 60000;
      expect(pAtTorquePeak).toBeLessThanOrEqual(e.peakPowerKw * 1.001);
      // torque at the power peak cannot be higher than peak torque
      const mAtPowerPeak = (e.peakPowerKw * 60000) / (2 * Math.PI * e.peakPowerRpm);
      expect(mAtPowerPeak).toBeLessThanOrEqual(e.peakTorqueNm * 1.001);
      expect(e.peakPowerRpm).toBeLessThanOrEqual(r.config.revLimitRpm);
    }
  });
  test("bmep at the torque peak lies in the bands of the specs", () => {
    for (const r of REFERENCE_ENGINES) {
      const b = r.config.block;
      const vh = (Math.PI / 4) * (b.boreMm / 1000) ** 2 * (b.strokeMm / 1000) * b.cylinders;
      const bmep = (r.expected.peakTorqueNm * 4 * Math.PI) / vh / 1e5;
      // diesel.md §5: 12 … 26 bar; petrol.md §3.9: NA 11 … 14.5, turbo DI 18 … 25
      expect(bmep).toBeGreaterThan(10);
      expect(bmep).toBeLessThan(27);
    }
  });
});

/**
 * Cases that the placeholder physics on main happens to hit by chance (crude constant-bmep model).
 * They run as normal tests so that `test.failing` does not report "passed unexpectedly". Everything
 * else is `test.failing` until the real physics lands. After integration (#3/#4) delete this set and
 * use plain `test` for every case.
 */
const PLACEHOLDER_HITS = new Set([
  "ref-vw-19-tdi-pd-96kw:torque",
  "ref-bmw-n57d30o1:torque",
  "ref-mercedes-om654-220d:torque",
  "ref-mercedes-om654-220d:power",
  "ref-psa-16-hdi-dv6ted4:power",
  "ref-gm-ls3-62:torque",
  "ref-gm-ls3-62:power",
]);
const calib = (id: string, kind: "torque" | "power") => (PLACEHOLDER_HITS.has(`${id}:${kind}`) ? test : test.failing);

describe("dynoSweep hits the reference engines (±10 % value, ±25 % rpm)", () => {
  for (const ref of REFERENCE_ENGINES) {
    // scharf schalten nach Integration (#3/#4)
    calib(ref.config.id, "torque")(`${ref.config.name}: peak torque ${ref.expected.peakTorqueNm} Nm @ ${ref.expected.peakTorqueRpm}`, () => {
      const s = sweepPeaks(ref.config, { fromRpm: 1000 });
      const msg = describeMiss(ref, "peak torque", s.torque.torqueNm, ref.expected.peakTorqueNm, "Nm");
      expect(within(s.torque.torqueNm, ref.expected.peakTorqueNm, VALUE_TOL), msg).toBe(true);
      expect(
        peakRpmOk(s.points, "torqueNm", s.torque.rpm, s.torque.torqueNm, ref.expected.peakTorqueRpm),
        describeMiss(ref, "torque peak rpm", s.torque.rpm, ref.expected.peakTorqueRpm, "1/min"),
      ).toBe(true);
    });

    // scharf schalten nach Integration (#3/#4)
    calib(ref.config.id, "power")(`${ref.config.name}: peak power ${ref.expected.peakPowerKw} kW @ ${ref.expected.peakPowerRpm}`, () => {
      const s = sweepPeaks(ref.config, { fromRpm: 1000 });
      const msg = describeMiss(ref, "peak power", s.power.powerKw, ref.expected.peakPowerKw, "kW");
      expect(within(s.power.powerKw, ref.expected.peakPowerKw, VALUE_TOL), msg).toBe(true);
      expect(
        peakRpmOk(s.points, "powerKw", s.power.rpm, s.power.powerKw, ref.expected.peakPowerRpm),
        describeMiss(ref, "power peak rpm", s.power.rpm, ref.expected.peakPowerRpm, "1/min"),
      ).toBe(true);
    });
  }
});
