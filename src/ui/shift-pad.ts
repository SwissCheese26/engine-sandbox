// Schaltknöpfe in der Bedienleiste: ▲ up, the gear, ▼ down, next to brake and gas – so on a phone one can shift
// without scrolling to the Getriebe-Pult. Shown by the setting "Schaltknöpfe in der Bedienleiste" (settings.ts):
// auto = touch screens only (CSS media query), on = always, off = never; only on the chassis dyno, not with a CVT.
import type { Drivetrain } from "../core/index.ts";
import { getSettings } from "./settings.ts";

/** Drive selector of an electric car (#108): P = parking brake, N = no drive torque, D = drive. R: no reverse on the dyno. */
export type EvSelector = "P" | "R" | "N" | "D";

export class ShiftPad {
  readonly el: HTMLElement;
  private gearOut: HTMLElement;
  private last = "";
  private evEl: HTMLElement;
  private electric = false;
  /** Drive selector position of an electric car; the app passes no pedal outside D. */
  selector: EvSelector = "D";

  constructor(private dt: () => Drivetrain) {
    const el = document.createElement("div");
    el.className = "shiftpad";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Schalten");
    el.innerHTML = `
      <button type="button" class="shiftpad__btn" data-shift="1" aria-label="Hochschalten" title="Hochschalten (E)">▲</button>
      <output class="shiftpad__gear num" aria-live="off">N</output>
      <button type="button" class="shiftpad__btn" data-shift="-1" aria-label="Runterschalten" title="Runterschalten (Q)">▼</button>
      <div class="shiftpad__ev" role="radiogroup" aria-label="Fahrstufe" hidden>${(["P", "R", "N", "D"] as const)
        .map((p) => `<button type="button" class="shiftpad__sel num" role="radio" aria-checked="${p === "D"}" data-sel="${p}"${p === "R" ? ' disabled title="Rückwärts gibt es auf dem Rollenprüfstand nicht"' : ""}>${p}</button>`)
        .join("")}</div>`;
    this.el = el;
    this.gearOut = el.querySelector("output")!;
    this.evEl = el.querySelector(".shiftpad__ev")!;
    this.evEl.querySelectorAll<HTMLButtonElement>("[data-sel]").forEach((b) => {
      b.addEventListener("click", () => this.select(b.dataset.sel as EvSelector));
      b.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      });
    });
    el.querySelectorAll<HTMLButtonElement>("[data-shift]").forEach((b) => {
      const dir = Number(b.dataset.shift) as 1 | -1;
      // pointerdown: the shift happens with the finger, not after it lifts (like a paddle)
      b.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.dt().shift(dir);
      });
      // keyboard (Enter/Space) and assistive tech (VoiceOver, TalkBack, Voice Control) fire a click without a
      // pointer press (detail 0); a real tap already shifted on pointerdown
      b.addEventListener("click", (e) => {
        if (e.detail === 0) this.dt().shift(dir);
      });
      b.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation(); // not the gas key
      });
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }

  /** Electric car loaded: P/R/N/D instead of ▲ gear ▼, back to D. */
  setElectric(on: boolean) {
    this.electric = on;
    this.el.classList.toggle("is-ev", on);
    this.el.setAttribute("aria-label", on ? "Fahrstufe" : "Schalten");
    this.evEl.hidden = !on;
    for (const b of this.el.querySelectorAll<HTMLElement>(".shiftpad__btn, .shiftpad__gear")) b.hidden = on;
    this.selector = "D";
    this.syncSel();
    this.last = "";
  }

  /** P applies the parking brake; leaving P releases it. */
  select(p: EvSelector) {
    if (!this.electric || p === "R") return;
    const d = this.dt();
    if (p === "P") d.setParkingBrake(true);
    else if (this.selector === "P") d.setParkingBrake(false);
    this.selector = p;
    this.syncSel();
  }

  /** Pedal factor of the drive selector: 1 in D (and for combustion cars), else 0. */
  get pedalGate(): number {
    return !this.electric || this.selector === "D" ? 1 : 0;
  }

  private syncSel() {
    this.evEl.querySelectorAll<HTMLButtonElement>("[data-sel]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.sel === this.selector)));
  }

  /** Per frame: visibility (setting, chassis dyno, no CVT) and the gear label. */
  update(onVehicle: boolean) {
    const d = this.dt();
    const s = d.state;
    const mode = getSettings().shiftPad;
    // an electric car has no other drive selector: shown on every device unless switched off
    const show = onVehicle && mode !== "off" && (this.electric || s.type !== "cvt");
    const gear = s.shifting && s.type === "manual" ? "–" : d.gearLabel();
    const key = `${show}|${mode}|${gear}`;
    if (key === this.last) return;
    this.last = key;
    this.el.hidden = !show;
    this.el.classList.toggle("is-auto", mode === "auto" && !this.electric);
    this.gearOut.textContent = gear;
  }
}
