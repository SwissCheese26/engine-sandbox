// Global settings (issue #24): unit preset for the whole game. Stored per browser in localStorage
// (`pruefzelle.settings`), validated on load. No DOM here, so the module runs in unit tests.
import { clampSpeedoKmh, isSpeedoScale, type SpeedoScale } from "./layouts/logic.ts";

/** Quantities the player can choose a unit for. The physics stays SI; this is display only. */
export type Quantity = "power" | "torque" | "pressure" | "temp" | "fuel" | "speed" | "distance" | "length" | "volume";

export const QUANTITIES: readonly { q: Quantity; label: string; units: readonly string[] }[] = [
  { q: "power", label: "Leistung", units: ["kW", "PS", "hp"] },
  { q: "torque", label: "Drehmoment", units: ["Nm", "lb·ft", "kpm"] },
  { q: "pressure", label: "Druck", units: ["bar", "psi", "kPa"] },
  { q: "temp", label: "Temperatur", units: ["°C", "°F"] },
  { q: "fuel", label: "Verbrauch", units: ["l/100 km", "km/l", "mpg"] },
  { q: "speed", label: "Geschwindigkeit", units: ["km/h", "mph"] },
  { q: "distance", label: "Strecke", units: ["km", "mi"] },
  { q: "length", label: "Bohrung und Hub", units: ["mm", "in"] },
  { q: "volume", label: "Hubraum", units: ["cm³", "l", "cui"] },
];

export type UnitPrefs = Record<Quantity, string>;
export type PresetId = "metric-kw" | "metric-ps" | "imperial" | "custom";

const METRIC: UnitPrefs = {
  power: "kW", torque: "Nm", pressure: "bar", temp: "°C", fuel: "l/100 km", speed: "km/h", distance: "km", length: "mm", volume: "cm³",
};

export const PRESETS: Record<Exclude<PresetId, "custom">, { label: string; hint: string; units: UnitPrefs }> = {
  "metric-kw": { label: "Metrisch (kW)", hint: "kW, Nm, bar, °C, l/100 km, km/h", units: METRIC },
  "metric-ps": { label: "Metrisch (PS)", hint: "PS, Nm, bar, °C, l/100 km, km/h", units: { ...METRIC, power: "PS" } },
  imperial: {
    label: "Imperial",
    hint: "hp, lb·ft, psi, °F, mpg, mph",
    units: { power: "hp", torque: "lb·ft", pressure: "psi", temp: "°F", fuel: "mpg", speed: "mph", distance: "mi", length: "in", volume: "cui" },
  },
};

/** Sandbox views (#26). Only the display changes; the simulation and its data are shared. */
export type LayoutId = "pruefzelle" | "cockpit" | "race" | "compact";

export const LAYOUTS: readonly { id: LayoutId; label: string; hint: string }[] = [
  { id: "pruefzelle", label: "Prüfzelle", hint: "Schnittbild, Instrumententafel und Linienschreiber" },
  { id: "cockpit", label: "Cockpit", hint: "Kombiinstrument mit Tacho, Drehzahlmesser und Kontrollleuchten" },
  { id: "race", label: "Renn-Dash", hint: "Digitales Display mit Schaltblitz und großer Gangzahl" },
  { id: "compact", label: "Kompakt", hint: "Wenige große Werte, gut fürs Handy" },
];

export function isLayoutId(v: unknown): v is LayoutId {
  return typeof v === "string" && LAYOUTS.some((l) => l.id === v);
}

export interface Settings {
  preset: PresetId;
  /** Units of the custom preset (kept while another preset is active, so switching back restores them). */
  custom: UnitPrefs;
  /** View of the sandbox (#26). */
  layout: LayoutId;
  /** Full scale of the cockpit speedometer, and the value of the "Eigene" scale in km/h. */
  speedo: SpeedoScale;
  speedoCustomKmh: number;
}

export const DEFAULT_SETTINGS: Settings = { preset: "metric-kw", custom: { ...METRIC }, layout: "pruefzelle", speedo: "standard", speedoCustomKmh: 240 };

export const SETTINGS_KEY = "pruefzelle.settings";

/** Accepts anything (stored JSON may be old, edited or broken) and returns valid settings. */
export function validateSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const preset: PresetId = r.preset === "custom" || (typeof r.preset === "string" && r.preset in PRESETS) ? (r.preset as PresetId) : DEFAULT_SETTINGS.preset;
  const c = (r.custom && typeof r.custom === "object" ? r.custom : {}) as Record<string, unknown>;
  const custom = { ...METRIC };
  for (const { q, units } of QUANTITIES) {
    const v = c[q];
    if (typeof v === "string" && units.includes(v)) custom[q] = v;
  }
  const layout = isLayoutId(r.layout) ? r.layout : DEFAULT_SETTINGS.layout;
  const speedo = isSpeedoScale(r.speedo) ? r.speedo : DEFAULT_SETTINGS.speedo;
  return { preset, custom, layout, speedo, speedoCustomKmh: clampSpeedoKmh(r.speedoCustomKmh) };
}

/** The units in effect for these settings. */
export function unitsOf(s: Settings): UnitPrefs {
  return s.preset === "custom" ? { ...s.custom } : { ...PRESETS[s.preset].units };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Per-instrument unit choices (#21), owned by units.ts; named here for the one-time migration. */
export const UNIT_OVERRIDES_KEY = "pruefzelle.units";

export function loadSettings(): Settings {
  const st = storage();
  try {
    const raw = st?.getItem(SETTINGS_KEY);
    if (raw) return validateSettings(JSON.parse(raw));
    // first visit with settings (#24): unit clicks from before #21 were chosen without a global default
    // and would hide the new setting, so they are dropped once; storing the settings marks it as done
    const s = validateSettings(null);
    if (st) {
      st.removeItem(UNIT_OVERRIDES_KEY);
      st.setItem(SETTINGS_KEY, JSON.stringify(s));
    }
    return s;
  } catch {
    return validateSettings(null);
  }
}

let current: Settings | null = null;
let currentUnits: UnitPrefs | null = null;
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return (current ??= loadSettings());
}

/** Units in effect right now (the global choice; a single instrument may still override it). */
export function prefs(): UnitPrefs {
  // cached: read every frame by the live readouts
  return (currentUnits ??= unitsOf(getSettings()));
}

/** Stores the settings (best effort) and tells every listener. */
export function setSettings(s: Partial<Settings>) {
  current = validateSettings({ ...getSettings(), ...s });
  currentUnits = null;
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: setting lasts for this visit */
  }
  for (const fn of listeners) fn(current);
}

/** Calls fn after every change; returns the unsubscribe function. */
export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only: forget the cached settings so the next read loads them again. */
export function resetSettingsCache() {
  current = null;
  currentUnits = null;
}
