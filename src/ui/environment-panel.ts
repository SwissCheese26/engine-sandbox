// Umwelt- und Assistenz-Platte on the chassis dyno (issue #23): road surface, outside temperature, altitude, gradient,
// ABS / ASR / ESP / launch control on/off – and the warning-lamp strip (Kontrollleuchten) for the Getriebe-Pult,
// built so the cockpit (issue #26) can take the same element.
// Like the vehicle data, everything here can only be changed at standstill (review PR #39); the choice is kept per
// browser in localStorage (pruefzelle.environment, pruefzelle.assists).
import { DEFAULT_ASSISTS, WEATHER_LABELS, altitudeToKpa } from "../core/index.ts";
import type { AssistSettings, Drivetrain, Environment, Weather } from "../core/index.ts";
import { prefs } from "./settings.ts";
import { toUnit } from "./units.ts";

export const ENV_KEY = "pruefzelle.environment";
export const ASSIST_KEY = "pruefzelle.assists";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // storage blocked or garbage
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: the setting lasts for this session only
  }
}

/** Validated environment from storage: unknown fields dropped, numbers finite and in the slider ranges. */
export function parseEnvironment(v: unknown): Partial<Environment> {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: Partial<Environment> = {};
  if (typeof o.weather === "string" && o.weather in WEATHER_LABELS) out.weather = o.weather as Weather;
  const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : undefined);
  const a = num(o.ambientC, -20, 40);
  const h = num(o.altitudeM, 0, 3000);
  const g = num(o.gradePct, -15, 15);
  if (a !== undefined) out.ambientC = a;
  if (h !== undefined) out.altitudeM = h;
  if (g !== undefined) out.gradePct = g;
  return out;
}

/** Validated assistant settings from storage (only booleans of known keys). */
export function parseAssists(v: unknown): Partial<AssistSettings> {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: Partial<AssistSettings> = {};
  for (const k of Object.keys(DEFAULT_ASSISTS) as (keyof AssistSettings)[]) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  return out;
}

const fmt = (n: number, d = 0) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

interface Range {
  key: "ambient" | "altitude" | "grade";
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

const RANGES: Range[] = [
  { key: "ambient", label: "Außentemperatur", unit: "°C", min: -20, max: 40, step: 1 },
  { key: "altitude", label: "Höhe über NN", unit: "m", min: 0, max: 3000, step: 50 },
  { key: "grade", label: "Steigung", unit: "%", min: -15, max: 15, step: 1 },
];

const ASSISTS: { key: keyof AssistSettings; label: string; hint: string }[] = [
  { key: "abs", label: "ABS", hint: "Regelt den Bremsschlupf, die Räder blockieren nicht." },
  { key: "asr", label: "ASR", hint: "Nimmt Motormoment weg, wenn die Antriebsräder durchdrehen." },
  { key: "esp", label: "ESP", hint: "Überwacht ASR und ABS, regelt das Schleppmoment. Aus: ASR sportlich mit mehr Schlupf." },
  { key: "launchControl", label: "Launch Control", hint: "Im Stand Bremse und Vollgas: hält die Startdrehzahl, Bremse lösen startet." },
];

// ISO 2575 style symbols, simplified (stroke drawings, colour from currentColor)
export const ICON = {
  abs: `<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M7 4a14 14 0 0 0 0 20M33 4a14 14 0 0 1 0 20" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="20" cy="14" r="10" fill="none" stroke="currentColor" stroke-width="2.2"/><text x="20" y="17.6" text-anchor="middle" font-size="9.5" font-weight="700" fill="currentColor">ABS</text></svg>`,
  esp: `<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M9 14l3-6h16l3 6v5H9z" fill="currentColor"/><circle cx="13.5" cy="19.5" r="2.4" fill="currentColor"/><circle cx="26.5" cy="19.5" r="2.4" fill="currentColor"/><path d="M11 27c2-2-2-3 0-5M29 27c2-2-2-3 0-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  ice: `<svg viewBox="0 0 40 28" aria-hidden="true"><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 3v22M10.5 8.5l19 11M10.5 19.5l19-11"/><path d="M17 5l3 3 3-3M17 23l3-3 3 3" fill="none"/></g></svg>`,
} as const;

type LampState = "off" | "on" | "blink";

/** Kontrollleuchten-Leiste: ABS, ESP (blinks while ASR/ESP intervene), ESP OFF / ASR OFF, black ice, launch control. */
export class WarningLamps {
  readonly el: HTMLElement;
  private lamps: Record<"abs" | "esp" | "off" | "ice" | "launch", HTMLElement>;
  private offText: HTMLElement;
  private last = "";

  constructor() {
    const el = document.createElement("div");
    el.className = "lamps";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Kontrollleuchten");
    el.innerHTML = `
      <span class="lamp lamp--amber" data-lamp="abs" data-state="off">${ICON.abs}</span>
      <span class="lamp lamp--amber" data-lamp="esp" data-state="off">${ICON.esp}</span>
      <span class="lamp lamp--amber lamp--text" data-lamp="off" data-state="off">${ICON.esp}<b>ESP OFF</b></span>
      <span class="lamp lamp--ice" data-lamp="ice" data-state="off">${ICON.ice}</span>
      <span class="lamp lamp--green lamp--text" data-lamp="launch" data-state="off" hidden><b>LAUNCH</b></span>`;
    const q = (k: string) => el.querySelector<HTMLElement>(`[data-lamp=${k}]`)!;
    this.lamps = { abs: q("abs"), esp: q("esp"), off: q("off"), ice: q("ice"), launch: q("launch") };
    this.offText = this.lamps.off.querySelector("b")!;
    this.el = el;
  }

  /** Per frame from the drivetrain state; DOM only touched when something changes. */
  update(d: Drivetrain) {
    const s = d.state;
    const a = d.assists;
    const abs: LampState = !a.abs ? "on" : s.absActive ? "blink" : "off";
    const esp: LampState = (a.asr || a.esp) && (s.asrActive || s.espActive) ? "blink" : "off";
    const offLabel = !a.esp ? "ESP OFF" : !a.asr ? "ASR OFF" : "";
    const ice: LampState = s.iceWarning ? "on" : "off";
    const launch: LampState = s.launchArmed ? "on" : "off";
    const key = `${abs}|${esp}|${offLabel}|${ice}|${launch}|${a.launchControl}`;
    if (key === this.last) return;
    this.last = key;
    this.set("abs", abs, abs === "on" ? "ABS ausgeschaltet" : abs === "blink" ? "ABS regelt" : "ABS bereit");
    this.set("esp", esp, esp === "blink" ? "ESP/ASR greift ein" : "ESP/ASR bereit");
    this.offText.textContent = offLabel || "ESP OFF";
    this.set("off", offLabel ? "on" : "off", offLabel ? `${offLabel}: ausgeschaltet` : "ESP und ASR eingeschaltet");
    this.set("ice", ice, ice === "on" ? `Glättegefahr: unter ${fmt(toUnit("temp", 3))} ${prefs().temp} Außentemperatur` : "Keine Glättewarnung");
    this.lamps.launch.hidden = !a.launchControl;
    this.set("launch", launch, launch === "on" ? "Launch Control bereit: Bremse lösen" : "Launch Control");
  }

  private set(k: keyof WarningLamps["lamps"], st: LampState, label: string) {
    const l = this.lamps[k];
    l.dataset.state = st;
    l.title = label;
    l.setAttribute("aria-label", label);
  }
}

/** The plate itself. */
export class EnvironmentPanel {
  readonly el: HTMLElement;
  private weatherSel: HTMLSelectElement;
  private ranges = new Map<Range["key"], { input: HTMLInputElement; out: HTMLOutputElement }>();
  private checks = new Map<keyof AssistSettings, HTMLInputElement>();
  private airOut: HTMLElement;
  private lockNote: HTMLElement;
  private moving = false;
  /** Called after any change (the app updates the simulator ambient inputs from the drivetrain). */
  onChange: () => void = () => {};

  constructor(private drivetrain: Drivetrain) {
    const el = document.createElement("div");
    el.className = "vehicle environment";
    el.innerHTML = `
      <h3 class="vehicle__title">Umwelt &amp; Assistenten</h3>
      <div class="vehicle__grid">
        <label class="vehicle__num vehicle__num--wide"><span>Fahrbahn</span>
          <select data-control="weather">${(Object.keys(WEATHER_LABELS) as Weather[])
            .map((w) => `<option value="${w}">${WEATHER_LABELS[w]}</option>`).join("")}</select>
        </label>
        ${RANGES.map((r) => `
          <label class="environment__range"><span>${r.label}</span>
            <input type="range" data-control="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" />
            <output class="num"></output>
          </label>`).join("")}
      </div>
      <p class="vehicle__hint" data-out="air"></p>
      <p class="vehicle__note" data-out="env-lock" hidden>Umwelt und Assistenten lassen sich nur im Stand ändern.</p>
      <fieldset class="environment__assists">
        <legend>Fahrassistenten</legend>
        ${ASSISTS.map((a) => `
          <label class="environment__toggle" title="${a.hint}">
            <input type="checkbox" data-control="assist-${a.key}" /> <span>${a.label}</span>
          </label>`).join("")}
      </fieldset>
      <p class="vehicle__hint">Nässe, Schnee und Eis senken die Haftung je nach Reifen: Winterreifen sind auf Schnee deutlich besser, Slicks im Regen sehr rutschig. Bei starkem Regen droht ab etwa 80 km/h Aquaplaning. Kalte Luft ist dichter (mehr Leistung), in der Höhe fehlt Luft.</p>`;
    this.el = el;
    this.weatherSel = el.querySelector("[data-control=weather]")!;
    this.airOut = el.querySelector("[data-out=air]")!;
    this.lockNote = el.querySelector("[data-out=env-lock]")!;
    // stored choice of this browser (validated; the defaults stay for anything missing or broken)
    const env = parseEnvironment(readJson(ENV_KEY));
    if (Object.keys(env).length) this.drivetrain.setEnvironment(env);
    const as = parseAssists(readJson(ASSIST_KEY));
    if (Object.keys(as).length) this.drivetrain.setAssists(as);
    for (const r of RANGES) {
      const input = el.querySelector<HTMLInputElement>(`[data-control=${r.key}]`)!;
      const out = input.parentElement!.querySelector("output")!;
      this.ranges.set(r.key, { input, out });
      input.addEventListener("input", () => this.apply());
    }
    for (const a of ASSISTS) {
      const c = el.querySelector<HTMLInputElement>(`[data-control=assist-${a.key}]`)!;
      this.checks.set(a.key, c);
      c.addEventListener("change", () => {
        if (this.moving) return this.sync();
        this.drivetrain.setAssists({ [a.key]: c.checked });
        // stored as the car's choice (motorcycles switch ESP/ASR off by themselves)
        if (this.drivetrain.kind === "car") writeJson(ASSIST_KEY, this.drivetrain.assists);
        else if (a.key === "abs" || a.key === "launchControl") writeJson(ASSIST_KEY, { ...(parseAssists(readJson(ASSIST_KEY))), [a.key]: c.checked });
        this.onChange();
      });
    }
    this.weatherSel.addEventListener("change", () => this.apply());
    this.sync();
  }

  private apply() {
    if (this.moving) return this.sync();
    const v = (k: Range["key"]) => Number(this.ranges.get(k)!.input.value);
    this.drivetrain.setEnvironment({
      weather: this.weatherSel.value as Weather,
      ambientC: v("ambient"),
      altitudeM: v("altitude"),
      gradePct: v("grade"),
    });
    writeJson(ENV_KEY, this.drivetrain.environment);
    this.sync();
    this.onChange();
  }

  /** Per frame: controls locked while the vehicle moves (> 0,5 km/h), with a note. */
  update(speedKmh: number) {
    const moving = speedKmh > 0.5;
    if (moving === this.moving) return;
    this.moving = moving;
    this.weatherSel.disabled = moving;
    for (const { input } of this.ranges.values()) input.disabled = moving;
    for (const c of this.checks.values()) c.disabled = moving;
    this.lockNote.hidden = !moving;
  }

  /** Controls follow the drivetrain (after a vehicle change, motorcycles switch ESP/ASR off). */
  sync() {
    const e = this.drivetrain.environment;
    this.weatherSel.value = e.weather;
    const val = { ambient: e.ambientC, altitude: e.altitudeM, grade: e.gradePct };
    for (const r of RANGES) {
      const { input, out } = this.ranges.get(r.key)!;
      input.value = String(val[r.key]);
      const n = val[r.key];
      // the outside temperature follows the global unit (#24); the slider itself stays in °C steps
      const text = r.key === "ambient"
        ? `${fmt(toUnit("temp", n))} ${prefs().temp}`
        : `${r.key === "grade" && n > 0 ? "+" : ""}${fmt(n)} ${r.unit}`;
      out.textContent = text;
      input.setAttribute("aria-valuetext", text);
    }
    const kpa = altitudeToKpa(e.altitudeM);
    const gr = e.gradePct === 0 ? "eben" : e.gradePct > 0 ? `${fmt(e.gradePct)} % bergauf` : `${fmt(-e.gradePct)} % bergab`;
    this.airOut.textContent = `Luftdruck ${fmt(kpa, 1)} kPa, Fahrbahn ${gr}.`;
    const a = this.drivetrain.assists;
    for (const [k, c] of this.checks) c.checked = a[k];
  }
}
