// Declarative description of every EngineConfig parameter shown on the workbench. Pure, no DOM.
// The workbench renders this list; tests check that every config leaf is covered.
import type { CylinderLayout, EngineConfig, WarningCode } from "../core/index.ts";
import { clamp, snap } from "./format.ts";

export type GroupId = "block" | "head" | "mixture" | "induction" | "exhaust" | "cooling" | "limits";

export const GROUPS: { id: GroupId; title: string; effect: string }[] = [
  { id: "block", title: "Block", effect: "Bohrung, Hub und Zylinderzahl bestimmen Hubraum und Drehzahlfestigkeit." },
  { id: "head", title: "Zylinderkopf", effect: "Ventiltrieb und Nocke verschieben das Drehmoment nach unten oder oben." },
  { id: "mixture", title: "Gemischbildung", effect: "Einspritzung und Gemisch entscheiden über Leistung, Verbrauch und Klopfen bzw. Ruß." },
  { id: "induction", title: "Aufladung", effect: "Mehr Ladedruck bringt mehr Luft, aber auch mehr Hitze und Spitzendruck." },
  { id: "exhaust", title: "Abgas", effect: "Abgasreinigung kostet Gegendruck, ein langer Krümmer bringt Drehmoment." },
  { id: "cooling", title: "Kühlung", effect: "Der Kühler hält bei Dauervolllast die Temperaturen im Rahmen." },
  { id: "limits", title: "Grenzen", effect: "Begrenzer und Leerlauf legen fest, in welchem Band der Motor arbeitet." },
];

export interface Option {
  value: string;
  label: string;
}

interface FieldBase {
  /** Dotted path into EngineConfig, e.g. "block.boreMm". */
  path: string;
  group: GroupId;
  label: string;
  /** Short effect line: "+ Verdichtung → besserer Wirkungsgrad, höherer Spitzendruck". */
  effect: string;
  /** Hidden when not applicable to the current config. */
  visible?: (cfg: EngineConfig) => boolean;
  /** Warning codes from validateConfig / state that concern this field. */
  warns?: WarningCode[];
}

export interface NumberField extends FieldBase {
  kind: "number";
  unit: string;
  decimals: number;
  range: (cfg: EngineConfig) => { min: number; max: number; step: number };
  /** Display multiplier (e.g. 100 to show 0…1 as %). */
  scale?: number;
}

export interface ChoiceNumberField extends FieldBase {
  kind: "choice-number";
  unit: string;
  values: (cfg: EngineConfig) => number[];
}

export interface SelectField extends FieldBase {
  kind: "select";
  options: (cfg: EngineConfig) => Option[];
}

export interface ToggleField extends FieldBase {
  kind: "toggle";
}

export interface TextField extends FieldBase {
  kind: "text";
}

export type Field = NumberField | ChoiceNumberField | SelectField | ToggleField | TextField;

const isDiesel = (c: EngineConfig) => c.fuel === "diesel";
const isPetrol = (c: EngineConfig) => c.fuel === "petrol";
const isCharged = (c: EngineConfig) => c.induction.aspiration !== "naturally-aspirated";
const hasTurbine = (c: EngineConfig) =>
  ["turbo", "twin-turbo-parallel", "twin-turbo-sequential", "e-turbo"].includes(c.induction.aspiration);
const hasCompressorWheel = (c: EngineConfig) => hasTurbine(c) || c.induction.aspiration === "supercharger-centrifugal";

/** Cylinder counts that are mechanically sensible for a layout. */
export function cylinderOptions(layout: CylinderLayout): number[] {
  switch (layout) {
    case "inline":
      return [1, 2, 3, 4, 5, 6, 8];
    case "boxer":
      return [2, 4, 6, 8, 10, 12, 16];
    case "v":
      return [4, 6, 8, 10, 12, 16];
    case "w":
      return [8, 12, 16];
    case "vr":
      return [5, 6];
  }
}

/** Allowed bank angle range per layout. W: angle between the two VR banks (VR angle itself fixed at 15°). */
export function bankAngleRange(layout: CylinderLayout): { min: number; max: number; step: number } {
  switch (layout) {
    case "v":
      return { min: 45, max: 135, step: 1 };
    case "vr":
      return { min: 10, max: 20, step: 0.5 };
    case "w":
      return { min: 60, max: 90, step: 1 };
    default:
      return { min: 0, max: 0, step: 1 };
  }
}

/** Typical bank angle when a layout / cylinder count is chosen. */
export function defaultBankAngle(layout: CylinderLayout, cylinders: number): number {
  switch (layout) {
    case "v":
      return cylinders === 6 || cylinders === 12 ? 60 : cylinders === 10 ? 72 : 90;
    case "vr":
      return 15;
    case "w":
      return 72;
    case "boxer":
      return 180;
    default:
      return 0;
  }
}

export function valveOptions(valvetrain: EngineConfig["head"]["valvetrain"]): number[] {
  if (valvetrain === "ohv") return [2];
  if (valvetrain === "sohc") return [2, 3, 4];
  return [2, 4, 5];
}

export function variableTimingOptions(valvetrain: EngineConfig["head"]["valvetrain"]): Option[] {
  const all: Option[] = [
    { value: "none", label: "Ohne" },
    { value: "intake-cam", label: "Einlassnocke verstellbar" },
    { value: "dual-cam", label: "Ein- und Auslass verstellbar" },
    { value: "cam-switching", label: "Nockenumschaltung" },
  ];
  if (valvetrain === "ohv") return all.filter((o) => o.value === "none" || o.value === "cam-switching");
  if (valvetrain === "sohc") return all.filter((o) => o.value !== "dual-cam");
  return all;
}

export function injectionPressureRange(cfg: EngineConfig): { min: number; max: number; step: number } {
  if (cfg.fuelSystem.kind === "diesel" && cfg.fuelSystem.injection === "unit-injector") return { min: 1000, max: 2200, step: 50 };
  return { min: 800, max: 2700, step: 50 };
}

export const FIELDS: Field[] = [
  // ── Block ───────────────────────────────────────────────────────────────
  { kind: "text", path: "name", group: "block", label: "Bezeichnung", effect: "Steht auf dem Typenschild. Ohne eigenen Namen folgt er der Konfiguration." },
  {
    kind: "select", path: "block.layout", group: "block", label: "Anordnung",
    effect: "Bestimmt Baulänge, Laufruhe und Zündabstände.",
    options: () => [
      { value: "inline", label: "Reihe" },
      { value: "v", label: "V" },
      { value: "boxer", label: "Boxer" },
      { value: "vr", label: "VR (enger V)" },
      { value: "w", label: "W" },
    ],
  },
  {
    kind: "choice-number", path: "block.cylinders", group: "block", label: "Zylinder", unit: "",
    effect: "+ Zylinder → mehr Hubraum und Laufruhe, mehr Reibung und Gewicht.",
    values: (c) => cylinderOptions(c.block.layout),
  },
  {
    kind: "number", path: "block.bankAngleDeg", group: "block", label: "Bankwinkel", unit: "°", decimals: 1,
    effect: "Passender Winkel → gleichmäßige Zündabstände, weniger Vibration.",
    visible: (c) => ["v", "vr", "w"].includes(c.block.layout),
    range: (c) => bankAngleRange(c.block.layout),
  },
  {
    kind: "select", path: "block.v8Crank", group: "block", label: "Kurbelwelle V8",
    effect: "Crossplane → tiefes Blubbern. Flatplane → hell, drehfreudig, mehr Vibration.",
    visible: (c) => c.block.layout === "v" && c.block.cylinders === 8,
    options: () => [
      { value: "crossplane", label: "Crossplane (90°)" },
      { value: "flatplane", label: "Flatplane (180°)" },
    ],
  },
  {
    kind: "number", path: "block.boreMm", group: "block", label: "Bohrung", unit: "mm", decimals: 1,
    effect: "+ Bohrung → mehr Hubraum, Platz für größere Ventile.",
    range: () => ({ min: 50, max: 140, step: 0.5 }),
  },
  {
    kind: "number", path: "block.strokeMm", group: "block", label: "Hub", unit: "mm", decimals: 1,
    effect: "+ Hub → mehr Drehmoment, höhere Kolbengeschwindigkeit.",
    warns: ["piston-speed"],
    range: () => ({ min: 50, max: 160, step: 0.5 }),
  },
  {
    kind: "number", path: "block.conrodLengthMm", group: "block", label: "Pleuellänge", unit: "mm", decimals: 0,
    effect: "+ Pleuel → weniger Seitenkraft am Kolben, höherer Block.",
    warns: ["conrod-stress"],
    range: () => ({ min: 90, max: 300, step: 1 }),
  },
  {
    kind: "number", path: "block.compressionRatio", group: "block", label: "Verdichtung", unit: ": 1", decimals: 1,
    effect: "+ Verdichtung → besserer Wirkungsgrad, höherer Spitzendruck.",
    warns: ["peak-pressure", "knock"],
    range: (c) => (isDiesel(c) ? { min: 14, max: 23, step: 0.1 } : { min: 8, max: 14, step: 0.1 }),
  },
  {
    kind: "select", path: "block.blockMaterial", group: "block", label: "Blockwerkstoff",
    effect: "Aluminium spart Gewicht, Guss verträgt mehr Spitzendruck.",
    warns: ["peak-pressure"],
    options: () => [
      { value: "cast-iron", label: "Grauguss" },
      { value: "compacted-graphite-iron", label: "Vermiculargraphitguss (GJV)" },
      { value: "aluminium", label: "Aluminium" },
    ],
  },
  {
    kind: "select", path: "block.crankshaft", group: "block", label: "Kurbelwelle",
    effect: "Geschmiedet oder gefräst → höhere Drehzahl- und Lastgrenze.",
    options: () => [
      { value: "cast", label: "Gegossen" },
      { value: "forged", label: "Geschmiedet" },
      { value: "billet", label: "Aus dem Vollen gefräst" },
    ],
  },
  {
    kind: "select", path: "block.pistons", group: "block", label: "Kolben",
    effect: "Geschmiedet oder Stahl → mehr Reserve bei Spitzendruck und Klopfen.",
    warns: ["peak-pressure"],
    options: () => [
      { value: "cast-aluminium", label: "Aluminium gegossen" },
      { value: "forged-aluminium", label: "Aluminium geschmiedet" },
      { value: "steel", label: "Stahl" },
    ],
  },
  {
    kind: "select", path: "block.conrods", group: "block", label: "Pleuel",
    effect: "Leichtere, festere Pleuel → höhere Drehzahlgrenze.",
    warns: ["conrod-stress"],
    options: () => [
      { value: "cast-steel", label: "Stahl gegossen" },
      { value: "forged-steel", label: "Stahl geschmiedet" },
      { value: "titanium", label: "Titan" },
    ],
  },
  // ── Zylinderkopf ─────────────────────────────────────────────────────────
  {
    kind: "select", path: "head.valvetrain", group: "head", label: "Ventiltrieb",
    effect: "Obenliegende Nockenwellen → höhere Drehzahl ohne Ventilflattern.",
    warns: ["valve-float"],
    options: () => [
      { value: "ohv", label: "OHV (untenliegende Nockenwelle)" },
      { value: "sohc", label: "SOHC (eine obenliegende)" },
      { value: "dohc", label: "DOHC (zwei obenliegende)" },
    ],
  },
  {
    kind: "choice-number", path: "head.valvesPerCylinder", group: "head", label: "Ventile je Zylinder", unit: "",
    effect: "+ Ventile → besserer Gaswechsel bei hoher Drehzahl.",
    values: (c) => valveOptions(c.head.valvetrain),
  },
  {
    kind: "number", path: "head.camProfile", group: "head", label: "Nockenprofil", unit: "%", decimals: 0, scale: 100,
    effect: "Zahm → Drehmoment unten, ruhiger Leerlauf. Scharf → Leistung oben.",
    range: () => ({ min: 0, max: 1, step: 0.05 }),
  },
  {
    kind: "select", path: "head.variableTiming", group: "head", label: "Nockenverstellung",
    effect: "Verstellung verbreitert das nutzbare Drehzahlband.",
    options: (c) => variableTimingOptions(c.head.valvetrain),
  },
  // ── Gemischbildung ───────────────────────────────────────────────────────
  {
    kind: "select", path: "fuelSystem.injection", group: "mixture", label: "Einspritzung",
    effect: "Common Rail → feiner Strahl, sauber und leise. Vorkammer → robust, laut.",
    visible: isDiesel,
    options: () => [
      { value: "indirect-prechamber", label: "Vorkammer" },
      { value: "indirect-swirl-chamber", label: "Wirbelkammer" },
      { value: "unit-injector", label: "Pumpe-Düse" },
      { value: "common-rail", label: "Common Rail" },
    ],
  },
  {
    kind: "number", path: "fuelSystem.injectionPressureBar", group: "mixture", label: "Einspritzdruck", unit: "bar", decimals: 0,
    effect: "+ Druck → feinere Zerstäubung, weniger Ruß, mehr Leistung.",
    visible: (c) => c.fuelSystem.kind === "diesel" && (c.fuelSystem.injection === "common-rail" || c.fuelSystem.injection === "unit-injector"),
    range: injectionPressureRange,
  },
  {
    kind: "select", path: "fuelSystem.fuel", group: "mixture", label: "Kraftstoff",
    effect: "Höhere Oktanzahl erlaubt mehr Frühzündung ohne Klopfen.",
    visible: isPetrol, warns: ["knock"],
    options: () => [
      { value: "ron91", label: "Normal (ROZ 91)" },
      { value: "ron95", label: "Super (ROZ 95)" },
      { value: "ron98", label: "Super Plus (ROZ 98)" },
      { value: "ron102", label: "Rennkraftstoff (ROZ 102)" },
      { value: "e85", label: "E85 (Ethanol)" },
    ],
  },
  {
    kind: "select", path: "fuelSystem.fuel", group: "mixture", label: "Kraftstoff",
    effect: "HVO verbrennt rußärmer, Biodiesel hat etwas weniger Heizwert.",
    visible: isDiesel,
    options: () => [
      { value: "diesel", label: "Diesel (EN 590)" },
      { value: "hvo", label: "HVO (hydriertes Pflanzenöl)" },
      { value: "biodiesel", label: "Biodiesel (FAME)" },
    ],
  },
  {
    kind: "number", path: "fuelSystem.smokeLimitLambda", group: "mixture", label: "Rauchgrenze λ", unit: "", decimals: 2,
    effect: "− λ → mehr Kraftstoff, mehr Drehmoment, mehr Ruß und Abgashitze.",
    visible: isDiesel, warns: ["smoke", "egt-high"],
    range: () => ({ min: 1.05, max: 1.8, step: 0.01 }),
  },
  {
    kind: "number", path: "fuelSystem.injectionTimingOffsetDeg", group: "mixture", label: "Spritzbeginn", unit: "°KW", decimals: 1,
    effect: "Früher → besserer Wirkungsgrad, höherer Spitzendruck und Nagelgeräusch.",
    visible: isDiesel, warns: ["peak-pressure"],
    range: () => ({ min: -10, max: 10, step: 0.5 }),
  },
  {
    kind: "select", path: "fuelSystem.mixture", group: "mixture", label: "Gemischbildung",
    effect: "Direkteinspritzung kühlt den Brennraum und erlaubt mehr Verdichtung.",
    visible: isPetrol, warns: ["knock"],
    options: () => [
      { value: "carburettor", label: "Vergaser" },
      { value: "port-injection", label: "Saugrohreinspritzung" },
      { value: "direct-injection", label: "Direkteinspritzung" },
      { value: "dual-injection", label: "Saugrohr und direkt" },
    ],
  },
  {
    kind: "number", path: "fuelSystem.fullLoadLambda", group: "mixture", label: "Volllast-λ", unit: "", decimals: 2,
    effect: "− λ → fetter, kühlt Kolben und Turbine, kostet Verbrauch.",
    visible: isPetrol, warns: ["egt-high"],
    range: () => ({ min: 0.75, max: 1.05, step: 0.01 }),
  },
  {
    kind: "number", path: "fuelSystem.ignitionAdvanceOffsetDeg", group: "mixture", label: "Zündzeitpunkt", unit: "°KW", decimals: 1,
    effect: "+ Frühzündung → mehr Drehmoment, bis der Motor klopft.",
    visible: isPetrol, warns: ["knock"],
    range: () => ({ min: -10, max: 10, step: 0.5 }),
  },
  {
    kind: "toggle", path: "induction.individualThrottleBodies", group: "mixture", label: "Einzeldrosselklappen",
    effect: "Eine Drossel je Zylinder → spontanes Ansprechen, schlechter Leerlauf.",
    visible: isPetrol,
  },
  {
    kind: "number", path: "induction.intakeRunnerLengthMm", group: "mixture", label: "Saugrohrlänge", unit: "mm", decimals: 0,
    effect: "Lang → Resonanz und Drehmoment unten. Kurz → Leistung oben.",
    range: () => ({ min: 100, max: 800, step: 10 }),
  },
  // ── Aufladung ────────────────────────────────────────────────────────────
  {
    kind: "select", path: "induction.aspiration", group: "induction", label: "Aufladung",
    effect: "Turbo nutzt Abgasenergie, Kompressor kostet Kurbelleistung, spricht sofort an.",
    options: () => [
      { value: "naturally-aspirated", label: "Saugmotor" },
      { value: "turbo", label: "Turbolader" },
      { value: "twin-turbo-parallel", label: "Biturbo parallel" },
      { value: "twin-turbo-sequential", label: "Biturbo sequenziell" },
      { value: "supercharger-roots", label: "Roots-Kompressor" },
      { value: "supercharger-centrifugal", label: "Radialkompressor" },
      { value: "e-turbo", label: "Elektrischer Turbo" },
    ],
  },
  {
    kind: "number", path: "induction.boostTargetBar", group: "induction", label: "Ladedruck-Soll", unit: "bar", decimals: 2,
    effect: "+ Ladedruck → mehr Drehmoment, mehr Spitzendruck und Abgashitze.",
    visible: isCharged, warns: ["overboost", "peak-pressure", "knock"],
    range: (c) => (isDiesel(c) ? { min: 0.2, max: 3.0, step: 0.05 } : { min: 0.2, max: 2.5, step: 0.05 }),
  },
  {
    kind: "number", path: "induction.compressorInducerMm", group: "induction", label: "Verdichterrad", unit: "mm", decimals: 0,
    effect: "+ Rad → mehr Luftdurchsatz oben, mehr Turboloch unten.",
    visible: hasCompressorWheel, warns: ["turbo-overspeed"],
    range: () => ({ min: 25, max: 80, step: 1 }),
  },
  {
    kind: "number", path: "induction.turbineAR", group: "induction", label: "Turbinengehäuse A/R", unit: "", decimals: 2,
    effect: "+ A/R → weniger Gegendruck, Ladedruck kommt später.",
    visible: hasTurbine,
    range: () => ({ min: 0.3, max: 1.4, step: 0.01 }),
  },
  {
    kind: "toggle", path: "induction.variableGeometry", group: "induction", label: "Variable Turbinengeometrie",
    effect: "Verstellbare Leitschaufeln → früher Ladedruck ohne Stau oben.",
    visible: hasTurbine,
  },
  {
    kind: "select", path: "induction.intercooler", group: "induction", label: "Ladeluftkühler",
    effect: "Kühlere Ladeluft → dichter, weniger Klopfen, weniger Abgashitze.",
    visible: isCharged,
    options: () => [
      { value: "none", label: "Ohne" },
      { value: "air-to-air", label: "Luft-Luft" },
      { value: "air-to-water", label: "Luft-Wasser" },
    ],
  },
  // ── Abgas ────────────────────────────────────────────────────────────────
  {
    kind: "select", path: "exhaust.manifold", group: "exhaust", label: "Krümmer",
    effect: "Lange Fächerrohre → besserer Gaswechsel, langsamer warm.",
    options: () => [
      { value: "cast-log", label: "Gusskrümmer" },
      { value: "tubular-short", label: "Fächer kurz" },
      { value: "tubular-long", label: "Fächer lang" },
    ],
  },
  { kind: "toggle", path: "exhaust.egr", group: "exhaust", label: "Abgasrückführung", effect: "Senkt Stickoxide, erhöht Ruß und Verbrauch leicht." },
  { kind: "toggle", path: "exhaust.catalyst", group: "exhaust", label: "Katalysator", effect: "Reinigt das Abgas, kostet etwas Gegendruck." },
  { kind: "toggle", path: "exhaust.particulateFilter", group: "exhaust", label: "Partikelfilter", effect: "Hält Ruß zurück, der Gegendruck steigt." },
  {
    kind: "toggle", path: "exhaust.scr", group: "exhaust", label: "SCR-Katalysator (AdBlue)",
    effect: "Baut Stickoxide ab und erlaubt früheren Spritzbeginn.",
    visible: isDiesel,
  },
  // ── Kühlung ──────────────────────────────────────────────────────────────
  {
    kind: "number", path: "cooling.radiatorCapacityKw", group: "cooling", label: "Kühlerleistung", unit: "kW", decimals: 0,
    effect: "+ Kühler → mehr Dauerleistung ohne Überhitzen.",
    warns: ["overheat-coolant"],
    range: () => ({ min: 20, max: 300, step: 5 }),
  },
  {
    kind: "number", path: "cooling.thermostatOpenC", group: "cooling", label: "Thermostat öffnet", unit: "°C", decimals: 0,
    effect: "Wärmer → weniger Reibung, näher an der Siedegrenze.",
    warns: ["overheat-coolant"],
    range: () => ({ min: 70, max: 105, step: 1 }),
  },
  { kind: "toggle", path: "cooling.oilCooler", group: "cooling", label: "Ölkühler", effect: "Hält das Öl bei Volllast unter der Grenze.", warns: ["overheat-oil"] },
  // ── Grenzen ──────────────────────────────────────────────────────────────
  {
    kind: "number", path: "revLimitRpm", group: "limits", label: "Drehzahlbegrenzer", unit: "1/min", decimals: 0,
    effect: "+ Begrenzer → mehr Spitzenleistung, wenn die Mechanik mitmacht.",
    warns: ["over-rev", "valve-float", "piston-speed", "conrod-stress"],
    range: (c) => (isDiesel(c) ? { min: 2500, max: 6000, step: 100 } : { min: 4000, max: 12000, step: 100 }),
  },
  {
    kind: "number", path: "idleRpm", group: "limits", label: "Leerlaufdrehzahl", unit: "1/min", decimals: 0,
    effect: "Höher → stabiler Leerlauf, mehr Verbrauch im Stand.",
    warns: ["stall"],
    range: () => ({ min: 500, max: 1500, step: 25 }),
  },
];

// ── Path helpers ──────────────────────────────────────────────────────────

export function getPath(cfg: EngineConfig, path: string): unknown {
  let o: unknown = cfg;
  for (const k of path.split(".")) o = (o as Record<string, unknown>)[k];
  return o;
}

/** Returns a new config with the value set (structural clone). */
export function setPath(cfg: EngineConfig, path: string, value: unknown): EngineConfig {
  const next = structuredClone(cfg);
  const keys = path.split(".");
  let o = next as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
  return normalizeConfig(next, path);
}

export function isVisible(f: Field, cfg: EngineConfig): boolean {
  return f.visible ? f.visible(cfg) : true;
}

function nearest(values: number[], v: number): number {
  let best = values[0]!;
  for (const x of values) if (Math.abs(x - v) < Math.abs(best - v)) best = x;
  return best;
}

/**
 * Keeps dependent fields consistent after a change: cylinder count fits the layout, bank angle
 * fits the layout, valve count fits the valvetrain, numbers stay inside their (fuel dependent) ranges.
 */
export function normalizeConfig(cfg: EngineConfig, changedPath?: string): EngineConfig {
  const b = cfg.block;
  const cyl = cylinderOptions(b.layout);
  if (!cyl.includes(b.cylinders)) b.cylinders = nearest(cyl, b.cylinders);
  if (changedPath === "block.layout" || changedPath === "block.cylinders") {
    b.bankAngleDeg = defaultBankAngle(b.layout, b.cylinders);
  }
  const vals = valveOptions(cfg.head.valvetrain);
  if (!vals.includes(cfg.head.valvesPerCylinder)) cfg.head.valvesPerCylinder = nearest(vals, cfg.head.valvesPerCylinder) as 2 | 3 | 4 | 5;
  const vt = variableTimingOptions(cfg.head.valvetrain).map((o) => o.value);
  if (!vt.includes(cfg.head.variableTiming)) cfg.head.variableTiming = "none";
  if (cfg.fuel === "diesel") cfg.induction.individualThrottleBodies = false;
  if (cfg.fuel === "petrol") cfg.exhaust.scr = false;
  for (const f of FIELDS) {
    if (f.kind !== "number" || !isVisible(f, cfg)) continue;
    const r = f.range(cfg);
    const v = getPath(cfg, f.path) as number;
    const c = clamp(v, r.min, r.max);
    if (c !== v) {
      // write directly (no recursion)
      const keys = f.path.split(".");
      let o = cfg as unknown as Record<string, unknown>;
      for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
      o[keys[keys.length - 1]!] = snap(c, r.min, r.step);
    }
  }
  return cfg;
}

/** Fields of a group that apply to the given config. */
export function visibleFields(cfg: EngineConfig, group: GroupId): Field[] {
  return FIELDS.filter((f) => f.group === group && isVisible(f, cfg));
}
