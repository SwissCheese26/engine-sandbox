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
export { TERRAIN_LABELS, RAMP_PCT, isTerrain, roadAt, terrainAt, terrainLengthM, terrainSamples, terrainCurved, curvatureAt, leanAngle } from "./terrain.ts";
export type { Terrain } from "./terrain.ts";
export { DEFAULT_TANK_L, FuelTank, RESERVE_SHARE } from "./fuel-tank.ts";
// issue #91: parking brake and Auto-Hold
export {
  AUTO_HOLD_MAX_KMH, AUTO_HOLD_STOP_KMH, HOLD_ENGAGE_PEDAL, HOLD_RELEASE_PEDAL, PARK_BRAKE_HOLD_PCT, AUTO_HOLD_HYDRAULIC_G, HOLD_ROLL_G, autoHoldEngages, holdCapN, parkBrakeCapN,
} from "./parking-brake.ts";
export type { AutoHoldInput } from "./parking-brake.ts";
// issue #53: gearbox oil temperature
export {
  GEARBOX_THERMAL, GEARBOX_WARM_C, GEARBOX_HYST_K, gearboxThermalKind, stepGearboxOil, gearboxHeatW, gearboxViscosityFactor, gearboxDragPenalty, gearboxWearRate,
  AFTERMARKET_OIL_COOLER_WK, AUX_COOLER_EXPONENT,
} from "./gearbox-thermal.ts";
export type { GearboxOilInput, GearboxThermalKind, GearboxThermalSpec } from "./gearbox-thermal.ts";
// issue #108: electric drive (motor, inverter, battery, regen, single-speed reduction, multi-motor AWD)
export { EvSimulator, DRIVE_MODES, DRIVE_MODE_IDS, START_SOC, evRefRatio, evSystemPowerKw, evPackKwh, motorRpmAt } from "./electric.ts";
export {
  CONSTANT_POWER_RATIO, INVERTER_EFFICIENCY, MOTOR_DERATE_C, MOTOR_MAX_C, baseRpm, electricPowerKw, motorDerate, motorEfficiency, motorLossKw,
  motorMaxPowerKw, motorMaxTorque, stepMotorTemp, torqueAtCurrent,
} from "./electric-motor.ts";
export {
  BATTERY_CUTOFF_C, BATTERY_DERATE_C, CELL_V_MAX, CELL_V_MIN, PACK_KWH_PER_KG, batteryLimits, cellOcv, chargeAcceptance, currentForPower,
  dischargeDerate, nominalV, packAh, packEnergyKwh, packMassKg, packOcv, packResistance, stepBattery,
} from "./battery.ts";
export type { BatteryLimits, BatteryState } from "./battery.ts";
// issue #83: compressed-air brake, retarder, AdBlue, battery voltage
export {
  VehicleSystems, AirBrake, AdBlueTank, retarderTorqueNm, retarderForceN, batteryTargetV, systemFactor, RETARDER_STAGES, RETARDER_MAX_NM,
  AIR_CUT_IN_BAR, AIR_CUT_OUT_BAR, AIR_WARN_BAR, AIR_SPRING_BAR, ADBLUE_SHARE, ADBLUE_LIMP_PEDAL, ADBLUE_TANK_L, BATTERY_REST_V, ALTERNATOR_V,
} from "./vehicle-systems.ts";
export type { SystemsInput, SystemsOutput } from "./vehicle-systems.ts";
export { BRAKE_MAX_G } from "./vehicle.ts";
