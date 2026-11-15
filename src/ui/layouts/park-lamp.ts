// Parking-brake lamp (issue #91) for the views without a lamp strip (Renn-Dash, Kompakt): the red "(P)" in the corner of
// the speed tile (Renn-Dash) or the gear tile (Kompakt). The space is always reserved (dark when released), so the display does not move when it lights.
import { BASE_ICON } from "./icons.ts";
import { parkLampLabel } from "../environment-panel.ts";

/** Markup of the lamp; `prefix` is the view's data attribute ("rd" → data-rd="park"). */
export function parkLampHtml(prefix: "rd" | "kp"): string {
  return `<span class="park-lamp" data-${prefix}="park" data-state="off" role="img" aria-label="${parkLampLabel(false, true)}">${BASE_ICON.park}</span>`;
}

/** Sets the lamp state; the DOM is touched only on a change. */
export function updateParkLamp(el: HTMLElement, held: boolean, autoHold: boolean, moving = false) {
  const st = held ? "on" : "off";
  const label = parkLampLabel(held, autoHold, moving);
  if (el.dataset.state === st && el.getAttribute("aria-label") === label) return;
  el.dataset.state = st;
  el.setAttribute("aria-label", label);
}
