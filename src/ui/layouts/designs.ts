// Cockpit designs (#83): skins for the Kombiinstrument. A design is data only: CSS custom properties on the
// `.ck[data-design=…]` root (layouts.css) plus a DialTheme for the canvas dials. No design has logic of its own.
// Also the ids of the switchable fields of the digital design. DOM-free (imported by settings.ts and tests).

export type CockpitDesignId = "classic" | "night-orange" | "italian" | "digital" | "hud";

/** How a round dial is drawn. Colours come from the CSS tokens (--ck-face, --ck-needle, …) of the design. */
export interface DialTheme {
  /** "taper": one-colour tapered needle (classic); "tip": light needle with a coloured tip (--ck-tip); "bar": thick straight bar. */
  needle: "taper" | "tip" | "bar";
  /** "alu": thin alu bezel; "tunnel": dark deep bevel, no metal (a tube looking into the dial); "none": no bezel. */
  ring: "alu" | "tunnel" | "none";
  /** Numeral weight and size factor (1 = classic size). */
  numeralWeight: number;
  numeralScale: number;
  /** Glow (shadow blur, px) of numerals and needle: backlit print. */
  glow: number;
  /** Minor ticks drawn (false: only the labelled ones). */
  minorTicks: boolean;
}

export const DEFAULT_DIAL_THEME: DialTheme = { needle: "taper", ring: "alu", numeralWeight: 500, numeralScale: 1, glow: 5, minorTicks: true };

export interface CockpitDesign {
  id: CockpitDesignId;
  label: string;
  hint: string;
  dial: DialTheme;
}

export const COCKPIT_DESIGNS: readonly CockpitDesign[] = [
  { id: "classic", label: "Klassisch", hint: "Schwarze Blätter, warmweiße Ziffern, rote Zeiger", dial: DEFAULT_DIAL_THEME },
  { id: "night-orange", label: "Nachtfahrt", hint: "Orange Beleuchtung, rote Zeiger, gedimmt", dial: { ...DEFAULT_DIAL_THEME, glow: 7, numeralWeight: 600 } },
  { id: "italian", label: "Sportlimousine", hint: "Zwei tiefe Röhren, schmales Display mit Fahrmodus", dial: { needle: "tip", ring: "tunnel", numeralWeight: 400, numeralScale: 1.12, glow: 2, minorTicks: true } },
  { id: "digital", label: "Digital", hint: "Große Ziffern, Drehzahlbogen und drei Felder zum Durchschalten", dial: DEFAULT_DIAL_THEME },
  { id: "hud", label: "Head-up", hint: "Nur Tempo, Gang, Schaltblitz und Tempomat", dial: DEFAULT_DIAL_THEME },
];

export function isCockpitDesign(v: unknown): v is CockpitDesignId {
  return typeof v === "string" && COCKPIT_DESIGNS.some((d) => d.id === v);
}

export function dialTheme(id: CockpitDesignId): DialTheme {
  return COCKPIT_DESIGNS.find((d) => d.id === id)?.dial ?? DEFAULT_DIAL_THEME;
}

/** Values the three fields of the digital design can show, in cycling order. */
export const FIELD_IDS = [
  "coolant", "oilT", "oilP", "boost", "egt", "intake", "fuelNow", "range", "power", "torque", "lambda", "road", "sprint", "ambient",
] as const;
export type FieldId = (typeof FIELD_IDS)[number];
export type FieldSet = [FieldId, FieldId, FieldId];

export function isFieldId(v: unknown): v is FieldId {
  return typeof v === "string" && (FIELD_IDS as readonly string[]).includes(v);
}

export const FIELD_PRESETS: Record<"track" | "daily", { label: string; fields: FieldSet }> = {
  track: { label: "Rennstrecke", fields: ["oilT", "coolant", "boost"] },
  daily: { label: "Alltag", fields: ["range", "fuelNow", "ambient"] },
};

export const DEFAULT_FIELDS: FieldSet = FIELD_PRESETS.daily.fields;

/** Stored field assignment (may be old or edited): three valid ids, invalid entries fall back per slot. */
export function validateFields(raw: unknown): FieldSet {
  const a = Array.isArray(raw) ? raw : [];
  return [0, 1, 2].map((i) => (isFieldId(a[i]) ? a[i] : DEFAULT_FIELDS[i])) as FieldSet;
}
