// Werkbank, Elektroantrieb (#108): declarative description of the E-Tuner values, rendered by ev-bench.ts with the
// same plates and field rows as the combustion-engine fields (fields.ts). Pure, no DOM; unit-tested.
// Limits and their physics: src/data/ev-tuning.ts (docs/research/electric.md §6).
import { TYRE_TYPES } from "../core/index.ts";
import type { EvChemistry, TyreType } from "../core/index.ts";
import { CELLS, COOLING, MAX_MOTORS, TUNING_LIMITS, validTuning, type EvCooling, type EvTuning } from "../data/ev-tuning.ts";

export type EvGroupId = "motors" | "drive" | "battery" | "chassis";

export const EV_GROUPS: { id: EvGroupId; title: string; effect: string }[] = [
  { id: "motors", title: "Elektromotoren", effect: "Mehr und größere Motoren bringen Leistung und Allrad-Traktion, aber auch Gewicht." },
  { id: "drive", title: "Getriebe und Vmax", effect: "Kurz übersetzt zieht stärker an, lang übersetzt dreht der Motor später in seine Drehzahlgrenze." },
  { id: "battery", title: "Akku", effect: "Energie bestimmt die Reichweite, Zelltyp, Entladerate und Spannung die Spitzenleistung." },
  { id: "chassis", title: "Kühlung und Reifen", effect: "Kühlung hält die Leistung bei Dauervolllast, Reifen bringen sie auf die Straße." },
];

const TYRES: TyreType[] = ["standard", "uhp", "semi-slick", "slick", "winter"];

interface Base {
  key: keyof EvTuning;
  group: EvGroupId;
  label: string;
  effect: string;
  /** Hidden when not applicable (e.g. second gear of a single-speed reduction). */
  visible?: (t: EvTuning) => boolean;
}
export interface EvNumberField extends Base {
  kind: "number";
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Display multiplier (100: factor 1.5 is shown as 150 %). */
  scale: number;
  decimals: number;
  /** The upper end is the rotor speed limit of the tuned car (Vmax limiter): the right stop means "off". */
  maxIsRpmLimit?: boolean;
}
export interface EvChoiceField extends Base {
  kind: "choice";
  options: { value: string; label: string }[];
}
export interface EvSelectField extends Base {
  kind: "select";
  options: { value: string; label: string }[];
}
export type EvField = EvNumberField | EvChoiceField | EvSelectField;

const L = TUNING_LIMITS;
const count = Array.from({ length: MAX_MOTORS + 1 }, (_, n) => ({ value: String(n), label: String(n) }));

export const EV_FIELDS: EvField[] = [
  { key: "frontMotors", group: "motors", kind: "choice", label: "Motoren vorn", options: count, effect: "Je Achse 0 bis 4 Motoren, zusammen 1 bis 4." },
  { key: "rearMotors", group: "motors", kind: "choice", label: "Motoren hinten", options: count, effect: "Hinten zieht beim Beschleunigen am besten, die Last wandert dorthin." },
  { key: "motorScale", group: "motors", kind: "number", label: "Motorgröße", unit: "%", min: L.motorScale.min, max: L.motorScale.max, step: 0.1, scale: 100, decimals: 0, effect: "+ Größe → mehr Drehmoment und Leistung je Motor, ≈ 0,4 kg je kW." },
  { key: "currentScale", group: "motors", kind: "number", label: "Wechselrichterstrom", unit: "%", min: L.currentScale.min, max: L.currentScale.max, step: 0.05, scale: 100, decimals: 0, effect: "+ Strom → mehr Moment, über dem Nennstrom sättigt das Eisen (höchstens 2500 A)." },
  { key: "gears", group: "drive", kind: "choice", label: "Gänge", options: [{ value: "1", label: "1-Gang" }, { value: "2", label: "2-Gang" }], effect: "2 Gänge wie bei Porsche Taycan und Audi e-tron GT (Hinterachse): kurzer 1. Gang zum Anfahren, langer 2. für Vmax." },
  { key: "firstRatio", group: "drive", kind: "number", label: "Untersetzung (1. Gang)", unit: ": 1", min: L.firstRatio.min, max: L.firstRatio.max, step: 0.05, scale: 1, decimals: 2, effect: "+ Untersetzung → mehr Zugkraft, aber die Motordrehzahl begrenzt früher. Taycan 1. Gang ≈ 15 : 1." },
  { key: "secondRatio", group: "drive", kind: "number", label: "2. Gang", unit: ": 1", min: L.secondRatio.min, max: L.secondRatio.max, step: 0.05, scale: 1, decimals: 2, visible: (t) => t.gears === 2, effect: "Taycan ≈ 8 : 1. Lang für Vmax; mindestens 1 kürzer als der 1. Gang." },
  { key: "shiftKmh", group: "drive", kind: "number", label: "Schaltpunkt", unit: "km/h", min: L.shiftKmh.min, max: L.shiftKmh.max, step: 5, scale: 1, decimals: 0, visible: (t) => t.gears === 2, effect: "Hochschalten bei diesem Tempo (spätestens an der Drehzahlgrenze), ≈ 0,25 s Zugkraftunterbrechung." },
  { key: "vmaxKmh", group: "drive", kind: "number", label: "Vmax-Begrenzer", unit: "km/h", min: L.vmaxKmh.min, max: L.vmaxKmh.max, step: 5, scale: 1, decimals: 0, maxIsRpmLimit: true, effect: "Am rechten Anschlag aus: dann begrenzt nur die Motordrehzahl." },
  { key: "packKwh", group: "battery", kind: "number", label: "Energie", unit: "kWh", min: L.packKwh.min, max: L.packKwh.max, step: 5, scale: 1, decimals: 0, effect: "+ Energie → mehr Reichweite und mehr Zellen parallel, aber schwerer." },
  { key: "chemistry", group: "battery", kind: "select", label: "Zelltyp", options: (Object.keys(CELLS) as EvChemistry[]).map((c) => ({ value: c, label: CELLS[c].label })), effect: "NMC speichert viel, NCA gibt viel Strom ab, LFP ist schwer und robust." },
  { key: "cRate", group: "battery", kind: "number", label: "Entladerate", unit: "C", min: L.cRate.min, max: L.cRate.max, step: 0.5, scale: 1, decimals: 1, effect: "Höchststrom als Vielfaches der Kapazität; der Zelltyp setzt die Grenze." },
  { key: "highVoltage", group: "battery", kind: "choice", label: "Spannung", options: [{ value: "0", label: "400 V" }, { value: "1", label: "800 V" }], effect: "Über ≈ 1 MW hilft nur 800 V: Schütze und Stromschienen tragen ≈ 3000 A." },
  { key: "cooling", group: "chassis", kind: "select", label: "Kühlung", options: (Object.keys(COOLING) as EvCooling[]).map((c) => ({ value: c, label: COOLING[c].label })), effect: "Größere Kühlung hält Akku und Motoren länger unter der Abregelgrenze." },
  { key: "tyre", group: "chassis", kind: "select", label: "Reifen", options: TYRES.map((t) => ({ value: t, label: TYRE_TYPES[t].label })), effect: "Mehr Haftung (μ) → weniger Schlupf beim Anfahren." },
];

/** Form value of a tuning entry (selects and segments carry strings, numbers are shown with their scale). */
export function formValue(f: EvField, t: EvTuning, rpmVmaxKmh = Infinity): string {
  const v = f.key === "vmaxKmh" && t.vmaxKmh === null ? Math.floor(Math.min(rpmVmaxKmh, L.vmaxKmh.max)) : t[f.key];
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return f.kind === "number" ? String(Math.round(v * f.scale * 100) / 100) : String(v);
  return String(v);
}

/**
 * Form values (key → string, numbers in their shown scale) → validated tuning (unknown parts from `fallback`).
 * A Vmax limiter at the rotor speed limit (`rpmVmaxKmh`) is off (null).
 */
export function readForm(values: Partial<Record<keyof EvTuning, string>>, fallback: EvTuning, rpmVmaxKmh = Infinity): EvTuning {
  const raw: Record<string, unknown> = {};
  for (const f of EV_FIELDS) {
    const s = values[f.key];
    if (s === undefined) continue;
    if (f.key === "highVoltage") raw[f.key] = s === "1";
    else if (f.kind === "select") raw[f.key] = s;
    else {
      const n = Number(s.replace(",", "."));
      if (!Number.isFinite(n)) continue;
      raw[f.key] = f.kind === "number" ? n / f.scale : n;
    }
  }
  if (typeof raw.vmaxKmh === "number" && raw.vmaxKmh >= Math.min(rpmVmaxKmh, L.vmaxKmh.max) - 2.5) raw.vmaxKmh = null;
  return validTuning(raw, fallback);
}

/** Battery consumption to show: the trip average (instantaneous values go negative while regenerating), never < 0. */
export function evConsumption(ev: { tripKwhPer100: number; kwhPer100: number }): number {
  const v = ev.tripKwhPer100;
  return Number.isFinite(v) ? Math.max(0, v) : Number.NaN;
}
