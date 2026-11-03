// Test driver for ready-made cars (issue #22): full throttle from standstill, shifts near the limiter
// (manual), modulates the throttle when the wheels spin (like a test driver), runs until Vmax settles.
import { Drivetrain, EngineSimulator, defaultInputs, summarize } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import type { LibraryCar } from "../../src/data/vehicle-library.ts";

export function driveCar(car: LibraryCar, seconds = 90, tcCut = 3, tcFloor = 0.5, tcRise = 10, gripFactor = 1, slipTarget = 0.1) {
  const cfg = libraryConfig(car.engineId);
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg));
  dt.applyCar(car.setup);
  // the test driver's own traction control below is the reference of PR #37; the real ASR (issue #23) stays off here
  dt.setAssists({ asr: false, esp: false });
  if (gripFactor !== 1) dt.setSurface("dry", gripFactor);
  const inp = { ...defaultInputs(), ignition: true, starter: true, startWarm: true, dynoMode: "vehicle" as const };
  const h = 1 / 60;
  // tc: torque factor of a simple traction control (like ASR: driver pedal stays down, engine torque is cut)
  const step = (pedal: number, tc = 1) => {
    const vehicle = dt.inputs(h, sim.state, pedal);
    sim.step(h, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) * tc });
  };
  for (let i = 0; i < 90; i++) step(0);
  inp.starter = false;
  for (let i = 0; i < 150; i++) step(0);
  let pedal = 1; // traction-control torque factor
  let spinS = 0;
  let speed80 = 0;
  for (let i = 0; i < seconds * 60; i++) {
    if (dt.state.type === "manual" && sim.state.rpm > cfg.revLimitRpm - 120 && !dt.state.shifting && dt.state.clutch > 0.95 && dt.state.gear < dt.state.gearCount) dt.shift(1);
    // traction control stand-in (the real ASR comes with #23): integral controller on the driven-wheel slip with a
    // target near the μ peak (≈ 0.1); above it the torque factor falls, below it recovers
    const slip = sim.state.wheelSlip ?? 0;
    if (sim.state.wheelSpin) spinS += h;
    pedal = Math.min(1, Math.max(tcFloor, pedal + h * (slip > slipTarget ? -tcCut * (slip - slipTarget) / slipTarget : tcRise)));
    step(1, pedal);
    if (i === (seconds - 10) * 60) speed80 = dt.state.speedKmh;
  }
  return { t100: dt.state.t0to100S, vmax: dt.state.maxSpeedKmh, settled: Math.abs(dt.state.speedKmh - speed80) < 1.5, spinS, gear: dt.state.gear, running: sim.state.running, dt, sim };
}
