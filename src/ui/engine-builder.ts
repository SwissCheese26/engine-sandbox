// Engine Builder (#72): a screen behind its own door in the main menu (#builder). It builds an engine step by step
// (Grundlage, Block, Zylinderkopf, Gemischbildung, Aufladung, Abgas, Kühlung, Grenzen und Steuergerät, Fertig) with
// the workbench's own field definitions, a live summary from the core, and saves it as an own engine
// (my-engines.ts). Afterwards the engine can be revved on a small engine dyno (rev-stand.ts) or driven in the
// sandbox (guided start with this engine preselected). The pure logic lives in builder-model.ts.
import { dynoSweep, summarize } from "../core/index.ts";
import type { EngineConfig, FuelKind, Warning } from "../core/index.ts";
import { ENGINE_LIBRARY } from "../data/engine-library.ts";
import {
  OMIT_PATHS, STEPS, STEP_COUNT, builderStats, clearDraft, loadDraft, optionInfo, saveDraft, startConfig, stepBlockers, stepIndex, stepOfField,
  type BuilderDraft, type BuilderStats,
} from "./builder-model.ts";
import { getPath } from "./fields.ts";
import { fmt } from "./format.ts";
import { deleteMyEngine, findMyEngine, loadMyEngines, NAME_MAX, renameMyEngine, saveMyEngine, type StoredEngine } from "./my-engines.ts";
import { Nameplate } from "./nameplate.ts";
import { autoName, layoutCode } from "./names.ts";
import { RevStand } from "./rev-stand.ts";
import { prefs } from "./settings.ts";
import { fmtQ } from "./units.ts";
import { Workbench } from "./workbench.ts";

type View = "garage" | "build" | "rev";

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const SEVERITY_LABEL: Record<Warning["severity"], string> = { critical: "Muss behoben werden", warning: "Warnung", info: "Hinweis" };

export class EngineBuilderScreen {
  readonly el: HTMLElement;
  readonly heading: HTMLElement;
  private view: View = "garage";
  private bench: Workbench;
  private stand = new RevStand();
  /** "In der Sandbox fahren": the shell opens the guided start with this engine preselected. */
  onDrive: (engineId: string) => void = () => {};
  private nameplate = new Nameplate();
  private step = 0;
  /** Furthest step reached in this build: the step indicator can jump back and forth up to here. */
  private reached = 0;
  private cfg: EngineConfig;
  private customName = false;
  private editingId: string | undefined;
  private baseId: string | undefined;
  /** Id of the engine saved last in this build (shown in the success box on Fertig). */
  private savedId: string | null = null;
  private statsRaf = 0;
  /** Where "Zurück" on the rev stand leads, and the button to focus there. */
  private revFrom: { view: View; focus: HTMLElement | null } = { view: "garage", focus: null };
  private q = <T extends Element>(s: string) => this.el.querySelector<T>(s)!;

  constructor() {
    const el = document.createElement("div");
    el.className = "office eb";
    el.innerHTML = `
      <header class="office__top">
        <a class="btn btn--small" href="#menu" aria-keyshortcuts="Escape">Menü</a>
        <h1 class="office__title" tabindex="-1">Engine Builder</h1>
      </header>
      <main class="eb__body">
        <section class="eb__garage" data-view="garage" aria-labelledby="eb-garage-h">
          <div class="plate eb__intro-plate">
            <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
            <h2 class="plate__title" id="eb-garage-h" tabindex="-1">Motor Schritt für Schritt bauen</h2>
            <p class="plate__effect">Vom Kraftstoff über Block, Zylinderkopf und Turbo bis zum Steuergerät: Zu jedem Schritt steht dabei, was die Teile bewirken. Am Ende speicherst du den Motor, drehst ihn im Stand hoch oder fährst ihn in der Sandbox.</p>
            <div class="eb__start">
              <button type="button" class="btn btn--primary eb__big" data-action="new">Neuen Motor bauen</button>
              <button type="button" class="btn eb__big" data-action="resume" hidden></button>
            </div>
          </div>
          <h2 class="eb__h" id="eb-list-h" tabindex="-1">Meine Motoren</h2>
          <p class="eb__empty" data-out="empty">Noch keine eigenen Motoren. Bau deinen ersten!</p>
          <ul class="eb__list" data-out="list" aria-labelledby="eb-list-h"></ul>
          <p class="sr-only" role="status" aria-live="polite" data-out="garage-status"></p>
        </section>

        <form class="eb__build" data-view="build" novalidate hidden aria-labelledby="eb-step-h">
          <nav class="eb__nav" aria-label="Schritte">
            <ol class="eb__steps">
              ${STEPS.map((s, i) => `<li><button type="button" class="eb__stepbtn" data-goto="${i}"><span class="eb__no num" aria-hidden="true">${i + 1}</span><span class="eb__slabel">${s.title}</span><span class="sr-only" data-mark></span></button></li>`).join("")}
            </ol>
          </nav>
          <div class="eb__grid">
            <section class="eb__step">
              <p class="eb__progress num" data-out="progress"></p>
              <h2 class="eb__title" id="eb-step-h" tabindex="-1"></h2>
              <p class="eb__lead" data-out="intro"></p>
              <div class="eb__saved" data-out="saved" hidden tabindex="-1" role="region" aria-labelledby="eb-saved-h">
                <h3 id="eb-saved-h" class="eb__saved-h"></h3>
                <p>Er steht jetzt unter „Meine Motoren“, in der Werkbank und bei „Eigenes Fahrzeug“ in der Sandbox.</p>
                <div class="eb__actions">
                  <button type="button" class="btn btn--primary eb__big" data-action="rev">Am Stand hochdrehen</button>
                  <button type="button" class="btn btn--primary eb__big" data-action="drive">In der Sandbox fahren</button>
                  <button type="button" class="btn eb__big" data-action="to-garage">Zur Übersicht</button>
                </div>
              </div>
              <div class="eb__blockers" data-out="blockers" hidden tabindex="-1"></div>

              <div class="eb__basis plate" data-part="basis">
                <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
                <div class="field field--text">
                  <label class="field__label" for="eb-name">Name</label>
                  <input type="text" id="eb-name" data-control="name" maxlength="${NAME_MAX}" autocomplete="off" aria-describedby="eb-name-fx" />
                  <p class="field__effect" id="eb-name-fx">Steht auf dem Typenschild. Leer lassen: Der Name folgt der Konfiguration, z. B. „R4 Benziner 2,0 Turbo“.</p>
                </div>
                <fieldset class="eb__fuel">
                  <legend class="field__label">Kraftstoff</legend>
                  <label class="eb__card"><input type="radio" name="eb-fuel" value="diesel" /><span><b>Diesel</b> Selbstzünder: hohe Verdichtung, viel Drehmoment, sparsam. Begrenzer meist unter 5.000 1/min.</span></label>
                  <label class="eb__card"><input type="radio" name="eb-fuel" value="petrol" /><span><b>Benzin</b> Ottomotor mit Zündkerze: dreht höher, klingt heller, verträgt weniger Verdichtung.</span></label>
                </fieldset>
                <div class="field field--select">
                  <label class="field__label" for="eb-base">Startpunkt</label>
                  <select id="eb-base" data-control="base" aria-describedby="eb-base-fx"></select>
                  <p class="field__effect" id="eb-base-fx">Grundausstattung: ein solider Vierzylinder zum Umbauen. Oder ein Serienmotor aus der Bibliothek als Vorlage, gespeichert wird immer eine Kopie.</p>
                </div>
                <p class="eb__note" data-out="basis-note" role="status" aria-live="polite"></p>
              </div>

              <div class="eb__bench" data-part="bench"></div>

              <div class="eb__finish" data-part="finish">
                <div class="plate eb__curve-plate">
                  <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
                  <h3 class="plate__title">Volllastkurve</h3>
                  <figure class="eb__curve" data-out="curve"></figure>
                </div>
                <div class="eb__plate-slot" data-out="nameplate"></div>
                <div class="plate eb__findings">
                  <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
                  <h3 class="plate__title">Prüfbericht</h3>
                  <ul class="eb__warnlist" data-out="findings"></ul>
                </div>
                <div class="field field--text plate eb__savename">
                  <label class="field__label" for="eb-name2">Name zum Speichern</label>
                  <input type="text" id="eb-name2" data-control="name" maxlength="${NAME_MAX}" autocomplete="off" />
                </div>
              </div>
            </section>

            <aside class="eb__sum" aria-labelledby="eb-sum-h">
              <h2 class="eb__sum-h" id="eb-sum-h">Dein Motor</h2>
              <p class="eb__sum-name" data-out="sum-name"></p>
              <dl class="eb__figures">
                <div><dt>Hubraum</dt><dd class="num" data-out="disp"></dd></div>
                <div><dt>Leistung <small>geschätzt</small></dt><dd class="num" data-out="kw"></dd></div>
                <div><dt>Drehmoment <small>geschätzt</small></dt><dd class="num" data-out="nm"></dd></div>
                <div><dt>Bohrung / Hub</dt><dd class="num" data-out="bs"></dd></div>
                <div><dt>Kolbengeschw. am Begrenzer</dt><dd class="num" data-out="cm"></dd></div>
                <div><dt>Verdichtung</dt><dd class="num" data-out="cr"></dd></div>
                <div><dt>Gewicht trocken</dt><dd class="num" data-out="kg"></dd></div>
                <div><dt>Hinweise</dt><dd data-out="warn"></dd></div>
              </dl>
            </aside>
          </div>
          <div class="eb__foot">
            <button type="button" class="btn" data-nav="cancel">Abbrechen</button>
            <span class="eb__spacer"></span>
            <button type="button" class="btn" data-nav="back">Zurück</button>
            <button type="submit" class="btn btn--primary" data-nav="next">Weiter</button>
          </div>
        </form>

        <div class="eb__rev" data-view="rev" hidden></div>
      </main>`;
    this.el = el;
    this.heading = el.querySelector(".office__title")!;
    const start = startConfig("petrol");
    this.cfg = start.config;
    this.bench = new Workbench(this.cfg, { groups: [], omit: OMIT_PATHS, embedded: true });
    this.bench.el.classList.add("eb__workbench");
    this.q("[data-part=bench]").append(this.bench.el);
    this.q("[data-out=nameplate]").append(this.nameplate.el);
    this.q("[data-view=rev]").append(this.stand.el);
    this.wire();
    this.renderGarage();
  }

  // --- wiring ------------------------------------------------------------------------------------------------------

  private wire() {
    this.bench.onChange((cfg) => {
      this.cfg = cfg;
      this.changed();
    });
    this.q("[data-action=new]").addEventListener("click", () => this.startNew());
    this.q("[data-action=resume]").addEventListener("click", () => {
      const d = loadDraft();
      if (d) this.openDraft(d);
    });
    // Enter in a bench value field confirms the value (workbench), it must not also submit the step
    this.bench.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
    });
    const form = this.q<HTMLFormElement>("form.eb__build");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.next();
    });
    this.q("[data-nav=back]").addEventListener("click", () => this.go(this.step - 1));
    this.q("[data-nav=cancel]").addEventListener("click", () => this.showGarage(this.q<HTMLElement>("[data-action=resume]")));
    this.el.querySelectorAll<HTMLButtonElement>("[data-goto]").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.goto);
        if (i <= this.reached) this.go(i);
      }));
    // Grundlage: name, fuel, start point
    for (const inp of this.el.querySelectorAll<HTMLInputElement>("input[data-control=name]")) {
      inp.addEventListener("input", () => this.setName(inp.value));
    }
    for (const r of this.el.querySelectorAll<HTMLInputElement>("input[name=eb-fuel]")) {
      r.addEventListener("change", () => {
        if (!r.checked || r.value === this.cfg.fuel) return;
        this.applyStart(r.value as FuelKind, undefined);
        this.q("[data-out=basis-note]").textContent = `Grundausstattung ${r.value === "diesel" ? "Diesel" : "Benziner"} geladen.`;
      });
    }
    const base = this.q<HTMLSelectElement>("[data-control=base]");
    base.addEventListener("change", () => {
      const id = base.value || undefined;
      const fuel = id ? (ENGINE_LIBRARY.find((e) => e.config.id === id)?.config.fuel ?? findMyEngine(id)?.config.fuel ?? this.cfg.fuel) : this.cfg.fuel;
      this.applyStart(fuel, id);
      this.q("[data-out=basis-note]").textContent = id ? `Vorlage geladen: ${this.cfg.name}. Alle Werte lassen sich in den nächsten Schritten ändern.` : "Grundausstattung geladen.";
    });
    // finish: warnings lead to their step
    this.q("[data-out=findings]").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-goto-step]");
      if (b) this.go(Number(b.dataset.gotoStep), b.dataset.field);
    });
    this.q("[data-out=blockers]").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-focus-field]");
      if (b) this.focusField(b.dataset.focusField!);
    });
    // after saving
    this.q("[data-action=rev]").addEventListener("click", (e) => this.openRev(this.savedId ? findMyEngine(this.savedId)?.config ?? this.cfg : this.cfg, "build", e.currentTarget as HTMLElement));
    this.q("[data-action=drive]").addEventListener("click", () => this.savedId && this.onDrive(this.savedId));
    this.q("[data-action=to-garage]").addEventListener("click", () => this.showGarage(this.q<HTMLElement>("[data-action=new]")));
    this.stand.onClose = () => {
      this.stand.close();
      this.setView(this.revFrom.view);
      if (this.revFrom.view === "garage") this.renderGarage();
      (this.revFrom.focus?.isConnected ? this.revFrom.focus : this.heading).focus();
    };
    // the garage list: one handler for all rows
    this.q("[data-out=list]").addEventListener("click", (e) => this.listAction(e));
    this.q<HTMLElement>("[data-out=list]").addEventListener("keydown", (e) => this.listKey(e));
  }

  /** Shell: the screen is shown. */
  enter() {
    if (this.view === "garage") this.renderGarage();
    if (this.view === "build") this.syncStep();
  }

  /** Shell: another screen is shown. The rev stand stops; the draft is already saved. */
  leave() {
    if (this.view === "rev") {
      this.stand.close();
      this.setView(this.revFrom.view);
    }
  }

  /** Element to focus when the screen opens. */
  focusTarget(): HTMLElement {
    return this.heading;
  }

  private setView(v: View) {
    this.view = v;
    for (const s of this.el.querySelectorAll<HTMLElement>("[data-view]")) s.hidden = s.dataset.view !== v;
  }

  // --- garage ------------------------------------------------------------------------------------------------------

  private showGarage(focus?: HTMLElement | null) {
    this.setView("garage");
    this.renderGarage();
    window.scrollTo?.(0, 0);
    (focus && !focus.hidden ? focus : this.q<HTMLElement>("#eb-garage-h")).focus();
  }

  private renderGarage() {
    const d = loadDraft();
    const resume = this.q<HTMLButtonElement>("[data-action=resume]");
    resume.hidden = !d;
    if (d) resume.textContent = `Entwurf fortsetzen: ${d.config.name} (Schritt ${d.step + 1} von ${STEP_COUNT})`;
    const list = loadMyEngines();
    this.q<HTMLElement>("[data-out=empty]").hidden = list.length > 0;
    const ul = this.q<HTMLElement>("[data-out=list]");
    ul.hidden = list.length === 0;
    ul.innerHTML = list.map((e) => this.row(e)).join("");
  }

  private row(e: StoredEngine): string {
    let facts = "";
    try {
      const s = summarize(e.config);
      facts = `${layoutCode(e.config)} ${e.config.fuel === "diesel" ? "Diesel" : "Benzin"} · ${fmtQ("volume", s.displacementL, prefs().volume === "l" ? 1 : 0)} · ${fmtQ("power", s.peakPowerKw)} · ${fmtQ("torque", s.peakTorqueNm)}`;
    } catch {
      facts = `${layoutCode(e.config)} ${e.config.fuel === "diesel" ? "Diesel" : "Benzin"}`;
    }
    const id = esc(e.id);
    return `
      <li class="eb__engine plate" data-id="${id}">
        <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
        <div class="eb__ename" data-out="ename"><h3 class="eb__etitle" id="eb-e-${id}" tabindex="-1">${esc(e.name)}</h3>
          <p class="eb__efacts num">${esc(facts)}</p></div>
        <div class="eb__eactions">
          <button type="button" class="btn btn--primary" data-row="rev" aria-describedby="eb-e-${id}">Hochdrehen</button>
          <button type="button" class="btn btn--primary" data-row="drive" aria-describedby="eb-e-${id}">Fahren</button>
          <button type="button" class="btn" data-row="edit" aria-describedby="eb-e-${id}">Bearbeiten</button>
          <button type="button" class="btn" data-row="rename" aria-describedby="eb-e-${id}">Umbenennen</button>
          <button type="button" class="btn" data-row="delete" aria-describedby="eb-e-${id}">Löschen</button>
        </div>
      </li>`;
  }

  private listAction(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-row]");
    const li = b?.closest<HTMLElement>("li[data-id]");
    if (!b || !li) return;
    const id = li.dataset.id!;
    const eng = findMyEngine(id);
    const status = this.q("[data-out=garage-status]");
    switch (b.dataset.row) {
      case "rev":
        if (eng) this.openRev(eng.config, "garage", b);
        break;
      case "drive":
        if (eng) this.onDrive(id);
        break;
      case "edit":
        if (eng) this.openDraft({ step: 1, config: structuredClone(eng.config), customName: true, editingId: id });
        break;
      case "rename":
        if (eng) this.startRename(li, eng);
        break;
      case "rename-ok": {
        const inp = li.querySelector<HTMLInputElement>("input[data-control=rename]")!;
        const r = renameMyEngine(id, inp.value);
        if (!r) {
          inp.setAttribute("aria-invalid", "true");
          li.querySelector<HTMLElement>("[data-out=rename-err]")!.textContent = "Bitte einen Namen eingeben.";
          inp.focus();
          return;
        }
        this.renderGarage();
        status.textContent = `Umbenannt in „${r.name}“.`;
        this.q<HTMLElement>(`li[data-id="${CSS.escape(id)}"] [data-row=rename]`)?.focus();
        break;
      }
      case "rename-cancel":
        this.renderGarage();
        this.q<HTMLElement>(`li[data-id="${CSS.escape(id)}"] [data-row=rename]`)?.focus();
        break;
      case "delete":
        if (eng) this.confirmDelete(li, eng);
        break;
      case "delete-ok": {
        const name = eng?.name ?? "";
        deleteMyEngine(id);
        const d = loadDraft();
        if (d?.editingId === id) clearDraft();
        this.renderGarage();
        status.textContent = `„${name}“ gelöscht.`;
        this.q<HTMLElement>("#eb-list-h").focus();
        break;
      }
      case "delete-cancel":
        this.renderGarage();
        this.q<HTMLElement>(`li[data-id="${CSS.escape(id)}"] [data-row=delete]`)?.focus();
        break;
    }
  }

  /** Enter confirms and Esc cancels the inline rename (Esc then does not leave the screen). */
  private listKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.dataset.control !== "rename") return;
    const li = t.closest<HTMLElement>("li[data-id]")!;
    if (e.key === "Enter") {
      e.preventDefault();
      li.querySelector<HTMLButtonElement>("[data-row=rename-ok]")!.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      li.querySelector<HTMLButtonElement>("[data-row=rename-cancel]")!.click();
    }
  }

  private startRename(li: HTMLElement, eng: StoredEngine) {
    const id = esc(eng.id);
    li.querySelector<HTMLElement>("[data-out=ename]")!.innerHTML = `
      <label class="field__label" for="eb-rn-${id}">Neuer Name</label>
      <input type="text" id="eb-rn-${id}" data-control="rename" maxlength="${NAME_MAX}" value="${esc(eng.name)}" autocomplete="off" aria-describedby="eb-rn-err-${id}" />
      <small class="eb__err" id="eb-rn-err-${id}" data-out="rename-err"></small>`;
    li.querySelector<HTMLElement>(".eb__eactions")!.innerHTML = `
      <button type="button" class="btn btn--primary" data-row="rename-ok">Namen speichern</button>
      <button type="button" class="btn" data-row="rename-cancel">Abbrechen</button>`;
    const inp = li.querySelector<HTMLInputElement>("input")!;
    inp.focus();
    inp.select();
  }

  private confirmDelete(li: HTMLElement, eng: StoredEngine) {
    li.querySelector<HTMLElement>(".eb__eactions")!.innerHTML = `
      <p class="eb__confirm" id="eb-del-${esc(eng.id)}">„${esc(eng.name)}“ wirklich löschen? Das lässt sich nicht rückgängig machen.</p>
      <button type="button" class="btn eb__danger" data-row="delete-ok" aria-describedby="eb-del-${esc(eng.id)}">Löschen</button>
      <button type="button" class="btn btn--primary" data-row="delete-cancel">Behalten</button>`;
    li.querySelector<HTMLElement>("[data-row=delete-cancel]")!.focus();
  }

  // --- building ----------------------------------------------------------------------------------------------------

  private startNew() {
    const s = startConfig(this.cfg?.fuel ?? "petrol");
    this.openDraft({ step: 0, config: s.config, customName: false });
  }

  private openDraft(d: BuilderDraft) {
    this.cfg = d.config;
    this.customName = d.customName;
    this.editingId = d.editingId;
    this.baseId = d.baseId;
    this.savedId = null;
    this.reached = d.editingId ? STEP_COUNT - 1 : d.step;
    this.bench.load(this.cfg, this.customName);
    this.cfg = this.bench.config;
    this.fillBasis();
    this.setView("build");
    this.go(d.step);
  }

  /** New start point (fuel or template): the whole config is replaced, the name follows it unless typed. */
  private applyStart(fuel: FuelKind, baseId: string | undefined) {
    const s = startConfig(fuel, baseId);
    this.baseId = baseId;
    const typed = this.customName ? this.cfg.name : null;
    this.bench.load(typed ? { ...s.config, name: typed } : s.config, !!typed);
    this.cfg = this.bench.config;
    this.fillBasis();
  }

  private setName(value: string) {
    const name = value.replace(/\s+/g, " ").trim();
    this.customName = name !== "";
    this.bench.load({ ...this.cfg, name: name || autoName(this.cfg) }, this.customName);
    this.cfg = this.bench.config;
    // keep both name fields (Grundlage and Fertig) in step without disturbing the one being typed in
    for (const inp of this.el.querySelectorAll<HTMLInputElement>("input[data-control=name]")) if (inp !== document.activeElement) inp.value = this.customName ? this.cfg.name : "";
  }

  private fillBasis() {
    for (const r of this.el.querySelectorAll<HTMLInputElement>("input[name=eb-fuel]")) r.checked = r.value === this.cfg.fuel;
    for (const inp of this.el.querySelectorAll<HTMLInputElement>("input[data-control=name]")) {
      inp.value = this.customName ? this.cfg.name : "";
      inp.placeholder = autoName(this.cfg);
    }
    const base = this.q<HTMLSelectElement>("[data-control=base]");
    const mine = loadMyEngines().filter((m) => m.id !== this.editingId);
    const group = (label: string, items: { id: string; name: string }[]) =>
      items.length ? `<optgroup label="${esc(label)}">${items.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("")}</optgroup>` : "";
    const lib = (pick: (e: (typeof ENGINE_LIBRARY)[number]) => boolean) => ENGINE_LIBRARY.filter(pick).map((e) => ({ id: e.config.id, name: `${e.config.name}${e.cars ? ` – ${e.cars}` : ""}` }));
    base.innerHTML = `<option value="">Grundausstattung (${this.cfg.fuel === "diesel" ? "Diesel" : "Benziner"})</option>`
      + group("Eigene Motoren", mine.map((m) => ({ id: m.id, name: m.name })))
      + group("Diesel", lib((e) => (e.category ?? "car") === "car" && e.config.fuel === "diesel"))
      + group("Benziner", lib((e) => (e.category ?? "car") === "car" && e.config.fuel === "petrol"))
      + group("Lkw & Bus", lib((e) => e.category === "commercial"))
      + group("Motorrad", lib((e) => e.category === "motorcycle"));
    base.value = this.baseId && [...base.options].some((o) => o.value === this.baseId) ? this.baseId : "";
  }

  /** Any change on the current build: summary (once per frame), option infos, draft. */
  private changed() {
    if (this.savedId) {
      // edited after saving: the next save overwrites that engine
      this.editingId = this.savedId;
      this.savedId = null;
      this.q<HTMLElement>("[data-out=saved]").hidden = true;
    }
    this.syncInfos();
    this.q<HTMLElement>("[data-out=blockers]").hidden = true;
    cancelAnimationFrame(this.statsRaf);
    this.statsRaf = requestAnimationFrame(() => this.renderStats());
    this.persist();
  }

  private persist() {
    saveDraft({ step: this.step, config: this.cfg, customName: this.customName, editingId: this.editingId, baseId: this.baseId });
  }

  private go(i: number, field?: string) {
    const n = Math.max(0, Math.min(STEP_COUNT - 1, i));
    this.step = n;
    this.reached = Math.max(this.reached, n);
    this.q<HTMLElement>("[data-out=saved]").hidden = !this.savedId || STEPS[n]!.id !== "finish";
    this.syncStep();
    this.persist();
    window.scrollTo?.(0, 0);
    if (field) this.focusField(field);
    else this.q<HTMLElement>("#eb-step-h").focus();
  }

  private syncStep() {
    const s = STEPS[this.step]!;
    this.q("#eb-step-h").textContent = s.title;
    this.q("[data-out=progress]").textContent = `Schritt ${this.step + 1} von ${STEP_COUNT}`;
    this.q("[data-out=intro]").textContent = s.intro;
    this.q<HTMLElement>("[data-part=basis]").hidden = s.id !== "basis";
    this.q<HTMLElement>("[data-part=bench]").hidden = s.groups.length === 0;
    this.q<HTMLElement>("[data-part=finish]").hidden = s.id !== "finish";
    this.q<HTMLElement>("[data-out=blockers]").hidden = true;
    if (s.groups.length) this.bench.setGroups(s.groups);
    this.el.querySelectorAll<HTMLButtonElement>("[data-goto]").forEach((b) => {
      const i = Number(b.dataset.goto);
      const state = i === this.step ? "current" : i <= this.reached ? "done" : "todo";
      b.dataset.state = state;
      b.disabled = i > this.reached;
      if (i === this.step) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
      b.querySelector("[data-mark]")!.textContent = state === "current" ? " (aktueller Schritt)" : state === "done" ? " (erreicht)" : " (noch nicht erreicht)";
    });
    this.q<HTMLButtonElement>("[data-nav=back]").hidden = this.step === 0;
    const next = this.q<HTMLButtonElement>("[data-nav=next]");
    next.textContent = s.id === "finish" ? (this.editingId ? "Änderungen speichern" : "Speichern") : "Weiter";
    if (s.id === "basis") this.fillBasis();
    this.syncInfos();
    this.renderStats();
  }

  private next() {
    const s = STEPS[this.step]!;
    const stats = builderStats(this.cfg);
    const blockers = s.id === "finish" ? [] : stepBlockers(stats.warnings, s.id);
    if (blockers.length) return this.showBlockers(blockers, "Bitte zuerst beheben, dann geht es weiter:");
    if (s.id === "finish") return this.save();
    this.go(this.step + 1);
  }

  private showBlockers(list: Warning[], lead: string) {
    const box = this.q<HTMLElement>("[data-out=blockers]");
    box.innerHTML = `<p class="eb__blockers-h">${esc(lead)}</p><ul>${list.map((w) => {
      const step = stepOfField(w.field);
      const here = step === STEPS[this.step]!.id;
      const label = here ? "Zum Feld" : `Zu „${esc(STEPS[stepIndex(step)]!.title)}“`;
      return `<li><span>${esc(w.message)}</span> ${w.field ? (here ? `<button type="button" class="btn btn--small" data-focus-field="${esc(w.field)}">${label}</button>` : `<button type="button" class="btn btn--small" data-goto-step="${stepIndex(step)}" data-field="${esc(w.field)}">${label}</button>`) : ""}</li>`;
    }).join("")}</ul>`;
    box.querySelectorAll<HTMLButtonElement>("[data-goto-step]").forEach((b) => b.addEventListener("click", () => this.go(Number(b.dataset.gotoStep), b.dataset.field)));
    box.hidden = false;
    box.focus();
  }

  private focusField(path: string) {
    const step = STEPS[this.step]!;
    const row = step.groups.length ? this.bench.el.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`) : null;
    const ctl = row?.querySelector<HTMLElement>('[data-role="control"]') ?? row?.querySelector<HTMLElement>("input, select");
    if (ctl) {
      ctl.scrollIntoView?.({ block: "center" });
      ctl.focus();
    } else this.q<HTMLElement>("#eb-step-h").focus();
  }

  private save() {
    const r = saveMyEngine(this.cfg, { id: this.editingId, name: this.customName ? this.cfg.name : autoName(this.cfg) });
    if (!r.ok) return this.showBlockers(r.critical, r.reason);
    this.savedId = r.engine.id;
    this.editingId = r.engine.id;
    clearDraft();
    const box = this.q<HTMLElement>("[data-out=saved]");
    this.q("#eb-saved-h").textContent = r.stored ? `„${r.engine.name}“ ist gespeichert.` : `„${r.engine.name}“ ist bis zum Schließen der Seite da (der Browser erlaubt kein Speichern).`;
    box.hidden = false;
    this.q<HTMLButtonElement>("[data-nav=next]").textContent = "Änderungen speichern";
    box.focus();
  }

  // --- rev stand ---------------------------------------------------------------------------------------------------

  private openRev(cfg: EngineConfig, from: View, focus: HTMLElement | null) {
    this.revFrom = { view: from, focus };
    this.setView("rev");
    this.stand.open(cfg);
    window.scrollTo?.(0, 0);
    this.stand.heading.focus();
  }

  // --- live output -------------------------------------------------------------------------------------------------

  /** Explanation of the chosen option below each select of the current step (OPTION_INFO). */
  private syncInfos() {
    for (const row of this.bench.el.querySelectorAll<HTMLElement>(".field--select[data-path]")) {
      const path = row.dataset.path!;
      const text = optionInfo(path, getPath(this.cfg, path));
      let p = row.querySelector<HTMLElement>(".field__info");
      const sel = row.querySelector<HTMLSelectElement>("select");
      if (!text || !sel) {
        p?.remove();
        continue;
      }
      if (!p) {
        p = document.createElement("p");
        p.className = "field__info";
        p.id = `${sel.id}-info`;
        row.querySelector(".field__effect")?.after(p);
        const d = sel.getAttribute("aria-describedby") ?? "";
        if (!d.includes(p.id)) sel.setAttribute("aria-describedby", `${d} ${p.id}`.trim());
      }
      if (p.textContent !== text) p.textContent = text;
    }
  }

  private renderStats() {
    const st = builderStats(this.cfg);
    const set = (k: string, v: string) => {
      const el = this.q(`[data-out=${k}]`);
      if (el.textContent !== v) el.textContent = v;
    };
    set("sum-name", this.cfg.name);
    set("disp", fmtQ("volume", st.displacementL, prefs().volume === "l" ? 2 : 0));
    set("kw", Number.isFinite(st.peakPowerKw) ? `${fmtQ("power", st.peakPowerKw)} bei ${fmt(st.peakPowerRpm)}` : "–");
    set("nm", Number.isFinite(st.peakTorqueNm) ? `${fmtQ("torque", st.peakTorqueNm)} bei ${fmt(st.peakTorqueRpm)}` : "–");
    set("bs", `${fmt(st.boreStrokeRatio, 2)} (${st.boreStrokeLabel})`);
    set("cm", `${fmt(st.pistonSpeedMs, 1)} m/s`);
    this.q("[data-out=cm]").classList.toggle("is-limit", st.pistonSpeedMs > st.pistonSpeedMaxMs);
    set("cr", `${fmt(st.compressionRatio, 1)} : 1`);
    set("kg", Number.isFinite(st.massKg) ? `${fmt(st.massKg)} kg` : "–");
    const crit = st.warnings.filter((w) => w.severity === "critical").length;
    const warn = st.warnings.filter((w) => w.severity === "warning").length;
    set("warn", crit ? `${crit} kritisch${warn ? `, ${warn} Warnung${warn > 1 ? "en" : ""}` : ""}` : warn ? `${warn} Warnung${warn > 1 ? "en" : ""}` : "keine");
    this.q("[data-out=warn]").className = crit ? "is-critical" : warn ? "is-limit" : "";
    if (STEPS[this.step]!.id === "finish") this.renderFinish(st);
  }

  private renderFinish(st: BuilderStats) {
    try {
      this.nameplate.update(this.cfg, summarize(this.cfg));
    } catch {
      /* the figures above stay */
    }
    this.q("[data-out=curve]").innerHTML = curveSvg(this.cfg, st);
    const order = { critical: 0, warning: 1, info: 2 } as const;
    const ws = [...st.warnings].sort((a, b) => order[a.severity] - order[b.severity]);
    this.q("[data-out=findings]").innerHTML = ws.length
      ? ws.map((w) => {
          const step = stepOfField(w.field);
          return `<li class="note note--${w.severity}"><b>${SEVERITY_LABEL[w.severity]}:</b> ${esc(w.message)} <button type="button" class="btn btn--small" data-goto-step="${stepIndex(step)}" data-field="${esc(w.field ?? "")}">Zu „${esc(STEPS[stepIndex(step)]!.title)}“</button></li>`;
        }).join("")
      : `<li class="note note--ok">Keine Beanstandungen. Der Motor ist bereit für den Prüfstand.</li>`;
  }
}

/** Full-load curve (torque and power over rpm) as an inline SVG from the core's dyno sweep. */
function curveSvg(cfg: EngineConfig, st: BuilderStats): string {
  let pts: { rpm: number; torqueNm: number; powerKw: number }[] = [];
  try {
    pts = dynoSweep(cfg, { fromRpm: Math.min(1000, cfg.idleRpm), stepRpm: 100 });
  } catch {
    pts = [];
  }
  if (pts.length < 2) return `<figcaption>Keine Kurve berechenbar.</figcaption>`;
  const W = 320;
  const H = 150;
  const x0 = pts[0]!.rpm;
  const x1 = pts[pts.length - 1]!.rpm;
  const tMax = Math.max(...pts.map((p) => p.torqueNm)) * 1.1 || 1;
  const pMax = Math.max(...pts.map((p) => p.powerKw)) * 1.1 || 1;
  const x = (r: number) => 8 + ((r - x0) / Math.max(1, x1 - x0)) * (W - 16);
  const line = (k: "torqueNm" | "powerKw", max: number) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.rpm).toFixed(1)} ${(H - 6 - (Math.max(0, p[k]) / max) * (H - 14)).toFixed(1)}`).join("");
  const label = `Volllastkurve: höchstens ${fmtQ("torque", st.peakTorqueNm)} bei ${fmt(st.peakTorqueRpm)} und ${fmtQ("power", st.peakPowerKw)} bei ${fmt(st.peakPowerRpm)} Umdrehungen pro Minute.`;
  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" class="eb__svg">
      <path class="eb__grid-line" d="M8 ${H - 6}H${W - 8}" />
      <path class="eb__torque" d="${line("torqueNm", tMax)}" />
      <path class="eb__power" d="${line("powerKw", pMax)}" />
    </svg>
    <p class="eb__axis num" aria-hidden="true"><span>${fmt(x0)}</span><span>${fmt(x1)} 1/min</span></p>
    <figcaption><span class="eb__key eb__key--torque">Drehmoment ${esc(fmtQ("torque", st.peakTorqueNm))}</span> <span class="eb__key eb__key--power">Leistung ${esc(fmtQ("power", st.peakPowerKw))}</span></figcaption>`;
}
