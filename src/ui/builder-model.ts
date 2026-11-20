// Engine Builder (#72): the pure part of the step-by-step assistant (no DOM, unit-tested). Steps and their
// workbench groups (fields.ts GROUPS/FIELDS, so ranges and effect lines are the same everywhere), explanations per
// option in player language, the live figures of the sidebar (from the core's summarize/validateConfig), which
// critical findings block "Weiter", and the draft that survives a reload (`pruefzelle.builderDraft`).
import { displacementL, summarize, validateConfig } from "../core/index.ts";
import type { EngineConfig, FuelKind, Warning } from "../core/index.ts";
import { defaultConfig } from "../data/presets.ts";
import { FIELDS, type GroupId } from "./fields.ts";
import { autoName } from "./names.ts";
import { parseEngineConfig, resolveEngine } from "./my-engines.ts";

export type StepId = "basis" | "block" | "head" | "mixture" | "induction" | "exhaust" | "cooling" | "limits" | "finish";

export interface BuilderStep {
  id: StepId;
  title: string;
  /** Workbench groups shown on this step (empty for Grundlage and Fertig). */
  groups: GroupId[];
  /** One or two sentences: what this step decides. */
  intro: string;
}

export const STEPS: readonly BuilderStep[] = [
  { id: "basis", title: "Grundlage", groups: [], intro: "Gib deinem Motor einen Namen, wähle Diesel oder Benzin und ob du bei null anfängst oder einen Serienmotor als Basis nimmst." },
  { id: "block", title: "Block", groups: ["block"], intro: "Bauform, Zylinder, Bohrung und Hub ergeben den Hubraum. Die Werkstoffe entscheiden, wie viel Druck und Drehzahl der Motor aushält und wie schwer er wird." },
  { id: "head", title: "Zylinderkopf", groups: ["head"], intro: "Der Ventiltrieb bestimmt, wie hoch der Motor drehen kann. Die Nocke verschiebt die Kraft nach unten (zahm) oder nach oben (scharf)." },
  { id: "mixture", title: "Gemischbildung", groups: ["mixture"], intro: "Wie der Kraftstoff in den Zylinder kommt: Einspritzung, Kraftstoffsorte und wie fett der Motor bei Vollgas läuft." },
  { id: "induction", title: "Aufladung", groups: ["induction"], intro: "Sauger oder Lader: Ein Turbo drückt mehr Luft in den Motor und bringt viel mehr Leistung, aber auch Hitze und Spitzendruck." },
  { id: "exhaust", title: "Abgas", groups: ["exhaust"], intro: "Krümmer und Abgasreinigung. Jedes Bauteil kostet etwas Gegendruck, ein guter Krümmer bringt Drehmoment." },
  { id: "cooling", title: "Kühlung", groups: ["cooling"], intro: "Die Kühlung hält den Motor bei Dauervolllast im grünen Bereich. Zu klein, und er überhitzt auf dem Prüfstand." },
  { id: "limits", title: "Grenzen und Steuergerät", groups: ["limits", "ecu"], intro: "Begrenzer und Leerlauf legen das Drehzahlband fest. Das Steuergerät kann Drehmoment und Leistung begrenzen, um Getriebe und Bauteile zu schonen." },
  { id: "finish", title: "Fertig", groups: [], intro: "Dein Motor im Überblick: Volllastkurve, Typenschild und Hinweise. Speichern, dann im Stand hochdrehen oder in der Sandbox fahren." },
];

export const STEP_COUNT = STEPS.length;

/** Workbench fields the builder shows elsewhere (the name is asked on Grundlage and Fertig). */
export const OMIT_PATHS = ["name"];

/**
 * Explanation of the chosen option, per select field: what it is, weight, strength, rev limit, typical use.
 * Shown below the field and updated with the choice. Facts follow src/core/limits.ts and mass.ts (peak-pressure
 * and piston-speed limits per material) and docs/research/*.md.
 */
export const OPTION_INFO: Record<string, Record<string, string>> = {
  "block.layout": {
    inline: "Reihe: alle Zylinder hintereinander. Einfach und günstig, ab sechs Zylindern lang.",
    v: "V: zwei Zylinderbänke im Winkel. Kurz und kompakt, typisch für V6, V8 und V12.",
    boxer: "Boxer: Zylinder liegen sich flach gegenüber. Tiefer Schwerpunkt, sehr ruhiger Lauf.",
    vr: "VR: ein sehr enger V mit nur einem Zylinderkopf (VW VR6). Kurz wie ein V, einfach wie eine Reihe.",
    w: "W: zwei VR-Bänke im V. Viele Zylinder auf kleinem Raum (W12, W16).",
  },
  "block.blockMaterial": {
    "cast-iron": "Grauguss: schwer, aber sehr fest und günstig. Hält hohen Spitzendruck aus, Klassiker bei Diesel und Tuning.",
    "compacted-graphite-iron": "Vermiculargraphitguss (GJV): fester als Grauguss bei etwas weniger Gewicht. Hält den höchsten Spitzendruck aus, typisch für moderne Diesel und Lkw.",
    aluminium: "Aluminium: gut ein Fünftel leichter als Guss und leitet Wärme besser, verträgt aber weniger Spitzendruck.",
  },
  "block.crankshaft": {
    cast: "Gegossen: günstig, für Serienmotoren. Etwas niedrigere Drehzahl- und Lastgrenze.",
    forged: "Geschmiedet: fester und zäher, Standard bei Diesel und Sportmotoren.",
    billet: "Aus dem Vollen gefräst: die festeste und teuerste Welle, für Rennmotoren mit höchster Drehzahl.",
  },
  "block.pistons": {
    "cast-aluminium": "Aluminium gegossen: leicht und günstig, verträgt am wenigsten Spitzendruck und Klopfen.",
    "forged-aluminium": "Aluminium geschmiedet: etwas leichter und deutlich fester. Erste Wahl für Turbo-Tuning und hohe Drehzahl.",
    steel: "Stahl: schwerer, aber hält den höchsten Druck und viel Abgashitze aus. Typisch für moderne Diesel und Lkw.",
  },
  "block.conrods": {
    "cast-steel": "Stahl gegossen: günstig, die schwächste Wahl. Begrenzt Drehzahl und Spitzendruck.",
    "forged-steel": "Stahl geschmiedet: fest und bewährt, Standard in den meisten Motoren.",
    titanium: "Titan: leichter und sehr fest. Weniger bewegte Masse erlaubt mehr Drehzahl, teuer.",
  },
  "head.valvetrain": {
    ohv: "OHV: Nockenwelle unten im Block, Stoßstangen öffnen die Ventile. Kompakt und drehmomentstark, aber früh Ventilflattern.",
    sohc: "SOHC: eine obenliegende Nockenwelle. Mittlere Drehzahlen, einfach aufgebaut.",
    dohc: "DOHC: zwei obenliegende Nockenwellen. Die beste Wahl für hohe Drehzahl und vier Ventile.",
  },
  "head.variableTiming": {
    none: "Ohne Verstellung: Die Nocke ist ein Kompromiss für das ganze Drehzahlband.",
    "intake-cam": "Einlassnocke verstellbar: mehr Drehmoment unten, ohne oben Leistung zu verlieren.",
    "dual-cam": "Ein- und Auslass verstellbar: das breiteste nutzbare Drehzahlband.",
    "cam-switching": "Nockenumschaltung (wie VTEC): unten zahme, oben scharfe Nocke.",
  },
  "fuelSystem.injection": {
    "indirect-prechamber": "Vorkammer: alte, robuste Technik. Laut, braucht hohe Verdichtung und Glühkerzen.",
    "indirect-swirl-chamber": "Wirbelkammer: wie die Vorkammer, etwas sparsamer. Typisch für Diesel der 80er und 90er.",
    "unit-injector": "Pumpe-Düse: sehr hoher Einspritzdruck je Zylinder, kräftig und etwas rau (VW TDI um 2000).",
    "common-rail": "Common Rail: ein Speicher für alle Düsen, frei wählbarer Druck. Leise, sauber und kräftig.",
    "mechanical-pump": "Mechanische Pumpe: einfach und unverwüstlich, ohne Elektronik (Cummins 6BT).",
  },
  "fuelSystem.mixture": {
    carburettor: "Vergaser: klassisch und einfach, aber ungenau. Keine Klopfregelung mit Lader.",
    "port-injection": "Saugrohreinspritzung: genau und sauber, bewährt in vielen Serienmotoren.",
    "direct-injection": "Direkteinspritzung: kühlt den Brennraum, erlaubt mehr Verdichtung und Ladedruck.",
    "dual-injection": "Saugrohr und direkt: das Beste aus beiden, wie bei modernen Turbo-Benzinern.",
  },
  "induction.aspiration": {
    "naturally-aspirated": "Saugmotor: spontan und linear, aber weniger Leistung pro Liter.",
    turbo: "Turbolader: nutzt die Abgasenergie. Viel Leistung, etwas Turboloch.",
    "twin-turbo-parallel": "Biturbo parallel: zwei kleine Lader, je einer pro Bank. Schnelleres Ansprechen.",
    "twin-turbo-sequential": "Biturbo sequenziell: kleiner Lader unten, großer oben. Breites Band.",
    "supercharger-roots": "Roots-Kompressor: von der Kurbelwelle angetrieben, Ladedruck ab Leerlauf, kostet Leistung.",
    "supercharger-centrifugal": "Radialkompressor: riemengetrieben, Ladedruck steigt mit der Drehzahl.",
    "e-turbo": "Elektrischer Turbo: ein Elektromotor hilft beim Anlaufen, fast kein Turboloch.",
  },
  "induction.intercooler": {
    none: "Ohne Ladeluftkühler: Die verdichtete Luft bleibt heiß. Klopft und rußt eher.",
    "air-to-air": "Luft-Luft: der übliche Kühler vorne im Fahrtwind.",
    "air-to-water": "Luft-Wasser: kurze Wege, kühlt schnell, braucht einen eigenen Wasserkreislauf.",
  },
  "exhaust.manifold": {
    "cast-log": "Gusskrümmer: robust und schnell warm (gut für Kat und Turbo), etwas Gegendruck.",
    "tubular-short": "Fächerkrümmer kurz: besserer Gaswechsel, mehr Leistung oben.",
    "tubular-long": "Fächerkrümmer lang: Resonanz bringt Drehmoment, braucht Platz, langsamer warm.",
  },
  "cooling.type": {
    liquid: "Flüssigkeitskühlung: Kühler, Pumpe und Thermostat. Hält die Temperatur auch im Stand.",
    air: "Luftkühlung: Kühlrippen im Fahrtwind (Käfer, Porsche 911 bis 1998). Auf dem Prüfstand ohne Fahrtwind wird es schnell heiß.",
    "oil-air": "Öl-Luft: Kühlrippen plus Ölkühlung des Kopfes (Suzuki GSX-R alt). Etwas mehr Reserve als reine Luft.",
  },
};

/** Info for the current value of a select field, or undefined. */
export function optionInfo(path: string, value: unknown): string | undefined {
  return OPTION_INFO[path]?.[String(value)];
}

// --- live figures --------------------------------------------------------------------------------------------------

export interface BuilderStats {
  displacementL: number;
  boreStrokeRatio: number;
  /** "überquadratisch" (bore > stroke), "quadratisch" or "langhubig". */
  boreStrokeLabel: string;
  /** Mean piston speed at the rev limiter, m/s. */
  pistonSpeedMs: number;
  /** Warning threshold of the mean piston speed for this engine, m/s. */
  pistonSpeedMaxMs: number;
  compressionRatio: number;
  /** Estimated from the core's full-load sweep; NaN when the core cannot compute it. */
  peakPowerKw: number;
  peakPowerRpm: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  massKg: number;
  warnings: Warning[];
}

export function boreStrokeLabel(ratio: number): string {
  return ratio > 1.03 ? "überquadratisch" : ratio < 0.97 ? "langhubig" : "quadratisch";
}

/** Sidebar figures. Uses the core's summarize() (≈ 3 ms) and validateConfig(); never throws. */
export function builderStats(cfg: EngineConfig): BuilderStats {
  // every figure comes from the core (geometry, dyno sweep, limits); the UI computes no physics of its own
  const ratio = cfg.block.boreMm / cfg.block.strokeMm;
  let warnings: Warning[] = [];
  try {
    warnings = validateConfig(cfg);
  } catch {
    warnings = [];
  }
  const base = { boreStrokeRatio: ratio, boreStrokeLabel: boreStrokeLabel(ratio), compressionRatio: cfg.block.compressionRatio, warnings };
  try {
    const s = summarize(cfg);
    return {
      ...base, displacementL: s.displacementL, pistonSpeedMs: s.maxMeanPistonSpeedMs, pistonSpeedMaxMs: s.limits.meanPistonSpeedMaxMs,
      peakPowerKw: s.peakPowerKw, peakPowerRpm: s.peakPowerRpm, peakTorqueNm: s.peakTorqueNm, peakTorqueRpm: s.peakTorqueRpm, massKg: s.massKg,
    };
  } catch {
    const nan = Number.NaN;
    let displacement = nan;
    try {
      displacement = displacementL(cfg);
    } catch {
      /* stays NaN */
    }
    return { ...base, displacementL: displacement, pistonSpeedMs: nan, pistonSpeedMaxMs: nan, peakPowerKw: nan, peakPowerRpm: nan, peakTorqueNm: nan, peakTorqueRpm: nan, massKg: nan };
  }
}

/** Step a config field (or validateConfig field path) belongs to; fields without a step belong to Grundlage. */
export function stepOfField(path: string | undefined): StepId {
  const f = path ? FIELDS.find((x) => x.path === path) : undefined;
  if (!f) return "basis";
  return STEPS.find((s) => s.groups.includes(f.group))?.id ?? "basis";
}

/** Critical findings of validateConfig that concern the given step: they block "Weiter" there. */
export function stepBlockers(warnings: Warning[], step: StepId): Warning[] {
  return warnings.filter((w) => w.severity === "critical" && stepOfField(w.field) === step);
}

export function stepIndex(id: StepId): number {
  return STEPS.findIndex((s) => s.id === id);
}

// --- start and draft -----------------------------------------------------------------------------------------------

/** Start configuration of a new engine: the fuel's base equipment or a copy of a library / own engine. */
export function startConfig(fuel: FuelKind, baseId?: string): { config: EngineConfig; customName: boolean } {
  const base = baseId ? resolveEngine(baseId) : null;
  if (base) {
    // a copy, never the original: it gets its own id on save
    const cfg = parseEngineConfig(base) ?? defaultConfig(base.fuel);
    cfg.id = "builder-draft";
    return { config: cfg, customName: false };
  }
  const cfg = defaultConfig(fuel);
  cfg.id = "builder-draft";
  cfg.name = autoName(cfg);
  return { config: cfg, customName: false };
}

export const BUILDER_DRAFT_KEY = "pruefzelle.builderDraft";

export interface BuilderDraft {
  step: number;
  config: EngineConfig;
  /** True once the player typed a name; otherwise the name follows the configuration. */
  customName: boolean;
  /** Own engine being edited (its id), or undefined for a new engine. */
  editingId?: string;
  /** Library or own engine the build started from. */
  baseId?: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function store(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function parseDraft(raw: unknown): BuilderDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const config = parseEngineConfig(r.config);
  if (!config) return null;
  const step = typeof r.step === "number" && Number.isInteger(r.step) ? Math.min(Math.max(r.step, 0), STEP_COUNT - 1) : 0;
  const d: BuilderDraft = { step, config, customName: r.customName === true };
  if (typeof r.editingId === "string" && r.editingId) d.editingId = r.editingId;
  if (typeof r.baseId === "string" && r.baseId) d.baseId = r.baseId;
  return d;
}

export function loadDraft(st: Store | null = store()): BuilderDraft | null {
  try {
    return parseDraft(JSON.parse(st?.getItem(BUILDER_DRAFT_KEY) ?? "null"));
  } catch {
    return null;
  }
}

export function saveDraft(d: BuilderDraft, st: Store | null = store()) {
  try {
    st?.setItem(BUILDER_DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* storage blocked: the draft lasts for this visit */
  }
}

export function clearDraft(st: Store | null = store()) {
  try {
    st?.removeItem(BUILDER_DRAFT_KEY);
  } catch {
    /* nothing stored */
  }
}
