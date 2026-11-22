// Cold-start strategy (issue #135): catalyst heating, cold fast idle, catalyst temperature, emissions era gating.
// Spec: docs/research/petrol.md "Nachtrag: Kaltstart und Katheizen", diesel.md "Nachtrag: Kaltstart-Heizmodus".
import { describe, expect, test } from "bun:test";
import { EngineSimulator, defaultInputs, dynoSweep, emissionsOf, hasCatHeating } from "../../src/core/index.ts";
import type { EngineConfig, EngineState } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { variant } from "./helpers.ts";

const DT = 0.05;

/** Starter for 1 s, then idle; one state per step. */
function idleRun(cfg: EngineConfig, seconds: number, warm = false): EngineState[] {
  const sim = new EngineSimulator(cfg);
  const out: EngineState[] = [];
  for (let t = 0; t < seconds; t += DT) {
    out.push({ ...sim.step(DT, { ...defaultInputs(), ignition: true, starter: t < 1, startWarm: warm }) });
  }
  return out;
}
const at = (run: EngineState[], s: number) => run[Math.round(s / DT) - 1]!;

describe("emissions era (contract #134)", () => {
  test("library engines carry their standard; unset configs get a default from the hardware", () => {
    expect(libraryConfig("ref-vw-ea888-gen3-chhb").emissions).toBe("euro6");
    expect(libraryConfig("lib-toyota-2jz-gte").emissions).toBe("euro1");
    const golf = libraryConfig("ref-vw-ea888-gen3-chhb");
    expect(emissionsOf(variant(golf, (c) => delete c.emissions))).toBe("euro5");
    expect(emissionsOf(variant(golf, (c) => { delete c.emissions; c.exhaust.catalyst = false; }))).toBe("pre-euro");
    expect(emissionsOf(variant(golf, (c) => { delete c.emissions; if (c.fuelSystem.kind === "petrol") c.fuelSystem.mixture = "carburettor"; }))).toBe("pre-euro");
  });

  test("catalyst heating only on newer engines with a catalyst", () => {
    expect(hasCatHeating(libraryConfig("ref-vw-ea888-gen3-chhb"))).toBe(true);
    expect(hasCatHeating(libraryConfig("lib-toyota-2jz-gte"))).toBe(false);
    expect(hasCatHeating(libraryConfig("ref-mercedes-om654-220d"))).toBe(true);
    expect(hasCatHeating(libraryConfig("ref-vw-19-tdi-pd-96kw"))).toBe(false);
  });
});

describe("Golf 7 GTI cold start (20 °C)", () => {
  const cfg = libraryConfig("ref-vw-ea888-gen3-chhb");
  const run = idleRun(cfg, 300);

  test("catalyst heating: raised idle 1100 … 1500 1/min with more fuel", () => {
    for (const s of [5, 10, 20]) {
      expect(at(run, s).coldStart).toBe("cat-heating");
      expect(at(run, s).rpm).toBeGreaterThan(1100);
      expect(at(run, s).rpm).toBeLessThan(1500);
    }
    // retarded spark: more fuel for the higher idle, hotter exhaust than the later fast idle
    expect(at(run, 10).fuelFlowLh).toBeGreaterThan(1.5 * at(run, 90).fuelFlowLh);
    expect(at(run, 10).egtC).toBeGreaterThan(at(run, 90).egtC + 50);
  });

  test("the catalyst lights off (300 °C) within 20 … 60 s, then heating ends", () => {
    const i = run.findIndex((s) => (s.catalystC ?? 0) >= 300);
    const t = (i + 1) * DT;
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(60);
    expect(at(run, 65).coldStart).not.toBe("cat-heating");
    // a lit catalyst stays lit at idle (conversion heat)
    expect(at(run, 120).catalystC!).toBeGreaterThan(300);
  });

  test("afterwards a fast idle that falls with the coolant temperature to the warm idle", () => {
    const a = at(run, 60);
    const b = at(run, 150);
    expect(a.coldStart).toBe("fast-idle");
    expect(a.rpm).toBeGreaterThan(cfg.idleRpm + 50);
    expect(b.coolantC).toBeGreaterThan(a.coolantC);
    expect(b.rpm).toBeLessThan(a.rpm);
    const warm = run.find((s) => s.coolantC >= 72)!;
    expect(warm).toBeDefined();
    expect(Math.abs(warm.rpm - cfg.idleRpm)).toBeLessThan(cfg.idleRpm * 0.05);
    expect(warm.coldStart).toBeUndefined();
  });
});

describe("older engines and warm starts", () => {
  test("Supra 2JZ (Euro 1): no catalyst heating, only a choke-like fast idle", () => {
    const cfg = libraryConfig("lib-toyota-2jz-gte");
    const run = idleRun(cfg, 40);
    expect(run.some((s) => s.coldStart === "cat-heating")).toBe(false);
    expect(at(run, 10).coldStart).toBe("fast-idle");
    expect(at(run, 10).rpm).toBeGreaterThan(cfg.idleRpm + 200);
    expect(at(run, 10).rpm).toBeLessThan(cfg.idleRpm + 450);
  });

  test("warm start: normal idle, no cold-start mode", () => {
    for (const id of ["ref-vw-ea888-gen3-chhb", "ref-mercedes-om654-220d", "lib-toyota-2jz-gte"]) {
      const cfg = libraryConfig(id);
      const run = idleRun(cfg, 15, true);
      for (const s of run.slice(Math.round(5 / DT))) {
        expect(s.coldStart, id).toBeUndefined();
        expect(Math.abs(s.rpm - cfg.idleRpm), id).toBeLessThan(cfg.idleRpm * 0.05);
      }
    }
  });
});

test("warm air-cooled engine (Harley M8): exactly the warm idle, no fast idle left (review #137)", () => {
  const cfg = libraryConfig("lib-harley-m8-107");
  const run = idleRun(cfg, 120, true);
  for (const s of run.slice(Math.round(20 / DT))) {
    expect(s.coldStart).toBeUndefined();
    expect(Math.abs(s.rpm - cfg.idleRpm)).toBeLessThan(2);
  }
});

describe("diesel heating mode (Euro 5+)", () => {
  test("OM654: raised idle and post-injection, no spark; a Euro 3 TDI only fast idles", () => {
    const cfg = libraryConfig("ref-mercedes-om654-220d");
    const run = idleRun(cfg, 120);
    const h = at(run, 20);
    expect(h.coldStart).toBe("cat-heating");
    expect(h.rpm).toBeGreaterThan(cfg.idleRpm + 150);
    // post-injection: more fuel and a hotter oxidation catalyst than the same engine without the heating mode
    const plain = idleRun(variant(cfg, (c) => (c.emissions = "euro4")), 60);
    expect(at(plain, 20).coldStart).not.toBe("cat-heating");
    expect(h.fuelFlowLh).toBeGreaterThan(1.3 * at(plain, 20).fuelFlowLh);
    expect(at(run, 60).catalystC!).toBeGreaterThan(at(plain, 60).catalystC! + 30);
    const tdi = idleRun(libraryConfig("ref-vw-19-tdi-pd-96kw"), 20);
    expect(tdi.some((s) => s.coldStart === "cat-heating")).toBe(false);
  });
});

describe("full load unchanged", () => {
  test("the emissions standard does not touch the steady full-load curve", () => {
    const golf = libraryConfig("ref-vw-ea888-gen3-chhb");
    const a = dynoSweep(golf, { fromRpm: 1500, stepRpm: 500 });
    const b = dynoSweep(variant(golf, (c) => (c.emissions = "pre-euro")), { fromRpm: 1500, stepRpm: 500 });
    expect(b.map((p) => p.torqueNm)).toEqual(a.map((p) => p.torqueNm));
  });
});
