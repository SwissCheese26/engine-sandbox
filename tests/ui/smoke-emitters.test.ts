// Rauch/Dampf: emitter logic (src/ui/smoke-emitters.ts) and the "Effekte" setting.
import { expect, test } from "bun:test";
import { MAX_RATE, emission, emissionRate, isIdle, slideSpeedMs, spawnCount, TYRE_FULL_SLIDE_MS, type SmokeInput } from "../../src/ui/smoke-emitters.ts";
import { DEFAULT_SETTINGS, validateSettings } from "../../src/ui/settings.ts";

const base: SmokeInput = {
  running: true, vehicle: true, vehicleSpeedMs: 10, wheelSlip: 0.02, wheelSpin: false, wheelsLocked: false, brakeSlip: 0,
  liquidCooled: true, coolantC: 90, coolantMaxC: 110, oilC: 100, oilMaxC: 135, warnings: [], damaged: false,
  diesel: false, smoke: 0, smokeMax: 0.5,
};

test("idle: a healthy engine at normal temperature emits nothing", () => {
  const e = emission(base);
  expect(e).toEqual({ tyre: 0, steam: 0, oilSmoke: 0, exhaust: 0 });
  expect(emissionRate(e)).toBe(0);
  expect(isIdle(e)).toBe(true);
  // engine off, cold, engine dyno: also nothing
  expect(isIdle(emission({ ...base, running: false, vehicle: false, coolantC: 20, oilC: 20 }))).toBe(true);
});

test("tyre smoke: gated by the core's spin flag, scales with slip × speed", () => {
  // slip without the spin flag (normal driving slip) gives no smoke
  expect(emission({ ...base, wheelSlip: 0.08 }).tyre).toBe(0);
  const slow = emission({ ...base, wheelSpin: true, wheelSlip: 0.3, vehicleSpeedMs: 5 }).tyre;
  const fast = emission({ ...base, wheelSpin: true, wheelSlip: 0.6, vehicleSpeedMs: 5 }).tyre;
  expect(slow).toBeGreaterThan(0);
  expect(fast).toBeGreaterThan(slow);
  // burnout at standstill: slip is relative to max(v, 1 m/s) → wheel speed over the road
  expect(slideSpeedMs({ ...base, wheelSpin: true, wheelSlip: 8, vehicleSpeedMs: 0 })).toBeCloseTo(8, 6);
  expect(emission({ ...base, wheelSpin: true, wheelSlip: 20, vehicleSpeedMs: 0 }).tyre).toBe(1);
  expect(emission({ ...base, wheelSpin: true, wheelSlip: TYRE_FULL_SLIDE_MS / 2, vehicleSpeedMs: 0 }).tyre).toBeCloseTo(0.5, 6);
  // tiny slide: no visible smoke
  expect(emission({ ...base, wheelSpin: true, wheelSlip: 0.2, vehicleSpeedMs: 0 }).tyre).toBe(0);
  // engine dyno: no tyres
  expect(emission({ ...base, vehicle: false, wheelSpin: true, wheelSlip: 5 }).tyre).toBe(0);
});

test("tyre smoke: locked wheels skid at road speed", () => {
  const e = emission({ ...base, wheelsLocked: true, brakeSlip: -1, vehicleSpeedMs: 20 });
  expect(e.tyre).toBe(1);
  expect(emission({ ...base, wheelsLocked: true, brakeSlip: -1, vehicleSpeedMs: 3 }).tyre).toBeCloseTo(3 / TYRE_FULL_SLIDE_MS, 6);
  // stopped: nothing slides
  expect(emission({ ...base, wheelsLocked: true, brakeSlip: -1, vehicleSpeedMs: 0 }).tyre).toBe(0);
});

test("steam: from the coolant lamp threshold, denser on boil-over or damage", () => {
  expect(emission({ ...base, coolantC: 109 }).steam).toBe(0);
  const light = emission({ ...base, coolantC: 111 }).steam;
  expect(light).toBeGreaterThan(0);
  expect(light).toBeLessThan(0.5);
  // the warning alone lights the lamp, so it steams too
  expect(emission({ ...base, warnings: [{ code: "overheat-coolant", severity: "warning" }] }).steam).toBeGreaterThan(0);
  const boil = emission({ ...base, coolantC: 121, warnings: [{ code: "overheat-coolant", severity: "critical" }] }).steam;
  expect(boil).toBe(1);
  expect(emission({ ...base, coolantC: 112, damaged: true }).steam).toBe(1);
  // air-cooled: no coolant, no steam
  expect(emission({ ...base, liquidCooled: false, coolantC: 200, coolantMaxC: 110 }).steam).toBe(0);
  // still boiling after the engine stopped
  expect(emission({ ...base, running: false, coolantC: 115 }).steam).toBeGreaterThan(0);
});

test("oil smoke: critical oil temperature or engine damage", () => {
  expect(emission({ ...base, oilC: 140, warnings: [{ code: "overheat-oil", severity: "warning" }] }).oilSmoke).toBe(0);
  expect(emission({ ...base, oilC: 152, warnings: [{ code: "overheat-oil", severity: "critical" }] }).oilSmoke).toBeGreaterThan(0);
  expect(emission({ ...base, damaged: true }).oilSmoke).toBeGreaterThan(0);
  // a damaged engine that stopped and cooled down no longer smokes
  expect(emission({ ...base, damaged: true, running: false, oilC: 60 }).oilSmoke).toBe(0);
});

test("exhaust: only diesel smoke above the yellow mark of the smoke meter", () => {
  expect(emission({ ...base, diesel: true, smoke: 0.4 }).exhaust).toBe(0);
  expect(emission({ ...base, diesel: true, smoke: 0.7 }).exhaust).toBeGreaterThan(0);
  expect(emission({ ...base, diesel: false, smoke: 0.9 }).exhaust).toBe(0);
  expect(emission({ ...base, diesel: true, smoke: 0.9, running: false }).exhaust).toBe(0);
});

test("rate: sum of the emitter strengths, zero when idle", () => {
  expect(emissionRate({ tyre: 1, steam: 0, oilSmoke: 0, exhaust: 0 })).toBe(MAX_RATE.tyre);
  expect(emissionRate({ tyre: 0.5, steam: 1, oilSmoke: 0, exhaust: 0 })).toBe(MAX_RATE.tyre / 2 + MAX_RATE.steam);
  const burnout = emissionRate(emission({ ...base, wheelSpin: true, wheelSlip: 15, vehicleSpeedMs: 0 }));
  expect(burnout).toBeGreaterThan(0);
});

test("spawnCount carries fractions, nothing at rate 0", () => {
  expect(spawnCount(0, 1 / 60, 0.9)).toEqual([0, 0]);
  let carry = 0;
  let total = 0;
  for (let i = 0; i < 60; i++) {
    const [n, c] = spawnCount(30, 1 / 60, carry);
    total += n;
    carry = c;
  }
  expect(total).toBeGreaterThanOrEqual(29);
  expect(total).toBeLessThanOrEqual(30);
});

test("setting Effekte (Rauch/Dampf): on by default, validated", () => {
  expect(DEFAULT_SETTINGS.effects).toBe(true);
  expect(validateSettings({}).effects).toBe(true);
  expect(validateSettings({ effects: false }).effects).toBe(false);
  expect(validateSettings({ effects: "nein" }).effects).toBe(true);
});

test("tyre smoke grows with the tread temperature (issue #149); without one it follows the sliding speed alone", () => {
  const spin = { ...base, vehicle: true, vehicleSpeedMs: 0, wheelSlip: 20, wheelSpin: true };
  const full = emission(spin).tyre;
  const cold = emission({ ...spin, tyreTreadC: 20 }).tyre;
  const hot = emission({ ...spin, tyreTreadC: 220 }).tyre;
  expect(full).toBeGreaterThan(0.9);
  expect(cold).toBeLessThan(0.5 * hot);
  expect(cold).toBeGreaterThan(0);
  expect(hot).toBeCloseTo(full, 5);
});
