// Cockpit / Kombiinstrument (#26): speedometer and rev counter as round dials with needles, a centre display (gear,
// digital speed, outside temperature, board computer, cruise control), five small instruments and the warning-lamp
// strip. Built for the chassis dyno; on the engine dyno the speedometer rests and reads "–".
// Since #94 the former views Renn-Dash and Kompakt are designs here: "race" shows RaceView inside the cluster (lamp
// strip and cruise line stay), "hud" took over Kompakt's big rpm and power values.
import type { EngineConfig, EngineSummary } from "../../core/index.ts";
import { fmt } from "../format.ts";
import { RESERVE_SHARE, TERRAIN_LABELS } from "../../core/index.ts";
import { reducedMotion } from "../canvas.ts";
import { GAS_RAMPS, getSettings, prefs, setSettings } from "../settings.ts";
import { toUnit } from "../units.ts";
import { Dial, type DialScale } from "./dial.ts";
import { DESIGN_CHOICES, FIELD_PRESETS, dialTheme, isCockpitChoice, resolveDesign, type CockpitDesignId, type FieldId, type FieldSet } from "./designs.ts";
import { driveModeWord, fieldAriaLabel, formatField, intakeAirOf, nextField, shownField, type FieldContext, type FieldInputs } from "./fields-logic.ts";
import { CockpitExtras } from "./extras.ts";
import { economyBand, engineBrakeInfo, truckSpeedScale, truckTachoScale } from "./extras-logic.ts";
import { BASE_ICON, ICON2 } from "./icons.ts";
import { ledColors, shiftLights, avgL100, clusterLamps, fuelScale, SPEEDO_SCALES, clampSpeedoKmh, isSpeedoScale, speedoScaleMax, speedoTicks, tachoMax, tachoZones, type Lamp, type LampSet } from "./logic.ts";
import { RaceView } from "./race.ts";
import type { DriveInfo, Frame, LayoutView } from "./view.ts";
import type { EvConfig } from "../../core/index.ts";
import { consumptionText, driveModeLabel, evField, evLamps, powerMeterScale, powerMeterValue, rangeText, socText } from "./ev-logic.ts";

type LampKey = keyof LampSet;
const LAMPS: { k: LampKey; color: "red" | "amber" | "ice"; icon: string; on: string; text?: string }[] = [
  { k: "park", color: "red", icon: BASE_ICON.park, on: "Feststellbremse angezogen" },
  { k: "battery", color: "red", icon: ICON2.battery, on: "Ladekontrolle: Lichtmaschine lädt nicht" },
  { k: "oil", color: "red", icon: ICON2.oil, on: "Öldruck zu niedrig" },
  { k: "coolant", color: "red", icon: ICON2.coolant, on: "Kühlmittel zu heiß" },
  { k: "engine", color: "amber", icon: ICON2.engine, on: "Motorkontrollleuchte" },
  { k: "glow", color: "amber", icon: ICON2.glow, on: "Vorglühen: Starter erst nach dem Erlöschen" },
  { k: "abs", color: "amber", icon: BASE_ICON.abs, on: "ABS" },
  { k: "esp", color: "amber", icon: BASE_ICON.esp, on: "ESP/ASR greift ein" },
  { k: "espOff", color: "amber", icon: BASE_ICON.esp, on: "ESP OFF", text: "OFF" },
  { k: "ice", color: "ice", icon: BASE_ICON.ice, on: "Glättegefahr" },
  { k: "fuel", color: "amber", icon: ICON2.fuel, on: "Tankreserve" },
  { k: "gearbox", color: "amber", icon: ICON2.gearbox, on: "Getriebe heiß" },
];

/** Shift-light LEDs of the head-up and motorcycle displays (#83). */
const SHIFT_LEDS = 10;
const SHIFT_HYST_RPM = 150;
const FLASH_HZ = 8;
/** Geometry of the rev arc of the digital design: centre (100|96), radius 84, 240° from lower left over the top. */
const ARC = { cx: 100, cy: 96, r: 84, start: 150, sweep: 240 };
const arcPt = (f: number, r = ARC.r) => {
  const a = ((ARC.start + f * ARC.sweep) * Math.PI) / 180;
  return [ARC.cx + Math.cos(a) * r, ARC.cy + Math.sin(a) * r] as const;
};
const ARC_D = (() => {
  const [x0, y0] = arcPt(0);
  const [x1, y1] = arcPt(1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${ARC.r} ${ARC.r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
})();
const arcPath = (cls: string) => `<path class="${cls}" d="${ARC_D}" pathLength="100"/>`;

const airCooled = (c: EngineConfig) => c.cooling.type === "air" || c.cooling.type === "oil-air";

interface Mini {
  id: string;
  dial: Dial;
  out: HTMLElement;
  unit: HTMLElement;
  cap: HTMLElement;
  wrap: HTMLElement;
  last: string;
}

export class CockpitView implements LayoutView {
  readonly el: HTMLElement;
  private speedo: Dial;
  private tacho: Dial;
  private minis: Record<"coolant" | "oilT" | "oilP" | "boost" | "fuel" | "tank", Mini>;
  private lampEls = new Map<LampKey, HTMLElement>();
  private lastLamps = "";
  private out: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private cfg!: EngineConfig;
  private summary!: EngineSummary;
  private info!: DriveInfo;
  private speedKey = "";
  private scaleSel: HTMLSelectElement;
  private customIn: HTMLInputElement;
  private scaleKey = "";
  /** Unit and range the consumption dial is drawn with (changes when the car starts or stops moving). */
  private fuelKey = "";
  private tankKey = "";
  private design: CockpitDesignId | "" = "";
  private designSel: HTMLSelectElement;
  private fieldBtns: HTMLButtonElement[] = [];
  private fieldCtx: FieldContext = { turbo: false, vehicle: false };
  private revbar: HTMLElement;
  private arcFill: SVGPathElement;
  private shiftLeds: HTMLElement[];
  private flashing = false;
  private rpmMax = 8000;
  private zones = { warnFrom: 0, redFrom: 0 };
  /** Additional gauges and tuning bar under the cluster (#83), in every design. */
  private extras = new CockpitExtras();
  /** The Renn-Dash design (#94): created the first time it is chosen. */
  private race: RaceView | null = null;
  /** Electric car (#108): the power meter replaces the rev counter, SoC the tank, Ready lamp; null = combustion. */
  private ev: EvConfig | null = null;
  private evScale = { min: -100, max: 500, major: 100, minor: 50 };
  private readyEl!: HTMLElement;
  /** Set by the app: next EV drive mode (Chill → Sport → Plaid). */
  onEvMode: () => void = () => {};
  /** Set by the app: switches the console to the chassis dyno. */
  onWantVehicle: () => void = () => {};
  /** Set by the app: jump to the Umwelt panel (route, weather, gradient). */
  onWantEnvironment: () => void = () => {};
  /** Place for the Tempomat-Leiste: the app moves the one cruise panel here while the cockpit is shown. */
  get cruiseSlot(): HTMLElement {
    return this.el.querySelector<HTMLElement>("[data-slot=cruise]")!;
  }

  constructor() {
    const el = document.createElement("section");
    el.className = "ck";
    el.setAttribute("aria-label", "Kombiinstrument");
    el.innerHTML = `
      <div class="ck__lamps" role="group" aria-label="Kontrollleuchten">
        ${LAMPS.map((l) => `<span class="ck-lamp ck-lamp--${l.color}" data-lamp="${l.k}" data-state="off" role="img" aria-label="${l.on}: aus">${l.icon}${l.text ? `<b>${l.text}</b>` : ""}</span>`).join("")}
        <span class="ck-lamp ck-lamp--green ck-lamp--ready" data-ev-lamp="ready" data-state="off" role="img" aria-label="Ready: aus"><b>READY</b></span>
      </div>
      <div class="ck__alt" data-slot="alt"></div>
      <div class="ck__main">
        <div class="ck__dial ck__dial--speed" data-slot="speed">
          <p class="ck__read num" aria-live="off"><span data-ck="speed">–</span> <small data-ck="speed-unit">km/h</small></p>
          <div class="ck__scale">
            <label><span>Design<span class="sr-only"> des Cockpits</span></span>
              <select data-control="ck-design">${DESIGN_CHOICES.map((d) => `<option value="${d.id}">${d.id === "auto" ? "Automatisch" : d.label}</option>`).join("")}</select>
            </label>
            <label data-ck-skala><span>Skala<span class="sr-only"> des Tachos</span></span>
              <select data-control="speedo-scale">${SPEEDO_SCALES.map((o) => `<option value="${o.id}">${o.label}${o.kmh ? ` · ${o.kmh} km/h` : ""}</option>`).join("")}</select>
            </label>
            <label data-ck-custom hidden><span class="sr-only">Eigene Skala</span>
              <input type="number" data-control="speedo-custom" min="100" max="600" step="20" inputmode="numeric" /> <small>km/h</small>
            </label>
          </div>
        </div>
        <div class="ck__mfd" role="group" aria-label="Mitteldisplay">
          <div class="ck__shift" aria-hidden="true">${ledColors(SHIFT_LEDS).map((c) => `<i data-color="${c}"></i>`).join("")}</div>
          <svg class="ck__arc" viewBox="0 0 200 150" aria-hidden="true">${arcPath("ck__arc-track")}${arcPath("ck__arc-warn")}${arcPath("ck__arc-red")}${arcPath("ck__arc-fill")}<g class="ck__arc-nums"></g></svg>
          <div class="ck__revbar" aria-hidden="true"><i class="ck__revbar-fill"></i><i class="ck__revbar-warn"></i><b class="ck__revbar-lamp"></b></div>
          <p class="ck__gear num"><span class="sr-only">Gang </span><span data-ck="gear">N</span></p>
          <button type="button" class="ck__mode" data-ck="mode"></button>
          <p class="ck__speed num"><span data-ck="speed-big">–</span><small data-ck="speed-unit2">km/h</small></p>
          <dl class="ck__hud num" aria-label="Drehzahl und Leistung">
            <div class="ck__hud-rpm"><dt data-ck="hud-rpm-label">Drehzahl</dt><dd><span data-ck="hud-rpm">0</span> <small data-ck="hud-rpm-unit">1/min</small></dd></div>
            <div><dt>Leistung</dt><dd><span data-ck="hud-power">0</span> <small data-ck="hud-power-unit">kW</small></dd></div>
          </dl>
          <p class="ck__dyno" data-ck="dyno" hidden>Motorprüfstand: kein Tempo.
            <button type="button" class="ck__btn" data-ck="to-vehicle">Auf die Rolle</button></p>
          <p class="ck__cruise num" data-ck="cruise" data-state="off" hidden>${ICON2.cruise}<span data-ck="cruise-text"></span></p>
          <p class="ck__grade num" data-ck="grade-row">
            <button type="button" class="ck__road" data-ck="road" title="Strecke und Umwelt einstellen"><span data-ck="grade">Strecke: eben</span> <span aria-hidden="true">›</span><span class="sr-only"> – Umwelt einstellen</span></button>
          </p>
          <dl class="ck__bike num" aria-label="Motorrad-Anzeigen">
            <div><dt data-ck="bike-cool-label">Kühlmittel</dt><dd data-ck="bike-cool">–</dd></div>
            <div><dt data-ck="bike-tank-label">Tank</dt><dd data-ck="bike-tank">–</dd></div>
            <div><dt>Trip</dt><dd data-ck="bike-trip">–</dd></div>
          </dl>
          <dl class="ck__truck num" aria-label="Nutzfahrzeug-Anzeigen">
            <div data-ck="eb-row" data-state="none"><dt data-ck="eb-label">Motorbremse</dt><dd data-ck="eb">–</dd></div>
            <div data-ck="gov-row" data-state="off"><dt>Begrenzer</dt><dd data-ck="gov">–</dd></div>
          </dl>
          <dl class="ck__ev num" aria-label="Elektroantrieb" hidden>
            <div class="ck__ev-soc"><dt>Akku</dt><dd data-ck="ev-soc">–</dd></div>
            <div class="ck__ev-range"><dt>Reichweite</dt><dd data-ck="ev-range">–</dd></div>
            <div class="ck__ev-cons"><dt>Verbrauch</dt><dd><span data-ck="ev-cons">–</span> <small data-ck="ev-cons-unit">kWh/100 km</small></dd></div>
            <div class="ck__ev-batt"><dt>Akkutemp.</dt><dd data-ck="ev-batt">–</dd></div>
            <div class="ck__ev-mode"><dt>Fahrmodus</dt><dd><button type="button" class="ck__btn" data-ck="ev-mode" title="Fahrmodus wechseln">Sport</button></dd></div>
          </dl>
          <dl class="ck__trip num">
            <div><dt>Außen</dt><dd><span data-ck="ambient">–</span></dd></div>
            <div><dt>Gesamt</dt><dd><span class="ck__odo" data-ck="total">0</span></dd></div>
            <div><dt>Trip A</dt><dd><span data-ck="trip">0</span></dd></div>
            <div><dt><abbr title="Durchschnittsverbrauch Trip A">Ø</abbr></dt><dd><span data-ck="avg">–</span></dd></div>
          </dl>
        </div>
        <div class="ck__dial ck__dial--rpm" data-slot="rpm">
          <p class="ck__read num" aria-live="off"><span data-ck="rpm">0</span> <small data-ck="rpm-unit">1/min</small></p>
        </div>
      </div>
      <div class="ck__fields" role="group" aria-label="Wählbare Anzeigen">
        ${[0, 1, 2].map((i) => `<button type="button" class="ck-field" data-field="${i}" aria-keyshortcuts="ArrowLeft ArrowRight"><span class="ck-field__lab"></span><b class="ck-field__val num"></b><small class="ck-field__unit"></small></button>`).join("")}
        <p class="ck__presets"><span>Belegung</span>${Object.entries(FIELD_PRESETS).map(([k, p]) => `<button type="button" class="ck__btn" data-preset="${k}">${p.label}</button>`).join("")}</p>
      </div>
      <div class="ck__minis"></div>
      <div class="ck__cruisectl" data-slot="cruise"></div>`;
    this.el = el;
    el.querySelectorAll<HTMLElement>("[data-ck]").forEach((n) => (this.out[n.dataset.ck!] = n));
    el.querySelectorAll<HTMLElement>("[data-lamp]").forEach((n) => this.lampEls.set(n.dataset.lamp as LampKey, n));
    this.out["to-vehicle"]!.addEventListener("click", () => this.onWantVehicle());
    this.out["road"]!.addEventListener("click", () => this.onWantEnvironment());
    this.out["ev-mode"]!.addEventListener("click", () => this.onEvMode());
    this.readyEl = el.querySelector<HTMLElement>("[data-ev-lamp=ready]")!;

    const blank: DialScale = { min: 0, max: 100, major: 20, minor: 10, caption: "" };
    this.speedo = new Dial(blank, { label: "Tacho" });
    this.tacho = new Dial(blank, { label: "Drehzahlmesser" });
    const tube = (c: HTMLCanvasElement) => {
      // the "tube" is plain in most designs; the sport saloon turns it into a deep cannocchiale (CSS only)
      const t = document.createElement("div");
      t.className = "ck__tube";
      t.append(c);
      return t;
    };
    el.querySelector("[data-slot=speed]")!.prepend(tube(this.speedo.canvas));
    // speedometer scale (stored in the settings, also choosable on the settings screen)
    this.scaleSel = el.querySelector<HTMLSelectElement>("[data-control=speedo-scale]")!;
    this.customIn = el.querySelector<HTMLInputElement>("[data-control=speedo-custom]")!;
    this.scaleSel.addEventListener("change", () => isSpeedoScale(this.scaleSel.value) && setSettings({ speedo: this.scaleSel.value }));
    this.customIn.addEventListener("change", () => {
      // show the value that is stored (on a 20 km/h step, within 100–600)
      const v = clampSpeedoKmh(this.customIn.valueAsNumber);
      this.customIn.value = String(v);
      setSettings({ speedoCustomKmh: v });
    });
    el.querySelector("[data-slot=rpm]")!.prepend(tube(this.tacho.canvas));
    this.designSel = el.querySelector<HTMLSelectElement>("[data-control=ck-design]")!;
    this.designSel.addEventListener("change", () => isCockpitChoice(this.designSel.value) && setSettings({ cockpitDesign: this.designSel.value }));
    this.arcFill = el.querySelector<SVGPathElement>(".ck__arc-fill")!;
    this.revbar = el.querySelector<HTMLElement>(".ck__revbar")!;
    this.shiftLeds = [...el.querySelectorAll<HTMLElement>(".ck__shift i")];
    // drive mode of the sport-saloon display: a name for the gas response (#66), a tap steps through it
    this.out.mode!.addEventListener("click", () => {
      if (this.ev) return this.onEvMode();
      const ramps = GAS_RAMPS.map((g) => g.s);
      const i = ramps.indexOf(getSettings().gasRamp);
      setSettings({ gasRamp: ramps[(i + 1) % ramps.length]! });
    });
    // switchable fields (digital): tap or Enter = next value, arrow keys = next/previous
    this.fieldBtns = [...el.querySelectorAll<HTMLButtonElement>(".ck-field")];
    const cycle = (slot: number, dir: 1 | -1) => {
      const f = [...getSettings().ckFields] as FieldSet;
      // step from what the field shows (a stored value the engine cannot deliver is already replaced)
      f[slot] = nextField(shownField(f[slot]!, this.fieldCtx), dir, this.fieldCtx);
      setSettings({ ckFields: f });
      this.last[`field${slot}`] = "";
    };
    this.fieldBtns.forEach((b, i) => {
      b.addEventListener("click", () => cycle(i, 1));
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation(); // not the gas lever
        cycle(i, e.key === "ArrowRight" ? 1 : -1);
      });
    });
    el.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) =>
      b.addEventListener("click", () => {
        setSettings({ ckFields: [...FIELD_PRESETS[b.dataset.preset as keyof typeof FIELD_PRESETS].fields] });
        for (let i = 0; i < 3; i++) this.last[`field${i}`] = "";
      }),
    );

    const host = el.querySelector(".ck__minis")!;
    const mk = (id: string): Mini => {
      const wrap = document.createElement("figure");
      wrap.className = "ck-mini";
      wrap.dataset.mini = id;
      const dial = new Dial(blank, { small: true, label: id });
      wrap.innerHTML = `<figcaption><span class="ck-mini__cap"></span> <b class="num ck-mini__val">–</b> <small class="ck-mini__unit"></small></figcaption>`;
      wrap.prepend(dial.canvas);
      host.append(wrap);
      return { id, dial, wrap, out: wrap.querySelector(".ck-mini__val")!, unit: wrap.querySelector(".ck-mini__unit")!, cap: wrap.querySelector(".ck-mini__cap")!, last: "" };
    };
    this.minis = { coolant: mk("coolant"), oilT: mk("oil-temp"), oilP: mk("oil-pressure"), boost: mk("boost"), fuel: mk("fuel"), tank: mk("tank") };
    host.after(this.extras.el);
  }

  configure(cfg: EngineConfig, summary: EngineSummary, info: DriveInfo) {
    this.cfg = cfg;
    this.summary = summary;
    this.info = info;
    const rmax = tachoMax(cfg.revLimitRpm);
    this.scaleTacho();
    this.speedKey = "";
    // rev arc (digital) and rev bar (motorcycle): same zones as the rev counter
    this.rpmMax = rmax;
    this.zones = tachoZones(cfg.revLimitRpm, summary.safeMaxRpm);
    const f = (rpm: number) => Math.min(100, Math.max(0, (rpm / rmax) * 100));
    const band = (sel: string, from: number, to: number) =>
      this.el.querySelector<SVGPathElement>(sel)!.style.setProperty("stroke-dasharray", `0 ${f(from).toFixed(2)} ${(f(to) - f(from)).toFixed(2)} 100`);
    band(".ck__arc-warn", this.zones.warnFrom, this.zones.redFrom);
    band(".ck__arc-red", this.zones.redFrom, rmax);
    const nums = this.el.querySelector(".ck__arc-nums")!;
    const step = rmax > 12000 ? 2000 : 1000;
    let svg = "";
    for (let r = 0; r <= rmax; r += step) {
      const [x, y] = arcPt(r / rmax, ARC.r - 15);
      svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="${r >= this.zones.redFrom ? "is-red" : ""}">${r / 1000}</text>`;
    }
    nums.innerHTML = svg;
    this.el.style.setProperty("--ck-warn-at", `${f(this.zones.warnFrom).toFixed(2)}%`);
    this.fieldCtx = { ...this.fieldCtx, turbo: summary.limits.boostMaxBar > 0 };
    if (!this.ev) this.out["bike-cool-label"]!.textContent = airCooled(cfg) ? "Zyl.-Kopf" : "Kühlmittel";
    this.race?.configure(cfg, summary, info);
    this.extras.configure(cfg, summary);
    this.syncUnits();
  }

  /**
   * Rev counter scale: the car scale (× 1000) or, in the truck design, the commercial-vehicle scale (× 100) with the
   * green economy band from the full-load curve (#83).
   */
  private scaleTacho() {
    if (!this.cfg) return;
    if (this.ev) {
      // EV (#108): power meter, regen below zero in green (every design, also the truck one)
      const p = this.evScale;
      this.tacho.setScale({ min: p.min, max: p.max, major: p.major, minor: p.minor, labelDiv: 1, eco: { from: p.min, to: 0 }, caption: "kW" });
      return;
    }
    const cfg = this.cfg;
    // yellow pre-warning (Gelb heißt Grenze), red from the limiter on like in a real car (design.md "Cockpit-Layout")
    const z = tachoZones(cfg.revLimitRpm, this.summary.safeMaxRpm);
    if (this.design === "truck") {
      const t = truckTachoScale(cfg.revLimitRpm);
      this.tacho.setScale({
        min: 0, max: t.max, major: t.major, minor: t.minor, labelDiv: t.labelDiv,
        zone: { from: z.warnFrom, to: z.redFrom }, red: { from: z.redFrom, to: t.max }, eco: economyBand(this.info.fullLoad) ?? undefined,
        caption: "1/min × 100",
      });
      return;
    }
    const rmax = tachoMax(cfg.revLimitRpm);
    this.tacho.setScale({
      min: 0, max: rmax, major: 1000, minor: rmax > 9000 ? 500 : 250, labelDiv: 1000,
      zone: { from: z.warnFrom, to: z.redFrom }, red: { from: z.redFrom, to: rmax },
      caption: "1/min × 1000",
    });
  }

  /** Puts the design on the root (CSS tokens and arrangement) and its drawing style on every dial (#83). */
  private applyDesign(id: CockpitDesignId) {
    if (id === this.design) return;
    const truckChange = id === "truck" || this.design === "truck";
    this.design = id;
    if (truckChange) {
      this.scaleTacho();
      this.speedKey = "";
    }
    this.el.dataset.design = id;
    if (id === "race" && !this.race) {
      this.race = new RaceView();
      this.race.configure(this.cfg, this.summary, this.info);
      this.race.setElectric(this.ev);
      this.el.querySelector("[data-slot=alt]")!.append(this.race.el);
    }
    const t = dialTheme(id);
    for (const d of [this.speedo, this.tacho, ...Object.values(this.minis).map((m) => m.dial)]) d.setTheme(t);
    this.extras.setTheme(t);
    for (const k of Object.keys(this.last)) this.last[k] = "";
    this.redraw();
  }

  /**
   * Electric car on (#108) or off (null): power meter instead of the rev counter, battery and motor temperature instead
   * of coolant and oil, state of charge instead of the tank, consumption in kWh, Ready lamp; in every design.
   */
  setElectric(ev: EvConfig | null) {
    this.ev = ev;
    this.el.dataset.drive = ev ? "ev" : "ice";
    (this.el.querySelector(".ck__ev") as HTMLElement).hidden = !ev;
    if (ev) this.evScale = powerMeterScale(ev);
    this.out["rpm-unit"]!.textContent = ev ? "kW" : "1/min";
    this.out["hud-rpm-label"]!.textContent = ev ? "Akku" : "Drehzahl";
    this.out["hud-rpm-unit"]!.textContent = ev ? "%" : "1/min";
    this.out["bike-tank-label"]!.textContent = ev ? "Akku" : "Tank";
    this.out["eb-label"]!.textContent = ev ? "Rekuperation" : "Motorbremse";
    this.out["bike-cool-label"]!.textContent = ev ? "Akku" : this.cfg && airCooled(this.cfg) ? "Zyl.-Kopf" : "Kühlmittel";
    this.race?.setElectric(ev);
    this.scaleTacho();
    this.syncUnits();
    this.redraw();
  }

  syncUnits() {
    if (!this.cfg) return;
    if (this.ev) return this.syncUnitsEv();
    const u = prefs();
    const T = (c: number) => toUnit("temp", c, u.temp);
    const P = (b: number) => toUnit("pressure", b, u.pressure);
    const L = this.summary.limits;
    const air = airCooled(this.cfg);
    const hot = air ? 300 : 130;
    const tScale = (lo: number, hi: number, zone: number): DialScale => {
      const a = T(lo);
      const b = T(hi);
      const step = (b - a) / 4;
      return { min: a, max: b, major: step, minor: step / 2, zone: { from: T(zone), to: b }, caption: u.temp };
    };
    this.setMini("coolant", air ? "Zyl.-Kopf" : "Kühlmittel", u.temp, tScale(air ? 60 : 50, hot, Math.min(hot, air ? 220 : L.coolantMaxC)));
    this.setMini("oilT", "Öl", u.temp, tScale(50, 150, Math.min(150, L.oilMaxC)));
    const pMax = P(6);
    this.setMini("oilP", "Öldruck", u.pressure, { min: 0, max: pMax, major: pMax / 3, minor: pMax / 6, zone: { from: 0, to: P(L.oilPressureMinBar) }, caption: u.pressure });
    this.minis.oilP.wrap.hidden = false;
    const turbo = L.boostMaxBar > 0;
    this.minis.boost.wrap.hidden = !turbo;
    if (turbo) {
      const bMax = P(Math.max(1, Math.ceil(L.boostMaxBar * 1.25 * 2) / 2));
      this.setMini("boost", "Ladedruck", u.pressure, { min: 0, max: bMax, major: bMax / 2, minor: bMax / 4, zone: { from: P(L.boostMaxBar), to: bMax }, caption: u.pressure });
    }
    // momentary consumption: l/100 km (or mpg) while driving, l/h at standstill like a real board computer
    this.fuelKey = "";
    this.tankKey = "";
    this.out["speed-unit"]!.textContent = this.out["speed-unit2"]!.textContent = u.speed;
    this.out["hud-power-unit"]!.textContent = u.power;
    this.race?.syncUnits();
    this.extras.syncUnits();
    this.speedKey = "";
    for (const k of Object.keys(this.last)) this.last[k] = "";
    for (const m of Object.values(this.minis)) m.last = "";
    this.lastLamps = "";
  }

  /** Small instruments of an electric car (#108): battery and motor temperature, consumption (kWh), state of charge. */
  private syncUnitsEv() {
    const u = prefs();
    const T = (c: number) => toUnit("temp", c, u.temp);
    const tScale = (lo: number, hi: number, zone: number): DialScale => {
      const a = T(lo);
      const b = T(hi);
      return { min: a, max: b, major: (b - a) / 4, minor: (b - a) / 8, zone: { from: T(zone), to: b }, caption: u.temp };
    };
    this.setMini("coolant", "Akkutemp.", u.temp, tScale(0, 70, 55));
    this.setMini("oilT", "E-Motor", u.temp, tScale(20, 180, 150));
    this.minis.oilP.wrap.hidden = true;
    this.minis.boost.wrap.hidden = true;
    const c = consumptionText(0, u);
    this.setMini("fuel", "Verbrauch", c.unit, { min: 0, max: 40, major: 10, minor: 5, caption: c.unit });
    this.setMini("tank", "Akku", "%", { min: 0, max: 100, major: 50, minor: 25, zone: { from: 0, to: 10 }, caption: "0 · 100 %" });
    this.out["speed-unit"]!.textContent = this.out["speed-unit2"]!.textContent = u.speed;
    this.out["hud-power-unit"]!.textContent = u.power;
    this.race?.syncUnits();
    this.extras.syncUnits();
    this.fuelKey = "ev";
    this.tankKey = "ev";
    this.speedKey = "";
    for (const k of Object.keys(this.last)) this.last[k] = "";
    for (const m of Object.values(this.minis)) m.last = "";
    this.lastLamps = "";
  }

  private setMini(k: keyof CockpitView["minis"], cap: string, unit: string, scale: DialScale) {
    const m = this.minis[k];
    m.cap.textContent = cap;
    m.unit.textContent = unit;
    m.dial.setScale({ ...scale, ends: true });
    m.wrap.title = `${cap}, Skala ${fmt(scale.min)} bis ${fmt(scale.max)} ${unit}`;
  }

  redraw() {
    for (const d of [this.speedo, this.tacho, ...Object.values(this.minis).map((m) => m.dial)]) {
      d.invalidate();
      d.draw(true);
    }
    this.extras.redraw();
  }

  private put(k: string, v: string) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.out[k]!.textContent = v;
  }

  private mini(k: keyof CockpitView["minis"], shown: number, text: string, dt: number) {
    const m = this.minis[k];
    m.dial.set(shown, dt);
    if (m.last !== text) m.out.textContent = m.last = text;
  }

  update(f: Frame) {
    const { s, dt } = f;
    const u = prefs();
    const d = f.drivetrain;
    const ds = d.state;
    const vehicle = f.mode === "vehicle";
    // speed scale: the chosen one (Standard 240 … Vmax-Killer 500, own) or, on "auto", the car's top speed
    const st = getSettings();
    const sKey = `${st.speedo}|${st.speedoCustomKmh}`;
    if (sKey !== this.scaleKey) {
      this.scaleKey = sKey;
      this.scaleSel.value = st.speedo;
      if (document.activeElement !== this.customIn) this.customIn.value = String(st.speedoCustomKmh);
      (this.customIn.closest("[data-ck-custom]") as HTMLElement).hidden = st.speedo !== "custom";
    }
    if (this.designSel.value !== st.cockpitDesign) this.designSel.value = st.cockpitDesign;
    this.applyDesign(resolveDesign(st.cockpitDesign, d.kind, !!this.ev));
    const vmaxShown = toUnit("speed", this.info.vmaxKmh, u.speed);
    const truck = this.design === "truck";
    // truck design (#83): fixed 125 km/h scale with the vehicle's top-speed limiter (Directive 92/6/EEC) marked
    const smax = truck ? truckSpeedScale(u.speed).max : speedoScaleMax(st.speedo, st.speedoCustomKmh, vmaxShown, u.speed);
    const govShown = truck && ds.speedLimitKmh !== null ? toUnit("speed", ds.speedLimitKmh, u.speed) : Number.NaN;
    const gov = govShown <= smax ? govShown : undefined;
    const spKey = `${smax}|${u.speed}|${truck}|${gov}`;
    if (spKey !== this.speedKey) {
      this.speedKey = spKey;
      const t = truck ? truckSpeedScale(u.speed) : speedoTicks(smax, u.speed);
      this.speedo.setScale({ min: 0, max: smax, major: t.major, minor: t.minor, caption: u.speed, stop: gov });
    }
    const speed = vehicle ? toUnit("speed", ds.speedKmh, u.speed) : 0;
    this.speedo.dimmed = !vehicle;
    // cruise control (green band up to the set speed, arrow) and limiter (orange arrow) on the scale
    const cc = vehicle ? ds.cruise : undefined;
    this.speedo.setMarks(
      cc && cc.mode !== "off" && cc.setKmh !== null ? toUnit("speed", cc.setKmh, u.speed) : null,
      cc?.limiterOn ? toUnit("speed", cc.limitKmh, u.speed) : null,
    );
    this.speedo.set(speed, dt);
    this.tacho.set(this.ev && s.ev ? powerMeterValue(s.ev, this.evScale) : s.rpm, dt);
    const speedText = vehicle ? fmt(speed) : "–";
    this.put("speed", speedText);
    this.put("speed-big", speedText);
    this.put("rpm", this.ev && s.ev ? fmt(Math.round(s.ev.powerKw)) : fmt(Math.round(s.rpm / 10) * 10));
    this.put("gear", vehicle ? (ds.shifting && ds.type === "manual" ? "–" : d.gearLabel()) : "–");
    if (this.last.dyno !== String(vehicle)) {
      this.last.dyno = String(vehicle);
      this.out.dyno!.hidden = vehicle;
      this.el.classList.toggle("is-engine-dyno", !vehicle);
    }
    // board computer: odometer whole km, trip one decimal, average of trip A
    const { total, tripA } = f.trip;
    this.put("ambient", `${fmt(toUnit("temp", d.environment.ambientC, u.temp))} ${u.temp}`);
    // a gradient set under Umwelt is driven as a hill: shown here so a car rolling away in N is explained
    // the road (#48): route with altitude, or the fixed gradient; a tap leads to the Umwelt panel
    const env = d.environment;
    const g = d.state.roadGradePct ?? env.gradePct;
    const slope = Math.abs(g) < 0.05 ? "eben" : `${g > 0 ? "Steigung" : "Gefälle"} ${fmt(Math.abs(g), Number.isInteger(g) ? 0 : 1)} %`;
    const terrain = env.terrain ?? "static";
    let road: string;
    if (terrain === "static") road = `Strecke: ${slope}`;
    else {
      const alt = d.state.roadAltitudeM ?? 0;
      const altText = u.distance === "mi" ? `${fmt(alt * 3.28084)} ft` : `${fmt(alt)} m`;
      road = `${TERRAIN_LABELS[terrain]} · ${altText} · ${slope}`;
    }
    this.put("grade", road);
    this.out["grade-row"]!.classList.toggle("is-hill", Math.abs(g) >= 0.05);
    this.putOdo(fmt(Math.floor(toUnit("distance", total.km, u.distance))), u.distance);
    this.put("trip", `${fmt(toUnit("distance", tripA.km, u.distance), 1)} ${u.distance}`);
    const avg = toUnit("fuel", avgL100(tripA.km, tripA.fuelL), u.fuel);
    this.put("avg", `${Number.isFinite(avg) ? fmt(avg, 1) : "–"} ${u.fuel}`);
    this.updateCruise(d);

    if (this.ev && s.ev) {
      this.updateEv(f);
      return;
    }
    // small instruments
    const T = (c: number) => toUnit("temp", c, u.temp);
    const P = (b: number) => toUnit("pressure", b, u.pressure);
    const pd = u.pressure === "bar" ? 1 : 0;
    this.mini("coolant", T(s.coolantC), fmt(T(s.coolantC)), dt);
    this.mini("oilT", T(s.oilC), fmt(T(s.oilC)), dt);
    this.mini("oilP", P(s.oilPressureBar), fmt(P(s.oilPressureBar), pd), dt);
    if (!this.minis.boost.wrap.hidden) this.mini("boost", P(Math.max(0, s.boostBar)), fmt(P(Math.max(0, s.boostBar)), pd), dt);
    const kmh = vehicle ? ds.speedKmh : 0;
    // momentary consumption in the chosen unit: per distance while driving, per hour at standstill (#26 review)
    const moving = kmh > 5;
    const fs = fuelScale(u.fuel, moving);
    const key = `${fs.unit}|${fs.max}`;
    if (key !== this.fuelKey) {
      this.fuelKey = key;
      this.setMini("fuel", "Verbrauch", fs.unit, { min: 0, max: fs.max, major: fs.major, minor: fs.major / 2, caption: fs.unit });
      this.minis.fuel.last = "";
      this.minis.fuel.dial.draw(true);
    }
    const l100 = moving && s.running ? (s.fuelFlowLh / kmh) * 100 : Number.NaN;
    const fuelVal = moving ? (s.running ? toUnit("fuel", l100, u.fuel) : Number.NaN) : u.fuel === "mpg" ? s.fuelFlowLh / 3.785411784 : s.fuelFlowLh;
    const fuelText = Number.isFinite(fuelVal) ? fmt(fuelVal, 1) : "–";
    // tank (chassis dyno): E…F like a real fuel gauge, reserve zone amber, content in l (or US gal)
    const tank = d.tank;
    this.minis.tank.wrap.hidden = !vehicle;
    if (vehicle) {
      const gal = u.fuel === "mpg";
      const capShown = gal ? tank.capacityL / 3.785411784 : tank.capacityL;
      const tk = `${capShown}|${gal}`;
      if (tk !== this.tankKey) {
        this.tankKey = tk;
        this.setMini("tank", "Tank", gal ? "gal" : "l", { min: 0, max: capShown, major: capShown / 2, minor: capShown / 4, zone: { from: 0, to: capShown * RESERVE_SHARE }, caption: "E · F" });
        this.minis.tank.last = "";
        this.minis.tank.dial.draw(true);
      }
      const lv = gal ? tank.levelL / 3.785411784 : tank.levelL;
      this.mini("tank", lv, fmt(lv, gal ? 1 : 0), dt);
    }
    // km/l and mpg: coasting with no fuel reads off the scale end; unknown values rest at 0
    this.mini("fuel", Number.isFinite(fuelVal) ? fuelVal : moving && u.fuel !== "l/100 km" && s.running ? fs.max : 0, fuelText, dt);

    this.updateLamps(f);
    this.updateRev(f);
    this.extras.update(f);
    // design-specific readouts are only fed while their design is shown
    const design = this.design;
    if (design === "digital") this.updateFields(f, l100, u, st.ckFields);
    if (design === "race") this.race?.update(f);
    if (design === "hud") {
      this.put("hud-rpm", fmt(Math.round(s.rpm / 10) * 10));
      this.put("hud-power", fmt(toUnit("power", Math.max(0, s.powerKw), u.power)));
    }
    if (design === "italian") {
      const mode = driveModeWord(st.gasRamp);
      if (this.last.mode !== mode) {
        this.put("mode", mode);
        this.out.mode!.setAttribute("aria-label", `Fahrmodus: ${mode} – antippen zum Wechseln`);
      }
    }
    if (design === "truck") this.updateTruck(f);
    if (design === "motorrad") {
      const bikeCool = formatField("coolant", { coolantC: s.coolantC, airCooled: airCooled(this.cfg) } as FieldInputs, u);
      this.put("bike-cool", `${bikeCool.value} ${bikeCool.unit}`);
      const gal = u.fuel === "mpg";
      this.put("bike-tank", vehicle ? `${fmt(gal ? d.tank.levelL / 3.785411784 : d.tank.levelL, gal ? 1 : 0)} ${gal ? "gal" : "l"}` : "–");
      this.put("bike-trip", `${fmt(toUnit("distance", tripA.km, u.distance), 1)} ${u.distance}`);
    }
  }

  /**
   * Electric car (#108), every design: small instruments (battery, motor, consumption, SoC), the EV line in the centre
   * display, Ready and the remaining lamps, and the design-specific readouts with EV values.
   */
  private updateEv(f: Frame) {
    const { s, dt } = f;
    const ev = s.ev!;
    const u = prefs();
    const st = getSettings();
    const vehicle = f.mode === "vehicle";
    const T = (c: number) => toUnit("temp", c, u.temp);
    this.mini("coolant", T(ev.batteryC), fmt(T(ev.batteryC)), dt);
    this.mini("oilT", T(ev.motorC), fmt(T(ev.motorC)), dt);
    const cons = consumptionText(ev.kwhPer100, u);
    // at standstill (or regen) the consumption dial rests; the text says "–"
    const cv = Number.parseFloat(cons.value.replace(/\./g, "").replace(",", "."));
    this.mini("fuel", Number.isFinite(cv) ? Math.max(0, Math.min(40, cv)) : 0, cons.value, dt);
    this.minis.tank.wrap.hidden = false;
    this.mini("tank", ev.soc * 100, fmt(Math.round(ev.soc * 100)), dt);
    this.put("ev-soc", socText(ev.soc));
    this.put("ev-range", rangeText(ev.rangeKm, u));
    this.put("ev-cons", cons.value);
    this.put("ev-cons-unit", cons.unit);
    this.put("ev-batt", `${fmt(T(ev.batteryC))} ${u.temp}`);
    this.put("ev-mode", driveModeLabel(ev.driveMode));
    this.out["ev-soc"]!.parentElement!.classList.toggle("is-limit", ev.soc < 0.1);
    this.out["ev-batt"]!.parentElement!.classList.toggle("is-limit", ev.batteryC > 55);
    this.out["ev-mode"]!.dataset.mode = ev.driveMode;
    // average consumption of trip A in kWh instead of litres
    const trip = consumptionText(ev.tripKwhPer100, u);
    this.put("avg", `${trip.value} ${trip.unit}`);
    this.updateLamps(f);
    this.updateRev(f);
    this.extras.update(f);
    const design = this.design;
    if (design === "digital") this.updateFieldsEv(f, st.ckFields);
    if (design === "race") this.race?.update(f);
    if (design === "hud") {
      this.put("hud-rpm", fmt(Math.round(ev.soc * 100)));
      this.put("hud-power", fmt(toUnit("power", ev.powerKw, u.power)));
    }
    if (design === "italian") this.put("mode", driveModeLabel(ev.driveMode));
    if (design === "truck") {
      this.updateTruck(f);
      this.put("eb", ev.regenKw > 1 ? `${fmt(toUnit("power", ev.regenKw, u.power))} ${u.power}` : "–");
      this.out["eb-row"]!.dataset.state = ev.regenKw > 1 ? "active" : "on";
    }
    if (design === "motorrad") {
      this.put("bike-cool", `${fmt(T(ev.batteryC))} ${u.temp}`);
      this.put("bike-tank", vehicle ? socText(ev.soc) : "–");
      this.put("bike-trip", `${fmt(toUnit("distance", f.trip.tripA.km, u.distance), 1)} ${u.distance}`);
    }
  }

  /** Digital fields of an EV (#108): same slots, EV quantities (ev-logic.ts evField). */
  private updateFieldsEv(f: Frame, stored: FieldSet) {
    const u = prefs();
    stored.forEach((storedId: FieldId, i) => {
      const t = evField(storedId, f.s, u) ?? formatField(shownField(storedId, this.fieldCtx), this.fieldInputs(f), u, this.summary.limits);
      const key = `${t.label}|${t.value}|${t.unit}|${t.warn}`;
      if (this.last[`field${i}`] === key) return;
      this.last[`field${i}`] = key;
      const b = this.fieldBtns[i]!;
      b.querySelector(".ck-field__lab")!.textContent = t.label;
      b.querySelector(".ck-field__val")!.textContent = t.value;
      b.querySelector(".ck-field__unit")!.textContent = t.unit;
      b.classList.toggle("is-limit", t.warn);
      if (b.dataset.name !== t.label) {
        b.dataset.name = t.label;
        b.setAttribute("aria-label", fieldAriaLabel(i, t.label));
      }
    });
  }

  /** Field inputs that are the same for both drives (speed, power, road, sprint, ambient). */
  private fieldInputs(f: Frame): FieldInputs {
    const { s } = f;
    const d = f.drivetrain;
    const ds = d.state;
    const vehicle = f.mode === "vehicle";
    return {
      coolantC: s.coolantC, oilC: s.oilC, oilPressureBar: s.oilPressureBar, boostBar: s.boostBar, egtC: s.egtC,
      fuelFlowLh: s.fuelFlowLh, speedKmh: vehicle ? ds.speedKmh : 0, running: s.running, tankLevelL: Number.NaN,
      avgL100: Number.NaN, powerKw: s.powerKw, torqueNm: s.torqueNm, lambda: s.lambda,
      altitudeM: (d.environment.terrain ?? "static") === "static" ? Number.NaN : ds.roadAltitudeM ?? Number.NaN,
      gradePct: ds.roadGradePct ?? d.environment.gradePct, t0to100S: ds.t0to100S, t0to100Running: ds.t0to100Running,
      ambientC: d.environment.ambientC, airCooled: false,
    };
  }

  /** Engine brake and top-speed limiter of the truck design (#83). No retarder, air brake or AdBlue: not in the core. */
  private updateTruck(f: Frame) {
    const u = prefs();
    const ds = f.drivetrain.state;
    const eb = engineBrakeInfo(this.cfg, !!f.s.engineBrakeActive, f.s.powerKw, u);
    this.put("eb", eb.value);
    const row = this.out["eb-row"]!;
    row.dataset.state = eb.state;
    row.title = eb.kind ? `Motorbremse: ${eb.kind}` : "";
    const lim = ds.speedLimitKmh;
    this.put("gov", lim === null ? "aus" : `${fmt(toUnit("speed", lim, u.speed))} ${u.speed}${ds.limiting ? " · regelt" : ""}`);
    this.out["gov-row"]!.dataset.state = lim === null ? "off" : ds.limiting ? "active" : "on";
  }

  /** Odometer as single digits: plain text in most designs, number drums in the oldschool one (CSS). */
  private putOdo(digits: string, unit: string) {
    const k = `${digits}|${unit}`;
    if (this.last.total === k) return;
    this.last.total = k;
    const n = this.out.total!;
    n.innerHTML = `<span class="sr-only">${digits} ${unit}</span><span class="ck__drums" aria-hidden="true">${"0".repeat(Math.max(0, 6 - digits.replace(/\D/g, "").length)).replace(/0/g, '<span class="ck__drum ck__drum--pad">0</span>')}${[...digits].map((c) => `<span class="ck__drum${/\d/.test(c) ? "" : " ck__drum--sep"}">${c}</span>`).join("")}</span><span aria-hidden="true"> ${unit}</span>`;
  }

  /** Rev arc, rev bar and shift lights (digital, head-up, motorcycle). Same shift point as the Renn-Dash. */
  private updateRev(f: Frame) {
    if (this.design !== "digital" && this.design !== "hud" && this.design !== "motorrad") return;
    const { s } = f;
    const ds = f.drivetrain.state;
    const vehicle = f.mode === "vehicle";
    if (this.ev && s.ev) {
      // EV (#108): the arc / bar shows the drive power share, no shift light (no gears)
      const pct = Math.min(100, Math.max(0, (s.ev.powerKw / this.evScale.max) * 100));
      const band = s.ev.regenKw > 1 ? "regen" : "normal";
      const key = `ev|${pct.toFixed(1)}|${band}`;
      if (key === this.last.rev) return;
      this.last.rev = key;
      this.arcFill.style.setProperty("stroke-dasharray", `${pct.toFixed(2)} 100`);
      this.revbar.style.setProperty("--ck-rpm", `${pct.toFixed(2)}%`);
      this.el.dataset.band = band;
      this.el.dataset.shift = "off";
      this.shiftLeds.forEach((l, i) => (l.dataset.on = String(i < Math.round((pct / 100) * SHIFT_LEDS))));
      return;
    }
    const rpm = s.running ? s.rpm : 0;
    const pct = Math.min(100, (rpm / this.rpmMax) * 100);
    const shiftRpm = vehicle && ds.gear > 0 && ds.type !== "cvt" && ds.gear < ds.gearCount ? this.info.shiftRpm(ds.gear) : vehicle ? this.cfg.revLimitRpm : this.summary.peakPowerRpm;
    const sl = shiftLights(rpm, shiftRpm, SHIFT_LEDS);
    this.flashing = sl.flash || (this.flashing && s.running && s.rpm > shiftRpm - SHIFT_HYST_RPM);
    const on = this.flashing ? reducedMotion() || Math.floor(s.t * FLASH_HZ * 2) % 2 === 0 : true;
    // colour of the arc/bar: normal, signal yellow in the pre-warning zone, red from the limiter, blinking at the shift point
    const band = rpm >= this.zones.redFrom ? "red" : rpm >= this.zones.warnFrom ? "warn" : this.flashing ? "shift" : "normal";
    const key = `${pct.toFixed(1)}|${sl.lit}|${this.flashing}|${on}|${band}`;
    if (key === this.last.rev) return;
    this.last.rev = key;
    this.arcFill.style.setProperty("stroke-dasharray", `${pct.toFixed(2)} 100`);
    this.revbar.style.setProperty("--ck-rpm", `${pct.toFixed(2)}%`);
    this.el.dataset.band = band;
    this.el.dataset.shift = this.flashing ? (on ? "on" : "blink") : "off";
    this.shiftLeds.forEach((l, i) => (l.dataset.on = String(this.flashing ? on : i < sl.lit)));
  }

  /** The three switchable fields of the digital design: value, unit, limit colour and accessible name. */
  private updateFields(f: Frame, l100Now: number, u: ReturnType<typeof prefs>, stored: FieldSet) {
    const { s } = f;
    const d = f.drivetrain;
    const ds = d.state;
    const vehicle = f.mode === "vehicle";
    const intakeAirC = intakeAirOf(s);
    this.fieldCtx = { ...this.fieldCtx, vehicle, intakeAir: Number.isFinite(intakeAirC) };
    const avg = avgL100(f.trip.tripA.km, f.trip.tripA.fuelL);
    const v: FieldInputs = {
      coolantC: s.coolantC, oilC: s.oilC, oilPressureBar: s.oilPressureBar, boostBar: s.boostBar, egtC: s.egtC,
      fuelFlowLh: s.fuelFlowLh, speedKmh: vehicle ? ds.speedKmh : 0, running: s.running, tankLevelL: vehicle ? d.tank.levelL : Number.NaN,
      // range from the trip average; on a fresh trip from the momentary consumption
      avgL100: Number.isFinite(avg) ? avg : l100Now, powerKw: s.powerKw, torqueNm: s.torqueNm, lambda: s.lambda,
      altitudeM: (d.environment.terrain ?? "static") === "static" ? Number.NaN : ds.roadAltitudeM ?? Number.NaN,
      gradePct: ds.roadGradePct ?? d.environment.gradePct, t0to100S: ds.t0to100S, t0to100Running: ds.t0to100Running,
      ambientC: d.environment.ambientC, airCooled: airCooled(this.cfg), intakeAirC,
      gearboxOilC: vehicle ? ds.gearboxOilC ?? Number.NaN : Number.NaN, gearboxOilWarn: !!ds.gearboxOilWarn,
    };
    stored.forEach((storedId: FieldId, i) => {
      const id = shownField(storedId, this.fieldCtx);
      const t = formatField(id, v, u, this.summary.limits);
      const key = `${t.label}|${t.value}|${t.unit}|${t.warn}`;
      if (this.last[`field${i}`] === key) return;
      this.last[`field${i}`] = key;
      const b = this.fieldBtns[i]!;
      b.querySelector(".ck-field__lab")!.textContent = t.label;
      b.querySelector(".ck-field__val")!.textContent = t.value;
      b.querySelector(".ck-field__unit")!.textContent = t.unit;
      b.classList.toggle("is-limit", t.warn);
      // the name changes with the field, not with every value (no chatter for screen readers)
      if (b.dataset.id !== id || b.dataset.name !== t.label) {
        b.dataset.id = id;
        b.dataset.name = t.label;
        b.setAttribute("aria-label", fieldAriaLabel(i, t.label));
      }
    });
  }

  /** Tempomat and limiter (#30): set speed and state in the centre display, like the cruise line of a real MFD. */
  private updateCruise(d: Frame["drivetrain"]) {
    const c = d.state.cruise;
    const sp = (kmh: number) => `${fmt(toUnit("speed", kmh))} ${prefs().speed}`;
    let text = "";
    let state = "off";
    if (c?.limiterOn) {
      text = `Limiter ${sp(c.limitKmh)}${c.kickdown ? " · Kickdown" : c.limiting ? " · begrenzt" : ""}`;
      state = c.limiting ? "active" : "ready";
    } else if (c && c.setKmh !== null) {
      text = `Tempomat ${sp(c.setKmh)} · ${c.mode === "active" ? "aktiv" : c.mode === "override" ? "übersteuert" : "bereit"}`;
      state = c.mode === "off" ? "ready" : "active";
    }
    if (text === this.last.cruise && state === this.last.cruiseState) return;
    this.last.cruise = text;
    this.last.cruiseState = state;
    this.out["cruise-text"]!.textContent = text;
    this.out.cruise!.hidden = !text;
    this.out.cruise!.dataset.state = state;
  }

  private updateLamps(f: Frame) {
    const s = f.s;
    const d = f.drivetrain;
    const ds = d.state;
    const vehicle = f.mode === "vehicle";
    const a = ds.assists ?? d.assists;
    const set = clusterLamps({
      ignition: f.ignition,
      running: s.running,
      sinceIgnitionS: f.sinceIgnitionS,
      diesel: this.cfg.fuel === "diesel",
      coolantC: s.coolantC,
      coolantMaxC: airCooled(this.cfg) ? 220 : this.summary.limits.coolantMaxC,
      oilPressureBar: s.oilPressureBar,
      damaged: s.destroyed || s.damage.length > 0,
      warnings: s.warnings.map((w) => w.code),
      abs: vehicle ? { enabled: a.abs, active: !!ds.absActive } : undefined,
      esp: vehicle ? { esp: a.esp, asr: a.asr, active: !!(ds.asrActive || ds.espActive) } : undefined,
      ice: !!ds.iceWarning,
      fuelReserve: vehicle ? d.tank.reserve : undefined,
      parkingBrake: vehicle ? !!ds.parkingBrake : undefined,
      gearbox: vehicle ? { hot: !!ds.gearboxOilWarn, protect: !!ds.gearboxProtect, failed: !!ds.gearboxFailed } : undefined,
    });
    // electric car (#108): Ready lamp, no oil / coolant / glow / alternator lamps
    const evl = this.ev && s.ev ? evLamps(set, { ready: s.ev.ready, ignition: f.ignition, soc: s.ev.soc, warnings: s.warnings.map((w) => w.code) }) : null;
    if (evl) Object.assign(set, evl);
    const ready = evl?.ready ?? "off";
    if (this.readyEl.dataset.state !== ready) {
      this.readyEl.dataset.state = ready;
      this.readyEl.setAttribute("aria-label", `Ready: ${ready === "on" ? "an" : "aus"}`);
    }
    const key = Object.values(set).join("|");
    if (key === this.lastLamps) return;
    this.lastLamps = key;
    for (const l of LAMPS) {
      const st: Lamp = set[l.k];
      const n = this.lampEls.get(l.k)!;
      if (n.dataset.state === st) continue;
      n.dataset.state = st;
      n.setAttribute("aria-label", `${l.on}: ${st === "off" ? "aus" : st === "blink" ? "blinkt" : "an"}`);
    }
  }
}
