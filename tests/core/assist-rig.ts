// Test rig for issue #23 (environment & driver assistance): braking 100 → 0 and full-throttle launches.
import { Drivetrain, EngineSimulator, defaultInputs, summarize } from "../../src/core/index.ts";
import type { AssistSettings, Environment, TyreType } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { libraryCar } from "../../src/data/vehicle-library.ts";

export function assistRig(carId: string, opts: { tyre?: TyreType; env?: Partial<Environment>; assists?: Partial<AssistSettings> } = {}) {
  const car = libraryCar(carId);
  const setup = structuredClone(car.setup);
  if (opts.tyre) setup.tyre.type = opts.tyre;
  const cfg = libraryConfig(car.engineId);
  const sim = new EngineSimulator(cfg);
  const dt = new Drivetrain(cfg, summarize(cfg));
  dt.applyCar(setup);
  if (opts.env) dt.setEnvironment(opts.env);
  if (opts.assists) dt.setAssists(opts.assists);
  const inp = { ...defaultInputs(), ...dt.simInputs(), ignition: true, starter: true, startWarm: true, dynoMode: "vehicle" as const };
  const h = 1 / 60;
  const step = (pedal: number, brake = 0) => {
    const vehicle = dt.inputs(h, sim.state, pedal, brake);
    return sim.step(h, { ...inp, vehicle, pedal: dt.effectivePedal(pedal) });
  };
  for (let i = 0; i < 90; i++) step(0);
  inp.starter = false;
  for (let i = 0; i < 60; i++) step(0);
  return { cfg, sim, dt, step, h };
}

/** Puts the car at `kmh` (vehicle state set directly, gear chosen for the speed) and brakes fully to standstill. */
export function brakeTest(carId: string, opts: Parameters<typeof assistRig>[1] = {}, kmh = 100) {
  const r = assistRig(carId, opts);
  const { sim, dt, step } = r;
  // drive up on dry road with full grip, then switch to the test surface (keeps the run-up identical)
  const env = opts.env;
  dt.setEnvironment({ weather: "dry", gradePct: 0 });
  const auto = dt.state.type === "manual";
  let k = 0;
  while ((sim.state.vehicleSpeedMs ?? 0) < kmh / 3.6 && k++ < 60 * 60) {
    if (auto && sim.state.rpm > r.cfg.revLimitRpm - 300 && !dt.state.shifting && dt.state.clutch > 0.95 && dt.state.gear < dt.state.gearCount) dt.shift(1);
    step(1);
  }
  if (env) dt.setEnvironment(env);
  const v0 = sim.state.vehicleSpeedMs ?? 0;
  let d = 0;
  let locked = 0;
  let absT = 0;
  let t = 0;
  const c0 = sim.state.absCycles ?? 0;
  for (let i = 0; i < 60 * 60 && (sim.state.vehicleSpeedMs ?? 0) > 0.02; i++) {
    d += (sim.state.vehicleSpeedMs ?? 0) / 60;
    const s = step(0, 1);
    t += 1 / 60;
    if (s.wheelsLocked) locked += 1 / 60;
    if (dt.state.absActive) absT += 1 / 60;
  }
  // distance corrected to exactly kmh (the run-up overshoots by < 1 frame): d ∝ v²
  const dCorr = d * ((kmh / 3.6) / v0) ** 2;
  return { d: dCorr, v0, locked, absT, t, cycles: (sim.state.absCycles ?? 0) - c0, dt, sim };
}
