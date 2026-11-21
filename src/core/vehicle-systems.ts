/**
 * Vehicle subsystems around the engine (issue #83): compressed-air brake and retarder of trucks and buses
 * (docs/research/commercial.md §5, §6), AdBlue of SCR diesels (§7) and the battery / alternator (§8). Each is a small
 * model of its own; VehicleSystems steps them once per frame from the last engine state and tells the app how they act
 * on the vehicle (extra brake share, pedal cap). Pure, no DOM.
 */
import { isCommercialKind, type VehicleKind } from "./drivetrain.ts";

const G = 9.81;
const P_ATM_BAR = 1.013;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ── compressed-air brake (commercial.md §5) ──────────────────────────────────────────────────────────────────────

/** Reservoir volume, all circuits lumped, l [S]. */
export const AIR_RESERVOIR_L = 80;
/** Compressor swept volume per revolution, l, driven at engine speed, and its volumetric efficiency [S]. */
export const AIR_COMPRESSOR_L = 0.36;
export const AIR_COMPRESSOR_EFF = 0.65;
/** Governor (unloader): compressor idles above the cut-out pressure, delivers again below the cut-in pressure, bar [S]. */
export const AIR_CUT_OUT_BAR = 10;
export const AIR_CUT_IN_BAR = 8.5;
/** Brake cylinder pressure of a full application, bar, and the volume of all brake cylinders, l [S]. */
export const AIR_FULL_BRAKE_BAR = 6.5;
export const AIR_CHAMBERS_L = 6;
/** Low-pressure warning (red lamp), bar (UN ECE R13 asks for a warning device, commercial.md §5) [B13, S]. */
export const AIR_WARN_BAR = 5.5;
/** Spring brakes start to apply below this pressure and act fully at AIR_SPRING_FULL_BAR, bar [S]. */
export const AIR_SPRING_BAR = 4.5;
export const AIR_SPRING_FULL_BAR = 1;
/** Deceleration of the fully applied spring brakes, g: the R13 parking requirement of 18 % gradient [B13]. */
export const AIR_SPRING_G = 0.18;

export class AirBrake {
  private p = AIR_CUT_OUT_BAR;
  private chamber = 0;
  private loading = true;

  /** Reservoir pressure, bar (gauge). */
  get pressureBar(): number {
    return this.p;
  }

  /** The compressor delivers (governor below cut-out). */
  get compressing(): boolean {
    return this.loading;
  }

  get warning(): boolean {
    return this.p < AIR_WARN_BAR;
  }

  /** Share 0 … 1 of the spring-brake force that acts (0 above AIR_SPRING_BAR). */
  get springShare(): number {
    return clamp((AIR_SPRING_BAR - this.p) / (AIR_SPRING_BAR - AIR_SPRING_FULL_BAR), 0, 1);
  }

  /** Share 0 … 1 of the demanded service-brake pressure the reservoir can still deliver. */
  get serviceShare(): number {
    return clamp(this.p / AIR_FULL_BRAKE_BAR, 0, 1);
  }

  reset(bar = AIR_CUT_OUT_BAR) {
    this.p = clamp(Number.isFinite(bar) ? bar : AIR_CUT_OUT_BAR, 0, AIR_CUT_OUT_BAR);
    this.chamber = 0;
    this.loading = this.p < AIR_CUT_OUT_BAR;
  }

  /**
   * One step. Compressor: free air Q = V_h·n·η_L, isothermal into the reservoir: dp/dt = p_atm·Q / V (§5).
   * Braking: raising the cylinder pressure by Δp_c draws Δp = V_cyl·Δp_c / V from the reservoir; releasing vents.
   */
  step(dt: number, engineRpm: number, running: boolean, brake: number) {
    if (!(dt > 0)) return;
    if (this.p >= AIR_CUT_OUT_BAR) this.loading = false;
    else if (this.p <= AIR_CUT_IN_BAR) this.loading = true;
    if (running && this.loading) {
      const qLs = AIR_COMPRESSOR_L * (Math.max(0, engineRpm) / 60) * AIR_COMPRESSOR_EFF;
      this.p = Math.min(AIR_CUT_OUT_BAR, this.p + (P_ATM_BAR * qLs * dt) / AIR_RESERVOIR_L);
    }
    const want = clamp(Number.isFinite(brake) ? brake : 0, 0, 1) * Math.min(AIR_FULL_BRAKE_BAR, this.p);
    if (want > this.chamber) this.p = Math.max(0, this.p - (AIR_CHAMBERS_L * (want - this.chamber)) / AIR_RESERVOIR_L);
    this.chamber = want;
  }
}

// ── retarder (commercial.md §6) ──────────────────────────────────────────────────────────────────────────────────

export const RETARDER_STAGES = 5;
/** Highest braking torque at the propeller shaft, Nm, power limit, kW, and the shaft speed of full torque, rpm [S]. */
export const RETARDER_MAX_NM = 3500;
export const RETARDER_MAX_KW = 600;
export const RETARDER_FULL_RPM = 1000;

/**
 * Braking torque of a hydrodynamic secondary retarder at the propeller shaft, Nm: Föttinger law T ∝ ω² (§6, [B14]),
 * capped by the stage share of the highest torque and by the power limit.
 */
export function retarderTorqueNm(stage: number, shaftRpm: number): number {
  const st = clamp(Math.round(Number.isFinite(stage) ? stage : 0), 0, RETARDER_STAGES);
  const n = Math.abs(Number.isFinite(shaftRpm) ? shaftRpm : 0);
  if (st === 0 || n < 1) return 0;
  const fluid = RETARDER_MAX_NM * (n / RETARDER_FULL_RPM) ** 2;
  const power = (RETARDER_MAX_KW * 1000) / ((n * Math.PI) / 30);
  return Math.min(fluid, power, (RETARDER_MAX_NM * st) / RETARDER_STAGES);
}

/** Force of the retarder at the road, N: F = T·i_axle·η / r_dyn (§6). Shaft speed from the road speed. */
export function retarderForceN(stage: number, speedMs: number, finalDrive: number, wheelRadiusM: number, efficiency = 0.97): number {
  if (!(wheelRadiusM > 0) || !(finalDrive > 0) || !(Math.abs(speedMs) > 0)) return 0;
  const shaftRpm = ((Math.abs(speedMs) / wheelRadiusM) * finalDrive * 30) / Math.PI;
  return (retarderTorqueNm(stage, shaftRpm) * finalDrive * efficiency) / wheelRadiusM;
}

// ── AdBlue (commercial.md §7) ────────────────────────────────────────────────────────────────────────────────────

/** AdBlue demand as a share of the diesel volume (≈ 3–6 %) [B15]. */
export const ADBLUE_SHARE = 0.05;
/** Dosing starts above this exhaust temperature, °C (SCR light-off) [B15]. */
export const ADBLUE_DOSE_MIN_EGT_C = 200;
export const ADBLUE_TANK_L: Record<VehicleKind, number> = { car: 15, superbike: 0, tourer: 0, truck: 75, bus: 40 };
export const ADBLUE_RESERVE_SHARE = 0.1;
/** Pedal cap when empty: ≈ the 25 % torque reduction of the EU low-level inducement (VO (EU) 582/2011) [B16, S]. */
export const ADBLUE_LIMP_PEDAL = 0.75;

export class AdBlueTank {
  private cap = ADBLUE_TANK_L.car;
  private level = ADBLUE_TANK_L.car;

  get capacityL(): number {
    return this.cap;
  }
  get levelL(): number {
    return this.level;
  }
  get fraction(): number {
    return this.cap > 0 ? this.level / this.cap : 0;
  }
  get reserve(): boolean {
    return this.fraction <= ADBLUE_RESERVE_SHARE;
  }
  get empty(): boolean {
    return this.level <= 0;
  }

  setCapacity(l: number, levelL = l) {
    this.cap = Math.max(1, Number.isFinite(l) ? l : ADBLUE_TANK_L.car);
    this.level = clamp(Number.isFinite(levelL) ? levelL : this.cap, 0, this.cap);
  }

  refill() {
    this.level = this.cap;
  }

  /** Drains ADBLUE_SHARE of the diesel flow once the exhaust is hot enough for the SCR catalyst. */
  step(dt: number, fuelFlowLh: number, egtC: number) {
    if (!(dt > 0) || !(fuelFlowLh > 0) || !(egtC >= ADBLUE_DOSE_MIN_EGT_C)) return;
    this.level = Math.max(0, this.level - (fuelFlowLh * ADBLUE_SHARE * dt) / 3600);
  }
}

// ── battery and alternator (commercial.md §8) ───────────────────────────────────────────────────────────────────

/** Rest voltage of a charged 12 V lead-acid battery, cranking voltage and the regulator voltage, V [B17]. */
export const BATTERY_REST_V = 12.6;
export const BATTERY_CRANK_V = 10.5;
export const ALTERNATOR_V = 14.2;
/** Alternator: pulley ratio and the alternator speed from which it delivers current [B17, S]. */
export const ALTERNATOR_RATIO = 3;
export const ALTERNATOR_CUT_IN_RPM = 1500;

/** System voltage factor: 24 V on trucks and buses (two batteries in series), else 12 V. */
export function systemFactor(kind: VehicleKind): 1 | 2 {
  return isCommercialKind(kind) ? 2 : 1;
}

/** Voltage the board net settles to (before the display lag). */
export function batteryTargetV(x: { running: boolean; starter: boolean; rpm: number; ignition: boolean }, factor: 1 | 2 = 1): number {
  let v = BATTERY_REST_V;
  if (x.running && x.rpm * ALTERNATOR_RATIO >= ALTERNATOR_CUT_IN_RPM) v = ALTERNATOR_V;
  else if (x.starter && x.ignition && !x.running) v = BATTERY_CRANK_V;
  return v * factor;
}

// ── all together ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface SystemsInput {
  ignition: boolean;
  running: boolean;
  starter: boolean;
  rpm: number;
  fuelFlowLh: number;
  egtC: number;
  /** The engine has SCR (EngineConfig.exhaust.scr, diesel only). */
  scr: boolean;
  /** A vehicle is on the chassis dyno (else the engine dyno: only the battery). */
  vehicle: boolean;
  kind: VehicleKind;
  /** Driver's service brake 0 … 1. */
  brake: number;
  speedMs: number;
  massKg: number;
  finalDrive: number;
  wheelRadiusM: number;
}

export interface SystemsOutput {
  /** Service brake 0 … 1 for the drivetrain: the driver's brake limited by the air pressure, plus the spring brakes. */
  brake: number;
  /** Retarder deceleration, g (added to the coupling's brake by the app). */
  retarderG: number;
  /** Cap on the accelerator pedal (AdBlue empty → limp mode). */
  pedalCap: number;
}

export class VehicleSystems {
  readonly air = new AirBrake();
  readonly adblue = new AdBlueTank();
  private stage = 0;
  private volts = BATTERY_REST_V;
  private kindNow: VehicleKind = "car";
  private retF = 0;

  /** Retarder stage 0 … RETARDER_STAGES (trucks and buses). */
  get retarderStage(): number {
    return this.stage;
  }
  setRetarderStage(n: number) {
    this.stage = clamp(Math.round(Number.isFinite(n) ? n : 0), 0, RETARDER_STAGES);
  }
  /** Retarder braking force of the last step, N. */
  get retarderForceN(): number {
    return this.retF;
  }
  /** Board-net voltage, V. */
  get batteryV(): number {
    return this.volts;
  }
  get kind(): VehicleKind {
    return this.kindNow;
  }
  /** The vehicle has compressed-air brakes and a retarder. */
  get commercial(): boolean {
    return isCommercialKind(this.kindNow);
  }

  /** New vehicle: full reservoir, retarder off, AdBlue tank of the vehicle kind, full. */
  setKind(kind: VehicleKind) {
    this.kindNow = kind;
    this.air.reset();
    this.stage = 0;
    this.adblue.setCapacity(ADBLUE_TANK_L[kind] || ADBLUE_TANK_L.car);
  }

  step(dt: number, x: SystemsInput): SystemsOutput {
    if (x.kind !== this.kindNow) this.setKind(x.kind);
    const f = systemFactor(x.vehicle ? x.kind : "car");
    const target = batteryTargetV({ running: x.running, starter: x.starter, rpm: x.rpm, ignition: x.ignition }, f);
    // display lag of the voltmeter / board net, τ ≈ 0.3 s [S]
    this.volts += (target - this.volts) * (dt > 0 ? 1 - Math.exp(-dt / 0.3) : 0);
    const brake = clamp(Number.isFinite(x.brake) ? x.brake : 0, 0, 1);
    const out: SystemsOutput = { brake, retarderG: 0, pedalCap: 1 };
    this.retF = 0;
    if (!x.vehicle) return out;
    if (x.scr) {
      this.adblue.step(dt, x.running ? x.fuelFlowLh : 0, x.egtC);
      if (this.adblue.empty) out.pedalCap = ADBLUE_LIMP_PEDAL;
    }
    if (!this.commercial) return out;
    this.air.step(dt, x.rpm, x.running, brake);
    out.brake = Math.max(brake * this.air.serviceShare, this.air.springShare * AIR_SPRING_G);
    if (x.ignition && x.massKg > 0) {
      this.retF = retarderForceN(this.stage, x.speedMs, x.finalDrive, x.wheelRadiusM);
      out.retarderG = this.retF / (x.massKg * G);
    }
    return out;
  }
}
