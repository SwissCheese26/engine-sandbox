// Test driver for electric cars (issue #108): Ready, drive mode, full throttle from standstill; the car's own traction
// control (motor-side, VehicleCoupling.asr) stays on like on the real cars. Measures 0–100 (also with 1-ft rollout),
// Vmax, SoC and energy.
import { Drivetrain, EvSimulator, defaultInputs, summarize } from "../../src/core/index.ts";
import type { EvDriveMode, SimInputs } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import type { LibraryCar } from "../../src/data/vehicle-library.ts";

/** 1 ft = 0.3048 m: US acceleration times start the clock after this distance (drag-strip rollout). */
export const ROLLOUT_M = 0.3048;

export function evRig(car: LibraryCar, mode: EvDriveMode = "plaid", gripFactor = 1) {
  const cfg = defaultConfig("petrol");
  const dt = new Drivetrain(cfg, summarize(cfg));
  dt.applyCar(car.setup);
  if (gripFactor !== 1) dt.setSurface("dry", gripFactor);
  const sim = new EvSimulator(car.setup.ev!);
  const inp: SimInputs = { ...defaultInputs(), ignition: true, startWarm: true, dynoMode: "vehicle", evDriveMode: mode };
  const h = 1 / 60;
  const step = (pedal: number, brake = 0) => {
    const vehicle = dt.inputs(h, sim.state, pedal, brake);
    return sim.step(h, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
  };
  return { dt, sim, inp, step, h };
}

export function driveEv(car: LibraryCar, seconds = 60, mode: EvDriveMode = "plaid", gripFactor = 1) {
  const r = evRig(car, mode, gripFactor);
  for (let i = 0; i < 30; i++) r.step(0, 1);
  let dist = 0;
  let tRoll: number | null = null;
  let t = 0;
  let t100: number | null = null;
  let peakKw = 0;
  let minV = Infinity;
  const soc0 = r.sim.state.ev!.soc;
  for (let i = 0; i < seconds * 60; i++) {
    const s = r.step(1);
    t += r.h;
    dist += (s.vehicleSpeedMs ?? 0) * r.h;
    if (tRoll === null && dist >= ROLLOUT_M) tRoll = t;
    if (t100 === null && r.dt.state.speedKmh >= 100) t100 = t;
    peakKw = Math.max(peakKw, s.powerKw);
    minV = Math.min(minV, s.ev!.packV);
  }
  return {
    t100, t100Rollout: t100 !== null && tRoll !== null ? t100 - tRoll : null, vmax: r.dt.state.maxSpeedKmh, peakKw, minV,
    socDrop: soc0 - r.sim.state.ev!.soc, ...r,
  };
}
