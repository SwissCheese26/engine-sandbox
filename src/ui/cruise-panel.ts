// Tempomat-Leiste (issue #30): cruise control and speed limiter in the Getriebe-Pult.
// Keys: C set/off, R resume, + / − (or Bild↑ / Bild↓) ±1 km/h, long press or Shift ±10 km/h, L limiter on/off.
// Speeds go through `formatSpeed`, so the global unit choice (#24, km/h ↔ mph) can plug in without touching this file.
import { CRUISE_MIN_KMH, LIMITER_OPTIONS } from "../core/index.ts";
import type { Drivetrain, CruiseState } from "../core/index.ts";

/** Long press: after this time a held ± switches to 10 km/h steps (and repeats every LONG_MS). */
const LONG_MS = 500;

// Tempomat symbol (speedometer with arrow), as in the instrument cluster; Limiter: the same dial with a bar.
const ICON_CRUISE = `<svg viewBox="0 0 30 21" aria-hidden="true"><path d="M5 17a10 10 0 1 1 20 0" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 17l5-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M24 4l4 0-2 3z" fill="currentColor"/></svg>`;
const ICON_LIMIT = `<svg viewBox="0 0 30 21" aria-hidden="true"><path d="M5 17a10 10 0 1 1 20 0" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 17l5-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M3 3h24" stroke="currentColor" stroke-width="2.2"/></svg>`;

export class CruisePanel {
  readonly el: HTMLElement;
  /** km/h → shown text incl. unit. Replaced by the unit settings (#24). */
  formatSpeed: (kmh: number) => string = (kmh) => `${Math.round(kmh).toLocaleString("de-DE")} km/h`;
  private cruiseLamp: HTMLElement;
  private limitLamp: HTMLElement;
  private setOut: HTMLElement;
  private limitSel: HTMLSelectElement;
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
    el.innerHTML = `
      <div class="cruise__row">
        <span class="lamp lamp--green cruise__lamp" data-out="cruise-lamp" title="Tempomat">${ICON_CRUISE}</span>
        <span class="cruise__set num" data-out="cruise-set" aria-live="off">–</span>
        <button type="button" class="btn btn--small" data-control="cruise-set" aria-keyshortcuts="C">Setzen <kbd>C</kbd></button>
        <button type="button" class="btn btn--small" data-control="cruise-resume" aria-keyshortcuts="R">Wieder <kbd>R</kbd></button>
        <button type="button" class="btn btn--small" data-control="cruise-minus" aria-keyshortcuts="Minus PageDown" aria-label="Soll minus">−</button>
        <button type="button" class="btn btn--small" data-control="cruise-plus" aria-keyshortcuts="Plus PageUp" aria-label="Soll plus">+</button>
      </div>
      <div class="cruise__row">
        <span class="lamp lamp--green cruise__lamp" data-out="limit-lamp" title="Limiter">${ICON_LIMIT}</span>
        <select data-control="limit-value" aria-label="Limiter-Höchstgeschwindigkeit"></select>
        <button type="button" class="btn btn--small" data-control="limit-toggle" aria-keyshortcuts="L" aria-pressed="false">Limiter <kbd>L</kbd></button>
      </div>
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
    this.cruiseLamp = q("[data-out=cruise-lamp]");
    this.limitLamp = q("[data-out=limit-lamp]");
    this.setOut = q("[data-out=cruise-set]");
    this.limitSel = q("[data-control=limit-value]");
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
          this.dt.cruise.adjust(dir, e.shiftKey);
        }
      });
    }
    this.limitSel.addEventListener("change", () => this.dt.cruise.setLimit(Number(this.limitSel.value)));
    this.limitBtn.addEventListener("click", () => this.dt.cruise.toggleLimiter());
    this.syncUnits();
  }

  /** Refreshes the limiter options in the current speed unit (call after a unit change, #24). */
  syncUnits() {
    this.limitSel.innerHTML = LIMITER_OPTIONS.map((v) => `<option value="${v}">${this.formatSpeed(v)}</option>`).join("");
    this.last = "";
  }

  private setOrOff() {
    if (!this.dt.cruise.setOrOff()) this.tooSlowT = performance.now() + 2000;
  }

  private pressStart(dir: 1 | -1, big: boolean) {
    if (big) {
      this.dt.cruise.adjust(dir, true);
      this.held = null;
      return;
    }
    this.held = { dir, t0: performance.now(), steps: 0 };
  }

  private pressEnd() {
    const h = this.held;
    this.held = null;
    if (h && h.steps === 0) this.dt.cruise.adjust(h.dir);
  }

  /** C, R, ± / Bild↑↓, L. Returns true when handled. */
  handleKey(e: KeyboardEvent, down: boolean): boolean {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === "c" || k === "r" || k === "l") {
      if (down && !e.repeat) {
        if (k === "c") this.setOrOff();
        else if (k === "r") this.dt.cruise.resume();
        else this.dt.cruise.toggleLimiter();
      }
      return true;
    }
    const dir = k === "+" || k === "PageUp" ? 1 : k === "-" || k === "PageDown" ? -1 : 0;
    if (!dir) return false;
    if (down && !e.repeat) this.pressStart(dir, e.shiftKey);
    else if (!down) this.pressEnd();
    return true;
  }

  /** Per frame. */
  update() {
    const now = performance.now();
    const h = this.held;
    // held ±: every LONG_MS one step to the next multiple of 10
    if (h && now - h.t0 >= LONG_MS * (h.steps + 1)) {
      h.steps++;
      this.dt.cruise.adjust(h.dir, true);
    }
    const c: Readonly<CruiseState> = this.dt.cruise.state;
    const tooSlow = now < this.tooSlowT;
    const key = [c.mode, c.setKmh, c.limiterOn, c.limitKmh, c.notHoldable, c.downshift, c.overspeed, c.limiting, c.kickdown, tooSlow].join("|");
    if (key === this.last) return;
    this.last = key;
    const on = c.mode !== "off";
    // green = active (holds / limits), grey = ready (dark lamp)
    this.cruiseLamp.dataset.state = on ? "on" : "off";
    this.cruiseLamp.title = on ? (c.mode === "override" ? "Tempomat aktiv, Fahrer übersteuert" : "Tempomat aktiv") : "Tempomat bereit";
    this.limitLamp.dataset.state = c.limiterOn ? "on" : "off";
    this.limitLamp.title = c.limiterOn ? "Limiter aktiv" : "Limiter bereit";
    this.setOut.textContent = c.setKmh === null ? "–" : this.formatSpeed(c.setKmh);
    this.setOut.classList.toggle("is-off", !on);
    this.el.classList.toggle("is-override", c.mode === "override");
    if (![...this.limitSel.options].some((o) => Number(o.value) === c.limitKmh)) {
      // a free value set with ± gets its own option
      const o = document.createElement("option");
      o.value = String(c.limitKmh);
      o.textContent = this.formatSpeed(c.limitKmh);
      o.dataset.free = "1";
      this.limitSel.querySelectorAll("[data-free]").forEach((x) => x.remove());
      this.limitSel.append(o);
    }
    this.limitSel.value = String(c.limitKmh);
    this.limitBtn.setAttribute("aria-pressed", String(c.limiterOn));
    this.notes.notHoldable.hidden = !c.notHoldable;
    this.notes.downshift.hidden = !c.downshift;
    this.notes.overspeed.hidden = !c.overspeed;
    this.notes.limiting.hidden = !c.limiting;
    this.notes.kickdown.hidden = !c.kickdown;
    this.notes.tooSlow.hidden = !tooSlow;
    this.notes.tooSlow.textContent = `Tempomat ab ${this.formatSpeed(CRUISE_MIN_KMH)}`;
  }
}
