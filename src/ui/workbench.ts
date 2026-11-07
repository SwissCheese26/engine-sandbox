// Werkbank: aluminium plates per group with every EngineConfig parameter.
// Number fields get a slider plus a typed value; each field shows unit and an effect line.
import { validateConfig } from "../core/index.ts";
import type { EngineConfig, FuelKind, Warning } from "../core/index.ts";
import { defaultConfig } from "../data/presets.ts";
import { ENGINE_LIBRARY, libraryConfig } from "../data/engine-library.ts";
import type { LibraryEngine } from "../data/engine-library.ts";
import { STAGE_LABELS, applyTuningStage, tuningWarnings } from "../data/tuning.ts";
import type { TuningStage } from "../data/tuning.ts";
import { FIELDS, GROUPS, getPath, isVisible, setPath } from "./fields.ts";
import type { Field } from "./fields.ts";
import { clamp, fmt, parseNumber, snap } from "./format.ts";
import { autoName } from "./names.ts";
import { prefs, type Quantity } from "./settings.ts";
import { fmtQ, fromUnit, toUnit } from "./units.ts";

/** How a number field is shown and typed: in the globally chosen unit (#24), stored in its own unit (SI). */
interface View {
  unit: string;
  decimals: number;
  show: (v: number) => number;
  read: (shown: number) => number;
}

function view(f: { unit: string; decimals: number; scale?: number; q?: Quantity }): View {
  const sc = f.scale ?? 1;
  const u = f.q ? prefs()[f.q] : f.unit;
  if (!f.q || u === f.unit) return { unit: f.unit, decimals: f.decimals, show: (v) => v * sc, read: (x) => x / sc };
  const q = f.q;
  const decimals = u === "in" ? Math.max(2, f.decimals + 1) : u === "psi" ? Math.max(0, f.decimals - 1) : u === "kPa" ? Math.max(0, f.decimals - 2) : u === "kpm" ? 1 : f.decimals;
  return { unit: u, decimals, show: (v) => toUnit(q, v, u), read: (x) => fromUnit(q, x, u) };
}

type Listener = (cfg: EngineConfig) => void;

let uid = 0;

export class Workbench {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private fuelInputs: HTMLInputElement[] = [];
  private notes: HTMLElement;
  private cfg: EngineConfig;
  private signature = "";
  private listeners: Listener[] = [];
  private locked = false;
  /** True once the user typed an own name; until then the name follows the configuration. */
  private customName = false;
  /** Set by the app: a production engine was picked from the library select (#15) – the matching car follows. */
  onLibraryLoad: (id: string) => void = () => {};
  private lockNote: HTMLElement;
  /** Tuning (#16): production config the stages are computed from (null while at "Serie"). */
  private tuneBase: { cfg: EngineConfig; customName: boolean } | null = null;
  private stage: TuningStage = 0;
  private forged = true;
  /** Values were changed by hand while a stage is active (shown as "Stage n (angepasst)"). */
  private tunedDirty = false;
  private tuneChanges: string[] = [];
  /** One-shot hint after a stage change discarded manual edits. */
  private discardNote = "";
  private tuning!: HTMLElement;

  constructor(initial: EngineConfig) {
    this.cfg = structuredClone(initial);
    this.el = document.createElement("aside");
    this.el.className = "bench";
    this.el.id = "werkbank";
    this.el.setAttribute("aria-label", "Werkbank");
    const head = document.createElement("div");
    head.className = "bench__head";
    head.innerHTML = `
      <h2 class="bench__title">Werkbank</h2>
      <fieldset class="fuel-switch">
        <legend class="sr-only">Kraftstoff</legend>
        <label><input type="radio" name="fuel" value="diesel" /><span>Diesel</span></label>
        <label><input type="radio" name="fuel" value="petrol" /><span>Benziner</span></label>
      </fieldset>
      <p class="bench__hint">Ein Wechsel lädt die Grundausstattung für diesen Kraftstoff.</p>
      <div class="bench__tools">
        <button type="button" class="btn btn--small" data-action="preset">Grundausstattung laden</button>
      </div>
      <label class="bench__library"><span>Serienmotor laden</span>
        <select data-action="library"><option value="">Motor wählen …</option>${([["Diesel", (e: LibraryEngine) => e.category !== "motorcycle" && e.config.fuel === "diesel"], ["Benziner", (e: LibraryEngine) => e.category !== "motorcycle" && e.config.fuel === "petrol"], ["Motorrad", (e: LibraryEngine) => e.category === "motorcycle"]] as const).map(([label, pick]) => `<optgroup label="${label}">${ENGINE_LIBRARY.filter(pick).map((e) => `<option value="${e.config.id}">${e.config.name}</option>`).join("")}</optgroup>`).join("")}</select>
      </label>
      <p class="bench__libinfo" hidden></p>
      <p class="bench__lock" role="status" aria-live="polite" hidden>Zum Umbauen Motor abstellen: Zündung aus mit <kbd>I</kbd>.</p>
      <div class="bench__notes" role="status" aria-live="polite"></div>`;
    this.notes = head.querySelector(".bench__notes")!;
    this.lockNote = head.querySelector(".bench__lock")!;
    this.fuelInputs = [...head.querySelectorAll<HTMLInputElement>('input[name="fuel"]')];
    for (const r of this.fuelInputs) {
      r.addEventListener("change", () => {
        if (r.checked) this.loadPreset(r.value as FuelKind);
      });
    }
    head.querySelector('[data-action="preset"]')!.addEventListener("click", () => this.loadPreset(this.cfg.fuel));
    const lib = head.querySelector<HTMLSelectElement>('[data-action="library"]')!;
    const libInfo = head.querySelector<HTMLElement>(".bench__libinfo")!;
    lib.addEventListener("change", () => {
      const e = ENGINE_LIBRARY.find((x) => x.config.id === lib.value);
      if (!e || this.locked) {
        lib.value = "";
        return;
      }
      this.loadLibrary(e.config.id);
      this.onLibraryLoad(e.config.id);
      libInfo.textContent = `${e.maker}, ${e.years}: ${e.cars}. Werk: ${fmtQ("power", e.expected.peakPowerKw)}, ${fmtQ("torque", e.expected.peakTorqueNm)}. Alle Werte sind danach frei veränderbar.`;
      libInfo.hidden = false;
      lib.value = "";
    });
    this.body = document.createElement("div");
    this.body.className = "bench__plates";
    this.tuning = this.buildTuning();
    this.el.append(head, this.tuning, this.body);
    this.cfg.name = autoName(this.cfg);
    this.render();
  }

  onChange(cb: Listener) {
    this.listeners.push(cb);
  }

  get config(): EngineConfig {
    return this.cfg;
  }

  /**
   * Like on a real test bench the engine is only rebuilt while it stands still. While it runs every
   * control on the bench is disabled (the plates stay readable) and a hint says how to unlock.
   */
  setLocked(locked: boolean) {
    if (locked === this.locked) return;
    this.locked = locked;
    this.el.classList.toggle("is-locked", locked);
    this.lockNote.hidden = !locked;
    for (const c of this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
      c.disabled = locked || c.dataset.fixedDisabled === "1";
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** Loads a production engine from the library (#15); its name is kept until the player renames it. */
  loadLibrary(id: string) {
    if (this.locked) return;
    this.customName = true;
    this.resetTuning();
    this.apply(libraryConfig(id));
  }

  loadPreset(fuel: FuelKind) {
    if (this.locked) return;
    this.customName = false;
    this.resetTuning();
    this.apply(defaultConfig(fuel));
  }

  private apply(next: EngineConfig) {
    if (this.locked) {
      this.sync();
      return;
    }
    if (!this.customName) next.name = autoName(next);
    this.cfg = next;
    this.render();
    for (const l of this.listeners) l(this.cfg);
  }

  private set(path: string, value: unknown) {
    if (path === "name") {
      const name = String(value).trim();
      this.customName = name !== "" && name !== autoName(this.cfg);
      this.apply(setPath(this.cfg, path, this.customName ? name : autoName(this.cfg)));
      return;
    }
    this.apply(setPath(this.cfg, path, value));
    if (this.stage > 0 && !this.tunedDirty) {
      this.tunedDirty = true;
      this.discardNote = "";
      this.syncTuning(this.tuneChanges);
    }
  }

  private sig(): string {
    return FIELDS.filter((f) => isVisible(f, this.cfg))
      .map((f) => {
        if (f.kind === "select") return f.path + ":" + f.options(this.cfg).map((o) => o.value).join("|");
        if (f.kind === "choice-number") return f.path + ":" + f.values(this.cfg).join("|");
        if (f.kind === "number") {
          const r = f.range(this.cfg);
          return `${f.path}:${r.min}-${r.max}`;
        }
        return f.path;
      })
      .join(";");
  }

  /** Global unit setting changed (#24): rebuild the plates so units, ranges and values follow. */
  syncUnits() {
    this.signature = "";
    this.render();
  }

  private render() {
    for (const r of this.fuelInputs) r.checked = r.value === this.cfg.fuel;
    const sig = this.sig();
    if (sig !== this.signature) {
      const active = document.activeElement as HTMLElement | null;
      const focusPath = active?.closest<HTMLElement>("[data-path]")?.dataset.path;
      const focusRole = active?.dataset.role;
      this.build();
      this.signature = sig;
      if (focusPath) {
        const sel = `[data-path="${focusPath}"] [data-role="${focusRole ?? "control"}"]`;
        (this.body.querySelector<HTMLElement>(sel) ?? this.body.querySelector<HTMLElement>(`[data-path="${focusPath}"] input, [data-path="${focusPath}"] select`))?.focus();
      }
    }
    this.sync();
  }

  private build() {
    this.body.replaceChildren();
    for (const g of GROUPS) {
      const fields = FIELDS.filter((f) => f.group === g.id && isVisible(f, this.cfg));
      if (fields.length === 0) continue;
      const plate = document.createElement("section");
      plate.className = "plate";
      plate.dataset.group = g.id;
      const hid = `plate-${g.id}`;
      plate.setAttribute("aria-labelledby", hid);
      plate.innerHTML = `<span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span><span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>`;
      const h = document.createElement("h3");
      h.className = "plate__title";
      h.id = hid;
      h.textContent = g.title;
      const p = document.createElement("p");
      p.className = "plate__effect";
      p.textContent = g.effect;
      plate.append(h, p);
      for (const f of fields) plate.append(this.buildField(f));
      this.body.append(plate);
    }
  }

  private buildField(f: Field): HTMLElement {
    const id = `f${++uid}`;
    const row = document.createElement("div");
    row.className = `field field--${f.kind}`;
    row.dataset.path = f.path;
    const effect = document.createElement("p");
    effect.className = "field__effect";
    effect.id = `${id}-fx`;
    effect.textContent = f.effect;
    const warn = document.createElement("p");
    warn.className = "field__warn";
    warn.id = `${id}-w`;
    warn.hidden = true;
    const label = document.createElement("label");
    label.className = "field__label";
    label.htmlFor = id;
    label.textContent = f.label;
    const describe = `${id}-fx ${id}-w`;

    switch (f.kind) {
      case "number": {
        const r = f.range(this.cfg);
        const vw = view(f);
        const slider = document.createElement("input");
        slider.type = "range";
        slider.id = id;
        slider.dataset.role = "control";
        slider.min = String(r.min);
        slider.max = String(r.max);
        slider.step = String(r.step);
        slider.setAttribute("aria-describedby", describe);
        const val = document.createElement("input");
        val.type = "text";
        val.inputMode = "decimal";
        val.className = "num field__num";
        val.dataset.role = "value";
        val.setAttribute("aria-label", `${f.label} in ${vw.unit || "Einheiten"}`);
        const unit = document.createElement("span");
        unit.className = "field__unit";
        unit.textContent = vw.unit;
        slider.addEventListener("input", () => this.set(f.path, Number(slider.value)));
        const commit = () => {
          const rr = f.range(this.cfg);
          const raw = parseNumber(val.value, { min: vw.show(rr.min), max: vw.show(rr.max) });
          if (!Number.isFinite(raw)) {
            this.sync();
            return;
          }
          // typed in the shown unit, stored in the field's own unit
          const next = snap(clamp(vw.read(raw), rr.min, rr.max), rr.min, rr.step);
          this.set(f.path, next);
          // show the accepted value in the field's own format, also while it keeps focus
          val.value = fmt(vw.show(getPath(this.cfg, f.path) as number), vw.decimals);
        };
        val.addEventListener("change", commit);
        val.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
        });
        const valWrap = document.createElement("span");
        valWrap.className = "field__value";
        valWrap.append(val, unit);
        const range = document.createElement("span");
        range.className = "field__range num";
        range.setAttribute("aria-hidden", "true");
        range.textContent = `${fmt(vw.show(r.min), vw.decimals)} – ${fmt(vw.show(r.max), vw.decimals)}`;
        row.append(label, valWrap, slider, range, effect, warn);
        break;
      }
      case "optional-number": {
        const r = f.range(this.cfg);
        const on = document.createElement("input");
        on.type = "checkbox";
        on.className = "switch";
        on.id = id;
        on.dataset.role = "control";
        on.setAttribute("role", "switch");
        on.setAttribute("aria-describedby", describe);
        const state = document.createElement("span");
        state.className = "field__state";
        state.setAttribute("aria-hidden", "true");
        const slider = document.createElement("input");
        slider.type = "range";
        slider.dataset.role = "slider";
        slider.min = String(r.min);
        slider.max = String(r.max);
        slider.step = String(r.step);
        slider.setAttribute("aria-label", f.label);
        const val = document.createElement("input");
        val.type = "text";
        val.inputMode = "decimal";
        val.className = "num field__num";
        val.dataset.role = "value";
        const vw = view(f);
        val.setAttribute("aria-label", `${f.label} in ${vw.unit}`);
        const unit = document.createElement("span");
        unit.className = "field__unit";
        unit.textContent = vw.unit;
        on.addEventListener("change", () => this.set(f.path, on.checked ? f.defaultOn(this.cfg) : undefined));
        slider.addEventListener("input", () => this.set(f.path, Number(slider.value)));
        const commit = () => {
          const rr = f.range(this.cfg);
          const raw = parseNumber(val.value, { min: vw.show(rr.min), max: vw.show(rr.max) });
          if (!Number.isFinite(raw)) return this.sync();
          this.set(f.path, snap(clamp(vw.read(raw), rr.min, rr.max), rr.min, rr.step));
        };
        val.addEventListener("change", commit);
        val.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
        });
        const valWrap = document.createElement("span");
        valWrap.className = "field__value";
        valWrap.append(val, unit);
        row.append(label, on, state, valWrap, slider, effect, warn);
        break;
      }
      case "choice-number": {
        const values = f.values(this.cfg);
        const group = document.createElement("div");
        group.className = "seg";
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-labelledby", `${id}-l`);
        group.setAttribute("aria-describedby", describe);
        label.id = `${id}-l`;
        label.removeAttribute("for");
        const lab = document.createElement("span");
        lab.className = label.className;
        lab.id = label.id;
        lab.textContent = label.textContent;
        for (const v of values) {
          const l = document.createElement("label");
          l.className = "seg__opt";
          const inp = document.createElement("input");
          inp.type = "radio";
          inp.name = id;
          inp.value = String(v);
          inp.dataset.role = "control";
          inp.addEventListener("change", () => inp.checked && this.set(f.path, v));
          const s = document.createElement("span");
          s.className = "num";
          s.textContent = String(v);
          l.append(inp, s);
          group.append(l);
        }
        row.append(lab, group, effect, warn);
        break;
      }
      case "select": {
        const sel = document.createElement("select");
        sel.id = id;
        sel.dataset.role = "control";
        sel.setAttribute("aria-describedby", describe);
        for (const o of f.options(this.cfg)) {
          const opt = document.createElement("option");
          opt.value = o.value;
          opt.textContent = o.label;
          sel.append(opt);
        }
        sel.addEventListener("change", () => this.set(f.path, sel.value));
        row.append(label, sel, effect, warn);
        break;
      }
      case "toggle": {
        const inp = document.createElement("input");
        inp.type = "checkbox";
        inp.id = id;
        inp.className = "switch";
        inp.dataset.role = "control";
        inp.setAttribute("role", "switch");
        inp.setAttribute("aria-describedby", describe);
        inp.addEventListener("change", () => this.set(f.path, inp.checked));
        const state = document.createElement("span");
        state.className = "field__state";
        state.setAttribute("aria-hidden", "true");
        row.append(label, inp, state, effect, warn);
        break;
      }
      case "text": {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.id = id;
        inp.maxLength = 48;
        inp.dataset.role = "control";
        inp.setAttribute("aria-describedby", describe);
        inp.placeholder = "Leer lassen für automatischen Namen";
        inp.addEventListener("change", () => this.set(f.path, inp.value));
        row.append(label, inp, effect, warn);
        break;
      }
    }
    return row;
  }

  /** Back to "Serie" without touching the config (a new engine was loaded). */
  private resetTuning() {
    this.tuneBase = null;
    this.stage = 0;
    this.tunedDirty = false;
    this.discardNote = "";
    this.syncTuning([]);
  }

  /**
   * Tuning plate (#16): Serie / Stage 1 / 2 / 3. Every stage is computed from the remembered production config,
   * so "Serie" leads back; all values stay individually adjustable afterwards.
   */
  private buildTuning(): HTMLElement {
    const plate = document.createElement("section");
    plate.className = "plate plate--tuning";
    plate.dataset.group = "tuning";
    plate.setAttribute("aria-labelledby", "plate-tuning");
    plate.innerHTML = `<span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span><span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>
      <h3 class="plate__title" id="plate-tuning">Tuning</h3>
      <p class="plate__effect">Stufen ändern mehrere Werte gemeinsam, ausgehend vom geladenen Serienmotor. Danach bleibt alles einzeln einstellbar.</p>
      <div class="field field--choice-number">
        <span class="field__label" id="tuning-l">Stufe</span>
        <div class="seg" role="radiogroup" aria-labelledby="tuning-l">${([0, 1, 2, 3] as const).map((n) => `<label class="seg__opt"><input type="radio" name="tuning-stage" value="${n}" data-role="control" /><span>${STAGE_LABELS[n]}</span></label>`).join("")}</div>
      </div>
      <div class="field field--toggle">
        <label class="field__label" for="tuning-forged">Stage 3 mit geschmiedeten Kolben und Pleueln</label>
        <input type="checkbox" class="switch" role="switch" id="tuning-forged" checked />
        <span class="field__state" aria-hidden="true">Ein</span>
      </div>
      <p class="tuning__status" role="status" aria-live="polite" hidden></p>
      <ul class="tuning__changes" aria-live="polite"></ul>
      <div class="tuning__warn" role="status" aria-live="polite"></div>`;
    for (const r of plate.querySelectorAll<HTMLInputElement>('input[name="tuning-stage"]')) {
      r.addEventListener("change", () => r.checked && this.setStage(Number(r.value) as TuningStage));
    }
    const forged = plate.querySelector<HTMLInputElement>("#tuning-forged")!;
    forged.addEventListener("change", () => {
      this.forged = forged.checked;
      plate.querySelector<HTMLElement>("#tuning-forged + .field__state")!.textContent = forged.checked ? "Ein" : "Aus";
      if (this.stage === 3) this.setStage(3);
    });
    queueMicrotask(() => this.syncTuning([]));
    return plate;
  }

  /** Applies a tuning stage relative to the remembered production config. */
  setStage(stage: TuningStage) {
    if (this.locked) return this.syncTuning([]);
    if (!this.tuneBase) this.tuneBase = { cfg: structuredClone(this.cfg), customName: this.customName };
    const base = this.tuneBase;
    // manual edits on top of a stage are discarded: every stage is recomputed from the production config
    this.discardNote = this.tunedDirty ? "Manuelle Änderungen wurden verworfen – die Stufe rechnet immer vom Serienstand." : "";
    this.tunedDirty = false;
    this.stage = stage;
    let changes: string[];
    let next: EngineConfig;
    if (stage === 0) {
      next = structuredClone(base.cfg);
      changes = [];
      this.customName = base.customName;
      this.tuneBase = null;
    } else {
      const r = applyTuningStage(base.cfg, stage, { forgedInternals: this.forged });
      next = r.config;
      changes = r.changes;
      this.customName = true;
    }
    this.apply(next);
    this.syncTuning(changes);
  }

  private syncTuning(changes: string[]) {
    const t = this.tuning;
    if (!t) return;
    this.tuneChanges = changes;
    for (const r of t.querySelectorAll<HTMLInputElement>('input[name="tuning-stage"]')) {
      const n = Number(r.value) as TuningStage;
      r.checked = n === this.stage;
      r.nextElementSibling!.textContent = STAGE_LABELS[n] + (n === this.stage && this.tunedDirty ? " (angepasst)" : "");
    }
    const status = t.querySelector<HTMLElement>(".tuning__status")!;
    const msg = this.tunedDirty
      ? `${STAGE_LABELS[this.stage]} (angepasst): Ein Stufenwechsel oder „Serie“ verwirft die manuellen Änderungen.`
      : this.discardNote;
    status.textContent = msg;
    status.hidden = msg === "";
    const list = t.querySelector<HTMLElement>(".tuning__changes")!;
    list.replaceChildren(...(changes.length ? changes : ["Serienstand – wähle eine Stufe."]).map((c) => {
      const li = document.createElement("li");
      li.textContent = c;
      return li;
    }));
    const warn = t.querySelector<HTMLElement>(".tuning__warn")!;
    warn.replaceChildren();
    if (this.stage > 0) {
      let ws: Warning[] = [];
      try {
        ws = tuningWarnings(this.cfg, this.stage);
      } catch {
        ws = [];
      }
      for (const w of ws) {
        const p = document.createElement("p");
        p.className = `note note--${w.severity}`;
        p.textContent = w.message;
        warn.append(p);
      }
    }
  }

  /** Writes current values into the existing controls and marks invalid combinations. */
  private sync() {
    const warnings = safeValidate(this.cfg);
    const byCode = new Map<string, Warning>();
    for (const w of warnings) if (!byCode.has(w.code) || w.severity === "critical") byCode.set(w.code, w);
    for (const row of this.body.querySelectorAll<HTMLElement>(".field")) {
      const f = FIELDS.find((x) => x.path === row.dataset.path && isVisible(x, this.cfg));
      if (!f) continue;
      const v = getPath(this.cfg, f.path);
      if (f.kind === "number") {
        const vw = view(f);
        const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
        const val = row.querySelector<HTMLInputElement>(".field__num")!;
        slider.value = String(v);
        slider.setAttribute("aria-valuetext", `${fmt(vw.show(v as number), vw.decimals)} ${vw.unit}`.trim());
        if (document.activeElement !== val) val.value = fmt(vw.show(v as number), vw.decimals);
        const r = f.range(this.cfg);
        row.style.setProperty("--p", String(((v as number) - r.min) / (r.max - r.min)));
      } else if (f.kind === "choice-number") {
        for (const inp of row.querySelectorAll<HTMLInputElement>("input")) inp.checked = Number(inp.value) === v;
      } else if (f.kind === "select") {
        const sel = row.querySelector<HTMLSelectElement>("select")!;
        sel.value = v === undefined ? (f.options(this.cfg)[0]?.value ?? "") : String(v);
      } else if (f.kind === "optional-number") {
        const on = v !== undefined;
        row.querySelector<HTMLInputElement>(".switch")!.checked = on;
        row.querySelector<HTMLElement>(".field__state")!.textContent = on ? "Ein" : "Aus";
        const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
        const val = row.querySelector<HTMLInputElement>(".field__num")!;
        slider.hidden = !on;
        (row.querySelector<HTMLElement>(".field__value")!).hidden = !on;
        if (on) {
          slider.value = String(v);
          const vw = view(f);
          slider.setAttribute("aria-valuetext", `${fmt(vw.show(v as number), vw.decimals)} ${vw.unit}`);
          if (document.activeElement !== val) val.value = fmt(vw.show(v as number), vw.decimals);
          const r = f.range(this.cfg);
          row.style.setProperty("--p", String(((v as number) - r.min) / (r.max - r.min)));
        }
      } else if (f.kind === "toggle") {
        row.querySelector<HTMLInputElement>("input")!.checked = Boolean(v);
        row.querySelector<HTMLElement>(".field__state")!.textContent = v ? "Ein" : "Aus";
      } else if (f.kind === "text") {
        const inp = row.querySelector<HTMLInputElement>("input")!;
        if (document.activeElement !== inp) inp.value = String(v);
      }
      // shown but fixed for this config (e.g. pops on a diesel): control greyed out, hint instead of the effect line
      const hint = f.disabledHint?.(this.cfg);
      row.classList.toggle("is-disabled", Boolean(hint));
      for (const c of row.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) {
        c.dataset.fixedDisabled = hint ? "1" : "";
        c.disabled = this.locked || Boolean(hint);
      }
      row.querySelector<HTMLElement>(".field__effect")!.textContent = hint ?? f.effect;
      const w = (f.warns ?? []).map((c) => byCode.get(c)).find(Boolean);
      const wEl = row.querySelector<HTMLElement>(".field__warn")!;
      row.classList.toggle("is-limit", Boolean(w));
      wEl.hidden = !w;
      wEl.textContent = w ? w.message : "";
    }
    this.notes.replaceChildren();
    for (const w of warnings) {
      const p = document.createElement("p");
      p.className = `note note--${w.severity}`;
      p.textContent = w.message;
      this.notes.append(p);
    }
    this.notes.hidden = warnings.length === 0;
  }
}

function safeValidate(cfg: EngineConfig): Warning[] {
  try {
    return validateConfig(cfg);
  } catch {
    return [];
  }
}
