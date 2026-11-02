// Switchable display units: a click on an instrument cycles through its units (e.g. kW → PS → hp).
// The physics stays in SI; only the shown number, the unit label and dial numerals change.
import type { EngineState } from "../core/index.ts";

export interface UnitOpt {
  unit: string;
  decimals: number;
  /** Base value (SI unit of the instrument) → shown value. May use the engine state (l/100 km needs speed). */
  conv: (v: number, s?: EngineState) => number;
}

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
  ] as UnitOpt[],
  bsfc: [lin("g/kWh", 1, 0), lin("g/PSh", 1 / 1.35962, 0)],
} as const;

const KEY = "pruefzelle.units";

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** Remembers the chosen unit per instrument (per viewer, best effort). */
export function savedUnit(id: string, count: number): number {
  const i = load()[id] ?? 0;
  return Number.isInteger(i) && i >= 0 && i < count ? i : 0;
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
