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
}

/**
 * ASR + MSR controller, called once per frame with the slip of the driven wheels (EngineState.wheelSlip).
 * Gains [S, tuned]: the cap falls at 6/s per unit relative slip excess (an ASR cuts the torque within ≈ 100 ms) and
 * recovers at 1.5/s; the ignition path removes up to 60 % torque at 0.1 slip above the target.
 */
export class TractionControl {
  private cap = 1;
  private lastPedal = 0;

  reset() {
    this.cap = 1;
    this.lastPedal = 0;
  }

  step(dt: number, slip: number, speedMs: number, pedal: number, petrol: boolean, s: AssistSettings, braking: boolean): TractionOutput {
    const out: TractionOutput = { pedalCap: 1, torqueCut: 0, pedalFloor: 0, asrActive: false, msrActive: false };
    const sl = Number.isFinite(slip) ? slip : 0;
    if (s.asr && !braking) {
      const target = s.esp ? PEAK_SLIP : 2 * PEAK_SLIP;
      const e = sl - target;
      if (e > 0) {
        // start the cut from where the pedal really is, so a half-pressed pedal is not "cut" from 1
        if (this.cap >= 0.999) this.cap = Math.max(0.05, Math.min(1, this.lastPedal));
        this.cap = Math.max(0.05, this.cap - dt * 6 * (e / target));
        if (petrol) out.torqueCut = Math.min(0.6, (6 * e) / 1);
      } else {
        this.cap = Math.min(1, this.cap + dt * (sl < 0.5 * target ? 3 : 1.5));
      }
      out.pedalCap = this.cap;
      out.asrActive = e > 0.02 || (this.cap < 0.98 && pedal > this.cap + 0.02);
    } else this.cap = 1;
    // MSR (ESP): driven wheels dragged into lock by the engine brake (slip < −0.1) while moving and off the brake
    if (s.esp && !braking && speedMs > 2 && sl < -0.1 && pedal < 0.3) {
      out.pedalFloor = Math.min(0.35, ((-sl - 0.1) / 0.2) * 0.35);
      out.msrActive = true;
    }
    this.lastPedal = Math.min(pedal, out.pedalCap);
    return out;
  }
}
