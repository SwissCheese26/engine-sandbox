// Issue #14 remainder: own gear ratios and "Abstufung", converter automatic, traction diagram, manual blip.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VEHICLE, Drivetrain, EngineSimulator, GEARBOXES, VEHICLES, converterCapacity, converterK, converterTorqueRatio,
  converterTorques, defaultInputs, drivingResistanceN, dynoSweep, gradedRatios, summarize, theoreticalVmax, tractionCurves, validateRatios,
} from "../../src/core/index.ts";
import type { EngineConfig, GearboxType } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { libraryCar } from "../../src/data/vehicle-library.ts";

function rig(cfg: EngineConfig, type: GearboxType) {
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg), type);
  const inp = { ...defaultInputs(), ignition: true, starter: true, startWarm: true, dynoMode: "vehicle" as const };
  const h = 1 / 60;
  const step = (pedal: number, brake = 0) => {
    const vehicle = dt.inputs(h, sim.state, pedal, brake);
    sim.step(h, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
    return vehicle;
  };
  for (let i = 0; i < 240; i++) {
    if (i === 90) inp.starter = false;
    step(0, 1);
  }
  return { sim, dt, step, h };
}

describe("gear ratios and Abstufung (issue #14)", () => {
  test("validateRatios: count, range, strictly descending", () => {
    expect(validateRatios(GEARBOXES.manual.ratios)).toBeNull();
    expect(validateRatios([3, 2, 1])).not.toBeNull();
    expect(validateRatios([4, 3, 2, 1, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.38, 0.36, 0.34])).not.toBeNull();
    expect(validateRatios([3, 2, 2, 1])).not.toBeNull();
    expect(validateRatios([3, 2, 1, -1])).not.toBeNull();
    expect(validateRatios([3, 2, Number.NaN, 1])).not.toBeNull();
  });

  test("geometric: constant step, ends exact; progressive: steps shrink towards the top", () => {
    const geo = gradedRatios(4, 0.7, 6, 1);
    expect(geo).toHaveLength(6);
    expect(geo[0]).toBeCloseTo(4, 2);
    expect(geo[5]).toBeCloseTo(0.7, 2);
    const steps = geo.slice(1).map((r, k) => geo[k]! / r);
    for (const s of steps) expect(s).toBeCloseTo(steps[0]!, 2);
    const pro = gradedRatios(4, 0.7, 6, 1.1);
    expect(pro[0]).toBeCloseTo(4, 2);
    expect(pro[5]).toBeCloseTo(0.7, 2);
    const ps = pro.slice(1).map((r, k) => pro[k]! / r);
    for (let k = 1; k < ps.length; k++) expect(ps[k]!).toBeLessThan(ps[k - 1]!);
    expect(validateRatios(pro)).toBeNull();
    // too much progression for a small spread is reduced, still a valid descending set
    expect(validateRatios(gradedRatios(2, 1.2, 10, 1.3))).toBeNull();
  });

  test("Drivetrain.setRatios: own count and ratios at standstill, rejected while rolling or invalid", () => {
    const cfg = defaultConfig("petrol");
    const dt = new Drivetrain(cfg, summarize(cfg), "manual");
    expect(dt.setRatios([3, 2, 3, 1])).not.toBeNull();
    expect(dt.gearbox.ratios).toEqual(GEARBOXES.manual.ratios);
    const r = gradedRatios(3.5, 0.6, 8, 1.1);
    expect(dt.setRatios(r)).toBeNull();
    expect(dt.state.gearCount).toBe(8);
    expect(dt.gearbox.ratios).toEqual(r);
    expect(GEARBOXES.manual.ratios).toHaveLength(6); // the generic table is not touched
    dt.setType("cvt");
    expect(dt.setRatios(r)).not.toBeNull();
  });

  test("a longer top gear raises the theoretical Vmax when the limiter decided", () => {
    const cfg = defaultConfig("petrol");
    const sweep = dynoSweep(cfg, { stepRpm: 100 });
    const tq = (rpm: number) => sweep.reduce((b, p) => (Math.abs(p.rpm - rpm) < Math.abs(b.rpm - rpm) ? p : b)).torqueNm;
    const short = { ...GEARBOXES.manual, ratios: gradedRatios(3.77, 1.3, 6, 1.1) };
    const long = { ...GEARBOXES.manual, ratios: gradedRatios(3.77, 0.75, 6, 1.1) };
    const a = theoreticalVmax(tq, cfg.revLimitRpm, "manual", 3.45, DEFAULT_VEHICLE, short);
    const b = theoreticalVmax(tq, cfg.revLimitRpm, "manual", 3.45, DEFAULT_VEHICLE, long);
    expect(a.limitedBy).toBe("limiter");
    expect(b.vmaxKmh).toBeGreaterThan(a.vmaxKmh);
  });
});

describe("torque converter characteristic (issue #14, vehicle.md §4)", () => {
  const c = { kFactor: 120, stallTorqueRatio: 2, couplingPoint: 0.87 };
  test("torque ratio 2 at stall, 1 from the coupling point; capacity 0 at ν = 1", () => {
    expect(converterTorqueRatio(0, 2, 0.87)).toBe(2);
    expect(converterTorqueRatio(0.87, 2, 0.87)).toBe(1);
    expect(converterTorqueRatio(0.95, 2, 0.87)).toBe(1);
    expect(converterTorqueRatio(0.435, 2, 0.87)).toBeCloseTo(1.5, 6);
    expect(converterCapacity(0, 0.87)).toBe(1);
    expect(converterCapacity(1, 0.87)).toBe(0);
    expect(converterCapacity(0.87, 0.87)).toBeCloseTo(0.8, 6);
  });

  test("stall: K from stall speed and torque; turbine torque = μ₀ × pump torque; no torque at ν = 1", () => {
    const K = converterK(2300, 400);
    const t = converterTorques({ ...c, kFactor: K }, 2300, 0);
    expect(t.pumpNm).toBeCloseTo(400, 3);
    expect(t.turbineNm).toBeCloseTo(800, 3);
    expect(converterTorques(c, 3000, 3000).pumpNm).toBeCloseTo(0, 9);
    // efficiency μ·ν peaks near the coupling point, ≤ 1
    const eff = (nu: number) => { const x = converterTorques(c, 2000, 2000 * nu); return (x.turbineNm * nu) / x.pumpNm; };
    expect(eff(0.87)).toBeCloseTo(0.87, 6);
    expect(eff(0.5)).toBeLessThan(eff(0.8));
    // overrun: the wheels drive the engine, braking torque on both sides
    const o = converterTorques(c, 1000, 2000);
    expect(o.pumpNm).toBeLessThan(0);
    expect(o.turbineNm).toBe(o.pumpNm);
    expect(converterTorques(c, 0, 2000).pumpNm).toBe(0);
  });
});

describe("converter automatic in the simulator (issue #14)", () => {
  const cfg = libraryConfig("lib-bmw-m57d30tu2");

  test("D at idle: holds against the brake without stalling, creeps 3–10 km/h without it", () => {
    const { sim, dt, step } = rig(cfg, "automatic");
    expect(dt.gearLabel()).toBe("D1");
    for (let i = 0; i < 120; i++) step(0, 1);
    expect(sim.state.running).toBe(true);
    expect(dt.state.speedKmh).toBeLessThan(0.5);
    // the converter loads the idling engine ((n/K)² ≈ 30–80 Nm)
    expect(sim.state.torqueNm).toBeGreaterThan(20);
    for (let i = 0; i < 15 * 60; i++) step(0);
    expect(sim.state.running).toBe(true);
    expect(dt.state.speedKmh).toBeGreaterThan(3);
    expect(dt.state.speedKmh).toBeLessThan(10);
    expect(dt.state.clutch).toBe(0); // lock-up open while creeping
  });

  test("launch: converter multiplies torque (turbine slower than engine), lock-up closes later, upshifts through D", () => {
    const { sim, dt, step } = rig(cfg, "automatic");
    let sawMultiplication = false;
    let maxGear = 1;
    for (let i = 0; i < 40 * 60; i++) {
      const c = step(1);
      if (i < 30 && c.converter && dt.state.speedKmh < 15) {
        const tIn = (dt.state.speedKmh / 3.6 / dt.vehicle.wheelRadiusM) * c.totalRatio * 30 / Math.PI;
        if (tIn < 0.5 * sim.state.rpm) sawMultiplication = true;
      }
      expect(sim.state.rpm).toBeLessThan(cfg.revLimitRpm + 150);
      maxGear = Math.max(maxGear, dt.state.gear);
    }
    expect(sawMultiplication).toBe(true);
    expect(sim.state.running).toBe(true);
    expect(dt.state.clutch).toBeGreaterThan(0.95);
    expect(maxGear).toBeGreaterThanOrEqual(6);
    expect(dt.state.t0to100S!).toBeGreaterThan(5);
    expect(dt.state.t0to100S!).toBeLessThan(11);
  });

  test("tip mode and back to D like the DSG", () => {
    const { dt } = rig(cfg, "automatic");
    dt.shift(1);
    expect(dt.state.manualMode).toBe(true);
    expect(dt.gearLabel()).toMatch(/^M/);
    dt.setAutomatic();
    expect(dt.gearLabel()).toMatch(/^D/);
  });

  test("library: Citaro and the converter cars use the converter automatic", () => {
    expect(VEHICLES.bus.gearboxes).toEqual(["automatic"]);
    for (const id of ["bus-mercedes-citaro-o530", "car-bmw-530d-e60", "car-mercedes-e220d", "car-toyota-land-cruiser-120"]) {
      const car = libraryCar(id);
      expect(car.setup.gearbox).toBe("automatic");
      expect(car.setup.gearboxSpec!.converter!.stallTorqueRatio).toBeGreaterThanOrEqual(1.6);
    }
  });
});

describe("traction diagram (issue #14, vehicle.md §6)", () => {
  const cfg = defaultConfig("petrol");
  const sum = summarize(cfg);
  const sweep = dynoSweep(cfg, { stepRpm: 100 });
  const setup = (ratios: number[], finalDrive = 3.45) => ({ type: "manual" as const, spec: { ...GEARBOXES.manual, ratios }, finalDrive, vehicle: DEFAULT_VEHICLE });

  test("one curve per gear; force × speed ≈ power × η; force falls from gear to gear", () => {
    const t = tractionCurves(sweep, cfg.revLimitRpm, sum.peakPowerRpm, setup(GEARBOXES.manual.ratios));
    expect(t.gears).toHaveLength(6);
    for (let k = 1; k < 6; k++) expect(Math.max(...t.gears[k]!.points.map((p) => p.forceN))).toBeLessThan(Math.max(...t.gears[k - 1]!.points.map((p) => p.forceN)));
    const pmax = Math.max(...t.gears[2]!.points.map((p) => (p.forceN * p.kmh) / 3.6 / 1000));
    expect(pmax).toBeGreaterThan(sum.peakPowerKw * GEARBOXES.manual.efficiency * 0.97);
    expect(pmax).toBeLessThan(sum.peakPowerKw * GEARBOXES.manual.efficiency * 1.01);
    // resistance: rolling at 0, + air
    expect(t.resistance[0]!.forceN).toBeCloseTo(DEFAULT_VEHICLE.rollingResistance * DEFAULT_VEHICLE.massKg * 9.81, 3);
    expect(drivingResistanceN(DEFAULT_VEHICLE, 100, { gradePct: 10 })).toBeGreaterThan(drivingResistanceN(DEFAULT_VEHICLE, 100) + 1300);
  });

  test("Vmax agrees with theoreticalVmax", () => {
    const t = tractionCurves(sweep, cfg.revLimitRpm, sum.peakPowerRpm, setup(GEARBOXES.manual.ratios));
    const tq = (rpm: number) => sweep.reduce((b, p) => (Math.abs(p.rpm - rpm) < Math.abs(b.rpm - rpm) ? p : b)).torqueNm;
    const ref = theoreticalVmax(tq, cfg.revLimitRpm, "manual", 3.45, DEFAULT_VEHICLE);
    expect(Math.abs(t.vmax.kmh - ref.vmaxKmh)).toBeLessThan(3);
  });

  test("verdict: short top gear → limiter (zu kurz), overdrive → zu lang, matched → passend", () => {
    const short = tractionCurves(sweep, cfg.revLimitRpm, sum.peakPowerRpm, setup(gradedRatios(3.77, 1.4, 6, 1.1)));
    expect(short.vmax.limitedBy).toBe("limiter");
    expect(short.verdict).toBe("zu-kurz");
    const long = tractionCurves(sweep, cfg.revLimitRpm, sum.peakPowerRpm, setup(gradedRatios(3.77, 0.5, 6, 1.1)));
    expect(long.verdict).toBe("zu-lang");
    // top gear chosen so the intersection lies at the power peak
    let best = { d: Infinity, top: 1 };
    for (let top = 0.5; top <= 1.4; top += 0.01) {
      const t = tractionCurves(sweep, cfg.revLimitRpm, sum.peakPowerRpm, setup(gradedRatios(3.77, top, 6, 1.1)));
      if (t.vmax.limitedBy === "resistance" && t.vmax.gear === 6) {
        const d = Math.abs(t.vmax.rpm - sum.peakPowerRpm);
        if (d < best.d) best = { d, top };
      }
    }
    const matched = tractionCurves(sweep, cfg.revLimitRpm, sum.peakPowerRpm, setup(gradedRatios(3.77, best.top, 6, 1.1)));
    expect(matched.verdict).toBe("passend");
    // the matched gearing is the fastest of the three
    expect(matched.vmax.kmh).toBeGreaterThanOrEqual(long.vmax.kmh);
    expect(matched.vmax.kmh).toBeGreaterThanOrEqual(short.vmax.kmh);
  });

  test("uphill lowers Vmax; CVT gives a single envelope", () => {
    const flat = tractionCurves(sweep, cfg.revLimitRpm, sum.peakPowerRpm, setup(GEARBOXES.manual.ratios));
    const hill = tractionCurves(sweep, cfg.revLimitRpm, sum.peakPowerRpm, setup(GEARBOXES.manual.ratios), { gradePct: 8 });
    expect(hill.vmax.kmh).toBeLessThan(flat.vmax.kmh - 20);
    const cvt = tractionCurves(sweep, cfg.revLimitRpm, sum.peakPowerRpm, { type: "cvt", spec: GEARBOXES.cvt, finalDrive: GEARBOXES.cvt.finalDrive, vehicle: DEFAULT_VEHICLE });
    expect(cvt.gears).toHaveLength(1);
    expect(cvt.vmax.kmh).toBeGreaterThan(150);
  });
});

describe("manual downshift blip (Zwischengas, issue #14)", () => {
  test("the driver blips while the clutch is open on a downshift, lifts on an upshift", () => {
    const cfg = defaultConfig("petrol");
    const { dt, step } = rig(cfg, "manual");
    for (let i = 0; i < 6 * 60; i++) {
      if (dt.state.gear < 3 && !dt.state.shifting && dt.state.clutch > 0.95 && i % 60 === 0 && i > 60) dt.shift(1);
      step(1);
    }
    expect(dt.state.gear).toBe(3);
    dt.shift(1);
    expect(dt.effectivePedal(1)).toBe(0);
    for (let i = 0; i < 60; i++) step(0.3);
    dt.shift(-1);
    step(0.3);
    expect(dt.state.shifting).toBe(true);
    expect(dt.effectivePedal(0.3)).toBeGreaterThan(0.1);
  });
});
