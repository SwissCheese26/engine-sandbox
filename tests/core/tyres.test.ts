import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VEHICLE, Drivetrain, EngineSimulator, VEHICLES, defaultInputs, drivenAxleLoadN, parseTyreSize, speedRatingKmh,
  PEAK_SLIP, summarize, tyreForceFactor, tyreGrip, tyreRadii, tyreTempFactor,
} from "../../src/core/index.ts";
import type { CarSetup, GearboxType, TyreType, VehicleParams } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { libraryCar } from "../../src/data/vehicle-library.ts";

const G = 9.81;

describe("tyres (issue #22)", () => {
  test("225/45 R17: static radius 317 mm, dynamic ≈ 0.97 × static", () => {
    const r = tyreRadii({ widthMm: 225, aspectPct: 45, rimInch: 17 });
    expect(r.staticM).toBeCloseTo(0.31715, 4);
    expect(r.dynamicM).toBeCloseTo(0.97 * r.staticM, 6);
  });

  test("size parser accepts ETRTO notation and rejects nonsense", () => {
    expect(parseTyreSize("225/45 R17")).toEqual({ widthMm: 225, aspectPct: 45, rimInch: 17 });
    expect(parseTyreSize("295/35ZR20")).toEqual({ widthMm: 295, aspectPct: 35, rimInch: 20 });
    expect(parseTyreSize("225/45")).toBeNull();
    expect(parseTyreSize("900/45 R17")).toBeNull();
  });

  test("speed index: V 240, W 270, Y 300", () => {
    expect(speedRatingKmh("V")).toBe(240);
    expect(speedRatingKmh("W")).toBe(270);
    expect(speedRatingKmh("Y")).toBe(300);
  });

  test("μ per tyre type on dry asphalt (warm) and on snow", () => {
    const dry: Record<TyreType, number> = { standard: 1.0, winter: 0.9, uhp: 1.15, "semi-slick": 1.25, slick: 1.45, offroad: 0.8, motorcycle: 1.3 };
    for (const [t, mu] of Object.entries(dry)) expect(tyreGrip(t as TyreType, "dry", 90)).toBeCloseTo(mu, 5);
    expect(tyreGrip("winter", "snow")).toBeGreaterThan(1.5 * tyreGrip("standard", "snow"));
    expect(tyreGrip("slick", "wet")).toBeLessThan(tyreGrip("standard", "wet"));
  });

  test("force–slip curve: 0 at 0, peak μ at PEAK_SLIP (0.08–0.12), ≈ 0.9 μ spinning or locked, odd", () => {
    expect(tyreForceFactor(0)).toBe(0);
    expect(PEAK_SLIP).toBeGreaterThanOrEqual(0.08);
    expect(PEAK_SLIP).toBeLessThanOrEqual(0.12);
    expect(tyreForceFactor(PEAK_SLIP)).toBeCloseTo(1, 6);
    expect(tyreForceFactor(0.5 * PEAK_SLIP)).toBeGreaterThan(0.75);
    expect(tyreForceFactor(0.5 * PEAK_SLIP)).toBeLessThan(1);
    expect(tyreForceFactor(1)).toBeGreaterThan(0.88);
    expect(tyreForceFactor(1)).toBeLessThan(0.92);
    expect(tyreForceFactor(-0.3)).toBeCloseTo(-tyreForceFactor(0.3), 9);
    for (const sl of [0.13, 0.2, 0.4, 0.8]) expect(tyreForceFactor(sl)).toBeLessThan(1);
  });

  test("slicks need temperature: cold clearly less grip", () => {
    expect(tyreTempFactor("slick", 20)).toBeLessThan(0.75);
    expect(tyreTempFactor("slick", 85)).toBe(1);
    expect(tyreTempFactor("standard", 20)).toBe(1);
  });

  test("axle loads with load transfer ΔN = m·a·h/l", () => {
    const v: VehicleParams = { ...DEFAULT_VEHICLE };
    const w = v.massKg * G;
    const dN = (v.massKg * 5 * v.cgHeightM!) / v.wheelbaseM!;
    expect(drivenAxleLoadN(v, 0)).toBeCloseTo(w * 0.6098, -1);
    expect(drivenAxleLoadN(v, 5)).toBeCloseTo(drivenAxleLoadN(v, 0) - dN, 3);
    expect(drivenAxleLoadN({ ...v, driveLayout: "rwd" }, 5)).toBeCloseTo(w - drivenAxleLoadN(v, 0) + dN, 3);
    expect(drivenAxleLoadN({ ...v, driveLayout: "awd" }, 5)).toBeCloseTo(w, 6);
    expect(drivenAxleLoadN({ ...v, driveLayout: undefined }, 5)).toBe(Infinity);
  });
});

function rig(car: CarSetup | null, engineId: string | null, type: GearboxType = "manual") {
  const cfg = engineId ? libraryConfig(engineId) : defaultConfig("petrol");
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg), type);
  if (car) dt.applyCar(car);
  const inp = { ...defaultInputs(), ignition: true, starter: true, startWarm: true, dynoMode: "vehicle" as const };
  const step = (pedal: number, brake = 0) => {
    const vehicle = dt.inputs(1 / 60, sim.state, pedal, brake);
    sim.step(1 / 60, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
  };
  for (let i = 0; i < 90; i++) step(0);
  inp.starter = false;
  for (let i = 0; i < 150; i++) step(0);
  return { cfg, sim, dt, step };
}

describe("traction and wheel spin (issue #22)", () => {
  test("series setup (GTI, UHP) at full throttle from standstill: launch dosed at the μ peak, no burnout", () => {
    const car = libraryCar("car-vw-golf7-gti").setup;
    const { sim, step } = rig(car, "ref-vw-ea888-gen3-chhb", "dsg");
    let maxLaunchSlip = 0;
    let maxA = 0;
    let spinT = 0;
    for (let i = 0; i < 4 * 60; i++) {
      step(1);
      const s = sim.state;
      expect(Number.isFinite(s.wheelSlip ?? 0)).toBe(true);
      if ((s.vehicleSpeedMs ?? 0) > 1 && (s.vehicleSpeedMs ?? 0) < 6) maxLaunchSlip = Math.max(maxLaunchSlip, s.wheelSlip ?? 0);
      if (s.wheelSpin) spinT += 1 / 60;
      if (i > 30) maxA = Math.max(maxA, s.accelMs2 ?? 0);
    }
    expect(maxLaunchSlip).toBeLessThan(0.2);
    // after the clutch has closed, 350 Nm in 1st/2nd exceed the front-axle grip: without ASR (#23) the wheels spin
    // for a while, but no endless burnout – the car keeps pulling at about the sliding limit
    expect(spinT).toBeLessThan(3);
    expect(sim.state.vehicleSpeedMs!).toBeGreaterThan(60 / 3.6);
    // static front share 62 %, μ 1.15 → a ≤ μ·g·0.62 (load transfer only lowers it)
    expect(maxA).toBeLessThan(tyreGrip("uhp") * G * 0.62 * 1.03);
    expect(maxA).toBeGreaterThan(0.4 * G);
  });

  test("400+ kW on standard tyres: the driven wheels spin, the engine runs ahead of the road", () => {
    const car = libraryCar("car-ferrari-458").setup;
    car.tyre.type = "standard";
    const { sim, step } = rig(car, "ref-ferrari-f136fb-458", "dsg");
    let ahead = false;
    let spinT = 0;
    for (let i = 0; i < 5 * 60; i++) {
      step(1);
      const s = sim.state;
      if (s.wheelSpin) spinT += 1 / 60;
      if ((s.wheelSpeedMs ?? 0) > (s.vehicleSpeedMs ?? 0) + 3) ahead = true;
    }
    expect(ahead).toBe(true);
    expect(spinT).toBeGreaterThan(0.2);
  });

  test("same 400+ kW car spins much less as AWD than as RWD", () => {
    const spin = (layout: "rwd" | "awd") => {
      const car = libraryCar("car-ferrari-458").setup;
      car.tyre.type = "standard";
      car.vehicle.driveLayout = layout;
      const { sim, step } = rig(car, "ref-ferrari-f136fb-458", "dsg");
      let t = 0;
      for (let i = 0; i < 6 * 60; i++) { step(1); if (sim.state.wheelSpin) t += 1 / 60; }
      return t;
    };
    expect(spin("awd")).toBeLessThan(0.5 * spin("rwd") + 0.05);
  });

  test("steady cruise: small, steady positive slip without chatter", () => {
    const car = libraryCar("car-vw-golf6-tdi").setup;
    const { sim, dt, step } = rig(car, "lib-vw-ea189-20tdi-103kw");
    for (let i = 0; i < 25 * 60; i++) {
      if (sim.state.rpm > 3500 && !dt.state.shifting && dt.state.clutch > 0.95 && dt.state.gear < 5) dt.shift(1);
      step(dt.state.speedKmh > 100 ? 0.35 : 1);
    }
    let signFlips = 0;
    let last = Math.sign(sim.state.wheelSlip ?? 0);
    for (let i = 0; i < 120; i++) {
      step(0.35);
      const sl = sim.state.wheelSlip ?? 0;
      expect(Math.abs(sl)).toBeLessThan(0.05);
      if (Math.sign(sl) !== last && sl !== 0) signFlips++;
      last = Math.sign(sl);
    }
    expect(signFlips).toBeLessThan(3);
  });

  test("engine braking on ice in a low gear can lock the driven wheels", () => {
    const car = libraryCar("car-vw-golf6-tdi").setup;
    const { sim, dt, step } = rig(car, "lib-vw-ea189-20tdi-103kw");
    for (let i = 0; i < 6 * 60; i++) step(1);
    // 1st gear at speed, then ice and lift off: drag torque × 13:1 exceeds μ_ice·N
    dt.setSurface("ice");
    let minSlip = 0;
    for (let i = 0; i < 60; i++) { step(0); minSlip = Math.min(minSlip, sim.state.wheelSlip ?? 0); }
    expect(minSlip).toBeLessThan(-0.1);
  });

  test("braking from 100 km/h without ABS: wheels lock, distance ≈ v²/(2·0.9·μ·g) depends on the tyre", () => {
    const dist = (tyre: TyreType) => {
      const car = libraryCar("car-vw-golf6-tdi").setup;
      car.tyre.type = tyre;
      const { sim, dt, step } = rig(car, "lib-vw-ea189-20tdi-103kw");
      let k = 0;
      while ((sim.state.vehicleSpeedMs ?? 0) < 100 / 3.6 && k++ < 60 * 40) {
        if (sim.state.rpm > 4300 && !dt.state.shifting && dt.state.clutch > 0.95) dt.shift(1);
        step(1);
      }
      const v0 = sim.state.vehicleSpeedMs!;
      let d = 0;
      let locked = false;
      for (let i = 0; i < 60 * 12 && (sim.state.vehicleSpeedMs ?? 0) > 0.05; i++) {
        d += (sim.state.vehicleSpeedMs ?? 0) / 60;
        step(0, 1);
        if (sim.state.wheelsLocked) locked = true;
      }
      return { d, v0, locked, ideal: (v0 * v0) / (2 * 0.9 * tyreGrip(tyre) * G) };
    };
    const std = dist("standard");
    const slick = dist("uhp");
    const off = dist("offroad");
    expect(std.locked).toBe(true);
    expect(std.d).toBeGreaterThan(std.ideal * 0.85);
    expect(std.d).toBeLessThan(std.ideal * 1.1);
    expect(slick.d).toBeLessThan(std.d);
    expect(off.d).toBeGreaterThan(std.d * 1.15);
  });
});

describe("drivetrain vehicle API (issue #22)", () => {
  const cfg = defaultConfig("petrol");

  test("setTyre: wheel radius, rolling resistance and tyre rating follow the tyre", () => {
    const d = new Drivetrain(cfg, summarize(cfg));
    expect(d.state.tyreRatingKmh).toBe(270);
    d.setTyre({ type: "offroad", size: { widthMm: 265, aspectPct: 65, rimInch: 17 }, speedIndex: "S" });
    expect(d.state.tyreRatingKmh).toBe(180);
    expect(d.vehicle.wheelRadiusM).toBeCloseTo(tyreRadii({ widthMm: 265, aspectPct: 65, rimInch: 17 }).dynamicM, 6);
    expect(d.vehicle.rollingResistance).toBeGreaterThan(DEFAULT_VEHICLE.rollingResistance);
  });

  test("applyCar loads the car's gear ratios, governor and body", () => {
    const d = new Drivetrain(cfg, summarize(cfg));
    const lc = libraryCar("car-toyota-land-cruiser-120");
    d.applyCar(lc.setup);
    expect(d.state.gearCount).toBe(4);
    expect(d.state.finalDrive).toBeCloseTo(3.909, 6);
    expect(d.vehicle.driveLayout).toBe("awd");
    expect(d.state.speedLimitKmh).toBeNull();
    d.applyCar(libraryCar("car-mercedes-e220d").setup);
    expect(d.state.gearCount).toBe(9);
  });

  test("#23 hook: setSurface lowers μ in the coupling", () => {
    const d = new Drivetrain(cfg, summarize(cfg));
    const fake = { running: true, rpm: 800, vehicleSpeedMs: 0 } as Parameters<Drivetrain["inputs"]>[1];
    expect(d.inputs(1 / 60, fake, 0).grip).toBeCloseTo(1.0, 5);
    d.setSurface("wet");
    expect(d.inputs(1 / 60, fake, 0).grip).toBeCloseTo(0.7, 5);
    d.setSurface("dry", 0.5);
    expect(d.inputs(1 / 60, fake, 0).grip).toBeCloseTo(0.5, 5);
  });

  test("slicks warm up with a burnout and gain grip", () => {
    const car = libraryCar("car-bmw-m3-e46").setup;
    car.tyre.type = "slick";
    const { dt, step, sim } = rig(car, "ref-bmw-s54b32");
    const cold = dt.state.grip;
    expect(cold).toBeLessThan(1.1);
    // burnout: brake held? no – full throttle in first, wheels spin
    let spinT = 0;
    for (let i = 0; i < 5 * 60; i++) { step(1); if (sim.state.wheelSpin) spinT += 1 / 60; }
    expect(dt.state.tyreTempC).toBeGreaterThan(40);
    expect(dt.state.grip).toBeGreaterThan(cold);
    expect(spinT).toBeGreaterThan(0);
  });

  test("motorcycle presets keep their tyre and rear-wheel drive (issue #25)", () => {
    const d = new Drivetrain(cfg, summarize(cfg));
    d.setVehicle("superbike");
    expect(d.vehicle.driveLayout).toBe("rwd");
    expect(d.tyre.type).toBe("motorcycle");
    expect(d.state.type).toBe("sequential");
    expect(VEHICLES.superbike.params.wheelRadiusM).toBeCloseTo(0.31, 2);
  });
});
