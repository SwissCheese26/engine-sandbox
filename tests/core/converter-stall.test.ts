// Issue #104: stall test on the converter automatic – full throttle against the service brake in D.
// Stall speeds compared with the converter data of the library cars and the passenger-car band 1800–2600 rpm
// (docs/research/vehicle.md §4, [B6, B7]). Per-car values are estimates [S: not verified against a workshop manual]:
// BMW 530d E60 / ZF 6HP26 ≈ 2300, Mercedes E 220 d / 9G-Tronic ≈ 2300, Toyota Prado 120 / Aisin A343F ≈ 2000.
import { describe, expect, test } from "bun:test";
import { Drivetrain, EngineSimulator, defaultInputs, summarize } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { VEHICLE_LIBRARY } from "../../src/data/vehicle-library.ts";

const H = 1 / 60;

function rig(id: string) {
  const car = VEHICLE_LIBRARY.find((c) => c.id === id)!;
  const cfg = libraryConfig(car.engineId);
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg));
  dt.applyCar(car.setup);
  const inp = { ...defaultInputs(), ignition: true, starter: true, startWarm: true, dynoMode: "vehicle" as const };
  const step = (pedal: number, brake: number) => {
    const vehicle = dt.inputs(H, sim.state, pedal, brake);
    sim.step(H, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
  };
  for (let i = 0; i < 90; i++) step(0, 1);
  inp.starter = false;
  for (let i = 0; i < 150; i++) step(0, 1);
  return { car, sim, dt, step };
}

/** Full brake + pedal for `s` seconds; returns the engine speed at the end, peak speeds and spin frames. */
function stall(r: ReturnType<typeof rig>, pedal = 1, s = 4) {
  let spin = 0;
  let maxKmh = 0;
  let maxWheel = 0;
  for (let i = 0; i < s * 60; i++) {
    r.step(pedal, 1);
    if (r.sim.state.wheelSpin) spin++;
    maxKmh = Math.max(maxKmh, r.dt.state.speedKmh);
    maxWheel = Math.max(maxWheel, r.sim.state.wheelSlip ?? 0);
  }
  return { rpm: r.sim.state.rpm, spin, maxKmh, maxSlip: maxWheel };
}

describe("converter stall test (issue #104)", () => {
  for (const id of ["car-bmw-530d-e60", "car-mercedes-e220d", "car-toyota-land-cruiser-120"]) {
    test(`${id}: full throttle against the full brake settles at the stall speed, the car stays`, () => {
      const r = rig(id);
      expect(r.dt.gearLabel()).toBe("D1");
      const res = stall(r);
      const spec = r.car.setup.gearboxSpec!.converter!.stallRpm;
      // before #104: 530d ≈ 4170, E 220 d ≈ 4600 rpm (wheels spinning, turbine running)
      expect(res.rpm).toBeGreaterThan(1800);
      expect(res.rpm).toBeLessThan(2600);
      expect(Math.abs(res.rpm - spec) / spec).toBeLessThan(0.08);
      expect(res.maxKmh).toBeLessThan(0.5);
      expect(r.sim.state.running).toBe(true);
    });
  }

  test("AWD (Prado 120): the brake holds all driven wheels – no wheel spin, exact stall speed", () => {
    const r = rig("car-toyota-land-cruiser-120");
    const res = stall(r);
    expect(res.spin).toBe(0);
    expect(res.maxSlip).toBe(0);
    expect(r.dt.state.speedKmh).toBe(0);
    expect(Math.abs(res.rpm - 2000)).toBeLessThan(60);
  });

  test("RWD (530d): below the rear-brake + tyre limit the rear wheels are held too", () => {
    const r = rig("car-bmw-530d-e60");
    const res = stall(r, 0.4);
    expect(res.spin).toBe(0);
    expect(r.dt.state.speedKmh).toBe(0);
  });

  test("stall heats the ATF far faster than idling in D against the brake", () => {
    const a = rig("car-toyota-land-cruiser-120");
    const b = rig("car-toyota-land-cruiser-120");
    const oa = a.dt.state.gearboxOilC!;
    const ob = b.dt.state.gearboxOilC!;
    stall(a, 1, 5);
    stall(b, 0, 5);
    const rise = a.dt.state.gearboxOilC! - oa;
    expect(rise).toBeGreaterThan(4);
    expect(rise).toBeGreaterThan(5 * Math.max(0.1, b.dt.state.gearboxOilC! - ob));
  });

  for (const id of ["car-bmw-530d-e60", "car-toyota-land-cruiser-120"]) {
    test(`${id}: launch after releasing the brake matches a launch without the stall`, () => {
      const t30 = (pre: boolean) => {
        const r = rig(id);
        if (pre) stall(r, 1, 2);
        for (let i = 0; i < 20 * 60; i++) {
          r.step(1, 0);
          if (r.dt.state.speedKmh >= 30) return i * H;
        }
        return Infinity;
      };
      const plain = t30(false);
      expect(plain).toBeLessThan(6);
      expect(Math.abs(t30(true) - plain)).toBeLessThan(0.5);
    });
  }
});
