// Werkbank, Elektroantrieb (#108, review of #115): the E-Tuner as plates of the Werkbank. It replaces the combustion
// plates while an electric car is loaded and uses the same field rows (label, slider, value, unit, effect line) and
// a summary plate. The tuning is applied at standstill and stored per vehicle by the app (ev-tuning-store.ts).
import type { LibraryCar } from "../data/vehicle-library.ts";
import { LIMIT_LABEL, PS_PER_KW, estimateEvAsync, evTuningOf, maxTuning, tuneEv, type EvTuning, type MotorAxleKey, type TunedEv } from "../data/ev-tuning.ts";
import { EV_FIELDS, EV_GROUPS, formValue, readForm, type EvField } from "./ev-fields.ts";
import { clamp, fmt, parseNumber, snap } from "./format.ts";
import { prefs } from "./settings.ts";
import { rangeText } from "./layouts/ev-logic.ts";

const SCREWS = `<span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span><span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>`;
let uid = 0;

export class EvBench {
  readonly el: HTMLElement;
  private values: Partial<Record<keyof EvTuning, string>> = {};
  private rows = new Map<keyof EvTuning, HTMLElement>();
  private out: Record<string, HTMLElement> = {};
  private car: LibraryCar | null = null;
  private preview: TunedEv | null = null;
  /** Rotor speed limit of the tuned car in its top gear, km/h (upper end of the Vmax limiter). */
  private rpmVmax = Infinity;
  private estTimer = 0;
  private estRun: { cancel(): void } | null = null;
  /** Set by the app: apply a tuned configuration (mass, tyre, stored per vehicle); false while the car moves. */
  onTune: (t: TunedEv, massKg: number) => boolean = () => false;
  /** Set by the app: "Auf Werkszustand" (forget the tuning of this vehicle); false while the car moves. */
  onFactory: () => boolean = () => false;

  constructor() {
    const el = document.createElement("div");
    el.className = "bench__plates evb";
    el.hidden = true;
    for (const g of EV_GROUPS) {
      const plate = document.createElement("section");
      plate.className = "plate";
      plate.dataset.group = `ev-${g.id}`;
      plate.setAttribute("aria-labelledby", `plate-ev-${g.id}`);
      plate.innerHTML = `${SCREWS}<h3 class="plate__title" id="plate-ev-${g.id}">${g.title}</h3><p class="plate__effect">${g.effect}</p>`;
      for (const f of EV_FIELDS.filter((x) => x.group === g.id)) plate.append(this.field(f));
      el.append(plate);
    }
    const sum = document.createElement("section");
    sum.className = "plate evb__summary";
    sum.dataset.group = "ev-summary";
    sum.setAttribute("aria-labelledby", "plate-ev-summary");
    sum.innerHTML = `${SCREWS}<h3 class="plate__title" id="plate-ev-summary">Zusammenfassung</h3>
      <dl class="evb__sum num" aria-live="polite">
        <div><dt>Systemleistung</dt><dd data-o="power">–</dd></div>
        <div><dt>Je Motor</dt><dd data-o="motor">–</dd></div>
        <div><dt>Wechselrichter</dt><dd data-o="inverter">–</dd></div>
        <div><dt>Begrenzt durch</dt><dd data-o="limit">–</dd></div>
        <div><dt>Vmax</dt><dd data-o="vmax">–</dd></div>
        <div><dt>0–100 km/h</dt><dd data-o="t100">–</dd></div>
        <div><dt>Reichweite</dt><dd data-o="range">–</dd></div>
        <div><dt>Masse</dt><dd data-o="mass">–</dd></div>
      </dl>
      <p class="evb__note" data-o="note" role="status"></p>
      <div class="evb__btns">
        <button type="button" class="btn btn--small" data-control="tune-max">Maximum</button>
        <button type="button" class="btn btn--small" data-control="tune-reset">Auf Werkszustand</button>
      </div>`;
    el.append(sum);
    sum.querySelectorAll<HTMLElement>("[data-o]").forEach((n) => (this.out[n.dataset.o!] = n));
    sum.querySelector("[data-control=tune-max]")!.addEventListener("click", () => {
      this.fill(maxTuning());
      this.scheduleApply();
    });
    sum.querySelector("[data-control=tune-reset]")!.addEventListener("click", () => {
      this.put("note", this.onFactory() ? "Werkszustand." : "Erst anhalten, dann lässt sich das Auto zurücksetzen.");
    });
    this.el = el;
  }

  /** The loaded electric car and the tuning it carries now, or null for a combustion car. */
  setCar(car: LibraryCar | null, tuning?: EvTuning) {
    this.car = car?.setup.ev ? car : null;
    this.el.hidden = !this.car;
    if (this.car) {
      this.put("note", "");
      this.fill(tuning ?? this.factory());
    }
  }

  /** The tuning shown in the form (validated). */
  read(keep?: MotorAxleKey): EvTuning {
    // the rotor speed limit depends on ratios and motors, not on the limiter: computed first, then the limiter read
    const f = this.factory();
    this.rpmVmax = tuneEv(this.car!.setup.ev!, readForm(this.values, f, Infinity, keep), this.radius()).rpmVmaxKmh;
    return readForm(this.values, f, this.rpmVmax, keep);
  }

  private factory(): EvTuning {
    return evTuningOf(this.car!.setup.ev!, this.car!.setup.tyre.type, this.car!.setup.speedLimitKmh);
  }

  private radius(): number {
    return this.car!.setup.vehicle.wheelRadiusM;
  }

  /** Upper end of a number field (the Vmax limiter ends at the rotor speed limit). */
  private maxOf(f: EvField & { kind: "number" }): number {
    return f.maxIsRpmLimit ? Math.max(f.min, Math.floor(Math.min(f.max, this.rpmVmax) / f.step) * f.step) : f.max;
  }

  private field(f: EvField): HTMLElement {
    const id = `evf${++uid}`;
    const row = document.createElement("div");
    row.className = `field field--${f.kind === "choice" ? "choice-number" : f.kind}`;
    row.dataset.tune = f.key;
    const label = `<span class="field__label" id="${id}-l">${f.label}</span>`;
    const effect = `<p class="field__effect" id="${id}-fx">${f.effect}</p>`;
    if (f.kind === "number") {
      const d = f.decimals;
      row.innerHTML = `<label class="field__label" for="${id}">${f.label}</label>
        <span class="field__value"><input type="text" inputmode="decimal" class="num field__num" data-role="value" aria-label="${f.label} in ${f.unit}" /><span class="field__unit">${f.unit}</span></span>
        <input type="range" id="${id}" data-role="control" min="${f.min}" max="${f.max}" step="${f.step}" aria-describedby="${id}-fx" />
        <span class="field__range num" aria-hidden="true">${fmt(f.min * f.scale, d)} – ${fmt(f.max * f.scale, d)}</span>${effect}`;
      const slider = row.querySelector<HTMLInputElement>("input[type=range]")!;
      const val = row.querySelector<HTMLInputElement>(".field__num")!;
      slider.addEventListener("input", () => this.set(f.key, String(Number(slider.value) * f.scale)));
      const commit = () => {
        const max = this.maxOf(f);
        const raw = parseNumber(val.value, { min: f.min * f.scale, max: max * f.scale });
        if (!Number.isFinite(raw)) return this.sync();
        this.set(f.key, String(snap(clamp(raw / f.scale, f.min, max), f.min, f.step) * f.scale));
      };
      val.addEventListener("change", commit);
      val.addEventListener("keydown", (e) => e.key === "Enter" && commit());
    } else if (f.kind === "choice") {
      row.innerHTML = `${label}<div class="seg" role="radiogroup" aria-labelledby="${id}-l" aria-describedby="${id}-fx">${f.options
        .map((o) => `<label class="seg__opt"><input type="radio" name="${id}" value="${o.value}" data-role="control" /><span class="num">${o.label}</span></label>`)
        .join("")}</div>${effect}`;
      row.querySelectorAll<HTMLInputElement>("input").forEach((i) => i.addEventListener("change", () => i.checked && this.set(f.key, i.value)));
    } else {
      row.innerHTML = `<label class="field__label" for="${id}">${f.label}</label><select id="${id}" data-role="control" aria-describedby="${id}-fx">${f.options
        .map((o) => `<option value="${o.value}">${o.label}</option>`)
        .join("")}</select>${effect}`;
      const sel = row.querySelector("select")!;
      sel.addEventListener("change", () => this.set(f.key, sel.value));
    }
    this.rows.set(f.key, row);
    return row;
  }

  private set(k: keyof EvTuning, v: string) {
    this.values[k] = v;
    this.put("note", "");
    // motor counts: up to 4 per axle (validTuning)
    const t = this.read(k === "frontMotors" || k === "rearMotors" ? k : undefined);
    this.fill(t);
    this.scheduleApply();
  }

  /** Changes take effect right away, like the combustion Werkbank (no "Anwenden"); debounced for sliders. */
  private applyTimer = 0;
  private scheduleApply() {
    clearTimeout(this.applyTimer);
    this.applyTimer = window.setTimeout(() => this.apply(), 250);
  }

  private fill(t: EvTuning) {
    this.rpmVmax = tuneEv(this.car!.setup.ev!, t, this.radius()).rpmVmaxKmh;
    for (const f of EV_FIELDS) this.values[f.key] = formValue(f, t, this.maxOf(EV_FIELDS.find((x) => x.key === "vmaxKmh") as EvField & { kind: "number" }));
    this.sync();
    this.updatePreview();
  }

  private sync() {
    const t = this.car ? readForm(this.values, this.factory(), this.rpmVmax) : null;
    for (const f of EV_FIELDS) {
      const row = this.rows.get(f.key)!;
      const v = this.values[f.key] ?? "";
      row.hidden = !!t && !!f.visible && !f.visible(t);
      if (f.kind === "number") {
        const n = Number(v);
        const slider = row.querySelector<HTMLInputElement>("input[type=range]")!;
        if (f.maxIsRpmLimit) {
          const max = this.maxOf(f);
          slider.max = String(max);
          row.querySelector(".field__range")!.textContent = `${fmt(f.min)} – ${fmt(max)} (aus)`;
        }
        slider.value = String(n / f.scale);
        const val = row.querySelector<HTMLInputElement>(".field__num")!;
        if (document.activeElement !== val) val.value = fmt(n, f.decimals);
      } else if (f.kind === "choice") {
        row.querySelectorAll<HTMLInputElement>("input").forEach((i) => (i.checked = i.value === v));
      } else row.querySelector("select")!.value = v;
    }
  }

  private updatePreview() {
    if (!this.car) return;
    const car = this.car;
    const p = tuneEv(car.setup.ev!, this.read(), this.radius());
    this.preview = p;
    const u = prefs();
    this.put("power", `${fmt(p.systemPs)} PS · ${fmt(p.systemKw)} kW`);
    this.put("motor", `${p.ev.motors.length} × ${fmt(p.motorKw)} kW · ${fmt(p.motorNm)} Nm`);
    this.put("inverter", `${fmt(p.inverterA)} A`);
    this.put("mass", `${fmt(car.setup.vehicle.massKg + p.deltaKg)} kg (${p.deltaKg >= 0 ? "+" : "−"}${fmt(Math.abs(p.deltaKg))})`);
    this.put("limit", LIMIT_LABEL[p.limit]);
    this.put("vmax", p.governorKmh === null ? `${fmt(p.rpmVmaxKmh)} km/h, begrenzt durch Motordrehzahl` : `${fmt(p.governorKmh)} km/h, Begrenzer`);
    this.put("t100", "…");
    this.put("range", "…");
    if (!this.out.note!.textContent) this.put("note", p.notes.join(" "));
    // the drive estimate is a few hundred ms of simulation: once the input settles, in slices between frames
    clearTimeout(this.estTimer);
    this.estRun?.cancel();
    this.estTimer = window.setTimeout(() => {
      if (this.preview !== p || this.car !== car) return;
      this.estRun = estimateEvAsync(car.setup, p, (e) => {
        if (this.preview !== p) return;
        this.put("limit", `${LIMIT_LABEL[p.limit]}${e.tractionLimited ? `, beim Anfahren ${LIMIT_LABEL.traction}` : ""}`);
        this.put("t100", e.t100 === null ? "über 20 s" : `${fmt(e.t100, 1)} s`);
        this.put("range", rangeText(e.rangeKm, u));
      });
    }, 150);
  }

  private apply() {
    if (!this.preview || !this.car) return;
    const p = this.preview;
    if (!this.onTune(p, this.car.setup.vehicle.massKg + p.deltaKg)) this.put("note", "Erst anhalten, dann lässt sich das Auto umbauen.");
  }

  private put(k: string, v: string) {
    const n = this.out[k]!;
    if (n.textContent !== v) n.textContent = v;
  }
}
