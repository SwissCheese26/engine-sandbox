/**
 * Electric drive simulator (issue #108). Same interface as EngineSimulator (`step(dt, SimInputs): EngineState`), so
 * the app, the drivetrain and the views run it in place of a combustion engine. No DOM. docs/research/electric.md.
 *
 * - Motors (electric-motor.ts) on the front and/or rear axle, each with its own single-speed reduction. They are
 *   rigidly coupled to the wheels (no clutch, no gears, no idle, no starter): for the shared longitudinal model
 *   (simulator.ts stepVehicle: tyres, brakes, ABS, gradient, aero) all motors are reflected to one reference shaft
 *   (the first rear motor's ratio): T_ref = Σ T_i·i_i / i_ref, J_ref = Σ J_i·(i_i / i_ref)² (electric.md §4.1).
 * - Battery (battery.ts): every 1 ms the DC power Σ P_el,i + P_aux is drawn, voltage sags with I·R, SoC and
 *   temperature follow. The present battery limits cap the motor torque (power), the voltage sets the base speed.
 * - Traction control (electric.md §4.3): with ASR on, the torque of each axle is limited feed-forward to 0.97·μ·N of
 *   that axle (load transfer m·a·h/l); torque the front axle cannot use goes to the rear and vice versa – what the
 *   motor controller of a twin/tri-motor car does within milliseconds.
 * - Regeneration (electric.md §4.2): lift-off regen ("one pedal", liftOffRegenG) and blended braking: the brake pedal
 *   is served by the motors first (up to their torque, the battery's charge power and ≈ 0.3 g), the friction brake
 *   takes the rest. No regen while ABS regulates, fading out below 7 km/h.
 */
import { batteryLimits, nominalV, packEnergyKwh, packOcv, stepBattery, type BatteryState } from "./battery.ts";
import { baseRpm, electricPowerKw, motorDerate, motorLossKw, motorMaxTorque, rotorInertia, stepMotorTemp, MOTOR_DERATE_C } from "./electric-motor.ts";
import { BRAKE_MAX_G, createVehicleBody, slipRatio, stepVehicle, type VehicleBody } from "./simulator.ts";
import { frontAxleShare } from "./vehicle.ts";
import type { EngineState, EvConfig, EvDriveMode, EvLimit, EvMotorConfig, SimInputs, VehicleCoupling, Warning } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const fin = (x: number, fb: number) => (Number.isFinite(x) ? x : fb);
const G = 9.81;
const RAD_PER_RPM = Math.PI / 30;
const H = 0.001;
const MAX_DT = 0.25;
/** Pedal travel that is regen (lift-off) below and drive above, like the "one pedal" maps of Tesla / VW B mode [electric.md §4.2]. */
const PEDAL_ZERO = 0.1;
/** Regen fades out between these speeds (no regen at standstill; the friction brake holds), m/s. */
const REGEN_FADE_LO = 0.8;
const REGEN_FADE_HI = 2;
/** Blended braking: share of the deceleration the motors take before the friction brake joins, g [electric.md §4.2]. */
const BLEND_MAX_G = 0.3;
/** Traction-control margin below μ·N [electric.md §4.3]. */
const TC_MARGIN = 0.97;
/** Battery state of charge after a reset (daily charging limit 90 %). */
export const START_SOC = 0.9;

/**
 * Drive modes: share of the torque and battery power the controller allows, and the pedal progression
 * (torque request = pedal^exp). Chill ≈ Tesla "Chill" (gentle, about half the power), Sport ≈ "Standard/Sport",
 * Plaid = everything [electric.md §4.4].
 */
export const DRIVE_MODES: Record<EvDriveMode, { label: string; torqueShare: number; powerShare: number; pedalExp: number; hint: string }> = {
  chill: { label: "Chill", torqueShare: 0.5, powerShare: 0.45, pedalExp: 1.6, hint: "Sanft: halbe Leistung, weiches Pedal" },
  sport: { label: "Sport", torqueShare: 0.85, powerShare: 0.8, pedalExp: 1.2, hint: "Alltag: viel Leistung, direktes Pedal" },
  plaid: { label: "Plaid", torqueShare: 1, powerShare: 1, pedalExp: 1, hint: "Alles, was Akku und Motoren hergeben" },
};
export const DRIVE_MODE_IDS = Object.keys(DRIVE_MODES) as EvDriveMode[];

/**
 * Two-speed reduction (#108, Arthur): like the rear axle of the Porsche Taycan / Audi e-tron GT (J1 platform), first
 * gear ≈ 15:1 for the launch, second ≈ 8:1 for top speed (Porsche Taycan technology press kit 2019, "two-speed
 * transmission on the rear axle": 15.56 / 8.05). It acts on the rear motors (all motors when there is no rear one);
 * EvMotorConfig.ratio of those motors is the first gear. The shift interrupts their torque for EV_SHIFT_S (torque
 * ramps to zero and back; the Taycan shifts in ≈ 0.2 … 0.3 s with the clutch pack).
 */
export const EV_SHIFT_S = 0.25;
/** Downshift this far below the shift point (hysteresis), km/h. */
export const EV_SHIFT_HYST_KMH = 20;

/** Is this motor on the two-speed axle? */
function onShiftAxle(ev: EvConfig, m: EvMotorConfig): boolean {
  return !!ev.twoSpeed && (m.axle === "rear" || !ev.motors.some((x) => x.axle === "rear"));
}

/** Reduction of a motor in a gear (1 or 2); single-speed motors keep their ratio. */
export function evMotorRatio(ev: EvConfig, m: EvMotorConfig, gear: number): number {
  return onShiftAxle(ev, m) && gear >= 2 ? ev.twoSpeed!.secondRatio : m.ratio;
}

/** The configuration as it drives in a gear: the motors of the two-speed axle carry that gear's ratio. */
export function evInGear(ev: EvConfig, gear: number): EvConfig {
  if (!ev.twoSpeed || gear < 2) return ev;
  return { ...ev, motors: ev.motors.map((m) => ({ ...m, ratio: evMotorRatio(ev, m, gear) })) };
}

/** Top speed the motors' rotor speed allows in the highest gear, km/h (wheel radius in m). */
export function evRpmVmaxKmh(ev: EvConfig, wheelRadiusM: number): number {
  const top = ev.twoSpeed ? 2 : 1;
  return Math.min(...ev.motors.map((m) => (m.maxRpm / evMotorRatio(ev, m, top)) * (Math.PI / 30) * wheelRadiusM * 3.6));
}

/** Reference ratio of the reflected shaft: the first rear motor's, else the first motor's. */
export function evRefRatio(ev: EvConfig): number {
  return (ev.motors.find((m) => m.axle === "rear") ?? ev.motors[0])?.ratio ?? 9;
}

/**
 * System power, kW: what battery and motors deliver together at 90 % SoC and 25 °C, at the shaft (the manufacturers'
 * "Systemleistung"). All motors at 1.3 × their base speed (field weakening, where the peak power is reached), torque
 * share k found by bisection so that the DC power (incl. losses) meets the battery's discharge limit; at most the
 * motors' own peak power (k = 1).
 */
export function evSystemPowerKw(ev: EvConfig): number {
  const bat = batteryLimits(ev.battery, START_SOC, 25).maxDischargeKw - (ev.auxKw ?? 0.4);
  const at = (k: number) => {
    let mech = 0;
    let dc = 0;
    for (const m of ev.motors) {
      const n = Math.min(1.3 * baseRpm(m), 0.9 * m.maxRpm);
      const t = k * motorMaxTorque(m, n);
      const pm = (t * n * RAD_PER_RPM) / 1000;
      mech += pm;
      dc += electricPowerKw(pm, motorLossKw(m, n, t));
    }
    return { mech, dc };
  };
  if (at(1).dc <= bat) return at(1).mech;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const k = 0.5 * (lo + hi);
    if (at(k).dc > bat) hi = k;
    else lo = k;
  }
  return at(lo).mech;
}

/** Usable pack energy, kWh. */
export function evPackKwh(ev: EvConfig): number {
  return packEnergyKwh(ev.battery, 1);
}

interface Alloc {
  torques: number[];
  limit: EvLimit;
  frontNm: number;
  rearNm: number;
}

export class EvSimulator {
  private s!: EngineState;
  private x!: VehicleBody;
  private bat!: BatteryState;
  private motorC: number[] = [];
  private initialised = false;
  private energy = 0;
  private regen = 0;
  private tripKm = 0;
  private tripKwh = 0;
  private holdI = 0;
  private startSoc = START_SOC;
  /** Two-speed reduction: gear now, the gear being shifted to, time left of the shift (s). */
  private gear = 1;
  private nextGear = 1;
  private shiftT = 0;
  /** The configuration in the present gear (evInGear). */
  private geared!: EvConfig;

  constructor(public ev: EvConfig) {
    this.reset();
  }

  /** New configuration (tuning, another car). The charge is kept when `keepCharge` is set. */
  setConfig(ev: EvConfig, keepCharge = false) {
    const soc = this.bat?.soc;
    this.ev = ev;
    this.reset();
    if (keepCharge && soc !== undefined) this.bat.soc = soc;
  }

  /** State of charge 0 … 1 (and the value reset() returns to). */
  setSoc(soc: number) {
    this.startSoc = clamp(soc, 0, 1);
    this.bat.soc = this.startSoc;
  }

  resetVehicle() {
    Object.assign(this.x, { vSpeed: 0, vWheel: 0, spin: false, locked: false, tyreF: 0, aLong: 0, vBrk: 0, absF: 0, absRelease: false, absT: 9, rpm: 0 });
  }

  reset() {
    this.x = createVehicleBody();
    this.bat = { soc: this.startSoc, tempC: 20, v: nominalV(this.ev.battery), a: 0 };
    this.motorC = this.ev.motors.map(() => 20);
    this.gear = this.nextGear = 1;
    this.shiftT = 0;
    this.geared = this.ev;
    this.initialised = false;
    this.energy = this.regen = this.tripKm = this.tripKwh = 0;
    this.holdI = 0;
    this.s = {
      t: 0, running: false, destroyed: false, rpm: 0, crankAngleDeg: 0, torqueNm: 0, powerKw: 0, imepBar: 0, bmepBar: 0, fmepBar: 0,
      load: 0, manifoldAbsKpa: 101.325, boostBar: 0, turboRpm: 0, airMassFlowKgS: 0, fuelMassFlowGS: 0, fuelFlowLh: 0,
      bsfcGkWh: Number.NaN, efficiency: 0, lambda: 99, egtC: 20, coolantC: 20, oilC: 20, oilPressureBar: 0, peakPressureBar: 0,
      meanPistonSpeedMs: 0, knock: 0, smoke: 0, wear: 0, warnings: [], damage: [], starterEngaged: false, afterfire: 0,
      ev: this.evState(false, "sport", 0, 0, 0, 0, "none", 0, Number.NaN, 20),
    };
  }

  get state(): EngineState {
    return this.s;
  }

  /** Torque envelope of each motor now (voltage, temperature, drive mode). */
  private maxTorques(rpms: number[], vr: number, share: number): number[] {
    return this.geared.motors.map((m, i) => motorMaxTorque(m, rpms[i]!, vr, m.inverterA, motorDerate(this.motorC[i]!)) * share);
  }

  step(dtIn: number, input: SimInputs): EngineState {
    const dt = clamp(fin(dtIn, 0), 0, MAX_DT);
    const ev = this.ev;
    const b = ev.battery;
    const x = this.x;
    const ambientC = fin(input.ambientC, 20);
    if (!this.initialised) {
      // "warm start": battery and motors at operating temperature (preconditioned 30 °C)
      const t0 = input.startWarm ? Math.max(ambientC, 30) : ambientC;
      this.bat.tempC = t0;
      this.motorC = ev.motors.map(() => t0);
      this.initialised = true;
    }
    if (dt <= 0) return this.s;
    const ready = !!input.ignition && this.bat.soc > 0;
    const modeId: EvDriveMode = input.evDriveMode ?? "sport";
    const mode = DRIVE_MODES[modeId];
    const pedal = clamp(fin(input.pedal, 0), 0, 1);
    this.stepGear(dt, input.dynoMode === "vehicle" && input.vehicle ? x.vSpeed * 3.6 : 0);
    const gev = this.geared;
    const ref = evRefRatio(gev);
    const motors = gev.motors;
    // torque interruption while shifting: the two-speed axle ramps to zero and back
    const shiftCut = this.shiftT > 0 ? Math.abs(1 - (2 * (EV_SHIFT_S - this.shiftT)) / EV_SHIFT_S) : 1;
    const eta = clamp(ev.gearEfficiency, 0.5, 1);
    const Jref = motors.reduce((a, m) => a + rotorInertia(m) * (m.ratio / ref) ** 2, 0) + 0.02;
    const aux = ready ? (ev.auxKw ?? 0.4) : 0;
    const c = input.dynoMode === "vehicle" ? input.vehicle : undefined;
    // battery limits and voltage once per frame (they change slowly against 1 ms)
    const bl = batteryLimits(b, this.bat.soc, this.bat.tempC);
    const vr = clamp(this.bat.v / nominalV(b), 0.5, 1.3);
    const pDisMax = Math.max(0, bl.maxDischargeKw * mode.powerShare - aux);
    const pChgMax = Math.max(0, bl.maxChargeKw + aux);
    const nSub = Math.max(1, Math.round(dt / H));
    const h = dt / nSub;
    let sumT = 0;
    let sumPm = 0;
    let sumPdc = 0;
    let sumRegen = 0;
    let last: Alloc = { torques: motors.map(() => 0), limit: "none", frontNm: 0, rearNm: 0 };
    for (let k = 0; k < nSub; k++) {
      const wRef = x.rpm * RAD_PER_RPM;
      const rpms = motors.map((m) => (x.rpm * m.ratio) / ref);
      const tMax = this.maxTorques(rpms, vr, mode.torqueShare);
      const alloc = ready ? this.allocate(c, pedal, mode.pedalExp, rpms, tMax, pDisMax, pChgMax, eta, x) : { torques: motors.map(() => 0), limit: "none" as EvLimit, frontNm: 0, rearNm: 0, friction: c?.brake ?? 0 };
      if (shiftCut < 1) alloc.torques.forEach((t, i) => onShiftAxle(ev, ev.motors[i]!) && (alloc.torques[i] = t * shiftCut));
      last = alloc;
      const tRef = alloc.torques.reduce((a, t, i) => a + (t * motors[i]!.ratio) / ref, 0);
      if (c) {
        stepVehicle(x, { ...c, totalRatio: ref, brake: alloc.friction, clutch: 1, clutchCapacityNm: 1e7 }, tRef, Jref, h);
      } else {
        // motor on the bench (engine dyno modes): rotor + reduction gear spin against the brake and the drag losses
        const drag = wRef > 1 ? (motors.reduce((a, m, i) => a + motorLossKw(m, rpms[i]!, 0), 0) * 1000) / wRef : 0;
        let brake = 0;
        if (input.dynoMode === "hold-rpm") {
          const err = x.rpm - fin(input.dynoTargetRpm, 2000);
          const kp = Jref * 3;
          this.holdI = clamp(this.holdI + kp * 8 * err * h, 0, 1e5);
          brake = clamp(kp * err + this.holdI, 0, 1e5);
        } else if (input.dynoMode === "torque") brake = Math.max(0, fin(input.dynoBrakeTorqueNm, 0)) * clamp(x.rpm / 300, 0, 1);
        else this.holdI = 0;
        const w = Math.max(0, wRef + ((tRef - drag - brake) / Jref) * h);
        x.rpm = w / RAD_PER_RPM;
      }
      x.crank = (x.crank + x.rpm * 6 * h) % 720;
      // electric power of every motor at its speed and torque (motoring +, generating −)
      let pm = 0;
      let pdc = aux;
      motors.forEach((m, i) => {
        const t = alloc.torques[i]!;
        const mech = (t * rpms[i]! * RAD_PER_RPM) / 1000;
        const loss = Math.abs(t) > 1e-6 || rpms[i]! > 1 ? motorLossKw(m, rpms[i]!, t) : 0;
        pm += mech;
        pdc += electricPowerKw(mech, loss);
        this.motorC[i] = stepMotorTemp(m, this.motorC[i]!, loss, h, ambientC, ev.coolingScale ?? 1);
      });
      this.bat = stepBattery(b, this.bat, pdc, h, ambientC);
      if (pdc > 0) this.energy += (pdc * h) / 3600;
      else this.regen += (-pdc * h) / 3600;
      this.tripKwh += (pdc * h) / 3600;
      if (c) this.tripKm += (x.vSpeed * h) / 1000;
      sumT += tRef;
      sumPm += pm;
      sumPdc += pdc;
      sumRegen += Math.max(0, -pdc);
    }
    const s: EngineState = { ...this.s };
    const torque = sumT / nSub;
    const pMech = sumPm / nSub;
    const pDc = sumPdc / nSub;
    s.t = this.s.t + dt;
    s.running = ready;
    s.rpm = x.rpm;
    s.crankAngleDeg = x.crank;
    s.torqueNm = torque;
    s.powerKw = pMech;
    const tMaxNow = this.maxTorques(motors.map((m) => (x.rpm * m.ratio) / ref), vr, 1).reduce((a, t, i) => a + (t * motors[i]!.ratio) / ref, 0);
    s.load = clamp(Math.abs(torque) / Math.max(1, tMaxNow), 0, 1);
    s.efficiency = pDc > 0.5 && pMech > 0 ? clamp(pMech / pDc, 0, 1) : 0;
    const motorC = Math.max(...this.motorC);
    s.coolantC = motorC;
    s.oilC = motorC;
    s.egtC = ambientC;
    s.starterEngaged = false;
    s.vehicleSpeedMs = c ? x.vSpeed : 0;
    if (c && c.grip !== undefined) {
      s.wheelSpeedMs = x.vWheel;
      s.wheelSlip = (x.vWheel - x.vSpeed) / Math.max(1, x.vSpeed);
      s.wheelSpin = x.spin;
      s.wheelsLocked = x.locked;
      s.tyreForceN = x.tyreF;
      s.accelMs2 = x.aLong;
      s.brakeSlip = slipRatio(x.vBrk, x.vSpeed);
      s.absActive = x.absT < 0.3;
      s.absCycles = x.absCycles;
      const demand = clamp(c.brake ?? 0, 0, 1) * BRAKE_MAX_G * c.vehicle.massKg * G;
      s.absPressure = demand > 1 ? clamp(x.absF / demand, 0, 1) : 0;
      s.roadGrip = x.grip;
    }
    const kmh = (c ? x.vSpeed : 0) * 3.6;
    s.ev = this.evState(ready, modeId, pDc, sumRegen / nSub, pMech, kmh, last.limit, last.frontNm, last.rearNm, motorC, bl);
    s.warnings = this.warnings(motorC);
    this.s = s;
    return s;
  }

  /**
   * Torque of every motor for this sub-step: pedal map, lift-off regen, blended braking, motor envelope, battery
   * power and (ASR) the tyre limit per axle. Returns the friction-brake pedal that is left.
   */
  private allocate(c: VehicleCoupling | undefined, pedal: number, exp: number, rpms: number[], tMax: number[], pDisMax: number, pChgMax: number, eta: number, x: VehicleBody): Alloc & { friction: number } {
    const motors = this.geared.motors;
    const r = c?.vehicle.wheelRadiusM ?? 0.33;
    const m = c?.vehicle.massKg ?? 2000;
    const brakePedal = clamp(c?.brake ?? 0, 0, 1);
    const v = c ? x.vSpeed : 0;
    // wheel force capacity per motor (+ motoring)
    const fCap = motors.map((mo, i) => (tMax[i]! * mo.ratio * eta) / r);
    const front = (i: number) => motors[i]!.axle === "front";
    const capF = fCap.reduce((a, f, i) => a + (front(i) ? f : 0), 0);
    const capR = fCap.reduce((a, f, i) => a + (front(i) ? 0 : f), 0);
    let limit: EvLimit = "none";
    // parking brake at standstill: the motors hold nothing (the brake does)
    if (c?.parkingBrake && v < 0.05) return { torques: motors.map(() => 0), limit, frontNm: 0, rearNm: 0, friction: brakePedal };
    const fade = c ? clamp((v - REGEN_FADE_LO) / (REGEN_FADE_HI - REGEN_FADE_LO), 0, 1) : clamp(rpms[0]! / 300, 0, 1);
    let fReq: number;
    let friction = brakePedal;
    if (pedal > PEDAL_ZERO && brakePedal < 0.05) {
      fReq = Math.pow((pedal - PEDAL_ZERO) / (1 - PEDAL_ZERO), exp) * (capF + capR);
      // a torque cut of the ASR (Drivetrain TractionControl) acts on the request
      if (c?.torqueCut) fReq *= 1 - clamp(c.torqueCut, 0, 0.9);
      // rotor speed limit of the fastest-turning motor caps the car (the VCU fades the drive torque over the last 2 %),
      // also when the motors of the other axle could still push (different ratios, electric.md §4.1)
      fReq *= motors.reduce((k, mo, i) => Math.min(k, clamp((mo.maxRpm - rpms[i]!) / (0.02 * mo.maxRpm), 0, 1)), 1);
    } else {
      // lift-off regen and blended braking; none while ABS regulates (the hydraulics need the full control)
      const absOn = x.absT < 0.3;
      const liftOff = (this.ev.liftOffRegenG * m * G * (PEDAL_ZERO - Math.min(pedal, PEDAL_ZERO))) / PEDAL_ZERO;
      const brakeF = brakePedal * BRAKE_MAX_G * m * G;
      const blendCap = absOn ? 0 : BLEND_MAX_G * m * G;
      const want = Math.min(liftOff + Math.min(brakeF, blendCap), capF + capR) * fade;
      fReq = -want;
      // the friction brake takes what the motors do not
      const regenForBrake = Math.max(0, want - liftOff * fade);
      friction = brakeF > 0 ? clamp((brakeF - regenForBrake) / (BRAKE_MAX_G * m * G), 0, 1) : 0;
    }
    if (!c) fReq = Math.max(fReq, -(capF + capR)) * (fReq < 0 ? fade : 1);
    if (fReq > 0 && pedal >= 0.999 && fReq >= 0.999 * (capF + capR)) limit = "torque";
    // split between the axles in proportion to their capacity; ASR moves what one axle cannot carry to the other
    let fF = capF + capR > 0 ? (fReq * capF) / (capF + capR) : 0;
    let fR = fReq - fF;
    if (c && c.asr && c.grip !== undefined && fReq > 0) {
      const veh = c.vehicle;
      const N = m * G;
      const share = frontAxleShare(veh);
      const dN = veh.cgHeightM && veh.wheelbaseM ? (m * Math.max(0, x.aLong) * veh.cgHeightM) / veh.wheelbaseM : 0;
      const mu = Math.max(0.01, c.grip);
      const lF = capF > 0 ? TC_MARGIN * mu * clamp(N * share - dN, 0, N) : 0;
      const lR = capR > 0 ? TC_MARGIN * mu * clamp(N * (1 - share) + dN, 0, N) : 0;
      if (fF > lF) {
        const spare = Math.min(capR, lR) - fR;
        fR += clamp(fF - lF, 0, Math.max(0, spare));
        fF = lF;
        limit = "traction";
      }
      if (fR > lR) {
        const spare = Math.min(capF, lF) - fF;
        fF += clamp(fR - lR, 0, Math.max(0, spare));
        fR = lR;
        limit = "traction";
      }
    }
    // wheel force → motor torque, shared on an axle in proportion to the motors' capacity
    const torques = motors.map((mo, i) => {
      const axCap = front(i) ? capF : capR;
      const f = (front(i) ? fF : fR) * (axCap > 0 ? fCap[i]! / axCap : 0);
      return f >= 0 ? (f * r) / (mo.ratio * eta) : (f * r * eta) / mo.ratio;
    });
    // battery: scale the torques until the DC power fits (two passes, the losses are non-linear)
    for (let pass = 0; pass < 3; pass++) {
      const p = this.dcPower(torques, rpms);
      if (p > pDisMax && p > 0) {
        const k = clamp(pDisMax / p, 0, 1) * (pass === 0 ? 1 : 0.995);
        for (let i = 0; i < torques.length; i++) if (torques[i]! > 0) torques[i] = torques[i]! * k;
        limit = this.motorC.some((t) => t > MOTOR_DERATE_C) ? "thermal" : this.bat.tempC > 55 ? "thermal" : "battery";
      } else if (p < -pChgMax) {
        const k = clamp(pChgMax / -p, 0, 1);
        for (let i = 0; i < torques.length; i++) if (torques[i]! < 0) torques[i] = torques[i]! * k;
        // the friction brake makes up for regen the battery cannot take
        if (brakePedal > 0 && c) friction = clamp(friction + (1 - k) * Math.min(brakePedal, BLEND_MAX_G / BRAKE_MAX_G), 0, 1);
      } else break;
    }
    if (limit === "none" && fReq > 0) {
      const pow = motors.some((mo, i) => tMax[i]! < 0.98 * mo.peakTorqueNm && rpms[i]! > 100);
      if (pow && pedal >= 0.999) limit = "power";
    }
    if (motors.some((mo, i) => rpms[i]! > 0.98 * mo.maxRpm) && fReq > 0) limit = "speed";
    const wheel = (ax: "front" | "rear") => motors.reduce((a, mo, i) => a + (mo.axle === ax ? torques[i]! * mo.ratio * (torques[i]! >= 0 ? eta : 1 / eta) : 0), 0);
    return { torques, limit, frontNm: wheel("front"), rearNm: wheel("rear"), friction };
  }

  private dcPower(torques: number[], rpms: number[]): number {
    return this.geared.motors.reduce((a, m, i) => {
      const mech = (torques[i]! * rpms[i]! * RAD_PER_RPM) / 1000;
      return a + electricPowerKw(mech, Math.abs(torques[i]!) > 1e-6 ? motorLossKw(m, rpms[i]!, torques[i]!) : 0);
    }, 0);
  }

  /**
   * Two-speed shift schedule (once per frame, vehicle speed in km/h): up at the shift point or near the rotor's speed
   * limit, down EV_SHIFT_HYST_KMH below it. The new ratio engages in the middle of the torque gap; the reflected shaft
   * speed follows the ratio (rotor speed ∝ ratio at the same road speed).
   */
  private stepGear(dt: number, kmh: number) {
    const ts = this.ev.twoSpeed;
    if (!ts) return;
    if (this.shiftT > 0) {
      const before = this.shiftT;
      this.shiftT = Math.max(0, this.shiftT - dt);
      if (before > EV_SHIFT_S / 2 && this.shiftT <= EV_SHIFT_S / 2 && this.nextGear !== this.gear) {
        const oldRef = evRefRatio(this.geared);
        this.gear = this.nextGear;
        this.geared = evInGear(this.ev, this.gear);
        this.x.rpm *= evRefRatio(this.geared) / oldRef;
      }
      return;
    }
    const ref = evRefRatio(this.geared);
    const nearMax = this.geared.motors.some((m, i) => onShiftAxle(this.ev, this.ev.motors[i]!) && (this.x.rpm * m.ratio) / ref > 0.95 * m.maxRpm);
    const want = this.gear === 1 ? (kmh > ts.shiftKmh || nearMax ? 2 : 1) : kmh < ts.shiftKmh - EV_SHIFT_HYST_KMH ? 1 : 2;
    if (want !== this.gear) {
      this.nextGear = want;
      this.shiftT = EV_SHIFT_S;
    }
  }

  private evState(ready: boolean, mode: EvDriveMode, pDc: number, regenKw: number, pMech: number, kmh: number, limit: EvLimit, frontNm: number, rearNm: number, motorC: number, bl = batteryLimits(this.ev.battery, this.bat.soc, this.bat.tempC)) {
    const b = this.ev.battery;
    const remain = packEnergyKwh(b, this.bat.soc);
    // consumption basis: the trip average once there is distance, the rated value before (blend 2 … 20 km)
    const rated = this.ev.ratedKwhPer100 ?? 18;
    const trip = this.tripKm > 0.1 ? (this.tripKwh / this.tripKm) * 100 : Number.NaN;
    const w = clamp((this.tripKm - 2) / 18, 0, 1);
    const basis = Number.isFinite(trip) && trip > 5 ? trip * w + rated * (1 - w) : rated;
    return {
      ready, soc: this.bat.soc, packV: this.bat.v, packOcvV: packOcv(b, this.bat.soc), packA: this.bat.a, powerKw: pDc, regenKw,
      motorKw: pMech, rangeKm: (remain / basis) * 100, kwhPer100: kmh > 5 ? (pDc / kmh) * 100 : Number.NaN, tripKwhPer100: trip,
      batteryC: this.bat.tempC, motorC, driveMode: mode, maxDischargeKw: bl.maxDischargeKw, maxChargeKw: bl.maxChargeKw,
      frontNm, rearNm, limitedBy: limit, energyKwh: this.energy, regenKwh: this.regen,
      ...(this.ev.twoSpeed ? { gear: this.gear, shifting: this.shiftT > 0 } : {}),
    };
  }

  private warnings(motorC: number): Warning[] {
    const w: Warning[] = [];
    const t = this.bat.tempC;
    if (t > 55) w.push({ code: "battery-hot", severity: t > 62 ? "critical" : "warning", message: `Akku heiß (${Math.round(t)} °C): Leistung reduziert` });
    if (this.bat.soc <= 0) w.push({ code: "battery-low", severity: "critical", message: "Akku leer: kein Antrieb mehr" });
    else if (this.bat.soc < 0.1) w.push({ code: "battery-low", severity: "warning", message: `Akku fast leer (${Math.round(this.bat.soc * 100)} %): Leistung reduziert` });
    if (motorC > MOTOR_DERATE_C) w.push({ code: "motor-hot", severity: "warning", message: `E-Motor heiß (${Math.round(motorC)} °C): Drehmoment reduziert` });
    return w;
  }

  /** Battery internals for tests and the bug report. */
  get battery(): Readonly<BatteryState> {
    return this.bat;
  }
}

/** Motor speed (1/min) at a road speed for a motor (wheel radius in m). */
export function motorRpmAt(m: EvMotorConfig, speedMs: number, wheelRadiusM: number): number {
  return (speedMs / wheelRadiusM) * m.ratio * (30 / Math.PI);
}
