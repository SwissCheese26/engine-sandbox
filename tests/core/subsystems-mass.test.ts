import { describe, expect, test } from "bun:test";
import { engineMassKg, reliabilityScore } from "../../src/core/mass.ts";
import type { EngineConfig } from "../../src/core/types.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { REF, REF_LIST } from "./subsystems-fixtures.ts";

const vary = (cfg: EngineConfig, f: (c: EngineConfig) => void): EngineConfig => {
  const c = structuredClone(cfg);
  f(c);
  return c;
};

describe("mass: calibration against known engines (±12 %)", () => {
  const cases: [string, EngineConfig, number][] = [
    ["R4 2.0 TDI (default diesel)", defaultConfig("diesel"), 160],
    ["EA888 2.0 TSI", REF.ea888!, 140],
    ["LS3 6.2", REF.ls3!, 180],
    ["K20A (R4 alu 2 l: 110 … 130)", REF.k20a!, 120],
    ["VW 1.9 TDI PD", REF.tdi19!, 160],
    ["OM654", REF.om654!, 165],
    ["Cummins 6BT", REF.cummins!, 490],
    ["F136 (V8 alu DOHC ≈ 200)", REF.f136!, 190],
  ];
  for (const [name, cfg, kg] of cases) {
    test(`${name} ≈ ${kg} kg`, () => {
      const m = engineMassKg(cfg);
      expect(m).toBeGreaterThan(kg * 0.88);
      expect(m).toBeLessThan(kg * 1.12);
    });
  }
});

describe("mass: effects of the configuration", () => {
  const d = defaultConfig("diesel");
  const p = defaultConfig("petrol");
  test("aluminium < CGI < cast iron", () => {
    const alu = engineMassKg(vary(d, (c) => (c.block.blockMaterial = "aluminium")));
    const cgi = engineMassKg(vary(d, (c) => (c.block.blockMaterial = "compacted-graphite-iron")));
    const ci = engineMassKg(d);
    expect(alu).toBeLessThan(cgi);
    expect(cgi).toBeLessThan(ci);
    expect(ci - alu).toBeGreaterThan(12); // diesel.md §2: −25 … 35 kg on an R4 (whole block), here ≥ 12 kg
  });
  test("grows with displacement and cylinder count", () => {
    expect(engineMassKg(vary(p, (c) => (c.block.strokeMm = 110)))).toBeGreaterThan(engineMassKg(p));
    expect(engineMassKg(vary(p, (c) => (c.block.cylinders = 6)))).toBeGreaterThan(engineMassKg(p) * 1.15);
    expect(engineMassKg(REF.cummins!)).toBeGreaterThan(engineMassKg(d) * 1.8);
  });
  test("valvetrain OHV < SOHC < DOHC", () => {
    const m = (vt: "ohv" | "sohc" | "dohc") => engineMassKg(vary(p, (c) => (c.head.valvetrain = vt)));
    expect(m("ohv")).toBeLessThan(m("sohc"));
    expect(m("sohc")).toBeLessThan(m("dohc"));
  });
  test("charging adds weight: NA < turbo < twin turbo; supercharger +10 … 15 kg", () => {
    const na = engineMassKg(vary(p, (c) => (c.induction.aspiration = "naturally-aspirated")));
    const t = engineMassKg(p);
    const tt = engineMassKg(vary(p, (c) => (c.induction.aspiration = "twin-turbo-parallel")));
    const sc = engineMassKg(vary(p, (c) => (c.induction.aspiration = "supercharger-roots")));
    expect(t - na).toBeGreaterThan(8);
    expect(t - na).toBeLessThan(25); // petrol.md §2: turbo +15 … 25 kg incl. intercooler
    expect(tt).toBeGreaterThan(t);
    expect(sc - na).toBeGreaterThan(10);
    expect(sc - na).toBeLessThan(22);
  });
  test("aftertreatment: DPF +8, SCR +15, EGR +3 kg (diesel.md §2)", () => {
    const bare = vary(d, (c) => (c.exhaust = { ...c.exhaust, particulateFilter: false, scr: false, egr: false }));
    const full = vary(d, (c) => (c.exhaust = { ...c.exhaust, particulateFilter: true, scr: true, egr: true }));
    expect(engineMassKg(full) - engineMassKg(bare)).toBeCloseTo(26, 6);
  });
  test("always positive and finite for extreme configs", () => {
    const tiny = vary(p, (c) => (c.block = { ...c.block, cylinders: 1, boreMm: 50, strokeMm: 40 }));
    const huge = vary(d, (c) => (c.block = { ...c.block, cylinders: 12, boreMm: 140, strokeMm: 165 }));
    for (const c of [tiny, huge]) {
      const m = engineMassKg(c);
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeGreaterThan(20);
    }
  });
});

describe("reliability", () => {
  test("range 0 … 1; stock engines are reasonably reliable (≥ 0.6)", () => {
    for (const cfg of [defaultConfig("diesel"), defaultConfig("petrol"), ...REF_LIST]) {
      const r = reliabilityScore(cfg);
      expect(r).toBeGreaterThanOrEqual(0.6);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
  test("diesel: tuning to the limit lowers reliability (boost, smoke limit, timing)", () => {
    const d = defaultConfig("diesel");
    const base = reliabilityScore(d);
    const tuned = vary(d, (c) => {
      c.induction.boostTargetBar = 2.6;
      if (c.fuelSystem.kind === "diesel") {
        c.fuelSystem.smokeLimitLambda = 1.05;
        c.fuelSystem.injectionTimingOffsetDeg = 6;
      }
    });
    expect(reliabilityScore(tuned)).toBeLessThan(base * 0.6);
  });
  test("stronger materials restore reliability of a highly boosted diesel", () => {
    const hot = vary(defaultConfig("diesel"), (c) => (c.induction.boostTargetBar = 2.3));
    const strong = vary(hot, (c) => (c.block = { ...c.block, pistons: "steel", blockMaterial: "compacted-graphite-iron" }));
    expect(reliabilityScore(strong)).toBeGreaterThan(reliabilityScore(hot));
  });
  test("petrol: too high compression / boost on low octane fuel lowers reliability", () => {
    const p = defaultConfig("petrol");
    const bad = vary(p, (c) => {
      c.block.compressionRatio = 11.5;
      c.induction.boostTargetBar = 1.8;
      if (c.fuelSystem.kind === "petrol") c.fuelSystem.fuel = "ron91";
    });
    expect(reliabilityScore(bad)).toBeLessThan(reliabilityScore(p) * 0.7);
  });
  test("rev limiter beyond valve float / piston speed lowers reliability", () => {
    const p = REF.ls3!;
    expect(reliabilityScore(vary(p, (c) => (c.revLimitRpm = 7500)))).toBeLessThan(reliabilityScore(p) * 0.7);
  });
  test("undersized radiator lowers reliability", () => {
    const p = defaultConfig("petrol");
    expect(reliabilityScore(vary(p, (c) => (c.cooling.radiatorCapacityKw = 30)))).toBeLessThan(reliabilityScore(p));
  });
});
