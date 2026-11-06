// Einstellungen (#24): global unit preset, custom units per quantity and the reset of the per-instrument
// choices (#21). Changes apply at once (no save button) and reach the running sandbox through
// onSettingsChange().
import { PRESETS, QUANTITIES, getSettings, setSettings, unitsOf, type PresetId, type Quantity } from "./settings.ts";
import { clearUnitOverrides, fmtQ, overrideCount } from "./units.ts";

const PRESET_IDS: PresetId[] = ["metric-kw", "metric-ps", "imperial", "custom"];

/** Sample figures for the preview line: a 2,0-l turbo diesel on the road. */
const SAMPLE: [Quantity, number, string][] = [
  ["power", 110, "Leistung"],
  ["torque", 340, "Drehmoment"],
  ["pressure", 1.6, "Ladedruck"],
  ["temp", 90, "Kühlmittel"],
  ["fuel", 5.4, "Verbrauch"],
  ["speed", 210, "Vmax"],
  ["distance", 42.5, "Trip A"],
  ["volume", 1.968, "Hubraum"],
];

export class SettingsScreen {
  readonly el: HTMLElement;
  readonly heading: HTMLElement;
  private status: HTMLElement;
  private resetBtn: HTMLButtonElement;
  private overridesText: HTMLElement;
  private preview: HTMLElement;

  constructor() {
    const el = document.createElement("div");
    el.className = "office";
    el.innerHTML = `
      <header class="office__top">
        <a class="btn btn--small" href="#menu" aria-keyshortcuts="Escape">Menü</a>
        <h1 class="office__title" tabindex="-1">Einstellungen</h1>
      </header>
      <main class="office__body">
        <section class="plate office__plate" aria-labelledby="set-units">
          <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
          <span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>
          <h2 class="plate__title" id="set-units">Einheiten</h2>
          <p class="plate__effect">Gilt überall: Instrumente, Typenschild, Messbogen, Getriebe-Pult und Bordcomputer. Gerechnet wird weiter in SI, nur die Anzeige wechselt.</p>
          <div class="units-grid">
          <div class="units-grid__main">
          <fieldset class="presets">
            <legend class="office__legend">Voreinstellung</legend>
            ${PRESET_IDS.map((id) => `
            <label class="preset">
              <input type="radio" name="preset" value="${id}" />
              <span class="preset__lever" aria-hidden="true"></span>
              <span class="preset__name">${id === "custom" ? "Benutzerdefiniert" : PRESETS[id].label}</span>
              <span class="preset__hint">${id === "custom" ? "Jede Größe einzeln wählen" : PRESETS[id].hint}</span>
            </label>`).join("")}
          </fieldset>
          <div class="office__preview">
            <h3 class="office__legend">So sieht es aus</h3>
            <dl class="preview num"></dl>
          </div>
          </div>
          <fieldset class="quantities">
            <legend class="office__legend">Je Größe</legend>
            <p class="quantities__note">Eine Änderung hier schaltet auf „Benutzerdefiniert“.</p>
            ${QUANTITIES.map(({ q, label, units }) => `
            <div class="field quantity" role="radiogroup" aria-labelledby="q-${q}">
              <span class="field__label" id="q-${q}">${label}</span>
              <div class="seg">${units.map((u) => `
                <label class="seg__opt"><input type="radio" name="q-${q}" value="${u}" data-q="${q}" /><span>${u}</span></label>`).join("")}
              </div>
            </div>`).join("")}
          </fieldset>
          </div>
        </section>
        <section class="plate office__plate" aria-labelledby="set-gauges">
          <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
          <span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>
          <h2 class="plate__title" id="set-gauges">Instrumente</h2>
          <p class="plate__effect">Ein Klick auf ein Instrument in der Prüfzelle wechselt nur dessen Einheit. <span data-out="overrides"></span></p>
          <button type="button" class="btn btn--dark" data-control="reset-units">Alle Instrumente auf Voreinstellung zurücksetzen</button>
          <p class="office__status" role="status"></p>
        </section>
      </main>`;
    this.el = el;
    this.heading = el.querySelector(".office__title")!;
    this.status = el.querySelector(".office__status")!;
    this.resetBtn = el.querySelector("[data-control=reset-units]")!;
    this.overridesText = el.querySelector("[data-out=overrides]")!;
    this.preview = el.querySelector(".preview")!;

    el.querySelectorAll<HTMLInputElement>("input[name=preset]").forEach((r) =>
      r.addEventListener("change", () => {
        if (!r.checked) return;
        const s = getSettings();
        setSettings({ ...s, preset: r.value as PresetId });
        this.sync();
      }),
    );
    el.querySelectorAll<HTMLInputElement>("input[data-q]").forEach((r) =>
      r.addEventListener("change", () => {
        if (!r.checked) return;
        const s = getSettings();
        // start from the units in effect, so picking one unit keeps the others of the preset
        const custom = { ...unitsOf(s), [r.dataset.q as Quantity]: r.value };
        setSettings({ preset: "custom", custom });
        this.sync();
      }),
    );
    this.resetBtn.addEventListener("click", () => {
      const n = overrideCount();
      clearUnitOverrides();
      // listeners (the sandbox) re-read every instrument
      setSettings(getSettings());
      this.status.textContent = n === 0 ? "Alle Instrumente folgen bereits der Voreinstellung." : n === 1 ? "1 Instrument folgt wieder der Voreinstellung." : `${n} Instrumente folgen wieder der Voreinstellung.`;
      this.sync();
    });
    this.sync();
  }

  /** Shows the stored state (also called each time the screen opens: overrides change in the sandbox). */
  sync() {
    const s = getSettings();
    const u = unitsOf(s);
    this.el.querySelectorAll<HTMLInputElement>("input[name=preset]").forEach((r) => (r.checked = r.value === s.preset));
    this.el.querySelectorAll<HTMLInputElement>("input[data-q]").forEach((r) => (r.checked = u[r.dataset.q as Quantity] === r.value));
    const n = overrideCount();
    this.overridesText.textContent = n === 0
      ? "Zurzeit folgen alle Instrumente der Voreinstellung."
      : n === 1 ? "Zurzeit hat 1 Instrument eine eigene Einheit." : `Zurzeit haben ${n} Instrumente eine eigene Einheit.`;
    this.preview.innerHTML = SAMPLE.map(([q, v, label]) => `<div><dt>${label}</dt><dd>${fmtQ(q, v, q === "volume" && u.volume === "l" ? 1 : undefined, u[q])}</dd></div>`).join("");
  }

  /** Clears the status line when the screen is left. */
  leave() {
    this.status.textContent = "";
  }
}
