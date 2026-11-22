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
 * At the top end (4 big motors, 200 kWh, 800 V, max current) the system reaches ≈ 3000 PS.
 */
import { Drivetrain, EvSimulator, TYRE_TYPES, defaultInputs, evPackKwh, evRefRatio, evRpmVmaxKmh, evSystemPowerKw, packMassKg, summarize, torqueAtCurrent } from "../core/index.ts";
import type { CarSetup, EvBatteryConfig, EvChemistry, EvConfig, EvMotorConfig, SimInputs, TyreType } from "../core/index.ts";
import { defaultConfig } from "./presets.ts";

export const PS_PER_KW = 1000 / 735.49875;
export const DRIVE_UNIT_KG_PER_KW = 0.4;
export const INVERTER_MAX_A = 2500;
export const PACK_BUS_MAX_A = 3000;
export const MAX_MOTORS = 4;

export type EvCooling = "serie" | "sport" | "track";
export const COOLING: Record<EvCooling, { label: string; battery: number; motor: number; kg: number }> = {
  serie: { label: "Serie", battery: 1, motor: 1, kg: 0 },
  sport: { label: "Sport (größerer Kühler)", battery: 2, motor: 1.5, kg: 10 },
  track: { label: "Rennstrecke (Chiller, Ölsprühkühlung)", battery: 3.5, motor: 2.5, kg: 25 },
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
}

export const TUNING_LIMITS = {
  frontMotors: { min: 0, max: MAX_MOTORS },
  rearMotors: { min: 0, max: MAX_MOTORS },
  motorScale: { min: 0.5, max: 3 },
  currentScale: { min: 0.5, max: 2 },
  packKwh: { min: 30, max: 200 },
  cRate: { min: 1, max: 15 },
  firstRatio: { min: 5, max: 18 },
  secondRatio: { min: 4, max: 12 },
  shiftKmh: { min: 40, max: 200 },
  vmaxKmh: { min: 100, max: 450 },
} as const;
/** Second gear is at least this much longer than first, ratio steps. */
const MIN_STEP = 1;

const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? (x < lo ? lo : x > hi ? hi : x) : lo);
const isChem = (v: unknown): v is EvChemistry => v === "nmc" || v === "nca" || v === "lfp";
const isCooling = (v: unknown): v is EvCooling => v === "serie" || v === "sport" || v === "track";

/** The car as it left the factory, as tuning values. */
export function evTuningOf(ev: EvConfig, tyre: TyreType = "uhp", speedLimitKmh: number | null = null): EvTuning {
  const b = ev.battery;
  return {
    frontMotors: ev.motors.filter((m) => m.axle === "front").length,
    rearMotors: ev.motors.filter((m) => m.axle === "rear").length,
    motorScale: 1,
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
  };
}

/** Motor-count field the player just picked: validation keeps it and takes motors off the other axle. */
export type MotorAxleKey = "frontMotors" | "rearMotors";

/**
 * Any stored / typed value → valid tuning (unknown parts from `fallback`).
 * More than MAX_MOTORS in all: the axle in `keep` (the one just picked) stays, the other one gives way; without
 * `keep` the axle with more motors gives way.
 */
export function validTuning(raw: unknown, fallback: EvTuning, keep?: MotorAxleKey): EvTuning {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const L = TUNING_LIMITS;
  const n = (k: Exclude<keyof typeof L, "vmaxKmh">) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? clamp(r[k] as number, L[k].min, L[k].max) : fallback[k]);
  let front = Math.round(n("frontMotors"));
  let rear = Math.round(n("rearMotors"));
  if (front + rear < 1) keep === "rearMotors" ? (front = 1) : (rear = 1);
  if (keep === "frontMotors") rear = Math.min(rear, MAX_MOTORS - front);
  else if (keep === "rearMotors") front = Math.min(front, MAX_MOTORS - rear);
  while (front + rear > MAX_MOTORS) rear > front ? rear-- : front--;
  return {
    frontMotors: front, rearMotors: rear, motorScale: n("motorScale"), currentScale: n("currentScale"), packKwh: n("packKwh"),
    chemistry: isChem(r.chemistry) ? r.chemistry : fallback.chemistry, cRate: n("cRate"),
    highVoltage: typeof r.highVoltage === "boolean" ? r.highVoltage : fallback.highVoltage,
    cooling: isCooling(r.cooling) ? r.cooling : fallback.cooling,
    tyre: typeof r.tyre === "string" && r.tyre in TYRE_TYPES ? (r.tyre as TyreType) : fallback.tyre,
    gears: r.gears === 1 || r.gears === 2 ? r.gears : fallback.gears,
    firstRatio: n("firstRatio"),
    secondRatio: Math.min(n("secondRatio"), n("firstRatio") - MIN_STEP),
    shiftKmh: n("shiftKmh"),
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
  /** Governor to set, km/h; null = off (at or above the rotor speed limit). */
  governorKmh: number | null;
  /** What caps the top speed: the limiter or the motors' rotor speed. */
  vmaxBy: "governor" | "rpm";
}

export const LIMIT_LABEL: Record<PowerLimit | "traction", string> = {
  battery: "Akkustrom", inverter: "Wechselrichter", motor: "Motoren", traction: "Haftung",
};

/** Applies tuning to the car's factory configuration. */
export function tuneEv(base: EvConfig, tIn: EvTuning, wheelRadiusM = 0.35): TunedEv {
  const t = validTuning(tIn, evTuningOf(base, tIn.tyre));
  const notes: string[] = [];
  let inverterCapped = false;
  const tpl = (axle: EvMotorConfig["axle"]) => base.motors.find((m) => m.axle === axle) ?? base.motors[0]!;
  const build = (m: EvMotorConfig): EvMotorConfig => {
    const sized = { ...m, peakTorqueNm: m.peakTorqueNm * t.motorScale, peakPowerKw: m.peakPowerKw * t.motorScale, inverterA: m.inverterA * t.motorScale };
    let amps = sized.inverterA * t.currentScale;
    if (amps > INVERTER_MAX_A) {
      amps = INVERTER_MAX_A;
      inverterCapped = true;
      notes.push(`Wechselrichter am Limit: höchstens ${INVERTER_MAX_A} A je Motor.`);
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
  const energy = (series * parallel * cell.vNom * cellAh) / 1000;
  const battery: EvBatteryConfig = {
    chemistry: t.chemistry, seriesCells: series, parallelCells: parallel, cellAh, cellResistanceMOhm: rMOhm, maxDischargeC: c,
    maxChargeC: b0.maxChargeC, massKg: sameCell ? undefined : energy / cell.kwhPerKg, coolingWPerK: (b0.coolingWPerK ?? 400) * cool.battery,
  };
  const ev: EvConfig = { ...base, motors, battery, coolingScale: cool.motor, twoSpeed: t.gears === 2 ? { secondRatio: t.secondRatio, shiftKmh: t.shiftKmh } : undefined };
  if (!ev.twoSpeed) delete ev.twoSpeed;
  const rpmVmaxKmh = evRpmVmaxKmh(ev, wheelRadiusM);
  const governorKmh = t.vmaxKmh === null || t.vmaxKmh >= rpmVmaxKmh - 0.5 ? null : t.vmaxKmh;
  const motorKg = (ms: EvMotorConfig[]) => ms.reduce((a, m) => a + m.peakPowerKw * DRIVE_UNIT_KG_PER_KW, 0);
  const deltaKg = motorKg(motors) - motorKg(base.motors) + packMassKg(battery) - packMassKg({ ...b0, massKg: undefined }) + cool.kg;
  const systemKw = evSystemPowerKw(ev);
  const motorSum = motors.reduce((a, m) => a + m.peakPowerKw, 0);
  const limit: PowerLimit = systemKw < 0.97 * motorSum ? "battery" : inverterCapped ? "inverter" : "motor";
  if (limit === "battery" && !busCapped) notes.push("Der Akku begrenzt: größerer Akku, höhere C-Rate oder 800 V bringen mehr.");
  return {
    ev, tuning: t, deltaKg, systemKw, systemPs: systemKw * PS_PER_KW, motorNm: motors[0]?.peakTorqueNm ?? 0, motorKw: motors[0]?.peakPowerKw ?? 0,
    inverterA: motors[0]?.inverterA ?? 0, limit, notes: [...new Set(notes)], rpmVmaxKmh, governorKmh, vmaxBy: governorKmh === null ? "rpm" : "governor",
  };
}

/** The strongest setup the limits allow ("Maximum"). */
export function maxTuning(tyre: TyreType = "semi-slick"): EvTuning {
  return { frontMotors: 2, rearMotors: 2, motorScale: 3, currentScale: 2, packKwh: 200, chemistry: "nca", cRate: 15, highVoltage: true, cooling: "track", tyre, gears: 2, firstRatio: 15, secondRatio: 8, shiftKmh: 100, vmaxKmh: null };
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
