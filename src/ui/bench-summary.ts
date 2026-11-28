// Zusammenfassung of the Werkbank (#154, Task B): one row list for combustion and electric drives, so both benches end
// with the same plate (same fields in the same order, the same buttons). The E-Tuner fills it from its estimate
// (ev-bench.ts); for an engine the app fills it from the summary, the Getriebe-Pult and the drivetrain.

/** The shared rows: power, torque, Vmax, 0–100, range, mass, what limits. Drive-specific rows follow them. */
export const SUMMARY_ROWS: [key: string, label: string][] = [
  ["power", "Leistung"], ["torque", "Drehmoment"], ["vmax", "Vmax"], ["t100", "0–100 km/h"], ["range", "Reichweite"],
  ["mass", "Masse"], ["limit", "Begrenzt durch"],
];

const SCREWS = `<span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span><span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>`;

/** The summary plate; `id` keeps the heading ids unique, `extra` adds drive-specific rows after the shared ones. */
export function summaryPlate(id: string, extra: [string, string][] = []): { el: HTMLElement; out: Record<string, HTMLElement> } {
  const el = document.createElement("section");
  el.className = "plate evb__summary";
  el.dataset.group = `${id}-summary`;
  el.setAttribute("aria-labelledby", `plate-${id}-summary`);
  el.innerHTML = `${SCREWS}<h3 class="plate__title" id="plate-${id}-summary">Zusammenfassung</h3>
    <dl class="evb__sum num" aria-live="polite">${[...SUMMARY_ROWS, ...extra].map(([k, l]) => `<div><dt>${l}</dt><dd data-o="${k}">–</dd></div>`).join("")}</dl>
    <p class="evb__note" data-o="note" role="status"></p>
    <div class="evb__btns">
      <button type="button" class="btn btn--small" data-control="tune-max">Maximum</button>
      <button type="button" class="btn btn--small" data-control="tune-reset">Auf Werkszustand</button>
    </div>`;
  const out: Record<string, HTMLElement> = {};
  el.querySelectorAll<HTMLElement>("[data-o]").forEach((n) => (out[n.dataset.o!] = n));
  return { el, out };
}

/** Writes a value only when it changed (no layout work every frame). */
export function put(out: Record<string, HTMLElement>, k: string, v: string) {
  const n = out[k];
  if (n && n.textContent !== v) n.textContent = v;
}
