import { describe, expect, test } from "bun:test";
import { evSystemPowerKw } from "../../src/core/index.ts";
import { EV_LIBRARY } from "../../src/data/ev-library.ts";
import { VEHICLE_LIBRARY } from "../../src/data/vehicle-library.ts";
import { driveEv } from "./ev-run.ts";

/**
 * Electric cars (issue #108): simulated 0–100 km/h, Vmax and peak power against the factory data.
 * Test driver: ev-run.ts (Ready, mode "Plaid", full pedal, the car's own traction control on). Times published with a
 * 1-ft rollout (Tesla, Lucid: factory.rollout) are compared with the model's time after the first 0.3 m.
 * Documented outliers (docs/research/electric.md §5.3) are pinned to their own band around the measured value and
 * must land within ±12 % on a prepared surface (grip factor 1.15 → μ ≈ 1.32), where the factory times are driven.
 */
const TOL = 0.12;
const KNOWN_0_100_OUTLIERS: Record<string, { expected: number; band: number; reason: string }> = {
  "ev-tesla-model-s-plaid": { expected: 0.21, band: 0.06, reason: "traction: μ 1.15 road tyre vs prepared drag strip (μ ≈ 1.3)" },
  "ev-lucid-air-sapphire": { expected: 0.27, band: 0.06, reason: "traction: μ 1.15 road tyre vs prepared drag strip (μ ≈ 1.3)" },
};

describe("EV library: data", () => {
  test("the seven cars of #108, listed with the cars, sources and specs complete", () => {
    expect(EV_LIBRARY.map((c) => c.id)).toEqual([
      "ev-tesla-model-s-lr", "ev-tesla-model-s-plaid", "ev-tesla-model-x-plaid", "ev-tesla-model-y-performance",
      "ev-lucid-air-sapphire", "ev-vw-id3-pro-performance", "ev-vw-id4-gtx",
    ]);
    for (const c of EV_LIBRARY) {
      expect(VEHICLE_LIBRARY).toContain(c);
      const ev = c.setup.ev!;
      expect(c.engineId).toBe("");
      expect(c.source.length).toBeGreaterThan(30);
      expect(c.setup.vehicle.massKg).toBeGreaterThan(1700);
      expect(c.setup.vehicle.dragCoefficient * c.setup.vehicle.frontalAreaM2).toBeGreaterThan(0.4);
      expect(ev.motors.length).toBeGreaterThanOrEqual(1);
      for (const m of ev.motors) {
        expect(m.ratio).toBeGreaterThan(6);
        expect(m.ratio).toBeLessThan(13);
      }
      expect(c.factory.powerKw).toBeGreaterThan(100);
      expect(c.factory.packKwh).toBeGreaterThan(50);
    }
  });

  test("system power (battery-limited shaft power) within ±5 % of the factory value", () => {
    for (const c of EV_LIBRARY) {
      const p = evSystemPowerKw(c.setup.ev!);
      expect(Math.abs(p / c.factory.powerKw! - 1)).toBeLessThan(0.05);
    }
  });
});

describe("EV library: simulated 0–100, Vmax and peak power vs. factory", () => {
  for (const car of EV_LIBRARY) {
    test(car.name, () => {
      const r = driveEv(car, 45);
      expect(r.t100).not.toBeNull();
      const t = car.factory.rollout ? r.t100Rollout! : r.t100!;
      const dt100 = t / car.factory.t0to100S! - 1;
      // Vmax is software-governed on all of them
      expect(Math.abs(r.vmax / car.factory.vmaxKmh - 1)).toBeLessThan(0.03);
      expect(Math.abs(r.peakKw / car.factory.powerKw! - 1)).toBeLessThan(0.06);
      const out = KNOWN_0_100_OUTLIERS[car.id];
      if (out) {
        expect(Math.abs(dt100 - out.expected)).toBeLessThan(out.band);
        const prepared = driveEv(car, 8, "plaid", 1.15);
        expect(Math.abs(prepared.t100Rollout! / car.factory.t0to100S! - 1)).toBeLessThan(TOL);
      } else {
        expect(Math.abs(dt100)).toBeLessThan(TOL);
      }
      // the pack sags under full load but stays above the cells' minimum voltage
      expect(r.minV).toBeGreaterThan(car.setup.ev!.battery.seriesCells * 2.9);
    }, 30000);
  }
});
