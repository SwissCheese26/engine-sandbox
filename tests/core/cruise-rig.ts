// Test driver for the cruise control (issue #30): starts a library car, accelerates to a speed (manual: shifts up
// early like an everyday driver), sets the cruise control and lets the controller drive.
import { Drivetrain, EngineSimulator, TripComputer, defaultInputs, summarize } from "../../src/core/index.ts";
import type { GearboxType } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { libraryCar } from "../../src/data/vehicle-library.ts";

export const H = 1 / 60;

export function cruiseRig(carId: string, gearbox?: GearboxType) {
  const car = libraryCar(carId);
  const cfg = libraryConfig(car.engineId);
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg));
  const setup = structuredClone(car.setup);
  if (gearbox && gearbox !== setup.gearbox) setup.gearbox = gearbox;
  dt.applyCar(setup);
  const trip = new TripComputer();
  const inp = { ...defaultInputs(), ignition: true, starter: true, startWarm: true, dynoMode: "vehicle" as const };
  const step = (pedal: number, brake = 0) => {
    const vehicle = dt.inputs(H, sim.state, pedal, brake);
    sim.step(H, { ...inp, ...dt.simInputs(), vehicle, pedal: dt.effectivePedal(pedal) });
    trip.step(H, sim.state, true);
  };
  for (let i = 0; i < 90; i++) step(0);
  inp.starter = false;
  for (let i = 0; i < 150; i++) step(0);
  /** Manual: everyday upshift at `shiftRpm` up to `maxGear`. */
  const autoShift = (shiftRpm: number, maxGear: number) => {
    if (dt.state.type === "manual" && sim.state.rpm > shiftRpm && !dt.state.shifting && dt.state.clutch > 0.95 && dt.state.gear < Math.min(maxGear, dt.state.gearCount)) dt.shift(1);
  };
  /** Accelerates with `pedal` until `kmh`, then holds the pedal off. */
  const accelerateTo = (kmh: number, pedal = 0.7, shiftRpm = cfg.fuel === "diesel" ? 2600 : 3200, maxGear = 99) => {
    for (let i = 0; i < 120 * 60 && dt.state.speedKmh < kmh; i++) {
      autoShift(shiftRpm, maxGear);
      step(pedal);
    }
  };
  /** Runs `s` seconds with a driver pedal, returns min/max speed and the max |Δv| of the later half. */
  const run = (s: number, pedal = 0, brake = 0, onFrame?: (i: number) => void) => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < s * 60; i++) {
      onFrame?.(i);
      step(pedal, brake);
      if (i >= (s * 60) / 2) {
        min = Math.min(min, dt.state.speedKmh);
        max = Math.max(max, dt.state.speedKmh);
      }
    }
    return { min, max };
  };
  return { car, cfg, sim, dt, trip, step, accelerateTo, run, autoShift };
}
