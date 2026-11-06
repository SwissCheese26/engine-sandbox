/**
 * Cruise control ("Tempomat", GRA) and driver speed limiter (issue #30). Pure TypeScript, no DOM; used by the
 * Drivetrain, which feeds it once per frame and combines its output with the driver pedal.
 *
 * Behaviour modelled on series systems (VW GRA / Bosch "Fahrgeschwindigkeitsregler", Bosch Kraftfahrtechnisches
 * Taschenbuch, ch. "Adaptive Fahrgeschwindigkeitsregelung": the controller acts on the throttle/injection request
 * only, never on the service brake; brake or clutch switch it off; the set speed is kept for "Resume"):
 * - Set from 30 km/h, ±1 km/h per tap, ±10 km/h (to the next multiple of 10) on a long press / Shift.
 * - PI controller on vehicle speed → pedal 0 … 1, conditional-integration anti-windup.
 * - The driver pedal overrides when it is above the controller output (overtaking); the integrator is frozen
 *   meanwhile, so the car returns to the set speed afterwards without a jolt.
 * - Downhill there is only engine braking: the controller output goes to 0, a note shows the overspeed.
 * - Speed limiter: PI pedal cap like the top-speed governor (issue #32); kickdown (pedal ≥ 98 % for > 0.5 s)
 *   overrides it until the speed is back below the limit.
 */

export type CruiseMode = "off" | "active" | "override";

export interface CruiseState {
  /** Cruise control: off (set speed kept for resume), active (holds), override (driver pedal above output). */
  mode: CruiseMode;
  /** Set speed in km/h, kept after switching off (resume memory); null = never set. */
  setKmh: number | null;
  /** Controller pedal output 0 … 1 (for display/tests). */
  output: number;
  /** Full pedal and still > 2 km/h below the set speed for > 1.5 s ("Tempo nicht haltbar"). */
  notHoldable: boolean;
  /** Manual gearbox: engine speed too low or speed not holdable in this gear ("Runterschalten"). */
  downshift: boolean;
  /** Controller at zero pedal and > 3 km/h above the set speed (downhill, engine braking only). */
  overspeed: boolean;
  /** Speed limiter on/off and its limit in km/h. */
  limiterOn: boolean;
  limitKmh: number;
  /** Limiter holds the pedal back. */
  limiting: boolean;
  /** Kickdown has overridden the limiter (until the speed is back below the limit). */
  kickdown: boolean;
}

export interface CruiseInputs {
  speedKmh: number;
  /** Raw driver pedal 0 … 1. */
  driverPedal: number;
  brake: number;
  running: boolean;
  gear: number;
  /** Manual gearbox shift in progress (clutch pressed). */
  clutchOpen: boolean;
  manual: boolean;
  rpm: number;
  idleRpm: number;
  /** Top-speed governor limit (issue #32), the set speed is clamped to it. */
  governorKmh: number | null;
  /**
   * Estimated pedal that would hold the current speed (steady state), null when unknown (coasting). The drivetrain
   * derives it from the drive force and the acceleration: p_hold ≈ p · (F − m·a) / F (torque ≈ ∝ pedal).
   */
  holdPedal?: number | null;
}

/** Lowest set speed and the speed below which an active cruise control switches off (VW GRA: 30 / ≈ 20 km/h) [S]. */
export const CRUISE_MIN_KMH = 30;
export const CRUISE_OFF_BELOW_KMH = 20;
export const CRUISE_MAX_KMH = 250;
/** Limiter presets in km/h (urban, rural, motorway signs), free values via ± steps. */
export const LIMITER_OPTIONS: readonly number[] = [30, 50, 80, 100, 120, 130];
/** Kickdown: pedal ≥ 98 % held for this time overrides the limiter [S: VW Betriebsanleitung "Geschwindigkeitsbegrenzer"]. */
export const KICKDOWN_PEDAL = 0.98;
export const KICKDOWN_S = 0.5;

// Cruise PI gains. Plant at motorway speed: ≈ 4 … 8 km/h/s per unit pedal (Golf class, 5th/6th gear), so
// s² + k·Kp·s + k·Ki = 0 gives ωn ≈ 0.25 /s, ζ ≈ 0.7 – no overshoot worth noting, no hunting with turbo lag.
const CC_KP = 0.07; // pedal per km/h
const CC_KI = 0.012; // pedal per (km/h · s)
const HOLD_GUESS = 0.2;
const NOT_HOLDABLE_KMH = 2;
const NOT_HOLDABLE_S = 1.5;
const OVERSPEED_KMH = 3;
// limiter: same structure as the governor (drivetrain.ts, issue #32), narrower window for low urban limits
const LIM_WINDOW_KMH = 4;
const LIM_KP = 0.12;
const LIM_KI = 0.06;
/** Lead time on the acceleration (s): hard acceleration in a low gear (≈ 15 km/h/s) would overshoot a 4 km/h window. */
const LIM_LEAD_S = 0.8;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export class CruiseControl {
  private st: CruiseState = {
    mode: "off", setKmh: null, output: 0, notHoldable: false, downshift: false, overspeed: false,
    limiterOn: false, limitKmh: 50, limiting: false, kickdown: false,
  };
  private i = 0;
  /** Integrator memory for resume. */
  private iMem: number | null = null;
  private slowT = 0;
  private speed = 0;
  private gov: number | null = null;
  private pedal = 0;
  private hold: number | null = null;
  private pendingEngage = false;
  // limiter
  private limActive = false;
  private limI = 0;
  private limCap = 1;
  private kickT = 0;
  private lastKmh: number | null = null;
  /** Smoothed acceleration, km/h per s. */
  private accKmhS = 0;

  get state(): Readonly<CruiseState> {
    return this.st;
  }

  /** Pedal the engine should get: max(driver, cruise output), then capped by the limiter (unless kickdown). */
  command(driverPedal: number): number {
    let p = driverPedal;
    if (this.st.mode !== "off") p = Math.max(p, this.st.output);
    if (this.st.limiterOn && !this.st.kickdown) p = Math.min(p, this.limCap);
    return p;
  }

  private maxSet(): number {
    return Math.min(CRUISE_MAX_KMH, this.gov ?? CRUISE_MAX_KMH);
  }

  /** C: set to the current speed (≥ 30 km/h). While active (not overtaking) it switches off. Returns success. */
  setOrOff(): boolean {
    if (this.st.mode === "active") {
      this.off();
      return true;
    }
    return this.set();
  }

  /** Set the current speed as set speed and engage (≥ 30 km/h). */
  set(): boolean {
    if (this.speed < CRUISE_MIN_KMH) return false;
    // the integrator starts at the estimated hold pedal (not the accelerating pedal: that would overshoot by
    // ≈ 5 km/h); coasting without an estimate: the remembered hold pedal or a generic part load
    this.engage(clamp(Math.round(this.speed), CRUISE_MIN_KMH, this.maxSet()), this.hold ?? this.iMem ?? HOLD_GUESS);
    return true;
  }

  /** R: resume the last set speed. */
  resume(): boolean {
    if (this.st.setKmh === null || this.speed < CRUISE_MIN_KMH || this.st.mode !== "off") return false;
    // the remembered hold pedal, but never more than the driver holds plus a margin, so it does not lurch
    this.engage(clamp(this.st.setKmh, CRUISE_MIN_KMH, this.maxSet()), this.iMem ?? this.hold ?? HOLD_GUESS);
    return true;
  }

  private engage(kmh: number, i0: number) {
    this.st.setKmh = kmh;
    this.st.mode = "active";
    this.st.limiterOn = false; // one system at a time, like the GRA/limiter switch in the car
    this.resetLimiter();
    this.i = clamp(i0, 0, 1);
    this.slowT = 0;
    this.pendingEngage = true;
  }

  off() {
    if (this.st.mode !== "off") this.iMem = this.i;
    this.st.mode = "off";
    this.st.output = 0;
    this.st.notHoldable = this.st.downshift = this.st.overspeed = false;
    this.slowT = 0;
  }

  /**
   * ± on the active cruise control (set speed) or else the limiter. `big`: to the next multiple of 10 km/h.
   * Returns true when something changed.
   */
  adjust(dir: 1 | -1, big = false): boolean {
    const step = (v: number) => (big ? (dir > 0 ? Math.floor(v / 10 + 1e-9) * 10 + 10 : Math.ceil(v / 10 - 1e-9) * 10 - 10) : v + dir);
    if (this.st.mode !== "off" && this.st.setKmh !== null) {
      this.st.setKmh = clamp(step(this.st.setKmh), CRUISE_MIN_KMH, this.maxSet());
      return true;
    }
    if (this.st.limiterOn) {
      this.setLimit(step(this.st.limitKmh));
      return true;
    }
    return false;
  }

  /** L: limiter on/off. Switching it on ends the cruise control. */
  toggleLimiter(): boolean {
    if (this.st.limiterOn) {
      this.st.limiterOn = false;
      this.resetLimiter();
    } else {
      this.off();
      this.st.limiterOn = true;
      this.resetLimiter();
    }
    return this.st.limiterOn;
  }

  setLimit(kmh: number) {
    this.st.limitKmh = clamp(Math.round(kmh), CRUISE_MIN_KMH, CRUISE_MAX_KMH);
    this.limActive = false;
  }

  /** Everything off (vehicle reset, other car); set speed and limit stay remembered. */
  reset() {
    this.off();
    this.resetLimiter();
  }

  private resetLimiter() {
    this.limActive = false;
    this.limI = 0;
    this.limCap = 1;
    this.kickT = 0;
    this.st.limiting = false;
    this.st.kickdown = false;
  }

  /** Once per frame with the current speed; updates the outputs used by command() in the next frame. */
  update(dt: number, x: CruiseInputs) {
    this.speed = x.speedKmh;
    this.gov = x.governorKmh;
    this.pedal = x.driverPedal;
    this.hold = x.holdPedal ?? null;
    if (this.lastKmh !== null && dt > 0) this.accKmhS += ((x.speedKmh - this.lastKmh) / dt - this.accKmhS) * Math.min(1, dt / 0.2);
    this.lastKmh = x.speedKmh;
    const s = this.st;
    if (s.mode !== "off") this.cruise(dt, x);
    this.limiter(dt, x);
  }

  private cruise(dt: number, x: CruiseInputs) {
    const s = this.st;
    // switch-off conditions: brake, engine off, neutral, too slow
    if (x.brake > 0.05 || !x.running || x.gear === 0 || x.speedKmh < CRUISE_OFF_BELOW_KMH) {
      this.off();
      return;
    }
    if (s.setKmh !== null && this.gov !== null && s.setKmh > this.gov) s.setKmh = this.gov;
    const e = (s.setKmh ?? x.speedKmh) - x.speedKmh;
    if (x.clutchOpen) {
      // manual gearbox, clutch pressed for a shift: the controller pauses (integrator frozen) and picks up again
      // after the shift – a short clutch tap does not switch the system off (VW GRA behaviour) [S]
      s.output = clamp(CC_KP * e + this.i, 0, 1);
      return;
    }
    const u = CC_KP * e + this.i;
    const override = x.driverPedal > clamp(u, 0, 1) + 0.02;
    // conditional integration (anti-windup): frozen while the driver overrides or the output is saturated in the
    // direction the error pushes it
    if (!this.pendingEngage && !override && !(u >= 1 && e > 0) && !(u <= 0 && e < 0)) this.i += CC_KI * e * dt;
    this.pendingEngage = false;
    this.i = clamp(this.i, 0, 1);
    s.output = clamp(CC_KP * e + this.i, 0, 1);
    s.mode = override ? "override" : "active";
    this.slowT = !override && s.output >= 0.999 && e > NOT_HOLDABLE_KMH ? this.slowT + dt : e < 1 ? 0 : this.slowT;
    s.notHoldable = this.slowT > NOT_HOLDABLE_S;
    s.overspeed = !override && s.output <= 0.001 && e < -OVERSPEED_KMH;
    // lugging below ≈ 1.4 × idle (diesel ≈ 1150 rpm, petrol ≈ 1050 rpm) or not holdable: a lower gear helps
    s.downshift = x.manual && x.gear > 1 && !override && (s.notHoldable || (x.rpm < 1.4 * x.idleRpm && s.output > 0.3));
  }

  private limiter(dt: number, x: CruiseInputs) {
    const s = this.st;
    if (!s.limiterOn) return;
    const lim = s.limitKmh;
    // kickdown: pedal through the detent for > 0.5 s overrides until the speed is back below the limit
    this.kickT = x.driverPedal >= KICKDOWN_PEDAL ? this.kickT + dt : 0;
    if (this.kickT > KICKDOWN_S && !s.kickdown) {
      s.kickdown = true;
      this.limActive = false;
    }
    if (s.kickdown) {
      if (x.speedKmh <= lim && x.driverPedal < KICKDOWN_PEDAL) s.kickdown = false;
      else {
        this.limCap = 1;
        s.limiting = false;
        return;
      }
    }
    const e = lim - x.speedKmh;
    // predicted margin: the speed the car will have in LIM_LEAD_S at the current acceleration
    const ep = e - LIM_LEAD_S * Math.max(0, this.accKmhS);
    const pedal = x.driverPedal;
    if (!this.limActive) {
      if (ep > LIM_WINDOW_KMH) {
        this.limCap = 1;
        s.limiting = false;
        return;
      }
      this.limActive = true;
      // bumpless entry; above the limit (limit lowered while driving) start closed
      this.limI = e < 0 ? 0 : clamp(pedal - LIM_KP * ep, 0, 1);
    } else if (ep > LIM_WINDOW_KMH + 1) {
      this.limActive = false;
      this.limCap = 1;
      s.limiting = false;
      return;
    }
    // same PI + conditional integration as the top-speed governor (drivetrain.ts, issue #32)
    const outPrev = LIM_KP * ep + this.limI;
    if (outPrev < pedal || e < 0) this.limI += LIM_KI * ep * dt;
    this.limI = clamp(this.limI, -0.5, 1);
    this.limCap = clamp(LIM_KP * ep + this.limI, 0, 1);
    s.limiting = this.limCap < pedal - 0.01;
  }
}
