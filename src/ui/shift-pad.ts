// Schaltknöpfe in der Bedienleiste: ▲ up, the gear, ▼ down, next to brake and gas – so on a phone one can shift
// without scrolling to the Getriebe-Pult. Shown by the setting "Schaltknöpfe in der Bedienleiste" (settings.ts):
// auto = touch screens only (CSS media query), on = always, off = never; only on the chassis dyno, not with a CVT.
import type { Drivetrain } from "../core/index.ts";
import { getSettings } from "./settings.ts";

export class ShiftPad {
  readonly el: HTMLElement;
  private gearOut: HTMLElement;
  private last = "";

  constructor(private dt: () => Drivetrain) {
    const el = document.createElement("div");
    el.className = "shiftpad";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Schalten");
    el.innerHTML = `
      <button type="button" class="shiftpad__btn" data-shift="1" aria-label="Hochschalten" title="Hochschalten (E)">▲</button>
      <output class="shiftpad__gear num" aria-live="off">N</output>
      <button type="button" class="shiftpad__btn" data-shift="-1" aria-label="Runterschalten" title="Runterschalten (Q)">▼</button>`;
    this.el = el;
    this.gearOut = el.querySelector("output")!;
    el.querySelectorAll<HTMLButtonElement>("[data-shift]").forEach((b) => {
      const dir = Number(b.dataset.shift) as 1 | -1;
      // pointerdown: the shift happens with the finger, not after it lifts (like a paddle)
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.dt().shift(dir);
      });
      b.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          this.dt().shift(dir);
        }
      });
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }

  /** Per frame: visibility (setting, chassis dyno, no CVT) and the gear label. */
  update(onVehicle: boolean) {
    const d = this.dt();
    const s = d.state;
    const mode = getSettings().shiftPad;
    const show = onVehicle && mode !== "off" && s.type !== "cvt";
    const gear = s.shifting && s.type === "manual" ? "–" : d.gearLabel();
    const key = `${show}|${mode}|${gear}`;
    if (key === this.last) return;
    this.last = key;
    this.el.hidden = !show;
    this.el.classList.toggle("is-auto", mode === "auto");
    this.gearOut.textContent = gear;
  }
}
