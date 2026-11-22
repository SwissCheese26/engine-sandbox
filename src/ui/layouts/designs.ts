// Cockpit designs (#83): skins for the Kombiinstrument. A design is data only: CSS custom properties on the
// `.ck[data-design=…]` root (layouts.css) plus a DialTheme for the canvas dials. No design has logic of its own.
// Also the ids of the switchable fields of the digital design. DOM-free (imported by settings.ts and tests).

export type CockpitDesignId = "classic" | "night-orange" | "italian" | "oldschool" | "digital" | "hud" | "race" | "motorrad" | "truck" | "etacho";
/** Stored choice: a design, or "auto" = by vehicle (motorcycle → "motorrad", truck/bus → "truck", else "classic"). */
export type CockpitChoice = CockpitDesignId | "auto";

/** How a round dial is drawn. Colours come from the CSS tokens (--ck-face, --ck-needle, …) of the design. */
export interface DialTheme {
  /** "taper": one-colour tapered needle (classic); "tip": shaft (--ck-shaft) with a coloured tip (--ck-tip); "bar": thick straight bar. */
  needle: "taper" | "tip" | "bar";
  /** "alu": thin alu bezel; "tunnel": dark deep bevel, no metal (a tube looking into the dial); "chrome": wide polished
   *  ring; "none": no bezel. */
  ring: "alu" | "tunnel" | "chrome" | "none";
  /** Numeral weight and size factor (1 = classic size). */
  numeralWeight: number;
  numeralScale: number;
  /** Glow (shadow blur, px) of numerals and needle: backlit print. */
  glow: number;
  /** Minor ticks drawn (false: only the labelled ones). */
  minorTicks: boolean;
  /** A faint reflection on the glass (upper left), drawn into the face. */
  glass?: boolean;
}

export const DEFAULT_DIAL_THEME: DialTheme = { needle: "taper", ring: "alu", numeralWeight: 500, numeralScale: 1, glow: 5, minorTicks: true };

/**
 * How the console gauges (Zusatzinstrumente, #83) are drawn in a design: "dial" designs show round canvas dials in
 * their DialTheme (or plain bars); "screen" designs have no analogue instruments, so the gauges become that screen's
 * own tiles and segment bars.
 */
export type GaugeKind = "dial" | "screen";

export interface CockpitDesign {
  id: CockpitDesignId;
  label: string;
  hint: string;
  dial: DialTheme;
  gauges: GaugeKind;
}

export const COCKPIT_DESIGNS: readonly CockpitDesign[] = [
  { id: "classic", label: "Klassisch", hint: "Schwarze Blätter, warmweiße Ziffern, rote Zeiger", dial: DEFAULT_DIAL_THEME, gauges: "dial" },
  { id: "night-orange", label: "Nachtfahrt", hint: "Orange Beleuchtung, rote Zeiger, gedimmt", dial: { ...DEFAULT_DIAL_THEME, glow: 7, numeralWeight: 600 }, gauges: "dial" },
  { id: "italian", label: "Sportlimousine", hint: "Zwei tiefe Röhren, schmales Display mit Fahrmodus", dial: { needle: "tip", ring: "tunnel", numeralWeight: 400, numeralScale: 1.12, glow: 2, minorTicks: true }, gauges: "dial" },
  { id: "oldschool", label: "Oldschool", hint: "Chromringe, elfenbeinfarbene Blätter, Serifenziffern, Zählwerk", dial: { needle: "tip", ring: "chrome", numeralWeight: 600, numeralScale: 1.08, glow: 0, minorTicks: true, glass: true }, gauges: "dial" },
  { id: "digital", label: "Digital", hint: "Große Ziffern, Drehzahlbogen und drei Felder zum Durchschalten", dial: DEFAULT_DIAL_THEME, gauges: "screen" },
  // Head-up also replaces the former "Kompakt" view (#94): both were a few big values without dials
  { id: "hud", label: "Head-up", hint: "Wenige große Werte: Tempo, Gang, Drehzahl, Leistung, Schaltblitz. Gut fürs Handy", dial: DEFAULT_DIAL_THEME, gauges: "screen" },
  // the former "Renn-Dash" view (#26), now a design (#94); drawn by RaceView inside the cockpit
  { id: "race", label: "Renn-Dash", hint: "Schaltblitz-LEDs, große Gangzahl, 0–100 mit Delta, Öl und Wasser", dial: DEFAULT_DIAL_THEME, gauges: "screen" },
  { id: "motorrad", label: "Motorrad", hint: "Kompaktes TFT: Drehzahlbalken mit Schaltblitz, Tempo und Gang groß", dial: DEFAULT_DIAL_THEME, gauges: "screen" },
  // commercial vehicles (#83, #31): 125 km/h speedometer with the limiter mark, rev counter with the green band
  { id: "truck", label: "Nutzfahrzeug", hint: "Tacho bis 125 km/h mit Begrenzer, Drehzahlmesser mit grünem Bereich, Motorbremse", dial: { needle: "bar", ring: "alu", numeralWeight: 600, numeralScale: 1.1, glow: 3, minorTicks: true }, gauges: "dial" },
  // electric cars (#108): power/regen meter, state of charge, range, consumption, battery temperature, drive mode
  { id: "etacho", label: "E-Tacho", hint: "Für Elektroautos: Leistung und Rekuperation, Ladezustand, Reichweite, kWh/100 km, Akkutemperatur, Fahrmodus", dial: { needle: "bar", ring: "none", numeralWeight: 500, numeralScale: 1, glow: 4, minorTicks: false }, gauges: "dial" },
];

export const AUTO_DESIGN = { id: "auto", label: "Automatisch nach Fahrzeug", hint: "Motorrad-Display auf dem Motorrad, Nutzfahrzeug bei Lkw und Bus, E-Tacho im Elektroauto, sonst Klassisch" } as const;

/** Everything the design picker offers, in its order: "Automatisch" first, then every design (#94). */
export const DESIGN_CHOICES: readonly { id: CockpitChoice; label: string; hint: string }[] = [AUTO_DESIGN, ...COCKPIT_DESIGNS];

export function isCockpitChoice(v: unknown): v is CockpitChoice {
  return v === "auto" || isCockpitDesign(v);
}

/** The design in effect for a stored choice and the vehicle kind on the dyno. */
export function resolveDesign(choice: CockpitChoice, vehicleKind: string, electric = false): CockpitDesignId {
  if (choice !== "auto") return choice;
  if (electric) return "etacho";
  if (vehicleKind === "superbike" || vehicleKind === "tourer") return "motorrad";
  return vehicleKind === "truck" || vehicleKind === "bus" ? "truck" : "classic";
}

export function isCockpitDesign(v: unknown): v is CockpitDesignId {
  return typeof v === "string" && COCKPIT_DESIGNS.some((d) => d.id === v);
}

export function dialTheme(id: CockpitDesignId): DialTheme {
  return COCKPIT_DESIGNS.find((d) => d.id === id)?.dial ?? DEFAULT_DIAL_THEME;
}

/** Values the three fields of the digital design can show, in cycling order. */
export const FIELD_IDS = [
  "coolant", "oilT", "gearOil", "oilP", "boost", "egt", "fuelNow", "range", "power", "torque", "lambda", "road", "sprint", "ambient",
  // intake air (#83, #105), board-net voltage; air pressure, retarder (trucks, buses), AdBlue (SCR), lean (bikes on a curved route)
  "intake", "battery", "air", "retarder", "adblue", "lean",
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

/**
 * Gauges the console strip can show: values of EngineState and of the vehicle systems (core vehicle-systems.ts,
 * #83). Each is offered only where the vehicle has it (gaugeAvailable).
 */
export const GAUGE_IDS = ["boost", "oilP", "oilT", "gearOil", "lambda", "egt", "intake", "battery", "air", "retarder", "adblue", "lean"] as const satisfies readonly FieldId[];
export type GaugeId = (typeof GAUGE_IDS)[number];
export type GaugeStyle = "round" | "bar";

export const GAUGE_LABEL: Record<GaugeId, string> = {
  boost: "Ladedruck", oilP: "Öldruck", oilT: "Öltemperatur", gearOil: "Getriebeöl", lambda: "Lambda", egt: "Abgastemperatur",
  intake: "Ansauglufttemperatur", battery: "Batteriespannung", air: "Druckluft (Vorrat)", retarder: "Retarderstufe", adblue: "AdBlue-Füllstand", lean: "Schräglage",
};
/** Captions under the gauges (narrow on phones); the full name is the tooltip and the picker label. */
export const GAUGE_SHORT: Record<GaugeId, string> = {
  boost: "Ladedruck", oilP: "Öldruck", oilT: "Öltemp.", gearOil: "Getr.-Öl", lambda: "Lambda", egt: "Abgas",
  intake: "Ansaugl.", battery: "Batterie", air: "Druckluft", retarder: "Retarder", adblue: "AdBlue", lean: "Schräglage",
};

/** What the console shows for the chosen style in a design: "tile" and "segment" are the screen equivalents. */
export type GaugeDisplay = "round" | "bar" | "tile" | "segment";

export function gaugeKind(id: CockpitDesignId): GaugeKind {
  return COCKPIT_DESIGNS.find((d) => d.id === id)?.gauges ?? "dial";
}

/** Round dials only where the design has analogue instruments; screen designs show tiles (round) or segment bars. */
export function gaugeDisplay(id: CockpitDesignId, style: GaugeStyle): GaugeDisplay {
  if (gaugeKind(id) === "screen") return style === "round" ? "tile" : "segment";
  return style;
}

/** Hint under the style choice of the picker: says how a screen design shows the choice (empty for dial designs). */
export function gaugeStyleHint(id: CockpitDesignId): string {
  if (gaugeKind(id) !== "screen") return "";
  const label = COCKPIT_DESIGNS.find((d) => d.id === id)!.label;
  return `${label} hat keine Rundinstrumente: „Rund“ erscheint hier als Kachel, „Balken“ als Segmentbalken im Stil des Displays.`;
}

export function isGaugeId(v: unknown): v is GaugeId {
  return typeof v === "string" && (GAUGE_IDS as readonly string[]).includes(v);
}

/** Stored gauge choice: valid ids only, each once, in the order of the strip. Anything else gives none. */
export function validateGauges(raw: unknown): GaugeId[] {
  const a = Array.isArray(raw) ? raw : [];
  return GAUGE_IDS.filter((id) => a.includes(id));
}

