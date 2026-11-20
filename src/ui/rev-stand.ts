// "Am Stand hochdrehen" (#72): a small engine dyno inside the Engine Builder. The built engine runs freely (no
// brake, no vehicle) in its own EngineSimulator: ignition, starter, throttle (held by a lever or the full-throttle
// button), live rpm, power, torque and temperatures, and the procedural engine sound. No sandbox needed.
import { EngineSimulator, defaultInputs, summarize } from "../core/index.ts";
import type { EngineConfig, EngineState, EngineSummary } from "../core/index.ts";
import { fmt } from "./format.ts";
import { isTypingTarget } from "./router.ts";
import { getSettings } from "./settings.ts";
import { SOUND_AVAILABLE, createSound, type SoundOutput } from "./sound-bridge.ts";
import { fmtQ } from "./units.ts";

const MAX_DT = 1 / 30;

export class RevStand {
  readonly el: HTMLElement;
  readonly heading: HTMLElement;
  /** "Zurück": the builder shows what was there before. */
  onClose: () => void = () => {};
  private sim: EngineSimulator | null = null;
  private cfg: EngineConfig | null = null;
  private summary: EngineSummary | null = null;
  private inputs = defaultInputs();
  private lever = 0;
  private fullHeld = false;
  private keyGas = false;
  private sound: SoundOutput | null = null;
  private soundOn = SOUND_AVAILABLE;
  private soundStarted = false;
  private raf = 0;
  private last = 0;
  private active = false;
  private abort: AbortController | null = null;
  private lastStatus = "";
  private q = <T extends Element>(s: string) => this.el.querySelector<T>(s)!;

  constructor() {
    const el = document.createElement("section");
    el.className = "revstand plate";
    el.setAttribute("aria-labelledby", "rev-h");
    el.innerHTML = `
      <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
      <span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>
      <h2 class="plate__title revstand__title" id="rev-h" tabindex="-1">Im Stand hochdrehen</h2>
      <p class="plate__effect" data-out="name"></p>
      <div class="revstand__tacho">
        <p class="revstand__rpm"><span class="num" data-out="rpm">0</span> <span class="revstand__unit">1/min</span></p>
        <div class="revstand__bar" role="meter" aria-label="Drehzahl" aria-valuemin="0" data-out="meter">
          <span class="revstand__fill" data-out="fill"></span><span class="revstand__red" data-out="red"></span>
        </div>
      </div>
      <dl class="revstand__values">
        <div><dt>Leistung</dt><dd class="num" data-out="kw">–</dd></div>
        <div><dt>Drehmoment</dt><dd class="num" data-out="nm">–</dd></div>
        <div data-row="boost"><dt>Ladedruck</dt><dd class="num" data-out="boost">–</dd></div>
        <div><dt data-out="cool-label">Kühlmittel</dt><dd class="num" data-out="cool">–</dd></div>
        <div><dt>Öl</dt><dd class="num" data-out="oil">–</dd></div>
        <div><dt>Abgas</dt><dd class="num" data-out="egt">–</dd></div>
      </dl>
      <p class="revstand__status" role="status" aria-live="polite" data-out="status">Zündung aus.</p>
      <div class="revstand__controls">
        <button type="button" class="btn revstand__btn" data-control="ign" aria-pressed="false">Zündung<span class="kbd-only"> <kbd>I</kbd></span></button>
        <button type="button" class="btn revstand__btn" data-control="starter">Starter halten<span class="kbd-only"> <kbd>A</kbd></span></button>
        <button type="button" class="btn revstand__btn" data-control="full">Vollgas halten<span class="kbd-only"> <kbd>W</kbd></span></button>
        <label class="revstand__lever"><span>Handgas <span class="num" data-out="lever">0 %</span></span>
          <input type="range" min="0" max="100" step="1" value="0" data-control="lever" aria-describedby="rev-lever-hint" />
        </label>
        <p class="revstand__hint" id="rev-lever-hint">Der Hebel bleibt stehen, wo du ihn loslässt.</p>
        <button type="button" class="btn revstand__btn" data-control="sound" aria-pressed="${SOUND_AVAILABLE}" ${SOUND_AVAILABLE ? "" : "disabled"}>Ton</button>
        <button type="button" class="btn revstand__btn" data-control="reset">Neu starten</button>
        <button type="button" class="btn btn--primary revstand__btn" data-control="close">Zurück</button>
      </div>`;
    this.el = el;
    this.heading = this.q("#rev-h");
    this.q("[data-control=ign]").addEventListener("click", () => this.setIgnition(!this.inputs.ignition));
    this.hold(this.q("[data-control=starter]"), (on) => {
      if (on && !this.inputs.ignition) this.setIgnition(true);
      this.inputs.starter = on;
    });
    this.hold(this.q("[data-control=full]"), (on) => (this.fullHeld = on));
    const lever = this.q<HTMLInputElement>("[data-control=lever]");
    lever.addEventListener("input", () => {
      this.lever = Number(lever.value) / 100;
      this.q("[data-out=lever]").textContent = `${lever.value} %`;
      lever.setAttribute("aria-valuetext", `${lever.value} Prozent`);
    });
    this.q("[data-control=sound]").addEventListener("click", (e) => {
      this.soundOn = !this.soundOn;
      (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(this.soundOn));
      if (this.soundOn) void this.ensureSound();
      this.sound?.setVolume(this.soundOn ? 0.8 : 0);
    });
    this.q("[data-control=reset]").addEventListener("click", () => this.reset());
    this.q("[data-control=close]").addEventListener("click", () => this.onClose());
  }

  /** A button that acts while it is held: pointer (with capture) and Space / Enter. */
  private hold(btn: HTMLElement, set: (on: boolean) => void) {
    const on = () => {
      btn.classList.add("is-held");
      set(true);
      if (this.soundOn) void this.ensureSound();
    };
    const off = () => {
      btn.classList.remove("is-held");
      set(false);
    };
    btn.addEventListener("pointerdown", (e) => {
      btn.setPointerCapture?.(e.pointerId);
      on();
    });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"] as const) btn.addEventListener(ev, off);
    btn.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        on();
      }
    });
    btn.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") off();
    });
    btn.addEventListener("blur", off);
    // touch: no context menu or text selection while holding
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Puts the engine on the stand (cold, standing) and starts the loop. */
  open(cfg: EngineConfig) {
    this.close();
    this.cfg = structuredClone(cfg);
    try {
      this.summary = summarize(this.cfg);
    } catch {
      this.summary = null;
    }
    this.sim = new EngineSimulator(this.cfg);
    this.inputs = { ...defaultInputs(), damage: getSettings().realism };
    this.lever = 0;
    this.fullHeld = false;
    this.keyGas = false;
    const lever = this.q<HTMLInputElement>("[data-control=lever]");
    lever.value = "0";
    this.q("[data-out=lever]").textContent = "0 %";
    this.q("[data-out=name]").textContent = `${this.cfg.name}: frei drehend auf dem Motorprüfstand, ohne Last.`;
    const max = Math.ceil((this.cfg.revLimitRpm * 1.1) / 500) * 500;
    const meter = this.q<HTMLElement>("[data-out=meter]");
    meter.setAttribute("aria-valuemax", String(max));
    meter.dataset.max = String(max);
    this.q<HTMLElement>("[data-out=red]").style.left = `${(this.cfg.revLimitRpm / max) * 100}%`;
    this.q<HTMLElement>("[data-row=boost]").hidden = this.cfg.induction.aspiration === "naturally-aspirated";
    this.q("[data-out=cool-label]").textContent = (this.cfg.cooling.type ?? "liquid") === "liquid" ? "Kühlmittel" : "Zylinderkopf";
    if (this.soundStarted && this.summary) this.sound?.setConfig(this.cfg, this.summary);
    this.setIgnition(false);
    this.active = true;
    this.listen();
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Stops the loop and silences the sound (leaving the stand or the builder). */
  close() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.abort?.abort();
    this.abort = null;
    this.inputs.ignition = false;
    this.inputs.starter = false;
    this.fullHeld = false;
    this.keyGas = false;
    if (this.sound) {
      this.sound.setVolume(0);
      const s = this.sound;
      setTimeout(() => {
        if (!this.active) void s.suspend();
      }, 80);
    }
  }

  get isOpen(): boolean {
    return this.active;
  }

  private reset() {
    if (!this.cfg) return;
    this.sim = new EngineSimulator(this.cfg);
    this.setIgnition(false);
    this.status("Motor neu aufgebaut, kalt und bereit.");
  }

  private setIgnition(on: boolean) {
    this.inputs.ignition = on;
    if (!on) this.inputs.starter = false;
    this.q("[data-control=ign]").setAttribute("aria-pressed", String(on));
    if (on && this.soundOn) void this.ensureSound();
  }

  /** Keyboard like in the sandbox: I ignition, A starter (hold), W or ↑ throttle (hold). Not while typing. */
  private listen() {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target as HTMLElement | null)) return;
        const k = e.key.toLowerCase();
        if (k === "i" && !e.repeat) this.setIgnition(!this.inputs.ignition);
        else if (k === "a") {
          if (!this.inputs.ignition) this.setIgnition(true);
          this.inputs.starter = true;
        } else if (k === "w" || k === "arrowup") {
          // the lever has focus: arrows move the lever instead
          if (k === "arrowup" && (e.target as HTMLElement | null)?.dataset?.control === "lever") return;
          this.keyGas = true;
          if (this.soundOn) void this.ensureSound();
        } else return;
        e.preventDefault();
      },
      { signal },
    );
    document.addEventListener(
      "keyup",
      (e) => {
        const k = e.key.toLowerCase();
        if (k === "a") this.inputs.starter = false;
        else if (k === "w" || k === "arrowup") this.keyGas = false;
      },
      { signal },
    );
    window.addEventListener(
      "blur",
      () => {
        this.inputs.starter = false;
        this.fullHeld = false;
        this.keyGas = false;
      },
      { signal },
    );
  }

  private async ensureSound() {
    if (!SOUND_AVAILABLE || !this.cfg || !this.summary) return;
    if (!this.sound) this.sound = createSound();
    if (this.soundStarted) {
      void this.sound.resume();
      this.sound.setVolume(this.soundOn ? 0.8 : 0);
      return;
    }
    this.soundStarted = true;
    try {
      this.sound.setConfig(this.cfg, this.summary);
      this.sound.setVolume(this.soundOn ? 0.8 : 0);
      await this.sound.start();
      if (!this.active) this.sound.setVolume(0);
    } catch (e) {
      this.soundStarted = false;
      console.warn("Ton konnte nicht starten", e);
    }
  }

  private frame = (now: number) => {
    if (!this.active || !this.sim) return;
    const dt = this.last ? Math.min(MAX_DT, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    this.inputs.pedal = this.fullHeld || this.keyGas ? 1 : this.lever;
    let s: EngineState;
    try {
      s = this.sim.step(dt, this.inputs);
    } catch (e) {
      console.warn("Simulator-Schritt fehlgeschlagen", e);
      s = this.sim.state;
    }
    if (this.soundStarted) this.sound?.update(s, this.inputs.pedal);
    this.render(s);
    this.raf = requestAnimationFrame(this.frame);
  };

  private render(s: EngineState) {
    const set = (k: string, v: string) => {
      const el = this.q(`[data-out=${k}]`);
      if (el.textContent !== v) el.textContent = v;
    };
    set("rpm", fmt(s.rpm));
    const meter = this.q<HTMLElement>("[data-out=meter]");
    const max = Number(meter.dataset.max) || 8000;
    meter.setAttribute("aria-valuenow", String(Math.round(s.rpm)));
    meter.setAttribute("aria-valuetext", `${fmt(s.rpm)} Umdrehungen pro Minute`);
    this.q<HTMLElement>("[data-out=fill]").style.width = `${Math.min(100, (s.rpm / max) * 100)}%`;
    meter.classList.toggle("is-limit", !!this.cfg && s.rpm > this.cfg.revLimitRpm * 0.97);
    set("kw", fmtQ("power", Math.max(0, s.powerKw)));
    set("nm", fmtQ("torque", Math.max(0, s.torqueNm)));
    set("boost", fmtQ("pressure", Math.max(0, s.boostBar), 2));
    set("cool", fmtQ("temp", s.coolantC));
    set("oil", fmtQ("temp", s.oilC));
    set("egt", fmtQ("temp", s.egtC));
    const top = [...s.warnings].sort((a, b) => sev(b.severity) - sev(a.severity))[0];
    const text = s.destroyed
      ? `Motorschaden: ${s.damage.find((d) => d.fatal)?.message ?? "Der Motor ist zerstört."} „Neu starten“ baut ihn wieder auf.`
      : top
        ? top.message
        : s.starterEngaged && !s.running
          ? "Starter dreht …"
          : s.running
            ? "Motor läuft."
            : this.inputs.ignition
              ? "Zündung an. Starter halten, bis der Motor läuft."
              : "Zündung aus.";
    this.status(text);
  }

  /** Status line: updated only when the text changes, so the screen reader is not flooded. */
  private status(text: string) {
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this.q("[data-out=status]").textContent = text;
  }
}

const sev = (s: string) => (s === "critical" ? 2 : s === "warning" ? 1 : 0);
