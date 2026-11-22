import { describe, expect, test } from "bun:test";
import { MIN_KWH_PER_100, RangeEstimator } from "../../src/ui/ev-range.ts";

/** Drives `km` at constant speed and battery power, 0.1 s steps. */
function drive(r: RangeEstimator, kmh: number, kw: number, seconds: number) {
  for (let t = 0; t < seconds; t += 0.1) r.step(0.1, kw, kmh);
}

describe("RangeEstimator (live EV range, #108)", () => {
  test("starts at the rated consumption: SoC × usable kWh ÷ rated", () => {
    const r = new RangeEstimator(20);
    expect(r.kwhPer100).toBeCloseTo(20, 6);
    expect(r.rangeKm(0.9, 100)).toBeCloseTo(450, 3);
    expect(r.rangeKm(0.5, 100)).toBeCloseTo(250, 3);
  });

  test("follows the driven consumption within the window", () => {
    const r = new RangeEstimator(18);
    // 100 km/h at 30 kW = 30 kWh/100 km for 12 min (20 km)
    drive(r, 100, 30, 720);
    expect(r.kwhPer100).toBeGreaterThan(28.5);
    expect(r.kwhPer100).toBeLessThan(30.5);
    expect(r.rangeKm(0.8, 100)).toBeLessThan(290);
  });

  test("hard driving lowers the range, calm driving brings it back", () => {
    const r = new RangeEstimator(18);
    drive(r, 150, 60, 300); // 40 kWh/100 km
    const hard = r.rangeKm(0.8, 100);
    drive(r, 80, 10, 600); // 12.5 kWh/100 km
    expect(r.rangeKm(0.8, 100)).toBeGreaterThan(hard * 1.5);
  });

  test("regen raises the range a little, without a jump", () => {
    const r = new RangeEstimator(18);
    drive(r, 100, 20, 600);
    let prev = r.rangeKm(0.7, 100);
    let maxStep = 0;
    for (let t = 0; t < 20; t += 0.1) {
      r.step(0.1, -80, 80); // strong regen
      const now = r.rangeKm(0.7, 100);
      maxStep = Math.max(maxStep, Math.abs(now - prev));
      prev = now;
    }
    expect(prev).toBeGreaterThan(350);
    expect(maxStep).toBeLessThan(1);
  });

  test("never below the consumption floor, finite at standstill", () => {
    const r = new RangeEstimator(18);
    drive(r, 60, -50, 600); // long downhill with regen
    expect(r.kwhPer100).toBeCloseTo(MIN_KWH_PER_100, 3);
    drive(r, 0, 1, 3600); // an hour parked with the air-con on
    expect(Number.isFinite(r.rangeKm(0.5, 80))).toBe(true);
    expect(r.rangeKm(0.5, 80)).toBeGreaterThan(0);
  });
});
