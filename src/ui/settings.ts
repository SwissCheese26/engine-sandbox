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
  /** Gas lever on the chassis dyno: "spring" = back to 0 when let go (pedal), "hold" = stays (hand throttle). */
  throttle: "spring" | "hold";
  /** Shift buttons (▲ gear ▼) in the bottom control bar: "auto" = on touch screens, "on" = always, "off" = never. */
  shiftPad: "auto" | "on" | "off";
  /** Gas key response (#66): seconds from 0 to 100 % (0 = instant full throttle). Also in the Bedienpult. */
  gasRamp: GasRamp;
  /** Start with a warm engine (#66). Also in the Bedienpult. */
  startWarm: boolean;
  /** Measure a full-load curve automatically after each engine change (#66). Also on the recorder. */
  autoMeasure: boolean;
  /** Side of the gas lever on touch screens (#66): "right" = brake left, gas right; "left" = mirrored. */
  pedalSide: "right" | "left";
  /** Keep the screen on while the engine runs (Screen Wake Lock API, #44/#66). */
  wakeLock: boolean;
  /** Vibration on limiter, ABS and engine damage (#44): "auto" = on touch screens, "on", "off". */
  vibration: "auto" | "on" | "off";
  /** Realism level (#66) → SimInputs.damage: "real", "lenient" (warnings only), "off" (sandbox, no damage). */
  realism: "real" | "lenient" | "off";
  /** Fuel prices in €/l for the cost in the board computer (#66). */
  fuelPrice: { diesel: number; petrol: number };
}

export type GasRamp = 0 | 1 | 3;
export const GAS_RAMPS: readonly { s: GasRamp; label: string }[] = [
  { s: 0, label: "Sofort Vollgas" },
  { s: 1, label: "Zügig (1 s)" },
  { s: 3, label: "Gefühlvoll (3 s)" },
];
export const REALISM: readonly { id: Settings["realism"]; label: string; hint: string }[] = [
  { id: "real", label: "Realistisch", hint: "Schäden, Überdrehen und Hitzetod: der Motor kann kaputtgehen." },
  { id: "lenient", label: "Nachsichtig", hint: "Warnungen und Verschleiß, aber der Motor geht nie kaputt." },
  { id: "off", label: "Sandbox", hint: "Keine Schäden und kein Verschleiß. Warnungen bleiben sichtbar." },
];
/** Allowed fuel price range, €/l. */
export const FUEL_PRICE_MIN = 0.1;
export const FUEL_PRICE_MAX = 10;

export const DEFAULT_SETTINGS: Settings = {
  preset: "metric-kw", custom: { ...METRIC }, layout: "pruefzelle", speedo: "standard", speedoCustomKmh: 240, throttle: "spring", shiftPad: "auto",
  gasRamp: 0, startWarm: false, autoMeasure: true, pedalSide: "right", wakeLock: true, vibration: "auto", realism: "real",
  fuelPrice: { diesel: 1.65, petrol: 1.75 },
};

/** A stored price, rounded to cents and clamped; anything else gives the fallback. */
export function clampFuelPrice(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.round(Math.min(FUEL_PRICE_MAX, Math.max(FUEL_PRICE_MIN, n)) * 100) / 100;
}

function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

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
  const throttle = r.throttle === "hold" ? "hold" : "spring";
  const shiftPad = r.shiftPad === "on" || r.shiftPad === "off" ? r.shiftPad : "auto";
  const d = DEFAULT_SETTINGS;
  const fp = (r.fuelPrice && typeof r.fuelPrice === "object" ? r.fuelPrice : {}) as Record<string, unknown>;
  return {
    preset, custom, layout, speedo, speedoCustomKmh: clampSpeedoKmh(r.speedoCustomKmh), throttle, shiftPad,
    gasRamp: oneOf(r.gasRamp, GAS_RAMPS.map((g) => g.s), d.gasRamp),
    startWarm: typeof r.startWarm === "boolean" ? r.startWarm : d.startWarm,
    autoMeasure: typeof r.autoMeasure === "boolean" ? r.autoMeasure : d.autoMeasure,
    pedalSide: oneOf(r.pedalSide, ["right", "left"] as const, d.pedalSide),
    wakeLock: typeof r.wakeLock === "boolean" ? r.wakeLock : d.wakeLock,
    vibration: oneOf(r.vibration, ["auto", "on", "off"] as const, d.vibration),
    realism: oneOf(r.realism, ["real", "lenient", "off"] as const, d.realism),
    fuelPrice: { diesel: clampFuelPrice(fp.diesel, d.fuelPrice.diesel), petrol: clampFuelPrice(fp.petrol, d.fuelPrice.petrol) },
  };
}

/** Keys of the Bedienpult/recorder before #66; their values move into the settings once. */
export const LEGACY_KEYS = { gasRamp: "pruefzelle.gasRamp", startWarm: "pruefzelle.startWarm", autoMeasure: "pruefzelle.autoMeasure" } as const;

/** Merges the pre-#66 single keys into raw settings (only where the settings lack the field). Pure for tests. */
export function migrateLegacy(raw: Record<string, unknown>, get: (key: string) => string | null): Record<string, unknown> {
  const out = { ...raw };
  const ramp = get(LEGACY_KEYS.gasRamp);
  if (!("gasRamp" in out) && ramp !== null) out.gasRamp = Number(ramp);
  const warm = get(LEGACY_KEYS.startWarm);
  if (!("startWarm" in out) && warm !== null) out.startWarm = warm === "1";
  const auto = get(LEGACY_KEYS.autoMeasure);
  if (!("autoMeasure" in out) && auto !== null) out.autoMeasure = auto !== "0";
  return out;
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
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      if (!st || !Object.values(LEGACY_KEYS).some((k) => st.getItem(k) !== null)) return validateSettings(obj);
      // one source of truth (#66): the old single keys go into the settings and are removed
      const s = validateSettings(migrateLegacy(obj, (k) => st.getItem(k)));
      st.setItem(SETTINGS_KEY, JSON.stringify(s));
      for (const k of Object.values(LEGACY_KEYS)) st.removeItem(k);
      return s;
    }
    // first visit with settings (#24): unit clicks from before #21 were chosen without a global default
    // and would hide the new setting, so they are dropped once; storing the settings marks it as done
    const s = validateSettings(st ? migrateLegacy({}, (k) => st.getItem(k)) : null);
    if (st) {
      for (const k of Object.values(LEGACY_KEYS)) st.removeItem(k);
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

/** "Nur Einstellungen zurücksetzen" (#66): back to the defaults, stored and announced like any change. */
export function resetSettings() {
  setSettings(DEFAULT_SETTINGS);
}

/** Every key this game stores in localStorage (prefix `pruefzelle.`). */
export const STORAGE_PREFIX = "pruefzelle.";

/** "Alles zurücksetzen" (#66): removes every `pruefzelle.*` key (engines, runs, board computer, settings…).
 *  Returns the number of removed keys. The caller reloads the page so no module keeps old state in memory. */
export function clearAllStorage(st: Pick<Storage, "length" | "key" | "removeItem"> | null = storage()): number {
  if (!st) return 0;
  const keys: string[] = [];
  for (let i = 0; i < st.length; i++) {
    const k = st.key(i);
    if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
  }
  for (const k of keys) st.removeItem(k);
  current = null;
  currentUnits = null;
  return keys.length;
}

/** Tests only: forget the cached settings so the next read loads them again. */
export function resetSettingsCache() {
  current = null;
  currentUnits = null;
}
