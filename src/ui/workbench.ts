// Werkbank: aluminium plates per group with every EngineConfig parameter.
// Number fields get a slider plus a typed value; each field shows unit and an effect line.
import { validateConfig } from "../core/index.ts";
import type { EngineConfig, FuelKind, Warning } from "../core/index.ts";
import { defaultConfig } from "../data/presets.ts";
import { FIELDS, GROUPS, getPath, isVisible, setPath } from "./fields.ts";
import type { Field } from "./fields.ts";
import { clamp, fmt, parseNumber, snap } from "./format.ts";
import { autoName } from "./names.ts";

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
  private lockNote: HTMLElement;

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
    this.body = document.createElement("div");
    this.body.className = "bench__plates";
    this.el.append(head, this.body);
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
      c.disabled = locked;
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }

  loadPreset(fuel: FuelKind) {
    if (this.locked) return;
    this.customName = false;
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
        const sc = f.scale ?? 1;
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
        val.setAttribute("aria-label", `${f.label} in ${f.unit || "Einheiten"}`);
        const unit = document.createElement("span");
        unit.className = "field__unit";
        unit.textContent = f.unit;
        slider.addEventListener("input", () => this.set(f.path, Number(slider.value)));
        const commit = () => {
          const rr = f.range(this.cfg);
          const raw = parseNumber(val.value, { min: rr.min * sc, max: rr.max * sc });
          if (!Number.isFinite(raw)) {
            this.sync();
            return;
          }
          const next = snap(clamp(raw / sc, rr.min, rr.max), rr.min, rr.step);
          this.set(f.path, next);
          // show the accepted value in the field's own format, also while it keeps focus
          const cur = (getPath(this.cfg, f.path) as number) * sc;
          val.value = fmt(cur, f.decimals);
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
        range.textContent = `${fmt(r.min * sc, f.decimals)} – ${fmt(r.max * sc, f.decimals)}`;
        row.append(label, valWrap, slider, range, effect, warn);
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
        const sc = f.scale ?? 1;
        const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
        const val = row.querySelector<HTMLInputElement>(".field__num")!;
        slider.value = String(v);
        slider.setAttribute("aria-valuetext", `${fmt((v as number) * sc, f.decimals)} ${f.unit}`.trim());
        if (document.activeElement !== val) val.value = fmt((v as number) * sc, f.decimals);
        const r = f.range(this.cfg);
        row.style.setProperty("--p", String(((v as number) - r.min) / (r.max - r.min)));
      } else if (f.kind === "choice-number") {
        for (const inp of row.querySelectorAll<HTMLInputElement>("input")) inp.checked = Number(inp.value) === v;
      } else if (f.kind === "select") {
        row.querySelector<HTMLSelectElement>("select")!.value = String(v);
      } else if (f.kind === "toggle") {
        row.querySelector<HTMLInputElement>("input")!.checked = Boolean(v);
        row.querySelector<HTMLElement>(".field__state")!.textContent = v ? "Ein" : "Aus";
      } else if (f.kind === "text") {
        const inp = row.querySelector<HTMLInputElement>("input")!;
        if (document.activeElement !== inp) inp.value = String(v);
      }
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
