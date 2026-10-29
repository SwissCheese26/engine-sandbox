import type { EngineConfig } from "../core/types.ts";

/**
 * Reference engines for calibration tests (owned by the test team).
 *
 * Data sheet values (bore, stroke, compression, peak torque/power) are taken from the research
 * specifications: docs/research/diesel.md §5 and docs/research/petrol.md §7, which cite their sources.
 * Construction fields without a data sheet value (conrod length, cam profile, inducer size, runner
 * length, radiator capacity …) are estimates [S] as proposed there.
 *
 * For engines with a torque or power plateau (e.g. N57: 560 Nm @ 1500–3000) the expected rpm is the
 * middle of the plateau; the calibration test accepts any point of the plateau (≥ 98 % of peak).
 */
export interface ReferenceEngine {
  config: EngineConfig;
  expected: { peakTorqueNm: number; peakTorqueRpm: number; peakPowerKw: number; peakPowerRpm: number };
  source: string;
}

const NA_INDUCTION = {
  aspiration: "naturally-aspirated",
  compressorInducerMm: 45,
  turbineAR: 0.6,
  variableGeometry: false,
  boostTargetBar: 0,
  intercooler: "none",
  individualThrottleBodies: false,
} as const;

// ───────────────────────────── Diesel ─────────────────────────────

const VW_19_TDI_PD: ReferenceEngine = {
  config: {
    id: "ref-vw-19-tdi-pd-96kw",
    name: "VW 1.9 TDI PD (ASZ, 96 kW)",
    fuel: "diesel",
    block: {
      layout: "inline", cylinders: 4, bankAngleDeg: 0, v8Crank: "crossplane",
      boreMm: 79.5, strokeMm: 95.5, conrodLengthMm: 144, compressionRatio: 18,
      blockMaterial: "cast-iron", crankshaft: "forged", pistons: "cast-aluminium", conrods: "forged-steel",
    },
    head: { valvetrain: "sohc", valvesPerCylinder: 2, camProfile: 0.2, variableTiming: "none" },
    induction: {
      aspiration: "turbo", compressorInducerMm: 38, turbineAR: 0.5, variableGeometry: true,
      boostTargetBar: 1.4, intercooler: "air-to-air", intakeRunnerLengthMm: 380, individualThrottleBodies: false,
    },
    fuelSystem: {
      kind: "diesel", injection: "unit-injector", injectionPressureBar: 2050, fuel: "diesel",
      smokeLimitLambda: 1.2, injectionTimingOffsetDeg: 0,
    },
    exhaust: { manifold: "cast-log", egr: true, catalyst: true, particulateFilter: false, scr: false },
    cooling: { radiatorCapacityKw: 70, thermostatOpenC: 87, oilCooler: true },
    revLimitRpm: 4900,
    idleRpm: 850,
  },
  expected: { peakTorqueNm: 310, peakTorqueRpm: 1900, peakPowerKw: 96, peakPowerRpm: 4000 },
  source: "docs/research/diesel.md §5 (VW 1.9 TDI PD ASZ/AVF; Datenblatt 96 kW @ 4000, 310 Nm @ 1900)",
};

const BMW_N57: ReferenceEngine = {
  config: {
    id: "ref-bmw-n57d30o1",
    name: "BMW N57D30O1 (3.0d, 190 kW)",
    fuel: "diesel",
    block: {
      layout: "inline", cylinders: 6, bankAngleDeg: 0, v8Crank: "crossplane",
      boreMm: 84, strokeMm: 90, conrodLengthMm: 145, compressionRatio: 16.5,
      blockMaterial: "aluminium", crankshaft: "forged", pistons: "cast-aluminium", conrods: "forged-steel",
    },
    head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.3, variableTiming: "none" },
    induction: {
      aspiration: "turbo", compressorInducerMm: 46, turbineAR: 0.6, variableGeometry: true,
      boostTargetBar: 1.7, intercooler: "air-to-air", intakeRunnerLengthMm: 350, individualThrottleBodies: false,
    },
    fuelSystem: {
      kind: "diesel", injection: "common-rail", injectionPressureBar: 1800, fuel: "diesel",
      smokeLimitLambda: 1.25, injectionTimingOffsetDeg: 0,
    },
    exhaust: { manifold: "cast-log", egr: true, catalyst: true, particulateFilter: true, scr: false },
    cooling: { radiatorCapacityKw: 120, thermostatOpenC: 88, oilCooler: true },
    revLimitRpm: 5400,
    idleRpm: 750,
  },
  expected: { peakTorqueNm: 560, peakTorqueRpm: 2250, peakPowerKw: 190, peakPowerRpm: 4000 },
  source: "docs/research/diesel.md §5 (BMW N57D30O1; 190 kW @ 4000, 560 Nm @ 1500–3000)",
};

const MERCEDES_OM654: ReferenceEngine = {
  config: {
    id: "ref-mercedes-om654-220d",
    name: "Mercedes OM654 (220d, 143 kW)",
    fuel: "diesel",
    block: {
      layout: "inline", cylinders: 4, bankAngleDeg: 0, v8Crank: "crossplane",
      boreMm: 82, strokeMm: 92.3, conrodLengthMm: 138, compressionRatio: 15.5,
      blockMaterial: "aluminium", crankshaft: "forged", pistons: "steel", conrods: "forged-steel",
    },
    head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.3, variableTiming: "none" },
    induction: {
      aspiration: "turbo", compressorInducerMm: 42, turbineAR: 0.55, variableGeometry: true,
      boostTargetBar: 1.7, intercooler: "air-to-air", intakeRunnerLengthMm: 350, individualThrottleBodies: false,
    },
    fuelSystem: {
      kind: "diesel", injection: "common-rail", injectionPressureBar: 2050, fuel: "diesel",
      smokeLimitLambda: 1.25, injectionTimingOffsetDeg: 0,
    },
    exhaust: { manifold: "cast-log", egr: true, catalyst: true, particulateFilter: true, scr: true },
    cooling: { radiatorCapacityKw: 95, thermostatOpenC: 90, oilCooler: true },
    revLimitRpm: 4800,
    idleRpm: 750,
  },
  expected: { peakTorqueNm: 400, peakTorqueRpm: 2000, peakPowerKw: 143, peakPowerRpm: 3800 },
  source: "docs/research/diesel.md §5 (Mercedes OM654 220d; 143 kW @ 3800, 400 Nm @ 1600–2400)",
};

const PSA_16_HDI: ReferenceEngine = {
  config: {
    id: "ref-psa-16-hdi-dv6ted4",
    name: "PSA/Ford 1.6 HDi 16V (DV6TED4, 80 kW)",
    fuel: "diesel",
    block: {
      layout: "inline", cylinders: 4, bankAngleDeg: 0, v8Crank: "crossplane",
      boreMm: 75, strokeMm: 88.3, conrodLengthMm: 136.8, compressionRatio: 18,
      blockMaterial: "aluminium", crankshaft: "cast", pistons: "cast-aluminium", conrods: "forged-steel",
    },
    head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.25, variableTiming: "none" },
    induction: {
      aspiration: "turbo", compressorInducerMm: 36, turbineAR: 0.45, variableGeometry: true,
      boostTargetBar: 1.2, intercooler: "air-to-air", intakeRunnerLengthMm: 350, individualThrottleBodies: false,
    },
    fuelSystem: {
      kind: "diesel", injection: "common-rail", injectionPressureBar: 1600, fuel: "diesel",
      smokeLimitLambda: 1.25, injectionTimingOffsetDeg: 0,
    },
    exhaust: { manifold: "cast-log", egr: true, catalyst: true, particulateFilter: true, scr: false },
    cooling: { radiatorCapacityKw: 60, thermostatOpenC: 88, oilCooler: true },
    revLimitRpm: 5000,
    idleRpm: 800,
  },
  expected: { peakTorqueNm: 240, peakTorqueRpm: 1750, peakPowerKw: 80, peakPowerRpm: 4000 },
  source: "docs/research/diesel.md §5 (PSA/Ford DV6TED4; 80 kW @ 4000 [Drehzahl S], 240 Nm @ 1750)",
};

const CUMMINS_6BT: ReferenceEngine = {
  config: {
    id: "ref-cummins-6bt-59",
    name: "Cummins 6BT 5.9 12V (160 kW)",
    fuel: "diesel",
    block: {
      layout: "inline", cylinders: 6, bankAngleDeg: 0, v8Crank: "crossplane",
      boreMm: 102, strokeMm: 120, conrodLengthMm: 192, compressionRatio: 17.5,
      blockMaterial: "cast-iron", crankshaft: "forged", pistons: "cast-aluminium", conrods: "forged-steel",
    },
    head: { valvetrain: "ohv", valvesPerCylinder: 2, camProfile: 0.1, variableTiming: "none" },
    induction: {
      aspiration: "turbo", compressorInducerMm: 55, turbineAR: 0.8, variableGeometry: false,
      boostTargetBar: 1.4, intercooler: "air-to-air", intakeRunnerLengthMm: 300, individualThrottleBodies: false,
    },
    fuelSystem: {
      // Real: Bosch P7100 inline pump. Kern-Physik is adding DieselInjection "mechanical-pump";
      // until that is in main, use "unit-injector" @ 1000 bar as diesel.md §5 proposes.
      // TODO: switch to injection: "mechanical-pump" once the enum value lands.
      kind: "diesel", injection: "unit-injector", injectionPressureBar: 1000, fuel: "diesel",
      smokeLimitLambda: 1.35, injectionTimingOffsetDeg: 0,
    },
    exhaust: { manifold: "cast-log", egr: false, catalyst: false, particulateFilter: false, scr: false },
    cooling: { radiatorCapacityKw: 150, thermostatOpenC: 83, oilCooler: true },
    revLimitRpm: 2800,
    idleRpm: 750,
  },
  // diesel.md §5 lists 160 kW @ 2600 with 569 Nm @ 1600, but 160 kW @ 2600 alone needs 588 Nm, so the
  // pair is inconsistent. 569 Nm (420 lb·ft) belongs to the 180 hp version; the 160 kW / 215 hp
  // version (Ram 1996–98, manual) has 440 lb·ft = 597 Nm @ 1600 (engine-specs.net lists up to 569 Nm
  // for its variants, Cummins/Dodge data 440 lb·ft for the 215 hp rating). We use the consistent pair.
  expected: { peakTorqueNm: 597, peakTorqueRpm: 1600, peakPowerKw: 160, peakPowerRpm: 2600 },
  source: "docs/research/diesel.md §5 (Cummins 6BT 5.9 12V, Dodge Ram 1996–98, 160 kW @ 2600); torque 597 Nm (440 lb·ft) instead of 569 Nm, see comment",
};

// ───────────────────────────── Petrol ─────────────────────────────

const HONDA_K20A: ReferenceEngine = {
  config: {
    id: "ref-honda-k20a-type-r",
    name: "Honda K20A (DC5 Type R, 162 kW)",
    fuel: "petrol",
    block: {
      layout: "inline", cylinders: 4, bankAngleDeg: 0, v8Crank: "crossplane",
      boreMm: 86, strokeMm: 86, conrodLengthMm: 139, compressionRatio: 11.5,
      blockMaterial: "aluminium", crankshaft: "forged", pistons: "cast-aluminium", conrods: "forged-steel",
    },
    head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.85, variableTiming: "cam-switching" },
    // runner ≈ 180 mm puts the λ/4 resonance (petrol.md §3.2c) near the 7000 rpm torque peak
    induction: { ...NA_INDUCTION, intakeRunnerLengthMm: 180 },
    fuelSystem: { kind: "petrol", mixture: "port-injection", fuel: "ron98", fullLoadLambda: 0.88, ignitionAdvanceOffsetDeg: 0 },
    exhaust: { manifold: "tubular-long", egr: false, catalyst: true, particulateFilter: false, scr: false },
    cooling: { radiatorCapacityKw: 80, thermostatOpenC: 82, oilCooler: false },
    revLimitRpm: 8400,
    idleRpm: 800,
  },
  expected: { peakTorqueNm: 206, peakTorqueRpm: 7000, peakPowerKw: 162, peakPowerRpm: 8000 },
  source: "docs/research/petrol.md §7 (Honda K20A DC5 Type R JDM; 162 kW @ 8000, 206 Nm @ 7000)",
};

const VW_EA888_GEN3: ReferenceEngine = {
  config: {
    id: "ref-vw-ea888-gen3-chhb",
    name: "VW EA888 Gen3 (CHHB, Golf 7 GTI, 162 kW)",
    fuel: "petrol",
    block: {
      layout: "inline", cylinders: 4, bankAngleDeg: 0, v8Crank: "crossplane",
      boreMm: 82.5, strokeMm: 92.8, conrodLengthMm: 144, compressionRatio: 9.6,
      blockMaterial: "cast-iron", crankshaft: "forged", pistons: "cast-aluminium", conrods: "forged-steel",
    },
    head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.35, variableTiming: "dual-cam" },
    induction: {
      aspiration: "turbo", compressorInducerMm: 42, turbineAR: 0.5, variableGeometry: false,
      boostTargetBar: 1.3, intercooler: "air-to-air", intakeRunnerLengthMm: 280, individualThrottleBodies: false,
    },
    fuelSystem: { kind: "petrol", mixture: "dual-injection", fuel: "ron95", fullLoadLambda: 0.88, ignitionAdvanceOffsetDeg: 0 },
    exhaust: { manifold: "cast-log", egr: false, catalyst: true, particulateFilter: false, scr: false },
    cooling: { radiatorCapacityKw: 90, thermostatOpenC: 95, oilCooler: true },
    revLimitRpm: 6800,
    idleRpm: 700,
  },
  expected: { peakTorqueNm: 350, peakTorqueRpm: 2950, peakPowerKw: 162, peakPowerRpm: 5350 },
  source: "docs/research/petrol.md §7 (VW EA888 Gen3 CHHB; 162 kW @ 4500–6200, 350 Nm @ 1500–4400, ECU-Plateau)",
};

const BMW_S54: ReferenceEngine = {
  config: {
    id: "ref-bmw-s54b32",
    name: "BMW S54B32 (E46 M3, 252 kW)",
    fuel: "petrol",
    block: {
      layout: "inline", cylinders: 6, bankAngleDeg: 0, v8Crank: "crossplane",
      boreMm: 87, strokeMm: 91, conrodLengthMm: 139, compressionRatio: 11.5,
      blockMaterial: "cast-iron", crankshaft: "forged", pistons: "cast-aluminium", conrods: "forged-steel",
    },
    head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.8, variableTiming: "dual-cam" },
    induction: { ...NA_INDUCTION, intakeRunnerLengthMm: 300, individualThrottleBodies: true },
    fuelSystem: { kind: "petrol", mixture: "port-injection", fuel: "ron98", fullLoadLambda: 0.88, ignitionAdvanceOffsetDeg: 0 },
    exhaust: { manifold: "tubular-long", egr: false, catalyst: true, particulateFilter: false, scr: false },
    cooling: { radiatorCapacityKw: 130, thermostatOpenC: 88, oilCooler: true },
    revLimitRpm: 8000,
    idleRpm: 850,
  },
  expected: { peakTorqueNm: 365, peakTorqueRpm: 4900, peakPowerKw: 252, peakPowerRpm: 7900 },
  source: "docs/research/petrol.md §7 (BMW S54B32 E46 M3; 252 kW @ 7900, 365 Nm @ 4900)",
};

const GM_LS3: ReferenceEngine = {
  config: {
    id: "ref-gm-ls3-62",
    name: "GM LS3 6.2 (C6 Corvette, 321 kW)",
    fuel: "petrol",
    block: {
      layout: "v", cylinders: 8, bankAngleDeg: 90, v8Crank: "crossplane",
      boreMm: 103.25, strokeMm: 92, conrodLengthMm: 154.9, compressionRatio: 10.7,
      blockMaterial: "aluminium", crankshaft: "cast", pistons: "cast-aluminium", conrods: "forged-steel",
    },
    head: { valvetrain: "ohv", valvesPerCylinder: 2, camProfile: 0.35, variableTiming: "none" },
    induction: { ...NA_INDUCTION, intakeRunnerLengthMm: 300 },
    // US 91 AKI ≈ 95–96 RON → ron95 (petrol.md §7)
    fuelSystem: { kind: "petrol", mixture: "port-injection", fuel: "ron95", fullLoadLambda: 0.88, ignitionAdvanceOffsetDeg: 0 },
    exhaust: { manifold: "cast-log", egr: false, catalyst: true, particulateFilter: false, scr: false },
    cooling: { radiatorCapacityKw: 160, thermostatOpenC: 88, oilCooler: true },
    revLimitRpm: 6600,
    idleRpm: 650,
  },
  expected: { peakTorqueNm: 575, peakTorqueRpm: 4600, peakPowerKw: 321, peakPowerRpm: 5900 },
  source: "docs/research/petrol.md §7 (GM LS3 6.2 C6 Corvette; 321 kW @ 5900, 575 Nm @ 4600)",
};

const FERRARI_F136FB: ReferenceEngine = {
  config: {
    id: "ref-ferrari-f136fb-458",
    name: "Ferrari F136 FB (458 Italia, 419 kW)",
    fuel: "petrol",
    block: {
      layout: "v", cylinders: 8, bankAngleDeg: 90, v8Crank: "flatplane",
      boreMm: 94, strokeMm: 81, conrodLengthMm: 140, compressionRatio: 12.5,
      blockMaterial: "aluminium", crankshaft: "forged", pistons: "forged-aluminium", conrods: "titanium",
    },
    head: { valvetrain: "dohc", valvesPerCylinder: 4, camProfile: 0.95, variableTiming: "dual-cam" },
    induction: { ...NA_INDUCTION, intakeRunnerLengthMm: 220 },
    fuelSystem: { kind: "petrol", mixture: "direct-injection", fuel: "ron98", fullLoadLambda: 0.88, ignitionAdvanceOffsetDeg: 0 },
    exhaust: { manifold: "tubular-long", egr: false, catalyst: true, particulateFilter: false, scr: false },
    cooling: { radiatorCapacityKw: 210, thermostatOpenC: 90, oilCooler: true },
    revLimitRpm: 9000,
    idleRpm: 1000,
  },
  expected: { peakTorqueNm: 540, peakTorqueRpm: 6000, peakPowerKw: 419, peakPowerRpm: 9000 },
  source: "docs/research/petrol.md §7 (Ferrari F136 FB 458 Italia; 419 kW @ 9000, 540 Nm @ 6000)",
};

export const REFERENCE_DIESELS: ReferenceEngine[] = [VW_19_TDI_PD, BMW_N57, MERCEDES_OM654, PSA_16_HDI, CUMMINS_6BT];
export const REFERENCE_PETROLS: ReferenceEngine[] = [HONDA_K20A, VW_EA888_GEN3, BMW_S54, GM_LS3, FERRARI_F136FB];

export const REFERENCE_ENGINES: ReferenceEngine[] = [...REFERENCE_DIESELS, ...REFERENCE_PETROLS];

/** Look up a reference engine by config id; returns a deep copy so tests can modify it freely. */
export function referenceConfig(id: string): EngineConfig {
  const r = REFERENCE_ENGINES.find((e) => e.config.id === id);
  if (!r) throw new Error(`unknown reference engine: ${id}`);
  return structuredClone(r.config);
}
