// Getriebe-Pult for the chassis dyno (issue #14 base): gearbox type, final drive, gear indicator,
// speed, top speed and 0–100 stopwatch, shift buttons (keys Q = down, E = up).
// Issue #22: Fahrzeug-Platte (vehicle-panel.ts), wheel-spin / locked-wheel indicator, tyre warning from the
// fitted tyre's speed index.
// Issue #23: Umwelt- und Assistenz-Platte (environment-panel.ts) and the warning-lamp strip under the gear indicator.
// Issue #53: gearbox oil temperature readout (amber from the warning threshold) and a note on overheat / protection mode.
// Consolidation ("Dubletten"): one place per setting. Readouts (gear, speed, Vmax, 0–100, oil, tank content, trip)
// stay at the top; settings live in their sections: "Getriebe" (type, final drive, oil cooler, ratios, traction
// diagram), "Fahrzeug & Reifen" (vehicle kind, ready-made car, governor, body, tyres) and "Umwelt & Assistenten".
// Every own change is stored for the loaded vehicle only (vehicle-custom.ts).
import { rangeText } from "./layouts/ev-logic.ts";
import { TripPanel } from "./trip-panel.ts";
import { Drivetrain, FuelTank, GEARBOXES, VEHICLES, SPEED_LIMIT_OPTIONS, isAutomaticType, isCommercialKind } from "../core/index.ts";
import type { DrivetrainState, EngineConfig, EngineSummary, GearboxType } from "../core/index.ts";
import { OIL_COOLER_LABEL, TANK_KEY, currentOilCooler, oilCoolerChoices, setOilCooler, type OilCooler } from "./vehicle-custom.ts";
import { EnvironmentPanel, WarningLamps } from "./environment-panel.ts";
import { VehiclePanel } from "./vehicle-panel.ts";
import { GearPlate } from "./gear-plate.ts";
import { CruisePanel } from "./cruise-panel.ts";
import { prefs } from "./settings.ts";
import { toUnit } from "./units.ts";
import { gearboxOilNote, tyreNote } from "./toasts.ts";

const TYPE_LABEL: Record<GearboxType, string> = {
  manual: "Handschalter, 6 Gänge",
  dsg: "Doppelkupplung (DSG), 7 Gänge",
  automatic: "Wandlerautomatik, 8 Gänge",
  cvt: "Stufenlos (CVT)",
  sequential: "Sequenziell, 6 Gänge, Quickshifter",
};

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
  private coolerSel: HTMLSelectElement;
  private coolerRow: HTMLElement;
  private hintEl: HTMLElement;
  private wheelieEl: HTMLElement;
  private fdInput: HTMLInputElement;
  private fdOut: HTMLOutputElement;
  private gearEl: HTMLElement;
  private speedEl: HTMLElement;
  private vmaxEl: HTMLElement;
  private t100El: HTMLElement;
  private govCalcEl: HTMLElement;
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
  /** Gänge & Zugkraft (issue #14). */
  readonly gears: GearPlate;
  readonly environmentPanel: EnvironmentPanel;
  readonly lamps = new WarningLamps();
  /** Tempomat-Leiste (issue #30). */
  private tankOut!: HTMLElement;
  private rangeOut!: HTMLElement;
  private lastRange = "";
  private lastTank = "";
  private tankSavedAt = 0;
  private tankSavedL = Number.NaN;
  private refuelBtn!: HTMLButtonElement;
  private saveTank() {
    const t = this.drivetrain.tank;
    this.tankSavedAt = performance.now();
    this.tankSavedL = t.levelL;
    try {
      localStorage.setItem(TANK_KEY, JSON.stringify({ ...t.toJSON(), vehicle: this.vehiclePanel.carId, kind: this.drivetrain.kind }));
    } catch {
      /* storage unavailable */
    }
  }
  /** The tank of the last visit, if it was the same vehicle (library id, or the own vehicle, #93 restores it). */
  restoreTank() {
    const saved = loadTank();
    // (an own vehicle keeps its own tank size too)
    if (saved && saved.vehicle === this.vehiclePanel.carId && saved.kind === this.drivetrain.kind) {
      this.drivetrain.tank.setCapacity(saved.tank.capacityL, false);
      this.drivetrain.tank.setLevel(saved.tank.levelL);
      this.vehiclePanel.sync();
    }
  }
  private tankAbort = new AbortController();
  /** Saves the tank once more and removes the page listeners (App.dispose). */
  disposeTank() {
    this.saveTank();
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
  private last = { gear: "", speed: "", vmax: "", t100: "", vmaxNote: false, gov: false, tyre: false, wheelie: false, spin: false, locked: false, tyreRating: 0, oil: "", oilNote: "", tyreT: "", tyreState: "" };
  private tyreTEl!: HTMLElement;
  private repairBtn!: HTMLButtonElement;
  private oilEl!: HTMLElement;
  private oilNoteEl!: HTMLElement;
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
      <h2 class="gearbox__title">Rollenprüfstand</h2>
      <div class="gearbox__setup" hidden>
        <label class="gearbox__field"><span>Getriebeart</span>
          <select data-control="gearbox">${(Object.keys(TYPE_LABEL) as GearboxType[])
            .map((t) => `<option value="${t}">${TYPE_LABEL[t]}</option>`).join("")}</select>
        </label>
        <label class="gearbox__field"><span>Achsübersetzung</span>
          <input type="range" min="2.5" max="5.5" step="0.05" data-control="final-drive" />
          <output class="num"></output>
        </label>
        <label class="gearbox__field" data-out="cooler-row"><span>Getriebeölkühler</span>
          <select data-control="gearbox-cooler"></select>
        </label>
        <p class="gearbox__hint">Kürzer übersetzt zieht stärker und dreht früher in den Begrenzer, länger übersetzt bringt mehr Vmax, wenn die Leistung reicht. <span data-out="vehicle-hint"></span></p>
      </div>
      <div class="gearbox__vsetup" hidden>
        <label class="gearbox__field"><span>Vmax-Begrenzer (Werk)</span>
          <select data-control="speed-limit">${SPEED_LIMIT_OPTIONS
            .map((v) => `<option value="${v ?? "off"}">aus (aufgehoben)</option>`).join("")}</select>
        </label>
        <p class="gearbox__hint" data-out="governor-calc"></p>
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
        <div><dt>Getriebeöl</dt><dd class="num"><span data-out="gear-oil">–</span></dd></div>
        <div class="gearbox__tank"><dt>Reifen</dt><dd class="num"><span data-out="tyre-temp">–</span>
          <button type="button" class="btn btn--small" data-control="tyre-repair">Reifen wechseln</button></dd></div>
        <div class="gearbox__tank"><dt>Tankinhalt</dt><dd class="num"><span data-out="tank">–</span>
          <button type="button" class="btn btn--small" data-control="refuel">Volltanken</button></dd></div>
        <div class="gearbox__range" data-out="range-row"><dt>Reichweite</dt><dd class="num"><span data-out="range">–</span></dd></div>
      </dl>
      <div data-slot="trip"></div>
      <div class="gearbox__notes" aria-live="polite">
        <p class="note note--info" data-out="governor" hidden>Abgeregelt: Der Vmax-Begrenzer nimmt das Gas zurück.</p>
        <p class="note note--warning" data-out="tyre" hidden></p>
        <p class="note note--warning" data-out="gearbox-oil" hidden></p>
      </div>
      </div>`;
    this.el = el;
    this.trip = new TripPanel();
    el.querySelector("[data-slot=trip]")!.replaceWith(this.trip.el);
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    this.tankOut = q("[data-out=tank]");
    this.rangeOut = q("[data-out=range]");
    this.refuelBtn = q("[data-control=refuel]");
    // at the pump: only standing still (the button is disabled while rolling)
    this.refuelBtn.addEventListener("click", () => {
      if (this.drivetrain.state.speedKmh > 0.5) return;
      this.drivetrain.tank.refill();
      this.saveTank();
      this.lastTank = "";
    });
    const signal = this.tankAbort.signal;
    addEventListener("pagehide", () => this.saveTank(), { signal });
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && this.saveTank(), { signal });
    this.typeSel = q("[data-control=gearbox]");
    this.coolerSel = q("[data-control=gearbox-cooler]");
    this.coolerRow = q("[data-out=cooler-row]");
    this.hintEl = q("[data-out=vehicle-hint]");
    this.wheelieEl = q("[data-out=wheelie]");
    this.fdInput = q("[data-control=final-drive]");
    this.fdOut = q(".gearbox__field output");
    this.gearEl = q(".gearbox__gear");
    this.speedEl = q("[data-out=speed]");
    this.vmaxEl = q("[data-out=vmax]");
    this.t100El = q("[data-out=t100]");
    this.govCalcEl = q("[data-out=governor-calc]");
    this.limitSel = q("[data-control=speed-limit]");
    this.vmaxNoteEl = q(".gearbox__vmax-note");
    this.govNoteEl = q("[data-out=governor]");
    this.tyreNoteEl = q("[data-out=tyre]");
    this.downBtn = q("[data-control=shift-down]");
    this.upBtn = q("[data-control=shift-up]");
    this.autoBtn = q("[data-control=shift-auto]");
    this.spinEl = q("[data-out=wheelspin]");
    this.lockEl = q("[data-out=wheels-locked]");
    this.oilEl = q("[data-out=gear-oil]");
    this.tyreTEl = q("[data-out=tyre-temp]");
    this.repairBtn = q("[data-control=tyre-repair]");
    // like refuelling (issue #144): new or repaired tyres only at standstill
    this.repairBtn.addEventListener("click", () => {
      if (this.drivetrain.state.speedKmh > 0.5) return;
      this.drivetrain.repairTyres();
    });
    this.oilNoteEl = q("[data-out=gearbox-oil]");
    this.vehiclePanel = new VehiclePanel(this.drivetrain);
    // the tank level of the last visit, if it was the same vehicle (library id, or the own vehicle), else full
    this.restoreTank();
    this.vehiclePanel.onChange = () => {
      this.onResetVehicle();
      this.syncSetup();
      // a loaded motorcycle switches ESP/ASR off (issue #23)
      this.environmentPanel?.sync();
    };
    this.gears = new GearPlate(this.drivetrain, cfg, summary);
    // own ratios: stored for the loaded vehicle only
    this.gears.onEdit = () => {
      this.vehiclePanel.remember();
      // in N while rolling the car keeps rolling (review PR #90)
      if (this.drivetrain.state.speedKmh <= 0.5) this.onResetVehicle();
      this.syncSetup();
    };
    el.append(this.gears.el, this.vehiclePanel.el);
    // one place per setting: gearbox type, final drive and oil cooler into "Getriebe", the governor into "Fahrzeug"
    const setup = q(".gearbox__setup");
    this.gears.setupSlot.append(...setup.childNodes);
    setup.remove();
    const vsetup = q(".gearbox__vsetup");
    this.vehiclePanel.setupSlot.append(...vsetup.childNodes);
    vsetup.remove();
    this.environmentPanel = new EnvironmentPanel(this.drivetrain);
    el.append(this.environmentPanel.el);
    q(".gearbox__gear").after(this.lamps.el);
    this.cruise = new CruisePanel(this.drivetrain);
    this.cruiseAnchor = q(".gearbox__shift");
    this.cruiseHome();

    this.typeSel.addEventListener("change", () => {
      this.drivetrain.setType(this.typeSel.value as GearboxType);
      // the cooler choice follows the new gearbox ("Aus" only where it has one)
      setOilCooler(this.drivetrain, currentOilCooler(this.drivetrain));
      this.vehiclePanel.remember();
      this.syncSetup();
    });
    this.fdInput.addEventListener("input", () => {
      this.drivetrain.setFinalDrive(Number(this.fdInput.value));
      this.syncSetup();
    });
    this.fdInput.addEventListener("change", () => this.vehiclePanel.remember());
    this.coolerSel.addEventListener("change", () => {
      setOilCooler(this.drivetrain, this.coolerSel.value as OilCooler);
      this.vehiclePanel.remember();
      this.syncSetup();
    });
    // the governor can be recoded at any time, also while driving (issue #32); stored per vehicle
    this.limitSel.addEventListener("change", () => {
      this.drivetrain.setSpeedLimit(this.limitSel.value === "off" ? null : Number(this.limitSel.value));
      this.vehiclePanel.remember();
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
    this.last.speed = this.last.vmax = this.last.t100 = this.last.oil = "";
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
    if (on) {
      this.reset();
      this.gears.redraw();
    }
  }

  configure(cfg: EngineConfig, summary: EngineSummary) {
    this.cfg = cfg;
    this.summary = summary;
    // the simulator was reset by setConfig() (engine and vehicle at rest), so the gearbox follows
    this.drivetrain.setEngine(cfg, summary);
    this.drivetrain.reset();
    this.sprint = { running: false, done: false, t60: null };
    this.gears.configure(cfg, summary);
    this.syncSetup();
  }

  /** Vehicle back to standstill (engine reset). */
  reset() {
    this.drivetrain.reset();
    this.sprint = { running: false, done: false, t60: null };
    this.onResetVehicle();
  }

  /** Set by the app: Q / E for something other than the gearbox (P N D of an electric car); true = handled. */
  onShiftKey: (dir: 1 | -1) => boolean = () => false;

  /** Q / E shift keys. Returns true when handled. */
  handleKey(e: KeyboardEvent, down: boolean): boolean {
    if (this.el.hidden || e.ctrlKey || e.metaKey || e.altKey) return false;
    // the cruise keys have the full typing guard of controls.ts (number fields, selects), review PR #46
    if (this.cruise.handleKey(e, down)) return true;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "SELECT" || tag === "TEXTAREA" || (tag === "INPUT" && (e.target as HTMLInputElement).type === "text")) return false;
    const key = e.key.toLowerCase();
    if (key !== "q" && key !== "e") return false;
    const dir = key === "e" ? 1 : -1;
    if (down && !e.repeat && !this.onShiftKey(dir)) this.drivetrain.shift(dir);
    return true;
  }

  private syncSetup() {
    const s = this.drivetrain.state;
    const preset = VEHICLES[this.drivetrain.kind];
    const spec = this.drivetrain.gearbox;
    const load = this.drivetrain.load;
    // mass, cW and drive are fields of "Fahrzeug & Reifen"; here only what the gearbox section adds
    this.hintEl.textContent = this.drivetrain.kind === "car" ? ""
      : isCommercialKind(this.drivetrain.kind)
        ? `${preset.label}${load ? ` (Beladung ${Math.round(load.share * 100)} %)` : ""}: Motorbremse im Schub.`
        : `${preset.label}: Quickshifter.`;
    // gear count and kind of automatic follow the loaded car's gearbox (issue #22)
    for (const o of this.typeSel.options) {
      const t = o.value as GearboxType;
      const n = t === s.type ? spec.ratios.length : GEARBOXES[t].ratios.length;
      o.textContent = t === "automatic" ? `Wandlerautomatik, ${n} Gänge`
        : t === "dsg" && t === s.type && spec.converterLockRpm ? `Automatik (Wandler), ${n} Gänge`
        : t === "dsg" && t === s.type && isCommercialKind(this.drivetrain.kind) ? `Automatisiertes Schaltgetriebe (AMT), ${n} Gänge`
        : t === "manual" ? `Handschalter, ${n} Gänge` : t === "dsg" ? `Doppelkupplung (DSG), ${n} Gänge` : TYPE_LABEL[t];
    }
    // only the gearboxes this vehicle can have (car: manual/DSG/CVT, motorcycle: sequential)
    for (const o of this.typeSel.options) o.hidden = o.disabled = !preset.gearboxes.includes(o.value as GearboxType);
    this.typeSel.value = s.type;
    // oil cooler: "Serie", aftermarket air cooler, "Aus" only where the factory has one; none on a shared sump
    const choices = oilCoolerChoices(this.drivetrain);
    const key = choices.join("|");
    if (this.coolerSel.dataset.choices !== key) {
      this.coolerSel.dataset.choices = key;
      this.coolerSel.innerHTML = choices.map((c) => `<option value="${c}">${OIL_COOLER_LABEL[c]}</option>`).join("");
    }
    this.coolerRow.hidden = !choices.length;
    this.coolerSel.value = currentOilCooler(this.drivetrain);
    this.fdInput.value = String(s.finalDrive);
    this.limitSel.value = s.speedLimitKmh === null ? "off" : String(s.speedLimitKmh);
    this.fdOut.textContent = fmt1(s.finalDrive).replace(",0", ",00").replace(/,(\d)$/, ",$10");
    this.gears?.sync();
    const cvt = s.type === "cvt";
    this.downBtn.hidden = cvt;
    this.upBtn.hidden = cvt;
    // the computed Vmax is shown once, under the traction diagram; here only whether the governor caps it
    const v = this.gears?.vmaxKmh ?? null;
    const lim = s.speedLimitKmh;
    this.govCalcEl.textContent = v !== null && lim !== null && v > lim
      ? `Regelt bei ${this.spd(lim)} ab, ohne Begrenzer wären ${this.spd(v)} möglich (siehe Getriebe › Zugkraft).`
      : "";
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

  /**
   * Tyre hot-zone temperature, state note (issue #144, toasts.ts tyreNote) over the plain "Reifenfreigabe
   * überschritten", and the "Reifen wechseln" button (standstill, only when there is something to repair).
   */
  private updateTyres(s: DrivetrainState, over: boolean) {
    const u = prefs().temp;
    const c = s.tyreHotC ?? s.tyreCarcassC;
    const t = c === undefined || !Number.isFinite(c) ? "–" : `${fmt0(toUnit("temp", c, u))} ${u}${s.tyreFailed ? " – geplatzt" : s.tyreVibration ? " – beschädigt" : ""}`;
    if (t !== this.last.tyreT) {
      this.last.tyreT = t;
      this.tyreTEl.textContent = t;
      this.tyreTEl.classList.toggle("is-low", !!(s.tyreWarn || s.tyreFailed));
    }
    const note = tyreNote(s);
    const key = `${note}|${over}`;
    if (key !== this.last.tyreState) {
      this.last.tyreState = key;
      if (note) this.tyreNoteEl.textContent = note;
      else this.last.tyreRating = 0;
      this.tyreNoteEl.hidden = !note && !over;
    }
    this.repairBtn.disabled = s.speedKmh > 0.5 || !((s.tyreDamage ?? 0) > 0 || s.tyreFailed);
  }

  /** Gearbox oil temperature in the chosen unit, amber from the warning threshold, and its note (issue #53). */
  private updateGearboxOil(s: DrivetrainState) {
    const u = prefs().temp;
    const c = s.gearboxOilC;
    const text = c === undefined || !Number.isFinite(c) ? "–" : `${fmt0(toUnit("temp", c, u))} ${u}`;
    if (text !== this.last.oil) {
      this.last.oil = text;
      this.oilEl.textContent = text;
    }
    this.oilEl.classList.toggle("is-low", !!s.gearboxOilWarn);
    const note = gearboxOilNote(s);
    if (note !== this.last.oilNote) {
      this.last.oilNote = note;
      this.oilNoteEl.textContent = note;
      this.oilNoteEl.hidden = !note;
    }
  }

  /** Live range next to the tank (range-estimator.ts), km; "–" while unknown. */
  showRange(km: number): void {
    const t = rangeText(km, prefs());
    if (t === this.lastRange) return;
    this.lastRange = t;
    this.rangeOut.textContent = t;
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
    }
    // saved every 5 s while the level changes (and on leaving the page)
    const now = performance.now();
    if (now - this.tankSavedAt > 5000 && Math.abs(t.levelL - this.tankSavedL) > 0.01) this.saveTank();
    this.refuelBtn.disabled = s.speedKmh > 0.5 || t.fraction >= 0.999;
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
    this.autoBtn.hidden = !(isAutomaticType(s.type) && s.manualMode);
    const vmaxNote = s.maxSpeedLimited && s.maxSpeedKmh > 0.5;
    if (vmaxNote !== this.last.vmaxNote) this.vmaxNoteEl.hidden = !(this.last.vmaxNote = vmaxNote);
    if (s.limiting !== this.last.gov) this.govNoteEl.hidden = !(this.last.gov = s.limiting);
    if (s.tyreRatingKmh !== this.last.tyreRating) {
      this.last.tyreRating = s.tyreRatingKmh;
      const idx = this.drivetrain.tyre.speedIndex;
      this.tyreNoteEl.textContent = `Reifenfreigabe ${idx} = ${idx === "(Y)" ? `über ${this.spd(300)}` : this.spd(s.tyreRatingKmh)} überschritten`;
    }
    const tyre = this.last.tyre ? s.speedKmh >= s.tyreRatingKmh - TYRE_WARN_OFF_KMH : s.speedKmh > s.tyreRatingKmh + TYRE_WARN_ON_KMH;
    if (tyre !== this.last.tyre) this.last.tyre = tyre;
    this.updateTyres(s, tyre);
    if (s.wheelie !== this.last.wheelie) this.wheelieEl.hidden = !(this.last.wheelie = s.wheelie);
    if (s.wheelSpin !== this.last.spin) this.spinEl.hidden = !(this.last.spin = s.wheelSpin);
    if (s.wheelsLocked !== this.last.locked) this.lockEl.hidden = !(this.last.locked = s.wheelsLocked);
    this.updateGearboxOil(s);
    this.vehiclePanel.update();
    this.gears.update();
    this.lamps.update(d);
    this.cruise.update();
    this.environmentPanel.update(s.speedKmh);
    this.gearEl.classList.toggle("is-braking", braking);
    // gearbox and final drive can only be changed at standstill (review #19)
    const moving = s.speedKmh > 0.5;
    if (moving !== this.moving) {
      this.moving = moving;
      this.typeSel.disabled = moving;
      this.coolerSel.disabled = moving;
      this.fdInput.disabled = moving;
    }
  }
}


/** Saved tank and the vehicle it belongs to ("" = own vehicle). */
function loadTank(): { tank: FuelTank; vehicle: string; kind: string } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TANK_KEY) ?? "null") as Record<string, unknown> | null;
    const tank = FuelTank.fromJSON(raw);
    // older saves have no kind: they were made with a car
    return tank && raw ? { tank, vehicle: typeof raw.vehicle === "string" ? raw.vehicle : "", kind: typeof raw.kind === "string" ? raw.kind : "car" } : null;
  } catch {
    return null;
  }
}
