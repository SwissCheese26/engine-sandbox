// 0–100 km/h timer: starts on a standing launch under throttle, discards runs with lift-off or brake
import { describe, expect, test } from "bun:test";
import { Drivetrain, EngineSimulator, defaultInputs, summarize } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { libraryCar } from "../../src/data/vehicle-library.ts";

function rig() {
  const car = libraryCar("car-vw-golf7-gti");
  const cfg = libraryConfig(car.engineId);
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg));
  dt.applyCar(car.setup);
  const inp = { ...defaultInputs(), ignition: true, starter: true, startWarm: true, dynoMode: "vehicle" as const };
  const h = 1 / 60;
  const step = (pedal: number, brake = 0) => {
    const vehicle = dt.inputs(h, sim.state, pedal, brake);
    sim.step(h, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
  };
  for (let i = 0; i < 90; i++) step(0, 1);
  inp.starter = false;
  for (let i = 0; i < 150; i++) step(0, 1);
  return { dt, step, h };
}

describe("0–100 km/h timer", () => {
  test("revving against the brake does not start the timer", () => {
    const { dt, step } = rig();
    for (let i = 0; i < 120; i++) step(1, 1);
    expect(dt.state.t0to100Running).toBeNull();
  });

  test("a full-throttle standing start is timed", () => {
    const { dt, step } = rig();
    for (let i = 0; i < 60 * 20 && dt.state.t0to100S === null; i++) step(1);
    expect(dt.state.t0to100S).not.toBeNull();
  });

  test("lifting off during the run discards it", () => {
    const { dt, step } = rig();
    for (let i = 0; i < 120; i++) step(1); // 2 s full throttle
    expect(dt.state.t0to100Running).not.toBeNull();
    for (let i = 0; i < 60; i++) step(0); // 1 s off the throttle
    expect(dt.state.t0to100Running).toBeNull();
    for (let i = 0; i < 60 * 20; i++) step(1); // back on: rolling, no new run
    expect(dt.state.t0to100S).toBeNull();
  });

  test("a short shift pause does not discard the run", () => {
    const { dt, step } = rig();
    for (let i = 0; i < 120; i++) step(1);
    for (let i = 0; i < 15; i++) step(0); // 0.25 s
    expect(dt.state.t0to100Running).not.toBeNull();
  });
});
