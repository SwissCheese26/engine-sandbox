// Issue #53: gearbox oil temperature (src/core/gearbox-thermal.ts, docs/research/vehicle.md §8).
import { describe, expect, test } from "bun:test";
import {
  AFTERMARKET_OIL_COOLER_WK, AUX_COOLER_EXPONENT, Drivetrain, EngineSimulator, GEARBOX_THERMAL, converterTorques, defaultInputs, gearboxDragPenalty, gearboxThermalKind, gearboxViscosityFactor, gearboxWearRate,
  stepGearboxOil, summarize,
} from "../../src/core/index.ts";
import type { EngineConfig, GearboxOilInput, GearboxType, SimInputs } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";

/** Compact car at constant speed: engine power for rolling + aero (1450 kg, cW·A 0.66 m²), η 0.93. */
function cruise(kmh: number, ratio: number, eta: number, extra: Partial<GearboxOilInput> = {}): GearboxOilInput {
  const v = kmh / 3.6;
  const pWheel = (0.011 * 1450 * 9.81 + 0.5 * 1.2 * 0.66 * v * v) * v;
  const shaftRpm = (v / 0.308) * ratio * (30 / Math.PI);
  return { powerW: pWheel / eta, efficiency: eta, clutchSlipW: 0, converterSlipW: 0, shaftRpm, airSpeedMs: v, ambientC: 20, coolantC: 90, cooler: true, ...extra };
}

/** Pure model run for `seconds` at 1 s steps; returns the temperature every minute. */
function run(kind: keyof typeof GEARBOX_THERMAL, x: GearboxOilInput, seconds: number, startC = 20): number[] {
  const spec = GEARBOX_THERMAL[kind];
  let t = startC;
  const out: number[] = [t];
  for (let i = 1; i <= seconds; i++) {
    t = stepGearboxOil(spec, t, 1, x);
    if (i % 60 === 0) out.push(t);
  }
  return out;
}

describe("gearbox oil model (pure)", () => {
  test("warm-up curve: monotonic, slow at first (minutes), settles in the realistic band", () => {
    // manual 6th gear (0.71 × 3.45) at 100 km/h
    const curve = run("manual", cruise(100, 0.71 * 3.45, 0.93), 60 * 60);
    for (let k = 1; k < curve.length; k++) expect(curve[k]!).toBeGreaterThanOrEqual(curve[k - 1]! - 1e-9);
    expect(curve[2]!).toBeLessThan(40); // after 2 min still cool: lumped m·c ≈ 24 kJ/K
    expect(curve[10]!).toBeGreaterThan(40);
    expect(curve[60]!).toBeGreaterThan(65);
    expect(curve[60]!).toBeLessThan(90);
  });

  test("steady motorway (120 km/h) temperature in a realistic band per gearbox type", () => {
    const manual = run("manual", cruise(120, 0.71 * 3.45, 0.93), 3 * 3600).at(-1)!;
    expect(manual).toBeGreaterThan(75);
    expect(manual).toBeLessThan(95);
    // ATF with the oil-to-water heat exchanger: close to the coolant, 80–95 °C (ZF/Aisin, vehicle.md §8)
    const atf = run("automatic", cruise(120, 0.667 * 3.2, 0.91), 3 * 3600).at(-1)!;
    expect(atf).toBeGreaterThan(80);
    expect(atf).toBeLessThan(97);
    const dct = run("dct", cruise(120, 0.55 * 3.9, 0.92), 3 * 3600).at(-1)!;
    expect(dct).toBeGreaterThan(80);
    expect(dct).toBeLessThan(97);
    // city traffic stays cooler than the motorway
    const city = run("manual", cruise(50, 1.47 * 3.45, 0.93), 3 * 3600).at(-1)!;
    expect(city).toBeLessThan(manual);
  });

  test("heat rises with load and clutch slip, falls at standstill and with ram air", () => {
    const spec = GEARBOX_THERMAL.dct;
    const base = cruise(80, 1.02 * 3.9, 0.92);
    const dT = (x: GearboxOilInput) => stepGearboxOil(spec, 80, 10, x) - 80;
    expect(dT({ ...base, powerW: base.powerW * 3 })).toBeGreaterThan(dT(base));
    expect(dT({ ...base, clutchSlipW: 20000 })).toBeGreaterThan(dT(base) + 2);
    // standing with the engine off: cools towards ambient / coolant; ram air cools faster than standstill
    const off = { ...base, powerW: 0, shaftRpm: 0, coolantC: 20 };
    expect(dT({ ...off, airSpeedMs: 0 })).toBeLessThan(0);
    expect(dT({ ...off, airSpeedMs: 30 })).toBeLessThan(dT({ ...off, airSpeedMs: 0 }));
    // a dry clutch (manual) puts only a share of its heat into the oil
    expect(GEARBOX_THERMAL.manual.clutchOilShare).toBeLessThan(GEARBOX_THERMAL.dct.clutchOilShare);
  });

  test("cold oil: higher viscosity, more drag", () => {
    expect(gearboxViscosityFactor(-10)).toBeGreaterThan(gearboxViscosityFactor(20));
    expect(gearboxViscosityFactor(20)).toBeGreaterThan(3);
    expect(gearboxDragPenalty(90)).toBe(0);
    expect(gearboxDragPenalty(20)).toBeGreaterThan(0.01);
    expect(gearboxDragPenalty(-30)).toBeGreaterThan(gearboxDragPenalty(20));
    expect(gearboxDragPenalty(-60)).toBeLessThanOrEqual(0.05);
  });

  test("damage rate: none below the warning, doubles per 10 K", () => {
    const s = GEARBOX_THERMAL.automatic;
    expect(gearboxWearRate(s, 110)).toBe(0);
    expect(gearboxWearRate(s, 150)).toBeCloseTo(1 / 600, 6);
    expect(gearboxWearRate(s, 140) * 2).toBeCloseTo(gearboxWearRate(s, 150), 9);
  });

  test("spec per vehicle: truck and bus have their own, motorcycle shares the engine sump", () => {
    expect(gearboxThermalKind("dsg", "truck")).toBe("truck");
    expect(gearboxThermalKind("automatic", "bus")).toBe("bus");
    expect(gearboxThermalKind("dsg")).toBe("dct");
    expect(GEARBOX_THERMAL.sequential.sharedSump).toBe(true);
    expect(GEARBOX_THERMAL.manual.protectC).toBeNull();
    expect(GEARBOX_THERMAL.automatic.protectC).not.toBeNull();
  });
});

function rig(cfg: EngineConfig, type: GearboxType, warm = true, setup?: (d: Drivetrain) => void) {
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg), type);
  setup?.(dt);
  // the engine itself never breaks here: the gearbox damage level is set on the drivetrain
  const inp: SimInputs = { ...defaultInputs(), ignition: true, starter: true, startWarm: warm, dynoMode: "vehicle", damage: "off" };
  const h = 1 / 30;
  const step = (pedal: number, brake = 0) => {
    const vehicle = dt.inputs(h, sim.state, pedal, brake);
    sim.step(h, { ...inp, ...dt.simInputs(), vehicle, pedal: dt.effectivePedal(pedal) });
    return vehicle;
  };
  for (let i = 0; i < 120; i++) {
    if (i === 45) inp.starter = false;
    step(0, 1);
  }
  return { sim, dt, step, h };
}

describe("gearbox oil in the drivetrain", () => {
  const cfg = defaultConfig("petrol");

  test("starts at ambient when cold, warm with 'Motor warm starten'", () => {
    const cold = rig(cfg, "manual", false);
    expect(cold.dt.state.gearboxOilC!).toBeCloseTo(20, 0);
    const warm = rig(cfg, "manual", true);
    expect(warm.dt.state.gearboxOilC!).toBeGreaterThan(70);
    expect(warm.dt.state.gearboxOilC!).toBeLessThanOrEqual(81);
    // cold oil costs efficiency, warm does not
    expect(cold.step(0, 1).efficiency).toBeLessThan(warm.step(0, 1).efficiency);
  });

  test("converter stall (bus starting on a 20 % hill it cannot climb) heats the ATF quickly, far faster than idling in D", () => {
    const diesel = defaultConfig("diesel");
    const hill = (pedal: number) => {
      const r = rig(diesel, "automatic", true, (d) => {
        d.setVehicle("bus");
        d.setEnvironment({ gradePct: 20 });
      });
      const t0 = r.dt.state.gearboxOilC!;
      for (let i = 0; i < 30 * 30; i++) r.step(pedal, pedal > 0 ? 0 : 1);
      return { r, rise: r.dt.state.gearboxOilC! - t0 };
    };
    const idle = hill(0);
    const stall = hill(1);
    // the bus does not move: turbine at rest, the whole pump power goes into the ATF (vehicle.md §8)
    expect(stall.r.dt.state.speedKmh).toBeLessThan(1);
    expect(stall.r.dt.state.clutch).toBe(0);
    expect(stall.rise).toBeGreaterThan(5);
    expect(stall.rise).toBeGreaterThan(5 * Math.max(0.2, idle.rise));
  });

  test("converter stall in the pure model: pump power into the oil ≈ P / m·c", () => {
    const spec = GEARBOX_THERMAL.automatic;
    const conv = { kFactor: 2300 / Math.sqrt(250), stallTorqueRatio: 2, couplingPoint: 0.87 };
    const t = converterTorques(conv, 2300, 0);
    const pW = t.pumpNm * 2300 * (Math.PI / 30);
    expect(pW).toBeGreaterThan(50000);
    const x: GearboxOilInput = { powerW: 0, efficiency: 0.91, clutchSlipW: 0, converterSlipW: pW, shaftRpm: 0, airSpeedMs: 0, ambientC: 20, coolantC: 90, cooler: true };
    const rate = (stepGearboxOil(spec, 90, 5, x) - 90) / 5;
    expect(rate).toBeGreaterThan(0.8);
    expect(rate).toBeLessThan(1.3);
  });

  test("overheat (full throttle against the brake, no cooler): warning from 120 °C, protection mode from 130 °C limits the pedal", () => {
    const { dt, step } = rig(cfg, "automatic");
    dt.setGearboxCooler(false);
    let warnAt = Number.NaN;
    for (let i = 0; i < 400 * 30 && !dt.state.gearboxProtect; i++) {
      step(1, 1);
      if (dt.state.gearboxOilWarn && Number.isNaN(warnAt)) warnAt = dt.state.gearboxOilC!;
    }
    expect(warnAt).toBeGreaterThanOrEqual(120);
    expect(warnAt).toBeLessThan(122);
    expect(dt.state.gearboxProtect).toBe(true);
    expect(dt.state.gearboxOilC!).toBeGreaterThanOrEqual(130);
    expect(dt.effectivePedal(1)).toBeLessThanOrEqual(0.5);
    expect(dt.state.gearboxWear!).toBeGreaterThan(0);
    // reset: a fresh gearbox
    dt.reset();
    expect(dt.state.gearboxWear).toBe(0);
    expect(dt.state.gearboxProtect).toBe(false);
  });

  test("realism off: warning shown, but no protection mode and no damage", () => {
    const { dt, step } = rig(cfg, "automatic");
    dt.setDamageLevel("off");
    dt.setGearboxCooler(false);
    for (let i = 0; i < 300 * 30 && dt.state.gearboxOilC! < 135; i++) step(1, 1);
    expect(dt.state.gearboxOilC!).toBeGreaterThanOrEqual(135);
    expect(dt.state.gearboxOilWarn).toBe(true);
    expect(dt.state.gearboxProtect).toBe(false);
    expect(dt.state.gearboxWear).toBe(0);
    expect(dt.state.gearboxFailed).toBe(false);
    expect(dt.effectivePedal(1)).toBe(1);
  });

  test("lenient: wear never reaches a failure", () => {
    const { dt } = rig(cfg, "automatic");
    dt.setDamageLevel("lenient");
    expect(dt.state.gearboxFailed).toBe(false);
    expect(dt.state.gearboxWear!).toBeLessThan(1);
  });
});

describe("aftermarket air-to-oil cooler (#100 addendum, vehicle.md §8 [B19])", () => {
  test("Setrab Series 6, 19 rows: ≈ 160 W/K at speed, exponent ≈ 0.54 from the 3 → 8 m/s correction", () => {
    expect(AFTERMARKET_OIL_COOLER_WK).toBeGreaterThanOrEqual(150);
    expect(AFTERMARKET_OIL_COOLER_WK).toBeLessThanOrEqual(400);
    expect(AUX_COOLER_EXPONENT).toBeCloseTo(Math.log(1.7) / Math.log(8 / 3), 2);
  });

  test("steady state under load drops with the cooler (manual, hard motorway run, hot day)", () => {
    // 200 km/h in 5th gear on a 35 °C day: heavy load on a manual box without a factory cooler
    const hot = cruise(200, 0.86 * 3.45, 0.93, { ambientC: 35 });
    const without = run("manual", hot, 3 * 3600).at(-1)!;
    const withAux = run("manual", { ...hot, auxCoolerWK: AFTERMARKET_OIL_COOLER_WK }, 3 * 3600).at(-1)!;
    expect(without).toBeGreaterThan(100);
    expect(withAux).toBeLessThan(without - 15);
    expect(withAux).toBeGreaterThan(35);
  });

  test("no ram air, no effect: at standstill the air cooler does nothing (no fan)", () => {
    const x: GearboxOilInput = { powerW: 0, efficiency: 0.93, clutchSlipW: 2000, converterSlipW: 0, shaftRpm: 0, airSpeedMs: 0, ambientC: 20, coolantC: 90, cooler: true };
    const spec = GEARBOX_THERMAL.manual;
    expect(stepGearboxOil(spec, 90, 10, { ...x, auxCoolerWK: AFTERMARKET_OIL_COOLER_WK })).toBeCloseTo(stepGearboxOil(spec, 90, 10, x), 9);
  });

  test("drivetrain: setGearboxAuxCooler is stored and clamped", () => {
    const cfg = defaultConfig();
    const dt = new Drivetrain(cfg, summarize(cfg), "manual");
    expect(dt.gearboxAuxCoolerWK).toBe(0);
    dt.setGearboxAuxCooler(AFTERMARKET_OIL_COOLER_WK);
    expect(dt.gearboxAuxCoolerWK).toBe(AFTERMARKET_OIL_COOLER_WK);
    dt.setGearboxAuxCooler(-5);
    expect(dt.gearboxAuxCoolerWK).toBe(0);
  });
});
