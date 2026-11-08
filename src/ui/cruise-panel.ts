// Tempomat-Leiste (issue #30): cruise control and speed limiter in the Getriebe-Pult.
// Keys: C set/off, R resume, + / − ±1 km/h (long press or Shift ±10), L limiter on/off. ± are read from e.code, so
// they work on US and German layouts alike (review PR #46); Bild↑/↓ are left to the page (scrolling).
// Speeds follow the global unit choice (#24, km/h ↔ mph): display, ±1/±10 steps, rounding and limiter presets are in
// the chosen unit; the core keeps km/h. GearboxPanel.syncUnits() calls syncUnits() on every change.
import { CruiseControl, LIMITER_OPTIONS, LIMITER_OPTIONS_MPH, MPH_KMH } from "../core/index.ts";
import { prefs } from "./settings.ts";
import { fmtQ } from "./units.ts";
import type { Drivetrain, CruiseState } from "../core/index.ts";

export type CruiseKeyAction = "set" | "resume" | "limiter" | "plus" | "minus";

/** Physical keys for ± (e.code): US "=" / "-", German "+" (BracketRight) / "-" (Slash), numpad. */
const PLUS_CODES = new Set(["Equal", "BracketRight", "NumpadAdd"]);
const MINUS_CODES = new Set(["Minus", "Slash", "NumpadSubtract"]);

/** True while the focus is in a field that takes typing (same guard as controls.ts): number/text inputs, selects. */
export function isTypingTarget(t: { tagName?: string; type?: string } | null | undefined): boolean {
  const tag = t?.tagName;
  return (tag === "INPUT" && !["checkbox", "radio", "range"].includes(t?.type ?? "")) || tag === "SELECT" || tag === "TEXTAREA";
}

/** Maps a key event to a cruise action, null = not ours. Pure, so it is unit-tested (tests/ui/cruise-keys.test.ts). */
export function cruiseKeyAction(e: { key: string; code: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown }): CruiseKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target as { tagName?: string; type?: string } | null)) return null;
  if (PLUS_CODES.has(e.code)) return "plus";
  if (MINUS_CODES.has(e.code)) return "minus";
  const k = e.key.toLowerCase();
  return k === "c" ? "set" : k === "r" ? "resume" : k === "l" ? "limiter" : null;
}

/** Long press: after this time a held ± switches to 10 km/h steps (and repeats every LONG_MS). */
const LONG_MS = 500;

// Tempomat symbol (speedometer with arrow), as in the instrument cluster; Limiter: the same dial with a bar.
const ICON_CRUISE = `<svg viewBox="0 0 30 21" aria-hidden="true"><path d="M5 17a10 10 0 1 1 20 0" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 17l5-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M24 4l4 0-2 3z" fill="currentColor"/></svg>`;
const ICON_LIMIT = `<svg viewBox="0 0 30 21" aria-hidden="true"><path d="M5 17a10 10 0 1 1 20 0" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 17l5-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M3 3h24" stroke="currentColor" stroke-width="2.2"/></svg>`;

export class CruisePanel {
  readonly el: HTMLElement;
  /** km/h → shown text incl. unit, in the globally chosen speed unit. */
  formatSpeed: (kmh: number) => string = (kmh) => fmtQ("speed", kmh, 0, this.unit);
  /** Speed unit ("km/h" | "mph") and its size in km/h. */
  private unit = "km/h";
  private unitKmh = 1;
  private cruiseBtn: HTMLButtonElement;
  private resumeBtn: HTMLButtonElement;
  private setOut: HTMLElement;
  private limitOut: HTMLElement;
  private limitBtn: HTMLButtonElement;
  private notes: Record<"notHoldable" | "downshift" | "overspeed" | "limiting" | "kickdown" | "tooSlow", HTMLElement>;
  private last = "";
  private tooSlowT = 0;
  private held: { dir: 1 | -1; t0: number; steps: number } | null = null;

  constructor(private dt: Drivetrain) {
    const el = document.createElement("div");
    el.className = "cruise";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Tempomat und Limiter");
    // one row per function: the symbol button switches it (green = active), − value + set the speed (#30, redesign)
    el.innerHTML = `
      <div class="cruise__unit" data-unit="cruise">
        <button type="button" class="cruise__sym" data-control="cruise-set" data-state="off" aria-pressed="false" aria-keyshortcuts="C"
          title="Tempomat: aktuelles Tempo halten oder ausschalten">${ICON_CRUISE}<span class="cruise__name">Tempomat</span></button>
        <button type="button" class="cruise__step" data-control="cruise-minus" aria-keyshortcuts="-" aria-label="Tempomat langsamer">−</button>
        <output class="cruise__val num" data-out="cruise-set" aria-live="off">–</output>
        <button type="button" class="cruise__step" data-control="cruise-plus" aria-keyshortcuts="+" aria-label="Tempomat schneller">+</button>
        <button type="button" class="cruise__resume" data-control="cruise-resume" aria-keyshortcuts="R" title="Letztes Tempo wieder aufnehmen"
          aria-label="Tempomat wieder aufnehmen">↺</button>
      </div>
      <div class="cruise__unit" data-unit="limit">
        <button type="button" class="cruise__sym" data-control="limit-toggle" data-state="off" aria-pressed="false" aria-keyshortcuts="L"
          title="Limiter: Höchsttempo an oder aus">${ICON_LIMIT}<span class="cruise__name">Limiter</span></button>
        <button type="button" class="cruise__step" data-control="limit-minus" aria-label="Limit niedriger">−</button>
        <output class="cruise__val num" data-out="limit-val" aria-live="off">–</output>
        <button type="button" class="cruise__step" data-control="limit-plus" aria-label="Limit höher">+</button>
      </div>
      <p class="cruise__help">Symbol antippen: an/aus. Tempomat hält das aktuelle Tempo (ab 30 km/h), <b>+</b>/<b>−</b> ändern es (gedrückt halten: in 10er-Schritten), <b>↺</b> nimmt das letzte Tempo wieder auf. Limiter: Höchsttempo mit <b>+</b>/<b>−</b> einstellen.</p>
      <p class="cruise__keys">Tasten: <kbd>C</kbd> Tempomat, <kbd>R</kbd> wieder aufnehmen, <kbd>+</kbd>/<kbd>−</kbd> ±1 (Shift ±10), <kbd>L</kbd> Limiter. Kickdown: am Limit <kbd>W</kbd> loslassen und erneut halten.</p>
      <div class="cruise__notes" aria-live="polite">
        <p class="note note--warning" data-out="cruise-not-holdable" hidden>Tempo nicht haltbar</p>
        <p class="note note--warning" data-out="cruise-downshift" hidden>Runterschalten</p>
        <p class="note note--info" data-out="cruise-overspeed" hidden>Bergab: Motorbremse reicht nicht, Soll überschritten</p>
        <p class="note note--info" data-out="cruise-limiting" hidden>Limiter nimmt das Gas zurück</p>
        <p class="note note--info" data-out="cruise-kickdown" hidden>Kickdown: Limiter übersteuert</p>
        <p class="note note--info" data-out="cruise-too-slow" hidden>Tempomat ab 30 km/h</p>
      </div>`;
    this.el = el;
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    this.cruiseBtn = q("[data-control=cruise-set]");
    this.resumeBtn = q("[data-control=cruise-resume]");
    this.setOut = q("[data-out=cruise-set]");
    this.limitOut = q("[data-out=limit-val]");
    this.limitBtn = q("[data-control=limit-toggle]");
    this.notes = {
      notHoldable: q("[data-out=cruise-not-holdable]"), downshift: q("[data-out=cruise-downshift]"),
      overspeed: q("[data-out=cruise-overspeed]"), limiting: q("[data-out=cruise-limiting]"),
      kickdown: q("[data-out=cruise-kickdown]"), tooSlow: q("[data-out=cruise-too-slow]"),
    };
    q("[data-control=cruise-set]").addEventListener("click", () => this.setOrOff());
    q("[data-control=cruise-resume]").addEventListener("click", () => this.dt.cruise.resume());
    for (const [sel, dir] of [["[data-control=cruise-minus]", -1], ["[data-control=cruise-plus]", 1]] as const) {
      const b = q<HTMLButtonElement>(sel);
      // short click ±1, Shift-click or long press ±10 (like the stalk in the car)
      b.addEventListener("pointerdown", (e) => this.pressStart(dir, e.shiftKey));
      for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => this.pressEnd());
      b.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          this.dt.cruise.adjust(dir, e.shiftKey, this.unitKmh);
        }
      });
    }
    // limit: ±10 km/h (±5 mph) per tap, within the presets' range
    for (const [sel, dir] of [["[data-control=limit-minus]", -1], ["[data-control=limit-plus]", 1]] as const) {
      q<HTMLButtonElement>(sel).addEventListener("click", () => this.stepLimit(dir));
    }
    this.limitBtn.addEventListener("click", () => this.dt.cruise.toggleLimiter());
    this.syncUnits();
  }

  /** Refreshes the limiter options in the current speed unit (call after a unit change, #24). */
  syncUnits(unit: string = prefs().speed) {
    this.unit = unit === "mph" ? "mph" : "km/h";
    this.unitKmh = this.unit === "mph" ? MPH_KMH : 1;
    const opts = this.unit === "mph" ? LIMITER_OPTIONS_MPH : LIMITER_OPTIONS;
    // the limit follows to the nearest preset of the new unit (50 km/h → 30 mph, 80 mph → 130 km/h), so a unit
    // switch never leaves an odd value like 31 mph
    const c = this.dt.cruise;
    const near = opts.reduce((a, v) => (Math.abs(v * this.unitKmh - c.state.limitKmh) < Math.abs(a * this.unitKmh - c.state.limitKmh) ? v : a));
    if (Math.abs(c.state.limitKmh / this.unitKmh - Math.round(c.state.limitKmh / this.unitKmh)) > 1e-6) c.setLimit(near * this.unitKmh, this.unitKmh);
    this.last = "";
  }

  /** Limiter value one step up/down: 10 km/h or 5 mph, between the smallest and largest preset. */
  private stepLimit(dir: 1 | -1) {
    const opts = this.unit === "mph" ? LIMITER_OPTIONS_MPH : LIMITER_OPTIONS;
    const step = this.unit === "mph" ? 5 : 10;
    const shown = Math.round(this.dt.cruise.state.limitKmh / this.unitKmh);
    const next = Math.min(opts[opts.length - 1]!, Math.max(opts[0]!, (Math.round(shown / step) + dir) * step));
    this.dt.cruise.setLimit(next * this.unitKmh, this.unitKmh);
  }

  private setOrOff() {
    if (!this.dt.cruise.setOrOff(this.unitKmh)) this.tooSlowT = performance.now() + 2000;
  }

  private pressStart(dir: 1 | -1, big: boolean) {
    if (big) {
      this.dt.cruise.adjust(dir, true, this.unitKmh);
      this.held = null;
      return;
    }
    this.held = { dir, t0: performance.now(), steps: 0 };
  }

  /** Drops a held ± (the app leaves the sandbox for the menu, the keyup never comes). */
  release() {
    this.held = null;
  }

  private pressEnd() {
    const h = this.held;
    this.held = null;
    if (h && h.steps === 0) this.dt.cruise.adjust(h.dir, false, this.unitKmh);
  }

  /** C, R, ± / Bild↑↓, L. Returns true when handled. */
  handleKey(e: KeyboardEvent, down: boolean): boolean {
    const a = cruiseKeyAction(e);
    if (a === null) return false;
    if (a === "set" || a === "resume" || a === "limiter") {
      if (down && !e.repeat) {
        if (a === "set") this.setOrOff();
        else if (a === "resume") this.dt.cruise.resume();
        else this.dt.cruise.toggleLimiter();
      }
      return true;
    }
    const dir = a === "plus" ? 1 : -1;
    // Shift = ±10 at once (layout independent: the physical key decides, e.shiftKey only the step)
    if (down && !e.repeat) this.pressStart(dir, e.shiftKey);
    else if (!down) this.pressEnd();
    return true;
  }

  /** Per frame. */
  update() {
    const now = performance.now();
    // window lost focus while ± was held: the keyup will not come
    if (this.held && !document.hasFocus()) this.held = null;
    const h = this.held;
    // held ±: every LONG_MS one step to the next multiple of 10
    if (h && now - h.t0 >= LONG_MS * (h.steps + 1)) {
      h.steps++;
      this.dt.cruise.adjust(h.dir, true, this.unitKmh);
    }
    const c: Readonly<CruiseState> = this.dt.cruise.state;
    const tooSlow = now < this.tooSlowT;
    const key = [c.mode, c.setKmh, c.limiterOn, c.limitKmh, c.notHoldable, c.downshift, c.overspeed, c.limiting, c.kickdown, tooSlow].join("|");
    if (key === this.last) return;
    this.last = key;
    const on = c.mode !== "off";
    // the symbol button is the lamp: green = active (holds / limits), dark = ready
    this.cruiseBtn.dataset.state = on ? (c.mode === "override" ? "override" : "on") : "off";
    this.cruiseBtn.setAttribute("aria-pressed", String(on));
    this.cruiseBtn.title = on ? (c.mode === "override" ? "Tempomat aktiv, Fahrer übersteuert – antippen: aus" : "Tempomat aktiv – antippen: aus") : "Tempomat: aktuelles Tempo halten";
    this.limitBtn.dataset.state = c.limiterOn ? "on" : "off";
    this.limitBtn.setAttribute("aria-pressed", String(c.limiterOn));
    this.setOut.textContent = c.setKmh === null ? "–" : this.formatSpeed(c.setKmh);
    this.setOut.classList.toggle("is-off", !on);
    this.resumeBtn.disabled = on || c.setKmh === null;
    this.limitOut.textContent = this.formatSpeed(c.limitKmh);
    this.limitOut.classList.toggle("is-off", !c.limiterOn);
    this.el.classList.toggle("is-override", c.mode === "override");
    this.notes.notHoldable.hidden = !c.notHoldable;
    this.notes.downshift.hidden = !c.downshift;
    this.notes.overspeed.hidden = !c.overspeed;
    this.notes.limiting.hidden = !c.limiting;
    this.notes.kickdown.hidden = !c.kickdown;
    this.notes.tooSlow.hidden = !tooSlow;
    this.notes.tooSlow.textContent = `Tempomat ab ${this.formatSpeed(CruiseControl.minKmh(this.unitKmh))}`;
  }
}
