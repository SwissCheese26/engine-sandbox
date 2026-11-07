// Bedienpult: ignition toggle, starter push button, dyno mode, pedal lever, sound, reset and the
// message strip for warnings and damage. Keyboard: I ignition, S starter (hold), Space/W gas (hold),
// arrow keys move the pedal lever in 5 % steps.
import type { EngineState, SimInputs } from "../core/index.ts";
import { clamp, fmt } from "./format.ts";

const PEDAL_STEP = 0.05;

export class ControlPanel {
  readonly el: HTMLElement;
  readonly pedalEl: HTMLElement;
  private ignition: HTMLInputElement;
  private starter: HTMLButtonElement;
  private mode: HTMLSelectElement;
  private target: HTMLInputElement;
  private targetOut: HTMLOutputElement;
  private targetRow: HTMLElement;
  private muteBtn: HTMLButtonElement;
  private volume: HTMLInputElement;
  private messages: HTMLElement;
  private status: HTMLElement;
  private pedalFill: HTMLElement;
  private pedalOut: HTMLElement;

  /** Lever position set by mouse/touch/arrow keys. */
  private lever = 0;
  /** Gas key response: 0 = instant full throttle, otherwise seconds from 0 to 100 % (setting). */
  private gasRampS = 0;
  /** Current key-driven pedal 0 … 1 (ramps towards gasHeld). */
  private gasLevel = 0;
  private gasHeld = false;
  private starterKey = false;
  /** S held (keyboard) or the brake pedal pressed (touch/mouse): brake on the chassis dyno. */
  private brakeKey = false;
  /** Fingers/pointers on the brake pedal, and Enter/Space while it has focus. */
  private brakePointers = new Set<number>();
  private brakeBtnKey = false;
  get brakeHeld(): boolean {
    return this.brakeKey || this.brakeBtnKey || this.brakePointers.size > 0;
  }
  /** Brake pedal next to the gas lever, shown on touch screens (phones have no S key). */
  readonly brakeEl: HTMLButtonElement;
  /** Gas lever and brake pedal side by side, as placed in the deck. */
  readonly pedalsEl: HTMLElement;
  private starterPointer = false;
  private lastMsgKey = "";
  private lastStatus = "";

  muted = true;
  volumeLevel = 0.6;
  onIgnition: (on: boolean) => void = () => {};
  onSound: (muted: boolean, volume: number) => void = () => {};
  onModeChange?: (mode: SimInputs["dynoMode"]) => void;
  onReset: () => void = () => {};
  /** Warm/cold start toggled; the app resets a standing engine so the new temperatures apply. */
  onWarmChange: (warm: boolean) => void = () => {};

  constructor(private inputs: SimInputs, soundAvailable: boolean) {
    this.el = document.createElement("section");
    this.el.className = "console";
    this.el.setAttribute("aria-label", "Bedienpult");
    this.el.innerHTML = `
      <div class="console__group console__group--main">
        <label class="toggle">
          <input type="checkbox" role="switch" class="toggle__input" data-control="ignition" aria-keyshortcuts="I" />
          <span class="toggle__lever" aria-hidden="true"></span>
          <span class="toggle__text">Zündung <kbd>I</kbd></span>
        </label>
        <button type="button" class="starter" data-control="starter" aria-keyshortcuts="A">
          <span class="starter__cap" aria-hidden="true"></span>
          <span class="starter__text">Starter <kbd>A</kbd><span class="kbd-hint"> halten</span></span>
        </button>
        <button type="button" class="btn btn--small console__more" aria-expanded="false">Prüfstand und Ton</button>
      </div>
      <div class="console__group console__group--dyno">
        <label class="console__field">
          <span>Prüfstand</span>
          <select data-control="mode">
            <option value="free">Frei hochdrehen</option>
            <option value="hold-rpm">Drehzahl halten</option>
            <option value="torque">Konstantes Bremsmoment</option>
            <option value="vehicle">Rollenprüfstand mit Getriebe</option>
          </select>
        </label>
        <label class="console__field console__target" hidden>
          <span class="console__target-label">Solldrehzahl</span>
          <input type="range" data-control="target" />
          <output class="num"></output>
        </label>
      </div>
      <div class="console__group console__group--aux">
        <button type="button" class="btn" data-control="mute" aria-pressed="false">Ton einschalten</button>
        <label class="console__field console__vol">
          <span>Lautstärke</span>
          <input type="range" min="0" max="1" step="0.05" data-control="volume" />
        </label>
        <label class="console__field console__gasramp">
          <span>Gas mit <kbd>W</kbd></span>
          <select data-control="gas-ramp">
            <option value="0">Sofort Vollgas</option>
            <option value="1">Zügig (1 s)</option>
            <option value="3">Gefühlvoll (3 s)</option>
          </select>
        </label>
        <label class="console__field console__warm"><input type="checkbox" data-control="warm" /> <span>Motor warm starten</span></label>
        <button type="button" class="btn" data-control="reset">Motor zurücksetzen</button>
      </div>
      <div class="console__foot">
        <p class="console__status" role="status" aria-live="polite"></p>
        <div class="console__messages" aria-live="polite" aria-label="Meldungen"></div>
      </div>`;
    this.ignition = this.q("ignition");
    this.starter = this.q("starter");
    this.mode = this.q("mode");
    this.target = this.q("target");
    this.targetRow = this.el.querySelector(".console__target")!;
    this.targetOut = this.targetRow.querySelector("output")!;
    this.muteBtn = this.q("mute");
    this.volume = this.q("volume");
    this.messages = this.el.querySelector(".console__messages")!;
    this.status = this.el.querySelector(".console__status")!;
    // Without Web Audio there is nothing to switch on: hide the sound controls instead of offering a dead button.
    if (!soundAvailable) {
      this.muteBtn.hidden = true;
      this.volume.closest<HTMLElement>(".console__vol")!.hidden = true;
    }
    this.volume.value = String(this.volumeLevel);

    // pedal lever lives outside the console grid so it can sit in the thumb zone on phones
    this.pedalEl = document.createElement("div");
    this.pedalEl.className = "pedal";
    this.pedalEl.innerHTML = `
      <span class="pedal__label" id="pedal-label">Gas</span>
      <div class="pedal__track" role="slider" tabindex="0" aria-labelledby="pedal-label" aria-orientation="vertical"
        aria-valuemin="0" aria-valuemax="100" aria-keyshortcuts="Space W ArrowUp ArrowDown">
        <span class="pedal__fill"></span><span class="pedal__knob"></span>
      </div>
      <output class="num pedal__value">0 %</output>
      <span class="pedal__hint">Leertaste oder <kbd>W</kbd> halten</span>`;
    this.pedalFill = this.pedalEl.querySelector(".pedal__fill")!;
    // brake pedal: held while pressed (pointer or Enter/Space), like the starter button
    this.brakeEl = document.createElement("button");
    this.brakeEl.type = "button";
    this.brakeEl.className = "brakepedal";
    this.brakeEl.setAttribute("aria-pressed", "false");
    this.brakeEl.innerHTML = `<span class="brakepedal__plate" aria-hidden="true"></span><span class="brakepedal__label">Bremse</span>`;
    this.brakeEl.addEventListener("pointerdown", (e) => {
      this.brakeEl.setPointerCapture?.(e.pointerId);
      this.brakePointers.add(e.pointerId);
      this.renderBrake();
      e.preventDefault();
    });
    // the brake is released only when the last finger leaves it
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      this.brakeEl.addEventListener(ev, (e) => {
        this.brakePointers.delete(e.pointerId);
        this.renderBrake();
      });
    }
    const brakeKey = (on: boolean) => {
      this.brakeBtnKey = on;
      this.renderBrake();
    };
    this.brakeEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (!e.repeat) brakeKey(true);
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.brakeEl.addEventListener("keyup", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        brakeKey(false);
        e.stopPropagation();
      }
    });
    // focus moving away (e.g. a finger on the gas lever) ends only the keyboard brake, not a finger on the pedal
    this.brakeEl.addEventListener("blur", () => this.brakeBtnKey && brakeKey(false));
    this.brakeEl.addEventListener("contextmenu", (e) => e.preventDefault());
    this.pedalsEl = document.createElement("div");
    this.pedalsEl.className = "pedals";
    this.pedalsEl.append(this.brakeEl, this.pedalEl);
    this.pedalOut = this.pedalEl.querySelector(".pedal__value")!;

    this.wire();
    this.syncTarget();
    this.renderPedal();
  }

  private q<T extends HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-control="${name}"]`)!;
  }

  private wire() {
    this.ignition.addEventListener("change", () => this.setIgnition(this.ignition.checked));
    const press = (e: Event) => {
      e.preventDefault();
      this.starterPointer = true;
      this.updateStarter();
    };
    const release = () => {
      this.starterPointer = false;
      this.updateStarter();
    };
    this.starter.addEventListener("pointerdown", (e) => {
      this.starter.setPointerCapture?.(e.pointerId);
      press(e);
    });
    this.starter.addEventListener("pointerup", release);
    this.starter.addEventListener("pointercancel", release);
    this.starter.addEventListener("lostpointercapture", release);
    this.starter.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !e.repeat) press(e);
      if (e.key === " " || e.key === "Enter") e.stopPropagation();
    });
    this.starter.addEventListener("keyup", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.stopPropagation();
        release();
      }
    });
    this.starter.addEventListener("blur", release);
    this.starter.addEventListener("contextmenu", (e) => e.preventDefault());

    this.mode.addEventListener("change", () => {
      this.inputs.dynoMode = this.mode.value as SimInputs["dynoMode"];
      // a hand-throttle setting from the engine dyno must not drive the car away
      if (this.inputs.dynoMode === "vehicle" && this.lever > 0) {
        this.lever = 0;
        this.renderPedal();
      }
      this.syncTarget();
      this.onModeChange?.(this.inputs.dynoMode);
    });
    this.target.addEventListener("input", () => {
      const v = Number(this.target.value);
      if (this.inputs.dynoMode === "torque") this.inputs.dynoBrakeTorqueNm = v;
      else this.inputs.dynoTargetRpm = v;
      this.syncTarget();
    });
    const warm = this.el.querySelector<HTMLInputElement>('[data-control="warm"]')!;
    try {
      warm.checked = localStorage.getItem("pruefzelle.startWarm") === "1";
    } catch {
      /* default: cold start */
    }
    this.inputs.startWarm = warm.checked;
    warm.addEventListener("change", () => {
      this.inputs.startWarm = warm.checked;
      try {
        localStorage.setItem("pruefzelle.startWarm", warm.checked ? "1" : "0");
      } catch {
        /* per visit only */
      }
      this.onWarmChange(warm.checked);
    });
    const ramp = this.el.querySelector<HTMLSelectElement>('[data-control="gas-ramp"]')!;
    try {
      const saved = localStorage.getItem("pruefzelle.gasRamp");
      if (saved && [...ramp.options].some((o) => o.value === saved)) ramp.value = saved;
    } catch {
      /* default: instant */
    }
    this.gasRampS = Number(ramp.value);
    ramp.addEventListener("change", () => {
      this.gasRampS = Number(ramp.value);
      try {
        localStorage.setItem("pruefzelle.gasRamp", ramp.value);
      } catch {
        /* per visit only */
      }
    });
    this.muteBtn.addEventListener("click", () => {
      this.muted = !this.muted;
      this.muteBtn.setAttribute("aria-pressed", String(!this.muted));
      this.muteBtn.textContent = this.muted ? "Ton einschalten" : "Ton ausschalten";
      this.onSound(this.muted, this.volumeLevel);
    });
    this.volume.addEventListener("input", () => {
      this.volumeLevel = Number(this.volume.value);
      this.onSound(this.muted, this.volumeLevel);
    });
    const more = this.el.querySelector<HTMLButtonElement>(".console__more")!;
    more.addEventListener("click", () => {
      const deck = this.el.closest(".deck");
      const open = !deck?.classList.contains("show-more");
      deck?.classList.toggle("show-more", open);
      more.setAttribute("aria-expanded", String(open));
    });
    this.el.querySelector('[data-control="reset"]')!.addEventListener("click", () => this.onReset());

    // pedal lever: pointer drag + keyboard
    const track = this.pedalEl.querySelector<HTMLElement>(".pedal__track")!;
    const fromPointer = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      this.lever = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      this.lever = Math.round(this.lever / 0.01) * 0.01;
      this.renderPedal();
    };
    track.addEventListener("pointerdown", (e) => {
      track.setPointerCapture?.(e.pointerId);
      fromPointer(e);
      track.focus();
      e.preventDefault();
    });
    track.addEventListener("pointermove", (e) => {
      if (track.hasPointerCapture?.(e.pointerId)) fromPointer(e);
    });
    // on the chassis dyno the lever is the car's gas pedal: it springs back when the finger/mouse lets go.
    // On the engine dyno it stays where it was put (hand throttle for steady points).
    const springBack = () => {
      if (this.inputs.dynoMode !== "vehicle" || this.lever === 0) return;
      this.lever = 0;
      this.renderPedal();
    };
    track.addEventListener("pointerup", springBack);
    track.addEventListener("pointercancel", springBack);
    track.addEventListener("lostpointercapture", springBack);
    track.addEventListener("keydown", (e) => {
      const map: Record<string, number> = { ArrowUp: PEDAL_STEP, ArrowRight: PEDAL_STEP, ArrowDown: -PEDAL_STEP, ArrowLeft: -PEDAL_STEP, PageUp: 0.25, PageDown: -0.25 };
      if (e.key in map) {
        this.nudge(map[e.key]!);
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "Home" || e.key === "End") {
        this.lever = e.key === "End" ? 1 : 0;
        this.renderPedal();
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  /** Global keyboard handling (called by the app for keydown/keyup on the document). */
  handleKey(e: KeyboardEvent, down: boolean): boolean {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    const typing = tag === "INPUT" && !["checkbox", "radio", "range"].includes((t as HTMLInputElement).type) || tag === "SELECT" || tag === "TEXTAREA";
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return false;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const activatable = tag === "BUTTON" || t?.getAttribute("role") === "button" || (tag === "INPUT" && ["checkbox", "radio"].includes((t as HTMLInputElement).type));
    if (key === "i") {
      if (down && !e.repeat) {
        this.setIgnition(!this.ignition.checked);
      }
      return true;
    }
    if (key === "a") {
      if (e.repeat) return true;
      this.starterKey = down;
      this.updateStarter();
      return true;
    }
    if (key === "s") {
      if (!e.repeat) {
        this.brakeKey = down;
        this.renderBrake();
      }
      return true;
    }
    if (key === "w" || (key === " " && !activatable)) {
      if (e.repeat) return true;
      this.gasHeld = down;
      this.renderPedal();
      return true;
    }
    const onSlider = tag === "INPUT" && (t as HTMLInputElement).type === "range" || tag === "SELECT" || t?.getAttribute("role") === "radiogroup" || (tag === "INPUT" && (t as HTMLInputElement).type === "radio");
    if (!onSlider && down && (key === "ArrowUp" || key === "ArrowDown")) {
      this.nudge(key === "ArrowUp" ? PEDAL_STEP : -PEDAL_STEP);
      return true;
    }
    return false;
  }

  private renderBrake() {
    const on = this.brakeHeld;
    this.brakeEl.classList.toggle("is-held", on);
    this.brakeEl.setAttribute("aria-pressed", String(on));
  }

  /** Releases held keys when the window loses focus, so the throttle never sticks open. */
  releaseAll() {
    this.gasHeld = false;
    this.gasLevel = 0;
    this.starterKey = false;
    this.brakeKey = false;
    this.brakePointers.clear();
    this.brakeBtnKey = false;
    this.renderBrake();
    this.starterPointer = false;
    this.updateStarter();
    this.renderPedal();
  }

  private nudge(d: number) {
    this.lever = clamp(Math.round((this.lever + d) * 100) / 100, 0, 1);
    this.renderPedal();
  }

  private setIgnition(on: boolean) {
    this.ignition.checked = on;
    this.inputs.ignition = on;
    if (!on) {
      this.starterKey = false;
      this.starterPointer = false;
      this.updateStarter();
    }
    this.onIgnition(on);
  }

  private updateStarter() {
    const on = (this.starterKey || this.starterPointer) && this.inputs.ignition;
    this.inputs.starter = on;
    this.starter.classList.toggle("is-pressed", this.starterKey || this.starterPointer);
  }

  /**
   * Per frame: the gas key ramps the pedal up with the chosen response (instant / 1 s / 3 s); releasing
   * is 4× faster, like lifting the foot. Returns nothing; updates inputs.pedal.
   */
  tick(dt: number) {
    const target = this.gasHeld ? 1 : 0;
    if (this.gasLevel === target) return;
    if (this.gasRampS <= 0) this.gasLevel = target;
    else {
      const rate = (target > this.gasLevel ? 1 : 4) / this.gasRampS;
      const step = rate * Math.max(0, dt);
      this.gasLevel = target > this.gasLevel ? Math.min(target, this.gasLevel + step) : Math.max(target, this.gasLevel - step);
    }
    this.renderPedal();
  }

  private renderPedal() {
    const p = Math.max(this.gasRampS <= 0 && this.gasHeld ? 1 : this.gasLevel, this.lever);
    this.inputs.pedal = p;
    this.pedalEl.style.setProperty("--p", String(p));
    this.pedalFill.style.transform = `scaleY(${p})`;
    const pct = Math.round(p * 100);
    this.pedalOut.textContent = `${pct} %`;
    const track = this.pedalEl.querySelector(".pedal__track")!;
    track.setAttribute("aria-valuenow", String(pct));
    track.setAttribute("aria-valuetext", `${pct} Prozent${this.gasHeld ? (p >= 1 ? ", Vollgas gehalten" : ", Gas steigt") : ""}`);
    this.pedalEl.classList.toggle("is-held", this.gasHeld);
  }

  setTargetRange(revLimit: number, peakTorque: number) {
    if (this.inputs.dynoMode === "torque") {
      const max = Math.max(50, Math.ceil((peakTorque * 1.2) / 10) * 10);
      this.target.min = "0";
      this.target.max = String(max);
      this.target.step = "5";
      this.inputs.dynoBrakeTorqueNm = clamp(this.inputs.dynoBrakeTorqueNm, 0, max);
      this.target.value = String(this.inputs.dynoBrakeTorqueNm);
    } else {
      this.target.min = "1000";
      this.target.max = String(revLimit);
      this.target.step = "100";
      this.inputs.dynoTargetRpm = clamp(this.inputs.dynoTargetRpm, 1000, revLimit);
      this.target.value = String(this.inputs.dynoTargetRpm);
    }
    this.syncTarget();
  }

  private revLimit = 6000;
  private peakTorque = 300;
  configure(revLimit: number, peakTorque: number) {
    this.revLimit = revLimit;
    this.peakTorque = peakTorque;
    this.setTargetRange(revLimit, peakTorque);
  }

  private syncTarget() {
    const mode = this.inputs.dynoMode;
    this.targetRow.hidden = mode === "free" || mode === "vehicle";
    const lab = this.targetRow.querySelector(".console__target-label")!;
    if (mode === "torque") {
      lab.textContent = "Bremsmoment";
      if (this.target.max !== String(Math.max(50, Math.ceil((this.peakTorque * 1.2) / 10) * 10))) {
        this.setTargetRangeSilently();
      }
      this.targetOut.textContent = `${fmt(this.inputs.dynoBrakeTorqueNm)} Nm`;
    } else {
      lab.textContent = "Solldrehzahl";
      if (this.target.step !== "100") this.setTargetRangeSilently();
      this.targetOut.textContent = `${fmt(this.inputs.dynoTargetRpm)} 1/min`;
    }
    this.target.setAttribute("aria-valuetext", this.targetOut.textContent);
  }

  private setTargetRangeSilently() {
    const mode = this.inputs.dynoMode;
    if (mode === "torque") {
      const max = Math.max(50, Math.ceil((this.peakTorque * 1.2) / 10) * 10);
      this.target.min = "0";
      this.target.max = String(max);
      this.target.step = "5";
      this.target.value = String(this.inputs.dynoBrakeTorqueNm);
    } else {
      this.target.min = "1000";
      this.target.max = String(this.revLimit);
      this.target.step = "100";
      this.target.value = String(this.inputs.dynoTargetRpm);
    }
  }

  /** Per frame: status line and messages. DOM is touched only when something changes. */
  update(s: EngineState) {
    let status: string;
    if (s.destroyed) status = "Motor zerstört. Setze ihn zurück, um weiterzumachen.";
    else if (!this.inputs.ignition) status = "Zündung aus. Schalte sie mit I ein.";
    else if (s.running) status = this.inputs.dynoMode === "free" ? "Motor läuft. Gib Gas mit der Leertaste." : (this.inputs.dynoMode === "vehicle" ? "Motor läuft. W gibt Gas, S bremst, E und Q schalten." : "Motor läuft unter Last.");
    else if (this.inputs.starter) status = "Starter dreht …";
    else status = "Zündung ein. Halte A, um zu starten.";
    if (status !== this.lastStatus) {
      this.status.textContent = status;
      this.lastStatus = status;
    }
    this.el.classList.toggle("is-running", s.running);

    const msgs = [
      ...s.damage.slice(-3).map((d) => ({ sev: d.fatal ? "critical" : "warning", text: `Schaden: ${d.message}`, key: `d${d.code}${d.t.toFixed(1)}` })),
      ...s.warnings.map((w) => ({ sev: w.severity, text: w.message, key: `w${w.code}${w.severity}` })),
    ];
    const key = msgs.map((m) => m.key).join("|");
    if (key === this.lastMsgKey) return;
    this.lastMsgKey = key;
    this.messages.replaceChildren();
    for (const m of msgs) {
      const p = document.createElement("p");
      p.className = `note note--${m.sev}`;
      p.textContent = m.text;
      this.messages.append(p);
    }
    this.messages.hidden = msgs.length === 0;
  }
}
