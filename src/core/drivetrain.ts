/**
 * Base drivetrain (issue #14): gearbox + clutch control on top of EngineSimulator's dynoMode "vehicle".
 * Fixed base vehicle (compact car), three gearbox types:
 *  - "manual": 6 gears, the driver shifts (up/down). Automatic clutch for launch and shifts (≈ 0.35 s interruption).
 *  - "dsg":    7-speed dual clutch. Drive mode shifts by itself; tapping up/down switches to manual mode (M).
 *              Shifts take ≈ 0.1 s without tractive interruption.
 *  - "cvt":    continuously variable ratio, holds an engine speed chosen by the pedal. No shifting.
 * Pure TypeScript, no DOM.
 */
import type { EngineConfig, EngineState, EngineSummary, VehicleCoupling, VehicleParams } from "./types.ts";

export type GearboxType = "manual" | "dsg" | "cvt";

export const DEFAULT_VEHICLE: VehicleParams = {
  massKg: 1450, // compact car incl. driver [S]
  dragCoefficient: 0.3,
  frontalAreaM2: 2.2,
  rollingResistance: 0.012,
  wheelRadiusM: 0.316, // 225/45 R17 dynamic radius
};

interface GearboxSpec {
  ratios: number[];
  finalDrive: number;
  efficiency: number;
  shiftTimeS: number;
}

/** Typical ratios [S]: VW MQ350 6-speed manual, DQ381 7-speed DSG, generic chain CVT. */
export const GEARBOXES: Record<GearboxType, GearboxSpec> = {
  manual: { ratios: [3.77, 2.09, 1.47, 1.1, 0.87, 0.71], finalDrive: 3.45, efficiency: 0.93, shiftTimeS: 0.35 },
  dsg: { ratios: [3.56, 2.53, 1.59, 1.02, 0.79, 0.66, 0.55], finalDrive: 3.9, efficiency: 0.92, shiftTimeS: 0.1 },
  cvt: { ratios: [2.63, 0.38], finalDrive: 4.1, efficiency: 0.87, shiftTimeS: 0 },
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
}

const RAD_TO_RPM = 30 / Math.PI;

export class Drivetrain {
  private st: DrivetrainState;
  private shiftT = 0;
  private pendingGear = 0;
  private holdLaunch = 0;
  private lastSpeedMs = 0;

  constructor(
    private cfg: EngineConfig,
    private summary: EngineSummary,
    type: GearboxType = "manual",
    public vehicle: VehicleParams = DEFAULT_VEHICLE,
  ) {
    this.st = this.fresh(type, GEARBOXES[type].finalDrive);
  }

  private fresh(type: GearboxType, finalDrive: number): DrivetrainState {
    const g = GEARBOXES[type];
    return {
      type, gear: type === "cvt" ? 1 : 1, gearCount: type === "cvt" ? 1 : g.ratios.length,
      ratio: g.ratios[0]!, finalDrive, manualMode: type === "manual", shifting: false, clutch: 0,
      speedKmh: 0, maxSpeedKmh: 0, t0to100S: null, t0to100Running: null,
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
    Object.assign(this.st, this.fresh(type, GEARBOXES[type].finalDrive));
  }

  /** Final drive ratio ("Achsübersetzung"): shorter = more pull, lower top speed. */
  setFinalDrive(fd: number) {
    this.st.finalDrive = Math.min(6, Math.max(2, fd));
  }

  /** Vehicle back to standstill, first gear, records kept. */
  reset() {
    const keep = { maxSpeedKmh: this.st.maxSpeedKmh, t0to100S: this.st.t0to100S };
    this.clearTransient();
    Object.assign(this.st, this.fresh(this.st.type, this.st.finalDrive), keep);
  }

  /** Shift timer, pending gear and launch-clutch memory back to rest (review #19). */
  private clearTransient() {
    this.shiftT = 0;
    this.pendingGear = 0;
    this.holdLaunch = 0;
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
    this.shiftT = GEARBOXES[s.type].shiftTimeS;
    s.shifting = true;
  }

  /** Engine rpm the gear `g` would give at the current speed. */
  private rpmInGear(g: number, speedMs: number): number {
    const ratio = GEARBOXES[this.st.type].ratios[g - 1] ?? 1;
    return (speedMs / this.vehicle.wheelRadiusM) * ratio * this.st.finalDrive * RAD_TO_RPM;
  }

  /**
   * Called once per frame BEFORE simulator.step(): updates shift logic, clutch and CVT ratio from the last engine
   * state and returns the coupling for this frame.
   */
  inputs(dt: number, engine: EngineState, pedal: number): VehicleCoupling {
    const s = this.st;
    const g = GEARBOXES[s.type];
    const v = engine.vehicleSpeedMs ?? 0;
    this.lastSpeedMs = v;
    const rpm = engine.rpm;
    const idle = this.cfg.idleRpm;
    const limit = this.cfg.revLimitRpm;

    // --- shift execution
    if (s.shifting) {
      this.shiftT -= dt;
      if (this.shiftT <= 0) {
        s.gear = this.pendingGear;
        s.shifting = false;
      }
    }

    // --- DSG automatic shift schedule (Drive mode) [S]: upshift point rises with pedal, downshift keeps torque
    if (s.type === "dsg" && !s.shifting && s.gear > 0) {
      const upRpm = Math.min(limit * 0.97, idle + 900 + Math.pow(pedal, 0.8) * (limit * 0.97 - idle - 900));
      const downRpm = Math.max(idle * 1.35, upRpm * 0.42);
      if (!s.manualMode) {
        if (rpm > upRpm && s.gear < s.gearCount && this.rpmInGear(s.gear + 1, v) > idle * 1.25) this.beginShift(s.gear + 1);
        else if (rpm < downRpm && s.gear > 1 && this.rpmInGear(s.gear - 1, v) < limit * 0.9) this.beginShift(s.gear - 1);
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
      const target = idle + 300 + Math.pow(pedal, 1.3) * (nPeak - idle - 300);
      const wheel = (v / this.vehicle.wheelRadiusM) * s.finalDrive * RAD_TO_RPM;
      const [lo, hi] = [g.ratios[1]!, g.ratios[0]!];
      const want = wheel > 1 ? Math.min(hi, Math.max(lo, target / wheel)) : hi;
      // ratio change rate limited (chain/belt) ≈ 1.5 /s
      const maxStep = 1.5 * dt;
      ratio = s.ratio + Math.max(-maxStep, Math.min(maxStep, want - s.ratio));
    } else {
      ratio = s.gear > 0 ? g.ratios[s.gear - 1]! : 0;
    }
    s.ratio = ratio;

    // --- clutch: automatic launch control and shift interruption
    const inputRpm = s.gear > 0 ? (v / this.vehicle.wheelRadiusM) * ratio * s.finalDrive * RAD_TO_RPM : 0;
    let clutch: number;
    // Engine not running (ignition off, stalled): the automatic clutch opens, so there is no engine braking
    // and the engine is not dragged along (simplification of an automated clutch, review #19).
    if (s.gear === 0 || !engine.running) {
      clutch = 0;
    } else if (s.shifting) {
      // manual: open; DSG: second clutch takes over, slip syncs within the shift
      clutch = s.type === "dsg" ? 0.85 : 0;
    } else if (inputRpm < idle * 1.05) {
      // launch: engage with engine speed above idle (anti-stall), harder with pedal
      const launchRpm = idle + 200 + pedal * 900;
      const want = pedal > 0.02 ? Math.min(1, Math.max(0, (rpm - idle * 0.9) / Math.max(1, launchRpm - idle * 0.9))) : 0;
      this.holdLaunch += (want - this.holdLaunch) * Math.min(1, dt * 8);
      clutch = this.holdLaunch * 0.9;
    } else {
      this.holdLaunch = 1;
      clutch = Math.min(1, s.clutch + dt * (s.type === "manual" ? 4 : 10));
    }
    s.clutch = clutch;

    // --- measurements
    s.speedKmh = v * 3.6;
    if (s.speedKmh > s.maxSpeedKmh) s.maxSpeedKmh = s.speedKmh;
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
    };
  }

  /**
   * Pedal actually sent to the engine: a manual shift lifts off (driver lifts, clutch open) so the engine does not
   * flare to the limiter; DSG/CVT pass the pedal through (the ECU blips/cuts torque internally).
   */
  effectivePedal(pedal: number): number {
    return this.st.type === "manual" && this.st.shifting ? 0 : pedal;
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
  vehicle: VehicleParams = DEFAULT_VEHICLE,
): { vmaxKmh: number; limitedBy: "limiter" | "power"; gear: number } {
  const g = GEARBOXES[type];
  const ratios = type === "cvt" ? Array.from({ length: 40 }, (_, k) => g.ratios[0]! + ((g.ratios[1]! - g.ratios[0]!) * k) / 39) : g.ratios;
  let best = { vmaxKmh: 0, limitedBy: "power" as "limiter" | "power", gear: 1 };
  ratios.forEach((ratio, idx) => {
    const i = ratio * finalDrive;
    for (let v = 1; v < 120; v += 0.25) {
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
