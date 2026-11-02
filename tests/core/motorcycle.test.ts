import { describe, expect, test } from "bun:test";
import { Drivetrain, EngineSimulator, VEHICLES, defaultInputs, summarize, validateConfig } from "../../src/core/index.ts";
import type { EngineConfig, VehicleKind } from "../../src/core/index.ts";
import { ENGINE_LIBRARY, libraryConfig } from "../../src/data/engine-library.ts";
import { defaultConfig } from "../../src/data/presets.ts";

/** Issue #25: motorcycle layouts, air cooling, motorcycle vehicles. */

const layout = (l: EngineConfig["block"]["layout"], n: number, extra: Partial<EngineConfig["block"]> = {}): EngineConfig => {
  const c = defaultConfig("petrol");
  c.block = { ...c.block, layout: l, cylinders: n, bankAngleDeg: l === "boxer" ? 180 : l === "v" ? 90 : 0, ...extra };
  return c;
};

describe("motorcycle layouts: firing intervals and order", () => {
  const cases: [string, EngineConfig, number[], number[]][] = [
    ["single", layout("inline", 1), [720], [1]],
    ["inline twin 360°", layout("inline", 2), [360, 360], [1, 2]],
    ["inline twin 270°", layout("inline", 2, { twinCrankDeg: 270 }), [270, 450], [1, 2]],
    ["inline twin 180°", layout("inline", 2, { twinCrankDeg: 180 }), [180, 540], [1, 2]],
    ["V2 45° (Harley)", layout("v", 2, { bankAngleDeg: 45 }), [405, 315], [1, 2]],
    ["V2 90° (Ducati)", layout("v", 2, { bankAngleDeg: 90 }), [450, 270], [1, 2]],
    ["boxer twin", layout("boxer", 2), [360, 360], [1, 2]],
    ["inline triple", layout("inline", 3), [240, 240, 240], [1, 2, 3]],
    ["inline four flatplane", layout("inline", 4), [180, 180, 180, 180], [1, 3, 4, 2]],
    ["inline four crossplane (R1)", layout("inline", 4, { crossplaneI4: true }), [270, 180, 90, 180], [1, 3, 2, 4]],
  ];
  for (const [name, cfg, iv, order] of cases) {
    test(name, () => {
      const s = summarize(cfg);
      expect(s.firingIntervalsDeg).toEqual(iv);
      expect(s.firingIntervalsDeg.reduce((a, b) => a + b, 0)).toBe(720);
      expect(s.firingOrder).toEqual(order);
    });
  }
});

describe("motorcycle engines: limits", () => {
  const moto = ENGINE_LIBRARY.filter((e) => e.category === "motorcycle");
  test("seven motorcycle engines in the library", () => expect(moto.length).toBe(7));
  for (const e of moto) {
    test(`${e.config.name}: limiter below the mechanically safe speed (not "broken")`, () => {
      const s = summarize(e.config);
      expect(s.safeMaxRpm).toBeGreaterThan(e.config.revLimitRpm);
      expect(validateConfig(e.config).filter((w) => w.severity === "critical")).toHaveLength(0);
    });
  }
  test("titanium valves and desmodromics raise the valve-float speed", () => {
    const base = libraryConfig("lib-triumph-765-triple");
    const ti = structuredClone(base);
    ti.head.valveMaterial = "titanium";
    const desmo = structuredClone(base);
    desmo.head.desmodromic = true;
    expect(summarize(ti).safeMaxRpm).toBeGreaterThanOrEqual(summarize(base).safeMaxRpm);
    expect(summarize(desmo).safeMaxRpm).toBeGreaterThanOrEqual(summarize(base).safeMaxRpm);
  });
});

function run(cfg: EngineConfig, init: (d: Drivetrain) => void, seconds: number, pedal = 1, mode: "vehicle" | "hold-rpm" = "vehicle") {
  const sum = summarize(cfg);
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, sum);
  init(dt);
  const inp = { ...defaultInputs(), ignition: true, starter: true, dynoMode: mode, dynoTargetRpm: 4000, startWarm: true };
  let wheelie = false;
  const step = (p: number) => {
    if (mode === "vehicle") {
      const vehicle = dt.inputs(1 / 60, sim.state, p);
      sim.step(1 / 60, { ...inp, vehicle, pedal: dt.effectivePedal(p) });
    } else sim.step(1 / 60, { ...inp, pedal: p });
  };
  for (let i = 0; i < 120; i++) step(0);
  inp.starter = false;
  for (let i = 0; i < 60; i++) step(0);
  for (let i = 0; i < seconds * 60; i++) {
    if (sim.state.rpm > cfg.revLimitRpm - 250 && !dt.state.shifting && dt.state.clutch > 0.95) dt.shift(1);
    step(pedal);
    if (dt.state.wheelie) wheelie = true;
  }
  return { dt, sim, wheelie };
}

const bike = (kind: VehicleKind) => (d: Drivetrain) => {
  d.setVehicle(kind);
  d.setSpeedLimit(null);
};

describe("motorcycle on the chassis dyno", () => {
  test("vehicle presets: motorcycles use the sequential gearbox and carry CG data", () => {
    for (const k of ["superbike", "tourer"] as const) {
      expect(VEHICLES[k].gearboxes).toEqual(["sequential"]);
      expect(VEHICLES[k].params.cgHeightM).toBeGreaterThan(0);
    }
    expect(VEHICLES.superbike.params.dragCoefficient * VEHICLES.superbike.params.frontalAreaM2).toBeCloseTo(0.3, 2);
    expect(VEHICLES.tourer.params.dragCoefficient * VEHICLES.tourer.params.frontalAreaM2).toBeCloseTo(0.55, 2);
  });

  test("superbike (CBR1000RR): 0–100 wheelie-limited 2.6–3.5 s, Vmax 280–300 km/h", () => {
    const { dt, sim, wheelie } = run(libraryConfig("lib-honda-cbr1000rr-sc59"), bike("superbike"), 45);
    expect(sim.state.running).toBe(true);
    expect(wheelie).toBe(true);
    expect(dt.state.gear).toBe(6);
    expect(dt.state.t0to100S!).toBeGreaterThan(2.6);
    expect(dt.state.t0to100S!).toBeLessThan(3.5);
    expect(dt.state.maxSpeedKmh).toBeGreaterThan(280);
    expect(dt.state.maxSpeedKmh).toBeLessThan(300);
  });

  test("tourer (BMW R 1250): 0–100 3.5–5.5 s, Vmax 200–240 km/h", () => {
    const { dt, sim } = run(libraryConfig("lib-bmw-r1250-boxer"), bike("tourer"), 45);
    expect(sim.state.running).toBe(true);
    expect(dt.state.t0to100S!).toBeGreaterThan(3.5);
    expect(dt.state.t0to100S!).toBeLessThan(5.5);
    expect(dt.state.maxSpeedKmh).toBeGreaterThan(200);
    expect(dt.state.maxSpeedKmh).toBeLessThan(240);
  });

  test("quickshifter: upshift takes ≈ 50 ms with ignition cut, no lift-off needed", () => {
    const cfg = libraryConfig("lib-honda-cbr1000rr-sc59");
    const d = new Drivetrain(cfg, summarize(cfg));
    d.setVehicle("superbike");
    d.shift(1);
    expect(d.state.shifting).toBe(true);
    expect(d.effectivePedal(1)).toBe(0);
    const running = { ...new EngineSimulator(cfg).state, running: true, rpm: 8000, vehicleSpeedMs: 20 };
    d.inputs(0.03, running, 1);
    expect(d.state.shifting).toBe(true);
    d.inputs(0.03, running, 1);
    expect(d.state.shifting).toBe(false);
    expect(d.effectivePedal(1)).toBe(1);
  });

  test("Vmax governor also works with the motorcycle", () => {
    const { dt } = run(libraryConfig("lib-honda-cbr1000rr-sc59"), (d) => { d.setVehicle("superbike"); d.setSpeedLimit(250); }, 40);
    expect(dt.state.maxSpeedKmh).toBeLessThan(256);
    expect(dt.state.maxSpeedKmh).toBeGreaterThan(240);
  });
});

describe("air / oil-air cooling", () => {
  const harley = () => libraryConfig("lib-harley-m8-107");
  test("engine dyno without ram air: head overheats within ≈ 2 min at full load", () => {
    const { sim } = run(harley(), () => {}, 100, 1, "hold-rpm");
    expect(sim.state.coolantC).toBeGreaterThan(220);
  });
  test("riding at speed: head temperature stays in the normal band (120 … 200 °C)", () => {
    const { sim, dt } = run(harley(), (d) => { d.setVehicle("tourer"); d.setSpeedLimit(null); }, 240);
    expect(dt.state.speedKmh).toBeGreaterThan(120);
    expect(sim.state.coolantC).toBeGreaterThan(120);
    expect(sim.state.coolantC).toBeLessThan(200);
    expect(sim.state.destroyed).toBe(false);
  });
  test("liquid cooling unchanged when the type is set explicitly", () => {
    const a = defaultConfig("petrol");
    const b = structuredClone(a);
    b.cooling.type = "liquid";
    const ra = run(a, () => {}, 30, 1, "hold-rpm").sim.state.coolantC;
    const rb = run(b, () => {}, 30, 1, "hold-rpm").sim.state.coolantC;
    expect(rb).toBeCloseTo(ra, 6);
  });
});
