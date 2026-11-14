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
// motorcycles (issue #25)
export { VEHICLES } from "./drivetrain.ts";
export type { VehicleKind, VehiclePreset } from "./drivetrain.ts";
// vehicle and tyres (issue #22)
export { withTyre } from "./drivetrain.ts";
export type { CarSetup, GearboxSpec } from "./drivetrain.ts";
// issue #14: own gear ratios, converter automatic, traction diagram
export { GEAR_COUNT_MAX, GEAR_COUNT_MIN, GEAR_RATIO_MAX, GEAR_RATIO_MIN, gradedRatios, isAutomaticType, validateRatios } from "./drivetrain.ts";
export { converterCapacity, converterK, converterTorqueRatio, converterTorques } from "./converter.ts";
export type { ConverterSpec } from "./converter.ts";
export { drivingResistanceN, tractionCurves } from "./traction.ts";
export type { TractionEnv, TractionGear, TractionPoint, TractionResult, TractionSetup, TractionVerdict } from "./traction.ts";
// commercial vehicles (issue #31)
export { BUS_AUTOMATIC, TRUCK_AMT, isCommercialKind, isMotorcycleKind } from "./drivetrain.ts";
export { engineBrakeTorqueNm } from "./engine-brake.ts";
export type { EngineBrakeConfig } from "./types.ts";
export {
  TYRE_TYPES, SPEED_INDEX, DEFAULT_TYRE, SLIDE_FACTOR, PEAK_SLIP, tyreForceFactor, tyreGrip, tyreRadii, tyreTempFactor, speedRatingKmh,
  formatTyreSize, parseTyreSize,
} from "./tyres.ts";
export type { TyreType, RoadSurface, SpeedIndex, TyreSize, TyreSetup, TyreTypeSpec } from "./tyres.ts";
export { drivenAxleLoadN, frontAxleShare } from "./vehicle.ts";
export { slipRatio } from "./simulator.ts";
// environment and driver assistance (issue #23)
export { aquaplaningFactor, compoundFactor, AQUAPLANING_KMH } from "./tyres.ts";
export {
  DEFAULT_ENVIRONMENT, WEATHER_LABELS, ICE_WARNING_C, airDensity, altitudeToKpa, environmentInputs, iceWarning, weatherSurface,
} from "./environment.ts";
export type { Environment, Weather } from "./environment.ts";
export { DEFAULT_ASSISTS, ASSIST_LAMP_HOLD_S, TractionControl } from "./assists.ts";
export type { AssistSettings, TractionOutput } from "./assists.ts";
export { TripComputer, averageKmh, averageL100, MIN_KM_FOR_AVERAGE } from "./trip-computer.ts";
export type { TripComputerData, TripCounter } from "./trip-computer.ts";

// issue #30: cruise control and driver speed limiter
export { CruiseControl, CRUISE_MIN_KMH, CRUISE_MIN_MPH, LIMITER_OPTIONS, LIMITER_OPTIONS_MPH, MPH_KMH, KICKDOWN_S } from "./cruise.ts";
export type { CruiseState, CruiseMode } from "./cruise.ts";
export { TERRAIN_LABELS, RAMP_PCT, isTerrain, roadAt, terrainAt, terrainLengthM, terrainSamples } from "./terrain.ts";
export type { Terrain } from "./terrain.ts";
export { DEFAULT_TANK_L, FuelTank, RESERVE_SHARE } from "./fuel-tank.ts";
