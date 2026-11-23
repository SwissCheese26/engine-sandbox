/**
 * Electric tuning (issue #108): motors (count, axle, size), inverter current, battery (energy, cell type, C-rate,
 * 400/800 V), cooling and tyres. Pure functions (no DOM). The limits are physical (docs/research/electric.md §6):
 *  - 1 … 4 motors on the front and rear axle; motor size ×0.5 … ×3 (power and torque scale with active length and
 *    diameter); a drive unit (motor, inverter, gear) weighs ≈ 0.4 kg per kW peak (≈ 2.5 kW/kg) [S].
 *  - Inverter current: torque ∝ current up to the design current, above it the iron saturates (I^0.75,
 *    electric-motor.ts torqueAtCurrent); power at base speed ∝ current; at most 2500 A per inverter (SiC) [S].
 *  - Battery: energy 30 … 200 kWh, cell type NMC / NCA / LFP (energy density, voltage, resistance), C-rate 1 … 15,
 *    400 V or 800 V class (cells in series). The whole pack current is limited by the HV contactors, fuse and
 *    busbars to ≈ 3000 A [S]: above ≈ 1 MW only an 800 V pack helps (P ≈ U·I).
 *  - Cooling: series / sport / track: battery cold plate ×1 / ×2 / ×3.5, motor cooling ×1 / ×1.5 / ×2.5, +10 / +25 kg.
 *  - Traction (μ·m·g) is applied by the simulator; the estimate below drives the car there.
 *  - Reduction: single-speed 5 … 18:1 or two-speed like the Taycan / e-tron GT rear axle (≈ 15:1 and ≈ 8:1, Porsche
 *    Taycan technology press kit 2019; electric.ts evMotorRatio), with an editable shift point.
 *  - Vmax: the electronic limiter can be raised up to what the rotor speed allows in the top gear
 *    (v = n_max / i · 2π/60 · r, electric.ts evRpmVmaxKmh); above that the motor speed limits.
 *  - Max. motor speed (#139): the rotor speed limit can be raised from the factory value up to 25 000 1/min with a
 *    carbon-fibre sleeve around the rotor (Tesla Plaid ≈ 20 000 1/min, Tesla Model S Plaid press release 2021;
 *    electric.md §6.1). Cost: ≈ 0.8 kg sleeve and stronger rotor per motor and 1000 1/min, the factory loss map
 *    (iron ∝ n^1.5, windage ∝ n³, electric-motor.ts lossRefRpm). Above it the motors stay in field weakening
 *    (power ∝ 1/n), so Vmax ends where the drive power meets the driving resistance (evTopSpeed) or at the rpm limit.
 *  - Stronger motors (#141, electric.md §6.2): size up to ×4 (≈ 1 MW per Plaid-based motor), motor type radial PMSM
 *    (≈ 7 kW/kg motor alone) or axial flux (≈ 17 kW/kg, ×1.3 torque at the same size, ≤ 10 000 1/min), motor
 *    cooling water jacket / stator oil spray / direct winding oil (heat removal ×1 / ×1.8 / ×2.6). Losses scale
 *    with the size (copper ∝ I², iron ∝ n^1.5), the inverter current with power / pack voltage (an 800 V pack halves
 *    the current of a 400 V design); at most INVERTER_MAX_A per SiC inverter.
 * At the top end (4 big motors, 200 kWh, 800 V, max current) the system reaches ≈ 3000 PS: the pack caps it.
 */
import {
  Drivetrain, EvSimulator, START_SOC, TYRE_TYPES, baseRpm, batteryLimits, defaultInputs, drivingResistanceN, electricPowerKw, evInGear, evPackKwh, evRefRatio, evRpmVmaxKmh,
  evSystemPowerKw, motorLossKw, motorMaxTorque, nominalV, packMassKg, packOcv, packResistance, currentForPower, stepMotorTemp, summarize, torqueAtCurrent,
  MOTOR_DERATE_C,
} from "../core/index.ts";
import type { CarSetup, EvBatteryConfig, EvChemistry, EvConfig, EvMotorConfig, SimInputs, TyreType } from "../core/index.ts";
import { defaultConfig } from "./presets.ts";

export const PS_PER_KW = 1000 / 735.49875;
export const DRIVE_UNIT_KG_PER_KW = 0.4;
export const INVERTER_MAX_A = 2500;
export const PACK_BUS_MAX_A = 3000;
/** Motors per axle (e.g. two per wheel); in all at most 2 × 4 = 8 [S]. */
export const MAX_MOTORS = 4;
export const MAX_MOTORS_TOTAL = 2 * MAX_MOTORS;
/** Carbon sleeve and stronger rotor per motor and 1000 1/min above the factory speed, kg (#139, electric.md §6.1). */
export const SLEEVE_KG_PER_KRPM = 0.8;

/** Motor type (#141, electric.md §6.2): motor-only power density, torque at the same size, rotor speed limit. */
export type EvMotorType = "radial" | "axial";
export const MOTOR_TYPES: Record<EvMotorType, { label: string; kwPerKg: number; torque: number; maxRpm: number }> = {
  radial: { label: "Radialfluss-PMSM (Serie)", kwPerKg: 7, torque: 1, maxRpm: Infinity },
  axial: { label: "Axialfluss (leichter, stärker, teurer)", kwPerKg: 17, torque: 1.3, maxRpm: 10000 },
};
/** Rest of a drive unit (inverter, gear, housing) per kW: 0.4 kg/kW in all with a radial motor (electric.md §6). */
export const DRIVE_UNIT_REST_KG_PER_KW = DRIVE_UNIT_KG_PER_KW - 1 / MOTOR_TYPES.radial.kwPerKg;
/** Motor cooling (#141, electric.md §6.2): heat removal relative to the water jacket, extra kg per motor (pump, oil). */
export type EvMotorCooling = "jacket" | "stator-oil" | "winding-oil";
export const MOTOR_COOLING: Record<EvMotorCooling, { label: string; ua: number; kg: number }> = {
  jacket: { label: "Wassermantel (Serie)", ua: 1, kg: 0 },
  "stator-oil": { label: "Stator-Ölsprühkühlung", ua: 1.8, kg: 3 },
  "winding-oil": { label: "Direkte Wicklungs-Ölkühlung", ua: 2.6, kg: 5 },
};

export type EvCooling = "serie" | "sport" | "track";
export const COOLING: Record<EvCooling, { label: string; battery: number; motor: number; kg: number }> = {
  serie: { label: "Serie", battery: 1, motor: 1, kg: 0 },
  sport: { label: "Sport (größerer Kühler)", battery: 2, motor: 1.5, kg: 10 },
  track: { label: "Rennstrecke (Chiller, großer Kühler)", battery: 3.5, motor: 2.5, kg: 25 },
};

/** Cell types (electric.md §3): cell, resistance, nominal voltage, pack-level energy density, C-rate limit. */
export const CELLS: Record<EvChemistry, { label: string; cellAh: number; rMOhm: number; vNom: number; kwhPerKg: number; maxC: number }> = {
  nmc: { label: "NMC (21700, Hochenergie)", cellAh: 5.0, rMOhm: 15, vNom: 3.7, kwhPerKg: 0.16, maxC: 12 },
  nca: { label: "NCA (18650, Hochleistung)", cellAh: 3.1, rMOhm: 20, vNom: 3.7, kwhPerKg: 0.155, maxC: 15 },
  lfp: { label: "LFP (Prismatisch, robust)", cellAh: 100, rMOhm: 0.6, vNom: 3.3, kwhPerKg: 0.125, maxC: 8 },
};

export interface EvTuning {
  frontMotors: number;
  rearMotors: number;
  /** Motor size relative to the car's own motors. */
  motorScale: number;
  /** Radial PMSM (factory) or axial flux (#141). */
  motorType: EvMotorType;
  /** Motor cooling: water jacket (factory), stator oil spray, direct winding oil (#141). */
  motorCooling: EvMotorCooling;
  /** Inverter current relative to the motors' design current. */
  currentScale: number;
  packKwh: number;
  chemistry: EvChemistry;
  /** Discharge C-rate of the cells. */
  cRate: number;
  /** 800 V class pack. */
  highVoltage: boolean;
  cooling: EvCooling;
  tyre: TyreType;
  /** Reduction: 1 or 2 gears (two-speed on the rear axle). */
  gears: number;
  /** First (or only) gear of the rear axle, motor : wheel. */
  firstRatio: number;
  secondRatio: number;
  /** Upshift speed of the two-speed reduction, km/h. */
  shiftKmh: number;
  /** Electronic Vmax limiter, km/h; null = off (the motors' rotor speed limits). */
  vmaxKmh: number | null;
  /** Rotor speed limit of the fastest motor, 1/min (the others scale with it); factory: the car's own (#139). */
  maxRpm: number;
}

export const TUNING_LIMITS = {
  frontMotors: { min: 0, max: MAX_MOTORS },
  rearMotors: { min: 0, max: MAX_MOTORS },
  motorScale: { min: 0.5, max: 4 },
  currentScale: { min: 0.5, max: 2 },
  packKwh: { min: 30, max: 200 },
  cRate: { min: 1, max: 15 },
  firstRatio: { min: 5, max: 18 },
  secondRatio: { min: 4, max: 12 },
  shiftKmh: { min: 40, max: 200 },
  vmaxKmh: { min: 100, max: 450 },
  maxRpm: { min: 10000, max: 25000 },
} as const;
/** Second gear is at least this much longer than first, ratio steps. */
const MIN_STEP = 1;

const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? (x < lo ? lo : x > hi ? hi : x) : lo);
const isChem = (v: unknown): v is EvChemistry => v === "nmc" || v === "nca" || v === "lfp";
const isMotorType = (v: unknown): v is EvMotorType => v === "radial" || v === "axial";
const isMotorCooling = (v: unknown): v is EvMotorCooling => typeof v === "string" && v in MOTOR_COOLING;
const isCooling = (v: unknown): v is EvCooling => v === "serie" || v === "sport" || v === "track";

/** The car as it left the factory, as tuning values. */
export function evTuningOf(ev: EvConfig, tyre: TyreType = "uhp", speedLimitKmh: number | null = null): EvTuning {
  const b = ev.battery;
  return {
    frontMotors: ev.motors.filter((m) => m.axle === "front").length,
    rearMotors: ev.motors.filter((m) => m.axle === "rear").length,
    motorScale: 1,
    motorType: "radial",
    motorCooling: "jacket",
    currentScale: 1,
    packKwh: Math.round(evPackKwh(ev)),
    chemistry: b.chemistry,
    cRate: b.maxDischargeC,
    highVoltage: b.seriesCells * 3.7 > 600,
    cooling: "serie",
    tyre,
    gears: ev.twoSpeed ? 2 : 1,
    firstRatio: evRefRatio(ev),
    // without a second gear: ≈ 8 : 1 like the Taycan, at least MIN_STEP longer than the first
    secondRatio: ev.twoSpeed?.secondRatio ?? Math.max(TUNING_LIMITS.secondRatio.min, Math.min(8, Math.round((evRefRatio(ev) - MIN_STEP) * 100) / 100)),
    shiftKmh: ev.twoSpeed?.shiftKmh ?? 100,
    vmaxKmh: speedLimitKmh,
    maxRpm: factoryRpm(ev),
  };
}

/** Rotor speed limit of the car's fastest motor, 1/min. */
function factoryRpm(ev: EvConfig): number {
  return Math.max(...ev.motors.map((m) => m.maxRpm));
}

/** Motor-count field the player just picked: validation keeps it and takes motors off the other axle. */
export type MotorAxleKey = "frontMotors" | "rearMotors";

/**
 * Any stored / typed value → valid tuning (unknown parts from `fallback`).
 * At most MAX_MOTORS per axle and MAX_MOTORS_TOTAL in all (with 4 per axle never reached); more: the axle in `keep` (the one just picked) stays, the other one gives way; without
 * `keep` the axle with more motors gives way.
 */
export function validTuning(raw: unknown, fallback: EvTuning, keep?: MotorAxleKey): EvTuning {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const L = TUNING_LIMITS;
  const n = (k: Exclude<keyof typeof L, "vmaxKmh">) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? clamp(r[k] as number, L[k].min, L[k].max) : fallback[k]);
  let front = Math.round(n("frontMotors"));
  let rear = Math.round(n("rearMotors"));
  if (front + rear < 1) keep === "rearMotors" ? (front = 1) : (rear = 1);
  if (keep === "frontMotors") rear = Math.min(rear, MAX_MOTORS_TOTAL - front);
  else if (keep === "rearMotors") front = Math.min(front, MAX_MOTORS_TOTAL - rear);
  while (front + rear > MAX_MOTORS_TOTAL) rear > front ? rear-- : front--;
  return {
    frontMotors: front, rearMotors: rear, motorScale: n("motorScale"),
    motorType: isMotorType(r.motorType) ? r.motorType : fallback.motorType,
    motorCooling: isMotorCooling(r.motorCooling) ? r.motorCooling : fallback.motorCooling,
    currentScale: n("currentScale"), packKwh: n("packKwh"),
    chemistry: isChem(r.chemistry) ? r.chemistry : fallback.chemistry, cRate: n("cRate"),
    highVoltage: typeof r.highVoltage === "boolean" ? r.highVoltage : fallback.highVoltage,
    cooling: isCooling(r.cooling) ? r.cooling : fallback.cooling,
    tyre: typeof r.tyre === "string" && r.tyre in TYRE_TYPES ? (r.tyre as TyreType) : fallback.tyre,
    gears: r.gears === 1 || r.gears === 2 ? r.gears : fallback.gears,
    firstRatio: n("firstRatio"),
    secondRatio: Math.min(n("secondRatio"), n("firstRatio") - MIN_STEP),
    shiftKmh: n("shiftKmh"),
    maxRpm: Math.round(n("maxRpm")),
    vmaxKmh: r.vmaxKmh === null ? null : typeof r.vmaxKmh === "number" && Number.isFinite(r.vmaxKmh) ? clamp(r.vmaxKmh, L.vmaxKmh.min, L.vmaxKmh.max) : fallback.vmaxKmh,
  };
}

export type PowerLimit = "battery" | "inverter" | "motor";

export interface TunedEv {
  ev: EvConfig;
  tuning: EvTuning;
  /** Mass change against the factory car (drive units, pack, cooling), kg. */
  deltaKg: number;
  systemKw: number;
  systemPs: number;
  /** Peak torque per motor and phase current per inverter. */
  motorNm: number;
  motorKw: number;
  inverterA: number;
  /** What caps the peak power: battery current (C-rate / contactors), inverter current, or the motors themselves. */
  limit: PowerLimit;
  /** German notes on what limits the setup. */
  notes: string[];
  /** Top speed the rotor speed allows in the highest gear, km/h. */
  rpmVmaxKmh: number;
  /** Sleeve mass for the raised rotor speed (part of deltaKg), kg. */
  sleeveKg: number;
  /** Governor to set, km/h; null = off (at or above the rotor speed limit). */
  governorKmh: number | null;
  /** What caps the top speed: the limiter or the motors' rotor speed. */
  vmaxBy: "governor" | "rpm";
  /** Continuous system power at the derating temperature (heat removal = losses), kW (#141). */
  continuousKw: number;
  /** Heat (copper + iron losses) of one motor at peak power, kW (#141). */
  heatKw: number;
}

export const LIMIT_LABEL: Record<PowerLimit | "traction", string> = {
  battery: "Akkustrom", inverter: "Wechselrichter", motor: "Motoren", traction: "Haftung",
};

/**
 * Continuous power of one motor, kW: the torque at base speed where the heat removal at the derating temperature
 * equals the losses (stepMotorTemp stays at MOTOR_DERATE_C; electric.md §2.4, §6.2).
 */
export function continuousMotorKw(m: EvMotorConfig, coolingScale: number): number {
  const nb = baseRpm(m);
  const drift = (x: number) => stepMotorTemp(m, MOTOR_DERATE_C, motorLossKw(m, nb, x * m.peakTorqueNm), 1, 25, coolingScale) - MOTOR_DERATE_C;
  if (drift(1) <= 0) return m.peakPowerKw;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const x = (lo + hi) / 2;
    drift(x) > 0 ? (hi = x) : (lo = x);
  }
  return lo * m.peakPowerKw;
}

/** Applies tuning to the car's factory configuration. */
export function tuneEv(base: EvConfig, tIn: EvTuning, wheelRadiusM = 0.35): TunedEv {
  const t = validTuning(tIn, evTuningOf(base, tIn.tyre));
  const notes: string[] = [];
  // pack first: its voltage sets the inverter current a motor needs (P ≈ U·I)
  // pack: the cell of the chosen type; series count from the voltage class, parallel count from the energy
  const b0 = base.battery;
  const cell = CELLS[t.chemistry];
  const sameCell = t.chemistry === b0.chemistry;
  const cellAh = sameCell ? b0.cellAh : cell.cellAh;
  const rMOhm = sameCell ? b0.cellResistanceMOhm : cell.rMOhm;
  // the car's own cell keeps its series count in its voltage class (×2 / ÷2 for the other one)
  const baseHv = b0.seriesCells * 3.7 > 600;
  const series = sameCell
    ? t.highVoltage === baseHv ? b0.seriesCells : t.highVoltage ? b0.seriesCells * 2 : Math.round(b0.seriesCells / 2)
    : Math.round((t.highVoltage ? 740 : 370) / cell.vNom);
  // the car's own cell scales its parallel count from the factory pack (an untouched tuner is the factory car);
  // another cell type is sized from its nominal voltage
  const baseKwh = Math.round(evPackKwh(base));
  const parallel = sameCell
    ? Math.max(1, Math.round((b0.parallelCells * (t.packKwh / baseKwh) * b0.seriesCells) / series))
    : Math.max(1, Math.round((t.packKwh * 1000) / (series * cell.vNom * cellAh)));
  const ah = parallel * cellAh;
  let c = t.cRate;
  if (c > cell.maxC) {
    c = cell.maxC;
    notes.push(`${t.chemistry.toUpperCase()}-Zellen vertragen höchstens ${cell.maxC} C.`);
  }
  let busCapped = false;
  if (c * ah > PACK_BUS_MAX_A) {
    c = PACK_BUS_MAX_A / ah;
    busCapped = true;
    notes.push(`Hochvolt-Schütze und Sicherung begrenzen den Akkustrom auf ${PACK_BUS_MAX_A} A${t.highVoltage ? "" : ": mehr Leistung nur mit 800 V"}.`);
  }
  const cool = COOLING[t.cooling];
  const mCool = MOTOR_COOLING[t.motorCooling];
  const type = MOTOR_TYPES[t.motorType];
  const energy = (series * parallel * cell.vNom * cellAh) / 1000;
  const battery: EvBatteryConfig = {
    chemistry: t.chemistry, seriesCells: series, parallelCells: parallel, cellAh, cellResistanceMOhm: rMOhm, maxDischargeC: c,
    maxChargeC: b0.maxChargeC, massKg: sameCell ? undefined : energy / cell.kwhPerKg, coolingWPerK: (b0.coolingWPerK ?? 400) * cool.battery,
  };
  // a motor wound for the tuned pack voltage needs current ∝ 1 / voltage for the same power (electric.md §6.2)
  const voltK = nominalV(b0) / nominalV(battery);
  let inverterCapped = false;
  let needA = 0;
  let rpmCapped = false;
  // rotor speed: every motor scales with the fastest one; a changed rotor keeps its factory loss map (lossRefRpm)
  const rpmK = t.maxRpm / factoryRpm(base);
  const tpl = (axle: EvMotorConfig["axle"]) => base.motors.find((m) => m.axle === axle) ?? base.motors[0]!;
  const build = (m: EvMotorConfig): EvMotorConfig => {
    const spun = rpmK === 1 ? m : { ...m, maxRpm: Math.round(m.maxRpm * rpmK), lossRefRpm: m.lossRefRpm ?? m.maxRpm };
    // axial flux: a new machine with its own loss map, the disc rotor caps the speed (electric.md §6.2)
    const typed = spun.maxRpm > type.maxRpm ? { ...spun, maxRpm: type.maxRpm, lossRefRpm: type.maxRpm } : spun;
    if (typed !== spun) rpmCapped = true;
    const k = t.motorScale * type.torque;
    const sized = { ...typed, peakTorqueNm: m.peakTorqueNm * k, peakPowerKw: m.peakPowerKw * k, inverterA: m.inverterA * k * voltK };
    let amps = sized.inverterA * t.currentScale;
    needA = Math.max(needA, amps);
    if (amps > INVERTER_MAX_A) {
      amps = INVERTER_MAX_A;
      inverterCapped = true;
    }
    // more current: torque with saturation, power at base speed in proportion (same voltage)
    const torque = torqueAtCurrent(sized, amps);
    return { ...sized, peakTorqueNm: torque, peakPowerKw: sized.peakPowerKw * (torque / sized.peakTorqueNm), inverterA: amps, rotorInertiaKgM2: undefined };
  };
  // the reduction: rear motors (all of them without a rear axle drive) carry the first gear
  const geared = t.rearMotors > 0 ? "rear" : "front";
  const motors: EvMotorConfig[] = [
    ...Array.from({ length: t.frontMotors }, () => build({ ...tpl("front"), axle: "front", ...(geared === "front" ? { ratio: t.firstRatio } : {}) })),
    ...Array.from({ length: t.rearMotors }, () => build({ ...tpl("rear"), axle: "rear", ratio: t.firstRatio })),
  ];
  if (inverterCapped) notes.push(`Wechselrichter am Limit: die Motoren bräuchten ${Math.round(needA)} A, ein SiC-Wechselrichter liefert höchstens ${INVERTER_MAX_A} A${t.highVoltage ? "" : " (800 V halbiert den Strom)"}.`);
  if (rpmCapped) notes.push(`Axialfluss-Scheibenläufer drehen höchstens ${type.maxRpm} 1/min: kürzere Untersetzung für Vmax.`);
  const ev: EvConfig = { ...base, motors, battery, coolingScale: cool.motor * mCool.ua, twoSpeed: t.gears === 2 ? { secondRatio: t.secondRatio, shiftKmh: t.shiftKmh } : undefined };
  if (!ev.twoSpeed) delete ev.twoSpeed;
  const rpmVmaxKmh = evRpmVmaxKmh(ev, wheelRadiusM);
  const governorKmh = t.vmaxKmh === null || t.vmaxKmh >= rpmVmaxKmh - 0.5 ? null : t.vmaxKmh;
  // drive unit: motor (power density of its type) + inverter / gear / housing; the factory motors are radial
  const unitKg = (ms: EvMotorConfig[], kwPerKg: number) => ms.reduce((a, m) => a + m.peakPowerKw * (DRIVE_UNIT_REST_KG_PER_KW + 1 / kwPerKg), 0);
  const sleeveKg = motors.reduce((a, m) => a + (SLEEVE_KG_PER_KRPM * Math.max(0, m.maxRpm - (m.lossRefRpm ?? m.maxRpm))) / 1000, 0);
  if (sleeveKg > 0) notes.push(`Rotoren mit Karbonhülse: +${Math.round(sleeveKg)} kg, mehr Eisen- und Luftreibungsverluste bei hoher Drehzahl.`);
  const deltaKg = unitKg(motors, type.kwPerKg) - unitKg(base.motors, MOTOR_TYPES.radial.kwPerKg) + packMassKg(battery) - packMassKg({ ...b0, massKg: undefined }) + cool.kg + mCool.kg * motors.length + sleeveKg;
  const systemKw = evSystemPowerKw(ev);
  const motorSum = motors.reduce((a, m) => a + m.peakPowerKw, 0);
  const limit: PowerLimit = systemKw < 0.97 * motorSum ? "battery" : inverterCapped ? "inverter" : "motor";
  if (limit === "battery" && !busCapped) notes.push("Der Akku begrenzt: größerer Akku, höhere C-Rate oder 800 V bringen mehr.");
  if (limit === "battery" && motorSum > 1.3 * systemKw) notes.push(`Die Motoren könnten ${Math.round(motorSum)} kW, der Akku liefert ${Math.round(systemKw)} kW.`);
  // copper + iron losses at peak power (base speed, peak torque) become heat in the motor
  const m0 = motors[0];
  const heatKw = m0 ? motorLossKw(m0, baseRpm(m0), m0.peakTorqueNm) : 0;
  const continuousKw = Math.min(systemKw, motors.reduce((a, m) => a + continuousMotorKw(m, ev.coolingScale ?? 1), 0));
  return {
    ev, tuning: t, deltaKg, systemKw, systemPs: systemKw * PS_PER_KW, motorNm: m0?.peakTorqueNm ?? 0, motorKw: m0?.peakPowerKw ?? 0,
    inverterA: m0?.inverterA ?? 0, limit, notes: [...new Set(notes)], rpmVmaxKmh, sleeveKg, governorKmh, vmaxBy: governorKmh === null ? "rpm" : "governor",
    continuousKw, heatKw,
  };
}

/** The strongest setup the limits allow ("Maximum"). */
export function maxTuning(tyre: TyreType = "semi-slick"): EvTuning {
  return { frontMotors: 2, rearMotors: 2, motorScale: TUNING_LIMITS.motorScale.max, motorType: "radial", motorCooling: "winding-oil", currentScale: 2, packKwh: 200, chemistry: "nca", cRate: 15, highVoltage: true, cooling: "track", tyre, gears: 2, firstRatio: 15, secondRatio: 8, shiftKmh: 100, vmaxKmh: null, maxRpm: TUNING_LIMITS.maxRpm.max };
}

export type VmaxBy = "governor" | "rpm" | "drag";
export const VMAX_BY_LABEL: Record<VmaxBy, string> = { governor: "Begrenzer", rpm: "Motordrehzahl", drag: "Luftwiderstand" };

/**
 * Highest speed at which the drive force still covers the driving resistance (air drag + rolling, traction.ts
 * drivingResistanceN), km/h. Steady state on the level: every motor at its envelope (field weakening, rpm fade, the
 * pack voltage under load sets the base speed), the DC power within the battery's discharge limit at the start SoC
 * (electric.md §2.1, §3.3, §6.1); the gear with the higher force where two exist.
 */
export function dragVmaxKmh(setup: CarSetup, tuned: TunedEv): number {
  const ev = tuned.ev;
  const r = setup.vehicle.wheelRadiusM;
  const veh = { ...setup.vehicle, massKg: setup.vehicle.massKg + tuned.deltaKg, rollingResistance: TYRE_TYPES[tuned.tuning.tyre].rollingResistance };
  const b = ev.battery;
  const bat = batteryLimits(b, START_SOC, 25).maxDischargeKw;
  const ocv = packOcv(b, START_SOC);
  const R = packResistance(b, 25);
  const vNom = nominalV(b);
  const aux = ev.auxKw ?? 0.4;
  const force = (kmh: number): number => {
    let best = 0;
    for (const g of ev.twoSpeed ? [1, 2] : [1]) {
      const ms = evInGear(ev, g).motors;
      const rpms = ms.map((m) => ((kmh / 3.6 / r) * m.ratio * 30) / Math.PI);
      if (ms.some((m, i) => rpms[i]! >= m.maxRpm)) continue;
      let vr = ocv / vNom;
      let f = 0;
      for (let it = 0; it < 4; it++) {
        const ts = ms.map((m, i) => motorMaxTorque(m, rpms[i]!, vr));
        const mech = ms.map((m, i) => (ts[i]! * rpms[i]! * Math.PI) / 30 / 1000);
        const dc = ms.reduce((a, m, i) => a + electricPowerKw(mech[i]!, motorLossKw(m, rpms[i]!, ts[i]!)), aux);
        const k = dc > bat ? Math.max(0, (bat - aux) / (dc - aux)) : 1;
        f = ms.reduce((a, m, i) => a + (k * ts[i]! * m.ratio * ev.gearEfficiency) / r, 0);
        vr = Math.min(1.3, Math.max(0.5, (ocv - currentForPower(ocv, R, Math.min(dc, bat)) * R) / vNom));
      }
      best = Math.max(best, f);
    }
    return best;
  };
  let kmh = 5;
  while (kmh < 1000 && force(kmh + 0.5) >= drivingResistanceN(veh, kmh + 0.5)) kmh += 0.5;
  return kmh;
}

/** Top speed of the tuned car and what caps it: the limiter, the rotor speed or drag against the drive power. */
export function evTopSpeed(setup: CarSetup, tuned: TunedEv): { kmh: number; by: VmaxBy } {
  const drag = dragVmaxKmh(setup, tuned);
  // the torque fades over the last 2 % of the rotor speed (electric-motor.ts): an equilibrium there is the rpm limit
  const free = drag < 0.98 * tuned.rpmVmaxKmh ? { kmh: drag, by: "drag" as const } : { kmh: Math.min(drag, tuned.rpmVmaxKmh), by: "rpm" as const };
  return tuned.governorKmh !== null && tuned.governorKmh < free.kmh ? { kmh: tuned.governorKmh, by: "governor" } : free;
}

export interface EvEstimate {
  /** Simulated 0–100 km/h, s (null: not reached within 20 s). */
  t100: number | null;
  /** Range at the rated consumption scaled for mass and rolling resistance, km. */
  rangeKm: number;
  /** Traction limits the launch (the motors could push harder than the tyres carry). */
  tractionLimited: boolean;
}

/**
 * Live estimate for the tuner: drives the tuned car (Plaid mode, traction control on, 60 Hz frames) to 100 km/h, and
 * the range from the rated consumption scaled for the mass and the tyre's rolling resistance (≈ 45 % of the
 * consumption is rolling resistance at WLTP speeds [S], electric.md §6).
 */
export function estimateEv(setup: CarSetup, tuned: TunedEv): EvEstimate {
  const it = estimateSteps(setup, tuned);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * The same estimate in slices (≈ 0.5 s of simulated driving per slice), so the UI can run it without blocking a
 * frame: `cancel()` stops it, `done` receives the result.
 */
export function estimateEvAsync(setup: CarSetup, tuned: TunedEv, done: (e: EvEstimate) => void): { cancel(): void } {
  const it = estimateSteps(setup, tuned);
  let stop = false;
  const slice = () => {
    if (stop) return;
    const r = it.next();
    if (r.done) done(r.value);
    else setTimeout(slice, 0);
  };
  setTimeout(slice, 0);
  return { cancel: () => (stop = true) };
}

function* estimateSteps(setup: CarSetup, tuned: TunedEv): Generator<void, EvEstimate, void> {
  const cfg = defaultConfig("petrol");
  const d = new Drivetrain(cfg, summarize(cfg));
  const tyre = { ...setup.tyre, type: tuned.tuning.tyre };
  d.applyCar({ ...setup, tyre, vehicle: { ...setup.vehicle, massKg: setup.vehicle.massKg + tuned.deltaKg }, ev: tuned.ev, speedLimitKmh: tuned.governorKmh });
  const sim = new EvSimulator(tuned.ev);
  const inp: SimInputs = { ...defaultInputs(), ignition: true, startWarm: true, dynoMode: "vehicle", evDriveMode: "plaid" };
  const h = 1 / 60;
  let traction = 0;
  // Ready at standstill first (the stopwatch starts from a standing, ready car)
  for (let i = 0; i < 10; i++) sim.step(h, { ...inp, vehicle: d.inputs(h, sim.state, 0, 1), pedal: 0 });
  for (let i = 0; i < 20 * 60 && d.state.t0to100S === null; i++) {
    const vehicle = d.inputs(h, sim.state, 1, 0);
    const s = sim.step(h, { ...inp, vehicle, pedal: d.effectivePedal(1) });
    if (s.ev?.limitedBy === "traction" && s.vehicleSpeedMs! < 15) traction++;
    if (i % 30 === 29) yield;
  }
  const rated = tuned.ev.ratedKwhPer100 ?? 18;
  const m0 = setup.vehicle.massKg;
  const fr0 = TYRE_TYPES[setup.tyre.type].rollingResistance;
  const fr = TYRE_TYPES[tuned.tuning.tyre].rollingResistance;
  const kwh100 = rated * (0.55 + (0.45 * (m0 + tuned.deltaKg) * fr) / (m0 * fr0));
  return { t100: d.state.t0to100S, rangeKm: (evPackKwh(tuned.ev) / kwh100) * 100, tractionLimited: traction > 20 };
}
