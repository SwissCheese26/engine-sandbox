import { describe, expect, test } from "bun:test";
import { summarize } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { HYBRID_LIBRARY } from "../../src/data/hybrid-library.ts";
import { VEHICLE_LIBRARY } from "../../src/data/vehicle-library.ts";
import { cycle, driveHybrid } from "./hybrid-run.ts";

/**
 * Hybrid cars (issue #157): simulated 0–100 km/h and Vmax against the factory data, mode "Sport", full pedal, the
 * car's own traction control on. Outliers are documented in docs/research/hybrid.md §5.2 and pinned to their band.
 */
const TOL = 0.12;
const KNOWN_0_100_OUTLIERS: Record<string, { expected: number; band: number; reason: string }> = {
  "hy-ferrari-sf90": { expected: 0.12, band: 0.05, reason: "traction: μ 1.15 road tyre vs the factory's prepared surface (μ ≈ 1.3)" },
};

describe("hybrid library: data", () => {
  test("the cars of #157 are listed with the cars, with their library engine, sources and a battery", () => {
    expect(HYBRID_LIBRARY.map((c) => c.id)).toEqual([
      "hy-toyota-prius-4", "hy-toyota-prius-5-phev", "hy-toyota-yaris-hybrid", "hy-bmw-330e-g20", "hy-vw-golf-8-gte", "hy-porsche-918-spyder", "hy-ferrari-sf90",
    ]);
    for (const c of HYBRID_LIBRARY) {
      expect(VEHICLE_LIBRARY).toContain(c);
      expect(() => libraryConfig(c.engineId)).not.toThrow();
      expect(c.source.length).toBeGreaterThan(30);
      const hy = c.setup.hybrid!;
      expect(hy.socMin).toBeLessThan(hy.socMax);
      // the P2 motor turns with the crank: its speed limit covers the engine's limiter
      if (hy.topology === "p2") expect(c.setup.ev!.motors[0]!.maxRpm).toBeGreaterThanOrEqual(libraryConfig(c.engineId).revLimitRpm * 0.98);
      // system power at least the engine's, at most engine + motors
      const eng = summarize(libraryConfig(c.engineId)).peakPowerKw;
      const mot = c.setup.ev!.motors.reduce((a, m) => a + m.peakPowerKw, 0);
      expect(c.factory.powerKw!).toBeGreaterThan(eng * 0.95);
      expect(c.factory.powerKw!).toBeLessThan((eng + mot) * 1.05);
    }
  });
});

describe("hybrid library: simulated 0–100 and Vmax vs. factory", () => {
  for (const car of HYBRID_LIBRARY) {
    test(car.name, () => {
      const r = driveHybrid(car, 75);
      expect(r.t100).not.toBeNull();
      const d = r.t100! / car.factory.t0to100S! - 1;
      expect(Math.abs(r.vmax / car.factory.vmaxKmh - 1)).toBeLessThan(0.05);
      const out = KNOWN_0_100_OUTLIERS[car.id];
      if (out) {
        expect(Math.abs(d - out.expected)).toBeLessThan(out.band);
        const prepared = driveHybrid(car, 8, "sport", 1.15);
        expect(Math.abs(prepared.t100! / car.factory.t0to100S! - 1)).toBeLessThan(TOL);
      } else expect(Math.abs(d)).toBeLessThan(TOL);
      // the system works together: more than the engine alone at the wheels
      expect(r.peakKw).toBeGreaterThan(summarize(libraryConfig(car.engineId)).peakPowerKw);
    }, 60000);
  }
});

describe("hybrid consumption: city vs highway (hybrid.md §6)", () => {
  // city: stop-and-go 0–30–50–0 with standstill; highway: steady 120 km/h
  const CITY: [number, number][] = [[0, 0], [5, 0], [15, 30], [35, 30], [45, 50], [65, 50], [75, 0], [90, 0]];
  const HWY: [number, number][] = [[0, 0], [30, 120], [600, 120]];
  test("Prius: markedly better in the city than at 120 km/h, both plausible against WLTP", () => {
    const prius = HYBRID_LIBRARY.find((c) => c.id === "hy-toyota-prius-4")!;
    const city = cycle(prius, CITY, 8);
    const hwy = cycle(prius, HWY);
    expect(city.l100).toBeLessThan(0.8 * hwy.l100);
    expect(city.l100).toBeGreaterThan(2.5);
    expect(city.l100).toBeLessThan(5.5);
    expect(hwy.l100).toBeGreaterThan(4.5);
    expect(hwy.l100).toBeLessThan(8);
    // the engine is off most of the time in town (electric creep, stops, regen)
    expect(city.engineOnS / (90 * 8)).toBeLessThan(0.5);
  }, 60000);
});
