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
 * Pure TypeScript, no DOM.
 */
import { wheelieLimitN } from "./vehicle.ts";
import type { EngineConfig, EngineState, EngineSummary, VehicleCoupling, VehicleParams } from "./types.ts";

export type GearboxType = "manual" | "dsg" | "cvt" | "sequential";

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
 * Rolling resistance of motorcycle tyres ≈ 0.015.
 */
export const VEHICLES: Record<VehicleKind, VehiclePreset> = {
  car: { label: "Auto (Kompaktklasse)", hint: "Fahrzeug: 1450 kg, cW 0,30.", params: DEFAULT_VEHICLE, gearboxes: ["manual", "dsg", "cvt"], finalDrive: GEARBOXES.manual.finalDrive },
  superbike: {
    label: "Motorrad (Superbike)", hint: "Superbike: 270 kg mit Fahrer, cW·A 0,30 m², Quickshifter. Wheelie-Grenze ≈ 1,2 g.",
    params: { massKg: 270, dragCoefficient: 0.6, frontalAreaM2: 0.5, rollingResistance: 0.015, wheelRadiusM: 0.31, cgHeightM: 0.6, cgToRearAxleM: 0.7 },
    gearboxes: ["sequential"], finalDrive: 4.51,
  },
  tourer: {
    label: "Motorrad (Tourer)", hint: "Tourer: 350 kg mit Fahrer, cW·A 0,55 m², Quickshifter.",
    params: { massKg: 350, dragCoefficient: 0.65, frontalAreaM2: 0.85, rollingResistance: 0.015, wheelRadiusM: 0.3, cgHeightM: 0.65, cgToRearAxleM: 0.72 },
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
}

/** Governor presets in km/h, null = off. Default 250 km/h (German manufacturers' voluntary agreement) [S]. */
export const SPEED_LIMIT_OPTIONS: readonly (number | null)[] = [null, 180, 210, 250, 270, 300];
export const DEFAULT_SPEED_LIMIT_KMH = 250;
/** Tyre speed rating W (ETRTO / ECE-R 30): 270 km/h. Real tyre model follows in #22. */
export const TYRE_RATING_W_KMH = 270;

// Governor PI gains (issue #32). It takes over from (limit − 5 km/h) and trims the pedal so speed settles at the
// limit without the hard cut of a rev limiter, like an ECU top-speed limiter acting on throttle / injection.
const GOV_WINDOW_KMH = 5;
const GOV_KP = 0.12; // pedal per km/h of remaining margin
const GOV_KI = 0.06; // pedal per (km/h · s)

const RAD_TO_RPM = 30 / Math.PI;

export class Drivetrain {
  private st: DrivetrainState;
  private shiftT = 0;
  private pendingGear = 0;
  private holdLaunch = 0;
  private lastSpeedMs = 0;
  private govActive = false;
  private govI = 0;
  private govCap = 1;
  /** Remembered integrator (hold pedal) for the current limit, null = none yet. */
  private govHold: number | null = null;
  private shiftDir: 1 | -1 = 1;
  private wheelieHold = 0;
  /** Current vehicle preset (issue #25). */
  kind: VehicleKind = "car";

  constructor(
    private cfg: EngineConfig,
    private summary: EngineSummary,
    type: GearboxType = "manual",
    public vehicle: VehicleParams = DEFAULT_VEHICLE,
  ) {
    this.st = this.fresh(type, GEARBOXES[type].finalDrive, DEFAULT_SPEED_LIMIT_KMH);
  }

  private fresh(type: GearboxType, finalDrive: number, speedLimitKmh: number | null): DrivetrainState {
    const g = GEARBOXES[type];
    return {
      type, gear: type === "cvt" ? 1 : 1, gearCount: type === "cvt" ? 1 : g.ratios.length,
      ratio: g.ratios[0]!, finalDrive, manualMode: type === "manual", shifting: false, clutch: 0,
      speedKmh: 0, maxSpeedKmh: 0, t0to100S: null, t0to100Running: null,
      speedLimitKmh, limiting: false, maxSpeedLimited: false, wheelie: false,
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
    Object.assign(this.st, this.fresh(type, GEARBOXES[type].finalDrive, this.st.speedLimitKmh));
  }

  /** Top-speed governor in km/h; null (or ≤ 0) switches it off ("Aufhebung"). */
  setSpeedLimit(kmh: number | null) {
    this.st.speedLimitKmh = kmh !== null && kmh > 0 ? kmh : null;
    this.resetGovernor();
  }

  /** Vehicle preset: sets mass/aero/wheel, the default gearbox and final drive of that vehicle (issue #25). */
  setVehicle(kind: VehicleKind) {
    const p = VEHICLES[kind];
    this.kind = kind;
    this.vehicle = p.params;
    this.clearTransient();
    Object.assign(this.st, this.fresh(p.gearboxes[0]!, p.finalDrive, this.st.speedLimitKmh), { maxSpeedKmh: 0, t0to100S: null });
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
  }

  /** Shift timer, pending gear and launch-clutch memory back to rest (review #19). */
  private clearTransient() {
    this.shiftT = 0;
    this.pendingGear = 0;
    this.holdLaunch = 0;
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
    this.shiftT = s.type === "sequential" && this.shiftDir < 0 ? SEQ_DOWNSHIFT_S : GEARBOXES[s.type].shiftTimeS;
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
  inputs(dt: number, engine: EngineState, pedal: number, brake = 0): VehicleCoupling {
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

    // torque request the engine really gets (governor cap from the last frame): DSG shift points and CVT target
    // follow it, so with the governor holding the speed they settle at low rpm instead of fighting it (issue #32)
    const req = this.govActive ? Math.min(pedal, this.govCap) : pedal;

    // --- DSG automatic shift schedule (Drive mode) [S]: upshift point rises with pedal, downshift keeps torque
    if (s.type === "dsg" && !s.shifting && s.gear > 0) {
      const upRpm = Math.min(limit * 0.97, idle + 900 + Math.pow(req, 0.8) * (limit * 0.97 - idle - 900));
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
      // target from the governed pedal, so the CVT does not hold high rpm against the governor (issue #32)
      const target = idle + 300 + Math.pow(req, 1.3) * (nPeak - idle - 300);
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
      // manual: open; DSG: second clutch takes over, slip syncs within the shift; sequential: dog rings
      // disengaged (no torque) while the quickshifter cuts the ignition
      clutch = s.type === "dsg" ? 0.85 : 0;
    } else if (brake > 0.05 && pedal < 0.02 && inputRpm < idle * 1.4) {
      // braking down to a stop: the automatic clutch opens before the engine is dragged below idle.
      // With pedal AND brake (left-foot braking) the clutch stays engaged on purpose: the engine works against
      // the brake and can stall, like a real car (review #20).
      this.holdLaunch = 0;
      clutch = 0;
    } else if (inputRpm < (s.type === "sequential" ? Math.max(idle * 1.05, 0.4 * limit) : idle * 1.05)) {
      // launch: engage with engine speed above idle (anti-stall), harder with pedal
      let want: number;
      if (s.type === "sequential") {
        // motorcycle (#25): the rider holds the engine near 60 % of the limiter and slips the clutch until the
        // input shaft reaches ≈ 40 % of the limiter (superbike launch technique) [S]
        const launchRpm = idle + pedal * (0.6 * limit - idle);
        want = pedal > 0.02 ? Math.min(1, Math.max(0, (rpm - 0.85 * launchRpm) / Math.max(1, 0.15 * launchRpm))) : 0;
      } else {
        const launchRpm = idle + 200 + pedal * 900;
        want = pedal > 0.02 ? Math.min(1, Math.max(0, (rpm - idle * 0.9) / Math.max(1, launchRpm - idle * 0.9))) : 0;
      }
      this.holdLaunch += (want - this.holdLaunch) * Math.min(1, dt * 8);
      clutch = this.holdLaunch * 0.9;
    } else {
      this.holdLaunch = 1;
      // sequential: dog engagement after the shift, only the slipper clutch smooths it (≈ 30 ms) [S]
      clutch = Math.min(1, s.clutch + dt * (s.type === "manual" ? 4 : s.type === "sequential" ? 30 : 10));
    }
    s.clutch = clutch;

    // --- wheelie indicator: drive force the engine would deliver vs. the limit (shown ≥ 0.3 s) (#25)
    const fLimit = wheelieLimitN(this.vehicle);
    const fEngine = (Math.max(0, engine.torqueNm) * ratio * s.finalDrive * g.efficiency) / this.vehicle.wheelRadiusM;
    if (Number.isFinite(fLimit) && s.gear > 0 && clutch > 0.3 && fEngine * Math.min(1, clutch / 0.9) > fLimit) this.wheelieHold = 0.3;
    else this.wheelieHold = Math.max(0, this.wheelieHold - dt);
    s.wheelie = this.wheelieHold > 0;

    // --- measurements
    s.speedKmh = v * 3.6;
    this.governor(dt, s.speedKmh, pedal);
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
    };
  }

  /**
   * Pedal actually sent to the engine: a manual shift lifts off (driver lifts, clutch open) so the engine does not
   * flare to the limiter; DSG/CVT pass the pedal through (the ECU blips/cuts torque internally).
   * The top-speed governor (issue #32) caps the pedal; the cap is updated in inputs().
   */
  effectivePedal(pedal: number): number {
    if (this.st.type === "sequential" && this.st.shifting) {
      // quickshifter: ignition cut on the upshift (rider keeps the throttle open); blipper opens on the downshift
      return this.shiftDir > 0 ? 0 : Math.max(Math.min(pedal, this.govActive ? this.govCap : 1), 0.35);
    }
    if (this.st.type === "manual" && this.st.shifting) return 0;
    return this.govActive ? Math.min(pedal, this.govCap) : pedal;
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
