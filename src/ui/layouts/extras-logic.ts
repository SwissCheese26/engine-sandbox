// Cockpit extras (#83), pure and DOM-free so they are unit-tested: the additional gauges of the console strip
// ("Zusatzinstrumente" like in a tuner car), the scales of the truck/bus design and the tuning bar. Everything shown
// here is a value the core reports or a value of the engine configuration; nothing is estimated in the UI.
import type { EngineConfig, EngineLimits, FuelKind, GearboxThermalSpec, WarningCode } from "../../core/index.ts";
import { fmt } from "../format.ts";
import type { UnitPrefs } from "../settings.ts";
import { toUnit } from "../units.ts";
import { GAUGE_IDS, type GaugeId } from "./designs.ts";
import { torqueAt, type CurvePoint } from "./logic.ts";

// ── additional gauges ────────────────────────────────────────────────────────────────────────────────────────────
// (ids, labels and validation live in designs.ts, next to the field ids, so settings.ts stays free of unit code)

/**
 * Boost only on charged engines; the gearbox oil only while a vehicle is on the dyno and the drivetrain reports its
 * temperature (#53, DrivetrainState.gearboxOilC); the others always.
 */
export function gaugeAvailable(id: GaugeId, c: { turbo: boolean; gearOil?: boolean }): boolean {
  if (id === "boost") return c.turbo;
  if (id === "gearOil") return !!c.gearOil;
  return true;
}

/** Toggles one gauge in a choice (kept in strip order). */
export function toggleGauge(list: readonly GaugeId[], id: GaugeId, on: boolean): GaugeId[] {
  return GAUGE_IDS.filter((g) => (g === id ? on : list.includes(g)));
}

export interface GaugeScale {
  /** Display units. */
  min: number;
  max: number;
  major: number;
  minor: number;
  /** Signal-yellow limit zone (display units), from the engine limits. */
  zone?: { from: number; to: number };
  /** Red zone (display units): the gearbox control unit's protection mode (or damage without one). */
  red?: { from: number; to: number };
}

/** Thresholds of the gearbox oil gauge: warning, TCU protection and damage of the gearbox kind (gearbox-thermal.ts). */
export type GearOilLimits = Pick<GearboxThermalSpec, "warnC" | "protectC" | "damageC">;

/** Scale of a gauge in display units. Limit zones come from EngineLimits (limits.ts), never from the UI. */
export function gaugeScale(id: GaugeId, lim: EngineLimits, fuel: FuelKind, u: UnitPrefs, gear?: GearOilLimits): GaugeScale {
  const T = (c: number) => toUnit("temp", c, u.temp);
  const P = (b: number) => toUnit("pressure", b, u.pressure);
  switch (id) {
    case "boost": {
      const top = P(Math.max(1, Math.ceil(lim.boostMaxBar * 1.25 * 2) / 2));
      return { min: 0, max: top, major: top / 2, minor: top / 4, zone: lim.boostMaxBar > 0 ? { from: P(lim.boostMaxBar), to: top } : undefined };
    }
    case "oilP": {
      const top = P(6);
      return { min: 0, max: top, major: top / 3, minor: top / 6, zone: { from: 0, to: P(lim.oilPressureMinBar) } };
    }
    case "oilT": {
      const a = T(50);
      const b = T(150);
      return { min: a, max: b, major: (b - a) / 4, minor: (b - a) / 8, zone: { from: T(Math.min(150, lim.oilMaxC)), to: b } };
    }
    case "gearOil": {
      // 40–160 °C: a warm gearbox runs at 80–95 °C (docs/research/vehicle.md §8); yellow from the warning threshold,
      // red from the TCU protection mode (manual gearboxes have none: red from the damage reference temperature)
      const a = T(40);
      const b = T(160);
      const scale: GaugeScale = { min: a, max: b, major: (b - a) / 4, minor: (b - a) / 12 };
      if (!gear) return scale;
      const redC = Math.min(160, gear.protectC ?? gear.damageC);
      return { ...scale, zone: { from: T(Math.min(160, gear.warnC)), to: T(redC) }, red: { from: T(redC), to: b } };
    }
    case "lambda":
      // petrol runs around λ 1 (rich at full load), a diesel always lean (smoke limit ≈ 1.15–1.6, idle far above)
      return fuel === "petrol" ? { min: 0.7, max: 1.3, major: 0.3, minor: 0.1 } : { min: 1, max: 4, major: 1, minor: 0.5 };
    case "egt": {
      const a = T(100);
      const b = T(1100);
      return { min: a, max: b, major: (b - a) / 5, minor: (b - a) / 10, zone: { from: T(Math.min(1100, lim.egtMaxC)), to: b } };
    }
  }
}

/** Raw values of the gauges (base units). */
export interface GaugeInputs {
  boostBar: number;
  oilPressureBar: number;
  oilC: number;
  lambda: number;
  egtC: number;
  /** Gearbox oil (#53), NaN/undefined without a vehicle. */
  gearboxOilC?: number;
}

/** Value of a gauge in display units (boost below ambient reads 0, like the gauge of a car). */
export function gaugeValue(id: GaugeId, v: GaugeInputs, u: UnitPrefs): number {
  switch (id) {
    case "boost": return toUnit("pressure", Math.max(0, v.boostBar), u.pressure);
    case "oilP": return toUnit("pressure", v.oilPressureBar, u.pressure);
    case "oilT": return toUnit("temp", v.oilC, u.temp);
    case "gearOil": return toUnit("temp", v.gearboxOilC ?? Number.NaN, u.temp);
    case "lambda": return v.lambda;
    case "egt": return toUnit("temp", v.egtC, u.temp);
  }
}

/** Share 0 … 1 of a value on its scale (bar gauges); NaN reads 0. */
export function gaugeFraction(v: number, s: { min: number; max: number }): number {
  if (!Number.isFinite(v) || !(s.max > s.min)) return 0;
  return Math.min(1, Math.max(0, (v - s.min) / (s.max - s.min)));
}

// ── truck / bus design ──────────────────────────────────────────────────────────────────────────────────────────

/** Speedometer of commercial vehicles: 0–125 km/h (0–80 mph), numerals every 20 (10) like a truck cluster. */
export function truckSpeedScale(unit: string): { max: number; major: number; minor: number } {
  return unit === "mph" ? { max: 80, major: 10, minor: 5 } : { max: 125, major: 20, minor: 5 };
}

/** Rev counter of commercial vehicles: up to the limiter + ≥ 300 rpm on a 500 step, numerals in hundreds (0 … 25). */
export function truckTachoScale(revLimitRpm: number): { max: number; major: number; minor: number; labelDiv: number } {
  const max = Math.max(2500, Math.ceil((revLimitRpm + 300) / 500) * 500);
  return { max, major: 500, minor: 100, labelDiv: 100 };
}

/**
 * Green economy band of a commercial-vehicle rev counter: the torque plateau of the full-load curve, where the engine
 * delivers at least `share` (95 %) of its peak torque. Truck diesels are specified this way (e.g. Scania DC16
 * "3300 Nm @ 950–1350", docs/research/commercial.md §2), and the green band of their clusters marks that range.
 * Rounded to 50 rpm; null without a curve.
 */
export function economyBand(curve: readonly CurvePoint[], share = 0.95): { from: number; to: number } | null {
  if (curve.length < 2) return null;
  const peak = Math.max(...curve.map((p) => p.torqueNm));
  if (!(peak > 0)) return null;
  const lo = curve[0]!.rpm;
  const hi = curve[curve.length - 1]!.rpm;
  let from = Number.NaN;
  let to = Number.NaN;
  for (let rpm = lo; rpm <= hi; rpm += 10) {
    if (torqueAt(curve, rpm) >= share * peak) {
      if (Number.isNaN(from)) from = rpm;
      to = rpm;
    } else if (!Number.isNaN(from)) break;
  }
  if (Number.isNaN(from) || to - from < 50) return null;
  return { from: Math.round(from / 50) * 50, to: Math.round(to / 50) * 50 };
}

export type BrakeState = "none" | "ready" | "active";

/**
 * Engine brake indicator (EngineConfig.engineBrake, EngineState.engineBrakeActive, issue #31). While it acts, the
 * braking power is the negative brake power of the state. A hydrodynamic retarder is not modelled
 * (docs/research/commercial.md §3), so there are no retarder stages.
 */
export function engineBrakeInfo(cfg: EngineConfig, active: boolean, powerKw: number, u: UnitPrefs): { state: BrakeState; kind: string; value: string } {
  const eb = cfg.engineBrake;
  if (!eb) return { state: "none", kind: "", value: "nicht verbaut" };
  const kind = eb.kind === "decompression" ? "Dekompressionsbremse" : "Auspuffklappe";
  if (!active) return { state: "ready", kind, value: "bereit" };
  return { state: "active", kind, value: `${fmt(toUnit("power", Math.max(0, -powerKw), u.power))} ${u.power}` };
}

// ── tuning bar ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface TuneItem {
  key: "boost" | "map" | "mix" | "knock" | "limit";
  label: string;
  value: string;
  /** Shown highlighted: the ECU limit acts right now. */
  active?: boolean;
  /** Signal colour: the core raises a warning for it (overboost, knock). */
  warn?: boolean;
}

export interface TuneInputs {
  boostBar: number;
  knock: number;
  torqueLimited?: boolean;
  warnings: readonly WarningCode[];
}

const signed = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmt(Math.abs(v), d)}`;

/**
 * The tuning bar: boost target (InductionConfig.boostTargetBar) vs actual, the calibration offsets of the ECU map
 * (ignition advance or start of injection relative to the calibrated map, full-load λ / smoke limit), knock (petrol)
 * and the ECU power/torque limit with its state (issues #18, #31). All from the config and the engine state.
 */
export function tuneItems(cfg: EngineConfig, s: TuneInputs, u: UnitPrefs): TuneItem[] {
  const out: TuneItem[] = [];
  const pd = u.pressure === "bar" ? 2 : 1;
  const P = (b: number) => fmt(toUnit("pressure", b, u.pressure), pd);
  if (cfg.induction.aspiration !== "naturally-aspirated") {
    out.push({ key: "boost", label: "Ladedruck Soll / Ist", value: `${P(cfg.induction.boostTargetBar)} / ${P(Math.max(0, s.boostBar))} ${u.pressure}`, warn: s.warnings.includes("overboost") });
  }
  const f = cfg.fuelSystem;
  if (f.kind === "petrol") {
    out.push({ key: "map", label: "Zündung zum Kennfeld", value: `${signed(f.ignitionAdvanceOffsetDeg)} °KW` });
    out.push({ key: "mix", label: "Vollast-λ", value: fmt(f.fullLoadLambda, 2) });
    out.push({ key: "knock", label: "Klopfen", value: `${fmt(Math.min(1, Math.max(0, s.knock)) * 100)} %`, warn: s.warnings.includes("knock") });
  } else {
    out.push({ key: "map", label: "Förderbeginn zum Kennfeld", value: `${signed(f.injectionTimingOffsetDeg)} °KW` });
    out.push({ key: "mix", label: "Rauchgrenze λ", value: fmt(f.smokeLimitLambda, 2) });
  }
  const parts: string[] = [];
  if (cfg.ecuPowerLimitKw !== undefined) parts.push(`${fmt(toUnit("power", cfg.ecuPowerLimitKw, u.power))} ${u.power}`);
  if (cfg.ecuTorqueLimitNm !== undefined) parts.push(`${fmt(toUnit("torque", cfg.ecuTorqueLimitNm, u.torque))} ${u.torque}`);
  const active = parts.length > 0 && !!s.torqueLimited;
  out.push({ key: "limit", label: "Leistungsgrenze", value: parts.length ? `${parts.join(" · ")}${active ? " · greift" : ""}` : "keine", active });
  return out;
}
