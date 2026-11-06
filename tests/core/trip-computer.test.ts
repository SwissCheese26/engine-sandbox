import { describe, expect, test } from "bun:test";
import { TripComputer, averageKmh, averageL100 } from "../../src/core/trip-computer.ts";
import type { EngineState } from "../../src/core/index.ts";

const state = (kmh: number, lh: number, running = true) =>
  ({ running, vehicleSpeedMs: kmh / 3.6, fuelFlowLh: lh }) as unknown as EngineState;

describe("trip computer (#40, #41)", () => {
  test("1 h at 100 km/h and 6 l/h → 100 km, 6 l/100 km, Ø 100 km/h in total and trip A", () => {
    const t = new TripComputer();
    for (let i = 0; i < 3600 * 10; i++) t.step(0.1, state(100, 6), true);
    for (const c of [t.data.total, t.data.tripA]) {
      expect(c.km).toBeCloseTo(100, 3);
      expect(averageL100(c)).toBeCloseTo(6, 3);
      expect(averageKmh(c)).toBeCloseTo(100, 3);
    }
  });

  test("trip A resets, total does not; nothing counts on the engine dyno or with the engine off", () => {
    const t = new TripComputer();
    for (let i = 0; i < 600; i++) t.step(0.1, state(60, 5), true);
    t.resetTripA();
    expect(t.data.tripA.km).toBe(0);
    expect(t.data.total.km).toBeCloseTo(1, 3);
    t.step(1, state(100, 8), false); // engine dyno
    t.step(1, state(100, 8, false), true); // engine off
    t.step(Number.NaN, state(100, 8), true);
    t.step(0.1, { running: true, vehicleSpeedMs: Number.NaN, fuelFlowLh: Number.NaN } as unknown as EngineState, true);
    expect(t.data.total.km).toBeCloseTo(1, 3);
    expect(Number.isFinite(t.data.total.fuelL)).toBe(true);
  });

  test("average is NaN until 0.1 km; persistence round trip validates input", () => {
    const t = new TripComputer();
    t.step(0.5, state(50, 4), true);
    expect(Number.isNaN(averageL100(t.data.tripA))).toBe(true);
    const back = TripComputer.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
    expect(back.data.total.km).toBeCloseTo(t.data.total.km, 9);
    const bad = TripComputer.fromJSON({ total: { km: -5, fuelL: "x" }, tripA: null });
    expect(bad.data.total.km).toBe(0);
    expect(bad.data.tripA.timeS).toBe(0);
  });
});
