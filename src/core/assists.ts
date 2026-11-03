/**
 * Driver assistance systems (issue #23), longitudinal only. Pure TypeScript, no DOM.
 *
 * - ABS: lives in the brake hydraulics of the simulator (simulator.ts stepBrakes, 1 ms steps); the Drivetrain only
 *   switches it via VehicleCoupling.abs.
 * - ASR (Antriebsschlupfregelung / traction control): engine torque intervention on the driven-wheel slip, target
 *   ≈ PEAK_SLIP. Slow path: throttle/injection via a pedal cap (integral controller); fast path for petrol engines:
 *   ignition retard (VehicleCoupling.torqueCut), proportional to the slip excess (Bosch, Kraftfahrtechnisches
 *   Taschenbuch, "Antriebsschlupfregelung ASR": Drosselklappe, Zündwinkel, Bremseingriff) [S].
 * - ESP/ESC: without lateral dynamics it supervises the longitudinal interventions: tight ASR target and the engine
 *   drag torque control MSR (Motorschleppmomentregelung: the ECU opens the throttle a little when engine braking
 *   locks the driven wheels on a slippery road) [S]. "ESP OFF" relaxes the ASR target to 2 × PEAK_SLIP (sport
 *   setting, as in most cars ESP OFF still keeps a reduced traction control) and switches MSR off.
 * The brake intervention of ASR (braking a single spinning wheel) needs per-wheel dynamics and is not modelled.
 */
import { PEAK_SLIP } from "./tyres.ts";

export interface AssistSettings {
  abs: boolean;
  asr: boolean;
  esp: boolean;
  /** Launch control: with brake + full throttle at standstill the engine is held at the launch speed (issue #23). */
  launchControl: boolean;
}

export const DEFAULT_ASSISTS: AssistSettings = { abs: true, asr: true, esp: true, launchControl: false };

/** How long an intervention keeps the lamp blinking after it ended, s (lamps blink for a short while, like OEM clusters). */
export const ASSIST_LAMP_HOLD_S = 0.3;

export interface TractionOutput {
  /** Pedal cap 0 … 1 of the ASR (1 = no intervention). */
  pedalCap: number;
  /** Ignition retard torque share 0 … 0.6 (petrol). */
  torqueCut: number;
  /** MSR pedal floor (engine drag control, ESP), 0 = none. */
  pedalFloor: number;
  asrActive: boolean;
  msrActive: boolean;
  /** Slip above the target this frame (the cap is falling). */
  cutting: boolean;
}

/**
 * ASR + MSR controller, called once per frame with the slip of the driven wheels (EngineState.wheelSlip).
 * Gains [S, tuned]: the cap falls at 6/s per unit relative slip excess (an ASR cuts the torque within ≈ 100 ms) and
 * recovers at 1.5/s; the ignition path removes up to 60 % torque at 0.1 slip above the target.
 */
// ASR gains [S, tuned against the 0–100 runs: on dry asphalt ASR must not cost time, review PR #39]
const ASR_CAP_RATE = 3; // pedal cap fall per s and unit relative slip excess
const ASR_CAP_FLOOR = 0.25;
const ASR_CUT_GAIN = 4;
const ASR_CUT_DEADBAND = 0.03;
/** Slip filter of the throttle path, s: a slip flare shorter than this (clutch closing) does not pull the throttle. */
const ASR_SLIP_TAU = 0.08;
const ASR_PERSIST_S = 0.3;
/** μ above which the road counts as high-friction (dry asphalt) for the ASR target. */
const HIGH_MU = 0.9;
const ASR_TARGET_HIGH_MU = 0.18;
const ASR_RISE_NEAR = 4;
const ASR_RISE = 10;

export class TractionControl {
  private cap = 1;
  private lastSlip = 0;
  /** Time since the last cut, s: the gradual torque release only follows a real intervention. */
  private sinceCut = 9;
  private slipF = 0;
  private overT = 0;

  reset() {
    this.cap = 1;
    this.slipF = 0;
    this.overT = 0;
    this.sinceCut = 9;
    this.lastSlip = 0;
  }

  /**
   * pedalEff: pedal the engine really got in the last frame (after launch, governor and ASR caps). Near the target
   * the cap only lets the torque rise gradually from there (no torque step when e.g. the launch clutch closes).
   */
  step(dt: number, slip: number, speedMs: number, pedal: number, petrol: boolean, s: AssistSettings, braking: boolean, pedalEff = pedal, mu = 0.7): TractionOutput {
    const out: TractionOutput = { pedalCap: 1, torqueCut: 0, pedalFloor: 0, asrActive: false, msrActive: false, cutting: false };
    const sl = Number.isFinite(slip) ? slip : 0;
    const dSlip = (sl - this.lastSlip) / Math.max(1e-3, dt);
    this.sinceCut = Math.min(9, this.sinceCut + dt);
    this.lastSlip = sl;
    this.slipF += (sl - this.slipF) * Math.min(1, dt / ASR_SLIP_TAU);
    if (s.asr && !braking) {
      // slip target depends on the road μ the ECU estimates [S: Bosch KTB "ASR": Sollschlupf μ-abhängig]: on high-μ
      // asphalt a short flare beyond the peak costs hardly any force (curve ≈ 0.95 μ at 0.2) and carries the
      // stored engine energy onto the road, so ASR tolerates up to ≈ 0.18 there; on low μ it holds the peak
      const highMu = mu >= HIGH_MU;
      const target = (s.esp ? 1 : 2) * (highMu ? ASR_TARGET_HIGH_MU : PEAK_SLIP);
      const e = this.slipF - target;
      const eNow = sl - target;
      // throttle path only for slip that persists (≥ ASR_PERSIST_S) or is severe: the short flare of a closing
      // clutch carries the stored engine energy onto the road and is over before the engine could follow
      this.overT = e > 0 ? this.overT + dt : 0;
      const sustained = e > 0 && (!highMu || this.overT >= ASR_PERSIST_S || sl > 0.4);
      out.cutting = sustained;
      if (sustained) {
        // start the cut from where the pedal really is, so a half-pressed pedal is not "cut" from 1
        // (a manual shift lifts the pedal to 0 for a moment: then start from the driver's pedal)
        if (this.cap >= 0.999) this.cap = Math.max(0.05, Math.min(1, pedalEff > 0.2 ? pedalEff : pedal));
        this.sinceCut = 0;
        this.cap = Math.max(ASR_CAP_FLOOR, this.cap - dt * ASR_CAP_RATE * (e / target));
        // ignition path: proportional to the excess beyond a small deadband plus a derivative share on fast rising
        // slip [S, tuned] – a short slip flare (clutch closing) is caught without dropping the torque for long
        
      } else if (this.slipF > 0.6 * target && this.sinceCut < 0.5) {
        // close to the peak right after a cut: let the torque rise only gradually
        this.cap = Math.min(1, this.cap + dt * ASR_RISE_NEAR);
      } else {
        this.cap = Math.min(1, this.cap + dt * ASR_RISE);
      }
      // ignition path on the unfiltered slip, beyond a deadband: catches real flares fast, ignores the small ones
      if (petrol && eNow > ASR_CUT_DEADBAND && (!highMu || sustained)) {
        out.torqueCut = Math.min(0.6, ASR_CUT_GAIN * (eNow - ASR_CUT_DEADBAND) + Math.max(0, 0.03 * dSlip));
        out.cutting = true;
      }
      out.pedalCap = this.cap;
      out.asrActive = e > 0.02 || (this.cap < 0.98 && pedal > this.cap + 0.05 && this.sinceCut < 0.5);
    } else this.cap = 1;
    // MSR (ESP): driven wheels dragged into lock by the engine brake (slip < −0.1) while moving and off the brake
    if (s.esp && !braking && speedMs > 2 && sl < -0.1 && pedal < 0.3) {
      out.pedalFloor = Math.min(0.35, ((-sl - 0.1) / 0.2) * 0.35);
      out.msrActive = true;
    }
    return out;
  }
}
