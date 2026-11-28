/**
 * Free drive swap (issue #154, docs/research/vehicle.md §13, contract #159): any drive into any vehicle body. A library vehicle is
 * split into its body (the factory mass minus the factory drive mass) and its drive; a new drive brings its own
 * mass, and the transmission is re-geared for the new rpm range, wheel and target speed. The factory setups in the
 * libraries stay untouched: the swap builds a new CarSetup.
 */
import { DEFAULT_TANK_L, DIESEL_FUELS, GEARBOXES, PETROL_FUELS, VEHICLES, evRpmVmaxKmh, evSystemPowerKw, packMassKg, speedRatingKmh, summarize } from "../core/index.ts";
import type { CarSetup, DriveLayout, DriveSpec, EngineConfig, EvConfig, VehicleParams } from "../core/index.ts";
import { libraryConfig } from "./engine-library.ts";
import { DRIVE_UNIT_KG_PER_KW } from "./ev-tuning.ts";
import { VEHICLE_LIBRARY, type LibraryCar } from "./vehicle-library.ts";

/** Engine periphery that leaves with the engine (radiator, exhaust line, mounts, starter, alternator), × dry mass [S, §13]. */
const ICE_PERIPHERY = 0.2;
/** Motorcycle engines (sequential gearbox in the crankcase, unit construction): small radiator and exhaust [S, §13]. */
const UNIT_PERIPHERY = 0.1;
/** Gearbox mass with oil: 8 kg + 0.1 kg per Nm of input torque [S, §13: MQ250 ≈ 40 kg, ZF 8HP70 ≈ 80 kg, TraXon ≈ 260 kg]. */
const gearboxKg = (peakNm: number) => 8 + 0.1 * peakNm;
/** Tank shell, pump and lines per litre [S, §13]; kerb weight counts the tank 90 % full (EU 1230/2012). */
const TANK_SHELL_KG_PER_L = 0.15;
const KERB_FUEL_SHARE = 0.9;
const AIR_KG_M3 = 1.2;
const G = 9.81;

const fuelDensity = (cfg: EngineConfig) =>
  cfg.fuelSystem.kind === "diesel" ? DIESEL_FUELS[cfg.fuelSystem.fuel].densityKgL : PETROL_FUELS[cfg.fuelSystem.fuel].densityKgL;

/** Mass of a drive, kg: engine + periphery + gearbox + tank (90 % full), and/or motors + inverters + battery. */
export function driveMassKg(d: DriveSpec): number {
  let m = d.extraKg ?? 0;
  if (d.engine) {
    const s = summarize(d.engine.config);
    const unit = d.engine.gearbox === "sequential";
    m += s.massKg * (1 + (unit ? UNIT_PERIPHERY : ICE_PERIPHERY)) + (unit ? 0 : gearboxKg(s.peakTorqueNm)) + d.engine.tankL * (TANK_SHELL_KG_PER_L + KERB_FUEL_SHARE * fuelDensity(d.engine.config));
  }
  // drive unit (motor, inverter, reduction) per kW as in the E-Tuner (electric.md §6), pack from battery.ts
  if (d.ev) m += d.ev.motors.reduce((a, x) => a + x.peakPowerKw * DRIVE_UNIT_KG_PER_KW, 0) + packMassKg(d.ev.battery);
  return m;
}

/** The drive a library vehicle leaves the factory with. */
export function factoryDrive(car: LibraryCar): DriveSpec {
  const s = car.setup;
  if (s.ev) return { ev: s.ev };
  const kind = s.kind ?? "car";
  return { engine: { config: libraryConfig(car.engineId), gearbox: s.gearbox, gearboxSpec: s.gearboxSpec ?? GEARBOXES[s.gearbox], tankL: s.tankL ?? DEFAULT_TANK_L[kind] } };
}

/** Body mass of a library vehicle (incl. driver, without drive), kg: factory mass minus the factory drive. */
export function bodyMassKg(car: LibraryCar): number {
  return car.setup.vehicle.massKg - driveMassKg(factoryDrive(car));
}

/** A combustion drive with the gearbox and tank of the car it came in (else the default gearbox of the body kind). */
export function engineDrive(config: EngineConfig, bodyKind: CarSetup["kind"] = "car"): DriveSpec {
  const donor = VEHICLE_LIBRARY.find((c) => c.engineId === config.id && !c.setup.ev);
  if (donor) return { engine: { ...factoryDrive(donor).engine!, config, refWheelRadiusM: donor.setup.vehicle.wheelRadiusM } };
  const p = VEHICLES[bodyKind ?? "car"];
  const gearbox = p.gearboxes[0]!;
  return { engine: { config, gearbox, gearboxSpec: { ...(p.gearboxSpec ?? GEARBOXES[gearbox]), finalDrive: p.finalDrive }, tankL: DEFAULT_TANK_L[bodyKind ?? "car"], refWheelRadiusM: p.params.wheelRadiusM } };
}

/**
 * Power-limited top speed on the level, km/h: P = (½ρ·cW·A·v² + m·g·f_R)·v solved by bisection (vehicle.md §1
 * driving resistance).
 */
export function powerVmaxKmh(v: VehicleParams, massKg: number, wheelKw: number): number {
  const p = (x: number) => (0.5 * AIR_KG_M3 * v.dragCoefficient * v.frontalAreaM2 * x * x + massKg * G * v.rollingResistance) * x;
  let lo = 0;
  let hi = 200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (p(mid) < wheelKw * 1000) lo = mid;
    else hi = mid;
  }
  return lo * 3.6;
}

/** Motor axles follow the body's driven axle(s): a motorcycle or a bus drives the rear, an FWD car the front. */
function onAxles(ev: EvConfig, layout: DriveLayout | undefined): EvConfig["motors"] {
  if (!layout || layout === "awd") return ev.motors.map((m) => ({ ...m }));
  return ev.motors.map((m) => ({ ...m, axle: layout === "fwd" ? "front" : "rear" }));
}

/**
 * Puts a drive into the body of a library vehicle (issue #154). Mass = body + drive (commercial vehicles keep their
 * payload). Target speed v_t = min(power-limited Vmax, the body's governor, the tyre's speed rating) (vehicle.md §13).
 * Combustion: the donor's ratios with the final drive scaled to the new wheel radius (same road speed per rpm, so
 * 1st gear keeps its launch); longer only where the limiter would cap the top gear below v_t. Electric: the rotor speed
 * limit at v_t (single-speed, a 2-speed reduction keeps its spread).
 */
export function withDrive(car: LibraryCar, drive: DriveSpec): CarSetup {
  return setupWithDrive(car.setup, bodyMassKg(car), drive);
}

/** withDrive for any setup with a known body mass (own vehicles: their entered mass minus the drive's). */
export function setupWithDrive(base: CarSetup, bodyKg: number, drive: DriveSpec): CarSetup {
  const v = base.vehicle;
  const massKg = bodyKg + driveMassKg(drive);
  const vehicle: VehicleParams = { ...v, massKg };
  const caps = [base.speedLimitKmh ?? Infinity, base.tyre.speedIndex === "(Y)" ? Infinity : speedRatingKmh(base.tyre.speedIndex)];
  const out: CarSetup = { ...structuredClone(base), vehicle, ev: undefined };
  if (base.fullMassKg !== undefined) out.fullMassKg = base.fullMassKg + massKg - v.massKg;
  if (drive.ev) {
    const ev = structuredClone(drive.ev);
    const ref = evSystemPowerKw(ev) * ev.gearEfficiency;
    const vt = Math.min(powerVmaxKmh(v, massKg, ref) * 1.05, ...caps);
    // factor on every reduction ratio: the reference motor reaches its speed limit at v_t on this wheel
    const k = evRpmVmaxKmh(ev, v.wheelRadiusM) / vt;
    ev.motors = onAxles(ev, v.driveLayout).map((m) => ({ ...m, ratio: m.ratio * k }));
    if (ev.twoSpeed) ev.twoSpeed = { secondRatio: ev.twoSpeed.secondRatio * k, shiftKmh: ev.twoSpeed.shiftKmh / k };
    out.ev = ev;
    out.gearbox = "dsg";
    out.gearboxSpec = { ratios: [1], finalDrive: ev.motors[0]!.ratio, efficiency: ev.gearEfficiency, shiftTimeS: 0 };
    delete out.tankL;
    return out;
  }
  const e = drive.engine!;
  const s = summarize(e.config);
  const spec = structuredClone(e.gearboxSpec);
  const vt = Math.min(powerVmaxKmh(v, massKg, s.peakPowerKw * spec.efficiency), ...caps);
  const top = spec.ratios[spec.ratios.length - 1]!;
  // the donor's gearing on the new wheel: same road speed per rpm (final drive × r_new / r_donor)
  const fd = spec.finalDrive * (v.wheelRadiusM / (e.refWheelRadiusM ?? v.wheelRadiusM));
  // only when the limiter would cap the top gear below v_t: longer, so the limiter falls at v_t (ω_wheel = v / r)
  const fdVmax = (e.config.revLimitRpm * Math.PI * v.wheelRadiusM) / (30 * (vt / 3.6) * top);
  spec.finalDrive = Math.min(20, Math.max(1, Math.min(fd, fdVmax)));
  out.gearbox = e.gearbox;
  out.gearboxSpec = spec;
  out.tankL = e.tankL;
  return out;
}
