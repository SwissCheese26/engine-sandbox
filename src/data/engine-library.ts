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
  /** Vehicle category for the library list (issue #25). Default "car". */
  category?: "car" | "motorcycle" | "commercial";
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
      block: blk("inline", 6, 84, 90, 135, 16.5, "aluminium"),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.3, variableTiming: "none" },
      induction: { aspiration: "turbo", compressorInducerMm: 44, turbineAR: 0.6, variableGeometry: true, boostTargetBar: 1.0, intercooler: "air-to-air", intakeRunnerLengthMm: 350, individualThrottleBodies: false },
      fuelSystem: dieselFuel(2000, 1.15), exhaust: dieselExhaust,
      cooling: { radiatorCapacityKw: 155, thermostatOpenC: 88, oilCooler: true }, revLimitRpm: 4800, idleRpm: 750,
    },
    expected: { peakTorqueNm: 500, peakTorqueRpm: 2375, peakPowerKw: 170, peakPowerRpm: 4000 },
    source: "Wikipedia „BMW M57“ (M57D30TÜ2: 84 × 90 mm, 170 kW @ 4000, 500 Nm @ 1750–3000); Verdichtung 16,5:1 (übliche Angabe, Wikipedia nennt 16,5–18 für die Familie)",
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
      // Issue #38: mild stock cams (no VVT on the RB26) → camProfile 0.3 [S]. Twin parallel: compressorInducerMm is the
      // equivalent single inducer of BOTH chargers (turbo.ts chargerUnit: two of D/√2), so two T25-class compressors of
      // ≈ 35 mm give 50 mm [S]; the former 40 mm (2 × 28 mm) choked at ≈ 0.17 kg/s and capped the engine at 4600 rpm.
      // Turbine A/R 0.64 (T25/T28 class) [S]; boost target fitted (header note). The model then makes ≈ 230 kW @ 6900,
      // above the JAMA-limited 280 PS rating, like real engines on the dyno (CarAdvice "every GT-R on the same dyno":
      // near-stock R33 213 kW at the wheels).
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.3, variableTiming: "none" },
      induction: { aspiration: "twin-turbo-parallel", compressorInducerMm: 50, turbineAR: 0.64, variableGeometry: false, boostTargetBar: 0.62, intercooler: "air-to-air", intakeRunnerLengthMm: 250, individualThrottleBodies: true },
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
  {
    maker: "Toyota", cars: "Citroën C1, Peugeot 107, Toyota Aygo", years: "2005–2014",
    config: {
      id: "lib-toyota-1kr-fe", name: "Toyota 1KR-FE (1.0 R3, 50 kW)", fuel: "petrol",
      block: blk("inline", 3, 71, 84, 115, 10.5, "aluminium", { crankshaft: "cast", conrods: "cast-steel" }),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.2, variableTiming: "intake-cam" },
      induction: { ...NA, intakeRunnerLengthMm: 400 },
      fuelSystem: { kind: "petrol", mixture: "port-injection", fuel: "ron95", fullLoadLambda: 0.9, ignitionAdvanceOffsetDeg: 0 },
      exhaust: { manifold: "cast-log", egr: false, catalyst: true, particulateFilter: false, scr: false },
      cooling: { radiatorCapacityKw: 60, thermostatOpenC: 88, oilCooler: false }, revLimitRpm: 6500, idleRpm: 750,
    },
    expected: { peakTorqueNm: 93, peakTorqueRpm: 3600, peakPowerKw: 50, peakPowerRpm: 6000 },
    source: "Toyota 1KR-FE (71 × 84 mm, ε 10,5, 998 cm³, DOHC 12V, VVT-i); Citroën C1 1.0 (2008): 50 kW (68 PS) @ 6000, 93 Nm @ 3600 laut ADAC-Autokatalog; Pleuel, Nocken, Saugrohr geschätzt [S]",
  },
];

/**
 * Motorcycle engines (issue #25). Bore, stroke, compression, rated power/torque: manufacturer data (sources per
 * entry). Rev limiter, conrod length, cam profile, runner length and fin/radiator rating are estimates [S]; cam
 * profile and runner length were tuned so that the model meets the rated figures (±15 %, engine-library.test.ts).
 * Superbikes: individual throttle bodies, short velocity stacks, 4-2-1 headers ("tubular-long"), light flywheel.
 * Spring-valve engines get "high-rate" valve springs (dual / beehive springs, standard on high-revving motorcycle
 * heads [S]), so valve float stays above the limiter (0.95·n_float > limiter, tests/core/motorcycle.test.ts).
 */
const MOTO_EXHAUST = { manifold: "tubular-long", egr: false, catalyst: true, particulateFilter: false, scr: false } as const;
const motoFuel = (fuel: "ron95" | "ron98", lambda = 0.88): EngineConfig["fuelSystem"] => ({
  kind: "petrol", mixture: "port-injection", fuel, fullLoadLambda: lambda, ignitionAdvanceOffsetDeg: 0,
});
const MOTO: LibraryEngine[] = [
  {
    maker: "Honda", cars: "CBR1000RR Fireblade (SC59)", years: "2008–2011", category: "motorcycle",
    config: {
      id: "lib-honda-cbr1000rr-sc59", name: "Honda CBR1000RR SC59 (1.0 R4, 131 kW)", fuel: "petrol",
      block: blk("inline", 4, 76, 55.1, 108, 12.3, "aluminium", { lightFlywheel: true, pistons: "forged-aluminium" }),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.85, variableTiming: "none", valveMaterial: "titanium", valveSprings: "high-rate" },
      induction: { ...NA, intakeRunnerLengthMm: 90, individualThrottleBodies: true },
      fuelSystem: motoFuel("ron98"), exhaust: MOTO_EXHAUST,
      cooling: { radiatorCapacityKw: 110, thermostatOpenC: 82, oilCooler: true, type: "liquid" }, revLimitRpm: 13000, idleRpm: 1300,
    },
    expected: { peakTorqueNm: 112, peakTorqueRpm: 8500, peakPowerKw: 131, peakPowerRpm: 12000 },
    source: "Honda Pressemappe 2008 CBR1000RR (76 × 55,1 mm, ε 12,3, Einlassventile aus Titan); 131 kW (178 PS) @ 12 000, 112 Nm @ 8500 (EU-Angabe); Begrenzer ≈ 13 000 [S]",
  },
  {
    maker: "Yamaha", cars: "YZF-R1 (RN22, Crossplane)", years: "2009–2014", category: "motorcycle",
    config: {
      id: "lib-yamaha-r1-cp4", name: "Yamaha YZF-R1 Crossplane (1.0 R4, 134 kW)", fuel: "petrol",
      block: blk("inline", 4, 78, 52.2, 105, 12.7, "aluminium", { lightFlywheel: true, pistons: "forged-aluminium", crossplaneI4: true }),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.9, variableTiming: "none", valveMaterial: "titanium", valveSprings: "high-rate" },
      induction: { ...NA, intakeRunnerLengthMm: 80, individualThrottleBodies: true },
      fuelSystem: motoFuel("ron98"), exhaust: MOTO_EXHAUST,
      cooling: { radiatorCapacityKw: 110, thermostatOpenC: 82, oilCooler: true, type: "liquid" }, revLimitRpm: 13750, idleRpm: 1300,
    },
    expected: { peakTorqueNm: 115.5, peakTorqueRpm: 10000, peakPowerKw: 133.9, peakPowerRpm: 12500 },
    source: "Yamaha YZF-R1 2009 (78 × 52,2 mm, ε 12,7, Crossplane-Kurbelwelle, Zündfolge 270-180-90-180, Titan-Einlassventile); 133,9 kW (182 PS) @ 12 500, 115,5 Nm @ 10 000; Begrenzer ≈ 13 750 [S]",
  },
  {
    maker: "Ducati", cars: "1199 Panigale / S", years: "2012–2014", category: "motorcycle",
    config: {
      id: "lib-ducati-1199-superquadro", name: "Ducati 1199 Superquadro (1.2 V2 90°, 143 kW)", fuel: "petrol",
      block: blk("v", 2, 112, 60.8, 124, 12.5, "aluminium", { lightFlywheel: true, bankAngleDeg: 90, pistons: "forged-aluminium" }),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 1, variableTiming: "none", valveMaterial: "titanium", desmodromic: true },
      induction: { ...NA, intakeRunnerLengthMm: 110, individualThrottleBodies: true },
      fuelSystem: motoFuel("ron98"), exhaust: MOTO_EXHAUST,
      cooling: { radiatorCapacityKw: 120, thermostatOpenC: 82, oilCooler: true, type: "liquid" }, revLimitRpm: 11500, idleRpm: 1350,
    },
    expected: { peakTorqueNm: 132, peakTorqueRpm: 9000, peakPowerKw: 143.4, peakPowerRpm: 10750 },
    source: "Ducati 1199 Panigale (Superquadro: 112 × 60,8 mm, ε 12,5, Desmodromik, 90°-V, Zündabstand 270/450); 143,4 kW (195 PS) @ 10 750, 132 Nm @ 9000; Begrenzer ≈ 11 500 [S]",
  },
  {
    maker: "Harley-Davidson", cars: "Softail, Touring (Street Glide, Road King)", years: "seit 2017", category: "motorcycle",
    config: {
      id: "lib-harley-m8-107", name: "Harley-Davidson Milwaukee-Eight 107 (1.75 V2 45°, 64 kW)", fuel: "petrol",
      block: blk("v", 2, 100, 111.1, 190, 10, "aluminium", { bankAngleDeg: 45, crankshaft: "forged", pistons: "cast-aluminium", conrods: "forged-steel" }),
      head: { valvetrain: "ohv", valvesPerCylinder: 4, camProfile: 0.1, variableTiming: "none" },
      induction: { ...NA, intakeRunnerLengthMm: 300, individualThrottleBodies: false },
      fuelSystem: motoFuel("ron95", 0.9), exhaust: { ...MOTO_EXHAUST, manifold: "tubular-short" },
      cooling: { radiatorCapacityKw: 25, thermostatOpenC: 90, oilCooler: true, type: "oil-air" }, revLimitRpm: 5500, idleRpm: 850,
    },
    expected: { peakTorqueNm: 148, peakTorqueRpm: 3000, peakPowerKw: 64, peakPowerRpm: 5000 },
    source: "Harley-Davidson (Milwaukee-Eight 107: 100 × 111,1 mm, 1746 cm³, ε 10,0, OHV mit 4 Ventilen, Öl-Luft-Kühlung); Softail Breakout 107: 148 Nm @ 3000 (cyclechaos); Leistung ≈ 64 kW @ 5000 (EU-Angabe je nach Modell 63–68 kW) [S]",
  },
  {
    maker: "BMW", cars: "R 1250 GS, RT, RS", years: "2019–2023", category: "motorcycle",
    config: {
      id: "lib-bmw-r1250-boxer", name: "BMW R 1250 Boxer ShiftCam (1.25 B2, 100 kW)", fuel: "petrol",
      block: blk("boxer", 2, 102.5, 76, 125, 12.5, "aluminium", { pistons: "forged-aluminium" }),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.3, variableTiming: "cam-switching", valveSprings: "high-rate" },
      induction: { ...NA, intakeRunnerLengthMm: 250, individualThrottleBodies: true },
      fuelSystem: motoFuel("ron95"), exhaust: MOTO_EXHAUST,
      cooling: { radiatorCapacityKw: 80, thermostatOpenC: 85, oilCooler: true, type: "liquid" }, revLimitRpm: 9000, idleRpm: 1000,
    },
    expected: { peakTorqueNm: 143, peakTorqueRpm: 6250, peakPowerKw: 100, peakPowerRpm: 7750 },
    source: "BMW Motorrad (R 1250 GS: 102,5 × 76 mm, ε 12,5, ShiftCam, luft-/flüssigkeitsgekühlt); 100 kW (136 PS) @ 7750, 143 Nm @ 6250; Begrenzer ≈ 9000 [S]",
  },
  {
    maker: "KTM", cars: "690 Duke, 690 SMC R, 690 Enduro R", years: "2016–2019", category: "motorcycle",
    config: {
      id: "lib-ktm-690-lc4", name: "KTM 690 LC4 (0.69 Einzylinder, 54 kW)", fuel: "petrol",
      block: blk("inline", 1, 105, 80, 150, 12.7, "aluminium", { pistons: "forged-aluminium" }),
      head: { valvetrain: "sohc", valvesPerCylinder: 4, camProfile: 0.7, variableTiming: "none", valveSprings: "high-rate" },
      induction: { ...NA, intakeRunnerLengthMm: 200, individualThrottleBodies: true },
      fuelSystem: motoFuel("ron95"), exhaust: MOTO_EXHAUST,
      cooling: { radiatorCapacityKw: 50, thermostatOpenC: 85, oilCooler: false, type: "liquid" }, revLimitRpm: 8200, idleRpm: 1500,
    },
    expected: { peakTorqueNm: 74, peakTorqueRpm: 6500, peakPowerKw: 54.4, peakPowerRpm: 8000 },
    source: "KTM 690 Duke 2016 (LC4: 105 × 80 mm, 693 cm³, ε 12,7, SOHC 4 Ventile) laut motorcyclespecs.co.za; 54,4 kW (74 PS) @ 8000, 74 Nm @ 6500; Begrenzer ≈ 8200 [S]",
  },
  {
    maker: "Triumph", cars: "Street Triple 765 RS", years: "2020–2022", category: "motorcycle",
    config: {
      id: "lib-triumph-765-triple", name: "Triumph Street Triple 765 RS (0.77 R3, 90 kW)", fuel: "petrol",
      block: blk("inline", 3, 78, 53.4, 108, 12.54, "aluminium", { lightFlywheel: true, pistons: "forged-aluminium" }),
      head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.9, variableTiming: "none", valveSprings: "high-rate" },
      induction: { ...NA, intakeRunnerLengthMm: 100, individualThrottleBodies: true },
      fuelSystem: motoFuel("ron95"), exhaust: MOTO_EXHAUST,
      cooling: { radiatorCapacityKw: 80, thermostatOpenC: 82, oilCooler: false, type: "liquid" }, revLimitRpm: 12500, idleRpm: 1200,
    },
    expected: { peakTorqueNm: 79, peakTorqueRpm: 9350, peakPowerKw: 90, peakPowerRpm: 11750 },
    source: "Triumph Street Triple RS 2020 (78 × 53,4 mm, ε 12,54) laut motorcyclespecs.co.za; 90 kW (123 PS) @ 11 750, 79 Nm @ 9350; Begrenzer ≈ 12 500 [S]",
  },
];

// ───────────── Commercial vehicles (issue #31, docs/research/commercial.md) ─────────────
// Shared [S] modelling choices: steel pistons, CGI / cast-iron block, pushrod-free 4-valve heads modelled as "ohv"
// cam drive with a mild cam; the wastegate / asymmetric fixed-geometry chargers are modelled as VGT so the model
// builds boost from ≈ 1000 rpm like the real engines (commercial.md §2); power rating via ecuPowerLimitKw.
const nfzHead = { valvetrain: "ohv", valvesPerCylinder: 4, camProfile: 0.1, variableTiming: "none" } as const;
const nfzExhaust = { manifold: "cast-log", egr: true, catalyst: true, particulateFilter: true, scr: true } as const;
const nfzBlk = (layout: EngineConfig["block"]["layout"], cyl: number, bore: number, stroke: number, rod: number, cr: number, material: EngineConfig["block"]["blockMaterial"]) =>
  blk(layout, cyl, bore, stroke, rod, cr, material, { pistons: "steel" });

const COMMERCIAL: LibraryEngine[] = [
  {
    maker: "Mercedes-Benz", cars: "Actros, Arocs, Setra TopClass", years: "seit 2011", category: "commercial",
    config: {
      id: "lib-mercedes-om471", name: "Mercedes-Benz OM 471 (12.8 R6, 330 kW)", fuel: "diesel",
      block: nfzBlk("inline", 6, 132, 156, 260, 18.3, "cast-iron"),
      head: nfzHead,
      induction: { aspiration: "turbo", compressorInducerMm: 80, turbineAR: 0.7, variableGeometry: true, boostTargetBar: 1.9, intercooler: "air-to-air", intakeRunnerLengthMm: 400, individualThrottleBodies: false },
      fuelSystem: dieselFuel(2100, 1.25), exhaust: nfzExhaust,
      cooling: { radiatorCapacityKw: 380, thermostatOpenC: 85, oilCooler: true }, revLimitRpm: 2000, idleRpm: 600,
      ecuTorqueLimitNm: 2200, ecuPowerLimitKw: 330,
      engineBrake: { kind: "decompression", maxKw: 400, ratedRpm: 2000 },
    },
    expected: { peakTorqueNm: 2200, peakTorqueRpm: 1100, peakPowerKw: 330, peakPowerRpm: 1800 },
    source: "kfz-tech.de „Mercedes OM 471 Euro 6 (2014)“ (132 × 156 mm, 12,8 l, 310–370 kW @ 1800, 2100–2500 Nm @ 1100, X-Pulse bis 2100 bar); Stufe 330 kW / 2200 Nm; Mercedes-Benz Powertrain Truck Euro VI 2021 (OM 471 1091 kg, Motorbremse der Baureihe bis 480 kW → 400 kW [S]); ε 18,3 [S]",
  },
  {
    maker: "Scania", cars: "R 650, S 650 V8, Touring/Interlink", years: "seit 2016", category: "commercial",
    config: {
      id: "lib-scania-dc16", name: "Scania DC16 118 V8 (16.4, 479 kW)", fuel: "diesel",
      block: nfzBlk("v", 8, 130, 154, 255, 17.4, "compacted-graphite-iron"),
      head: nfzHead,
      induction: { aspiration: "turbo", compressorInducerMm: 90, turbineAR: 0.7, variableGeometry: true, boostTargetBar: 2.0, intercooler: "air-to-air", intakeRunnerLengthMm: 400, individualThrottleBodies: false },
      fuelSystem: dieselFuel(2400, 1.25), exhaust: { ...nfzExhaust, egr: false },
      cooling: { radiatorCapacityKw: 520, thermostatOpenC: 85, oilCooler: true }, revLimitRpm: 2100, idleRpm: 550,
      ecuTorqueLimitNm: 3300, ecuPowerLimitKw: 479,
      engineBrake: { kind: "exhaust-flap", maxKw: 320, ratedRpm: 2400 },
    },
    expected: { peakTorqueNm: 3300, peakTorqueRpm: 1150, peakPowerKw: 479, peakPowerRpm: 1900 },
    source: "Scania Motorenübersicht Euro 6 (2017, cadenadesuministro.es): DC16 118 650 PS, 130 × 154 mm, 479 kW @ 1900, 3300 Nm @ 950–1350, Auspuffbremse 297/320 kW @ 2400; ε 17,4 (Tabellenwert, Zuordnung unklar [S]); XPI 2400 bar, SCR-only ohne AGR [S]",
  },
  {
    maker: "Mercedes-Benz", cars: "Citaro, Atego, Econic", years: "seit 2013", category: "commercial",
    config: {
      id: "lib-mercedes-om936", name: "Mercedes-Benz OM 936 (7.7 R6, 220 kW)", fuel: "diesel",
      block: nfzBlk("inline", 6, 110, 135, 220, 17.5, "cast-iron"),
      head: nfzHead,
      induction: { aspiration: "turbo", compressorInducerMm: 65, turbineAR: 0.7, variableGeometry: true, boostTargetBar: 2.0, intercooler: "air-to-air", intakeRunnerLengthMm: 400, individualThrottleBodies: false },
      fuelSystem: dieselFuel(2400, 1.25), exhaust: nfzExhaust,
      cooling: { radiatorCapacityKw: 250, thermostatOpenC: 85, oilCooler: true }, revLimitRpm: 2100, idleRpm: 600,
      ecuTorqueLimitNm: 1200, ecuPowerLimitKw: 220,
      engineBrake: { kind: "decompression", maxKw: 235, ratedRpm: 2100 },
    },
    expected: { peakTorqueNm: 1200, peakTorqueRpm: 1400, peakPowerKw: 220, peakPowerRpm: 1800 },
    source: "Mercedes-Benz Powertrain Bus Euro VI 2021 (OM 936: 7,7 l R6, 220 kW @ 1800, 1200 Nm @ 1200–1600, 652 kg, Einspritzdruck der Baureihe bis 2400 bar, Motorbremse bis 300 kW → 235 kW [S]); 110 × 135 mm (übliche Angabe, passt zu 7,7 l) [B]; ε 17,5 [S]",
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
  ...COMMERCIAL,
  ...MOTO,
].sort((a, b) => (a.config.fuel === b.config.fuel ? a.config.name.localeCompare(b.config.name, "de") : a.config.fuel === "diesel" ? -1 : 1));

/** Deep copy of a library engine's config, ready to edit on the bench. */
export function libraryConfig(id: string): EngineConfig {
  const e = ENGINE_LIBRARY.find((x) => x.config.id === id);
  if (!e) throw new Error(`unknown library engine: ${id}`);
  return structuredClone(e.config);
}
