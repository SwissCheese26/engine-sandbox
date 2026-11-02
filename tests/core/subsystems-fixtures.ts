/**
 * Reference-engine fixtures for the subsystem tests (turbo, thermal, limits, mass).
 * Values from docs/research/diesel.md §5 and docs/research/petrol.md §7. Kept local so these tests do not
 * depend on src/data/reference-engines.ts (test team) being merged first.
 */
import type { EngineConfig } from "../../src/core/types.ts";
import { defaultConfig } from "../../src/data/presets.ts";

type Patch = {
  block?: Partial<EngineConfig["block"]>;
  head?: Partial<EngineConfig["head"]>;
  induction?: Partial<EngineConfig["induction"]>;
  exhaust?: Partial<EngineConfig["exhaust"]>;
  cooling?: Partial<EngineConfig["cooling"]>;
  fuelSystem?: Record<string, unknown>;
  revLimitRpm?: number;
  idleRpm?: number;
};

function make(fuel: "diesel" | "petrol", id: string, name: string, p: Patch): EngineConfig {
  const c = defaultConfig(fuel);
  return {
    ...c,
    id,
    name,
    block: { ...c.block, ...p.block },
    head: { ...c.head, ...p.head },
    induction: { ...c.induction, ...p.induction },
    exhaust: { ...c.exhaust, ...p.exhaust },
    cooling: { ...c.cooling, ...p.cooling },
    fuelSystem: { ...c.fuelSystem, ...p.fuelSystem } as EngineConfig["fuelSystem"],
    revLimitRpm: p.revLimitRpm ?? c.revLimitRpm,
    idleRpm: p.idleRpm ?? c.idleRpm,
  };
}

const NA = { aspiration: "naturally-aspirated", boostTargetBar: 0, intercooler: "none", variableGeometry: false } as const;

export const REF: Record<string, EngineConfig> = {
  tdi19: make("diesel", "tdi19", "VW 1.9 TDI PD", {
    block: { boreMm: 79.5, strokeMm: 95.5, compressionRatio: 18, blockMaterial: "cast-iron", crankshaft: "forged", pistons: "cast-aluminium", conrods: "forged-steel" },
    head: { valvetrain: "sohc", valvesPerCylinder: 2, camProfile: 0.2 },
    induction: { compressorInducerMm: 38, turbineAR: 0.5, variableGeometry: true, boostTargetBar: 1.4 },
    exhaust: { egr: true, catalyst: true, particulateFilter: false },
    fuelSystem: { injection: "unit-injector", injectionPressureBar: 2050, smokeLimitLambda: 1.2 },
    revLimitRpm: 4900,
  }),
  n57: make("diesel", "n57", "BMW N57D30O1", {
    block: { cylinders: 6, boreMm: 84, strokeMm: 90, conrodLengthMm: 145, blockMaterial: "aluminium" },
    head: { camProfile: 0.3 },
    induction: { compressorInducerMm: 46, turbineAR: 0.6, boostTargetBar: 1.7, intakeRunnerLengthMm: 350 },
    fuelSystem: { smokeLimitLambda: 1.25 },
    cooling: { radiatorCapacityKw: 120, thermostatOpenC: 88 },
    revLimitRpm: 5400,
  }),
  om654: make("diesel", "om654", "Mercedes OM654", {
    block: { boreMm: 82, strokeMm: 92.3, conrodLengthMm: 138, compressionRatio: 15.5, blockMaterial: "aluminium", pistons: "steel" },
    induction: { compressorInducerMm: 42, turbineAR: 0.55, boostTargetBar: 1.7 },
    exhaust: { scr: true },
    fuelSystem: { injectionPressureBar: 2050, smokeLimitLambda: 1.25 },
    cooling: { radiatorCapacityKw: 95, thermostatOpenC: 90 },
  }),
  cummins: make("diesel", "cummins", "Cummins 6BT 5.9", {
    block: { cylinders: 6, boreMm: 102, strokeMm: 120, conrodLengthMm: 192, compressionRatio: 17.5, blockMaterial: "cast-iron" },
    head: { valvetrain: "ohv", valvesPerCylinder: 2, camProfile: 0.1 },
    induction: { compressorInducerMm: 55, turbineAR: 0.8, variableGeometry: false, boostTargetBar: 1.4 },
    exhaust: { egr: false, catalyst: false, particulateFilter: false, scr: false },
    fuelSystem: { injection: "unit-injector", injectionPressureBar: 1000, smokeLimitLambda: 1.35 },
    cooling: { radiatorCapacityKw: 150, thermostatOpenC: 83 },
    revLimitRpm: 2800,
    idleRpm: 750,
  }),
  k20a: make("petrol", "k20a", "Honda K20A", {
    block: { boreMm: 86, strokeMm: 86, conrodLengthMm: 139, compressionRatio: 11.5, blockMaterial: "aluminium" },
    head: { camProfile: 0.85, variableTiming: "cam-switching" },
    induction: { ...NA, intakeRunnerLengthMm: 250 },
    fuelSystem: { mixture: "port-injection", fuel: "ron98" },
    cooling: { radiatorCapacityKw: 80, thermostatOpenC: 82, oilCooler: false },
    revLimitRpm: 8400,
  }),
  ea888: make("petrol", "ea888", "VW EA888 Gen3", {
    head: { camProfile: 0.35 },
    induction: { compressorInducerMm: 42, turbineAR: 0.5, boostTargetBar: 1.3 },
    fuelSystem: { mixture: "dual-injection", fuel: "ron95" },
    cooling: { radiatorCapacityKw: 90, thermostatOpenC: 95 },
  }),
  s54: make("petrol", "s54", "BMW S54B32", {
    block: { cylinders: 6, boreMm: 87, strokeMm: 91, conrodLengthMm: 139, compressionRatio: 11.5 },
    head: { camProfile: 0.8 },
    induction: { ...NA, individualThrottleBodies: true },
    fuelSystem: { mixture: "port-injection", fuel: "ron98" },
    cooling: { radiatorCapacityKw: 130 },
    revLimitRpm: 8000,
  }),
  ls3: make("petrol", "ls3", "GM LS3 6.2", {
    block: { layout: "v", cylinders: 8, bankAngleDeg: 90, boreMm: 103.25, strokeMm: 92, conrodLengthMm: 154.9, compressionRatio: 10.7, blockMaterial: "aluminium", crankshaft: "cast" },
    head: { valvetrain: "ohv", valvesPerCylinder: 2, camProfile: 0.35, variableTiming: "none" },
    induction: { ...NA },
    fuelSystem: { mixture: "port-injection", fuel: "ron95" },
    cooling: { radiatorCapacityKw: 160, thermostatOpenC: 88 },
    revLimitRpm: 6600,
  }),
  f136: make("petrol", "f136", "Ferrari F136 FB", {
    block: { layout: "v", cylinders: 8, bankAngleDeg: 90, v8Crank: "flatplane", boreMm: 94, strokeMm: 81, conrodLengthMm: 140, compressionRatio: 12.5, blockMaterial: "aluminium", pistons: "forged-aluminium", conrods: "titanium" },
    head: { camProfile: 0.95 },
    induction: { ...NA },
    fuelSystem: { mixture: "direct-injection", fuel: "ron98" },
    cooling: { radiatorCapacityKw: 210 },
    revLimitRpm: 9000,
  }),
};

export const REF_LIST: EngineConfig[] = Object.values(REF);
