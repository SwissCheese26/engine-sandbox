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
  /**
   * Inline twin only (issue #25): crankpin offset. 360° = both pistons together, even 360/360 firing (old British
   * twins, BMW F 800); 180° = 180/540 (Honda CB450); 270° = 270/450, V-twin-like (Yamaha MT-07, Triumph Bonneville
   * 1200). Default 360.
   */
  twinCrankDeg?: 180 | 270 | 360;
  /** Inline four only (issue #25): crossplane crank (Yamaha R1 since 2009), firing 270-180-90-180. Default false. */
  crossplaneI4?: boolean;
  /**
   * Light flywheel (issue #25): crank + clutch only, as on motorcycles (inertia ×0.4). Default: true when
   * revLimitRpm > 9500, otherwise false.
   */
  lightFlywheel?: boolean;
}

export type Valvetrain = "ohv" | "sohc" | "dohc";
export type VariableValveTiming = "none" | "intake-cam" | "dual-cam" | "cam-switching";

export interface HeadConfig {
  valvetrain: Valvetrain;
  valvesPerCylinder: 2 | 3 | 4 | 5;
  /** 0 = very mild/economy cam (torque low down), 1 = race cam (power high up, poor idle). */
  camProfile: number;
  variableTiming: VariableValveTiming;
  /** Valve material (issue #25). Titanium valves are ≈ 40 % lighter → higher valve-float speed. Default steel. */
  valveMaterial?: "steel" | "titanium";
  /** Valve springs (issue #25): "high-rate" = dual / beehive springs of high-revving heads (rate ≈ +55 %). Default standard. */
  valveSprings?: "standard" | "high-rate";
  /** Desmodromic valve actuation (Ducati): valves closed by a cam, no spring → hardly any valve float. Default false. */
  desmodromic?: boolean;
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
  /**
   * Overrun afterfire calibration ("pops & bangs", issue #16), petrol only: in overrun the ECU injects a little
   * fuel with very late ignition so it burns in the hot manifold / exhaust. Optional, undefined = "off".
   * Ignored for diesels (no spark, no injection in overrun).
   */
  overrunPops?: OverrunPops;
}

/**
 * Cooling type (issue #25). "liquid" = coolant circuit with radiator and thermostat (default).
 * "air" = finned cylinders/heads, no coolant: the "coolant" temperature in EngineState is then the cylinder head
 * temperature, cooled by ram air (vehicle speed). "oil-air" = like air plus oil jets on the head and a large oil cooler.
 */
export type CoolingType = "liquid" | "air" | "oil-air";

export type OverrunPops = "off" | "mild" | "popcorn" | "brutal";

export interface CoolingConfig {
  /** Default "liquid". For air / oil-air, radiatorCapacityKw is the fin heat rejection at 90 km/h ram air and 150 K head-to-ambient. */
  type?: CoolingType;
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
  /**
   * ECU torque limit at the flywheel in Nm (issue #18): the ECU reduces boost / fuel quantity / throttle so that
   * the brake torque stays at or below this value (gearbox protection, typical for modern turbo engines).
   * Optional, undefined = no limit.
   */
  ecuTorqueLimitNm?: number;
  /**
   * ECU power limit at the flywheel in kW (issue #31): above the torque plateau the ECU holds this power (torque
   * limit P/ω), as truck engines are sold in several power ratings of the same hardware. Optional, undefined = none.
   */
  ecuPowerLimitKw?: number;
  /**
   * Engine brake (issue #31, commercial vehicles): extra braking torque on overrun (pedal 0, above idle).
   * "exhaust-flap" = butterfly in the exhaust raises the pumping work; "decompression" = additional valve opening
   * near TDC releases the compressed charge (Mercedes High Performance Engine Brake, Jacobs). `maxKw` is the braking
   * power at rated speed; it falls roughly with rpm² below (docs/research/commercial.md §3). Optional, undefined = none.
   */
  engineBrake?: EngineBrakeConfig;
}

/** Engine brake (issue #31). */
export interface EngineBrakeConfig {
  kind: "exhaust-flap" | "decompression";
  /** Braking power at the flywheel at rated speed, kW (positive number). */
  maxKw: number;
  /** Speed of maxKw, rpm. Default 0.9 · revLimitRpm. */
  ratedRpm?: number;
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
   * "torque" = constant brake torque `dynoBrakeTorqueNm`,
   * "vehicle" = chassis dyno: engine drives a vehicle through clutch and gearbox (`vehicle`, see drivetrain.ts).
   */
  dynoMode: "free" | "hold-rpm" | "torque" | "vehicle";
  dynoTargetRpm: number;
  dynoBrakeTorqueNm: number;
  ambientC: number;
  ambientKpa: number;
  /** Start with a warm engine (coolant at thermostat temperature, oil ≈ 90 °C). Read at the first step after reset(). */
  startWarm?: boolean;
  /**
   * Realism level for damage (issue #66), optional, default "real":
   *  - "real": wear and fatal damage as in limits.ts (engine can be destroyed),
   *  - "lenient": warnings and wear as usual, but no fatal damage (wear is capped below 1); a would-be fatal event
   *    is reported as a critical warning instead,
   *  - "off": sandbox, no wear and no damage (warnings still shown).
   */
  damage?: "real" | "lenient" | "off";
  /** Only for dynoMode "vehicle"; produced each frame by `Drivetrain.inputs()`. */
  vehicle?: VehicleCoupling;
  /** The vehicle's tank ran dry (fuel-tank.ts): no injection, the engine stalls and does not start. */
  fuelEmpty?: boolean;
}

/** Vehicle physics parameters (fixed base vehicle for now, see DEFAULT_VEHICLE). */
export interface VehicleParams {
  massKg: number;
  dragCoefficient: number;
  frontalAreaM2: number;
  rollingResistance: number;
  wheelRadiusM: number;
  /**
   * Optional chassis data, m (shared by cars and motorcycles; issues #22 and #25):
   *  - cgHeightM: centre-of-gravity height, cgToRearAxleM: horizontal distance rear axle → CG, wheelbaseM: wheelbase.
   *    Static front axle share = cgToRearAxleM / wheelbaseM; load transfer ΔN = m·a·h/l (see vehicle.ts).
   *  - Wheelie limit (motorcycles, #25): with cgHeightM and cgToRearAxleM the drive force is limited to
   *    m·g·cgToRearAxleM / cgHeightM (front wheel unloaded; simplified anti-wheelie control). Cars never reach it.
   *  - driveLayout (#22): driven axle(s). With driveLayout and VehicleCoupling.grip the drive force is
   *    traction-limited (μ·N on the driven axle), see simulator.ts stepVehicle.
   */
  cgHeightM?: number;
  cgToRearAxleM?: number;
  wheelbaseM?: number;
  driveLayout?: DriveLayout;
  /** Rotating inertia of the driven wheels incl. tyres, discs, half shafts, kg·m² (issue #22). Default 1.0 per
   *  driven wheel (2 for FWD/RWD, 4 for AWD); a motorcycle rear wheel ≈ 0.6. */
  drivenWheelInertiaKgM2?: number;
}

/** Driven axle(s) (issue #22). */
export type DriveLayout = "fwd" | "rwd" | "awd";

/** What the drivetrain hands to the simulator for one frame. */
export interface VehicleCoupling {
  vehicle: VehicleParams;
  /** Total ratio engine : wheel (gear × final drive). 0 = neutral. */
  totalRatio: number;
  /** Driveline efficiency 0 … 1. */
  efficiency: number;
  /** Clutch engagement 0 (open) … 1 (closed). */
  clutch: number;
  /** Max torque the closed clutch can transmit, Nm. */
  clutchCapacityNm: number;
  /** Service brake 0 … 1 (1 ≈ full braking, about 1 g). Optional, default 0. */
  brake?: number;
  /**
   * Peak tyre–road friction coefficient μ for this frame (issue #22: tyre type × surface × tyre temperature, see
   * `tyreGrip()`). When set, drive force is limited to μ·N on the driven axle(s) (wheel spin above it, sliding
   * friction ≈ 0.9·μ) and the service brake to μ·m·g (wheels lock above it). Unset = no traction limit, brake 1 g.
   */
  grip?: number;
  /** Torque multiplication of a slipping torque converter (issue #22), ≥ 1; applies only while the clutch slips. */
  torqueRatio?: number;
  /**
   * Issue #23 (Umwelt & Fahrassistenten), all optional:
   *  - abs: the ABS hydraulic unit modulates the brake pressure so the braked wheels stay near the μ peak
   *    (brake slip ≈ PEAK_SLIP, cycles at ≈ 8–15 Hz). Unset/false = wheels lock above μ·m·g.
   *  - gradePct: road gradient in % (+ uphill): downhill force m·g·sin(atan(p/100)), normal force × cos.
   *  - airDensityKgM3: air density for the aerodynamic drag (altitude, temperature), default 1.2.
   *  - torqueCut: share 0 … 1 of the positive engine torque removed by ignition retard (ASR, petrol only).
   */
  abs?: boolean;
  gradePct?: number;
  airDensityKgM3?: number;
  torqueCut?: number;
  /** A gear change is in progress (issue #31): the engine brake (EngineConfig.engineBrake) is switched off meanwhile. */
  shifting?: boolean;
  /**
   * Hydrodynamic torque converter between engine and gearbox (issue #14, "Wandlerautomatik", converter.ts). When set,
   * the converter always couples engine and gearbox input (T_P = λ(ν)·(n/K)², T_T = μ(ν)·T_P) and `clutch` is the
   * lock-up clutch in parallel to it; torqueRatio is ignored.
   */
  converter?: ConverterCoupling;
}

/** Converter characteristic handed to the simulator (issue #14, docs/research/vehicle.md §4). */
export interface ConverterCoupling {
  /** Capacity factor K at stall, rpm/√Nm (SAE J643): pump torque at stall = (n_P / K)². */
  kFactor: number;
  /** Torque ratio at stall (speed ratio 0), ≈ 1.8–2.5. */
  stallTorqueRatio: number;
  /** Coupling point: speed ratio where the torque ratio reaches 1, ≈ 0.85–0.9. */
  couplingPoint: number;
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
  /** Catalyst overheated (e.g. by overrun afterfire, issue #16). */
  | "catalyst-overheat"
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
  /** Vehicle speed in m/s (dynoMode "vehicle"; 0 otherwise). */
  vehicleSpeedMs?: number;
  /**
   * Overrun afterfire intensity 0 … 1 for the sound engine (pops & bangs, issue #16). 0 = no afterfire.
   * Only petrol engines with `exhaust.overrunPops` set produce values > 0.
   */
  afterfire?: number;
  /** Torque limit of the ECU currently active (brake torque held at `ecuTorqueLimitNm`, issue #18). */
  torqueLimited?: boolean;
  /** Engine brake (config.engineBrake, issue #31) acting in this frame; torqueNm then includes its braking torque. */
  engineBrakeActive?: boolean;
  /**
   * Issue #22 (only with VehicleCoupling.grip): circumferential speed of the driven wheels, m/s (> vehicle speed
   * while they spin), longitudinal tyre slip of the driven wheels (v_wheel − v) / max(v, 1 m/s), wheel spin and
   * locked-brake flags, tyre force on the road (N, + = driving) and longitudinal acceleration (m/s²).
   */
  wheelSpeedMs?: number;
  wheelSlip?: number;
  wheelSpin?: boolean;
  wheelsLocked?: boolean;
  tyreForceN?: number;
  accelMs2?: number;
  /**
   * Issue #23 (only with VehicleCoupling.grip): longitudinal slip of the braked wheels (< 0 braking, −1 locked), ABS
   * regulating (held 0.3 s), number of ABS pressure-release cycles since reset (for the rattle sound, counts up at
   * the ABS rhythm), brake pressure relative to the driver demand 0 … 1, and the peak μ of this frame.
   */
  brakeSlip?: number;
  absActive?: boolean;
  absCycles?: number;
  absPressure?: number;
  roadGrip?: number;
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
  /** Mean piston speed from which "piston-speed" warns, m/s. */
  meanPistonSpeedMaxMs: number;
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
