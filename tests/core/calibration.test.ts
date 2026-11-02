// Calibration against the reference engines (docs/research/diesel.md §5, docs/research/petrol.md §7).
// Spec: peak torque and peak power within ±10 % (lead decision; research proposed ±7 % / ±10 %),
// rpm of the peaks within ±12 % (petrol.md §7; plateau engines are handled by peakRpmOk()).
//
// All cases run against the placeholder physics on main and are therefore expected to fail:
// scharf schalten nach Integration (#3/#4) – replace `test.failing` by `test`.
import { describe, expect, test } from "bun:test";
import { REFERENCE_DIESELS, REFERENCE_ENGINES, REFERENCE_PETROLS } from "../../src/data/reference-engines.ts";
import type { ReferenceEngine } from "../../src/data/reference-engines.ts";
import { sweepAt, sweepPeaks } from "./helpers.ts";

const VALUE_TOL = 0.1;
const RPM_TOL = 0.12;
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
 * ±12 % of the data-sheet rpm, or when the model is still on its own plateau at the data-sheet rpm.
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
 * Known calibration gaps after integration (#3). All other cases are sharp.
 * EA888: the reference config asks for 1.3 bar; the mean value model turns that into bmep ≈ 26 bar,
 * the data-sheet 350 Nm plateau is an ECU torque limit the config cannot express (petrol.md §3.8 / §7).
 * The model hits 350 Nm at ≈ 0.9 bar. See PR "Mittelwertmodell Diesel & Benziner".
 */
const KNOWN_GAPS = new Set(["ref-vw-ea888-gen3-chhb:torque", "ref-vw-ea888-gen3-chhb:power"]);
const calib = (id: string, kind: "torque" | "power") => (KNOWN_GAPS.has(`${id}:${kind}`) ? test.failing : test);

describe("dynoSweep hits the reference engines (±10 % value, ±12 % rpm)", () => {
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
