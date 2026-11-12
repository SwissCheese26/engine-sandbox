// Trucks and buses (issue #31): engine data, engine brake, ECU power limit, truck/bus presets, load, Vmax limiter.
import { describe, expect, test } from "bun:test";
import { Drivetrain, EngineSimulator, VEHICLES, defaultInputs, dynoSweep, engineBrakeTorqueNm, parseTyreSize, summarize } from "../../src/core/index.ts";
import type { EngineConfig } from "../../src/core/index.ts";
import { ENGINE_LIBRARY, libraryConfig } from "../../src/data/engine-library.ts";
import { VEHICLE_LIBRARY, libraryCar } from "../../src/data/vehicle-library.ts";

const H = 1 / 60;
const ACTROS = "truck-mercedes-actros-1845";
const CITARO = "bus-mercedes-citaro-o530";

function rig(carId: string, opts: { load?: number; gradePct?: number; cfg?: (c: EngineConfig) => void } = {}) {
  const car = libraryCar(carId);
  const cfg = libraryConfig(car.engineId);
  opts.cfg?.(cfg);
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg));
  dt.applyCar(car.setup);
  if (opts.load !== undefined) dt.setLoad(opts.load);
  dt.setEnvironment({ gradePct: opts.gradePct ?? 0 });
  const inp = { ...defaultInputs(), ignition: true, starter: true, startWarm: true, dynoMode: "vehicle" as const };
  const step = (pedal: number, brake = 0) => {
    const vehicle = dt.inputs(H, sim.state, pedal, brake);
    sim.step(H, { ...inp, ...dt.simInputs(), vehicle, pedal: dt.effectivePedal(pedal) });
  };
  for (let i = 0; i < 90; i++) step(0);
  inp.starter = false;
  for (let i = 0; i < 150; i++) step(0);
  const run = (s: number, pedal: number) => {
    for (let i = 0; i < s * 60; i++) step(pedal);
  };
  return { dt, sim, step, run, cfg };
}

describe("commercial engines (issue #31)", () => {
  const nfz = ENGINE_LIBRARY.filter((e) => e.category === "commercial");

  test("OM 471, DC16 V8 and OM 936 are in the library with engine brake and power rating", () => {
    for (const id of ["lib-mercedes-om471", "lib-scania-dc16", "lib-mercedes-om936"]) {
      const e = nfz.find((x) => x.config.id === id);
      expect(e).toBeDefined();
      expect(e!.config.engineBrake!.maxKw).toBeGreaterThan(200);
      expect(e!.config.ecuPowerLimitKw).toBe(e!.expected.peakPowerKw);
    }
  });

  for (const e of nfz) {
    test(`${e.config.name}: truck torque curve (plateau from ≈ 1000 rpm, rated power near 1800–1900 rpm)`, () => {
      const s = summarize(e.config);
      expect(s.displacementL).toBeGreaterThan(7);
      // constant-power governor: rated power is still there at the data-sheet rated speed (1800 / 1900 rpm)
      const atRated = dynoSweep(e.config, { fromRpm: e.expected.peakPowerRpm, toRpm: e.expected.peakPowerRpm })[0]!.powerKw;
      expect(atRated).toBeGreaterThan(0.95 * e.expected.peakPowerKw);
      // ≥ 85 % of the maximum torque already at 1000 rpm (the low-end pull of a truck diesel)
      const at1000 = dynoSweep(e.config, { fromRpm: 1000, toRpm: 1000 })[0]!.torqueNm;
      expect(at1000).toBeGreaterThan(0.85 * s.peakTorqueNm);
    });
  }

  test("ECU power limit holds the rated power above the plateau", () => {
    const cfg = libraryConfig("lib-mercedes-om471");
    const free = summarize({ ...cfg, ecuPowerLimitKw: undefined });
    const rated = summarize(cfg);
    expect(free.peakPowerKw).toBeGreaterThan(rated.peakPowerKw + 10);
    expect(rated.peakPowerKw).toBeLessThanOrEqual(330.5);
  });

  test("engine brake torque: only on overrun above idle, rising with rpm, ≈ maxKw at rated speed", () => {
    const cfg = libraryConfig("lib-mercedes-om471");
    const eb = cfg.engineBrake!;
    expect(engineBrakeTorqueNm(cfg, 1800, 0.2)).toBe(0);
    expect(engineBrakeTorqueNm(cfg, cfg.idleRpm + 100, 0)).toBe(0);
    const t14 = engineBrakeTorqueNm(cfg, 1400, 0);
    const tRated = engineBrakeTorqueNm(cfg, eb.ratedRpm!, 0);
    expect(tRated).toBeGreaterThan(t14);
    expect((tRated * eb.ratedRpm! * Math.PI) / 30 / 1000).toBeCloseTo(eb.maxKw, 3);
    expect(engineBrakeTorqueNm({ ...cfg, engineBrake: undefined }, 1800, 0)).toBe(0);
  });

  test("engine brake only with a gear engaged, clutch closed and no shift running (review PR #82)", () => {
    const cfg = libraryConfig("lib-mercedes-om471");
    // overrun at ≈ 1600 rpm: the vehicle drives the engine; reports whether the engine brake works
    const active = (mode: "free" | "vehicle", coupling: { clutch: number; totalRatio: number; shifting?: boolean }) => {
      const sim = new EngineSimulator(cfg);
      const inp = { ...defaultInputs(), ignition: true, starter: true, startWarm: true };
      for (let i = 0; i < 90; i++) sim.step(H, { ...inp, dynoMode: "free", pedal: 0 });
      inp.starter = false;
      for (let i = 0; i < 600 && sim.state.rpm < 1700; i++) sim.step(H, { ...inp, dynoMode: "free", pedal: 1 });
      const vehicle = { vehicle: { ...VEHICLES.truck.params, massKg: 40000 }, efficiency: 0.95, clutchCapacityNm: 3500, gradePct: -4, ...coupling };
      let on = 0;
      for (let i = 0; i < 20; i++) {
        sim.step(H, { ...inp, dynoMode: mode, pedal: 0, ...(mode === "vehicle" ? { vehicle } : {}) });
        if (sim.state.engineBrakeActive) on++;
      }
      return on;
    };
    expect(active("free", { clutch: 1, totalRatio: 5 })).toBe(0);
    expect(active("vehicle", { clutch: 0, totalRatio: 5 })).toBe(0);
    expect(active("vehicle", { clutch: 1, totalRatio: 0 })).toBe(0);
    expect(active("vehicle", { clutch: 1, totalRatio: 5, shifting: true })).toBe(0);
    expect(active("vehicle", { clutch: 1, totalRatio: 5 })).toBeGreaterThan(0);
  });
});

describe("trucks and buses on the chassis dyno (issue #31)", () => {
  test("presets: truck and bus with truck tyres, own gearbox, limiter and gross mass", () => {
    expect(VEHICLES.truck.params.dragCoefficient * VEHICLES.truck.params.frontalAreaM2).toBeGreaterThan(5.5);
    expect(VEHICLES.truck.params.dragCoefficient * VEHICLES.truck.params.frontalAreaM2).toBeLessThan(6);
    expect(VEHICLES.truck.params.rollingResistance).toBeCloseTo(0.006, 6);
    expect(VEHICLES.truck.gearboxSpec!.ratios).toHaveLength(12);
    expect(VEHICLES.truck.speedLimitKmh).toBe(85);
    expect(VEHICLES.bus.speedLimitKmh).toBe(100);
    expect(VEHICLES.bus.gearboxSpec!.converterLockRpm).toBeGreaterThan(0);
    expect(parseTyreSize("315/70 R22.5")).toEqual({ widthMm: 315, aspectPct: 70, rimInch: 22.5 });
    for (const c of VEHICLE_LIBRARY.filter((x) => x.setup.kind === "truck" || x.setup.kind === "bus")) {
      expect(c.setup.tyre.type).toBe("truck");
      expect(c.setup.fullMassKg).toBe(c.factory.grossKg!);
    }
  });

  test("load control: empty … full moves the mass, only for trucks/buses", () => {
    const { dt } = rig(ACTROS);
    expect(dt.vehicle.massKg).toBe(40000);
    dt.setLoad(0);
    expect(dt.vehicle.massKg).toBe(15000);
    dt.setLoad(0.5);
    expect(dt.vehicle.massKg).toBe(27500);
    expect(dt.load!.share).toBe(0.5);
    dt.setVehicle("car");
    expect(dt.load).toBeNull();
    const m = dt.vehicle.massKg;
    dt.setLoad(1);
    expect(dt.vehicle.massKg).toBe(m);
    dt.setVehicle("truck");
    expect(dt.state.speedLimitKmh).toBe(85);
  });

  test("limiter: back from truck/bus the car's previous limiter returns (review PR #82)", () => {
    const { dt } = rig("car-vw-golf7-gti");
    dt.setSpeedLimit(210);
    dt.setVehicle("truck");
    expect(dt.state.speedLimitKmh).toBe(85);
    dt.setVehicle("bus");
    expect(dt.state.speedLimitKmh).toBe(100);
    dt.setVehicle("car");
    expect(dt.state.speedLimitKmh).toBe(210);
    dt.setSpeedLimit(null);
    dt.applyCar(libraryCar(ACTROS).setup);
    dt.setVehicle("superbike");
    expect(dt.state.speedLimitKmh).toBeNull();
  });

  test("40 t truck: Vmax limiter holds 85 km/h on the flat, top gears, engine running", () => {
    const { dt, sim, run } = rig(ACTROS, { load: 1 });
    run(90, 1);
    expect(sim.state.running).toBe(true);
    expect(dt.state.speedKmh).toBeGreaterThan(83);
    expect(dt.state.speedKmh).toBeLessThan(87);
    expect(dt.state.gear).toBeGreaterThanOrEqual(11);
    expect(dt.state.maxSpeedKmh).toBeLessThan(88);
  }, 30000);

  test("loaded truck is clearly slower uphill (4 %) than the empty one", () => {
    const full = rig(ACTROS, { load: 1, gradePct: 4 });
    full.run(90, 1);
    const empty = rig(ACTROS, { load: 0, gradePct: 4 });
    empty.run(90, 1);
    expect(full.sim.state.running).toBe(true);
    // 40 t / 330 kW on 4 %: ≈ 50–60 km/h (P·η / (m·g·(sin α + f_R))), empty reaches the limiter
    expect(full.dt.state.speedKmh).toBeGreaterThan(40);
    expect(full.dt.state.speedKmh).toBeLessThan(65);
    expect(empty.dt.state.speedKmh).toBeGreaterThan(80);
  }, 30000);

  test("engine brake holds the loaded truck on a 4 % downhill without service brake", () => {
    const down = (withEb: boolean) => {
      const r = rig(ACTROS, { load: 1, cfg: withEb ? undefined : (c) => delete c.engineBrake });
      for (let i = 0; i < 120 * 60 && r.dt.state.speedKmh < 80; i++) r.step(1);
      r.dt.setEnvironment({ gradePct: -4 });
      let active = 0;
      for (let i = 0; i < 30 * 60; i++) {
        r.step(0);
        if (r.sim.state.engineBrakeActive) active++;
      }
      return { v: r.dt.state.speedKmh, active };
    };
    const eb = down(true);
    const coast = down(false);
    expect(eb.active).toBeGreaterThan(0);
    expect(coast.active).toBe(0);
    expect(coast.v).toBeGreaterThan(95);
    expect(eb.v).toBeLessThan(85);
    expect(eb.v).toBeLessThan(coast.v - 15);
  }, 30000);

  test("city bus: converter automatic, 100 km/h limiter", () => {
    const { dt, sim, run } = rig(CITARO);
    run(90, 1);
    expect(sim.state.running).toBe(true);
    expect(dt.state.speedKmh).toBeGreaterThan(97);
    expect(dt.state.speedKmh).toBeLessThan(102);
    expect(dt.state.gear).toBe(6);
  }, 30000);
});
