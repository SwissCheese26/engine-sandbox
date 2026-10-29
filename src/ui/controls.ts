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
  private gasHeld = false;
  private starterKey = false;
  private starterPointer = false;
  private lastMsgKey = "";
  private lastStatus = "";

  muted = true;
  volumeLevel = 0.6;
  onIgnition: (on: boolean) => void = () => {};
  onSound: (muted: boolean, volume: number) => void = () => {};
  onReset: () => void = () => {};

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
        <button type="button" class="starter" data-control="starter" aria-keyshortcuts="S">
          <span class="starter__cap" aria-hidden="true"></span>
          <span class="starter__text">Starter <kbd>S</kbd><span class="kbd-hint"> halten</span></span>
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
      this.syncTarget();
    });
    this.target.addEventListener("input", () => {
      const v = Number(this.target.value);
      if (this.inputs.dynoMode === "torque") this.inputs.dynoBrakeTorqueNm = v;
      else this.inputs.dynoTargetRpm = v;
      this.syncTarget();
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
    const activatable = tag === "BUTTON" || (tag === "INPUT" && ["checkbox", "radio"].includes((t as HTMLInputElement).type));
    if (key === "i") {
      if (down && !e.repeat) {
        this.setIgnition(!this.ignition.checked);
      }
      return true;
    }
    if (key === "s") {
      if (e.repeat) return true;
      this.starterKey = down;
      this.updateStarter();
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

  /** Releases held keys when the window loses focus, so the throttle never sticks open. */
  releaseAll() {
    this.gasHeld = false;
    this.starterKey = false;
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

  private renderPedal() {
    const p = this.gasHeld ? 1 : this.lever;
    this.inputs.pedal = p;
    this.pedalEl.style.setProperty("--p", String(p));
    this.pedalFill.style.transform = `scaleY(${p})`;
    const pct = Math.round(p * 100);
    this.pedalOut.textContent = `${pct} %`;
    const track = this.pedalEl.querySelector(".pedal__track")!;
    track.setAttribute("aria-valuenow", String(pct));
    track.setAttribute("aria-valuetext", `${pct} Prozent${this.gasHeld ? ", Vollgas gehalten" : ""}`);
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
    this.targetRow.hidden = mode === "free";
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
    else if (s.running) status = this.inputs.dynoMode === "free" ? "Motor läuft. Gib Gas mit der Leertaste." : "Motor läuft unter Last.";
    else if (this.inputs.starter) status = "Starter dreht …";
    else status = "Zündung ein. Halte S, um zu starten.";
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
