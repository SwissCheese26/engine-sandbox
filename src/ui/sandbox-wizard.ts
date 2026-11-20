// Guided start of the Sandbox (#93), replaces "Wähle eine Strecke" (#48 follow-up). Opens when the Sandbox door in
// the main menu is chosen and leads through 1 Fahrzeugart · 2 Fahrzeug · 3 Strecke · 4 Los geht's. The result is
// handed to the sandbox (App) as a pending setup (sandbox-setup.ts); the App applies it on mount/resume.
// "Weiter wie zuletzt" on step 1 goes straight in with everything as it was.
import { TERRAIN_LABELS, formatTyreSize, parseTyreSize, terrainSamples } from "../core/index.ts";
import type { DriveLayout, GearboxType, Terrain } from "../core/index.ts";
import {
  CUSTOM_BASE_LABEL, CUSTOM_LIMITS, GEARBOX_SHORT, KIND_LABEL, PS_PER_KW, buildSetup, defaultCustom, drivesFor, enginesFor,
  gearboxesFor, loadOwnVehicle, setPendingSetup, validateCustom, vehicleFacts, vehiclesOf,
  type CustomBase, type CustomField, type CustomVehicle, type PendingSetup, type SetupKind,
} from "./sandbox-setup.ts";
import { getSettings, setSettings } from "./settings.ts";
import { TyreSizePicker } from "./tyre-size-picker.ts";
import { findMyEngine, loadMyEngines } from "./my-engines.ts";

/** "+ Neues erstellen" in a library list: the own-vehicle form starts with the matching base type. */
const BASE_OF_KIND: Partial<Record<SetupKind, CustomBase>> = { car: "car", commercial: "truck", bike: "bike" };

const ROUTES: Terrain[] = ["static", "flat", "hills", "alps", "uphill", "downhill"];

const ROUTE_TEXT: Record<Terrain, string> = {
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

const svg = (body: string, vb = "0 0 48 32") => `<svg class="wizard__icon" viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;

/** Simple line icons for the kind cards (stroke = currentColor). */
const KIND_ICON: Record<SetupKind, string> = {
  car: svg(`<path d="M4 22v-5l5-1 5-6h16l7 6 6 1v5z"/><circle cx="13" cy="23" r="3.5"/><circle cx="35" cy="23" r="3.5"/>`),
  commercial: svg(`<path d="M2 6h26v17H2zM28 12h9l6 6v5H28z"/><circle cx="9" cy="25" r="3"/><circle cx="21" cy="25" r="3"/><circle cx="37" cy="25" r="3"/>`),
  bike: svg(`<circle cx="10" cy="22" r="6"/><circle cx="38" cy="22" r="6"/><path d="M10 22l9-9h9l4 9h6M24 13l-3-5h-5M28 13l5-4h4"/>`),
  custom: svg(`<path d="M4 22v-5l5-1 5-6h16l7 6 6 1v5z" stroke-dasharray="3 2"/><circle cx="13" cy="23" r="3.5"/><circle cx="35" cy="23" r="3.5"/><path d="M38 3l3 3-9 9h-3v-3z"/>`),
  engine: svg(`<path d="M8 10h22v4h6v-3h6v14h-6v-3h-6v5H14l-6-5h-4V12h4z"/><path d="M15 6h10M20 6v4"/>`),
};

const KIND_TEXT: Record<SetupKind, string> = {
  car: "Kleinwagen, Limousine, Sportwagen, Geländewagen.",
  commercial: "Sattelzug 40 t und Stadtbus.",
  bike: "Superbikes, Naked Bikes, Tourer.",
  custom: "Gewicht, Luftwiderstand, Reifen, Antrieb und Motor selbst festlegen.",
  engine: "Ohne Fahrzeug und Strecke: Motor bauen und frei hochdrehen.",
};

const ICON = {
  key: svg(`<circle cx="14" cy="16" r="7"/><path d="M21 16h20v5M35 16v4"/>`),
  pedals: svg(`<rect x="6" y="6" width="14" height="20" rx="2"/><rect x="28" y="4" width="12" height="24" rx="2"/><path d="M10 12h6M10 16h6M32 10h4M32 14h4M32 18h4"/>`),
  shift: svg(`<path d="M24 4l8 9H16zM24 28l8-9H16z"/>`),
  park: svg(`<circle cx="24" cy="16" r="12"/><path d="M20 23V9h5a4 4 0 010 8h-5"/>`),
  cruise: svg(`<path d="M8 24a16 16 0 1132 0"/><path d="M24 24l8-9"/><circle cx="24" cy="24" r="2"/>`),
  route: svg(`<path d="M2 28l10-10 6 4 10-14 8 8 10-6"/>`),
  settings: svg(`<circle cx="24" cy="16" r="5"/><path d="M24 3v5M24 24v5M11 16h5M32 16h5M15 7l3.5 3.5M29.5 21.5L33 25M15 25l3.5-3.5M29.5 10.5L33 7"/>`),
};

/** "Kurz erklärt": where things are in the sandbox (labels as they appear on screen). */
const CHEATS: { icon: string; title: string; html: string }[] = [
  { icon: ICON.key, title: "Zündung und Start", html: "Unten links in der Bedienleiste: Schlüssel drehen (<kbd>I</kbd>), dann den Anlasser halten (<kbd>A</kbd>), bis der Motor läuft." },
  { icon: ICON.pedals, title: "Gas und Bremse", html: "Gas mit <kbd>W</kbd>, <kbd>Leertaste</kbd> oder <kbd>↑</kbd>, Bremse mit <kbd>S</kbd>. Auf dem Handy die Pedale unten rechts." },
  { icon: ICON.shift, title: "Schalten", html: "Hoch <kbd>E</kbd>, runter <kbd>Q</kbd>, oder ▲ und ▼ neben den Pedalen. Automatik: Knopf „Automatik (D)“." },
  { icon: ICON.park, title: "Handbremse", html: "Taste <kbd>P</kbd> oder die P-Taste neben der Bremse. Auto-Hold hält das Auto im Stand von selbst." },
  { icon: ICON.cruise, title: "Tempomat", html: "Setzen mit <kbd>C</kbd>, schneller <kbd>+</kbd>, langsamer <kbd>−</kbd>, wieder aufnehmen <kbd>R</kbd>, Begrenzer <kbd>L</kbd>." },
  { icon: ICON.route, title: "Umwelt und Strecke", html: "Auf dem Rollenprüfstand unter „Umwelt &amp; Assistenten“, im Cockpit über die Streckenzeile. Wetter, Höhe, Steigung, ABS und ESP." },
  { icon: ICON.settings, title: "Einstellungen", html: "Über „Menü“ oben links (<kbd>Esc</kbd>) und die Seitentür „Einstellungen“: Einheiten, Ansicht, Bedienung, Ton." },
];

const STEP_LABEL = ["Fahrzeugart", "Fahrzeug", "Strecke", "Los geht’s"] as const;
type Step = 1 | 2 | 3 | 4;

const LAYOUT_LABEL: Record<DriveLayout, string> = { fwd: "Frontantrieb", rwd: "Heckantrieb", awd: "Allrad" };
const fmtDe = (n: number, d = 0) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Numeric fields of the own-vehicle form. */
const NUM_FIELDS: { key: "massKg" | "cw" | "areaM2" | "tankL"; label: string; unit: string; step: string; digits: number }[] = [
  { key: "massKg", label: "Gewicht mit Fahrer", unit: "kg", step: "5", digits: 0 },
  { key: "cw", label: "cW-Wert", unit: "", step: "0.01", digits: 2 },
  { key: "areaM2", label: "Stirnfläche", unit: "m²", step: "0.01", digits: 2 },
  { key: "tankL", label: "Tank", unit: "l", step: "1", digits: 0 },
];

const defaultSize = (base: CustomBase) => parseTyreSize(defaultCustom(base).tyre)!;

export class SandboxWizard {
  readonly el: HTMLDialogElement;
  private step: Step = 1;
  private kind: SetupKind | null = null;
  private vehicleId = "";
  private tyrePicker!: TyreSizePicker;
  /** Set while the own-vehicle form was opened from a library list ("+ Neues erstellen"); Zurück returns there. */
  private createdFrom: SetupKind | null = null;
  private route: Terrain = "static";
  /** Engine from the Engine Builder (#72) that replaces the vehicle's engine in this run. */
  private engineId: string | null = null;
  private q = <T extends Element>(s: string) => this.el.querySelector<T>(s)!;

  constructor() {
    const d = document.createElement("dialog");
    d.className = "wizard";
    d.setAttribute("aria-label", "Sandbox starten");
    const kinds: SetupKind[] = ["car", "commercial", "bike", "custom", "engine"];
    d.innerHTML = `
      <form class="wizard__form" novalidate>
        <ol class="wizard__steps">
          ${STEP_LABEL.map((l, i) => `<li data-step-mark="${i + 1}"><span class="wizard__no">${i + 1}</span> <span class="wizard__label">${l}</span><span class="sr-only" data-mark-note></span></li>`).join("")}
        </ol>

        <section class="wizard__step" data-step="1" aria-labelledby="wiz-h1">
          <h2 id="wiz-h1" class="wizard__title" tabindex="-1">Womit willst du fahren?</h2>
          <p class="wizard__lead wizard__engine-note" data-out="engine-note" hidden></p>
          <ul class="wizard__kinds">
            ${kinds.map((k) => `
              <li><button type="button" class="wizard__kind${k === "engine" ? " wizard__kind--plain" : ""}" data-kind="${k}" ${k === "engine" ? 'data-pick="engine"' : ""} aria-pressed="false">
                ${KIND_ICON[k]}
                <span class="wizard__kname">${KIND_LABEL[k]}</span>
                <span class="wizard__ktext">${KIND_TEXT[k]}</span>
              </button></li>`).join("")}
          </ul>
        </section>

        <section class="wizard__step" data-step="2" aria-labelledby="wiz-h2" hidden>
          <h2 id="wiz-h2" class="wizard__title" tabindex="-1">Fahrzeug wählen</h2>
          <p class="wizard__lead" data-out="vehicle-lead"></p>
          <fieldset class="wizard__vlist" data-out="vehicles"><legend class="sr-only">Fahrzeug</legend></fieldset>
          <div class="wizard__vmore" data-out="vehicles-more">
            <p class="wizard__more">Weitere folgen …</p>
            <button type="button" class="wizard__create" data-action="create-own">
              <span class="wizard__plus" aria-hidden="true">+</span>
              <span><span class="wizard__vname">Neues erstellen</span>
              <span class="wizard__vfacts" data-out="create-text"></span></span>
            </button>
          </div>
          <div class="wizard__custom" data-out="custom" hidden>
            <label class="wizard__field wizard__field--wide"><span>Fahrzeugtyp</span>
              <select data-c="base">${(Object.keys(CUSTOM_BASE_LABEL) as CustomBase[]).map((b) => `<option value="${b}">${CUSTOM_BASE_LABEL[b]}</option>`).join("")}</select>
            </label>
            ${NUM_FIELDS.map((f) => `
              <label class="wizard__field"><span>${f.label}${f.unit ? ` (${f.unit})` : ""}</span>
                <input type="text" inputmode="decimal" data-c="${f.key}" autocomplete="off" aria-describedby="wiz-err-${f.key} wiz-range-${f.key}" />
                <small class="wizard__range" id="wiz-range-${f.key}"></small>
                <small class="wizard__err" id="wiz-err-${f.key}"></small>
              </label>`).join("")}
            <div class="wizard__field wizard__field--wide" data-out="tyre-field">
              <small class="wizard__range" id="wiz-range-tyre"></small>
              <small class="wizard__err" id="wiz-err-tyre"></small>
            </div>
            <label class="wizard__field"><span>Antrieb</span>
              <select data-c="drive" aria-describedby="wiz-err-drive"></select>
              <small class="wizard__err" id="wiz-err-drive"></small>
            </label>
            <label class="wizard__field"><span>Getriebe</span>
              <select data-c="gearbox" aria-describedby="wiz-err-gearbox"></select>
              <small class="wizard__err" id="wiz-err-gearbox"></small>
            </label>
            <label class="wizard__field wizard__field--wide"><span>Motor aus der Bibliothek</span>
              <select data-c="engineId" aria-describedby="wiz-err-engineId"></select>
              <small class="wizard__err" id="wiz-err-engineId"></small>
            </label>
            <p class="wizard__lead wizard__field--wide">Alles lässt sich später auf dem Rollenprüfstand unter „Fahrzeug &amp; Reifen“ und in der Werkbank ändern.</p>
          </div>
        </section>

        <section class="wizard__step" data-step="3" aria-labelledby="wiz-h3" hidden>
          <h2 id="wiz-h3" class="wizard__title" tabindex="-1">Wähle eine Strecke</h2>
          <p class="wizard__lead">Gilt auf dem Rollenprüfstand. Später änderbar unter Umwelt &amp; Assistenten oder über die Streckenzeile im Cockpit.</p>
          <fieldset class="routepick__list"><legend class="sr-only">Strecke</legend>
            ${ROUTES.map((t) => `
              <label class="routepick__card">
                <input type="radio" name="route" value="${t}" class="sr-only" />
                <span class="routepick__name">${t === "static" ? "Prüfstand eben" : TERRAIN_LABELS[t]}</span>
                ${spark(t)}
                <span class="routepick__text">${ROUTE_TEXT[t]}</span>
              </label>`).join("")}
          </fieldset>
        </section>

        <section class="wizard__step" data-step="4" aria-labelledby="wiz-h4" hidden>
          <h2 id="wiz-h4" class="wizard__title" tabindex="-1">Kurz erklärt</h2>
          <p class="wizard__lead" data-out="summary"></p>
          <ul class="wizard__cheats">
            ${CHEATS.map((c) => `<li>${c.icon}<div><b>${c.title}</b><p>${c.html}</p></div></li>`).join("")}
          </ul>
          <label class="wizard__hide"><input type="checkbox" data-control="hide-intro" /> <span>Nicht mehr anzeigen (wieder einschalten unter Einstellungen → Bedienung)</span></label>
        </section>

        <div class="wizard__foot">
          <button type="button" class="btn btn--small wizard__resume" data-pick="resume">Weiter wie zuletzt</button>
          <span class="wizard__spacer"></span>
          <button type="button" class="btn btn--small" data-nav="cancel">Abbrechen</button>
          <button type="button" class="btn btn--small" data-nav="back">Zurück</button>
          <button type="submit" class="btn btn--primary btn--small" data-nav="next">Weiter</button>
        </div>
      </form>`;
    this.el = d;
    // tyre size from lists (no free text); the width select carries the field's error state
    this.tyrePicker = new TyreSizePicker({ describedBy: "wiz-err-tyre wiz-range-tyre" });
    this.q("[data-out=tyre-field]").prepend(this.tyrePicker.el);
    this.q<HTMLSelectElement>("[data-control=tyre-width]").dataset.c = "tyre";
    this.tyrePicker.onChange = () => this.markError("tyre", "");
    this.q("[data-action=create-own]").addEventListener("click", () => this.createOwn());

    d.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((b) => b.addEventListener("click", () => this.pickKind(b.dataset.kind as SetupKind)));
    this.q<HTMLFormElement>("form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.next();
    });
    this.q("[data-nav=back]").addEventListener("click", () => this.back());
    this.q("[data-nav=cancel]").addEventListener("click", () => d.close());
    this.q("[data-pick=resume]").addEventListener("click", () => this.finish(null));
    d.querySelectorAll<HTMLInputElement>("input[name=route]").forEach((r) => r.addEventListener("change", () => (this.route = r.value as Terrain)));
    this.q<HTMLSelectElement>("[data-c=base]").addEventListener("change", (e) => this.fillCustom(SandboxWizard.startValues((e.target as HTMLSelectElement).value as CustomBase)));
    this.q("[data-out=custom]").addEventListener("input", (e) => {
      // a corrected field loses its error at once
      const t = e.target as HTMLElement;
      if (t.getAttribute("aria-invalid")) this.markError(t.dataset.c as CustomField, "");
    });
    // a click on the backdrop closes like Abbrechen: only a press that starts AND ends outside the box
    let downOutside = false;
    const outside = (e: MouseEvent) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    d.addEventListener("pointerdown", (e) => (downOutside = e.target === d && outside(e)));
    d.addEventListener("click", (e) => {
      if (downOutside && e.target === d && outside(e)) d.close();
      downOutside = false;
    });
    this.fillCustom(SandboxWizard.startValues());
  }

  /** Form start values: the stored own vehicle (#93 review) when it fits the base type, else the type's defaults. */
  private static startValues(base?: CustomBase): CustomVehicle {
    const own = loadOwnVehicle()?.custom;
    if (own && (!base || own.base === base)) return own;
    return defaultCustom(base ?? "car");
  }

  /** Opens at step 1. `engineId` (Engine Builder, #72): this engine goes into whatever vehicle is chosen. */
  open(opts: { engineId?: string } = {}) {
    if (this.el.open) return;
    const own = opts.engineId ? findMyEngine(opts.engineId) : undefined;
    this.engineId = own?.id ?? null;
    const note = this.q<HTMLElement>("[data-out=engine-note]");
    note.textContent = own ? `Mit deinem Motor „${own.name}“: Er kommt in das Fahrzeug, das du jetzt wählst.` : "";
    note.hidden = !own;
    // the own-vehicle form lists the current own engines and starts with the chosen one
    this.fillCustom(SandboxWizard.startValues());
    this.renderVehicles();
    if (typeof this.el.showModal !== "function") {
      // very old browsers without <dialog>: go straight in, as it was
      location.hash = "#sandbox";
      return;
    }
    this.q<HTMLInputElement>("[data-control=hide-intro]").checked = false;
    // a form opened from "+ Neues erstellen" last time does not lead back to that list now
    this.createdFrom = null;
    this.el.showModal();
    this.show(1);
  }

  private get intro(): boolean {
    return getSettings().sandboxIntro;
  }

  /** Steps this run goes through (the engine dyno skips vehicle and route, a hidden cheat sheet skips step 4). */
  private steps(): Step[] {
    const s: Step[] = this.kind === "engine" ? [1] : [1, 2, 3];
    if (this.intro) s.push(4);
    return s;
  }

  private pickKind(k: SetupKind) {
    this.createdFrom = null;
    if (this.kind !== k) {
      this.kind = k;
      this.vehicleId = "";
      this.renderVehicles();
      // the last own vehicle (also after a reload) fills the form
      if (k === "custom") this.fillCustom(SandboxWizard.startValues());
    }
    this.el.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === k)));
    this.next();
  }

  private next() {
    if (this.step === 1 && !this.kind) return;
    if (this.step === 2 && !this.commitVehicle()) return;
    const steps = this.steps();
    const i = steps.indexOf(this.step);
    const after = steps[i + 1];
    if (after) this.show(after);
    else this.go();
  }

  private back() {
    if (this.step === 2 && this.createdFrom) {
      // the form came from "+ Neues erstellen": back to that list
      this.kind = this.createdFrom;
      this.createdFrom = null;
      this.renderVehicles();
      this.q<HTMLElement>("#wiz-h2").focus();
      return;
    }
    const steps = this.steps();
    const i = steps.indexOf(this.step);
    if (i > 0) this.show(steps[i - 1]!);
  }

  private show(step: Step) {
    this.step = step;
    this.el.querySelectorAll<HTMLElement>(".wizard__step").forEach((s) => (s.hidden = s.dataset.step !== String(step)));
    const steps = this.steps();
    this.el.querySelectorAll<HTMLElement>("[data-step-mark]").forEach((li) => {
      const n = Number(li.dataset.stepMark) as Step;
      const cur = n === step;
      if (cur) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
      li.dataset.state = cur ? "current" : !steps.includes(n) ? "skip" : n < step ? "done" : "todo";
      // a step this run does not go through is read as "entfällt"
      li.querySelector("[data-mark-note]")!.textContent = steps.includes(n) ? "" : " (entfällt)";
    });
    const last = steps[steps.length - 1] === step;
    const nextBtn = this.q<HTMLButtonElement>("[data-nav=next]");
    nextBtn.textContent = last ? "Losfahren" : "Weiter";
    nextBtn.hidden = step === 1;
    this.q<HTMLButtonElement>("[data-nav=back]").hidden = step === 1;
    this.q<HTMLButtonElement>("[data-pick=resume]").hidden = step !== 1;
    if (step === 3) {
      const r = this.el.querySelector<HTMLInputElement>(`input[name=route][value="${this.route}"]`);
      if (r) r.checked = true;
    }
    if (step === 4) this.q("[data-out=summary]").textContent = this.summary();
    this.q<HTMLElement>(`#wiz-h${step}`).focus();
  }

  /** "+ Neues erstellen" in a library list: the own-vehicle form, base type preset to the list's kind. */
  private createOwn() {
    const from = this.kind;
    const base = from ? BASE_OF_KIND[from] : undefined;
    if (!from || !base) return;
    this.createdFrom = from;
    this.kind = "custom";
    this.renderVehicles();
    this.fillCustom(SandboxWizard.startValues(base));
    this.q<HTMLElement>("#wiz-h2").focus();
  }

  /** Step 2: the library list of the kind, or the own-vehicle form. */
  private renderVehicles() {
    const k = this.kind;
    const list = this.q<HTMLFieldSetElement>("[data-out=vehicles]");
    const custom = this.q<HTMLElement>("[data-out=custom]");
    const lead = this.q("[data-out=vehicle-lead]");
    const isCustom = k === "custom";
    list.hidden = isCustom;
    custom.hidden = !isCustom;
    const more = this.q<HTMLElement>("[data-out=vehicles-more]");
    more.hidden = isCustom || !k || !BASE_OF_KIND[k];
    if (k && BASE_OF_KIND[k]) this.q("[data-out=create-text]").textContent = `Eigenes ${k === "bike" ? "Motorrad" : k === "commercial" ? "Nutzfahrzeug (Lkw)" : "Auto"} mit Gewicht, Reifen, Getriebe und Motor.`;
    this.q("#wiz-h2").textContent = isCustom ? "Eigenes Fahrzeug" : `${k ? KIND_LABEL[k] : ""} wählen`;
    lead.textContent = isCustom
      ? "Startwerte passen zum Fahrzeugtyp. Der Motor kommt aus der Bibliothek."
      : this.engineName ? `Statt des Serienmotors fährt dein Motor „${this.engineName}“.` : "Der passende Serienmotor wird gleich mitgeladen.";
    list.querySelectorAll("label").forEach((l) => l.remove());
    if (k === "car" || k === "commercial" || k === "bike") {
      const cars = vehiclesOf(k);
      if (!this.vehicleId) this.vehicleId = cars[0]?.id ?? "";
      for (const c of cars) {
        const f = vehicleFacts(c);
        const l = document.createElement("label");
        l.className = "wizard__vehicle";
        l.innerHTML = `
          <input type="radio" name="vehicle" value="${c.id}" ${c.id === this.vehicleId ? "checked" : ""} />
          <span class="wizard__vname">${c.name} <small>${c.years}</small></span>
          <span class="wizard__vfacts num">${fmtDe(f.ps)} PS · ${fmtDe(f.kg)} kg · ${f.drive} · ${f.gearbox} · Tank ${fmtDe(f.tankL, f.tankL % 1 ? 1 : 0)} l</span>`;
        l.querySelector("input")!.addEventListener("change", () => (this.vehicleId = c.id));
        list.append(l);
      }
    }
  }

  private fillCustom(c: CustomVehicle) {
    const sel = (key: string) => this.q<HTMLSelectElement>(`[data-c=${key}]`);
    sel("base").value = c.base;
    for (const f of NUM_FIELDS) {
      this.q<HTMLInputElement>(`[data-c=${f.key}]`).value = fmtDe(c[f.key], f.digits).replace(/\./g, "");
      const r = CUSTOM_LIMITS[c.base][f.key];
      this.q(`#wiz-range-${f.key}`).textContent = `${fmtDe(r.min, f.digits)} bis ${fmtDe(r.max, f.digits)}${f.unit ? ` ${f.unit}` : ""}`;
    }
    // only sizes inside the base type's radius limit are offered, so a picked size never fails validateCustom
    const rr = CUSTOM_LIMITS[c.base].radiusM;
    this.tyrePicker.setValue(parseTyreSize(c.tyre) ?? defaultSize(c.base), c.base, rr);
    this.q("#wiz-range-tyre").textContent = `Radradius ${fmtDe(rr.min * 1000)} bis ${fmtDe(rr.max * 1000)} mm`;
    const drives = drivesFor(c.base);
    sel("drive").innerHTML = drives.map((d) => `<option value="${d}">${c.base === "bike" ? "Hinterrad (Kette)" : LAYOUT_LABEL[d]}</option>`).join("");
    sel("drive").value = c.drive;
    sel("drive").disabled = drives.length < 2;
    sel("gearbox").innerHTML = gearboxesFor(c.base).map((g: GearboxType) => `<option value="${g}">${c.base === "truck" && g === "dsg" ? "Automatisiert (AMT), 12 Gänge" : GEARBOX_SHORT[g]}</option>`).join("");
    sel("gearbox").value = c.gearbox;
    // own engines (#72) first, then the library engines that fit the vehicle type
    const engines = sel("engineId");
    engines.replaceChildren();
    const mine = loadMyEngines();
    if (mine.length) {
      const g = document.createElement("optgroup");
      g.label = "Eigene Motoren";
      g.append(...mine.map((m) => Object.assign(document.createElement("option"), { value: m.id, textContent: m.name })));
      engines.append(g);
    }
    const lib = document.createElement("optgroup");
    lib.label = "Bibliothek";
    lib.append(...enginesFor(c.base).map((e) => Object.assign(document.createElement("option"), { value: e.config.id, textContent: `${e.config.name} · ${fmtDe(e.expected.peakPowerKw * PS_PER_KW)} PS` })));
    engines.append(lib);
    engines.value = this.engineId ?? c.engineId;
    if (!engines.value) engines.selectedIndex = mine.length;
    for (const k of ["massKg", "cw", "areaM2", "tankL", "tyre", "drive", "gearbox", "engineId"] as CustomField[]) this.markError(k, "");
  }

  private readCustom() {
    const v = (k: string) => this.q<HTMLInputElement | HTMLSelectElement>(`[data-c=${k}]`).value;
    return { base: v("base"), massKg: v("massKg"), cw: v("cw"), areaM2: v("areaM2"), tankL: v("tankL"), tyre: formatTyreSize(this.tyrePicker.value), drive: v("drive"), gearbox: v("gearbox"), engineId: v("engineId") };
  }

  private markError(k: CustomField, msg: string) {
    const input = this.el.querySelector<HTMLElement>(`[data-c=${k}]`);
    const out = this.el.querySelector<HTMLElement>(`#wiz-err-${k}`);
    if (!input || !out) return;
    out.textContent = msg;
    if (msg) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  private customValue: CustomVehicle | null = null;

  /** Leaving step 2: a library vehicle must be chosen, an own vehicle must be valid. */
  private commitVehicle(): boolean {
    if (this.kind !== "custom") return !!this.vehicleId;
    const r = validateCustom(this.readCustom());
    for (const k of ["massKg", "cw", "areaM2", "tankL", "tyre", "drive", "gearbox", "engineId"] as CustomField[]) this.markError(k, r.ok ? "" : (r.errors[k] ?? ""));
    if (!r.ok) {
      this.el.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      return false;
    }
    this.customValue = r.value;
    return true;
  }

  private setup(): PendingSetup | null {
    if (!this.kind) return null;
    return buildSetup(this.kind, { vehicleId: this.vehicleId, custom: this.customValue ?? undefined, route: this.route, engineId: this.engineId ?? undefined });
  }

  private summary(): string {
    const p = this.setup();
    if (!p) return "";
    const own = p.engineId ? findMyEngine(p.engineId) : undefined;
    const withEngine = own ? ` Motor: „${own.name}“.` : "";
    if (p.kind === "engine") return `Motorprüfstand ohne Fahrzeug.${withEngine}`;
    const name = p.kind === "custom" ? `Eigenes Fahrzeug (${CUSTOM_BASE_LABEL[p.custom!.base]})` : vehiclesOf(p.kind).find((c) => c.id === p.vehicleId)?.name;
    return `${name} auf ${p.route === "static" ? "dem ebenen Prüfstand" : `der Strecke ${TERRAIN_LABELS[p.route!]}`}.${withEngine}`;
  }

  private get engineName(): string {
    return this.engineId ? (findMyEngine(this.engineId)?.name ?? "") : "";
  }

  /** "Losfahren": remember "Nicht mehr anzeigen", hand the setup to the sandbox. */
  private go() {
    if (this.q<HTMLInputElement>("[data-control=hide-intro]").checked) setSettings({ sandboxIntro: false });
    const p = this.setup();
    if (!p) return;
    this.finish(p);
  }

  private finish(p: PendingSetup | null) {
    // null = "Weiter wie zuletzt": into the sandbox as it was (vehicle, route, position, mode unchanged)
    setPendingSetup(p);
    this.el.close();
    location.hash = "#sandbox";
  }
}
