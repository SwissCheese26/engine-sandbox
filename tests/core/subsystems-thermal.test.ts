import { describe, expect, test } from "bun:test";
import {
  egtTimeConstantS,
  heatCapacities,
  oilPressureBar,
  radiatorHeatW,
  stepThermal,
  thermostatOpening,
  type ThermalState,
} from "../../src/core/thermal.ts";
import type { EngineConfig } from "../../src/core/types.ts";
import { defaultConfig } from "../../src/data/presets.ts";

const cold = (t = 20): ThermalState => ({ coolantC: t, oilC: t, egtC: t });

/** Runs constant conditions; returns final state and the time [s] coolant first reached `mark`. */
function run(cfg: EngineConfig, seconds: number, qKw: number, rpm: number, opts: { ambientC?: number; egt?: number; dt?: number; mark?: number } = {}) {
  const dt = opts.dt ?? 0.5;
  let s = cold(opts.ambientC ?? 20);
  let tMark = Infinity;
  for (let t = 0; t < seconds; t += dt) {
    s = stepThermal(s, cfg, dt, qKw, opts.egt ?? 400, rpm, opts.ambientC ?? 20);
    if (opts.mark !== undefined && tMark === Infinity && s.coolantC >= opts.mark) tMark = t;
  }
  return { s, tMark };
}

describe("thermal: warm-up", () => {
  for (const fuel of ["diesel", "petrol"] as const) {
    test(`${fuel}: idle warm-up to thermostat − 5 K takes 3 … 10 min (game time)`, () => {
      const cfg = defaultConfig(fuel);
      // idle with cold-friction: ≈ 4 kW into the coolant for a 2 l engine
      const { tMark } = run(cfg, 1200, 4, cfg.idleRpm, { mark: cfg.cooling.thermostatOpenC - 5 });
      expect(tMark).toBeGreaterThan(180);
      expect(tMark).toBeLessThan(600);
    });

    test(`${fuel}: part load warms up faster than idle, settles near the thermostat`, () => {
      const cfg = defaultConfig(fuel);
      const idle = run(cfg, 1200, 4, 800, { mark: 80 }).tMark;
      const part = run(cfg, 1200, 18, 3000, { mark: 80 });
      expect(part.tMark).toBeLessThan(idle / 2);
      expect(part.s.coolantC).toBeGreaterThan(cfg.cooling.thermostatOpenC - 2);
      expect(part.s.coolantC).toBeLessThan(cfg.cooling.thermostatOpenC + 12);
      expect(part.s.oilC).toBeGreaterThan(part.s.coolantC); // oil runs hotter than coolant under load
      expect(part.s.oilC).toBeLessThan(125);
    });
  }

  test("sustained full load with an adequate radiator stays below the warning thresholds", () => {
    const cfg = defaultConfig("diesel");
    const { s } = run(cfg, 1800, 45, 4000);
    expect(s.coolantC).toBeLessThan(108);
    expect(s.oilC).toBeLessThan(135);
  });

  test("undersized radiator (20 kW) overheats at sustained full load", () => {
    const cfg = { ...defaultConfig("diesel"), cooling: { radiatorCapacityKw: 20, thermostatOpenC: 88, oilCooler: false } };
    const { s } = run(cfg, 900, 45, 4000);
    expect(s.coolantC).toBeGreaterThan(110);
  });

  test("oil cooler keeps the oil cooler at full load", () => {
    const base = defaultConfig("petrol");
    const without = { ...base, cooling: { ...base.cooling, oilCooler: false } };
    expect(run(base, 1500, 45, 5500).s.oilC).toBeLessThan(run(without, 1500, 45, 5500).s.oilC);
  });

  test("bigger engine (more heat capacity) warms up more slowly at the same heat input", () => {
    const small = defaultConfig("diesel");
    const big: EngineConfig = { ...small, block: { ...small.block, boreMm: 102, strokeMm: 120, cylinders: 6 } };
    expect(heatCapacities(big).coolantJK).toBeGreaterThan(heatCapacities(small).coolantJK * 1.5);
    expect(run(big, 1200, 10, 2000, { mark: 70 }).tMark).toBeGreaterThan(run(small, 1200, 10, 2000, { mark: 70 }).tMark);
  });

  test("engine off: cools down towards ambient", () => {
    const cfg = defaultConfig("petrol");
    let s: ThermalState = { coolantC: 95, oilC: 105, egtC: 600 };
    for (let i = 0; i < 3600; i++) s = stepThermal(s, cfg, 1, 0, 20, 0, 20);
    expect(s.coolantC).toBeLessThan(70);
    expect(s.oilC).toBeLessThan(80);
    expect(s.coolantC).toBeGreaterThan(19.9);
    expect(s.egtC).toBeCloseTo(20, 3);
  });

  test("large dt is stable and close to small dt", () => {
    const cfg = defaultConfig("diesel");
    const a = run(cfg, 300, 20, 3000, { dt: 2 }).s;
    const b = run(cfg, 300, 20, 3000, { dt: 0.05 }).s;
    expect(Math.abs(a.coolantC - b.coolantC)).toBeLessThan(1);
    expect(Math.abs(a.oilC - b.oilC)).toBeLessThan(1);
  });

  test("dt = 0 returns an unchanged copy", () => {
    const s = cold();
    const r = stepThermal(s, defaultConfig("diesel"), 0, 10, 500, 2000, 20);
    expect(r).toEqual(s);
    expect(r).not.toBe(s);
  });
});

describe("thermal: thermostat and radiator", () => {
  test("thermostat closed (leak) below, fully open 12 K above the opening temperature", () => {
    const cfg = defaultConfig("petrol");
    const t0 = cfg.cooling.thermostatOpenC;
    expect(thermostatOpening(cfg, t0 - 20)).toBeCloseTo(0.01, 6);
    expect(thermostatOpening(cfg, t0 + 6)).toBeCloseTo(0.5, 6);
    expect(thermostatOpening(cfg, t0 + 30)).toBe(1);
  });

  test("radiator delivers its rated capacity at full fan, 90/25 °C reference, open thermostat and high rpm", () => {
    const cfg: EngineConfig = { ...defaultConfig("diesel"), cooling: { radiatorCapacityKw: 70, thermostatOpenC: 78, oilCooler: true } };
    expect(radiatorHeatW(cfg, 90, 25, 4000)).toBeCloseTo(70000, -2);
  });

  test("radiator heat scales with ΔT and rises with the fan", () => {
    const cfg = defaultConfig("diesel");
    const t = cfg.cooling.thermostatOpenC;
    expect(radiatorHeatW(cfg, 100, 40, 3000)).toBeLessThan(radiatorHeatW(cfg, 100, 20, 3000));
    expect(radiatorHeatW(cfg, t + 12, 20, 3000)).toBeGreaterThan(radiatorHeatW(cfg, t + 4, 20, 3000) * 1.5);
    expect(radiatorHeatW(cfg, 15, 20, 3000)).toBe(0);
  });
});

describe("thermal: EGT lag", () => {
  test("first order towards the target, τ by manifold type (diesel.md §3.7)", () => {
    const cast = defaultConfig("diesel");
    const tub: EngineConfig = { ...cast, exhaust: { ...cast.exhaust, manifold: "tubular-short" } };
    expect(egtTimeConstantS(cast)).toBe(2.5);
    expect(egtTimeConstantS(tub)).toBe(1.0);
    const s = stepThermal({ coolantC: 90, oilC: 90, egtC: 200 }, cast, 2.5, 10, 700, 3000, 20);
    expect(s.egtC).toBeCloseTo(700 - 500 * Math.exp(-1), 6);
    const fast = stepThermal({ coolantC: 90, oilC: 90, egtC: 200 }, tub, 2.5, 10, 700, 3000, 20);
    expect(fast.egtC).toBeGreaterThan(s.egtC);
  });
});

describe("thermal: oil pressure", () => {
  for (const fuel of ["diesel", "petrol"] as const) {
    const cfg = defaultConfig(fuel);
    test(`${fuel}: hot idle ≈ 1.2 bar at 800 rpm, 0 at standstill`, () => {
      expect(oilPressureBar(cfg, 800, 90)).toBeCloseTo(1.2, 1);
      expect(oilPressureBar(cfg, 0, 90)).toBe(0);
    });
    test(`${fuel}: cold oil higher, hot oil lower`, () => {
      expect(oilPressureBar(cfg, 1500, 20)).toBeGreaterThan(oilPressureBar(cfg, 1500, 90) * 1.5);
      expect(oilPressureBar(cfg, 1500, 140)).toBeLessThan(oilPressureBar(cfg, 1500, 90));
    });
    test(`${fuel}: rises with rpm, capped by the relief valve`, () => {
      expect(oilPressureBar(cfg, 4000, 90)).toBeGreaterThan(oilPressureBar(cfg, 1500, 90) * 1.5);
      for (let rpm = 0; rpm <= 9000; rpm += 500) {
        for (const t of [-20, 20, 90, 150]) expect(oilPressureBar(cfg, rpm, t)).toBeLessThanOrEqual(5.5);
      }
      expect(oilPressureBar(cfg, 6000, -20)).toBe(fuel === "diesel" ? 5.0 : 5.5);
    });
  }
});
