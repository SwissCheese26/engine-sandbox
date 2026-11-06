// Switchable display units: a click on an instrument cycles through its units (e.g. kW → PS → hp).
// The physics stays in SI; only the shown number, the unit label and dial numerals change.
// Since #24 the global unit choice (settings.ts) sets the default unit of every instrument; a click still
// overrides that one instrument. The shared conversions below are used by every panel that shows units.
import type { EngineState } from "../core/index.ts";
import { fmt } from "./format.ts";
import { prefs, type Quantity, type UnitPrefs } from "./settings.ts";

export interface UnitOpt {
  unit: string;
  decimals: number;
  /** Base value (SI unit of the instrument) → shown value. May use the engine state (l/100 km needs speed). */
  conv: (v: number, s?: EngineState) => number;
}

/** Conversion factors (exact or to 6 significant digits; NIST SP 811, US gallon = 3,785411784 l). */
export const CONV = {
  kwToPs: 1.35962,
  kwToHp: 1.34102,
  nmToLbft: 0.737562,
  nmToKpm: 0.101972,
  barToPsi: 14.5038,
  kmToMi: 0.621371,
  mmToIn: 1 / 25.4,
  lToCui: 61.0237,
  lPerGalUs: 3.785411784,
  /** mpg (US) = 235,215 / (l/100 km) */
  l100ToMpg: 235.215,
  /** 1 g/kWh = 0,001644 lb/(hp·h) */
  gkwhToLbhph: 0.00164399,
} as const;

const lin = (unit: string, k: number, decimals: number, off = 0): UnitOpt => ({ unit, decimals, conv: (v) => v * k + off });

/** Vehicle speed in km/h when driving on the chassis dyno, else 0. */
const kmh = (s?: EngineState) => (s?.vehicleSpeedMs ?? 0) * 3.6;

export const UNITS = {
  torque: [lin("Nm", 1, 0), lin("lb·ft", 0.737562, 0), lin("kpm", 0.101972, 1)],
  power: [lin("kW", 1, 0), lin("PS", 1.35962, 0), lin("hp", 1.34102, 0)],
  pressure: (decimals: number) => [lin("bar", 1, decimals), lin("psi", 14.5038, decimals > 1 ? 1 : 0), lin("kPa", 100, 0)],
  temp: [lin("°C", 1, 0), lin("°F", 1.8, 0, 32)],
  fuelFlow: [
    lin("l/h", 1, 1),
    // l/100 km and km/l need the vehicle moving (chassis dyno); below 5 km/h they show "–"
    { unit: "l/100 km", decimals: 1, conv: (v, s) => (kmh(s) > 5 ? (v / kmh(s)) * 100 : Number.NaN) },
    { unit: "km/l", decimals: 1, conv: (v, s) => (kmh(s) > 5 && v > 0.01 ? kmh(s) / v : Number.NaN) },
    // appended (#24) so stored per-instrument indices stay valid
    lin("gal/h", 1 / CONV.lPerGalUs, 2),
    { unit: "mpg", decimals: 1, conv: (v, s) => (kmh(s) > 5 && v > 0.01 ? (kmh(s) * CONV.kmToMi) / (v / CONV.lPerGalUs) : Number.NaN) },
  ] as UnitOpt[],
  bsfc: [lin("g/kWh", 1, 0), lin("g/PSh", 1 / CONV.kwToPs, 0), lin("lb/hph", CONV.gkwhToLbhph, 3)],
} as const;

/**
 * Base units: power kW, torque Nm, pressure bar, temperature °C, consumption l/100 km, speed km/h,
 * distance km, length mm, volume (displacement) l. Returns the value in `unit` (default: the global choice).
 */
export function toUnit(q: Quantity, base: number, unit: string = prefs()[q]): number {
  switch (unit) {
    case "PS": return base * CONV.kwToPs;
    case "hp": return base * CONV.kwToHp;
    case "lb·ft": return base * CONV.nmToLbft;
    case "kpm": return base * CONV.nmToKpm;
    case "psi": return base * CONV.barToPsi;
    case "kPa": return base * 100;
    case "°F": return base * 1.8 + 32;
    case "km/l": return base > 0 ? 100 / base : Number.NaN;
    case "mpg": return base > 0 ? CONV.l100ToMpg / base : Number.NaN;
    case "mph": return base * CONV.kmToMi;
    case "mi": return base * CONV.kmToMi;
    case "in": return base * CONV.mmToIn;
    case "cm³": return base * 1000;
    case "cui": return base * CONV.lToCui;
    default: return base; // base unit
  }
}

/** Inverse of toUnit for the linear quantities (e.g. a speed typed or chosen in mph → km/h). */
export function fromUnit(q: Quantity, shown: number, unit: string = prefs()[q]): number {
  if (unit === "km/l" || unit === "mpg") return toUnit(q, shown, unit); // reciprocal: its own inverse
  if (unit === "°F") return (shown - 32) / 1.8;
  const k = toUnit(q, 1, unit);
  return shown / k;
}

/** Decimals that suit a unit (whole numbers for power/torque/speed, finer for small units). */
const DECIMALS: Record<string, number> = { kpm: 1, bar: 2, psi: 1, kPa: 0, "l/100 km": 1, "km/l": 1, mpg: 1, km: 1, mi: 1, mm: 1, in: 2, l: 1, cui: 0 };

/** "150 PS", "6,5 l/100 km", "– mpg" (unknown value). */
export function fmtQ(q: Quantity, base: number, decimals?: number, unit: string = prefs()[q]): string {
  const v = toUnit(q, base, unit);
  return `${Number.isFinite(v) ? fmt(v, decimals ?? DECIMALS[unit] ?? 0) : "–"} ${unit}`;
}

/** The unit labels an instrument should start with under the global choice. */
export function instrumentDefaults(p: UnitPrefs): Set<string> {
  const bsfc = p.power === "PS" ? "g/PSh" : p.power === "hp" ? "lb/hph" : "g/kWh";
  return new Set([p.power, p.torque, p.pressure, p.temp, p.fuel === "mpg" ? "gal/h" : "l/h", bsfc]);
}

/** Index of the unit an instrument starts with when it has no own choice: the global default. */
export function defaultUnitIndex(units: readonly UnitOpt[], p: UnitPrefs = prefs()): number {
  const want = instrumentDefaults(p);
  const i = units.findIndex((u) => want.has(u.unit));
  return i < 0 ? 0 : i;
}

const KEY = "pruefzelle.units";

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** Unit index of an instrument: its own choice (click, #21) if any, else the global default (#24). */
export function savedUnit(id: string, units: readonly UnitOpt[]): number {
  const i = load()[id];
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < units.length ? i : defaultUnitIndex(units);
}

/** Drops every per-instrument choice: all instruments follow the global setting again. */
export function clearUnitOverrides() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function saveUnit(id: string, index: number) {
  try {
    const all = load();
    all[id] = index;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: choice lasts for this visit only */
  }
}

/** Makes an instrument element a keyboard/mouse target that cycles its unit. */
export function makeSwitchable(el: HTMLElement, label: string, onCycle: () => void) {
  el.classList.add("is-switchable");
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  // accessible name comes from the content (label, value, unit); the action is described separately
  el.title = `${label}: klicken, um die Einheit zu wechseln`;
  el.setAttribute("aria-roledescription", "Instrument, Einheit umschaltbar");
  el.addEventListener("click", onCycle);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (e.repeat) return;
      e.stopPropagation();
      onCycle();
    }
  });
}

/** Number of instruments with an own unit choice (shown on the settings screen). */
export function overrideCount(): number {
  return Object.keys(load()).length;
}
