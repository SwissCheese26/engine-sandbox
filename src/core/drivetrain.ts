/**
 * Base drivetrain (issue #14): gearbox + clutch control on top of EngineSimulator's dynoMode "vehicle".
 * Fixed base vehicle (compact car), three gearbox types:
 *  - "manual": 6 gears, the driver shifts (up/down). Automatic clutch for launch and shifts (≈ 0.35 s interruption).
 *  - "dsg":    7-speed dual clutch. Drive mode shifts by itself; tapping up/down switches to manual mode (M).
 *              Shifts take ≈ 0.1 s without tractive interruption.
 *  - "cvt":    continuously variable ratio, holds an engine speed chosen by the pedal. No shifting.
 *  - "sequential": motorcycle 6-speed (issue #25). The rider shifts like the manual, but with quickshifter: upshift
 *              without closing the throttle (ignition cut ≈ 50 ms), downshift with auto-blipper (≈ 80 ms).
 * Vehicles (issue #25): compact car (default), superbike and tourer motorcycle (VEHICLES). Motorcycles carry CG
 * data, the simulator then limits the drive force at the wheelie limit (wheelieLimitN in vehicle.ts).
 * Vehicle and tyres (issue #22): chassis data (drive layout, weight distribution, CG height, wheelbase), tyre type and
 * size (tyres.ts), traction limit and wheel spin (simulator.ts stepVehicle), ready-made cars (src/data/vehicle-library.ts
 * via applyCar), per-car gear ratios (gearbox spec override).
 * Environment and driver assistance (issue #23): weather/surface, outside temperature, altitude, gradient
 * (environment.ts) and ABS / ASR / ESP / launch control (assists.ts), lamps in DrivetrainState.
 * Pure TypeScript, no DOM.
 */
import { CruiseControl } from "./cruise.ts";
import type { CruiseState } from "./cruise.ts";
import { DEFAULT_ASSISTS, ASSIST_LAMP_HOLD_S, TractionControl } from "./assists.ts";
import type { AssistSettings } from "./assists.ts";
import { DEFAULT_ENVIRONMENT, airDensity, altitudeToKpa, iceWarning, weatherSurface } from "./environment.ts";
import { isTerrain, roadAt } from "./terrain.ts";
import { DEFAULT_TANK_L, FuelTank } from "./fuel-tank.ts";
import type { Environment } from "./environment.ts";
import { DEFAULT_TYRE, TYRE_TYPES, aquaplaningFactor, compoundFactor, speedRatingKmh, stepTyreTemp, tyreGrip, tyreRadii } from "./tyres.ts";
import type { RoadSurface, TyreSetup } from "./tyres.ts";
import { drivenAxleLoadN, wheelieLimitN } from "./vehicle.ts";
import type { EngineConfig, EngineState, EngineSummary, VehicleCoupling, VehicleParams } from "./types.ts";

export type GearboxType = "manual" | "dsg" | "cvt" | "sequential";

/** Vehicle params with wheel radius and rolling resistance taken from the tyre (issue #22). */
export function withTyre(v: VehicleParams, tyre: TyreSetup): VehicleParams {
  return { ...v, wheelRadiusM: tyreRadii(tyre.size).dynamicM, rollingResistance: TYRE_TYPES[tyre.type].rollingResistance };
}

/**
 * Compact car incl. driver [S] (Golf-class: 1450 kg, cW 0.30, A 2.2 m², FWD, 61 % front, CG 0.55 m, wheelbase
 * 2.64 m), standard 225/45 R17 W tyres (dynamic radius 0.308 m).
 */
export const DEFAULT_VEHICLE: VehicleParams = withTyre({
  massKg: 1450,
  dragCoefficient: 0.3,
  frontalAreaM2: 2.2,
  rollingResistance: 0.011,
  wheelRadiusM: 0.308,
  driveLayout: "fwd",
  cgHeightM: 0.55,
  cgToRearAxleM: 1.61, // 61 % front axle load
  wheelbaseM: 2.64,
}, DEFAULT_TYRE);

export interface GearboxSpec {
  ratios: number[];
  finalDrive: number;
  efficiency: number;
  shiftTimeS: number;
  /**
   * Torque-converter automatic (issue #22): input-shaft speed up to which the launch slips (converter) before the
   * lock-up clutch closes, rpm. Torque multiplication of the converter is not modelled. Unset = clutch launch.
   */
  converterLockRpm?: number;
}

/** Typical ratios [S]: VW MQ350 6-speed manual, DQ381 7-speed DSG, generic chain CVT. */
export const GEARBOXES: Record<GearboxType, GearboxSpec> = {
  manual: { ratios: [3.77, 2.09, 1.47, 1.1, 0.87, 0.71], finalDrive: 3.45, efficiency: 0.93, shiftTimeS: 0.35 },
  dsg: { ratios: [3.56, 2.53, 1.59, 1.02, 0.79, 0.66, 0.55], finalDrive: 3.9, efficiency: 0.92, shiftTimeS: 0.1 },
  cvt: { ratios: [2.63, 0.38], finalDrive: 4.1, efficiency: 0.87, shiftTimeS: 0 },
  // Honda CBR1000RR SC59 (2008–2016, owner's manual): gears 2.286/1.778/1.500/1.333/1.214/1.138, primary 1.717 ×
  // chain 42/16 = 2.625 → "final drive" 4.51 (primary and secondary combined). Primary gear + gearbox + chain ≈ 0.92.
  // shiftTimeS = quickshifter upshift (ignition cut); downshift with blipper see SEQ_DOWNSHIFT_S.
  sequential: { ratios: [2.286, 1.778, 1.5, 1.333, 1.214, 1.138], finalDrive: 4.51, efficiency: 0.92, shiftTimeS: 0.05 },
};

/** Auto-blipper downshift time, s [S]. */
const SEQ_DOWNSHIFT_S = 0.08;

export type VehicleKind = "car" | "superbike" | "tourer";

export interface VehiclePreset {
  label: string;
  /** Short description for the panel. */
  hint: string;
  params: VehicleParams;
  /** Fitted tyre (issue #22); sets wheel radius and rolling resistance of params. */
  tyre: TyreSetup;
  /** Gearboxes this vehicle can have; the first is the default. */
  gearboxes: GearboxType[];
  finalDrive: number;
}

/**
 * Vehicles for the chassis dyno (issue #25) [S]. Motorcycles incl. rider (75 kg):
 * - Superbike (CBR1000RR / R1 class): 195 kg wet + rider ≈ 270 kg; cW·A ≈ 0.30 m² tucked; rear tyre 190/55 ZR17
 *   (Ø 641 mm, dynamic radius 0.31 m); wheelbase 1.40 m, CG height 0.60 m with rider, CG 0.70 m ahead of the rear
 *   axle (50/50) → wheelie limit ≈ 1.17 g.
 * - Tourer (BMW R 1250 RT class): 280 kg + rider ≈ 350 kg; cW·A ≈ 0.55 m² (fairing, upright rider); 180/55 ZR17
 *   (dynamic radius 0.30 m); wheelbase 1.49 m, CG 0.65 m high, 0.72 m ahead of the rear axle. Same sequential
 *   gearbox, longer final drive (the real RT has a shaft drive, the total 6th gear ratio is similar).
 * Rolling resistance of motorcycle tyres ≈ 0.015 (tyre type "motorcycle" in tyres.ts). Rear wheel with tyre, disc and
 * sprocket ≈ 0.6 kg·m² [S]. Rear-wheel drive with the
 * traction limit of issue #22 (rear axle load incl. load transfer).
 */
const SUPERBIKE_TYRE: TyreSetup = { type: "motorcycle", size: { widthMm: 190, aspectPct: 55, rimInch: 17 }, speedIndex: "(Y)" };
const TOURER_TYRE: TyreSetup = { type: "motorcycle", size: { widthMm: 180, aspectPct: 55, rimInch: 17 }, speedIndex: "W" };
export const VEHICLES: Record<VehicleKind, VehiclePreset> = {
  car: { label: "Auto (Kompaktklasse)", hint: "Kompaktwagen mit Fahrer.", params: DEFAULT_VEHICLE, tyre: DEFAULT_TYRE, gearboxes: ["manual", "dsg", "cvt"], finalDrive: GEARBOXES.manual.finalDrive },
  superbike: {
    label: "Motorrad (Superbike)", hint: "Superbike: 270 kg mit Fahrer, cW·A 0,30 m², Quickshifter. Wheelie-Grenze ≈ 1,2 g.",
    params: withTyre({ massKg: 270, dragCoefficient: 0.6, frontalAreaM2: 0.5, rollingResistance: 0.015, wheelRadiusM: 0.31, cgHeightM: 0.6, cgToRearAxleM: 0.7, wheelbaseM: 1.4, driveLayout: "rwd", drivenWheelInertiaKgM2: 0.6 }, SUPERBIKE_TYRE),
    tyre: SUPERBIKE_TYRE,
    gearboxes: ["sequential"], finalDrive: 4.51,
  },
  tourer: {
    label: "Motorrad (Tourer)", hint: "Tourer: 350 kg mit Fahrer, cW·A 0,55 m², Quickshifter.",
    params: withTyre({ massKg: 350, dragCoefficient: 0.65, frontalAreaM2: 0.85, rollingResistance: 0.015, wheelRadiusM: 0.3, cgHeightM: 0.65, cgToRearAxleM: 0.72, wheelbaseM: 1.49, driveLayout: "rwd", drivenWheelInertiaKgM2: 0.6 }, TOURER_TYRE),
    tyre: TOURER_TYRE,
    gearboxes: ["sequential"], finalDrive: 3.6,
  },
};

export interface DrivetrainState {
  type: GearboxType;
  /** 0 = neutral, 1 … n. For CVT: 1 while driving. */
  gear: number;
  gearCount: number;
  /** Current gearbox ratio (CVT: continuous). */
  ratio: number;
  finalDrive: number;
  /** DSG: false = Drive (automatic), true = manual tip mode. Manual gearbox: always true. */
  manualMode: boolean;
  shifting: boolean;
  clutch: number;
  speedKmh: number;
  maxSpeedKmh: number;
  /** Stopwatch 0–100 km/h: running time and last result. */
  t0to100S: number | null;
  t0to100Running: number | null;
  /** Electronic top-speed governor (issue #32): limit in km/h, null = off ("Aufhebung"). */
  speedLimitKmh: number | null;
  /** True while the governor holds the pedal back ("abgeregelt"). */
  limiting: boolean;
  /** True when the recorded maxSpeedKmh was reached with the governor in control. */
  maxSpeedLimited: boolean;
  /** Motorcycle: drive force at the wheelie limit, anti-wheelie is cutting (issue #25). */
  wheelie: boolean;
  /** Issue #22: driven wheels spin (held ≥ 0.3 s for the display), brakes locked, tyre tread temperature °C,
   *  current peak μ (tyre × surface × temperature), rated speed of the fitted tyre (speed index) in km/h. */
  wheelSpin: boolean;
  wheelsLocked: boolean;
  tyreTempC: number;
  grip: number;
  tyreRatingKmh: number;
  /**
   * Issue #23 (optional for older consumers): assistant settings, interventions (held ASSIST_LAMP_HOLD_S for the
   * blinking lamps), launch control armed, black-ice warning (< +3 °C), aquaplaning (water film costs > 10 % grip).
   */
  assists?: AssistSettings;
  absActive?: boolean;
  asrActive?: boolean;
  espActive?: boolean;
  launchArmed?: boolean;
  iceWarning?: boolean;
  aquaplaning?: boolean;
  /** Issue #30: cruise control and driver speed limiter (optional for older consumers). */
  cruise?: Readonly<CruiseState>;
  /**
   * Issue #48: position along the route (m), and the gradient (%) and altitude (m) the car is on – from the
   * route profile, or the fixed values of the environment on terrain "static".
   */
  positionM?: number;
  roadGradePct?: number;
  roadAltitudeM?: number;
}

/** A complete vehicle setup (issue #22, src/data/vehicle-library.ts): kind, body, tyre, gearbox, governor. */
export interface CarSetup {
  /** Vehicle kind (issue #25); default "car". */
  kind?: VehicleKind;
  /** Tank volume in litres (manufacturer data); default DEFAULT_TANK_L of the kind. */
  tankL?: number;
  /** Body/chassis; wheel radius and rolling resistance are overwritten from the tyre. */
  vehicle: VehicleParams;
  tyre: TyreSetup;
  gearbox: GearboxType;
  /** Gear ratios of this car; default GEARBOXES[gearbox]. */
  gearboxSpec?: GearboxSpec;
  speedLimitKmh: number | null;
}

/** Governor presets in km/h, null = off. Default 250 km/h (German manufacturers' voluntary agreement) [S]. */
export const SPEED_LIMIT_OPTIONS: readonly (number | null)[] = [null, 180, 210, 250, 270, 300];
export const DEFAULT_SPEED_LIMIT_KMH = 250;
/** Tyre speed rating W (ETRTO / ECE-R 30): 270 km/h. Since #22 the fitted tyre's index is in state.tyreRatingKmh. */
export const TYRE_RATING_W_KMH = 270;
/** Default ambient for the tyre temperature model, °C (issue #23: follows Environment.ambientC). */
const TYRE_AMBIENT_C = DEFAULT_ENVIRONMENT.ambientC;

// Governor PI gains (issue #32). It takes over from (limit − 5 km/h) and trims the pedal so speed settles at the
// limit without the hard cut of a rev limiter, like an ECU top-speed limiter acting on throttle / injection.
const GOV_WINDOW_KMH = 5;
const GOV_KP = 0.12; // pedal per km/h of remaining margin
const GOV_KI = 0.06; // pedal per (km/h · s)

const RAD_TO_RPM = 30 / Math.PI;

/** Max. rate of the air altitude (m/s), see updateRoad (#48). Fast real climbs reach ≈ 5 m/s. */
const AIR_ALT_RATE = 50;

export class Drivetrain {
  private st: DrivetrainState;
  private shiftT = 0;
  private pendingGear = 0;
  private holdLaunch = 0;
  /** Pedal cap holding the launch speed while the clutch is dosed by traction (review PR #37). */
  private launchCap = 1;
  private gearDwell = 0;
  private lastSpeedMs = 0;
  /** Fuel tank of the vehicle (drained by the app from the engine's fuel flow on the chassis dyno). */
  readonly tank = new FuelTank(DEFAULT_TANK_L.car);
  /** Issue #48: distance along the route and the road there (gradient, altitude). */
  private positionM = 0;
  private road = { altitudeM: 0, gradePct: 0 };
  private airAltM = 0;
  private govActive = false;
  private govI = 0;
  private govCap = 1;
  /** Remembered integrator (hold pedal) for the current limit, null = none yet. */
  private govHold: number | null = null;
  private shiftDir: 1 | -1 = 1;
  private wheelieHold = 0;
  /** Current vehicle preset (issue #25). */
  kind: VehicleKind = "car";
  /** Gear ratios in use (GEARBOXES[type] or a car's own, issue #22). */
  private spec: GearboxSpec;
  private tyreSetup: TyreSetup = DEFAULT_TYRE;
  private surfaceKind: RoadSurface = "dry";
  private gripFactor = 1;
  private spinHold = 0;
  private tyreT = TYRE_AMBIENT_C;
  private env: Environment = { ...DEFAULT_ENVIRONMENT };
  private aquaplane = false;
  private assistSet: AssistSettings = { ...DEFAULT_ASSISTS };
  /** Assistant choice of the car while a motorcycle is loaded (restored on the way back). */
  private carAssists: AssistSettings = { ...DEFAULT_ASSISTS };
  private tc = new TractionControl();
  private tcOut = { pedalCap: 1, torqueCut: 0, pedalFloor: 0 };
  private absHold = 0;
  private asrHold = 0;
  private espHold = 0;
  private roadKmh = 0;
  private lastEffPedal = 0;
  private tcCutting = false;
  /** Cruise control and driver speed limiter (issue #30). */
  private cc = new CruiseControl();
  private ccDownT = 0;

  constructor(
    private cfg: EngineConfig,
    private summary: EngineSummary,
    type: GearboxType = "manual",
    public vehicle: VehicleParams = DEFAULT_VEHICLE,
  ) {
    this.spec = GEARBOXES[type];
    this.st = this.fresh(type, GEARBOXES[type].finalDrive, DEFAULT_SPEED_LIMIT_KMH);
    this.updateRoad();
  }

  private fresh(type: GearboxType, finalDrive: number, speedLimitKmh: number | null): DrivetrainState {
    const g = this.spec;
    return {
      type, gear: type === "cvt" ? 1 : 1, gearCount: type === "cvt" ? 1 : g.ratios.length,
      ratio: g.ratios[0]!, finalDrive, manualMode: type === "manual", shifting: false, clutch: 0,
      speedKmh: 0, maxSpeedKmh: 0, t0to100S: null, t0to100Running: null,
      speedLimitKmh, limiting: false, maxSpeedLimited: false, wheelie: false,
      wheelSpin: false, wheelsLocked: false, tyreTempC: this.tyreT, grip: this.currentGrip(),
      tyreRatingKmh: speedRatingKmh(this.tyreSetup.speedIndex),
      assists: { ...this.assistSet }, absActive: false, asrActive: false, espActive: false, launchArmed: false,
      iceWarning: iceWarning(this.env.ambientC), aquaplaning: false, cruise: this.cc.state,
    };
  }

  get state(): DrivetrainState {
    return this.st;
  }

  setEngine(cfg: EngineConfig, summary: EngineSummary) {
    this.cfg = cfg;
    this.summary = summary;
  }

  setType(type: GearboxType) {
    this.clearTransient();
    this.spec = GEARBOXES[type];
    Object.assign(this.st, this.fresh(type, GEARBOXES[type].finalDrive, this.st.speedLimitKmh));
  }

  /** Gear ratios in use (generic per type or the loaded car's own). */
  get gearbox(): Readonly<GearboxSpec> {
    return this.spec;
  }

  get tyre(): TyreSetup {
    return this.tyreSetup;
  }

  get surface(): RoadSurface {
    return this.surfaceKind;
  }

  /** Body/chassis parameters (mass, cW, A, layout, weight share, CG, wheelbase); a fresh object each time. */
  setVehicleParams(p: Partial<VehicleParams>) {
    this.vehicle = withTyre({ ...this.vehicle, ...p }, this.tyreSetup);
    this.refreshTyreState();
  }

  /** Tyre type, size and speed index: wheel radius, rolling resistance, μ and tyre rating follow (issue #22). */
  setTyre(t: TyreSetup) {
    this.tyreSetup = { type: t.type, size: { ...t.size }, speedIndex: t.speedIndex };
    this.vehicle = withTyre(this.vehicle, this.tyreSetup);
    this.refreshTyreState();
  }

  /**
   * Road surface and an extra grip factor (issue #23 hooks: wetness, snow, ice; factor e.g. for a water film).
   * μ = tyreGrip(type, surface, tyreTemp) × factor.
   */
  setSurface(surface: RoadSurface, factor = 1) {
    this.surfaceKind = surface;
    this.gripFactor = Math.max(0, factor);
    this.refreshTyreState();
  }

  /**
   * Environment (issue #23): weather → surface and water film, outside temperature (tyres; the simulator gets it via
   * simInputs()), altitude (air pressure and density), gradient %. Partial updates are merged.
   */
  setEnvironment(e: Partial<Environment>) {
    const n = { ...this.env, ...e };
    n.ambientC = Math.min(50, Math.max(-30, Number.isFinite(n.ambientC) ? n.ambientC : 20));
    n.altitudeM = Math.min(5000, Math.max(-400, Number.isFinite(n.altitudeM) ? n.altitudeM : 0));
    n.gradePct = Math.min(30, Math.max(-30, Number.isFinite(n.gradePct) ? n.gradePct : 0));
    n.terrain = isTerrain(n.terrain) ? n.terrain : "static";
    // a new route starts at its beginning
    if (n.terrain !== (this.env.terrain ?? "static")) this.positionM = 0;
    this.env = n;
    this.updateRoad();
    const w = weatherSurface(n.weather);
    this.surfaceKind = w.surface;
    this.gripFactor = w.factor;
    this.aquaplane = w.aquaplaning;
    this.refreshTyreState();
    this.st.iceWarning = iceWarning(n.ambientC);
  }

  get environment(): Readonly<Environment> {
    return this.env;
  }

  /** ambientC / ambientKpa for SimInputs (engine intake air) from the environment (altitude of the road, #48). */
  simInputs(): { ambientC: number; ambientKpa: number } {
    return { ambientC: this.env.ambientC, ambientKpa: altitudeToKpa(this.airAltM) };
  }

  /** Position along the route (#48), e.g. to start over. */
  setPosition(m: number) {
    this.positionM = Number.isFinite(m) ? m : 0;
    this.updateRoad();
  }

  /**
   * Road at the current position. The altitude used for the air (pressure, density) follows the road altitude at
   * most AIR_ALT_RATE m/s: where a ramp route starts over ("Berg hoch/runter", next mountain) the air changes over
   * half a minute instead of in one frame (no torque jump in the engine). dt = 0: set directly (new route/setting).
   */
  private updateRoad(dt = 0) {
    this.road = roadAt(this.env, this.positionM);
    const target = this.road.altitudeM;
    this.airAltM = dt > 0 ? this.airAltM + Math.max(-AIR_ALT_RATE * dt, Math.min(AIR_ALT_RATE * dt, target - this.airAltM)) : target;
    this.st.positionM = this.positionM;
    this.st.roadGradePct = this.road.gradePct;
    this.st.roadAltitudeM = this.road.altitudeM;
  }

  /** Driver assistance on/off (issue #23), partial updates merged. */
  setAssists(a: Partial<AssistSettings>) {
    this.assistSet = { ...this.assistSet, ...a };
    this.st.assists = { ...this.assistSet };
    if (!this.assistSet.asr) this.tc.reset();
  }

  get assists(): Readonly<AssistSettings> {
    return this.assistSet;
  }

  /** Loads a complete car (issue #22): body, tyre, gearbox incl. its own ratios, governor. Vehicle at standstill. */
  applyCar(car: CarSetup) {
    // another car starts at the beginning of the route (#48)
    this.positionM = 0;
    this.updateRoad();
    const wasCar = this.kind === "car";
    this.kind = car.kind ?? "car";
    // the car's own tank, full
    this.tank.setCapacity(car.tankL ?? DEFAULT_TANK_L[this.kind]);
    // motorcycles (issue #25 presets: CBR1000RR-class superbike, tourer) have ABS but no ESP; traction control is
    // off like on the non-electronic base bikes the presets are modelled on (issue #23 decision). The car's own
    // choice is remembered and comes back when a car is loaded again (review PR #39).
    if (this.kind !== "car") {
      if (wasCar) this.carAssists = { ...this.assistSet };
      this.setAssists({ asr: false, esp: false });
    } else if (!wasCar) this.setAssists({ ...this.carAssists });
    this.tyreSetup = { type: car.tyre.type, size: { ...car.tyre.size }, speedIndex: car.tyre.speedIndex };
    this.vehicle = withTyre({ ...car.vehicle }, this.tyreSetup);
    this.tyreT = this.env.ambientC;
    this.clearTransient();
    this.spec = car.gearboxSpec ? { ...car.gearboxSpec, ratios: [...car.gearboxSpec.ratios] } : GEARBOXES[car.gearbox];
    Object.assign(this.st, this.fresh(car.gearbox, this.spec.finalDrive, car.speedLimitKmh), { maxSpeedKmh: 0, t0to100S: null });
  }

  /** μ = tyre × surface × tread temperature × user/water-film factor × compound window × aquaplaning (issue #23). */
  private currentGrip(): number {
    const t = this.tyreSetup.type;
    const aq = this.aquaplane ? aquaplaningFactor(t, this.roadKmh, this.tyreSetup.size.widthMm) : 1;
    return tyreGrip(t, this.surfaceKind, this.tyreT) * this.gripFactor * compoundFactor(t, this.env.ambientC, this.surfaceKind) * aq;
  }

  private refreshTyreState() {
    if (!this.st) return;
    this.st.grip = this.currentGrip();
    this.st.tyreRatingKmh = speedRatingKmh(this.tyreSetup.speedIndex);
    this.st.tyreTempC = this.tyreT;
  }

  /** Top-speed governor in km/h; null (or ≤ 0) switches it off ("Aufhebung"). */
  setSpeedLimit(kmh: number | null) {
    this.st.speedLimitKmh = kmh !== null && kmh > 0 ? kmh : null;
    this.resetGovernor();
  }

  /** Vehicle preset: sets mass/aero/wheel, the default gearbox and final drive of that vehicle (issue #25). */
  setVehicle(kind: VehicleKind) {
    const p = VEHICLES[kind];
    this.applyCar({ kind, vehicle: p.params, tyre: p.tyre, gearbox: p.gearboxes[0]!, gearboxSpec: { ...GEARBOXES[p.gearboxes[0]!], finalDrive: p.finalDrive }, speedLimitKmh: this.st.speedLimitKmh });
  }

  /** Final drive ratio ("Achsübersetzung"): shorter = more pull, lower top speed. */
  setFinalDrive(fd: number) {
    this.st.finalDrive = Math.min(6, Math.max(2, fd));
  }

  /** Vehicle back to standstill, first gear, records kept. */
  reset() {
    const keep = { maxSpeedKmh: this.st.maxSpeedKmh, t0to100S: this.st.t0to100S, maxSpeedLimited: this.st.maxSpeedLimited };
    this.clearTransient();
    Object.assign(this.st, this.fresh(this.st.type, this.st.finalDrive, this.st.speedLimitKmh), keep);
    this.positionM = 0;
    this.updateRoad();
  }

  /** Shift timer, pending gear and launch-clutch memory back to rest (review #19). */
  private clearTransient() {
    this.cc.reset();
    this.shiftT = 0;
    this.pendingGear = 0;
    this.holdLaunch = 0;
    this.tc.reset();
    this.tcOut = { pedalCap: 1, torqueCut: 0, pedalFloor: 0 };
    this.resetGovernor();
  }

  private resetGovernor() {
    this.govActive = false;
    this.govI = 0;
    this.govCap = 1;
    this.govHold = null;
    this.st.limiting = false;
  }

  /**
   * Top-speed governor (issue #32): PI controller on the speed margin, output is a pedal cap. Takes over at
   * (limit − 5 km/h). The integrator only runs while the governor actually holds the pedal back; when the driver
   * lifts it is frozen (conditional-integration anti-windup), and its last hold value is remembered across a drop
   * out of the window, so full throttle after a lift picks up the hold point immediately (review PR #34).
   * First entry without a memory is bumpless (cap starts at the current pedal).
   */
  private governor(dt: number, speedKmh: number, pedal: number) {
    const s = this.st;
    const lim = s.speedLimitKmh;
    if (lim === null) {
      this.resetGovernor();
      return;
    }
    const e = lim - speedKmh; // remaining margin, km/h
    if (!this.govActive) {
      if (e > GOV_WINDOW_KMH) {
        this.govCap = 1;
        s.limiting = false;
        return;
      }
      this.govActive = true;
      this.govI = this.govHold ?? pedal - GOV_KP * e;
    } else if (e > GOV_WINDOW_KMH + 1) {
      // out of the window: release, but keep the integrator as hold memory
      this.govActive = false;
      this.govHold = this.govI;
      this.govCap = 1;
      s.limiting = false;
      return;
    }
    const outPrev = GOV_KP * e + this.govI;
    // integrate only while the governor is in control (its output below the driver pedal) or overspeed
    if (outPrev < pedal || e < 0) this.govI += GOV_KI * e * dt;
    this.govI = Math.min(1, Math.max(-0.5, this.govI));
    this.govHold = this.govI;
    this.govCap = Math.min(1, Math.max(0, GOV_KP * e + this.govI));
    s.limiting = this.govCap < pedal - 0.01;
    this.wheelieHold = 0;
  }

  /**
   * Cruise control and speed limiter (issue #30): set/off, resume, ±, limiter. The UI calls these; the controller
   * runs inside inputs() and its pedal is combined with the driver pedal in inputs() and effectivePedal().
   */
  get cruise(): CruiseControl {
    return this.cc;
  }

  /** Steady-state pedal estimate for the cruise control (issue #30): p · (F − m·a) / F with F the drive force. */
  private holdPedal(engine: EngineState, pedal: number, ratio: number): number | null {
    const f = (engine.torqueNm * ratio * this.st.finalDrive * this.spec.efficiency) / this.vehicle.wheelRadiusM;
    if (!(f > 200) || this.st.shifting || pedal < 0.05) return null;
    const share = (f - this.vehicle.massKg * (engine.accelMs2 ?? 0)) / f;
    return Number.isFinite(share) ? Math.min(1, Math.max(0, pedal * share)) : null;
  }

  /** Driver shift request: +1 up, −1 down. Ignored for CVT. */
  shift(dir: 1 | -1) {
    const s = this.st;
    if (s.type === "cvt") return;
    if (s.type === "dsg") s.manualMode = true;
    const target = Math.max(0, Math.min(s.gearCount, (s.shifting ? this.pendingGear : s.gear) + dir));
    // DSG refuses a downshift that would over-rev the engine (ECU protection); the manual gearbox lets you
    // do it – the limits model then reports the over-rev (review #19)
    if (s.type === "dsg" && dir < 0 && target > 0 && this.rpmInGear(target, this.lastSpeedMs) > this.cfg.revLimitRpm * 0.97) return;
    this.beginShift(target);
  }

  /** DSG: back to D (automatic). */
  setAutomatic() {
    if (this.st.type === "dsg") this.st.manualMode = false;
  }

  private beginShift(target: number) {
    const s = this.st;
    if (target === s.gear && !s.shifting) return;
    this.pendingGear = target;
    this.shiftDir = target < s.gear ? -1 : 1;
    this.shiftT = s.type === "sequential" && this.shiftDir < 0 ? SEQ_DOWNSHIFT_S : this.spec.shiftTimeS;
    s.shifting = true;
  }

  /**
   * Hard launch (issue #22): with the pedal beyond half the driver keeps the clutch slipping until the input shaft
   * reaches ≈ 60 % of the launch speed, so a turbo engine is not pulled down into its boost lag [S].
   */
  private launchSyncRpm(pedal: number): number {
    if (pedal < 0.5) return 0;
    return 0.6 * this.launchRpm(pedal);
  }

  /**
   * Launch speed of the automatic clutch: rises with the pedal; full pedal ≈ 45 % of the limiter (test-driver
   * launch, petrol sports cars 3000–4000 rpm so a turbo has boost; the clutch is dosed by traction, so no burnout). Converter automatic: stall speed ≈ lock-up
   * speed + 600 rpm [S] (issue #22, review PR #37).
   */
  private launchRpm(pedal: number): number {
    const idle = this.cfg.idleRpm;
    const lock = this.spec.converterLockRpm;
    return lock ? idle + pedal * Math.max(300, lock + 600 - idle) : idle + 200 + pedal * Math.max(900, 0.45 * this.cfg.revLimitRpm - idle - 200);
  }

  /** Engine rpm the gear `g` would give at the current speed. */
  private rpmInGear(g: number, speedMs: number): number {
    const ratio = this.spec.ratios[g - 1] ?? 1;
    return (speedMs / this.vehicle.wheelRadiusM) * ratio * this.st.finalDrive * RAD_TO_RPM;
  }

  /**
   * Called once per frame BEFORE simulator.step(): updates shift logic, clutch and CVT ratio from the last engine
   * state and returns the coupling for this frame.
   */
  inputs(dt: number, engine: EngineState, driverPedal: number, brake = 0): VehicleCoupling {
    const s = this.st;
    // cruise control / limiter (issue #30): from here on "pedal" is the commanded pedal (shift schedule, CVT target,
    // launch, ASR and the governor all see what the engine is asked for)
    const pedal = this.cc.command(driverPedal);
    const g = this.spec;
    // the gearbox sees the driven wheels; they run ahead of the road speed while spinning (issue #22)
    const vRoad = engine.vehicleSpeedMs ?? 0;
    const v = engine.wheelSpeedMs ?? vRoad;
    this.lastSpeedMs = v;
    // route position from the road speed (#48): the gradient and altitude follow the profile
    if (Number.isFinite(vRoad) && dt > 0 && dt < 1) {
      this.positionM += vRoad * dt;
      this.updateRoad(dt);
    }
    const rpm = engine.rpm;
    const idle = this.cfg.idleRpm;
    const limit = this.cfg.revLimitRpm;

    // --- shift execution
    this.gearDwell = Math.max(0, this.gearDwell - dt);
    this.ccDownT = Math.max(0, this.ccDownT - dt);
    if (s.shifting) {
      this.shiftT -= dt;
      if (this.shiftT <= 0) {
        s.gear = this.pendingGear;
        s.shifting = false;
        // DSG schedule: at least 0.5 s in a gear before the next automatic upshift, so a short rpm flare (wheel slip,
        // clutch handover) does not skip a gear (review PR #37) [S]
        this.gearDwell = 0.5;
      }
    }

    // torque request the engine really gets (governor cap from the last frame): DSG shift points and CVT target
    // follow it, so with the governor holding the speed they settle at low rpm instead of fighting it (issue #32)
    const req = this.govActive ? Math.min(pedal, this.govCap) : pedal;

    // --- DSG automatic shift schedule (Drive mode) [S]: upshift point rises with pedal, downshift keeps torque
    if (s.type === "dsg" && !s.shifting && s.gear > 0) {
      const upRpm = Math.min(limit * 0.97, idle + 900 + Math.pow(req, 0.8) * (limit * 0.97 - idle - 900));
      const downRpm = Math.max(idle * 1.35, upRpm * 0.42);
      if (!s.manualMode) {
        if (this.gearDwell <= 0 && rpm > upRpm && s.gear < s.gearCount && this.rpmInGear(s.gear + 1, v) > idle * 1.25) this.beginShift(s.gear + 1);
        else if (rpm < downRpm && s.gear > 1 && this.rpmInGear(s.gear - 1, v) < limit * 0.9) this.beginShift(s.gear - 1);
        // cruise control (issue #30): speed not holdable at full pedal → one gear down if the engine then runs closer
        // to its power peak (like a kickdown), at most every 3 s so it cannot hunt
        else if (this.cc.state.notHoldable && this.ccDownT <= 0 && s.gear > 1 && rpm < this.summary.peakPowerRpm
          && this.rpmInGear(s.gear - 1, v) < Math.min(limit * 0.9, this.summary.peakPowerRpm * 1.15)) {
          this.beginShift(s.gear - 1);
          this.ccDownT = 3;
        }
      } else if (rpm < idle * 1.1 && s.gear > 1) {
        // M mode still protects against stalling
        this.beginShift(s.gear - 1);
      }
    }

    // --- ratio
    let ratio: number;
    if (s.type === "cvt") {
      // CVT holds a target engine speed set by the pedal (between idle and peak power) [S]
      const nPeak = this.summary.peakPowerRpm;
      // target from the governed pedal, so the CVT does not hold high rpm against the governor (issue #32)
      const target = idle + 300 + Math.pow(req, 1.3) * (nPeak - idle - 300);
      const wheel = (v / this.vehicle.wheelRadiusM) * s.finalDrive * RAD_TO_RPM;
      const [lo, hi] = [g.ratios[1]!, g.ratios[0]!];
      const want = wheel > 1 ? Math.min(hi, Math.max(lo, target / wheel)) : hi;
      // ratio change rate limited (chain/belt) ≈ 1.5 /s
      const maxStep = 1.5 * dt;
      ratio = s.ratio + Math.max(-maxStep, Math.min(maxStep, want - s.ratio));
    } else {
      // DSG with ASR (issue #23): during the shift the on-coming clutch already carries the new gear (inertia phase,
      // the engine is pulled down to the new synchronous speed instead of being dumped onto the wheels at the end)
      const gNow = s.type === "dsg" && s.shifting && this.assistSet.asr && this.pendingGear > 0 ? this.pendingGear : s.gear;
      ratio = gNow > 0 ? g.ratios[gNow - 1]! : 0;
    }
    s.ratio = ratio;

    // --- clutch: automatic launch control and shift interruption
    const inputRpm = s.gear > 0 ? (v / this.vehicle.wheelRadiusM) * ratio * s.finalDrive * RAD_TO_RPM : 0;
    let clutch: number;
    let torqueRatio = 1;
    let launchHoldRpm = 0;
    s.launchArmed = false;
    let tractionLimited = false;
    // Engine not running (ignition off, stalled). Manual and sequential: a gear is engaged and the clutch pedal is
    // released, so the rolling car drags the engine along (friction and pumping work brake the car, like rolling
    // downhill in gear with the ignition off; parked in gear on a slope the engine's compression holds the car).
    // DSG, converter, CVT: without a running engine there is no oil pressure, the
    // clutches open (review #19). A destroyed engine is declutched by the driver.
    const dragged = !engine.running && !engine.destroyed && s.gear > 0 && (s.type === "manual" || s.type === "sequential")
      && !s.shifting && !engine.starterEngaged; // cranking: the driver holds the clutch pedal down
    if (dragged) {
      this.holdLaunch = 0;
      clutch = 1;
    } else if (s.gear === 0 || !engine.running) {
      clutch = 0;
    } else if (s.shifting) {
      // manual: open; DSG: second clutch takes over, slip syncs within the shift; sequential: dog rings
      // disengaged (no torque) while the quickshifter cuts the ignition
      clutch = s.type === "dsg" ? 0.85 : 0;
    } else if (this.assistSet.launchControl && brake > 0.05 && pedal > 0.5 && vRoad < 0.5 && s.type !== "sequential") {
      // launch control (issue #23): at standstill with brake and throttle the clutch stays open and the ECU holds the
      // launch speed (pedal cap below); releasing the brake starts the traction-dosed launch of the next branch [S]
      this.holdLaunch = 0;
      clutch = 0;
      launchHoldRpm = this.launchRpm(pedal);
      s.launchArmed = true;
    } else if (brake > 0.05 && pedal < 0.02 && inputRpm < idle * 1.4) {
      // braking down to a stop: the automatic clutch opens before the engine is dragged below idle.
      // With pedal AND brake (left-foot braking) the clutch stays engaged on purpose: the engine works against
      // the brake and can stall, like a real car (review #20).
      this.holdLaunch = 0;
      clutch = 0;
    } else if (inputRpm < (s.type === "sequential" ? Math.max(idle * 1.05, 0.4 * limit)
      : Math.max(idle * 1.05, g.converterLockRpm ?? 0, this.holdLaunch < 1 ? this.launchSyncRpm(pedal) : 0))) {
      // launch: engage with engine speed above idle (anti-stall), harder with pedal
      let want: number;
      if (s.type === "sequential") {
        // motorcycle (#25): the rider holds the engine near 60 % of the limiter and slips the clutch until the
        // input shaft reaches ≈ 40 % of the limiter (superbike launch technique) [S]
        const launchRpm = idle + pedal * (0.6 * limit - idle);
        want = pedal > 0.02 ? Math.min(1, Math.max(0, (rpm - 0.85 * launchRpm) / Math.max(1, 0.15 * launchRpm))) : 0;
      } else {
        const launchRpm = this.launchRpm(pedal);
        launchHoldRpm = launchRpm;
        // quadratic engagement: the clutch bites gently near idle, so the engine (and the turbo) can rise towards
        // the launch speed before the clutch carries the full torque (issue #22, launch with traction limit)
        // full pedal (hard launch): the clutch only starts to bite from 70 % of the launch speed, so a turbo engine
        // gets onto its boost before it takes load (review PR #37)
        const lo = pedal > 0.9 ? Math.max(idle * 0.9, 0.7 * launchRpm) : idle * 0.9;
        const x = Math.min(1, Math.max(0, (rpm - lo) / Math.max(1, launchRpm - lo)));
        want = pedal > 0.02 ? x * x : 0;
      }
      this.holdLaunch += (want - this.holdLaunch) * Math.min(1, dt * 15);
      clutch = this.holdLaunch * 0.9;
      // torque converter (issue #22): torque ratio ≈ 2.0 at stall falling linearly to 1 at speed ratio 0.85
      // (coupling point), typical passenger-car converter characteristic (Naunheimer et al., Automotive
      // Transmissions, ch. 9 "Hydrodynamic torque converter") [S]
      if (g.converterLockRpm && rpm > 1) torqueRatio = 1 + Math.max(0, 1 - inputRpm / rpm / 0.85);
    } else {
      this.holdLaunch = 1;
      // manual: driver lets the clutch in within ≈ 0.15 s after a shift (review PR #37); sequential: dog engagement,
      // only the slipper clutch smooths it (≈ 30 ms) [S]
      clutch = Math.min(1, s.clutch + dt * (s.type === "manual" ? 7 : s.type === "sequential" ? 30 : 10));
      // closing right after the launch (below ≈ 30 km/h): still dosed by traction (review PR #37), engine held just
      // above the input shaft so it does not flare while the clutch slips
      if (s.type !== "sequential" && clutch < 0.98 && s.gear > 0 && rpm - inputRpm > 150 && (vRoad < 8 || (this.assistSet.asr && (s.type === "dsg" || this.tcCutting)))) launchHoldRpm = Math.max(this.launchRpm(pedal), inputRpm + 500);
    }
    if (launchHoldRpm > 0 && s.type !== "sequential" && s.gear > 0 && this.vehicle.driveLayout) {
      // traction-limited launch (review PR #37): the automatic clutch lets in only the torque the driven tyres can
      // carry at their μ peak (μ·N with load transfer); the driver/ECU then holds the launch speed with the pedal
      // instead of flaring the engine. With a standard tyre and 400+ kW the wheels still spin after the clutch
      // has closed – only the launch itself is dosed.
      const total = ratio * s.finalDrive;
      const n = drivenAxleLoadN(this.vehicle, Math.max(0, engine.accelMs2 ?? 0));
      const capNm = Math.max(250, this.summary.peakTorqueNm * 1.6);
      if (Number.isFinite(n) && total > 0) {
        // with ASR (issue #23) the clutch is dosed just below the peak (× 0.97) and follows the ASR torque cap, so a
        // slipping launch clutch cannot overpower the tyre while the engine torque is being cut
        const asrK = this.assistSet.asr ? (s.grip < 0.9 || vRoad < 1.5 ? 0.97 : 1) * (this.tcOut.torqueCut > 0 || this.tcCutting ? Math.min(1, 0.3 + this.tcOut.pedalCap) : 1) : 1;
        const tcMax = (asrK * s.grip * n * this.vehicle.wheelRadiusM) / (total * g.efficiency * torqueRatio);
        if (tcMax / capNm < clutch) tractionLimited = true;
        clutch = Math.min(clutch, tcMax / capNm);
      }
    }
    if (s.type === "dsg" && s.shifting && this.assistSet.asr && this.vehicle.driveLayout && ratio > 0) {
      // the on-coming clutch is dosed by traction too (issue #23), the engine syncs through the slipping clutch
      const n = drivenAxleLoadN(this.vehicle, Math.max(0, engine.accelMs2 ?? 0));
      const capNm = Math.max(250, this.summary.peakTorqueNm * 1.6);
      if (Number.isFinite(n)) clutch = Math.min(clutch, (0.97 * s.grip * n * this.vehicle.wheelRadiusM) / (ratio * s.finalDrive * g.efficiency) / capNm);
    }
    s.clutch = clutch;
    // launch speed hold: above the launch speed the pedal is taken back (clutch dosed by traction)
    this.launchCap = launchHoldRpm > 0 && rpm > launchHoldRpm ? Math.max(0.2, 1 - (rpm - launchHoldRpm) / 800) : 1;

    // --- wheelie indicator: drive force the engine would deliver vs. the limit (shown ≥ 0.3 s) (#25)
    const fLimit = wheelieLimitN(this.vehicle);
    const fEngine = (Math.max(0, engine.torqueNm) * ratio * s.finalDrive * g.efficiency) / this.vehicle.wheelRadiusM;
    if (Number.isFinite(fLimit) && s.gear > 0 && clutch > 0.3 && fEngine * Math.min(1, clutch / 0.9) > fLimit) this.wheelieHold = 0.3;
    else this.wheelieHold = Math.max(0, this.wheelieHold - dt);
    s.wheelie = this.wheelieHold > 0;

    // --- tyres (issue #22): tread temperature, μ, wheel-spin indicator
    const slipMs = engine.wheelsLocked ? vRoad : Math.max(0, v - vRoad);
    this.roadKmh = vRoad * 3.6;
    const mu = this.currentGrip();
    this.tyreT = stepTyreTemp(this.tyreT, dt, (engine.tyreForceN ?? 0) / Math.max(1, mu * this.vehicle.massKg * 9.81), vRoad, slipMs, this.env.ambientC);
    s.tyreTempC = this.tyreT;
    s.grip = this.currentGrip();
    this.spinHold = engine.wheelSpin ? 0.3 : Math.max(0, this.spinHold - dt);
    s.wheelSpin = this.spinHold > 0;
    s.wheelsLocked = engine.wheelsLocked ?? false;
    s.aquaplaning = this.aquaplane && aquaplaningFactor(this.tyreSetup.type, this.roadKmh, this.tyreSetup.size.widthMm) < 0.9;

    // --- driver assistance (issue #23): ASR/MSR on the driven-wheel slip of the last step, lamps
    const a = this.assistSet;
    const tcr = this.tc.step(dt, engine.wheelSlip ?? 0, vRoad, pedal, this.cfg.fuel === "petrol", a, brake > 0.05, this.lastEffPedal, s.grip);
    this.tcOut = { pedalCap: tcr.pedalCap, torqueCut: tcr.torqueCut, pedalFloor: tcr.pedalFloor };
    this.tcCutting = tcr.cutting;
    this.absHold = a.abs && engine.absActive ? ASSIST_LAMP_HOLD_S : Math.max(0, this.absHold - dt);
    // the ESP lamp also flashes while ASR doses the launch clutch on a slippery road (μ < 0.9)
    this.asrHold = tcr.asrActive || (a.asr && tractionLimited && s.grip < 0.9 && vRoad > 0.5) ? ASSIST_LAMP_HOLD_S : Math.max(0, this.asrHold - dt);
    // the ESP lamp flashes for ASR and MSR interventions (as in the cluster); ABS has its own lamp
    this.espHold = tcr.msrActive || (a.esp && tcr.asrActive) ? ASSIST_LAMP_HOLD_S : Math.max(0, this.espHold - dt);
    s.absActive = this.absHold > 0;
    s.asrActive = this.asrHold > 0;
    s.espActive = this.espHold > 0;
    // shift torque intervention of the DSG with ASR (ignition retard in the inertia phase, ≈ 40 %) [S: Naunheimer et
    // al., Automotive Transmissions, "Schaltablauf Doppelkupplungsgetriebe": engine torque reduction during the shift]
    const cut = Math.max(tcr.torqueCut, s.type === "dsg" && s.shifting && a.asr ? 0.4 : 0);

    // --- measurements
    s.speedKmh = vRoad * 3.6;
    this.governor(dt, s.speedKmh, pedal);
    this.cc.update(dt, {
      speedKmh: s.speedKmh, driverPedal, brake, running: engine.running, gear: s.gear,
      clutchOpen: s.type === "manual" && s.shifting, manual: s.type === "manual", rpm, idleRpm: idle,
      governorKmh: s.speedLimitKmh, holdPedal: this.holdPedal(engine, pedal, ratio),
    });
    if (s.speedKmh > s.maxSpeedKmh) {
      s.maxSpeedKmh = s.speedKmh;
      s.maxSpeedLimited = this.govActive && s.speedLimitKmh !== null && s.speedKmh >= s.speedLimitKmh - 3;
    }
    if (s.speedKmh < 0.5 && pedal > 0.05 && s.t0to100Running === null) s.t0to100Running = 0;
    if (s.t0to100Running !== null) {
      if ((s.speedKmh < 0.5 && pedal < 0.02) || !engine.running) s.t0to100Running = null;
      else {
        s.t0to100Running += dt;
        if (s.speedKmh >= 100) {
          s.t0to100S = s.t0to100Running;
          s.t0to100Running = null;
        }
      }
    }

    return {
      vehicle: this.vehicle,
      totalRatio: ratio * s.finalDrive,
      efficiency: g.efficiency,
      clutch,
      clutchCapacityNm: Math.max(250, this.summary.peakTorqueNm * 1.6),
      brake,
      grip: s.grip,
      ...(torqueRatio > 1 ? { torqueRatio } : {}),
      abs: a.abs,
      gradePct: this.road.gradePct,
      airDensityKgM3: airDensity(altitudeToKpa(this.airAltM), this.env.ambientC),
      ...(cut > 0 ? { torqueCut: cut } : {}),
    };
  }

  /**
   * Pedal actually sent to the engine: a manual shift lifts off (driver lifts, clutch open) so the engine does not
   * flare to the limiter; DSG/CVT pass the pedal through (the ECU blips/cuts torque internally).
   * The top-speed governor (issue #32) caps the pedal; the cap is updated in inputs().
   */
  effectivePedal(driverPedal: number): number {
    const pedal = this.cc.command(driverPedal);
    if (this.st.type === "sequential" && this.st.shifting) {
      // quickshifter: ignition cut on the upshift (rider keeps the throttle open); blipper opens on the downshift
      return this.shiftDir > 0 ? 0 : Math.max(Math.min(pedal, this.govActive ? this.govCap : 1), 0.35);
    }
    if (this.st.type === "manual" && this.st.shifting) return 0;
    // ASR pedal cap and MSR pedal floor (issue #23)
    const p = Math.max(Math.min(pedal, this.launchCap, this.tcOut.pedalCap), this.tcOut.pedalFloor);
    this.lastEffPedal = this.govActive ? Math.min(p, this.govCap) : p;
    return this.lastEffPedal;
  }

  /** Label for the gear indicator: "N", "3", "D4", "M4", "CVT". */
  gearLabel(): string {
    const s = this.st;
    if (s.type === "cvt") return s.gear === 0 ? "N" : "D";
    if (s.gear === 0) return "N";
    if (s.type === "dsg") return `${s.manualMode ? "M" : "D"}${s.gear}`;
    return String(s.gear);
  }
}

/**
 * Theoretical top speed: highest speed where drive force (any gear, rpm ≤ limiter) ≥ road load.
 * Also reports whether the limiter or the road load decides ("zu kurz" vs. "Leistung reicht nicht").
 */
export function theoreticalVmax(
  torqueAt: (rpm: number) => number, limitRpm: number, type: GearboxType, finalDrive: number,
  vehicle: VehicleParams = DEFAULT_VEHICLE, spec: GearboxSpec = GEARBOXES[type],
): { vmaxKmh: number; limitedBy: "limiter" | "power"; gear: number } {
  const g = spec;
  const ratios = type === "cvt" ? Array.from({ length: 40 }, (_, k) => g.ratios[0]! + ((g.ratios[1]! - g.ratios[0]!) * k) / 39) : g.ratios;
  let best = { vmaxKmh: 0, limitedBy: "power" as "limiter" | "power", gear: 1 };
  ratios.forEach((ratio, idx) => {
    const i = ratio * finalDrive;
    for (let v = 1; v < 130; v += 0.25) {
      const rpm = (v / vehicle.wheelRadiusM) * i * RAD_TO_RPM;
      if (rpm > limitRpm) {
        if (v * 3.6 > best.vmaxKmh) best = { vmaxKmh: (v - 0.25) * 3.6, limitedBy: "limiter", gear: idx + 1 };
        break;
      }
      const fDrive = (torqueAt(Math.max(rpm, 800)) * i * g.efficiency) / vehicle.wheelRadiusM;
      const fRes = vehicle.rollingResistance * vehicle.massKg * 9.81 + 0.5 * 1.2 * vehicle.dragCoefficient * vehicle.frontalAreaM2 * v * v;
      if (fDrive < fRes) {
        if (v * 3.6 > best.vmaxKmh) best = { vmaxKmh: v * 3.6, limitedBy: "power", gear: idx + 1 };
        break;
      }
    }
  });
  return best;
}
