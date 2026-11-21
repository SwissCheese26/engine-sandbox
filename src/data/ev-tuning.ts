/**
 * Electric tuning (issue #108): more motors, bigger motors, more inverter current, bigger pack, higher C-rate, 800 V.
 * Pure functions (no DOM). The limits are physical (docs/research/electric.md §6):
 *  - Motor size: power and torque scale with the active length / diameter (×0.5 … ×3); a drive unit (motor, inverter,
 *    gear) weighs ≈ 0.4 kg per kW peak (≈ 2.5 kW/kg) [S].
 *  - Inverter current ×0.5 … ×2: torque ∝ current up to the design current, above it the iron saturates (I^0.75,
 *    electric-motor.ts torqueAtCurrent); power at base speed ∝ current; at most 2500 A per inverter (SiC modules) [S].
 *  - Pack: energy 30 … 200 kWh at ≈ 160 Wh/kg (pack level), 400 V or 800 V class (cells in series ×2, same energy).
 *  - C-rate 1 … 15 (high-power cells), but the whole pack current is limited by the HV contactors, fuse and busbars
 *    to ≈ 3000 A [S]: above ≈ 1 MW only an 800 V pack helps (P ≈ U·I).
 *  - Traction (μ·m·g) is applied by the simulator, not here.
 * At the top end (5 big motors, 200 kWh, 800 V, max current) the system reaches ≈ 3000 PS.
 */
import { evPackKwh, evSystemPowerKw, packMassKg, torqueAtCurrent } from "../core/index.ts";
import type { EvConfig, EvMotorConfig } from "../core/index.ts";

export const PS_PER_KW = 1000 / 735.49875;
export const DRIVE_UNIT_KG_PER_KW = 0.4;
export const INVERTER_MAX_A = 2500;
export const PACK_BUS_MAX_A = 3000;

export interface EvTuning {
  frontMotors: number;
  rearMotors: number;
  /** Motor size relative to the car's own motors. */
  motorScale: number;
  /** Inverter current relative to the motors' design current. */
  currentScale: number;
  packKwh: number;
  /** Discharge C-rate of the cells. */
  cRate: number;
  /** 800 V class pack (twice the cells in series). */
  highVoltage: boolean;
}

export const TUNING_LIMITS = {
  frontMotors: { min: 0, max: 2 },
  rearMotors: { min: 1, max: 3 },
  motorScale: { min: 0.5, max: 3 },
  currentScale: { min: 0.5, max: 2 },
  packKwh: { min: 30, max: 200 },
  cRate: { min: 1, max: 15 },
} as const;

const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? (x < lo ? lo : x > hi ? hi : x) : lo);

/** Series cells of the 400 V class for a chemistry's nominal cell voltage. */
const SERIES_400V = 108;

/** The car as it left the factory, as tuning values. */
export function evTuningOf(ev: EvConfig): EvTuning {
  const b = ev.battery;
  return {
    frontMotors: ev.motors.filter((m) => m.axle === "front").length,
    rearMotors: Math.max(1, ev.motors.filter((m) => m.axle === "rear").length),
    motorScale: 1,
    currentScale: 1,
    packKwh: Math.round(evPackKwh(ev)),
    cRate: b.maxDischargeC,
    highVoltage: b.seriesCells > 160,
  };
}

export interface TunedEv {
  ev: EvConfig;
  /** Mass change against the base car (drive units + pack), kg. */
  deltaKg: number;
  systemKw: number;
  systemPs: number;
  /** German notes on what limits the setup. */
  notes: string[];
}

/** Applies tuning to the car's factory configuration. */
export function tuneEv(base: EvConfig, tIn: EvTuning): TunedEv {
  const L = TUNING_LIMITS;
  const t: EvTuning = {
    frontMotors: Math.round(clamp(tIn.frontMotors, L.frontMotors.min, L.frontMotors.max)),
    rearMotors: Math.round(clamp(tIn.rearMotors, L.rearMotors.min, L.rearMotors.max)),
    motorScale: clamp(tIn.motorScale, L.motorScale.min, L.motorScale.max),
    currentScale: clamp(tIn.currentScale, L.currentScale.min, L.currentScale.max),
    packKwh: clamp(tIn.packKwh, L.packKwh.min, L.packKwh.max),
    cRate: clamp(tIn.cRate, L.cRate.min, L.cRate.max),
    highVoltage: !!tIn.highVoltage,
  };
  const notes: string[] = [];
  // template motor per axle: the car's own, else the other axle's
  const tpl = (axle: EvMotorConfig["axle"]) => base.motors.find((m) => m.axle === axle) ?? base.motors[0]!;
  const build = (m: EvMotorConfig): EvMotorConfig => {
    const sized = { ...m, peakTorqueNm: m.peakTorqueNm * t.motorScale, peakPowerKw: m.peakPowerKw * t.motorScale, inverterA: m.inverterA * t.motorScale };
    let amps = sized.inverterA * t.currentScale;
    if (amps > INVERTER_MAX_A) {
      amps = INVERTER_MAX_A;
      notes.push(`Wechselrichter am Limit: höchstens ${INVERTER_MAX_A} A je Motor.`);
    }
    // more current: torque with saturation, power at base speed in proportion (same voltage)
    const torque = torqueAtCurrent(sized, amps);
    return { ...sized, peakTorqueNm: torque, peakPowerKw: sized.peakPowerKw * (torque / sized.peakTorqueNm), inverterA: amps, rotorInertiaKgM2: undefined };
  };
  const motors: EvMotorConfig[] = [
    ...Array.from({ length: t.frontMotors }, () => build({ ...tpl("front"), axle: "front" })),
    ...Array.from({ length: t.rearMotors }, () => build({ ...tpl("rear"), axle: "rear" })),
  ];
  // pack: series count from the voltage class, parallel count from the energy (same cell)
  const b = base.battery;
  const series = (t.highVoltage ? 2 : 1) * (b.seriesCells > 160 ? Math.round(b.seriesCells / 2) : b.seriesCells || SERIES_400V);
  const cellKwh = (b.cellAh * 3.7) / 1000;
  const parallel = Math.max(1, Math.round(t.packKwh / (series * cellKwh)));
  const ah = parallel * b.cellAh;
  let c = t.cRate;
  if (c * ah > PACK_BUS_MAX_A) {
    c = PACK_BUS_MAX_A / ah;
    notes.push(`Hochvolt-Schütze und Sicherung begrenzen den Akkustrom auf ${PACK_BUS_MAX_A} A${t.highVoltage ? "" : ": mehr Leistung nur mit 800 V"}.`);
  }
  const battery = { ...b, seriesCells: series, parallelCells: parallel, maxDischargeC: c, massKg: undefined };
  const ev: EvConfig = { ...base, motors, battery };
  const motorKg = (ms: EvMotorConfig[]) => ms.reduce((a, m) => a + m.peakPowerKw * DRIVE_UNIT_KG_PER_KW, 0);
  const deltaKg = motorKg(motors) - motorKg(base.motors) + packMassKg(battery) - packMassKg({ ...b, massKg: undefined });
  const systemKw = evSystemPowerKw(ev);
  const motorKw = motors.reduce((a, m) => a + m.peakPowerKw, 0);
  if (systemKw < 0.9 * motorKw) notes.push("Der Akku begrenzt: größerer Akku, höhere C-Rate oder 800 V bringen mehr.");
  return { ev, deltaKg, systemKw, systemPs: systemKw * PS_PER_KW, notes: [...new Set(notes)] };
}

/** The strongest setup the limits allow (for tests and the "Maximum" button). */
export function maxTuning(): EvTuning {
  const L = TUNING_LIMITS;
  return { frontMotors: L.frontMotors.max, rearMotors: L.rearMotors.max, motorScale: L.motorScale.max, currentScale: L.currentScale.max, packKwh: L.packKwh.max, cRate: L.cRate.max, highVoltage: true };
}
