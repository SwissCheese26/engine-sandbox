// Test driver for hybrid cars (issue #157): Ready, operating mode, the car's own traction control on, library engine
// warm. Measures 0–100, Vmax, fuel and SoC; `cycle` drives a speed profile with a simple speed controller.
import { Drivetrain, EvSimulator, HybridSimulator, defaultInputs, summarize } from "../../src/core/index.ts";
import type { EngineState, HybridMode, SimInputs } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import type { LibraryCar } from "../../src/data/vehicle-library.ts";

export function hybridRig(car: LibraryCar, mode: HybridMode = "hybrid", soc?: number, gripFactor = 1) {
  const cfg = libraryConfig(car.engineId);
  const dt = new Drivetrain(cfg, summarize(cfg));
  dt.applyCar(car.setup);
  if (gripFactor !== 1) dt.setSurface("dry", gripFactor);
  const sim = new HybridSimulator(car.setup.ev!, car.setup.hybrid!, cfg);
  // gross SoC, also outside the window (a battery driven empty / overcharged); HybridSimulator.setSoc would clamp
  if (soc !== undefined) EvSimulator.prototype.setSoc.call(sim, soc);
  const inp: SimInputs = { ...defaultInputs(), ignition: true, startWarm: true, dynoMode: "vehicle", hybridMode: mode };
  const h = 1 / 60;
  let fuelL = 0;
  const step = (pedal: number, brake = 0): EngineState => {
    const vehicle = dt.inputs(h, sim.state, pedal, brake);
    const s = sim.step(h, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
    fuelL += (s.fuelFlowLh * h) / 3600;
    return s;
  };
  return { dt, sim, inp, step, h, fuel: () => fuelL };
}

export function driveHybrid(car: LibraryCar, seconds = 60, mode: HybridMode = "sport", gripFactor = 1) {
  const r = hybridRig(car, mode, undefined, gripFactor);
  for (let i = 0; i < 60; i++) r.step(0, 1);
  let t = 0;
  let t100: number | null = null;
  let peakKw = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const s = r.step(1);
    t += r.h;
    if (t100 === null && r.dt.state.speedKmh >= 100) t100 = t;
    peakKw = Math.max(peakKw, s.powerKw);
  }
  return { t100, vmax: r.dt.state.maxSpeedKmh, peakKw, ...r };
}

/**
 * Speed profile (km/h over s, linear in between) with a PI speed controller as the driver; returns l/100 km corrected
 * for the SoC change (ΔE_battery / (η_engine·H_u), hybrid.md §6) so a cycle ending with less charge is not cheaper.
 */
export function cycle(car: LibraryCar, profile: [number, number][], repeat = 1, mode: HybridMode = "hybrid") {
  const r = hybridRig(car, mode);
  const end = profile[profile.length - 1]![0];
  const at = (t: number) => {
    const x = t % end;
    for (let i = 1; i < profile.length; i++) {
      const [t1, v1] = profile[i]!;
      const [t0, v0] = profile[i - 1]!;
      if (x <= t1) return v0 + ((v1 - v0) * (x - t0)) / Math.max(1e-6, t1 - t0);
    }
    return profile[profile.length - 1]![1];
  };
  const e0 = r.sim.battery.soc;
  let km = 0;
  let I = 0;
  let engineOnS = 0;
  for (let t = 0; t < end * repeat; t += r.h) {
    const v = r.dt.state.speedKmh;
    const err = at(t + 1) - v;
    I = Math.max(-0.3, Math.min(0.5, I + 0.02 * err * r.h));
    const u = 0.04 * err + I;
    const s = u >= 0 ? r.step(Math.min(1, 0.1 + u)) : r.step(0, Math.min(1, -u));
    km += ((s.vehicleSpeedMs ?? 0) * r.h) / 1000;
    if (s.hybrid?.engineOn) engineOnS += r.h;
  }
  const dSocKwh = (r.sim.battery.soc - e0) * (car.factory.packKwh ?? 1);
  // 1 kWh of battery ≙ 1 / (0.3 · 8.9 kWh/l) of petrol (engine efficiency 30 %, lower heating value 8.9 kWh/l)
  const corrL = -dSocKwh / (0.3 * 8.9);
  return { l100: ((r.fuel() + corrL) / Math.max(0.01, km)) * 100, rawL100: (r.fuel() / Math.max(0.01, km)) * 100, km, engineOnS, socEnd: r.sim.battery.soc, ...r };
}
