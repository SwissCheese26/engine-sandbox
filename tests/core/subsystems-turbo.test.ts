import { describe, expect, test } from "bun:test";
import {
  chargeAirTempC,
  compressorOutletTempC,
  steadyBoostBar,
  stepTurbo,
  superchargerPowerKw,
  turboMaxRpm,
  type TurboState,
} from "../../src/core/turbo.ts";
import type { Aspiration, EngineConfig } from "../../src/core/types.ts";
import { defaultConfig } from "../../src/data/presets.ts";

const AMB_KPA = 101.325;

function cfgWith(fuel: "diesel" | "petrol", patch: Partial<EngineConfig["induction"]> = {}): EngineConfig {
  const c = defaultConfig(fuel);
  c.induction = { ...c.induction, ...patch };
  return c;
}

/** Simple exhaust-flow estimate (VE 0.9, charge density after intercooler), so tests close the boost ↔ flow loop. */
function exhaustFlow(cfg: EngineConfig, rpm: number, boostBar: number): number {
  const { boreMm, strokeMm, cylinders } = cfg.block;
  const vh = (Math.PI / 4) * (boreMm / 1000) ** 2 * (strokeMm / 1000) * cylinders;
  const t = chargeAirTempC(cfg, boostBar, 20) + 273.15;
  const rho = (AMB_KPA * 1000 + boostBar * 1e5) / (287 * t);
  return 0.9 * rho * vh * (rpm / 120) * 1.05;
}

function fullLoadBoost(cfg: EngineConfig, rpm: number, egtC: number): number {
  let b = 0;
  for (let i = 0; i < 25; i++) b = steadyBoostBar(cfg, rpm, exhaustFlow(cfg, rpm, b), egtC, AMB_KPA);
  return b;
}

/** Time to reach 90 % of the steady full-load boost after a full-pedal step at constant rpm. */
function spoolTime(cfg: EngineConfig, rpm: number, egtC: number, startShaftRpm = 20000): number {
  const goal = 0.9 * fullLoadBoost(cfg, rpm, egtC);
  let s: TurboState = { shaftRpm: startShaftRpm, boostBar: 0 };
  for (let t = 0; t < 10; t += 0.01) {
    s = stepTurbo(s, cfg, 0.01, exhaustFlow(cfg, rpm, s.boostBar), egtC, 1, rpm, AMB_KPA);
    if (s.boostBar >= goal) return t;
  }
  return Infinity;
}

describe("turbo: steady boost (dyno)", () => {
  test("naturally aspirated → 0", () => {
    const c = cfgWith("petrol", { aspiration: "naturally-aspirated" });
    expect(steadyBoostBar(c, 4000, 0.1, 850, AMB_KPA)).toBe(0);
  });

  test("diesel VTG 2.0 TDI reaches target by ~1500 rpm, not at 1000", () => {
    const c = defaultConfig("diesel");
    expect(fullLoadBoost(c, 1000, 650)).toBeLessThan(c.induction.boostTargetBar * 0.8);
    expect(fullLoadBoost(c, 1500, 700)).toBeCloseTo(c.induction.boostTargetBar, 2);
    expect(fullLoadBoost(c, 4000, 720)).toBeCloseTo(c.induction.boostTargetBar, 2);
  });

  test("boost never exceeds target and rises monotonically with rpm", () => {
    for (const fuel of ["diesel", "petrol"] as const) {
      const c = defaultConfig(fuel);
      let prev = -1;
      for (let rpm = 800; rpm <= c.revLimitRpm; rpm += 200) {
        const b = fullLoadBoost(c, rpm, fuel === "diesel" ? 700 : 880);
        expect(b).toBeLessThanOrEqual(c.induction.boostTargetBar + 1e-9);
        expect(b).toBeGreaterThanOrEqual(prev - 1e-6);
        prev = b;
      }
    }
  });

  test("VTG builds more low-end boost than a fixed wastegate turbine", () => {
    const vtg = cfgWith("diesel", { variableGeometry: true });
    const wg = cfgWith("diesel", { variableGeometry: false });
    expect(fullLoadBoost(vtg, 1100, 650)).toBeGreaterThan(fullLoadBoost(wg, 1100, 650) + 0.1);
  });

  test("bigger inducer and bigger A/R → less boost at low rpm", () => {
    const base = cfgWith("petrol");
    const bigComp = cfgWith("petrol", { compressorInducerMm: 60 });
    const bigAR = cfgWith("petrol", { turbineAR: 1.0 });
    const b = fullLoadBoost(base, 1750, 880);
    expect(fullLoadBoost(bigComp, 1750, 880)).toBeLessThan(b);
    expect(fullLoadBoost(bigAR, 1750, 880)).toBeLessThan(b);
  });

  test("hotter exhaust → more turbine power → more boost below target", () => {
    const c = cfgWith("petrol");
    const m = exhaustFlow(c, 1500, 0.2);
    expect(steadyBoostBar(c, 1500, m, 950, AMB_KPA)).toBeGreaterThan(steadyBoostBar(c, 1500, m, 600, AMB_KPA));
  });

  test("sequential twin builds boost earlier than a single large turbo", () => {
    const single = cfgWith("petrol", { aspiration: "turbo" });
    const seq = cfgWith("petrol", { aspiration: "twin-turbo-sequential" });
    expect(fullLoadBoost(seq, 1250, 880)).toBeGreaterThan(fullLoadBoost(single, 1250, 880) + 0.2);
  });

  test("Roots: boost ∝ rpm (instant), centrifugal ∝ rpm²", () => {
    const roots = cfgWith("petrol", { aspiration: "supercharger-roots", boostTargetBar: 0.8 });
    const b1 = steadyBoostBar(roots, 1000, 0, 0, AMB_KPA);
    const b2 = steadyBoostBar(roots, 2000, 0, 0, AMB_KPA);
    expect(b1).toBeGreaterThan(0.15);
    expect(b2 / b1).toBeCloseTo(2, 1);
    const cen = cfgWith("petrol", { aspiration: "supercharger-centrifugal", boostTargetBar: 0.8 });
    const c1 = steadyBoostBar(cen, 2000, 0, 0, AMB_KPA);
    const c2 = steadyBoostBar(cen, 4000, 0, 0, AMB_KPA);
    expect(c2 / c1).toBeGreaterThan(3.2);
    expect(c2 / c1).toBeLessThan(4.8);
    expect(steadyBoostBar(cen, cen.revLimitRpm, 0, 0, AMB_KPA)).toBeCloseTo(0.8, 2);
  });
});

describe("turbo: transient (lag)", () => {
  test("realistic spool time at 2500 rpm: diesel VTG < 1.2 s, petrol wastegate 0.4 … 2 s", () => {
    const d = spoolTime(defaultConfig("diesel"), 2500, 700);
    const p = spoolTime(defaultConfig("petrol"), 2500, 880);
    expect(d).toBeGreaterThan(0.15);
    expect(d).toBeLessThan(1.2);
    expect(p).toBeGreaterThan(0.4);
    expect(p).toBeLessThan(2.0);
  });

  test("lag grows with inducer size (J ∝ D⁵)", () => {
    const small = spoolTime(cfgWith("petrol", { compressorInducerMm: 40 }), 3500, 900);
    const big = spoolTime(cfgWith("petrol", { compressorInducerMm: 55 }), 3500, 900);
    expect(big).toBeGreaterThan(small * 1.3);
  });

  test("VTG reduces lag compared with the same turbine without VTG", () => {
    const vtg = spoolTime(cfgWith("petrol", { variableGeometry: true }), 2500, 880);
    const wg = spoolTime(cfgWith("petrol", { variableGeometry: false }), 2500, 880);
    expect(vtg).toBeLessThan(wg);
  });

  test("e-turbo and parallel twins spool faster than the single turbo (low rpm, where lag hurts)", () => {
    const single = spoolTime(cfgWith("petrol"), 2000, 880);
    expect(spoolTime(cfgWith("petrol", { aspiration: "e-turbo" }), 2000, 880)).toBeLessThan(single * 0.7);
    expect(spoolTime(cfgWith("petrol", { aspiration: "twin-turbo-parallel" }), 2000, 880)).toBeLessThan(single);
  });

  test("superchargers respond almost instantly", () => {
    const c = cfgWith("petrol", { aspiration: "supercharger-roots", boostTargetBar: 0.6 });
    let s: TurboState = { shaftRpm: 0, boostBar: 0 };
    for (let i = 0; i < 30; i++) s = stepTurbo(s, c, 0.01, 0, 0, 1, 3000, AMB_KPA);
    expect(s.boostBar).toBeGreaterThan(0.9 * steadyBoostBar(c, 3000, 0, 0, AMB_KPA));
  });

  test("closing the throttle lets boost decay; pedal 0 → (almost) no boost", () => {
    const c = defaultConfig("petrol");
    let s: TurboState = { shaftRpm: 150000, boostBar: 1.0 };
    for (let i = 0; i < 300; i++) s = stepTurbo(s, c, 0.01, exhaustFlow(c, 2500, 0) * 0.3, 450, 0, 2500, AMB_KPA);
    expect(s.boostBar).toBeLessThan(0.15);
  });

  test("large dt is stable (sub-stepping) and matches small dt", () => {
    const c = defaultConfig("diesel");
    const m = exhaustFlow(c, 3000, 1.0);
    let a: TurboState = { shaftRpm: 30000, boostBar: 0 };
    let b: TurboState = { ...a };
    for (let i = 0; i < 10; i++) a = stepTurbo(a, c, 0.1, m, 700, 1, 3000, AMB_KPA);
    for (let i = 0; i < 1000; i++) b = stepTurbo(b, c, 0.001, m, 700, 1, 3000, AMB_KPA);
    expect(Number.isFinite(a.shaftRpm)).toBe(true);
    expect(Math.abs(a.boostBar - b.boostBar)).toBeLessThan(0.05);
  });

  test("controller holds boost at target (no overshoot beyond +0.1 bar)", () => {
    const c = defaultConfig("diesel");
    let s: TurboState = { shaftRpm: 20000, boostBar: 0 };
    let max = 0;
    for (let i = 0; i < 500; i++) {
      s = stepTurbo(s, c, 0.01, exhaustFlow(c, 3500, s.boostBar), 720, 1, 3500, AMB_KPA);
      max = Math.max(max, s.boostBar);
    }
    expect(s.boostBar).toBeCloseTo(c.induction.boostTargetBar, 1);
    expect(max).toBeLessThan(c.induction.boostTargetBar + 0.1);
  });

  test("naturally aspirated always returns zero state", () => {
    const c = cfgWith("petrol", { aspiration: "naturally-aspirated" });
    expect(stepTurbo({ shaftRpm: 5, boostBar: 1 }, c, 0.01, 0.1, 800, 1, 5000, AMB_KPA)).toEqual({ shaftRpm: 0, boostBar: 0 });
  });
});

describe("turbo: shaft speed", () => {
  test("turboRpm 100 … 250 krpm at full boost, below turboMaxRpm", () => {
    const asps: Aspiration[] = ["turbo", "twin-turbo-parallel", "twin-turbo-sequential", "e-turbo"];
    for (const fuel of ["diesel", "petrol"] as const) {
      for (const aspiration of asps) {
        const c = cfgWith(fuel, { aspiration });
        let s: TurboState = { shaftRpm: 30000, boostBar: 0 };
        for (let i = 0; i < 400; i++) s = stepTurbo(s, c, 0.01, exhaustFlow(c, 4000, s.boostBar), 750, 1, 4000, AMB_KPA);
        expect(s.shaftRpm).toBeGreaterThan(100000);
        expect(s.shaftRpm).toBeLessThan(250000);
        expect(s.shaftRpm).toBeLessThan(turboMaxRpm(c));
      }
    }
  });

  test("turboMaxRpm from u2 = 520 m/s: 45 mm ≈ 154 krpm, 38 mm ≈ 183 krpm (diesel.md §4.4)", () => {
    expect(turboMaxRpm(cfgWith("diesel", { compressorInducerMm: 45 }))).toBeCloseTo(154000, -3);
    expect(turboMaxRpm(cfgWith("diesel", { compressorInducerMm: 38 }))).toBeCloseTo(183000, -3);
    expect(turboMaxRpm(cfgWith("diesel", { aspiration: "naturally-aspirated" }))).toBe(0);
  });
});

describe("turbo: charge air and supercharger drive", () => {
  test("compressor outlet ~100 … 130 °C at 1 bar without intercooler (petrol.md §3.12)", () => {
    const c = cfgWith("petrol", { intercooler: "none" });
    const t = chargeAirTempC(c, 1.0, 20);
    expect(t).toBeGreaterThan(95);
    expect(t).toBeLessThan(130);
    expect(compressorOutletTempC(cfgWith("petrol"), 1.0, 20)).toBeCloseTo(t, 6);
  });

  test("intercooler effectiveness: none > air-to-air > air-to-water ordering, ≥ ambient", () => {
    const none = chargeAirTempC(cfgWith("diesel", { intercooler: "none" }), 1.5, 20);
    const a2a = chargeAirTempC(cfgWith("diesel", { intercooler: "air-to-air" }), 1.5, 20);
    const a2w = chargeAirTempC(cfgWith("diesel", { intercooler: "air-to-water" }), 1.5, 20);
    expect(none).toBeGreaterThan(a2a);
    expect(a2a).toBeGreaterThan(20);
    // air-to-water: 0.85 towards ambient + 15 K
    expect(a2w).toBeCloseTo(none - 0.85 * (none - 35), 6);
    expect(a2a).toBeCloseTo(none - 0.75 * (none - 20), 6);
  });

  test("naturally aspirated / zero boost → ambient", () => {
    expect(chargeAirTempC(cfgWith("petrol", { aspiration: "naturally-aspirated" }), 1, 25)).toBe(25);
    expect(chargeAirTempC(cfgWith("petrol"), 0, 25)).toBe(25);
  });

  test("supercharger drive power: 0 for turbos, Roots ≈ 5 … 15 % of a 2 l engine's output", () => {
    expect(superchargerPowerKw(cfgWith("petrol"), 5000, 1)).toBe(0);
    const roots = cfgWith("petrol", { aspiration: "supercharger-roots" });
    const p = superchargerPowerKw(roots, 5500, 0.8);
    expect(p).toBeGreaterThan(8);
    expect(p).toBeLessThan(30);
    expect(superchargerPowerKw(roots, 5500, 0.4)).toBeLessThan(p);
    expect(superchargerPowerKw(roots, 0, 0.8)).toBe(0);
    const cen = cfgWith("petrol", { aspiration: "supercharger-centrifugal" });
    expect(superchargerPowerKw(cen, 5500, 0.8)).toBeLessThan(p); // centrifugal is more efficient
  });
});
