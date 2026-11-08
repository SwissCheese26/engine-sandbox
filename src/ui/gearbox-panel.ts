// Getriebe-Pult for the chassis dyno (issue #14 base): gearbox type, final drive, gear indicator,
// speed, top speed and 0–100 stopwatch, shift buttons (keys Q = down, E = up).
// Issue #22: Fahrzeug-Platte (vehicle-panel.ts), wheel-spin / locked-wheel indicator, tyre warning from the
// fitted tyre's speed index.
// Issue #23: Umwelt- und Assistenz-Platte (environment-panel.ts) and the warning-lamp strip under the gear indicator.
import { TripPanel } from "./trip-panel.ts";
import { Drivetrain, FuelTank, GEARBOXES, VEHICLES, theoreticalVmax, dynoSweep, SPEED_LIMIT_OPTIONS } from "../core/index.ts";
import type { EngineConfig, EngineSummary, GearboxType, VehicleKind } from "../core/index.ts";
import { EnvironmentPanel, WarningLamps } from "./environment-panel.ts";
import { VehiclePanel } from "./vehicle-panel.ts";
import { CruisePanel } from "./cruise-panel.ts";
import { prefs } from "./settings.ts";
import { toUnit } from "./units.ts";

const TYPE_LABEL: Record<GearboxType, string> = {
  manual: "Handschalter, 6 Gänge",
  dsg: "Doppelkupplung (DSG), 7 Gänge",
  cvt: "Stufenlos (CVT)",
  sequential: "Sequenziell, 6 Gänge, Quickshifter",
};

const LIMIT_KEY = "pruefzelle.vmaxLimit";
/** Tyre warning hysteresis around the speed rating, so the note does not flicker at the rating (review PR #34). */
const TYRE_WARN_ON_KMH = 1;
const TYRE_WARN_OFF_KMH = 2;
const LAYOUT_SHORT = { fwd: "Frontantrieb", rwd: "Heckantrieb", awd: "Allrad" } as const;

/** 60 mph in km/h: the sprint mark when speeds are shown in mph (#24). */
const MPH60_KMH = 60 / 0.621371;

const fmt1 = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = (n: number) => Math.round(n).toLocaleString("de-DE");

export class GearboxPanel {
  readonly el: HTMLElement;
  /** Bordcomputer (#40, #41). */
  readonly trip: TripPanel;
  readonly drivetrain: Drivetrain;
  private typeSel: HTMLSelectElement;
  private vehicleSel: HTMLSelectElement;
  private hintEl: HTMLElement;
  private wheelieEl: HTMLElement;
  private fdInput: HTMLInputElement;
  private fdOut: HTMLOutputElement;
  private gearEl: HTMLElement;
  private speedEl: HTMLElement;
  private vmaxEl: HTMLElement;
  private t100El: HTMLElement;
  private calcEl: HTMLElement;
  private limitSel: HTMLSelectElement;
  private vmaxNoteEl: HTMLElement;
  private govNoteEl: HTMLElement;
  private tyreNoteEl: HTMLElement;
  private downBtn: HTMLButtonElement;
  private upBtn: HTMLButtonElement;
  private autoBtn: HTMLButtonElement;
  private spinEl: HTMLElement;
  private lockEl: HTMLElement;
  readonly vehiclePanel: VehiclePanel;
  readonly environmentPanel: EnvironmentPanel;
  readonly lamps = new WarningLamps();
  /** Tempomat-Leiste (issue #30). */
  private tankOut!: HTMLElement;
  private lastTank = "";
  private tankWrites = 0;
  private tankAbort = new AbortController();
  /** Saves the tank once more and removes the page listeners (App.dispose). */
  disposeTank() {
    saveTank(this.drivetrain.tank);
    this.tankAbort.abort();
  }
  readonly cruise: CruisePanel;
  private cruiseAnchor: Element;
  /** Puts the Tempomat-Leiste back in this panel (the cockpit borrows it). */
  cruiseHome() {
    if (this.cruiseAnchor.nextElementSibling !== this.cruise.el) this.cruiseAnchor.after(this.cruise.el);
  }
  private cfg: EngineConfig;
  private summary: EngineSummary;
  private last = { gear: "", speed: "", vmax: "", t100: "", vmaxNote: false, gov: false, tyre: false, wheelie: false, spin: false, locked: false, tyreRating: 0 };
  private moving = false;
  /** 0–60 mph stopwatch, measured here from the drivetrain's running 0–100 timer (UI only, #24). */
  private sprint = { running: false, done: false, t60: null as number | null };
  /** Set by the app: puts the vehicle in the simulator back to standstill. */
  onResetVehicle: () => void = () => {};

  constructor(cfg: EngineConfig, summary: EngineSummary) {
    this.cfg = cfg;
    this.summary = summary;
    this.drivetrain = new Drivetrain(cfg, summary, "manual");
    const el = document.createElement("section");
    el.className = "gearbox";
    el.setAttribute("aria-label", "Getriebe und Fahrzeug");
    el.hidden = true;
    el.innerHTML = `
      <div class="gearbox__setup">
        <h2 class="gearbox__title">Rollenprüfstand</h2>
        <label class="gearbox__field"><span>Fahrzeugtyp</span>
          <select data-control="vehicle">${(Object.keys(VEHICLES) as VehicleKind[])
            .map((k) => `<option value="${k}">${VEHICLES[k].label}</option>`).join("")}</select>
        </label>
        <label class="gearbox__field"><span>Getriebe</span>
          <select data-control="gearbox">${(Object.keys(TYPE_LABEL) as GearboxType[])
            .map((t) => `<option value="${t}">${TYPE_LABEL[t]}</option>`).join("")}</select>
        </label>
        <label class="gearbox__field"><span>Achsübersetzung</span>
          <input type="range" min="2.5" max="5.5" step="0.05" data-control="final-drive" />
          <output class="num"></output>
        </label>
        <label class="gearbox__field"><span>Vmax-Begrenzer</span>
          <select data-control="speed-limit">${SPEED_LIMIT_OPTIONS
            .map((v) => `<option value="${v ?? "off"}">aus (aufgehoben)</option>`).join("")}</select>
        </label>
        <p class="gearbox__hint">Kürzer übersetzt zieht stärker und dreht früher in den Begrenzer, länger übersetzt bringt mehr Vmax, wenn die Leistung reicht. <span data-out="vehicle-hint"></span></p>
        <p class="gearbox__calc num"></p>
      </div>
      <div class="gearbox__drive">
        <div class="gearbox__gear num" aria-live="off" title="Gang">N</div>
        <div class="gearbox__shift">
          <button type="button" class="btn" data-control="shift-down" aria-keyshortcuts="Q">Runter <kbd>Q</kbd></button>
          <button type="button" class="btn" data-control="shift-up" aria-keyshortcuts="E">Hoch <kbd>E</kbd></button>
          <button type="button" class="btn btn--small" data-control="shift-auto" hidden>Automatik (D)</button>
        </div>
        <p class="gearbox__keys">Gas <kbd>W</kbd>, Bremse <kbd>S</kbd></p>
        <p class="gearbox__wheelie" data-out="wheelie" role="status" hidden>Wheelie! Anti-Wheelie regelt die Zugkraft.</p>
        <p class="gearbox__wheelie" data-out="wheelspin" role="status" hidden>Räder drehen durch</p>
        <p class="gearbox__wheelie" data-out="wheels-locked" role="status" hidden>Räder blockieren</p>
      </div>
      <div class="gearbox__out">
      <dl class="gearbox__readouts">
        <div><dt>Tempo</dt><dd class="num"><span data-out="speed">0</span> <span data-unit="speed">km/h</span></dd></div>
        <div><dt>Vmax gemessen</dt><dd class="num"><span data-out="vmax">0</span> <span data-unit="speed">km/h</span><small class="gearbox__vmax-note" hidden> (abgeregelt)</small></dd></div>
        <div><dt data-out="sprint-label">0–100 km/h</dt><dd class="num"><span data-out="t100">–</span> s</dd></div>
        <div class="gearbox__tank"><dt>Tank</dt><dd class="num"><span data-out="tank">–</span>
          <button type="button" class="btn btn--small" data-control="refuel">Volltanken</button></dd></div>
      </dl>
      <div data-slot="trip"></div>
      <div class="gearbox__notes" aria-live="polite">
        <p class="note note--info" data-out="governor" hidden>Abgeregelt: Der Vmax-Begrenzer nimmt das Gas zurück.</p>
        <p class="note note--warning" data-out="tyre" hidden></p>
      </div>
      </div>`;
    this.el = el;
    this.trip = new TripPanel();
    el.querySelector("[data-slot=trip]")!.replaceWith(this.trip.el);
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    this.tankOut = q("[data-out=tank]");
    q("[data-control=refuel]").addEventListener("click", () => {
      this.drivetrain.tank.refill();
      saveTank(this.drivetrain.tank);
      this.lastTank = "";
    });
    // the tank level of the last visit (same capacity = same vehicle), else full
    const saved = loadTank();
    if (saved && Math.abs(saved.capacityL - this.drivetrain.tank.capacityL) < 0.01) this.drivetrain.tank.setLevel(saved.levelL);
    const signal = this.tankAbort.signal;
    addEventListener("pagehide", () => saveTank(this.drivetrain.tank), { signal });
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveTank(this.drivetrain.tank), { signal });
    this.typeSel = q("[data-control=gearbox]");
    this.vehicleSel = q("[data-control=vehicle]");
    this.hintEl = q("[data-out=vehicle-hint]");
    this.wheelieEl = q("[data-out=wheelie]");
    this.fdInput = q("[data-control=final-drive]");
    this.fdOut = q(".gearbox__field output");
    this.gearEl = q(".gearbox__gear");
    this.speedEl = q("[data-out=speed]");
    this.vmaxEl = q("[data-out=vmax]");
    this.t100El = q("[data-out=t100]");
    this.calcEl = q(".gearbox__calc");
    this.limitSel = q("[data-control=speed-limit]");
    this.vmaxNoteEl = q(".gearbox__vmax-note");
    this.govNoteEl = q("[data-out=governor]");
    this.tyreNoteEl = q("[data-out=tyre]");
    this.downBtn = q("[data-control=shift-down]");
    this.upBtn = q("[data-control=shift-up]");
    this.autoBtn = q("[data-control=shift-auto]");
    this.spinEl = q("[data-out=wheelspin]");
    this.lockEl = q("[data-out=wheels-locked]");
    this.vehiclePanel = new VehiclePanel(this.drivetrain);
    this.vehiclePanel.onChange = () => {
      this.onResetVehicle();
      this.syncSetup();
      // a loaded motorcycle switches ESP/ASR off (issue #23)
      this.environmentPanel?.sync();
    };
    el.append(this.vehiclePanel.el);
    this.environmentPanel = new EnvironmentPanel(this.drivetrain);
    el.append(this.environmentPanel.el);
    q(".gearbox__gear").after(this.lamps.el);
    this.cruise = new CruisePanel(this.drivetrain);
    this.cruiseAnchor = q(".gearbox__shift");
    this.cruiseHome();

    this.vehicleSel.addEventListener("change", () => {
      this.drivetrain.setVehicle(this.vehicleSel.value as VehicleKind);
      this.onResetVehicle();
      this.vehiclePanel.sync();
      this.environmentPanel.sync();
      this.syncSetup();
    });
    this.typeSel.addEventListener("change", () => {
      this.drivetrain.setType(this.typeSel.value as GearboxType);
      this.syncSetup();
    });
    this.fdInput.addEventListener("input", () => {
      this.drivetrain.setFinalDrive(Number(this.fdInput.value));
      this.syncSetup();
    });
    // the governor can be recoded at any time, also while driving (issue #32)
    // the choice is remembered per browser (review PR #34)
    try {
      const saved = localStorage.getItem(LIMIT_KEY);
      if (saved !== null && [...this.limitSel.options].some((o) => o.value === saved)) {
        this.drivetrain.setSpeedLimit(saved === "off" ? null : Number(saved));
      }
    } catch {
      // storage blocked: keep the default
    }
    this.limitSel.addEventListener("change", () => {
      this.drivetrain.setSpeedLimit(this.limitSel.value === "off" ? null : Number(this.limitSel.value));
      try {
        localStorage.setItem(LIMIT_KEY, this.limitSel.value);
      } catch {
        // storage blocked: setting lasts for this session only
      }
      this.syncSetup();
    });
    this.downBtn.addEventListener("click", () => this.drivetrain.shift(-1));
    this.upBtn.addEventListener("click", () => this.drivetrain.shift(1));
    this.autoBtn.addEventListener("click", () => this.drivetrain.setAutomatic());
    this.syncUnits();
  }

  /** Shows speeds in the globally chosen unit (km/h or mph, #24). Physics and the governor stay in km/h. */
  syncUnits() {
    const u = prefs().speed;
    this.el.querySelectorAll<HTMLElement>("[data-unit=speed]").forEach((n) => (n.textContent = u));
    this.el.querySelector<HTMLElement>("[data-out=sprint-label]")!.textContent = u === "mph" ? "0–60 mph" : "0–100 km/h";
    for (const o of this.limitSel.options) {
      if (o.value !== "off") o.textContent = `${fmt0(toUnit("speed", Number(o.value), u))} ${u}`;
    }
    this.last.speed = this.last.vmax = this.last.t100 = "";
    this.last.tyreRating = -1;
    this.syncSetup();
    this.trip.syncUnits();
    this.vehiclePanel.syncUnits();
    this.cruise.syncUnits(u);
    this.environmentPanel.sync();
  }

  private spd(kmh: number): string {
    return `${fmt0(toUnit("speed", kmh))} ${prefs().speed}`;
  }

  setVisible(on: boolean) {
    this.el.hidden = !on;
    if (on) this.reset();
  }

  configure(cfg: EngineConfig, summary: EngineSummary) {
    this.cfg = cfg;
    this.summary = summary;
    // the simulator was reset by setConfig() (engine and vehicle at rest), so the gearbox follows
    this.drivetrain.setEngine(cfg, summary);
    this.drivetrain.reset();
    this.sprint = { running: false, done: false, t60: null };
    this.syncSetup();
  }

  /** Vehicle back to standstill (engine reset). */
  reset() {
    this.drivetrain.reset();
    this.sprint = { running: false, done: false, t60: null };
    this.onResetVehicle();
  }

  /** Q / E shift keys. Returns true when handled. */
  handleKey(e: KeyboardEvent, down: boolean): boolean {
    if (this.el.hidden || e.ctrlKey || e.metaKey || e.altKey) return false;
    // the cruise keys have the full typing guard of controls.ts (number fields, selects), review PR #46
    if (this.cruise.handleKey(e, down)) return true;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "SELECT" || tag === "TEXTAREA" || (tag === "INPUT" && (e.target as HTMLInputElement).type === "text")) return false;
    const key = e.key.toLowerCase();
    if (key !== "q" && key !== "e") return false;
    if (down && !e.repeat) this.drivetrain.shift(key === "e" ? 1 : -1);
    return true;
  }

  private syncSetup() {
    const s = this.drivetrain.state;
    const preset = VEHICLES[this.drivetrain.kind];
    this.vehicleSel.value = this.drivetrain.kind;
    const v = this.drivetrain.vehicle;
    const spec = this.drivetrain.gearbox;
    // the loaded vehicle's own values (a library bike is not the preset's 270/350 kg)
    const cwA = (v.dragCoefficient * v.frontalAreaM2).toFixed(2).replace(".", ",");
    this.hintEl.textContent = this.drivetrain.kind === "car"
      ? `Fahrzeug: ${fmt0(v.massKg)} kg, cW ${v.dragCoefficient.toFixed(2).replace(".", ",")}, ${LAYOUT_SHORT[v.driveLayout ?? "fwd"]}.`
      : `${preset.label}: ${fmt0(v.massKg)} kg mit Fahrer, cW·A ${cwA} m², Quickshifter.`;
    // gear count and kind of automatic follow the loaded car's gearbox (issue #22)
    for (const o of this.typeSel.options) {
      const t = o.value as GearboxType;
      const n = t === s.type ? spec.ratios.length : GEARBOXES[t].ratios.length;
      o.textContent = t === "dsg" && t === s.type && spec.converterLockRpm ? `Automatik (Wandler), ${n} Gänge`
        : t === "manual" ? `Handschalter, ${n} Gänge` : t === "dsg" ? `Doppelkupplung (DSG), ${n} Gänge` : TYPE_LABEL[t];
    }
    // only the gearboxes this vehicle can have (car: manual/DSG/CVT, motorcycle: sequential)
    for (const o of this.typeSel.options) o.hidden = o.disabled = !preset.gearboxes.includes(o.value as GearboxType);
    this.typeSel.value = s.type;
    this.fdInput.value = String(s.finalDrive);
    this.limitSel.value = s.speedLimitKmh === null ? "off" : String(s.speedLimitKmh);
    this.fdOut.textContent = fmt1(s.finalDrive).replace(",0", ",00").replace(/,(\d)$/, ",$10");
    const cvt = s.type === "cvt";
    this.downBtn.hidden = cvt;
    this.upBtn.hidden = cvt;
    // theoretical top speed from the steady full-load curve
    try {
      const sweep = dynoSweep(this.cfg, { stepRpm: 100 });
      const torqueAt = (rpm: number) => {
        let best = sweep[0]!;
        for (const p of sweep) if (Math.abs(p.rpm - rpm) < Math.abs(best.rpm - rpm)) best = p;
        return best.torqueNm;
      };
      const r = theoreticalVmax(torqueAt, this.cfg.revLimitRpm, s.type, s.finalDrive, this.drivetrain.vehicle, spec);
      // physical top speed without the governor; the governor note follows when it caps below that
      const lim = s.speedLimitKmh;
      const capped = lim !== null && r.vmaxKmh > lim
        ? ` Der Vmax-Begrenzer regelt bei ${this.spd(lim)} ab.`
        : "";
      this.calcEl.textContent = (r.limitedBy === "limiter"
        ? `Berechnete Vmax ohne Begrenzer ${this.spd(r.vmaxKmh)}, begrenzt durch den Drehzahlbegrenzer im ${r.gear}. Gang: länger übersetzen bringt mehr.`
        : `Berechnete Vmax ohne Begrenzer ${this.spd(r.vmaxKmh)}, begrenzt durch den Luftwiderstand.`) + capped;
    } catch {
      this.calcEl.textContent = "";
    }
  }

  /** 0–60 mph: follows the drivetrain's 0–100 run (same start and abort rules) and stops it at 96,56 km/h. */
  private stepSprint(s: { speedKmh: number; t0to100Running: number | null; t0to100S: number | null }): number | null {
    const sp = this.sprint;
    const r = s.t0to100Running;
    if (r !== null) {
      if (!sp.running) {
        sp.running = true;
        sp.done = false;
      }
      if (!sp.done && s.speedKmh >= MPH60_KMH) {
        sp.t60 = r;
        sp.done = true;
      }
    } else if (sp.running) {
      // the run ended this frame: reached 100 km/h (60 mph crossed in the same frame) or aborted
      if (!sp.done && s.speedKmh >= MPH60_KMH && s.t0to100S !== null) sp.t60 = s.t0to100S;
      sp.running = false;
      sp.done = true;
    }
    return sp.t60;
  }

  /** Per frame: returns the pedal the engine should get (manual shifts lift off). */
  update(braking = false): void {
    const d = this.drivetrain;
    const s = d.state;
    // tank: content, reserve and empty (amber, "Gelb heißt Grenze"); saved every few seconds while it changes
    const t = d.tank;
    const gal = prefs().fuel === "mpg";
    const lv = gal ? t.levelL / 3.785411784 : t.levelL;
    const cap = gal ? t.capacityL / 3.785411784 : t.capacityL;
    const tankText = `${fmt0(lv)} / ${fmt0(cap)} ${gal ? "gal" : "l"}${t.empty ? " – leer" : t.reserve ? " – Reserve" : ""}`;
    if (tankText !== this.lastTank) {
      this.lastTank = tankText;
      this.tankOut.textContent = tankText;
      this.tankOut.classList.toggle("is-low", t.reserve);
      if (++this.tankWrites % 50 === 0) saveTank(t);
    }
    const gear = s.shifting && s.type === "manual" ? "–" : d.gearLabel();
    const mph = prefs().speed === "mph";
    const speed = fmt0(toUnit("speed", s.speedKmh));
    const vmax = fmt0(toUnit("speed", s.maxSpeedKmh));
    const t60 = this.stepSprint(s);
    const t100 = mph
      ? this.sprint.running && !this.sprint.done ? fmt1(s.t0to100Running ?? 0) : t60 !== null ? fmt1(t60) : "–"
      : s.t0to100Running !== null ? fmt1(s.t0to100Running) : s.t0to100S !== null ? fmt1(s.t0to100S) : "–";
    if (gear !== this.last.gear) this.gearEl.textContent = this.last.gear = gear;
    if (speed !== this.last.speed) this.speedEl.textContent = this.last.speed = speed;
    if (vmax !== this.last.vmax) this.vmaxEl.textContent = this.last.vmax = vmax;
    if (t100 !== this.last.t100) this.t100El.textContent = this.last.t100 = t100;
    this.autoBtn.hidden = !(s.type === "dsg" && s.manualMode);
    const vmaxNote = s.maxSpeedLimited && s.maxSpeedKmh > 0.5;
    if (vmaxNote !== this.last.vmaxNote) this.vmaxNoteEl.hidden = !(this.last.vmaxNote = vmaxNote);
    if (s.limiting !== this.last.gov) this.govNoteEl.hidden = !(this.last.gov = s.limiting);
    if (s.tyreRatingKmh !== this.last.tyreRating) {
      this.last.tyreRating = s.tyreRatingKmh;
      const idx = this.drivetrain.tyre.speedIndex;
      this.tyreNoteEl.textContent = `Reifenfreigabe ${idx} = ${idx === "(Y)" ? `über ${this.spd(300)}` : this.spd(s.tyreRatingKmh)} überschritten`;
    }
    const tyre = this.last.tyre ? s.speedKmh >= s.tyreRatingKmh - TYRE_WARN_OFF_KMH : s.speedKmh > s.tyreRatingKmh + TYRE_WARN_ON_KMH;
    if (tyre !== this.last.tyre) this.tyreNoteEl.hidden = !(this.last.tyre = tyre);
    if (s.wheelie !== this.last.wheelie) this.wheelieEl.hidden = !(this.last.wheelie = s.wheelie);
    if (s.wheelSpin !== this.last.spin) this.spinEl.hidden = !(this.last.spin = s.wheelSpin);
    if (s.wheelsLocked !== this.last.locked) this.lockEl.hidden = !(this.last.locked = s.wheelsLocked);
    this.vehiclePanel.update();
    this.lamps.update(d);
    this.cruise.update();
    this.environmentPanel.update(s.speedKmh);
    this.gearEl.classList.toggle("is-braking", braking);
    // gearbox and final drive can only be changed at standstill (review #19)
    const moving = s.speedKmh > 0.5;
    if (moving !== this.moving) {
      this.moving = moving;
      this.typeSel.disabled = moving;
      this.vehicleSel.disabled = moving;
      this.fdInput.disabled = moving;
    }
  }
}

const TANK_KEY = "pruefzelle.tank";

function saveTank(t: FuelTank) {
  try {
    localStorage.setItem(TANK_KEY, JSON.stringify(t.toJSON()));
  } catch {
    /* storage unavailable */
  }
}

function loadTank(): FuelTank | null {
  try {
    const raw = localStorage.getItem(TANK_KEY);
    return raw ? FuelTank.fromJSON(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
