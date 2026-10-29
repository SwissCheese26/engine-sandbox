// Prüfzelle: wires workbench, schematic, nameplate, instruments, recorder and console to the
// simulator and runs the main loop.
import { EngineSimulator, defaultInputs, summarize } from "../core/index.ts";
import type { EngineConfig, EngineState, EngineSummary } from "../core/index.ts";
import { defaultConfig } from "../data/presets.ts";
import { ControlPanel } from "./controls.ts";
import { fmt } from "./format.ts";
import { InstrumentPanel } from "./gauges.ts";
import { Nameplate } from "./nameplate.ts";
import { Recorder } from "./recorder.ts";
import { Schematic } from "./schematic.ts";
import { SOUND_AVAILABLE, createSound } from "./sound-bridge.ts";
import { Workbench } from "./workbench.ts";

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

  constructor(private root: HTMLElement) {
    this.cfg = defaultConfig("diesel");
    this.summary = safeSummary(this.cfg, null);
    this.sim = new EngineSimulator(this.cfg);
    this.bench = new Workbench(this.cfg);
    this.console = new ControlPanel(this.inputs, SOUND_AVAILABLE);
    this.announcer = document.createElement("p");
    this.announcer.className = "sr-only";
    this.announcer.setAttribute("aria-live", "polite");
    this.cfg = this.bench.config;
    this.layout();
    this.wire();
    this.applyConfig(this.cfg);
  }

  private layout() {
    const cell = document.createElement("div");
    cell.className = "cell";

    const top = document.createElement("header");
    top.className = "cell__top";
    top.innerHTML = `
      <h1 class="cell__title">Prüfzelle</h1>
      <button type="button" class="btn bench-toggle" aria-expanded="false" aria-controls="werkbank">Werkbank öffnen</button>`;
    const toggle = top.querySelector<HTMLButtonElement>(".bench-toggle")!;
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
    stage.append(engine, this.gauges.el, this.recorder.el);

    const deck = document.createElement("footer");
    deck.className = "deck";
    deck.append(this.console.el, this.console.pedalEl);

    cell.append(top, this.bench.el, stage, deck, this.announcer);
    this.root.replaceChildren(cell);
  }

  private wire() {
    const signal = this.abort.signal;
    this.bench.onChange((cfg) => {
      this.pendingCfg = cfg;
    });
    this.console.onIgnition = (on) => {
      if (on) void this.ensureSound();
    };
    this.console.onSound = (muted, vol) => {
      if (!muted) void this.ensureSound();
      this.sound.setVolume(muted ? 0 : vol);
    };
    this.console.onReset = () => {
      this.sim.reset();
      this.recorder.reset();
      this.announce("Motor zurückgesetzt.");
    };
    this.recorder.onMeasured(() => {
      const r = this.recorder.latestRun;
      if (r) this.announce(`Volllastkurve gemessen: ${fmt(r.peakTorque.torqueNm)} Newtonmeter bei ${fmt(r.peakTorque.rpm)}, ${fmt(r.peakPower.powerKw)} Kilowatt bei ${fmt(r.peakPower.rpm)} Umdrehungen pro Minute.`);
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (this.console.handleKey(e, true)) e.preventDefault();
      },
      { signal },
    );
    document.addEventListener(
      "keyup",
      (e) => {
        if (this.console.handleKey(e, false)) e.preventDefault();
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
        });
      },
      { signal },
    );
    // fonts arrive late; redraw canvases so numerals use Barlow
    void document.fonts?.ready.then(() => {
      if (this.disposed) return;
      this.gauges.redraw();
      this.recorder.redraw(this.sim.state.t);
    });
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
    const frame = (now: number) => {
      if (this.disposed) return;
      const dt = this.last ? Math.min(MAX_DT, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
      this.last = now;
      if (this.pendingCfg && !App.turning(this.sim.state)) {
        const cfg = this.pendingCfg;
        this.pendingCfg = null;
        this.applyConfig(cfg);
      }
      let s: EngineState;
      try {
        s = this.sim.step(dt, this.inputs);
      } catch (e) {
        console.warn("Simulator-Schritt fehlgeschlagen", e);
        s = this.sim.state;
      }
      this.bench.setLocked(App.turning(s));
      this.gauges.update(s, dt);
      this.schematic.update(s, dt);
      this.recorder.update(s, dt);
      this.console.update(s);
      if (this.soundStarted) this.sound.update(s, this.inputs.pedal);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /** Stops the loop, removes all global listeners and silences the sound (tests, hot reload). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
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
  // Small hook for the e2e tests and for debugging in the console.
  (window as unknown as { __pruefzelle?: App }).__pruefzelle = app;
  return app;
}
