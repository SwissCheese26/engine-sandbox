// Prüfzelle: wires workbench, schematic, nameplate, instruments, recorder and console to the
// simulator and runs the main loop.
import { EngineSimulator, TERRAIN_LABELS, defaultInputs, summarize } from "../core/index.ts";
import { takePendingRoute } from "./route-picker.ts";
import { ShiftPad } from "./shift-pad.ts";
import type { EngineConfig, EngineState, EngineSummary } from "../core/index.ts";
import { defaultConfig } from "../data/presets.ts";
import { ControlPanel } from "./controls.ts";
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
import { CompactView } from "./layouts/compact.ts";
import { RaceView } from "./layouts/race.ts";
import { DriveInfo, type LayoutView } from "./layouts/view.ts";
import { fmtQ } from "./units.ts";

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
  private inputs = defaultInputs();
  private bench: Workbench;
  private schematic = new Schematic();
  private nameplate = new Nameplate();
  private gauges = new InstrumentPanel();
  private recorder = new Recorder();
  private console: ControlPanel;
  private sound = createSound();
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
  /** Sandbox views (#26): the Prüfzelle itself or one of the views in src/ui/layouts/, created on first use. */
  private layoutId: LayoutId = "pruefzelle";
  private views = new Map<LayoutId, LayoutView>();
  private shiftPad!: ShiftPad;
  private viewSlot!: HTMLElement;
  private cell!: HTMLElement;
  private layoutSel!: HTMLSelectElement;
  private info: DriveInfo;
  private sinceIgnition = 0;

  constructor(private root: HTMLElement) {
    this.cfg = defaultConfig("diesel");
    this.summary = safeSummary(this.cfg, null);
    this.sim = new EngineSimulator(this.cfg);
    this.bench = new Workbench(this.cfg);
    this.console = new ControlPanel(this.inputs, SOUND_AVAILABLE);
    this.gearbox = new GearboxPanel(this.cfg, this.summary);
    this.info = new DriveInfo(this.cfg, this.gearbox.drivetrain);
    this.announcer = document.createElement("p");
    this.announcer.className = "sr-only";
    this.announcer.setAttribute("aria-live", "polite");
    this.cfg = this.bench.config;
    this.layout();
    this.wire();
    this.applyConfig(this.cfg);
    this.setLayout(getSettings().layout);
    this.unsubscribeSettings = onSettingsChange((st) => {
      if (st.layout !== this.layoutId) this.setLayout(st.layout);
      this.syncUnits();
    });
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
      if (id === "cockpit") {
        const c = new CockpitView();
        c.onWantVehicle = () => {
          const sel = this.root.querySelector<HTMLSelectElement>("select[data-control=mode]");
          if (!sel || sel.value === "vehicle") return;
          sel.value = "vehicle";
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          this.announce("Rollenprüfstand mit Getriebe gewählt.");
        };
        // tap on the road line in the cockpit: to the Umwelt panel, route select focused
        c.onWantEnvironment = () => {
          const panel = this.gearbox.environmentPanel.el;
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
          panel.querySelector<HTMLSelectElement>("[data-control=terrain]")?.focus({ preventScroll: true });
        };
        v = c;
      } else v = id === "race" ? new RaceView() : new CompactView();
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
      <button type="button" class="btn bench-toggle" aria-expanded="false" aria-controls="werkbank">Werkbank öffnen</button>`;
    const toggle = top.querySelector<HTMLButtonElement>(".bench-toggle")!;
    this.cell = cell;
    this.layoutSel = top.querySelector<HTMLSelectElement>("[data-control=layout]")!;
    this.layoutSel.addEventListener("change", () => setSettings({ layout: this.layoutSel.value as LayoutId }));
    const setOpen = (open: boolean) => {
      cell.classList.toggle("bench-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Werkbank schließen" : "Werkbank öffnen";
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

    const deck = document.createElement("footer");
    deck.className = "deck";
    deck.append(this.console.el, this.console.pedalsEl);
    // ▲ gear ▼ next to brake and gas (setting "Schaltknöpfe in der Bedienleiste")
    this.shiftPad = new ShiftPad(() => this.gearbox.drivetrain);
    this.console.pedalsEl.prepend(this.shiftPad.el);

    cell.append(top, this.bench.el, stage, deck, this.announcer);
    this.root.replaceChildren(cell);
  }

  private wire() {
    const signal = this.abort.signal;
    this.bench.onChange((cfg) => {
      this.pendingCfg = cfg;
    });
    this.gearbox.onResetVehicle = () => this.sim.resetVehicle();
    // ready-made car (issue #22): engine from the library, the rest is set on the drivetrain by the plate
    this.gearbox.vehiclePanel.onLoadCar = (car) => {
      if (App.turning(this.sim.state) || this.bench.isLocked) {
        this.announce("Erst den Motor abstellen, dann lässt sich ein fertiges Auto laden.");
        return false;
      }
      this.bench.loadLibrary(car.engineId);
      this.announce(`${car.name} geladen.`);
      return true;
    };
    // a production engine picked on the bench brings its car along (gearbox, body, tyres), if the library has it
    this.bench.onLibraryLoad = (id) => {
      const car = this.gearbox.vehiclePanel.selectCarForEngine(id);
      if (car) this.announce(`Fahrzeug passend zum Motor: ${car.name}.`);
    };
    this.console.onModeChange = (mode) => this.gearbox.setVisible(mode === "vehicle");
    this.console.onIgnition = (on) => {
      if (on) void this.ensureSound();
    };
    this.console.onSound = (muted, vol) => {
      if (!muted) void this.ensureSound();
      this.sound.setVolume(muted ? 0 : vol);
    };
    this.console.onReset = () => {
      this.gearbox.reset();
      this.sim.reset();
      this.recorder.reset();
      this.announce("Motor zurückgesetzt.");
    };
    this.console.onWarmChange = (warm) => {
      if (App.turning(this.sim.state)) {
        this.announce(warm ? "Warmstart gilt ab dem nächsten Zurücksetzen." : "Kaltstart gilt ab dem nächsten Zurücksetzen.");
        return;
      }
      this.sim.reset();
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
    window.addEventListener("blur", () => this.console.releaseAll(), { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.console.releaseAll();
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
  }

  private announce(text: string) {
    this.announcer.textContent = text;
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
      let s: EngineState;
      try {
        if (this.inputs.dynoMode === "vehicle") {
          const d = this.gearbox.drivetrain;
          const vehicle = d.inputs(dt, this.sim.state, this.inputs.pedal, this.console.brakeHeld ? 1 : 0);
          // environment (issue #23): outside temperature and air pressure of the test track reach the engine intake
          s = this.sim.step(dt, { ...this.inputs, ...d.simInputs(), vehicle, pedal: d.effectivePedal(this.inputs.pedal) });
        } else {
          s = this.sim.step(dt, this.inputs);
        }
      } catch (e) {
        console.warn("Simulator-Schritt fehlgeschlagen", e);
        s = this.sim.state;
      }
      this.bench.setLocked(App.turning(s));
      this.sinceIgnition = this.inputs.ignition ? this.sinceIgnition + dt : 0;
      const view = this.activeView;
      if (view) {
        view.update({
          s, dt, mode: this.inputs.dynoMode, ignition: this.inputs.ignition, sinceIgnitionS: this.sinceIgnition,
          pedal: this.inputs.pedal, braking: this.console.brakeHeld, drivetrain: this.gearbox.drivetrain, trip: this.gearbox.trip.computer.data,
        });
      } else {
        // hidden canvases of the Prüfzelle are not drawn while another view is shown
        this.gauges.update(s, dt);
        this.schematic.update(s, dt);
      }
      // the recorder is shown and drawn in every view
      this.recorder.update(s, dt);
      this.console.update(s);
      if (this.inputs.dynoMode === "vehicle") this.gearbox.update(this.console.brakeHeld);
      this.shiftPad.update(this.inputs.dynoMode === "vehicle");
      // board computer counts only while the car drives on the chassis dyno (#40, #41)
      this.gearbox.trip.step(dt, s, this.inputs.dynoMode === "vehicle");
      if (this.soundStarted) this.sound.update(s, this.inputs.pedal);
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
    if (this.soundStarted) {
      // silence first (smoothed in the DSP), then stop the audio clock
      this.sound.setVolume(0);
      const sound = this.sound;
      setTimeout(() => {
        if (this.paused) void sound.suspend();
      }, 80);
    }
  }

  /** A route chosen in the main menu ("Wähle eine Strecke"): Umwelt → Strecke, onto the chassis dyno. */
  applyPendingRoute() {
    const t = takePendingRoute();
    if (!t) return;
    // the car is still rolling (left the sandbox while driving): the route is not switched under it
    if (this.gearbox.drivetrain.state.speedKmh > 0.5) {
      this.announce("Das Fahrzeug rollt noch: erst anhalten, dann die Strecke unter Umwelt wählen.");
      return;
    }
    if (t === "engine") {
      const m = this.root.querySelector<HTMLSelectElement>("select[data-control=mode]");
      if (m && m.value === "vehicle") {
        m.value = "free";
        m.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    this.gearbox.environmentPanel.setRoute(t);
    this.gearbox.drivetrain.setPosition(0);
    const sel = this.root.querySelector<HTMLSelectElement>("select[data-control=mode]");
    if (sel && sel.value !== "vehicle") {
      sel.value = "vehicle";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    this.announce(`Strecke: ${t === "static" ? "eben" : TERRAIN_LABELS[t]}. Rollenprüfstand gewählt.`);
  }

  resume() {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.applyPendingRoute();
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
    this.recorder.dispose();
    this.gearbox.trip.dispose();
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSettings();
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
  app.applyPendingRoute();
  // Small hook for the e2e tests and for debugging in the console.
  (window as unknown as { __pruefzelle?: App }).__pruefzelle = app;
  return app;
}
