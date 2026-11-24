// Prüfzelle: wires workbench, schematic, nameplate, instruments, recorder and console to the
// simulator and runs the main loop.
import { BRAKE_MAX_G, EngineSimulator, EvSimulator, TERRAIN_LABELS, VehicleSystems, defaultInputs, evPackKwh, evRpmVmaxKmh, summarize } from "../core/index.ts";
import { RangeEstimator, packKwhLeft, ratedLPer100 } from "./range-estimator.ts";
import type { EvConfig, EvDriveMode } from "../core/index.ts";
import { EvBench } from "./ev-bench.ts";
import { EvStatus } from "./ev-panel.ts";
import { loadEvTuning, saveEvTuning } from "./ev-tuning-store.ts";
import { tuneEv, type TunedEv } from "../data/ev-tuning.ts";
import { nextDriveMode } from "./layouts/ev-logic.ts";
import { customSetup, loadOwnVehicle, saveOwnVehicle, setOwnVehicleActive, takePendingSetup, type PendingSetup } from "./sandbox-setup.ts";
import { ShiftPad } from "./shift-pad.ts";
import { isMyEngineId } from "./my-engines.ts";
import type { EngineConfig, EngineState, EngineSummary } from "../core/index.ts";
import { defaultConfig } from "../data/presets.ts";
import { ControlPanel } from "./controls.ts";
import { ToastStrip } from "./toasts.ts";
import { GearboxPanel } from "./gearbox-panel.ts";
import { fmt } from "./format.ts";
import { InstrumentPanel } from "./gauges.ts";
import { Nameplate } from "./nameplate.ts";
import { Recorder } from "./recorder.ts";
import { Schematic } from "./schematic.ts";
import { SOUND_AVAILABLE, createSound } from "./sound-bridge.ts";
import { Workbench } from "./workbench.ts";
import { LAYOUTS, getSettings, onSettingsChange, setSettings, type LayoutId } from "./settings.ts";
import { CockpitView } from "./layouts/cockpit.ts";
import { DriveInfo, type LayoutView } from "./layouts/view.ts";
import { fmtQ } from "./units.ts";
import { Haptics, ScreenWake, isTouch } from "./device.ts";
import { bugButton, setBugContext } from "./bug-dialog.ts";
import { RingBuffer, SAMPLE_COUNT, SAMPLE_INTERVAL_S, samplesText, type DiagnosisSection, type ValueSample } from "./bug-report.ts";
import { VEHICLE_LIBRARY } from "../data/vehicle-library.ts";
import { carDesign, type CockpitDesignId } from "./layouts/designs.ts";
import { SmokeOverlay, type SmokeAnchors } from "./smoke-overlay.ts";
import { emission } from "./smoke-emitters.ts";
import { FALLBACK_LIMITS } from "./limits-fallback.ts";

/** Largest simulation step per frame; longer frames (tab in background) are clamped. */
const MAX_DT = 1 / 30;

function safeSummary(cfg: EngineConfig, fallback: EngineSummary | null): EngineSummary {
  try {
    return summarize(cfg);
  } catch (e) {
    console.warn("summarize() failed", e);
    if (fallback) return fallback;
    throw e;
  }
}

export class App {
  private cfg: EngineConfig;
  private summary: EngineSummary;
  private sim: EngineSimulator;
  /** Electric car loaded (#108): its simulator runs instead of the engine; the bench engine waits unchanged. */
  private evSim: EvSimulator | null = null;
  /** Live range (#108): rolling consumption of the last kilometres / minutes. */
  private evRange: RangeEstimator | null = null;
  /** Live range of a combustion vehicle: rolling fuel consumption, restarted when the car or fuel changes. */
  private fuelRange: RangeEstimator | null = null;
  private fuelRangeKey = "";
  private evCfg: Readonly<EvConfig> | null = null;
  private evMode: EvDriveMode = "sport";
  private evPanel = new EvStatus();
  /** Werkbank, Elektroantrieb (#108): the E-Tuner plates. */
  private evBench = new EvBench();
  /** Set while the Elektro-Platte applies tuning (the same car, the charge stays). */
  private evTuning = false;
  /** Air brake, retarder, AdBlue and battery (#83), stepped every frame next to the engine. */
  private systems = new VehicleSystems();
  private lastTankL = Number.NaN;
  private inputs = defaultInputs();
  private bench: Workbench;
  private schematic = new Schematic();
  private nameplate = new Nameplate();
  private gauges = new InstrumentPanel();
  private recorder = new Recorder();
  private console: ControlPanel;
  private sound = createSound();
  /** Limit hints and critical events as short toasts below the header (setting "Hinweise zu Grenzwerten"). */
  private toasts = new ToastStrip();
  private wasRunning = false;
  private fuelStall = false;
  private soundStarted = false;
  private last = 0;
  private announcer: HTMLElement;
  /** Aborts every global listener on dispose(). */
  private abort = new AbortController();
  private rafId = 0;
  private resizeRaf = 0;
  /** Bench changes are collected and applied once per frame (sliders fire many input events). */
  private pendingCfg: EngineConfig | null = null;
  private disposed = false;
  private gearbox: GearboxPanel;
  /** Menu or settings open (#42): loop stopped, keys ignored, sound silent. */
  private paused = false;
  private unsubscribeSettings: () => void;
  /** Screen stays on while the engine runs (#44, setting "Bildschirm wach halten"). */
  private wake = new ScreenWake();
  /** Vibration on limiter, ABS and damage (#44). */
  private haptics = new Haptics();
  /** Sandbox views (#26): the Prüfzelle itself or one of the views in src/ui/layouts/, created on first use. */
  private layoutId: LayoutId = "pruefzelle";
  private views = new Map<LayoutId, LayoutView>();
  private shiftPad!: ShiftPad;
  private viewSlot!: HTMLElement;
  private cell!: HTMLElement;
  private layoutSel!: HTMLSelectElement;
  private info: DriveInfo;
  private sinceIgnition = 0;
  /** Last ~5 s of live values for a bug report (#55). */
  private samples = new RingBuffer<ValueSample>(SAMPLE_COUNT);
  private sampleT = 0;
  /** Tyre smoke and engine steam over the stage (setting "Effekte (Rauch/Dampf)"). */
  private smoke = new SmokeOverlay(() => this.smokeAnchors());
  private stage!: HTMLElement;
  private header!: HTMLElement;
  private deck!: HTMLElement;

  constructor(private root: HTMLElement) {
    this.inputs.damage = getSettings().realism;
    this.cfg = defaultConfig("diesel");
    this.summary = safeSummary(this.cfg, null);
    this.sim = new EngineSimulator(this.cfg);
    this.bench = new Workbench(this.cfg);
    this.console = new ControlPanel(this.inputs, SOUND_AVAILABLE);
    this.gearbox = new GearboxPanel(this.cfg, this.summary);
    this.info = new DriveInfo(this.cfg, this.gearbox.drivetrain);
    this.gearbox.drivetrain.setAutoHold(getSettings().autoHold);
    this.gearbox.drivetrain.setDamageLevel(getSettings().realism);
    this.announcer = document.createElement("p");
    this.announcer.className = "sr-only";
    this.announcer.setAttribute("aria-live", "polite");
    this.cfg = this.bench.config;
    this.layout();
    this.wire();
    this.applyConfig(this.cfg);
    this.setLayout(getSettings().layout);
    setBugContext(() => this.bugSections());
    this.unsubscribeSettings = onSettingsChange((st) => {
      if (st.layout !== this.layoutId) this.setLayout(st.layout);
      this.inputs.damage = st.realism;
      this.gearbox.drivetrain.setDamageLevel(st.realism);
      this.gearbox.drivetrain.setAutoHold(st.autoHold);
      this.console.syncSettings(st);
      this.recorder.syncSettings(st);
      this.syncUnits();
    });
  }

  /** The simulator that drives: the electric one when an EV is loaded (#108), else the engine. */
  private get psim(): EngineSimulator | EvSimulator {
    return this.evSim ?? this.sim;
  }

  /**
   * Electric car loaded or unloaded (#108; detected from the drivetrain, so every way of loading a vehicle works):
   * swaps the simulator, the Ready button for key and starter, the EV instruments in the Prüfzelle and every cockpit
   * design, and hides what makes no sense (cutaway engine, nameplate, curve recorder, Werkbank).
   */
  private syncDrive() {
    const ev = this.gearbox.drivetrain.ev;
    if (ev === this.evCfg) return;
    let sameCar = this.evTuning && !!ev && !!this.evSim;
    this.evTuning = false;
    // a newly loaded electric car comes with its stored E-Tuner setup (per vehicle)
    const car = ev ? VEHICLE_LIBRARY.find((c) => c.id === this.gearbox.vehiclePanel.carId && c.setup.ev) ?? null : null;
    const stored = car && !sameCar ? loadEvTuning(car) : null;
    if (car && stored) {
      const t = tuneEv(car.setup.ev!, stored, car.setup.vehicle.wheelRadiusM);
      this.applyTuned(t, car.setup.vehicle.massKg + t.deltaKg);
      sameCar = false;
    }
    const evNow = this.gearbox.drivetrain.ev;
    this.evCfg = evNow;
    if (!sameCar) this.console.switchOff();
    if (evNow) {
      if (sameCar) this.evSim!.setConfig(structuredClone(evNow) as EvConfig, true);
      else this.evSim = new EvSimulator(structuredClone(evNow) as EvConfig);
    } else this.evSim = null;
    if (!sameCar) this.evRange = evNow ? new RangeEstimator(evNow.ratedKwhPer100 ?? 18, "electric") : null;
    if (!sameCar) this.evBench.setCar(car, stored ?? undefined);
    this.evPanel.setShown(!!evNow);
    this.bench.setElectric(!!evNow);
    this.shiftPad?.setElectric(!!evNow);
    const on = !!evNow;
    this.cell.dataset.drive = on ? "ev" : "ice";
    this.root.dataset.drive = on ? "ev" : "ice";
    this.console.setElectric(on);
    this.gauges.setElectric(ev as EvConfig | null);
    this.gearbox.el.dataset.drive = on ? "ev" : "ice";
    this.info.setElectricVmax(ev ? evRpmVmaxKmh(ev as EvConfig, this.gearbox.drivetrain.vehicle.wheelRadiusM) : null);
    for (const v of this.views.values()) if (v instanceof CockpitView) v.setElectric(ev as EvConfig | null);
    this.toasts.clear();
  }

  /** E-Tuner (#108): motors, battery, cooling on the drivetrain, the mass and the tyre type of the vehicle. */
  private applyTuned(t: TunedEv, massKg: number): boolean {
    const d = this.gearbox.drivetrain;
    if (!d.setEv(t.ev)) return false;
    d.setVehicleParams({ massKg });
    // Vmax limiter of the Werkbank (null: the rotor speed limits)
    d.setSpeedLimit(t.governorKmh);
    if (d.tyre.type !== t.tuning.tyre) d.setTyre({ ...d.tyre, type: t.tuning.tyre });
    this.gearbox.vehiclePanel.sync();
    return true;
  }

  private setEvMode(m: EvDriveMode) {
    this.evMode = m;
    this.evPanel.setMode(m, false);
    this.inputs.evDriveMode = m;
    this.announce(`Fahrmodus ${m === "chill" ? "Chill" : m === "sport" ? "Sport" : "Plaid"}.`);
  }

  /** Switches the view (#26). The simulation, the bench and every measured run stay as they are. */
  private setLayout(id: LayoutId) {
    this.layoutId = id;
    this.cell.dataset.layout = id;
    this.layoutSel.value = id;
    const view = id === "pruefzelle" ? null : this.view(id);
    this.viewSlot.replaceChildren(...(view ? [view.el] : []));
    // Tempomat-Leiste: in the cockpit it sits in the centre display (reachable on phones), elsewhere in the gearbox panel
    const cruiseEl = this.gearbox.cruise.el;
    if (view instanceof CockpitView) view.cruiseSlot.append(cruiseEl);
    else this.gearbox.cruiseHome();
    this.viewSlot.hidden = !view;
    if (view) view.redraw();
    else this.gauges.redraw();
    // the recorder is shown in every view; its canvas is sized on redraw
    this.recorder.redraw(this.sim.state.t);
  }

  private view(id: Exclude<LayoutId, "pruefzelle">): LayoutView {
    let v = this.views.get(id);
    if (!v) {
      {
        // the only view besides the Prüfzelle since #94; Renn-Dash and Kompakt are cockpit designs now
        const c = new CockpitView();
        c.onWantVehicle = () => {
          const sel = this.root.querySelector<HTMLSelectElement>("select[data-control=mode]");
          if (!sel || sel.value === "vehicle") return;
          sel.value = "vehicle";
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          this.announce("Rollenprüfstand mit Getriebe gewählt.");
        };
        c.onEvMode = () => this.setEvMode(nextDriveMode(this.evMode));
        // "Automatisch": the loaded library car's own cluster, if it brings one (looked up once per car)
        let carKey: string | null = null;
        let carPick: CockpitDesignId | undefined;
        c.preferredDesign = () => {
          const id = this.gearbox.vehiclePanel.carId;
          if (id !== carKey) {
            carKey = id;
            carPick = carDesign(id, VEHICLE_LIBRARY.find((v) => v.id === id)?.cockpitDesign);
          }
          return carPick;
        };
        c.setElectric(this.evCfg as EvConfig | null);
        // tap on the road line in the cockpit: to the Umwelt panel, route select focused
        c.onWantEnvironment = () => {
          const panel = this.gearbox.environmentPanel.el;
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
          panel.querySelector<HTMLSelectElement>("[data-control=terrain]")?.focus({ preventScroll: true });
        };
        v = c;
      }
      v.configure(this.cfg, this.summary, this.info);
      this.views.set(id, v);
    }
    return v;
  }

  /** Global unit setting changed or instrument overrides reset (#24): display only, the engine keeps running. */
  syncUnits() {
    if (this.disposed) return;
    this.gauges.syncUnits();
    this.bench.syncUnits();
    this.nameplate.update(this.cfg, this.summary);
    this.recorder.syncUnits();
    this.gearbox.syncUnits();
    for (const v of this.views.values()) v.syncUnits();
    this.views.get(this.layoutId as Exclude<LayoutId, "pruefzelle">)?.redraw();
  }

  private layout() {
    const cell = document.createElement("div");
    cell.className = "cell";

    const top = document.createElement("header");
    top.className = "cell__top";
    top.innerHTML = `
      <a class="btn btn--small cell__menu" href="#menu" aria-keyshortcuts="Escape">Menü</a>
      <h1 class="cell__title">Prüfzelle</h1>
      <label class="cell__layout"><span class="sr-only">Ansicht</span>
        <select data-control="layout" title="Ansicht wechseln">${LAYOUTS.map((l) => `<option value="${l.id}">${l.label}</option>`).join("")}</select>
      </label>
      <button type="button" class="btn bench-toggle" aria-expanded="false" aria-controls="werkbank">Werkbank<span class="bench-toggle__verb"> öffnen</span></button>`;
    const toggle = top.querySelector<HTMLButtonElement>(".bench-toggle")!;
    // "Fehler melden" (#55): icon button, compact enough for 390 px phones
    toggle.before(bugButton(true, "cell__bug"));
    // toasts hang below the header and float over the stage: they never move the control bar
    top.append(this.toasts.el);
    this.cell = cell;
    this.layoutSel = top.querySelector<HTMLSelectElement>("[data-control=layout]")!;
    this.layoutSel.addEventListener("change", () => setSettings({ layout: this.layoutSel.value as LayoutId }));
    const setOpen = (open: boolean) => {
      cell.classList.toggle("bench-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      // phones show only "Werkbank" (state via aria-expanded), so the view switch keeps room for its label
      toggle.querySelector(".bench-toggle__verb")!.textContent = open ? " schließen" : " öffnen";
    };
    toggle.addEventListener("click", () => setOpen(!cell.classList.contains("bench-open")));
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && cell.classList.contains("bench-open")) {
          // handled here: the router must not leave the sandbox on this Esc (#42)
          e.preventDefault();
          setOpen(false);
          toggle.focus();
        }
      },
      { signal: this.abort.signal },
    );

    const stage = document.createElement("main");
    stage.className = "stage";
    const engine = document.createElement("div");
    engine.className = "stage__engine";
    engine.append(this.schematic.el, this.nameplate.el);
    this.viewSlot = document.createElement("div");
    this.viewSlot.className = "stage__view";
    this.viewSlot.hidden = true;
    stage.append(this.viewSlot, engine, this.gauges.el, this.gearbox.el, this.recorder.el);
    // Elektroantrieb (#108): drive mode next to the gear, readouts in the Getriebe-Pult's list ("Laden auf" in place of
    // "Volltanken"), the E-Tuner on the Werkbank
    this.gearbox.el.querySelector(".gearbox__drive")!.append(this.evPanel.modeEl);
    this.gearbox.el.querySelector(".gearbox__tank")!.before(...this.evPanel.rows);
    this.bench.el.append(this.evBench.el);
    this.stage = stage;

    const deck = document.createElement("footer");
    deck.className = "deck";
    deck.append(this.console.el, this.console.pedalsEl);
    // ▲ gear ▼ next to brake and gas (setting "Schaltknöpfe in der Bedienleiste")
    this.shiftPad = new ShiftPad(() => this.gearbox.drivetrain);
    this.console.pedalsEl.prepend(this.shiftPad.el);
    this.console.setPedalSide(getSettings().pedalSide);

    this.header = top;
    this.deck = deck;
    cell.append(top, this.bench.el, stage, deck, this.announcer, this.smoke.el);
    this.root.replaceChildren(cell);
  }

  private wire() {
    const signal = this.abort.signal;
    this.bench.onChange((cfg) => {
      this.pendingCfg = cfg;
    });
    this.gearbox.onResetVehicle = () => {
      this.psim.resetVehicle();
      if (this.evCfg) this.evRange = new RangeEstimator(this.evCfg.ratedKwhPer100 ?? 18, "electric");
      this.fuelRangeKey = "";
    };
    // Elektro-Platte (#108)
    this.evPanel.onMode = (m) => this.setEvMode(m);
    this.evPanel.onCharge = (soc) => {
      this.evSim?.setSoc(soc);
      this.announce(`Akku auf ${Math.round(soc * 100)} % geladen.`);
    };
    this.evBench.onFactory = () => {
      if (this.gearbox.drivetrain.state.speedKmh > 0.5) return false;
      // the Fahrzeug-Platte's reset: own changes and E-Tuner setup, car as delivered; syncDrive sees the new config
      this.gearbox.vehiclePanel.resetFactory();
      this.syncDrive();
      this.announce("E-Tuner: Werkszustand.");
      return true;
    };
    this.evBench.onTune = (t, massKg) => {
      const d = this.gearbox.drivetrain;
      if (d.state.speedKmh > 0.5) return false;
      this.evTuning = true;
      if (!this.applyTuned(t, massKg)) {
        this.evTuning = false;
        return false;
      }
      // stored per vehicle: the E-Tuner record, mass and tyre with the vehicle's own changes
      saveEvTuning(this.gearbox.vehiclePanel.carId, t.tuning);
      this.gearbox.vehiclePanel.remember();
      this.syncDrive();
      this.announce(`Umgebaut: ${Math.round(t.systemPs)} PS, ${Math.round(massKg)} kg.`);
      return true;
    };
    // ready-made car (issue #22): engine from the library, the rest is set on the drivetrain by the plate
    this.gearbox.vehiclePanel.onLoadCar = (car) => {
      // electric car (#108): no engine to load; a running engine is switched off first
      if (car.setup.ev) {
        if (App.turning(this.sim.state) && !this.evSim) {
          this.announce("Erst den Motor abstellen, dann lässt sich ein fertiges Auto laden.");
          return false;
        }
        setOwnVehicleActive(false);
        this.announce(`${car.name} geladen. Ready drücken zum Losfahren.`);
        return true;
      }
      if (App.turning(this.sim.state) || this.bench.isLocked) {
        this.announce("Erst den Motor abstellen, dann lässt sich ein fertiges Auto laden.");
        return false;
      }
      this.bench.loadLibrary(car.engineId);
      setOwnVehicleActive(false);
      this.announce(`${car.name} geladen.`);
      return true;
    };
    // a production engine picked on the bench brings its car along (gearbox, body, tyres), if the library has it
    this.bench.onLibraryLoad = (id) => {
      const car = this.gearbox.vehiclePanel.selectCarForEngine(id);
      if (car) {
        setOwnVehicleActive(false);
        this.announce(`Fahrzeug passend zum Motor: ${car.name}.`);
      }
    };
    this.console.onModeChange = (mode) => this.gearbox.setVisible(mode === "vehicle");
    // parking brake by hand (issue #91): P button or key
    this.console.onPark = () => {
      const d = this.gearbox.drivetrain;
      const held = d.toggleParkingBrake();
      // at speed it does not hold: it brakes the car down to a stop (review PR #92)
      this.announce(!held ? "Feststellbremse gelöst." : d.state.speedKmh > 0.5 ? "Feststellbremse angezogen: Sie bremst das Auto bis zum Stillstand ab." : "Feststellbremse angezogen.");
    };
    this.console.onIgnition = (on) => {
      if (on) void this.ensureSound();
    };
    this.console.onSound = (muted, vol) => {
      if (!muted) void this.ensureSound();
      this.sound.setVolume(muted ? 0 : vol);
    };
    this.console.onReset = () => {
      this.toasts.clear();
      this.gearbox.reset();
      this.psim.reset();
      this.recorder.reset();
      this.announce(this.evSim ? "Auto zurückgesetzt, Akku geladen." : "Motor zurückgesetzt.");
    };
    this.console.onWarmChange = (warm) => {
      if (App.turning(this.psim.state)) {
        this.announce(warm ? "Warmstart gilt ab dem nächsten Zurücksetzen." : "Kaltstart gilt ab dem nächsten Zurücksetzen.");
        return;
      }
      this.psim.reset();
      this.recorder.reset();
      this.gearbox.reset();
      this.announce(warm ? "Motor ist warm." : "Motor ist kalt.");
    };
    this.recorder.onMeasured((auto) => {
      // automatic runs follow every bench change: not announced, the screen reader would never stop
      if (auto) return;
      const r = this.recorder.latestRun;
      if (r) this.announce(`Volllastkurve gemessen: ${fmtQ("torque", r.peakTorque.torqueNm)} bei ${fmt(r.peakTorque.rpm)}, ${fmtQ("power", r.peakPower.powerKw)} bei ${fmt(r.peakPower.rpm)} Umdrehungen pro Minute.`);
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (this.paused) return;
        if (this.gearbox.handleKey(e, true) || this.console.handleKey(e, true)) e.preventDefault();
      },
      { signal },
    );
    document.addEventListener(
      "keyup",
      (e) => {
        if (this.paused) return;
        if (this.gearbox.handleKey(e, false) || this.console.handleKey(e, false)) e.preventDefault();
      },
      { signal },
    );
    // "Ton" is on by default, but browsers start audio only from a user gesture: the first tap or key in the
    // sandbox starts it. Later gestures resume a context the browser kept suspended (iOS wants touchend/click).
    // pointerdown is no activation gesture everywhere (iOS), so it is not used; once the context runs the
    // listeners go away.
    const unlockAbort = new AbortController();
    signal.addEventListener("abort", () => unlockAbort.abort());
    const unlock = () => {
      if (this.sound.running) {
        unlockAbort.abort();
        return;
      }
      if (this.paused || this.console.muted) return;
      if (!this.soundStarted) void this.ensureSound().then(() => this.sound.running && unlockAbort.abort());
      else void this.sound.resume().then(() => this.sound.running && unlockAbort.abort());
    };
    for (const ev of ["pointerup", "touchend", "click", "keydown"] as const) {
      this.root.addEventListener(ev, unlock, { signal: unlockAbort.signal, capture: true, passive: true });
    }
    // one live region per message (#85 review): the toasts speak only where the console list is hidden
    const phone = window.matchMedia?.("(max-width: 700px)");
    const syncLive = () => this.toasts.setLive(phone?.matches ?? false);
    syncLive();
    phone?.addEventListener("change", syncLive, { signal });
    window.addEventListener("blur", () => this.console.releaseAll(), { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.console.releaseAll();
        else this.wake.onVisible();
      },
      { signal },
    );
    window.addEventListener(
      "resize",
      () => {
        cancelAnimationFrame(this.resizeRaf);
        this.resizeRaf = requestAnimationFrame(() => {
          this.gauges.redraw();
          this.recorder.redraw(this.sim.state.t);
          this.activeView?.redraw();
        });
      },
      { signal },
    );
    // fonts arrive late; redraw canvases so numerals use Barlow
    void document.fonts?.ready.then(() => {
      if (this.disposed) return;
      this.gauges.redraw();
      this.recorder.redraw(this.sim.state.t);
      this.activeView?.redraw();
    });
  }

  private get activeView(): LayoutView | undefined {
    return this.layoutId === "pruefzelle" ? undefined : this.views.get(this.layoutId);
  }

  private async ensureSound() {
    if (this.soundStarted || this.console.muted) return;
    this.soundStarted = true;
    try {
      // setConfig before start() is allowed; it lets the worklet receive its voice right after loading
      this.sound.setConfig(this.cfg, this.summary);
      this.sound.setVolume(this.console.muted ? 0 : this.console.volumeLevel);
      await this.sound.start();
      if (this.disposed) this.sound.stop();
    } catch (e) {
      this.soundStarted = false;
      console.warn("Sound konnte nicht starten", e);
    }
  }

  /** Only called while the engine stands still (the bench is locked otherwise), so the reset inside
   *  EngineSimulator.setConfig() never cuts a running engine. */
  private applyConfig(cfg: EngineConfig) {
    this.cfg = cfg;
    this.summary = safeSummary(cfg, this.summary);
    this.sim.setConfig(cfg);
    this.schematic.configure(cfg, this.summary);
    this.nameplate.update(cfg, this.summary);
    this.gauges.configure(cfg, this.summary);
    this.recorder.configure(cfg, this.summary);
    this.console.configure(cfg.revLimitRpm, this.summary.peakTorqueNm);
    this.gearbox.configure(cfg, this.summary);
    this.info.setEngine(cfg);
    for (const v of this.views.values()) v.configure(cfg, this.summary, this.info);
    if (this.soundStarted) this.sound.setConfig(cfg, this.summary);
    this.root.dataset.fuel = cfg.fuel;
    this.gearbox.trip.setFuel(cfg.fuel);
  }

  private sample(s: EngineState, dt: number) {
    this.sampleT += dt;
    if (this.sampleT < SAMPLE_INTERVAL_S) return;
    this.sampleT = 0;
    const vehicle = this.inputs.dynoMode === "vehicle";
    const d = this.gearbox.drivetrain;
    this.samples.push({
      t: s.t, rpm: s.rpm, speedKmh: vehicle ? d.state.speedKmh : 0, gear: vehicle ? d.gearLabel() : "-",
      pedal: this.inputs.pedal, braking: this.console.brakeHeld, running: s.running,
    });
  }

  /** Sandbox part of the bug report diagnosis (#55): only game state, nothing personal. */
  private bugSections(): DiagnosisSection[] {
    const d = this.gearbox.drivetrain;
    const ds = d.state;
    const env = d.environment;
    const vehicle = this.inputs.dynoMode === "vehicle";
    const carId = this.gearbox.vehiclePanel.carId;
    const car = VEHICLE_LIBRARY.find((c) => c.id === carId);
    const terrain = env.terrain ?? "static";
    const n = (v: number | undefined, digits = 1) => (v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(digits));
    return [
      {
        id: "view",
        label: "Ansicht und Prüfstand",
        text: `Route ${location.hash || "#sandbox"}, Ansicht ${this.layoutId}, Prüfstand ${this.inputs.dynoMode}${this.paused ? " (pausiert, Menü offen)" : ""}`,
      },
      {
        id: "engine",
        label: "Motor",
        text: `${this.cfg.name} (id ${this.cfg.id}, ${this.cfg.fuel}), Begrenzer ${this.cfg.revLimitRpm} U/min, Zündung ${this.inputs.ignition ? "an" : "aus"}, läuft ${this.sim.state.running ? "ja" : "nein"}${this.evSim ? `; Elektroauto, Ready ${this.evSim.state.running ? "an" : "aus"}, SoC ${Math.round((this.evSim.state.ev?.soc ?? 0) * 100)} %, Modus ${this.evMode}` : ""}`,
      },
      {
        id: "vehicle",
        label: "Fahrzeug",
        text: vehicle
          ? `${car ? `${car.name} (id ${car.id})` : "eigenes Fahrzeug"}, Art ${d.kind}, Getriebe ${ds.type}, Gang ${d.gearLabel()} von ${ds.gearCount}, ${n(ds.speedKmh)} km/h, Tank ${Math.round(d.tank.fraction * 100)} %`
          : "kein Fahrzeug (Motorprüfstand)",
      },
      {
        id: "environment",
        label: "Umwelt",
        text: `Strecke ${terrain}${terrain === "static" ? `, Steigung ${n(env.gradePct)} %` : `, Position ${n(ds.positionM, 0)} m, Steigung dort ${n(ds.roadGradePct)} %`}, Höhe ${n(ds.roadAltitudeM ?? env.altitudeM, 0)} m, Wetter ${env.weather}, ${n(env.ambientC)} °C`,
      },
      { id: "values", label: "Werte der letzten 5 s", text: samplesText(this.samples.toArray()) },
    ];
  }

  private announce(text: string) {
    this.announcer.textContent = text;
  }

  /** Steps the vehicle systems (#83) from the last engine state; returns how they act on brake and pedal. */
  private stepSystems(dt: number, vehicle: boolean) {
    const e = this.sim.state;
    const d = this.gearbox.drivetrain;
    return this.systems.step(dt, {
      ignition: this.inputs.ignition, running: e.running, starter: e.starterEngaged, rpm: e.rpm, fuelFlowLh: e.fuelFlowLh, egtC: e.egtC,
      scr: this.cfg.fuel === "diesel" && !!this.cfg.exhaust.scr, vehicle, kind: d.kind, brake: this.console.brakeHeld ? 1 : 0,
      speedMs: e.vehicleSpeedMs ?? 0, massKg: d.vehicle.massKg, finalDrive: d.state.finalDrive, wheelRadiusM: d.vehicle.wheelRadiusM,
    });
  }

  /** Fuel range: tank litres ÷ the rolling consumption; the rated start value follows from the car and the fuel. */
  private stepFuelRange(dt: number, s: EngineState): number {
    const d = this.gearbox.drivetrain;
    const v = d.vehicle;
    const key = `${this.cfg.fuel}|${v.massKg}|${v.dragCoefficient}|${v.frontalAreaM2}|${v.rollingResistance}`;
    if (!this.fuelRange || key !== this.fuelRangeKey) {
      this.fuelRangeKey = key;
      // heavy vehicles (trucks, buses) are rated at 80 km/h
      this.fuelRange = new RangeEstimator(ratedLPer100(v, this.cfg.fuel, v.massKg > 3500), "fuel");
    }
    this.fuelRange.step(dt, s.running ? s.fuelFlowLh : 0, d.state.speedKmh);
    return this.fuelRange.rangeKm(d.tank.levelL);
  }

  /** Engine turning (running, cranking or spinning down): the bench is locked. */
  private static turning(s: EngineState): boolean {
    return s.running || s.rpm > 1;
  }

  start() {
    this.last = 0;
    const frame = (now: number) => {
      if (this.disposed || this.paused) return;
      const dt = this.last ? Math.min(MAX_DT, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
      this.last = now;
      if (this.pendingCfg && !App.turning(this.sim.state)) {
        const cfg = this.pendingCfg;
        this.pendingCfg = null;
        this.applyConfig(cfg);
      }
      this.console.tick(dt);
      this.syncDrive();
      const sim = this.psim;
      let s: EngineState;
      try {
        if (this.inputs.dynoMode === "vehicle") {
          const d = this.gearbox.drivetrain;
          // vehicle systems (#83): air pressure limits the service brake, spring brakes below 4.5 bar, retarder, AdBlue
          const sx = this.stepSystems(dt, true);
          const gate = this.evSim ? this.shiftPad.pedalGate : 1;
          const vehicle = d.inputs(dt, sim.state, this.inputs.pedal * gate, sx.brake);
          if (sx.retarderG > 0) vehicle.brake = Math.min(1, (vehicle.brake ?? 0) + sx.retarderG / BRAKE_MAX_G);
          // environment (issue #23): outside temperature and air pressure of the test track reach the engine intake
          // tank: an empty tank starves the engine (no injection), it stalls and does not restart
          s = sim.step(dt, { ...this.inputs, ...d.simInputs(), vehicle, pedal: d.effectivePedal(this.inputs.pedal * gate) * sx.pedalCap, fuelEmpty: d.tank.empty });
          // an electric car (#108) draws no fuel
          if (s.running && !this.evSim) d.tank.step(dt, s.fuelFlowLh);
          // at the pump AdBlue is topped up too (the tank level jumps up)
          if (d.tank.levelL > this.lastTankL + 0.5) this.systems.adblue.refill();
          this.lastTankL = d.tank.levelL;
        } else {
          this.stepSystems(dt, false);
          s = sim.step(dt, this.inputs);
        }
      } catch (e) {
        console.warn("Simulator-Schritt fehlgeschlagen", e);
        s = sim.state;
      }
      // the range everywhere (readouts, every cockpit design) from the rolling consumption, not the trip average
      // (one estimator for both drives, range-estimator.ts); only with a vehicle on the chassis dyno
      let rangeKm = Number.NaN;
      if (s.ev && this.evRange && this.evCfg) {
        this.evRange.step(dt, s.ev.powerKw, this.gearbox.drivetrain.state.speedKmh);
        s.ev.rangeKm = this.evRange.rangeKm(packKwhLeft(s.ev.soc, evPackKwh(this.evCfg as EvConfig)));
        if (this.inputs.dynoMode === "vehicle") rangeKm = s.ev.rangeKm;
      } else if (this.inputs.dynoMode === "vehicle" && !this.evSim) rangeKm = this.stepFuelRange(dt, s);
      this.gearbox.showRange(rangeKm);
      this.evPanel.update(s, this.gearbox.drivetrain.state.speedKmh);
      // the bench edits the combustion engine: an electric car (#108) does not lock it
      this.bench.setLocked(App.turning(this.evSim ? this.sim.state : s));
      if (this.pendingEngineId && !App.turning(s)) this.loadEngine(this.pendingEngineId);
      this.sample(s, dt);
      this.sinceIgnition = this.inputs.ignition ? this.sinceIgnition + dt : 0;
      const view = this.activeView;
      if (view) {
        view.update({
          s, dt, mode: this.inputs.dynoMode, ignition: this.inputs.ignition, sinceIgnitionS: this.sinceIgnition,
          pedal: this.inputs.pedal, braking: this.console.brakeHeld, drivetrain: this.gearbox.drivetrain, trip: this.gearbox.trip.computer.data,
          systems: this.systems, rangeKm,
        });
      } else {
        // hidden canvases of the Prüfzelle are not drawn while another view is shown
        this.gauges.update(s, dt, this.systems.batteryV);
        this.schematic.update(s, dt);
      }
      // the recorder is shown and drawn in every view
      this.recorder.update(s, dt);
      this.console.update(s);
      // "Tank leer" only when the engine dies of it (running → stopped with an empty tank), latched until it runs
      const tankEmpty = this.inputs.dynoMode === "vehicle" && this.gearbox.drivetrain.tank.empty;
      if (this.wasRunning && !s.running && tankEmpty) this.fuelStall = true;
      if (s.running || !tankEmpty) this.fuelStall = false;
      this.wasRunning = s.running;
      this.toasts.update({ state: s, outOfFuel: this.fuelStall, gearbox: this.inputs.dynoMode === "vehicle" ? this.gearbox.drivetrain.state : undefined, tyre: this.inputs.dynoMode === "vehicle" ? this.gearbox.drivetrain.state : undefined }, now, getSettings().limitHints === "toast");
      if (this.inputs.dynoMode === "vehicle") this.gearbox.update(this.console.brakeHeld);
      {
        const ds = this.gearbox.drivetrain.state;
        this.console.renderPark(this.inputs.dynoMode === "vehicle" && !!ds.parkingBrake, ds.autoHold !== false, this.inputs.dynoMode === "vehicle", ds.speedKmh > 0.5);
      }
      this.shiftPad.update(this.inputs.dynoMode === "vehicle");
      // board computer counts only while the car drives on the chassis dyno (#40, #41)
      this.gearbox.trip.step(dt, s, this.inputs.dynoMode === "vehicle");
      if (this.soundStarted) {
        this.sound.update(s, this.inputs.pedal);
        const ds = this.gearbox.drivetrain.state;
        const veh = this.inputs.dynoMode === "vehicle";
        this.sound.setTyre?.({ vibration: veh && !!ds.tyreVibration, failed: veh && !!ds.tyreFailed, speedMs: ds.speedKmh / 3.6, wheelRadiusM: this.gearbox.drivetrain.vehicle.wheelRadiusM });
      }
      const st = getSettings();
      this.updateSmoke(s, dt, st.effects);
      this.wake.update(st.wakeLock && s.running);
      this.haptics.update(dt, s, this.evSim ? Infinity : this.cfg.revLimitRpm, this.inputs.pedal, st.vibration === "on" || (st.vibration === "auto" && isTouch()), this.tyreHaptics());
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /**
   * Leaving the sandbox for the menu (#42): the loop stops (rAF cancelled), held keys are released and the
   * sound is muted. State, runs and the trip computer stay; resume() continues where it stopped.
   */
  pause() {
    if (this.paused || this.disposed) return;
    this.paused = true;
    cancelAnimationFrame(this.rafId);
    this.console.releaseAll();
    this.gearbox.cruise.release();
    this.gearbox.trip.save();
    this.wake.release();
    this.smoke.clear();
    if (this.soundStarted) {
      // silence first (smoothed in the DSP), then stop the audio clock
      this.sound.setVolume(0);
      const sound = this.sound;
      setTimeout(() => {
        if (this.paused) void sound.suspend();
      }, 80);
    }
  }

  /** Tyre state for the vibration and the smoke (issue #144); undefined on the engine dyno. */
  private tyreHaptics(): { vibration: boolean; failed: boolean; moving: boolean } | undefined {
    if (this.inputs.dynoMode !== "vehicle") return undefined;
    const ds = this.gearbox.drivetrain.state;
    return { vibration: !!ds.tyreVibration, failed: !!ds.tyreFailed, moving: ds.speedKmh > 5 };
  }

  /** Smoke and steam from the state values only (smoke-emitters.ts); the lamps' limits, no own thresholds. */
  private updateSmoke(s: EngineState, dt: number, enabled: boolean) {
    const vehicle = this.inputs.dynoMode === "vehicle";
    const cooling = this.cfg.cooling.type;
    const e = emission({
      running: s.running, vehicle, vehicleSpeedMs: s.vehicleSpeedMs, wheelSlip: s.wheelSlip, wheelSpin: s.wheelSpin, wheelsLocked: s.wheelsLocked, brakeSlip: s.brakeSlip,
      tyreFailed: vehicle && !!this.gearbox.drivetrain.state.tyreFailed, tyreTreadC: vehicle ? this.gearbox.drivetrain.state.tyreTempC : undefined,
      liquidCooled: cooling !== "air" && cooling !== "oil-air", coolantC: s.coolantC, coolantMaxC: this.summary.limits.coolantMaxC,
      oilC: s.oilC, oilMaxC: this.summary.limits.oilMaxC, warnings: s.warnings, damaged: s.destroyed || s.damage.length > 0,
      diesel: this.cfg.fuel === "diesel", smoke: s.smoke, smokeMax: FALLBACK_LIMITS.smokeMax,
    });
    this.smoke.update(e, dt, enabled);
  }

  /**
   * Where the smoke comes from: the bottom edge of the instruments (tyres) and the bonnet edge of the cockpit or the
   * engine cutaway (steam), the same for every cockpit design since all of them render into the view's element.
   * The visible part of the stage clips the effect; a source scrolled out of it is held at its edge, so a little
   * smoke still shows on phones where the cluster is taller than the screen.
   */
  private smokeAnchors(): SmokeAnchors {
    // on phones the page scrolls under a sticky header and control bar: never paint over them
    const st = this.stage.getBoundingClientRect();
    const top = Math.max(st.top, this.header.getBoundingClientRect().bottom, 0);
    const vp = document.documentElement;
    const bottom = Math.min(st.bottom, this.deck.getBoundingClientRect().top, vp.clientHeight || window.innerHeight);
    const left = Math.max(st.left, 0);
    const right = Math.min(st.right, vp.clientWidth || window.innerWidth);
    if (bottom - top < 2 || right - left < 2) return { clip: null, tyre: null, engine: null };
    const clip = new DOMRect(left, top, right - left, bottom - top);
    const view = this.activeView;
    const inst = (view ? view.el : this.gauges.el).getBoundingClientRect();
    const eng = (view ? view.el : this.schematic.el).getBoundingClientRect();
    const ok = (r: DOMRect) => r.width > 0 && r.height > 0;
    const within = (y: number) => Math.min(bottom, Math.max(top, y));
    const span = (r: DOMRect, f: number) => ({ x0: Math.max(left, r.left + r.width * f), x1: Math.min(right, r.right - r.width * f) });
    return {
      clip,
      tyre: ok(inst) ? { ...span(inst, 0.08), y: within(inst.bottom) } : null,
      engine: !ok(eng) ? null : view ? { ...span(eng, 0.2), y: within(eng.top) } : { ...span(eng, 0.25), y: within(eng.top + eng.height * 0.35) },
    };
  }

  /** Engine of the guided start waiting for the running engine to spin down (#93 review). */
  private pendingEngineId: string | null = null;

  private setMode(v: string) {
    const mode = this.root.querySelector<HTMLSelectElement>("select[data-control=mode]");
    if (!mode || mode.value === v) return;
    mode.value = v;
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Loads a library engine on the bench (applied by the main loop at standstill). A running engine is switched off
   * first and the new one follows as soon as it stands still, so the vehicle never runs with the old engine.
   * Returns true when the swap had to wait.
   */
  private loadEngine(id: string): boolean {
    // own engines (#72) are reloaded every time: they may have been edited under the same id
    if (id === this.cfg.id && !this.pendingEngineId && !isMyEngineId(id)) return false;
    if (App.turning(this.psim.state) || this.bench.isLocked) {
      this.console.switchOff();
      this.pendingEngineId = id;
      return true;
    }
    this.pendingEngineId = null;
    this.bench.loadLibrary(id);
    return false;
  }

  /**
   * The guided start in the main menu (#93): vehicle kind, vehicle (+ its engine), route. Applied on mount/resume;
   * nothing pending ("Weiter wie zuletzt") leaves the sandbox as it was.
   */
  applyPendingSetup(p: PendingSetup | null = takePendingSetup()) {
    if (!p) return;
    // the car is still rolling (left the sandbox while driving): nothing is switched under it
    if (this.gearbox.drivetrain.state.speedKmh > 0.5) {
      this.announce("Das Fahrzeug rollt noch: erst anhalten, dann Fahrzeug und Strecke wählen.");
      return;
    }
    if (p.kind === "engine" || !p.route) {
      setOwnVehicleActive(false);
      this.setMode("free");
      // an engine from the Engine Builder (#72) comes onto the engine dyno
      if (p.engineId) this.loadEngine(p.engineId);
      return;
    }
    // engine first (or the order to swap it once the running engine is off), then the vehicle
    const waits = p.engineId ? this.loadEngine(p.engineId) : false;
    const panel = this.gearbox.vehiclePanel;
    let name = "";
    if (p.kind === "custom" && p.custom) {
      if (panel.applyOwn(customSetup(p.custom))) {
        name = "Eigenes Fahrzeug";
        saveOwnVehicle(p.custom, true);
      }
    } else if (p.vehicleId) {
      name = panel.selectCar(p.vehicleId)?.name ?? "";
      if (name) setOwnVehicleActive(false);
    }
    // the route after the vehicle: loading a vehicle puts it back to the start of the route
    this.gearbox.environmentPanel.setRoute(p.route);
    this.gearbox.drivetrain.setPosition(0);
    this.setMode("vehicle");
    const t = p.route;
    this.announce(`${name ? `${name}, ` : ""}Strecke: ${t === "static" ? "eben" : TERRAIN_LABELS[t]}. Rollenprüfstand gewählt.${waits ? " Der Motor wird abgestellt, danach kommt der passende Motor." : ""}`);
  }

  /** Reload (#93 review): the own vehicle comes back when it was the last setup (engine, body, tank; the route is
   *  restored by the Umwelt panel). */
  restoreOwnVehicle() {
    const own = loadOwnVehicle();
    if (!own?.active) return;
    this.loadEngine(own.custom.engineId);
    if (!this.gearbox.vehiclePanel.applyOwn(customSetup(own.custom))) return;
    this.gearbox.restoreTank();
    this.setMode("vehicle");
  }

  resume() {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.applyPendingSetup();
    if (this.soundStarted) {
      void this.sound.resume();
      this.sound.setVolume(this.console.muted ? 0 : this.console.volumeLevel);
    }
    // canvases may have been laid out while hidden
    this.gauges.redraw();
    this.recorder.redraw(this.sim.state.t);
    this.activeView?.redraw();
    this.start();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Stops the loop, removes all global listeners and silences the sound (tests, hot reload). */
  dispose() {
    this.bench.dispose();
    this.recorder.dispose();
    this.gearbox.trip.dispose();
    this.gearbox.disposeTank();
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSettings();
    this.wake.release();
    setBugContext(null);
    cancelAnimationFrame(this.rafId);
    cancelAnimationFrame(this.resizeRaf);
    this.abort.abort();
    this.console.releaseAll();
    try {
      this.sound.stop();
    } catch {
      /* sound may not have started */
    }
    this.root.replaceChildren();
    const w = window as unknown as { __pruefzelle?: App };
    if (w.__pruefzelle === this) delete w.__pruefzelle;
  }
}

export function mountApp(root: HTMLElement): App {
  const app = new App(root);
  app.start();
  const p = takePendingSetup();
  if (p) app.applyPendingSetup(p);
  else app.restoreOwnVehicle();
  // Small hook for the e2e tests and for debugging in the console.
  (window as unknown as { __pruefzelle?: App }).__pruefzelle = app;
  return app;
}
