// Einstellungen (#24): global unit preset, custom units per quantity and the reset of the per-instrument
// choices (#21). Changes apply at once (no save button) and reach the running sandbox through
// onSettingsChange().
import { SPEEDO_SCALES, clampSpeedoKmh, isSpeedoScale } from "./layouts/logic.ts";
import { LAYOUTS, PRESETS, QUANTITIES, getSettings, setSettings, unitsOf, type LayoutId, type PresetId, type Quantity } from "./settings.ts";
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

/** Miniatures of the sandbox views (#26) for the preview tiles; colours come from CSS (currentColor + classes). */
const THUMB: Record<LayoutId, string> = {
  pruefzelle: `<rect x="2" y="2" width="22" height="56" rx="1" class="t-alu"/><rect x="28" y="2" width="70" height="20" rx="1" class="t-deep"/>
    <circle cx="38" cy="32" r="6" class="t-ring"/><circle cx="54" cy="32" r="6" class="t-ring"/><circle cx="70" cy="32" r="6" class="t-ring"/><circle cx="86" cy="32" r="6" class="t-ring"/>
    <rect x="28" y="42" width="70" height="16" rx="1" class="t-paper"/><path d="M30 54l10-6 8 3 10-8 12 4 26-5" class="t-ink"/>`,
  cockpit: `<rect x="2" y="2" width="96" height="56" rx="6" class="t-night"/><circle cx="24" cy="32" r="18" class="t-ring"/><circle cx="76" cy="32" r="18" class="t-ring"/>
    <path d="M24 32l-10 8M76 32l9-12" class="t-needle"/><path d="M88 22a18 18 0 0 1 4 14" class="t-zone"/>
    <rect x="44" y="18" width="12" height="28" rx="1" class="t-lcd"/><circle cx="12" cy="8" r="2" class="t-amber"/><circle cx="88" cy="8" r="2" class="t-red"/>`,
  race: `<rect x="2" y="2" width="96" height="56" rx="3" class="t-night"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<circle cx="${14 + i * 8}" cy="9" r="2.6" class="${i < 4 ? "t-green" : i < 7 ? "t-amber" : "t-red"}"/>`).join("")}
    <text x="50" y="44" text-anchor="middle" class="t-gear">4</text><rect x="8" y="50" width="60" height="4" class="t-lcd"/><rect x="8" y="50" width="40" height="4" class="t-light"/>`,
  compact: `<rect x="30" y="2" width="40" height="56" rx="4" class="t-deep"/><rect x="35" y="8" width="30" height="8" class="t-light"/><rect x="35" y="20" width="30" height="8" class="t-light"/>
    <rect x="35" y="32" width="13" height="8" class="t-light"/><rect x="52" y="32" width="13" height="8" class="t-light"/><rect x="58" y="44" width="7" height="11" rx="1" class="t-alu"/>`,
};

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
        <section class="plate office__plate" aria-labelledby="set-layout">
          <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
          <span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>
          <h2 class="plate__title" id="set-layout">Ansicht</h2>
          <p class="plate__effect">Wie die Sandbox ihre Werte zeigt. Der Motor läuft weiter, nur die Anzeige wechselt. In der Sandbox lässt sich die Ansicht auch oben in der Kopfleiste umschalten.</p>
          <fieldset class="layouts">
            <legend class="sr-only">Ansicht der Sandbox</legend>
            ${LAYOUTS.map((l) => `
            <label class="layout-tile">
              <input type="radio" name="layout" value="${l.id}" />
              <svg class="layout-tile__thumb" viewBox="0 0 100 60" aria-hidden="true">${THUMB[l.id]}</svg>
              <span class="layout-tile__name">${l.label}</span>
              <span class="layout-tile__hint">${l.hint}</span>
            </label>`).join("")}
          </fieldset>
          <div class="office__speedo">
            <label class="office__opt"><span>Tacho-Skala im Cockpit</span>
              <select data-control="speedo-scale">${SPEEDO_SCALES.map((o) => `<option value="${o.id}">${o.label}${o.kmh ? ` · ${o.kmh} km/h` : ""}</option>`).join("")}</select>
            </label>
            <label class="office__opt" data-speedo-custom><span>Eigene Skala (km/h)</span>
              <input type="number" data-control="speedo-custom" min="100" max="600" step="20" inputmode="numeric" />
            </label>
          </div>
        </section>
        <section class="plate office__plate" aria-labelledby="set-controls">
          <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
          <span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>
          <h2 class="plate__title" id="set-controls">Bedienung</h2>
          <fieldset class="office__choice">
            <legend>Gashebel auf dem Rollenprüfstand</legend>
            <label><input type="radio" name="throttle" value="spring" /> <span><b>Federt zurück</b> wie ein Gaspedal: loslassen heißt Gas weg.</span></label>
            <label><input type="radio" name="throttle" value="hold" /> <span><b>Bleibt stehen</b> (Handgas): der Hebel hält seine Stellung, auch nach dem Loslassen.</span></label>
          </fieldset>
        </section>
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
        setSettings({ preset: r.value as PresetId });
        this.sync();
      }),
    );
    el.querySelectorAll<HTMLInputElement>("input[name=layout]").forEach((r) =>
      r.addEventListener("change", () => {
        if (r.checked) setSettings({ layout: r.value as LayoutId });
      }),
    );
    el.querySelectorAll<HTMLInputElement>("input[name=throttle]").forEach((r) =>
      r.addEventListener("change", () => {
        if (r.checked) setSettings({ throttle: r.value === "hold" ? "hold" : "spring" });
      }),
    );
    const scaleSel = el.querySelector<HTMLSelectElement>("[data-control=speedo-scale]")!;
    scaleSel.addEventListener("change", () => {
      if (isSpeedoScale(scaleSel.value)) setSettings({ speedo: scaleSel.value });
      this.sync();
    });
    const customIn = el.querySelector<HTMLInputElement>("[data-control=speedo-custom]")!;
    customIn.addEventListener("change", () => {
      setSettings({ speedoCustomKmh: clampSpeedoKmh(customIn.valueAsNumber) }); // sync() shows the stored value
      this.sync();
    });
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
    this.el.querySelectorAll<HTMLInputElement>("input[name=layout]").forEach((r) => (r.checked = r.value === s.layout));
    this.el.querySelector<HTMLSelectElement>("[data-control=speedo-scale]")!.value = s.speedo;
    this.el.querySelectorAll<HTMLInputElement>("input[name=throttle]").forEach((r) => (r.checked = r.value === s.throttle));
    this.el.querySelector<HTMLInputElement>("[data-control=speedo-custom]")!.value = String(s.speedoCustomKmh);
    this.el.querySelector<HTMLElement>("[data-speedo-custom]")!.hidden = s.speedo !== "custom";
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
