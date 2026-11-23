/**
 * Traction motor with inverter (issue #108). Pure functions, no DOM. docs/research/electric.md §2.
 *
 * Torque–speed envelope of an inverter-fed machine (De Doncker/Pulle/Veltman, Advanced Electrical Drives, ch. 7
 * "field weakening"; Bosch Kraftfahrtechnisches Taschenbuch, "Elektrische Antriebe"):
 *  - Constant-torque region up to the base speed: T = k_T · I, limited by the inverter phase current. Above the
 *    design current the stator iron saturates and the torque rises only with I^0.75 (electric.md §2.2).
 *  - Base speed: the back-EMF reaches the voltage the inverter can apply, ω_b ∝ U_DC (electric.md §2.1).
 *  - Field-weakening region: constant power P = T_max · ω_b up to the characteristic speed (PMSM ≈ 3 × ω_b, induction
 *    ≈ 2 × ω_b), above it the power falls ∝ 1/ω (PMSM: limited field-weakening current; induction: pull-out torque
 *    ∝ 1/ω²).
 *  - Mechanical speed limit maxRpm (rotor bursting, bearings): torque fades out over the last 2 %.
 * Losses (electric.md §2.3): copper ∝ T² (∝ I²), iron ∝ ω^1.5 (Steinmetz), magnet drag of the PMSM also unloaded,
 * plus a constant share (bearings, windage); inverter ≈ 2 %. Above the factory rotor speed (lossRefRpm, tuned
 * carbon-sleeved rotor) the air-gap windage and the eddy losses in the sleeve grow ∝ n³ (electric.md §6.1).
 */
import type { EvMotorConfig } from "./types.ts";

const RAD_PER_RPM = Math.PI / 30;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Characteristic speed / base speed: end of the constant-power region (electric.md §2.1). */
export const CONSTANT_POWER_RATIO: Record<EvMotorConfig["kind"], number> = { pmsm: 3, induction: 2.2 };
/** Inverter efficiency (SiC/IGBT, at load) [electric.md §2.3]. */
export const INVERTER_EFFICIENCY = 0.98;
/** Exponent of the torque rise above the design current (iron saturation) [electric.md §2.2]. */
const SATURATION_EXP = 0.75;

/** Loss coefficients, share of the peak power (electric.md §2.3, fitted to η_max ≈ 96–97 % PMSM, 93–95 % induction). */
const LOSS: Record<EvMotorConfig["kind"], { cu: number; fe: number; c0: number }> = {
  pmsm: { cu: 0.055, fe: 0.014, c0: 0.002 },
  induction: { cu: 0.08, fe: 0.008, c0: 0.002 },
};

/**
 * Extra windage / sleeve loss above the factory rotor speed, share of the peak power at (n / n_ref)³ − 1 (disc
 * windage ∝ ω³, Vrancik NASA TN D-4849 1968; electric.md §6.1): ≈ 0.3 % of the peak power at +25 % speed.
 */
export const OVERSPEED_WINDAGE = 0.003;

/** Peak torque at a phase current: linear up to the design current, saturating above (I^0.75). */
export function torqueAtCurrent(m: EvMotorConfig, currentA: number, designA = m.inverterA): number {
  const i = Math.max(0, currentA);
  const r = i / Math.max(1, designA);
  return m.peakTorqueNm * (r <= 1 ? r : Math.pow(r, SATURATION_EXP));
}

/**
 * Base speed in 1/min at the voltage ratio u = U_DC / U_nominal (back-EMF limit ∝ voltage). From the design point:
 * n_b = P_peak / T_peak.
 */
export function baseRpm(m: EvMotorConfig, voltageRatio = 1): number {
  return ((m.peakPowerKw * 1000) / Math.max(1, m.peakTorqueNm) / RAD_PER_RPM) * clamp(voltageRatio, 0.3, 1.5);
}

/**
 * Maximum torque (motoring and generating, same magnitude) at a rotor speed, Nm.
 * `voltageRatio` = present DC voltage / nominal; `currentA` = phase current the inverter may deliver now
 * (default: the design current); `derate` 0 … 1 (temperature).
 */
export function motorMaxTorque(m: EvMotorConfig, rpm: number, voltageRatio = 1, currentA = m.inverterA, derate = 1, designA = m.inverterA): number {
  const n = Math.abs(rpm);
  if (n >= m.maxRpm) return 0;
  const tI = torqueAtCurrent(m, currentA, designA) * clamp(derate, 0, 1);
  // the power at base speed follows the torque (current) and the base speed (voltage)
  const nb = baseRpm(m, voltageRatio);
  const pMax = tI * nb * RAD_PER_RPM;
  const nCp = CONSTANT_POWER_RATIO[m.kind] * baseRpm(m, voltageRatio);
  let t = tI;
  if (n > nb) {
    const p = n <= nCp ? pMax : pMax * (nCp / n);
    t = Math.min(tI, p / (n * RAD_PER_RPM));
  }
  // speed limit: fade over the last 2 %
  const fade = clamp((m.maxRpm - n) / (0.02 * m.maxRpm), 0, 1);
  return t * fade;
}

/** Maximum mechanical power at a speed, kW. */
export function motorMaxPowerKw(m: EvMotorConfig, rpm: number, voltageRatio = 1, currentA = m.inverterA): number {
  return (motorMaxTorque(m, rpm, voltageRatio, currentA) * Math.abs(rpm) * RAD_PER_RPM) / 1000;
}

/**
 * Motor losses (copper + iron + constant), kW, at a speed and torque (sign ignored). Scales with the machine size
 * (peak power) so a bigger motor has the same efficiency map relative to its own rating.
 */
export function motorLossKw(m: EvMotorConfig, rpm: number, torqueNm: number): number {
  const c = LOSS[m.kind];
  const tRel = Math.abs(torqueNm) / Math.max(1, m.peakTorqueNm);
  const nRel = Math.abs(rpm) / Math.max(1, m.lossRefRpm ?? m.maxRpm);
  const windage = OVERSPEED_WINDAGE * Math.max(0, nRel ** 3 - 1);
  // the induction motor needs magnetising current as soon as it carries torque (none when it idles along)
  const mag = m.kind === "induction" ? 0.005 * Math.min(1, tRel * 20) : 0;
  return m.peakPowerKw * (c.cu * tRel * tRel + c.fe * Math.pow(nRel, 1.5) + c.c0 * Math.min(1, nRel * 10) + mag + windage);
}

/**
 * Simplified efficiency map η(n, T) of motor + inverter, 0 … 1 (motoring: P_mech / P_el; generating: P_el / P_mech).
 * NaN at zero power.
 */
export function motorEfficiency(m: EvMotorConfig, rpm: number, torqueNm: number): number {
  const pm = (torqueNm * rpm * RAD_PER_RPM) / 1000;
  if (Math.abs(pm) < 1e-3) return Number.NaN;
  const loss = motorLossKw(m, rpm, torqueNm);
  const pe = electricPowerKw(pm, loss);
  return pm > 0 ? pm / pe : pe / pm;
}

/** DC power of a motor + inverter for a mechanical power (+ motoring, − generating) and the motor losses, kW. */
export function electricPowerKw(mechKw: number, lossKw: number): number {
  const p = mechKw + lossKw;
  return p >= 0 ? p / INVERTER_EFFICIENCY : p * INVERTER_EFFICIENCY;
}

/** Rotor inertia estimate, kg·m², from the peak torque (≈ 0.00011 kg·m²/Nm, Tesla/Lucid rotors ≈ 0.03–0.06) [S]. */
export function rotorInertia(m: EvMotorConfig): number {
  return m.rotorInertiaKgM2 ?? Math.max(0.01, 1.1e-4 * m.peakTorqueNm);
}

/**
 * Lumped motor temperature (winding + stator), electric.md §2.4: heat capacity ≈ 200 J/K per kW peak power, cooling
 * ≈ 0.25 W/K per kW to a 45 °C water/glycol circuit. Derating from 150 °C to zero torque at 180 °C (insulation
 * class H).
 */
export const MOTOR_DERATE_C = 150;
export const MOTOR_MAX_C = 180;
export const MOTOR_COOLANT_C = 45;

export function stepMotorTemp(m: EvMotorConfig, tempC: number, lossKw: number, dt: number, ambientC: number, coolingScale = 1): number {
  const C = 200 * m.peakPowerKw;
  const ua0 = 0.25 * m.peakPowerKw;
  const ua = ua0 * Math.max(0.2, coolingScale);
  // the coolant cannot be colder than the ambient air
  const cool = Math.max(MOTOR_COOLANT_C, ambientC);
  // below the coolant temperature the circuit warms the motor up only slowly (pump heat, warm-up)
  const q = lossKw * 1000 - (tempC > cool ? ua * (tempC - cool) : 0.2 * ua0 * (tempC - cool));
  return tempC + (q / C) * dt;
}

export function motorDerate(tempC: number): number {
  return clamp((MOTOR_MAX_C - tempC) / (MOTOR_MAX_C - MOTOR_DERATE_C), 0, 1);
}
