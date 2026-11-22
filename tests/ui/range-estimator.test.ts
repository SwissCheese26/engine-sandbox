import { describe, expect, test } from "bun:test";
import { MIN_KWH_PER_100, MIN_L_PER_100, RangeEstimator, packKwhLeft, ratedLPer100 } from "../../src/ui/range-estimator.ts";

/** Drives `km` at constant speed and battery power, 0.1 s steps. */
function drive(r: RangeEstimator, kmh: number, kw: number, seconds: number) {
  for (let t = 0; t < seconds; t += 0.1) r.step(0.1, kw, kmh);
}

describe("RangeEstimator, electric (live EV range, #108)", () => {
  test("starts at the rated consumption: SoC × usable kWh ÷ rated", () => {
    const r = new RangeEstimator(20, "electric");
    expect(r.per100).toBeCloseTo(20, 6);
    expect(r.rangeKm(packKwhLeft(0.9, 100))).toBeCloseTo(450, 3);
    expect(r.rangeKm(packKwhLeft(0.5, 100))).toBeCloseTo(250, 3);
  });

  test("follows the driven consumption within the window", () => {
    const r = new RangeEstimator(18);
    // 100 km/h at 30 kW = 30 kWh/100 km for 12 min (20 km)
    drive(r, 100, 30, 720);
    expect(r.per100).toBeGreaterThan(28.5);
    expect(r.per100).toBeLessThan(30.5);
    expect(r.rangeKm(packKwhLeft(0.8, 100))).toBeLessThan(290);
  });

  test("hard driving lowers the range, calm driving brings it back", () => {
    const r = new RangeEstimator(18);
    drive(r, 150, 60, 300); // 40 kWh/100 km
    const hard = r.rangeKm(packKwhLeft(0.8, 100));
    drive(r, 80, 10, 600); // 12.5 kWh/100 km
    expect(r.rangeKm(packKwhLeft(0.8, 100))).toBeGreaterThan(hard * 1.5);
  });

  test("regen raises the range a little, without a jump", () => {
    const r = new RangeEstimator(18);
    drive(r, 100, 20, 600);
    let prev = r.rangeKm(packKwhLeft(0.7, 100));
    let maxStep = 0;
    for (let t = 0; t < 20; t += 0.1) {
      r.step(0.1, -80, 80); // strong regen
      const now = r.rangeKm(packKwhLeft(0.7, 100));
      maxStep = Math.max(maxStep, Math.abs(now - prev));
      prev = now;
    }
    expect(prev).toBeGreaterThan(350);
    expect(maxStep).toBeLessThan(1);
  });

  test("never below the consumption floor, finite at standstill", () => {
    const r = new RangeEstimator(18);
    drive(r, 60, -50, 600); // long downhill with regen
    expect(r.per100).toBeCloseTo(MIN_KWH_PER_100, 3);
    drive(r, 0, 1, 3600); // an hour parked with the air-con on
    expect(Number.isFinite(r.rangeKm(packKwhLeft(0.5, 80)))).toBe(true);
    expect(r.rangeKm(packKwhLeft(0.5, 80))).toBeGreaterThan(0);
  });
});

/** Drives at constant speed and fuel flow (l/h), 0.1 s steps. */
function burn(r: RangeEstimator, kmh: number, lh: number, seconds: number) {
  for (let t = 0; t < seconds; t += 0.1) r.step(0.1, lh, kmh);
}

describe("RangeEstimator, fuel (live range of combustion vehicles)", () => {
  test("starts at the rated consumption: tank litres ÷ rated l/100 km", () => {
    const r = new RangeEstimator(6, "fuel");
    expect(r.per100).toBeCloseTo(6, 6);
    expect(r.rangeKm(45)).toBeCloseTo(750, 3);
  });

  test("follows the driven consumption: 100 km/h at 8 l/h = 8 l/100 km", () => {
    const r = new RangeEstimator(6, "fuel");
    burn(r, 100, 8, 720);
    expect(r.per100).toBeGreaterThan(7.6);
    expect(r.per100).toBeLessThan(8.1);
    expect(r.rangeKm(40)).toBeGreaterThan(490);
    expect(r.rangeKm(40)).toBeLessThan(530);
  });

  test("updates live without jumps, never negative", () => {
    const r = new RangeEstimator(6, "fuel");
    burn(r, 100, 6, 300);
    let prev = r.rangeKm(30);
    let maxStep = 0;
    for (let t = 0; t < 30; t += 0.1) {
      r.step(0.1, 40, 180); // full throttle: 22 l/100 km momentary
      const now = r.rangeKm(30);
      maxStep = Math.max(maxStep, Math.abs(now - prev));
      prev = now;
    }
    expect(prev).toBeLessThan(500);
    expect(maxStep).toBeLessThan(2);
    expect(r.rangeKm(-1)).toBe(0);
    expect(r.rangeKm(Number.NaN)).toBeNaN();
  });

  test("coasting with fuel cut-off is held at the floor; idling counts", () => {
    const r = new RangeEstimator(6, "fuel");
    burn(r, 90, 0, 900);
    expect(r.per100).toBeCloseTo(MIN_L_PER_100, 2);
    burn(r, 0, 0.8, 3600);
    expect(Number.isFinite(r.rangeKm(20))).toBe(true);
    expect(r.rangeKm(20)).toBeGreaterThan(0);
  });

  test("rated value from the road load: compact car ≈ 5–8 l, truck ≈ 25–40 l", () => {
    const golf = { massKg: 1450, dragCoefficient: 0.3, frontalAreaM2: 2.2, rollingResistance: 0.011 };
    expect(ratedLPer100(golf, "petrol")).toBeGreaterThan(5.5);
    expect(ratedLPer100(golf, "petrol")).toBeLessThan(8);
    expect(ratedLPer100(golf, "diesel")).toBeGreaterThan(4);
    expect(ratedLPer100(golf, "diesel")).toBeLessThan(ratedLPer100(golf, "petrol"));
    const truck = { massKg: 40000, dragCoefficient: 0.55, frontalAreaM2: 10.5, rollingResistance: 0.006 };
    expect(ratedLPer100(truck, "diesel", true)).toBeGreaterThan(25);
    expect(ratedLPer100(truck, "diesel", true)).toBeLessThan(40);
  });
});
