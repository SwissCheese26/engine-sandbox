/**
 * Shared contract between all teams. Physics core, UI, sound and tests depend on these types.
 * Changing a type here is an architecture change: open an issue labelled `architecture` first.
 *
 * Units: SI unless the field name says otherwise (…Mm, …Bar, …C, …Deg, …Rpm, …L).
 * Pressures in the config are gauge (relative to ambient) unless the name ends in …AbsKpa / …AbsBar.
 */

export type FuelKind = "diesel" | "petrol";

/** Cylinder arrangement. */
export type CylinderLayout = "inline" | "v" | "boxer" | "vr" | "w";

export type BlockMaterial = "cast-iron" | "compacted-graphite-iron" | "aluminium";
export type CrankshaftType = "cast" | "forged" | "billet";
export type PistonType = "cast-aluminium" | "forged-aluminium" | "steel";
export type ConrodType = "cast-steel" | "forged-steel" | "titanium";
export type V8Crank = "crossplane" | "flatplane";

export interface BlockConfig {
  layout: CylinderLayout;
  cylinders: number;
  /** Bank angle for v / vr / w layouts. Ignored for inline and boxer. */
  bankAngleDeg: number;
  /** Only relevant for V8: crossplane (rumble) vs flatplane (scream). */
  v8Crank: V8Crank;
  boreMm: number;
  strokeMm: number;
  conrodLengthMm: number;
  compressionRatio: number;
  blockMaterial: BlockMaterial;
  crankshaft: CrankshaftType;
  pistons: PistonType;
  conrods: ConrodType;
}

export type Valvetrain = "ohv" | "sohc" | "dohc";
export type VariableValveTiming = "none" | "intake-cam" | "dual-cam" | "cam-switching";

export interface HeadConfig {
  valvetrain: Valvetrain;
  valvesPerCylinder: 2 | 3 | 4 | 5;
  /** 0 = very mild/economy cam (torque low down), 1 = race cam (power high up, poor idle). */
  camProfile: number;
  variableTiming: VariableValveTiming;
}

export type Aspiration =
  | "naturally-aspirated"
  | "turbo"
  | "twin-turbo-parallel"
  | "twin-turbo-sequential"
  | "supercharger-roots"
  | "supercharger-centrifugal"
  | "e-turbo";

export type Intercooler = "none" | "air-to-air" | "air-to-water";

export interface InductionConfig {
  aspiration: Aspiration;
  /** Compressor inducer diameter in mm (turbo and centrifugal SC). Bigger = more flow, more lag. */
  compressorInducerMm: number;
  /** Turbine housing A/R. Bigger = less back pressure, more lag. */
  turbineAR: number;
  /** Variable turbine geometry (common on diesels). */
  variableGeometry: boolean;
  /** Target boost (gauge, bar). Ignored for naturally aspirated. */
  boostTargetBar: number;
  intercooler: Intercooler;
  /** Intake runner length in mm; tunes the volumetric-efficiency resonance rpm. */
  intakeRunnerLengthMm: number;
  /** Individual throttle bodies (petrol only, sharper response). */
  individualThrottleBodies: boolean;
}

export type DieselInjection =
  | "indirect-prechamber"
  | "indirect-swirl-chamber"
  | "unit-injector"
  | "common-rail"
  /** Mechanical inline / distributor pump (Bosch P7100, VE pump), ~400 … 1000 bar, no pilot injection. */
  | "mechanical-pump";
export type DieselFuel = "diesel" | "hvo" | "biodiesel";

export interface DieselFuelSystem {
  kind: "diesel";
  injection: DieselInjection;
  /** Max injection pressure in bar (common rail / unit injector). */
  injectionPressureBar: number;
  fuel: DieselFuel;
  /** Full-load lambda limit (smoke limit). Lower = more power, more soot. Typical 1.15 … 1.6. */
  smokeLimitLambda: number;
  /** Start-of-injection offset in °CA relative to the calibrated optimum (negative = retarded). */
  injectionTimingOffsetDeg: number;
}

export type PetrolMixture = "carburettor" | "port-injection" | "direct-injection" | "dual-injection";
export type PetrolFuel = "ron91" | "ron95" | "ron98" | "ron102" | "e85";

export interface PetrolFuelSystem {
  kind: "petrol";
  mixture: PetrolMixture;
  fuel: PetrolFuel;
  /** Full-load lambda (enrichment). 1.0 = stoich, 0.8 = rich for component protection. */
  fullLoadLambda: number;
  /** Ignition advance offset in °CA relative to the calibrated MBT map (positive = more advance, knock risk). */
  ignitionAdvanceOffsetDeg: number;
}

export type FuelSystemConfig = DieselFuelSystem | PetrolFuelSystem;

export type ExhaustManifold = "cast-log" | "tubular-short" | "tubular-long";

export interface ExhaustConfig {
  manifold: ExhaustManifold;
  /** Exhaust gas recirculation (mostly diesel). */
  egr: boolean;
  /** Oxidation catalyst / three-way catalyst. */
  catalyst: boolean;
  /** Diesel particulate filter. */
  particulateFilter: boolean;
  /** Selective catalytic reduction (AdBlue). */
  scr: boolean;
}

export interface CoolingConfig {
  /** Radiator heat rejection capacity in kW at full fan and 90 °C coolant / 25 °C ambient. */
  radiatorCapacityKw: number;
  thermostatOpenC: number;
  oilCooler: boolean;
}

export interface EngineConfig {
  /** Stable id, used for presets and URLs. */
  id: string;
  name: string;
  fuel: FuelKind;
  block: BlockConfig;
  head: HeadConfig;
  induction: InductionConfig;
  fuelSystem: FuelSystemConfig;
  exhaust: ExhaustConfig;
  cooling: CoolingConfig;
  /** Rev limiter (fuel / ignition cut). */
  revLimitRpm: number;
  /** Idle speed target. */
  idleRpm: number;
}

/** Controls coming from the player per simulation tick. */
export interface SimInputs {
  /** Accelerator pedal 0 … 1. */
  pedal: number;
  /** Ignition / key on. */
  ignition: boolean;
  /** Starter motor engaged. */
  starter: boolean;
  /**
   * Dyno brake. "free" = engine revs freely (only own inertia + friction),
   * "hold-rpm" = eddy-current brake holds `dynoTargetRpm` (classic dyno sweep),
   * "torque" = constant brake torque `dynoBrakeTorqueNm`.
   */
  dynoMode: "free" | "hold-rpm" | "torque";
  dynoTargetRpm: number;
  dynoBrakeTorqueNm: number;
  ambientC: number;
  ambientKpa: number;
}

export type Severity = "info" | "warning" | "critical";

export interface Warning {
  code: WarningCode;
  severity: Severity;
  /** Human readable German text for the UI. */
  message: string;
  /** Config field path the warning refers to, e.g. "block.compressionRatio" (validateConfig). */
  field?: string;
}

export type WarningCode =
  | "over-rev"
  | "valve-float"
  | "piston-speed"
  | "overheat-coolant"
  | "overheat-oil"
  | "low-oil-pressure"
  | "egt-high"
  | "turbo-overspeed"
  | "overboost"
  | "knock"
  | "peak-pressure"
  | "smoke"
  | "stall"
  | "conrod-stress"
  /** Implausible configuration (validateConfig only). */
  | "config";

export interface DamageEvent {
  code: WarningCode;
  /** Simulation time in seconds when it happened. */
  t: number;
  message: string;
  /** Engine destroyed? Then the simulator stops. */
  fatal: boolean;
}

/** Everything the UI, gauges and sound need each frame. */
export interface EngineState {
  t: number;
  running: boolean;
  /** True once a fatal damage event happened. Needs reset. */
  destroyed: boolean;
  rpm: number;
  /** Crank angle 0 … 720 ° (4-stroke cycle). Used by sound and the schematic. */
  crankAngleDeg: number;
  /** Brake (output) torque at the flywheel in Nm. */
  torqueNm: number;
  powerKw: number;
  /** Indicated & effective mean pressures in bar. */
  imepBar: number;
  bmepBar: number;
  fmepBar: number;
  /** Load 0 … 1 relative to full-load torque at this rpm. Sound uses this. */
  load: number;
  manifoldAbsKpa: number;
  boostBar: number;
  turboRpm: number;
  airMassFlowKgS: number;
  fuelMassFlowGS: number;
  fuelFlowLh: number;
  /** Brake specific fuel consumption, g/kWh (NaN when power ~ 0). */
  bsfcGkWh: number;
  /** Effective (brake) thermal efficiency 0 … 1. */
  efficiency: number;
  lambda: number;
  /** Exhaust gas temperature before turbine, °C. */
  egtC: number;
  coolantC: number;
  oilC: number;
  oilPressureBar: number;
  /** Peak cylinder pressure, bar. */
  peakPressureBar: number;
  meanPistonSpeedMs: number;
  /** Petrol: knock intensity 0 … 1. Diesel: always 0. */
  knock: number;
  /** Diesel: smoke opacity 0 … 1. Petrol: always 0. */
  smoke: number;
  /** Accumulated wear 0 … 1 (1 = destroyed). */
  wear: number;
  warnings: Warning[];
  damage: DamageEvent[];
  /** Starter motor is powered (key in start position and engine not destroyed). */
  starterEngaged: boolean;
}

/** One point of a steady-state full-load dyno sweep. */
export interface DynoPoint {
  rpm: number;
  torqueNm: number;
  powerKw: number;
  boostBar: number;
  bsfcGkWh: number;
  lambda: number;
  egtC: number;
  peakPressureBar: number;
}

/** Config-dependent limits for gauges (yellow ranges). Warnings start above these values. */
export interface EngineLimits {
  coolantMaxC: number;
  oilMaxC: number;
  /** Exhaust gas temperature before turbine / in the manifold. */
  egtMaxC: number;
  oilPressureMinBar: number;
  /** Gauge boost above which "overboost" is raised. 0 for naturally aspirated engines. */
  boostMaxBar: number;
  /** Design peak cylinder pressure (weakest of block, pistons, conrods). */
  peakPressureMaxBar: number;
  /** Max turbo shaft speed (rpm). 0 without turbocharger. */
  turboMaxRpm: number;
}

/** Static figures derived from the config (shown on the nameplate). */
export interface EngineSummary {
  displacementL: number;
  boreStrokeRatio: number;
  maxMeanPistonSpeedMs: number;
  /** Estimated dry mass in kg. */
  massKg: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  peakPowerKw: number;
  peakPowerRpm: number;
  /** Mechanically safe max rpm (piston speed / valve float), not the limiter. */
  safeMaxRpm: number;
  /** Firing interval pattern in crank degrees, length = cylinders, sum = 720. */
  firingIntervalsDeg: number[];
  /**
   * Firing order as 1-based cylinder numbers, same length as firingIntervalsDeg.
   * firingIntervalsDeg[k] is the angle from the firing of firingOrder[k] to firingOrder[k+1].
   */
  firingOrder: number[];
  /** Rough indicator 0 … 1 of how reliable the configuration is. */
  reliability: number;
  limits: EngineLimits;
}
