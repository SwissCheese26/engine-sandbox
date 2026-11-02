/**
 * Public API of the physics core. UI, sound and tests import ONLY from here.
 * Implementation: mean value engine model (docs/research/diesel.md §3, petrol.md §3), see the modules below.
 */
import { displacementLiters } from "./geometry.ts";
import type { EngineConfig, SimInputs } from "./types.ts";

export type * from "./types.ts";
export { dynoSweep, summarize } from "./dyno.ts";
export { validateConfig } from "./validate.ts";
export { EngineSimulator } from "./simulator.ts";

export function displacementL(cfg: EngineConfig): number {
  return displacementLiters(cfg);
}

export function defaultInputs(): SimInputs {
  return {
    pedal: 0,
    ignition: false,
    starter: false,
    dynoMode: "free",
    dynoTargetRpm: 2000,
    dynoBrakeTorqueNm: 0,
    ambientC: 20,
    ambientKpa: 101.325,
  };
}
export {
  Drivetrain, DEFAULT_VEHICLE, GEARBOXES, theoreticalVmax, SPEED_LIMIT_OPTIONS, DEFAULT_SPEED_LIMIT_KMH, TYRE_RATING_W_KMH,
} from "./drivetrain.ts";
export type { DrivetrainState, GearboxType } from "./drivetrain.ts";
