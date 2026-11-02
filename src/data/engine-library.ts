import type { EngineConfig } from "../core/types.ts";
import { REFERENCE_ENGINES, type ReferenceEngine } from "./reference-engines.ts";

/**
 * Engine library (issue #15): production engines the player can load on the bench.
 *
 * Contains the 10 calibrated reference engines plus further well-known engines. Bore, stroke, compression and
 * rated torque/power are manufacturer data (sources per entry). Construction details without published values
 * (conrod length, cam profile, inducer size, boost target, radiator …) are estimates [S]; the boost target of
 * the turbo engines was fitted so that the model meets the rated power (tests/core/engine-library.test.ts).
 */
export interface LibraryEngine extends ReferenceEngine {
  maker: string;
  /** Typical cars, shown in the list. */
  cars: string;
  /** Model years. */
  years: string;
}

const NA = {
  aspiration: "naturally-aspirated", compressorInducerMm: 45, turbineAR: 0.6, variableGeometry: false,
  boostTargetBar: 0, intercooler: "none", individualThrottleBodies: false,
} as const;

const dieselFuel = (pressureBar: number, smoke = 1.25): EngineConfig["fuelSystem"] => ({
  kind: "diesel", injection: "common-rail", injectionPressureBar: pressureBar, fuel: "diesel", smokeLimitLambda: smoke, injectionTimingOffsetDeg: 0,
});
const dieselExhaust = { manifold: "cast-log", egr: true, catalyst: true, particulateFilter: true, scr: false } as const;
const blk = (layout: EngineConfig["block"]["layout"], cylinders: number, bore: number, stroke: number, rod: number, cr: number,
  material: EngineConfig["block"]["blockMaterial"], extra: Partial<EngineConfig["block"]> = {}): EngineConfig["block"] => ({
  layout, cylinders, bankAngleDeg: layout === "inline" ? 0 : layout === "boxer" ? 180 : 90, v8Crank: "crossplane",
  boreMm: bore, strokeMm: stroke, conrodLengthMm: rod, compressionRatio: cr,
  blockMaterial: material, crankshaft: "forged", pistons: "cast-aluminium", conrods: "forged-steel", ...extra,
});

const EXTRA: LibraryEngine[] = [
  {
    maker: "BMW", cars: "530d E60/E61, X5 3.0d E70", years: "2005–2010",
    config: {
      id: "lib-bmw-m57d30tu2", name: "BMW M57D30TÜ2 (3.0d, 170 kW)", fuel: "diesel",
      block: blk("inline", 6, 84, 90, 135, 17, "aluminium"),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.3, variableTiming: "none" },
      induction: { aspiration: "turbo", compressorInducerMm: 44, turbineAR: 0.6, variableGeometry: true, boostTargetBar: 1.0, intercooler: "air-to-air", intakeRunnerLengthMm: 350, individualThrottleBodies: false },
      fuelSystem: dieselFuel(2000, 1.15), exhaust: dieselExhaust,
      cooling: { radiatorCapacityKw: 155, thermostatOpenC: 88, oilCooler: true }, revLimitRpm: 4800, idleRpm: 750,
    },
    expected: { peakTorqueNm: 500, peakTorqueRpm: 2375, peakPowerKw: 170, peakPowerRpm: 4000 },
    source: "Wikipedia „BMW M57“ (M57D30TÜ2: 84 × 90 mm, 170 kW @ 4000, 500 Nm @ 1750–3000); Verdichtung 17:1 [S]",
  },
  {
    maker: "VW", cars: "Golf 6 2.0 TDI, Passat B7, Audi A3 8P", years: "2008–2015",
    config: {
      id: "lib-vw-ea189-20tdi-103kw", name: "VW EA189 2.0 TDI CR (103 kW)", fuel: "diesel",
      block: blk("inline", 4, 81, 95.5, 144, 16.5, "cast-iron"),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.25, variableTiming: "none" },
      induction: { aspiration: "turbo", compressorInducerMm: 38, turbineAR: 0.55, variableGeometry: true, boostTargetBar: 1.1, intercooler: "air-to-air", intakeRunnerLengthMm: 300, individualThrottleBodies: false },
      fuelSystem: dieselFuel(2000, 1.15), exhaust: dieselExhaust,
      cooling: { radiatorCapacityKw: 95, thermostatOpenC: 87, oilCooler: true }, revLimitRpm: 4800, idleRpm: 800,
    },
    expected: { peakTorqueNm: 320, peakTorqueRpm: 2125, peakPowerKw: 103, peakPowerRpm: 4200 },
    source: "Herstellerangabe VW (EA189 CFFB: 81 × 95,5 mm, ε 16,5, 103 kW @ 4200, 320 Nm @ 1750–2500)",
  },
  {
    maker: "Toyota", cars: "Land Cruiser Prado 120, Hilux, Hiace", years: "2000–2015",
    config: {
      id: "lib-toyota-1kd-ftv", name: "Toyota 1KD-FTV (3.0 D-4D, 120 kW)", fuel: "diesel",
      block: blk("inline", 4, 96, 103, 160, 17.9, "cast-iron"),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.2, variableTiming: "none" },
      induction: { aspiration: "turbo", compressorInducerMm: 42, turbineAR: 0.65, variableGeometry: true, boostTargetBar: 0.8, intercooler: "air-to-air", intakeRunnerLengthMm: 320, individualThrottleBodies: false },
      fuelSystem: dieselFuel(1600, 1.3), exhaust: { ...dieselExhaust, particulateFilter: false },
      cooling: { radiatorCapacityKw: 120, thermostatOpenC: 82, oilCooler: true }, revLimitRpm: 4800, idleRpm: 700,
    },
    expected: { peakTorqueNm: 343, peakTorqueRpm: 2400, peakPowerKw: 120, peakPowerRpm: 3400 },
    source: "Wikipedia „Toyota KD engine“ (1KD-FTV: 96 × 103 mm, ε 17,9); Prado 120: 120 kW (163 PS) @ 3400, 343 Nm (carsopedia), Drehmoment-Drehzahl [S]",
  },
  {
    maker: "Toyota", cars: "Supra Mk4 (JZA80), Aristo", years: "1991–2002",
    config: {
      id: "lib-toyota-2jz-gte", name: "Toyota 2JZ-GTE (3.0 Biturbo, 239 kW)", fuel: "petrol",
      block: blk("inline", 6, 86, 86, 142, 8.5, "cast-iron"),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.55, variableTiming: "intake-cam" },
      induction: { aspiration: "twin-turbo-sequential", compressorInducerMm: 44, turbineAR: 0.6, variableGeometry: false, boostTargetBar: 0.55, intercooler: "air-to-air", intakeRunnerLengthMm: 300, individualThrottleBodies: false },
      fuelSystem: { kind: "petrol", mixture: "port-injection", fuel: "ron98", fullLoadLambda: 0.82, ignitionAdvanceOffsetDeg: 0 },
      exhaust: { manifold: "cast-log", egr: false, catalyst: true, particulateFilter: false, scr: false },
      cooling: { radiatorCapacityKw: 215, thermostatOpenC: 88, oilCooler: true }, revLimitRpm: 6800, idleRpm: 700,
    },
    expected: { peakTorqueNm: 427, peakTorqueRpm: 4000, peakPowerKw: 239, peakPowerRpm: 5600 },
    source: "Toyota (US-Supra Turbo 1993–98: 86 × 86 mm, ε 8,5, 320 hp @ 5600, 315 lb·ft @ 4000)",
  },
  {
    maker: "Nissan", cars: "Skyline GT-R R32/R33/R34", years: "1989–2002",
    config: {
      id: "lib-nissan-rb26dett", name: "Nissan RB26DETT (2.6 Biturbo, 206 kW)", fuel: "petrol",
      block: blk("inline", 6, 86, 73.7, 121.5, 8.5, "cast-iron"),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.5, variableTiming: "none" },
      induction: { aspiration: "twin-turbo-parallel", compressorInducerMm: 40, turbineAR: 1.0, variableGeometry: false, boostTargetBar: 0.8, intercooler: "air-to-air", intakeRunnerLengthMm: 250, individualThrottleBodies: true },
      fuelSystem: { kind: "petrol", mixture: "port-injection", fuel: "ron98", fullLoadLambda: 0.82, ignitionAdvanceOffsetDeg: 0 },
      exhaust: { manifold: "cast-log", egr: false, catalyst: true, particulateFilter: false, scr: false },
      cooling: { radiatorCapacityKw: 190, thermostatOpenC: 82, oilCooler: true }, revLimitRpm: 8000, idleRpm: 900,
    },
    expected: { peakTorqueNm: 392, peakTorqueRpm: 4400, peakPowerKw: 206, peakPowerRpm: 6800 },
    source: "Wikipedia „Nissan RB engine“ (RB26DETT: 86 × 73,7 mm, 206 kW @ 6800, 392 Nm @ 4400 späte Serie); ε 8,5 [S]",
  },
  {
    maker: "Subaru", cars: "Impreza WRX STI (GD/GR)", years: "2004–2014",
    config: {
      id: "lib-subaru-ej257", name: "Subaru EJ257 (2.5 Boxer Turbo, 224 kW)", fuel: "petrol",
      block: blk("boxer", 4, 99.5, 79, 130.5, 8.2, "aluminium"),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.5, variableTiming: "dual-cam" },
      induction: { aspiration: "turbo", compressorInducerMm: 48, turbineAR: 0.64, variableGeometry: false, boostTargetBar: 0.9, intercooler: "air-to-air", intakeRunnerLengthMm: 280, individualThrottleBodies: false },
      fuelSystem: { kind: "petrol", mixture: "port-injection", fuel: "ron98", fullLoadLambda: 0.8, ignitionAdvanceOffsetDeg: 0 },
      exhaust: { manifold: "tubular-short", egr: false, catalyst: true, particulateFilter: false, scr: false },
      cooling: { radiatorCapacityKw: 200, thermostatOpenC: 82, oilCooler: true }, revLimitRpm: 7000, idleRpm: 750,
    },
    expected: { peakTorqueNm: 407, peakTorqueRpm: 4000, peakPowerKw: 224, peakPowerRpm: 6000 },
    source: "Subaru (US-STI: 99,5 × 79 mm, ε 8,2, 300 hp @ 6000, 300 lb·ft @ 4000)",
  },
  {
    maker: "BMW", cars: "M3 E90/E92/E93", years: "2007–2013",
    config: {
      id: "lib-bmw-s65b40", name: "BMW S65B40 (4.0 V8, 309 kW)", fuel: "petrol",
      block: blk("v", 8, 92, 75.2, 140.1, 12, "aluminium", { v8Crank: "crossplane" }),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.85, variableTiming: "dual-cam" },
      induction: { ...NA, intakeRunnerLengthMm: 280, individualThrottleBodies: true },
      fuelSystem: { kind: "petrol", mixture: "port-injection", fuel: "ron98", fullLoadLambda: 0.88, ignitionAdvanceOffsetDeg: 0 },
      exhaust: { manifold: "tubular-long", egr: false, catalyst: true, particulateFilter: false, scr: false },
      cooling: { radiatorCapacityKw: 280, thermostatOpenC: 88, oilCooler: true }, revLimitRpm: 8400, idleRpm: 800,
    },
    expected: { peakTorqueNm: 400, peakTorqueRpm: 3900, peakPowerKw: 309, peakPowerRpm: 8300 },
    source: "BMW (S65B40: 92 × 75,2 mm, ε 12,0, 309 kW @ 8300, 400 Nm @ 3900)",
  },
];

const META: Record<string, { maker: string; cars: string; years: string }> = {
  "ref-vw-19-tdi-pd-96kw": { maker: "VW", cars: "Golf 4 GTI TDI, Passat B5, Audi A4", years: "2000–2006" },
  "ref-bmw-n57d30o1": { maker: "BMW", cars: "530d F10, X5 xDrive30d", years: "2008–2015" },
  "ref-mercedes-om654-220d": { maker: "Mercedes-Benz", cars: "E 220 d, C 220 d", years: "seit 2016" },
  "ref-psa-16-hdi-dv6ted4": { maker: "PSA / Ford", cars: "Peugeot 308, Focus 1.6 TDCi", years: "2004–2010" },
  "ref-cummins-6bt-59": { maker: "Cummins", cars: "Dodge Ram 2500/3500", years: "1994–1998" },
  "ref-honda-k20a-type-r": { maker: "Honda", cars: "Integra Type R DC5, Civic Type R", years: "2001–2006" },
  "ref-vw-ea888-gen3-chhb": { maker: "VW", cars: "Golf 7 GTI", years: "2013–2017" },
  "ref-bmw-s54b32": { maker: "BMW", cars: "M3 E46, Z4 M", years: "2000–2008" },
  "ref-gm-ls3-62": { maker: "GM", cars: "Corvette C6, Camaro SS", years: "2008–2017" },
  "ref-ferrari-f136fb-458": { maker: "Ferrari", cars: "458 Italia", years: "2009–2015" },
};

export const ENGINE_LIBRARY: LibraryEngine[] = [
  ...REFERENCE_ENGINES.map((r) => ({ ...r, ...(META[r.config.id] ?? { maker: "", cars: "", years: "" }) })),
  ...EXTRA,
].sort((a, b) => (a.config.fuel === b.config.fuel ? a.config.name.localeCompare(b.config.name, "de") : a.config.fuel === "diesel" ? -1 : 1));

/** Deep copy of a library engine's config, ready to edit on the bench. */
export function libraryConfig(id: string): EngineConfig {
  const e = ENGINE_LIBRARY.find((x) => x.config.id === id);
  if (!e) throw new Error(`unknown library engine: ${id}`);
  return structuredClone(e.config);
}
