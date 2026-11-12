// Switchable fields of the digital cockpit design (#83): which values a field can show, how they read in the chosen
// units and the cycling order. Pure (no DOM), so the formatting is unit-tested.
import type { EngineLimits } from "../../core/index.ts";
import { fmt } from "../format.ts";
import type { UnitPrefs } from "../settings.ts";
import { CONV, toUnit } from "../units.ts";
import { FIELD_IDS, type FieldId } from "./designs.ts";

/** Everything a field may show, in base units (°C, bar, l/h, km/h, l, kW, Nm, m). NaN or null = not known. */
export interface FieldInputs {
  coolantC: number;
  oilC: number;
  oilPressureBar: number;
  boostBar: number;
  egtC: number;
  /** Intake (charge) air temperature; NaN until the engine state provides it. */
  intakeC: number;
  fuelFlowLh: number;
  speedKmh: number;
  running: boolean;
  /** Tank content (chassis dyno), NaN on the engine dyno. */
  tankLevelL: number;
  /** Average consumption of trip A, l/100 km (NaN while too short). */
  avgL100: number;
  powerKw: number;
  torqueNm: number;
  lambda: number;
  /** Altitude of the route (NaN on a fixed gradient) and the road gradient in %. */
  altitudeM: number;
  gradePct: number;
  t0to100S: number | null;
  t0to100Running: number | null;
  ambientC: number;
  /** Air-cooled engines read their cylinder-head temperature in the coolant field. */
  airCooled: boolean;
}

/** What the engine and the dyno can deliver; fields that cannot show anything are skipped while cycling. */
export interface FieldContext {
  turbo: boolean;
  vehicle: boolean;
  intakeKnown: boolean;
}

export function fieldAvailable(id: FieldId, c: FieldContext): boolean {
  switch (id) {
    case "boost": return c.turbo;
    case "intake": return c.intakeKnown;
    case "range":
    case "road":
    case "sprint": return c.vehicle;
    default: return true;
  }
}

/** Next (dir 1) or previous (dir −1) available field after `cur`; `cur` itself when nothing else is available. */
export function nextField(cur: FieldId, dir: 1 | -1, c: FieldContext): FieldId {
  const n = FIELD_IDS.length;
  const i0 = Math.max(0, FIELD_IDS.indexOf(cur));
  for (let k = 1; k < n; k++) {
    const id = FIELD_IDS[(((i0 + dir * k) % n) + n) % n]!;
    if (fieldAvailable(id, c)) return id;
  }
  return cur;
}

/** Remaining range from the tank and the trip average (board-computer style), km; NaN without an average. */
export function rangeKm(levelL: number, avgL100: number): number {
  return Number.isFinite(levelL) && Number.isFinite(avgL100) && avgL100 > 0 ? (Math.max(0, levelL) / avgL100) * 100 : Number.NaN;
}

export interface FieldText {
  label: string;
  value: string;
  unit: string;
  /** At or beyond a limit: shown in signal colour. */
  warn: boolean;
}

const NAMES: Record<FieldId, string> = {
  coolant: "Kühlmittel", oilT: "Öltemperatur", oilP: "Öldruck", boost: "Ladedruck", egt: "Abgastemperatur", intake: "Ansaugluft",
  fuelNow: "Verbrauch", range: "Reichweite", power: "Leistung", torque: "Drehmoment", lambda: "Lambda", road: "Höhe/Steigung",
  sprint: "0–100 km/h", ambient: "Außentemperatur",
};

/** Label of a field (no value), e.g. for the accessible name and the settings. */
export function fieldLabel(id: FieldId, u?: UnitPrefs, airCooled = false): string {
  if (id === "coolant" && airCooled) return "Zylinderkopf";
  // the stopwatch measures 0–100 km/h; in mph that is 0–62 mph
  if (id === "sprint" && u?.speed === "mph") return "0–62 mph";
  return NAMES[id];
}

const num = (v: number, d = 0) => (Number.isFinite(v) ? fmt(v, d) : "–");

/** Value, unit and limit flag of one field in the chosen units. */
export function formatField(id: FieldId, v: FieldInputs, u: UnitPrefs, lim?: Partial<EngineLimits>): FieldText {
  const label = fieldLabel(id, u, v.airCooled);
  const T = (c: number) => num(toUnit("temp", c, u.temp));
  const pd = u.pressure === "bar" ? 1 : 0;
  const P = (b: number, d = pd) => num(toUnit("pressure", b, u.pressure), d);
  const out = (value: string, unit: string, warn = false): FieldText => ({ label, value, unit, warn });
  switch (id) {
    case "coolant": return out(T(v.coolantC), u.temp, !v.airCooled && v.coolantC > (lim?.coolantMaxC ?? Infinity));
    case "oilT": return out(T(v.oilC), u.temp, v.oilC > (lim?.oilMaxC ?? Infinity));
    case "oilP": return out(P(v.oilPressureBar), u.pressure, v.running && v.oilPressureBar < (lim?.oilPressureMinBar ?? -Infinity));
    case "boost": return out(P(Math.max(0, v.boostBar), u.pressure === "bar" ? 2 : 1), u.pressure, (lim?.boostMaxBar ?? 0) > 0 && v.boostBar > lim!.boostMaxBar!);
    case "egt": return out(T(v.egtC), u.temp, v.egtC > (lim?.egtMaxC ?? Infinity));
    case "intake": return out(T(v.intakeC), u.temp);
    case "ambient": return out(T(v.ambientC), u.temp);
    case "fuelNow": {
      // per distance while driving, per hour at standstill (like a real board computer)
      if (v.speedKmh > 5) {
        const l100 = v.running ? (v.fuelFlowLh / v.speedKmh) * 100 : Number.NaN;
        return out(num(toUnit("fuel", l100, u.fuel), 1), u.fuel);
      }
      const gal = u.fuel === "mpg";
      return out(num(gal ? v.fuelFlowLh / CONV.lPerGalUs : v.fuelFlowLh, gal ? 2 : 1), gal ? "gal/h" : "l/h");
    }
    case "range": return out(num(toUnit("distance", rangeKm(v.tankLevelL, v.avgL100), u.distance)), u.distance);
    case "power": return out(num(toUnit("power", Math.max(0, v.powerKw), u.power)), u.power);
    case "torque": return out(num(toUnit("torque", v.torqueNm, u.torque)), u.torque);
    case "lambda": return out(num(v.lambda, 2), "λ");
    case "road": {
      const g = Math.abs(v.gradePct) < 0.05 ? "0" : `${v.gradePct > 0 ? "+" : "−"}${fmt(Math.abs(v.gradePct), 1)}`;
      if (!Number.isFinite(v.altitudeM)) return out(g, "%");
      const alt = u.distance === "mi" ? `${fmt(v.altitudeM * 3.28084)} ft` : `${fmt(v.altitudeM)} m`;
      return out(alt.split(" ")[0]!, `${alt.split(" ")[1]} · ${g} %`);
    }
    case "sprint": {
      const run = v.t0to100Running;
      return out(run !== null ? fmt(run, 1) : v.t0to100S !== null ? fmt(v.t0to100S, 2) : "–", "s");
    }
  }
}

/** Accessible name of a field button: "Feld 1: Öltemperatur 92 °C – antippen zum Wechseln". */
export function fieldAriaLabel(slot: number, t: FieldText): string {
  const val = t.value === "–" ? "kein Wert" : `${t.value} ${t.unit}`;
  return `Feld ${slot + 1}: ${t.label} ${val} – antippen zum Wechseln`;
}

/** Drive-mode word of the sport-saloon display, from the gas response (#66): instant = Sport. */
export function driveModeWord(gasRampS: number): string {
  return gasRampS === 0 ? "Sport" : gasRampS === 1 ? "Normal" : "Eco";
}
