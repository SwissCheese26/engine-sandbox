import type { EngineConfig } from "../core/types.ts";

/**
 * Starting points for the configurator. Reference engines for calibration live in
 * src/data/reference-engines.ts (owned by the test team).
 */

export const DEFAULT_DIESEL: EngineConfig = {
  id: "default-diesel",
  name: "Reihenvierzylinder Diesel 2.0",
  fuel: "diesel",
  block: {
    layout: "inline",
    cylinders: 4,
    bankAngleDeg: 0,
    v8Crank: "crossplane",
    boreMm: 81,
    strokeMm: 95.5,
    conrodLengthMm: 144,
    compressionRatio: 16.5,
    blockMaterial: "cast-iron",
    crankshaft: "forged",
    pistons: "cast-aluminium",
    conrods: "forged-steel",
  },
  head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.25, variableTiming: "none" },
  induction: {
    aspiration: "turbo",
    compressorInducerMm: 38,
    turbineAR: 0.6,
    variableGeometry: true,
    boostTargetBar: 1.3,
    intercooler: "air-to-air",
    intakeRunnerLengthMm: 300,
    individualThrottleBodies: false,
  },
  fuelSystem: {
    kind: "diesel",
    injection: "common-rail",
    injectionPressureBar: 1800,
    fuel: "diesel",
    smokeLimitLambda: 1.3,
    injectionTimingOffsetDeg: 0,
  },
  exhaust: { manifold: "cast-log", egr: true, catalyst: true, particulateFilter: true, scr: false },
  cooling: { radiatorCapacityKw: 70, thermostatOpenC: 87, oilCooler: true },
  revLimitRpm: 4800,
  idleRpm: 800,
};

export const DEFAULT_PETROL: EngineConfig = {
  id: "default-petrol",
  name: "Reihenvierzylinder Benziner 2.0",
  fuel: "petrol",
  block: {
    layout: "inline",
    cylinders: 4,
    bankAngleDeg: 0,
    v8Crank: "crossplane",
    boreMm: 82.5,
    strokeMm: 92.8,
    conrodLengthMm: 144,
    compressionRatio: 9.6,
    blockMaterial: "cast-iron",
    crankshaft: "forged",
    pistons: "cast-aluminium",
    conrods: "forged-steel",
  },
  head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.4, variableTiming: "dual-cam" },
  induction: {
    aspiration: "turbo",
    compressorInducerMm: 42,
    turbineAR: 0.55,
    variableGeometry: false,
    boostTargetBar: 1.0,
    intercooler: "air-to-air",
    intakeRunnerLengthMm: 280,
    individualThrottleBodies: false,
  },
  fuelSystem: {
    kind: "petrol",
    mixture: "direct-injection",
    fuel: "ron98",
    fullLoadLambda: 0.88,
    ignitionAdvanceOffsetDeg: 0,
  },
  exhaust: { manifold: "cast-log", egr: false, catalyst: true, particulateFilter: false, scr: false },
  cooling: { radiatorCapacityKw: 80, thermostatOpenC: 90, oilCooler: true },
  revLimitRpm: 6800,
  idleRpm: 750,
};

export function defaultConfig(fuel: EngineConfig["fuel"]): EngineConfig {
  return structuredClone(fuel === "diesel" ? DEFAULT_DIESEL : DEFAULT_PETROL);
}
