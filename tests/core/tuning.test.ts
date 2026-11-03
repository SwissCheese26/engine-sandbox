// Issue #18 (ECU torque limit), issue #16 (tuning stages, pops & bangs).
import { describe, expect, test } from "bun:test";
import { DEFAULT_VEHICLE, EngineSimulator, defaultInputs } from "../../src/core/index.ts";
import type { EngineConfig, EngineState, SimInputs } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { REFERENCE_ENGINES } from "../../src/data/reference-engines.ts";
import { applyTuningStage, tuningWarnings } from "../../src/data/tuning.ts";
import { sweepPeaks, variant } from "./helpers.ts";

const ref = (id: string) => REFERENCE_ENGINES.find((r) => r.config.id === id)!;
const EA888 = ref("ref-vw-ea888-gen3-chhb");
const N57 = ref("ref-bmw-n57d30o1");
const S54 = ref("ref-bmw-s54b32");
const M57 = libraryConfig("lib-bmw-m57d30tu2");

function warmSim(cfg: EngineConfig): { sim: EngineSimulator; inp: SimInputs } {
  const sim = new EngineSimulator(cfg);
  const inp: SimInputs = { ...defaultInputs(), ignition: true, starter: true, startWarm: true };
  for (let i = 0; i < 60; i++) sim.step(1 / 60, inp);
  inp.starter = false;
  return { sim, inp };
}
const run = (sim: EngineSimulator, inp: SimInputs, sec: number, each?: (s: EngineState) => void) => {
  for (let i = 0; i < Math.round(sec * 60); i++) {
    const s = sim.step(1 / 60, inp);
    each?.(s);
  }
  return sim.state;
};

describe("ECU torque limit (#18)", () => {
  test("EA888: steady sweep holds the 350 Nm plateau; without the limit the air path allows more", () => {
    const lim = sweepPeaks(EA888.config, { fromRpm: 1000 });
    expect(lim.torque.torqueNm).toBeLessThanOrEqual(350.5);
    expect(lim.torque.torqueNm).toBeGreaterThan(345);
    const free = sweepPeaks(variant(EA888.config, (c) => delete c.ecuTorqueLimitNm), { fromRpm: 1000 });
    expect(free.torque.torqueNm).toBeGreaterThan(380);
  });
  test("limit works for diesel (quantity) and naturally aspirated petrol (throttle)", () => {
    expect(sweepPeaks(variant(N57.config, (c) => (c.ecuTorqueLimitNm = 500)), { fromRpm: 1000 }).torque.torqueNm).toBeLessThanOrEqual(500.5);
    expect(sweepPeaks(variant(S54.config, (c) => (c.ecuTorqueLimitNm = 300)), { fromRpm: 1000 }).torque.torqueNm).toBeLessThanOrEqual(300.5);
  });
  test("an inactive limit (above the full-load curve) changes nothing", () => {
    const a = sweepPeaks(N57.config, { fromRpm: 1000 });
    const b = sweepPeaks(variant(N57.config, (c) => (c.ecuTorqueLimitNm = 5000)), { fromRpm: 1000 });
    expect(b.torque.torqueNm).toBeCloseTo(a.torque.torqueNm, 6);
    expect(b.power.powerKw).toBeCloseTo(a.power.powerKw, 6);
  });
  for (const [name, cfg, lim] of [["EA888 petrol turbo", EA888.config, 350], ["N57 diesel", variant(N57.config, (c) => (c.ecuTorqueLimitNm = 500)), 500]] as const) {
    test(`${name}: transient full load on the dyno stays at the limit (boost / quantity cap)`, () => {
      const { sim, inp } = warmSim(cfg);
      inp.dynoMode = "hold-rpm";
      inp.dynoTargetRpm = 3000;
      inp.pedal = 1;
      let max = 0;
      run(sim, inp, 4);
      const s = run(sim, inp, 4, (x) => (max = Math.max(max, x.torqueNm)));
      expect(max).toBeLessThanOrEqual(lim * 1.03);
      expect(s.torqueNm).toBeGreaterThan(lim * 0.93);
      expect(s.torqueLimited).toBe(true);
    });
  }
});

const peak = (cfg: EngineConfig) => sweepPeaks(cfg, { fromRpm: 1000 });

describe("tuning stages (#16)", () => {
  test("Serie returns the production config as a new object; stages never mutate the base", () => {
    const base = structuredClone(EA888.config);
    const s3 = applyTuningStage(base, 3);
    expect(base).toEqual(EA888.config);
    const s0 = applyTuningStage(base, 0);
    expect(s0.config).toEqual(base);
    expect(s0.config).not.toBe(base);
    expect(s3.changes.length).toBeGreaterThan(3);
  });
  test("stages are idempotent and computed from the production config: Stage 2 twice = same, 2 → 2 → Serie = base", () => {
    for (const base of [EA888.config, N57.config, S54.config]) {
      const a = applyTuningStage(base, 2);
      const b = applyTuningStage(base, 2);
      expect(b.config).toEqual(a.config);
      expect(b.changes).toEqual(a.changes);
      expect(b.config).not.toBe(a.config);
      // the workbench keeps the production config and always recomputes from it
      const again = applyTuningStage(base, 2);
      expect(again.config).toEqual(a.config);
      expect(applyTuningStage(base, 0).config).toEqual(base);
    }
  });
  test("EA888 Stage 1: torque +20 … 30 %, power +15 … 35 % over the data sheet (model power is turbo-choke limited)", () => {
    const b = peak(EA888.config);
    const t = peak(applyTuningStage(EA888.config, 1).config);
    const dt = t.torque.torqueNm / b.torque.torqueNm - 1;
    expect(dt).toBeGreaterThan(0.2);
    expect(dt).toBeLessThan(0.3);
    const dp = t.power.powerKw / EA888.expected.peakPowerKw - 1;
    expect(dp).toBeGreaterThan(0.15);
    expect(dp).toBeLessThan(0.35);
  });
  for (const [name, cfg] of [["N57", N57.config], ["M57", M57]] as const) {
    test(`${name} diesel Stage 1: power +15 … 25 %`, () => {
      const d = peak(applyTuningStage(cfg, 1).config).power.powerKw / peak(cfg).power.powerKw - 1;
      expect(d).toBeGreaterThanOrEqual(0.145);
      expect(d).toBeLessThanOrEqual(0.25);
    });
  }
  test("S54 naturally aspirated Stage 1 brings little (< +8 %)", () => {
    const d = peak(applyTuningStage(S54.config, 1).config).power.powerKw / peak(S54.config).power.powerKw - 1;
    expect(d).toBeLessThan(0.08);
    expect(d).toBeGreaterThan(-0.03);
  });
  test("stages build on each other: Stage 3 makes the most power on a turbo engine", () => {
    const p = [1, 2, 3].map((s) => peak(applyTuningStage(EA888.config, s as 1 | 2 | 3).config).power.powerKw);
    expect(p[2]!).toBeGreaterThan(p[0]!);
    expect(p[2]!).toBeGreaterThan(p[1]!);
  });
  test("Stage 3 on cast production internals warns (peak pressure, conrods); forged parts are fitted by default", () => {
    const cast = applyTuningStage(EA888.config, 3, { forgedInternals: false }).config;
    expect(cast.block.pistons).toBe("cast-aluminium");
    const codes = tuningWarnings(cast, 3).map((w) => w.code);
    expect(codes).toContain("peak-pressure");
    expect(codes).toContain("conrod-stress");
    const forged = applyTuningStage(EA888.config, 3).config;
    expect(forged.block.pistons).toBe("forged-aluminium");
    expect(tuningWarnings(forged, 3).map((w) => w.code)).not.toContain("conrod-stress");
  });
});

/** Sustained overrun at 4500 1/min: a very heavy vehicle without road load drags the engine (pedal 0). */
function overrun(cfg: EngineConfig, sec: number) {
  const { sim, inp } = warmSim(cfg);
  inp.pedal = 0.3;
  for (let i = 0; i < 300 && sim.state.rpm < 4500; i++) sim.step(1 / 60, inp);
  const ratio = 4;
  const r = 0.3;
  // test-only: start the vehicle at the matching speed (no public setter)
  (sim as unknown as { x: { vSpeed: number } }).x.vSpeed = ((sim.state.rpm * Math.PI) / 30 / ratio) * r;
  inp.dynoMode = "vehicle";
  inp.vehicle = { vehicle: { ...DEFAULT_VEHICLE, massKg: 1e6, dragCoefficient: 0, rollingResistance: 0, wheelRadiusM: r }, totalRatio: ratio, efficiency: 0.95, clutch: 1, clutchCapacityNm: 5000 };
  inp.pedal = 0;
  let afMax = 0;
  let fuel = 0;
  const codes = new Set<string>();
  const s = run(sim, inp, sec, (x) => {
    afMax = Math.max(afMax, x.afterfire ?? 0);
    fuel += x.fuelMassFlowGS / 60;
    for (const w of x.warnings) codes.add(w.code);
  });
  return { s, afMax, fuel, codes };
}

describe("pops & bangs (#16)", () => {
  const pops = (lvl: "off" | "mild" | "popcorn" | "brutal") => variant(EA888.config, (c) => (c.exhaust.overrunPops = lvl));
  test("off: fuel cut in overrun, no afterfire", () => {
    const r = overrun(pops("off"), 6);
    expect(r.afMax).toBe(0);
    expect(r.fuel).toBe(0);
  });
  test("afterfire raises EGT and fuel use in overrun; intensity grows with the level", () => {
    const off = overrun(pops("off"), 10);
    const mild = overrun(pops("mild"), 10);
    const brutal = overrun(pops("brutal"), 10);
    expect(mild.afMax).toBeGreaterThan(0);
    expect(brutal.afMax).toBeGreaterThan(mild.afMax);
    expect(mild.s.egtC).toBeGreaterThan(off.s.egtC + 150);
    expect(brutal.s.egtC).toBeGreaterThan(mild.s.egtC + 150);
    expect(brutal.fuel).toBeGreaterThan(mild.fuel);
    expect(mild.fuel).toBeGreaterThan(0);
  });
  test("brutal with catalyst: 'Kat überhitzt' warning; popcorn stays below", () => {
    expect(overrun(pops("brutal"), 30).codes.has("catalyst-overheat")).toBe(true);
    expect(overrun(pops("popcorn"), 30).codes.has("catalyst-overheat")).toBe(false);
  });
  test("diesel: no afterfire even when set (no spark, no overrun injection)", () => {
    const r = overrun(variant(N57.config, (c) => (c.exhaust.overrunPops = "brutal")), 4);
    expect(r.afMax).toBe(0);
  });
});
