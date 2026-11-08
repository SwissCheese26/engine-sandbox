// "Wähle eine Strecke": opens when the Sandbox door in the main menu is chosen (#48 follow-up). The pick is handed
// to the sandbox (App) as a pending route; the App applies it on mount/resume (Umwelt → Strecke, chassis dyno).
import { TERRAIN_LABELS, terrainSamples } from "../core/index.ts";
import type { Terrain } from "../core/index.ts";

/** A route, or "engine" = straight to the engine dyno (no route, no vehicle). */
export type RoutePick = Terrain | "engine";

let pending: RoutePick | null = null;

/** The route picked in the menu, once (the sandbox takes it when it is shown). */
export function takePendingRoute(): RoutePick | null {
  const t = pending;
  pending = null;
  return t;
}

const TEXT: Record<Terrain, string> = {
  static: "Ebene Fahrbahn, keine Steigung. Eine feste Steigung lässt sich unter Umwelt einstellen.",
  flat: "Leichte Wellen, kaum Steigung. Gut für Verbrauch und Vmax.",
  hills: "Lange Anstiege und Gefälle um 4–8 %.",
  alps: "Passstraße bis über 1800 m, 8–12 %. Die Luft wird dünner.",
  uphill: "Durchgehend 8 % bergauf.",
  downhill: "Durchgehend 8 % bergab. Motorbremse testen.",
};

/** Small elevation sparkline for a route card (SVG, no canvas needed). */
function spark(t: Terrain): string {
  if (t === "static") return `<svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="M2 20H98" /></svg>`;
  const { altitudeM: a } = terrainSamples(t, 50);
  const lo = Math.min(...a);
  const hi = Math.max(...a);
  const span = Math.max(t === "flat" ? 200 : 20, hi - lo); // the lowland looks flat next to the Alps
  const d = a.map((v, i) => `${i ? "L" : "M"}${(2 + (i / (a.length - 1)) * 96).toFixed(1)} ${(25 - ((v - lo) / span) * 21).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" /></svg>`;
}

export class RoutePicker {
  readonly el: HTMLDialogElement;

  constructor() {
    const d = document.createElement("dialog");
    d.className = "routepick";
    d.setAttribute("aria-labelledby", "routepick-title");
    const order: Terrain[] = ["static", "flat", "hills", "alps", "uphill", "downhill"];
    d.innerHTML = `
      <form method="dialog" class="routepick__form">
        <h2 id="routepick-title" class="routepick__title">Wähle eine Strecke</h2>
        <p class="routepick__lead">Gilt auf dem Rollenprüfstand. Später änderbar unter Umwelt &amp; Assistenten oder über die Streckenzeile im Cockpit.</p>
        <ul class="routepick__list">
          ${order.map((t) => `
            <li><button type="submit" class="routepick__card" value="${t}">
              <span class="routepick__name">${t === "static" ? "Prüfstand eben" : TERRAIN_LABELS[t]}</span>
              ${spark(t)}
              <span class="routepick__text">${TEXT[t]}</span>
            </button></li>`).join("")}
        </ul>
        <div class="routepick__foot">
          <button type="submit" class="btn btn--small" value="engine" data-pick="engine">Nur Motorprüfstand (ohne Strecke)</button>
          <button type="submit" class="btn btn--small" value="">Abbrechen</button>
        </div>
      </form>`;
    d.addEventListener("close", () => {
      const v = d.returnValue as RoutePick | "";
      d.returnValue = "";
      if (!v) return;
      pending = v;
      location.hash = "#sandbox";
    });
    // a click on the backdrop closes like Abbrechen
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close("");
    });
    this.el = d;
  }

  open() {
    if (this.el.open) return;
    if (typeof this.el.showModal === "function") this.el.showModal();
    else {
      // very old browsers without <dialog>: go straight in
      location.hash = "#sandbox";
    }
  }
}
