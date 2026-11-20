// Cockpit console (#83): the additional gauges ("Zusatzinstrumente", round or as bars, like the pods of a tuner car)
// and the tuning bar, plus the small picker that switches them. Shown under the cluster in every design; the choice
// is stored in the settings (ckGauges, ckGaugeStyle, ckTuneBar). Values and scales come from extras-logic.ts.
import type { EngineConfig, EngineSummary } from "../../core/index.ts";
import { getSettings, prefs, setSettings } from "../settings.ts";
import { Dial, type DialScale } from "./dial.ts";
import { GAUGE_IDS, GAUGE_LABEL, GAUGE_SHORT, type DialTheme, type GaugeId } from "./designs.ts";
import { gaugeAvailable, gaugeFraction, gaugeScale, gaugeValue, toggleGauge, tuneItems } from "./extras-logic.ts";
import { formatField, type FieldInputs } from "./fields-logic.ts";
import type { Frame } from "./view.ts";

interface Pod {
  id: GaugeId;
  wrap: HTMLElement;
  dial: Dial;
  val: HTMLElement;
  unit: HTMLElement;
  fill: HTMLElement;
  zone: HTMLElement;
  scale: DialScale;
  last: string;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class CockpitExtras {
  readonly el: HTMLElement;
  private pods: Pod[] = [];
  private tune: HTMLElement;
  private cfg: EngineConfig | null = null;
  private summary: EngineSummary | null = null;
  private turbo = false;
  private shownKey = "";
  private tuneKey = "";
  private boxes = new Map<GaugeId, HTMLInputElement>();

  constructor() {
    const el = document.createElement("div");
    el.className = "ck__console";
    el.dataset.gstyle = "round";
    el.innerHTML = `
      <div class="ck__tune num" role="group" aria-label="Tuning-Leiste" hidden></div>
      <div class="ck__pods" role="group" aria-label="Zusatzinstrumente"></div>
      <details class="ck__extras">
        <summary>Zusatzanzeigen</summary>
        <div class="ck__extras-body">
          <fieldset><legend>Zusatzinstrumente</legend>
            ${GAUGE_IDS.map((id) => `<label class="ck-chk"><input type="checkbox" data-gauge="${id}" /> <span>${GAUGE_LABEL[id]}</span></label>`).join("")}
          </fieldset>
          <fieldset><legend>Darstellung</legend>
            <label class="ck-chk"><input type="radio" name="ck-gstyle" value="round" /> <span>Rund</span></label>
            <label class="ck-chk"><input type="radio" name="ck-gstyle" value="bar" /> <span>Balken</span></label>
            <label class="ck-chk"><input type="checkbox" data-control="ck-tune" /> <span>Tuning-Leiste</span></label>
          </fieldset>
        </div>
      </details>`;
    this.el = el;
    this.tune = el.querySelector(".ck__tune")!;
    const host = el.querySelector(".ck__pods")!;
    const blank: DialScale = { min: 0, max: 1, major: 1, minor: 1, caption: "" };
    for (const id of GAUGE_IDS) {
      const wrap = document.createElement("figure");
      wrap.className = "ck-pod";
      wrap.dataset.pod = id;
      wrap.hidden = true;
      const dial = new Dial(blank, { small: true, label: GAUGE_LABEL[id] });
      wrap.innerHTML = `<div class="ck-pod__bar" aria-hidden="true"><i class="ck-pod__zone"></i><i class="ck-pod__fill"></i></div>
        <figcaption><span class="ck-pod__cap">${GAUGE_SHORT[id]}</span> <b class="num ck-pod__val">–</b> <small class="ck-pod__unit"></small></figcaption>`;
      wrap.prepend(dial.canvas);
      host.append(wrap);
      this.pods.push({
        id, wrap, dial, scale: blank, last: "",
        val: wrap.querySelector(".ck-pod__val")!, unit: wrap.querySelector(".ck-pod__unit")!,
        fill: wrap.querySelector(".ck-pod__fill")!, zone: wrap.querySelector(".ck-pod__zone")!,
      });
    }
    el.querySelectorAll<HTMLInputElement>("[data-gauge]").forEach((b) => {
      const id = b.dataset.gauge as GaugeId;
      this.boxes.set(id, b);
      b.addEventListener("change", () => setSettings({ ckGauges: toggleGauge(getSettings().ckGauges, id, b.checked) }));
    });
    el.querySelectorAll<HTMLInputElement>('input[name="ck-gstyle"]').forEach((r) =>
      r.addEventListener("change", () => r.checked && setSettings({ ckGaugeStyle: r.value === "bar" ? "bar" : "round" })),
    );
    const tuneBox = el.querySelector<HTMLInputElement>("[data-control=ck-tune]")!;
    tuneBox.addEventListener("change", () => setSettings({ ckTuneBar: tuneBox.checked }));
  }

  get dials(): Dial[] {
    return this.pods.map((p) => p.dial);
  }

  setTheme(t: DialTheme) {
    for (const p of this.pods) p.dial.setTheme(t);
  }

  configure(cfg: EngineConfig, summary: EngineSummary) {
    this.cfg = cfg;
    this.summary = summary;
    this.turbo = summary.limits.boostMaxBar > 0;
    this.syncUnits();
  }

  /** Scales in the chosen units (limit zones from the engine limits). */
  syncUnits() {
    if (!this.cfg || !this.summary) return;
    const u = prefs();
    for (const p of this.pods) {
      const g = gaugeScale(p.id, this.summary.limits, this.cfg.fuel, u);
      const unit = p.id === "lambda" ? "λ" : p.id === "oilP" || p.id === "boost" ? u.pressure : u.temp;
      p.scale = { ...g, caption: unit, ends: true };
      p.dial.setScale(p.scale);
      p.unit.textContent = unit;
      p.wrap.title = `${GAUGE_LABEL[p.id]}, Skala ${fmtEnd(g.min)} bis ${fmtEnd(g.max)} ${unit}`;
      const span = g.max - g.min;
      const z = g.zone;
      p.zone.hidden = !z;
      if (z) {
        p.zone.style.left = `${((Math.max(g.min, z.from) - g.min) / span) * 100}%`;
        p.zone.style.width = `${((Math.min(g.max, z.to) - Math.max(g.min, z.from)) / span) * 100}%`;
      }
      p.last = "";
    }
    this.shownKey = "";
    this.tuneKey = "";
  }

  redraw() {
    for (const p of this.pods) {
      p.dial.invalidate();
      p.dial.draw(true);
    }
  }

  update(f: Frame) {
    if (!this.cfg || !this.summary) return;
    const st = getSettings();
    const u = prefs();
    const s = f.s;
    // which pods are shown, the style and the tuning bar: only touched when the choice changes
    const key = `${st.ckGauges.join(",")}|${st.ckGaugeStyle}|${st.ckTuneBar}|${this.turbo}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.el.dataset.gstyle = st.ckGaugeStyle;
      for (const p of this.pods) {
        const on = st.ckGauges.includes(p.id) && gaugeAvailable(p.id, { turbo: this.turbo });
        if (p.wrap.hidden === on) {
          p.wrap.hidden = !on;
          p.last = "";
          p.dial.invalidate();
        }
        const box = this.boxes.get(p.id)!;
        box.checked = st.ckGauges.includes(p.id);
        box.disabled = !gaugeAvailable(p.id, { turbo: this.turbo });
        box.closest("label")!.title = box.disabled ? "Saugmotor: kein Ladedruck" : "";
      }
      this.el.classList.toggle("has-pods", this.pods.some((p) => !p.wrap.hidden));
      this.el.querySelectorAll<HTMLInputElement>('input[name="ck-gstyle"]').forEach((r) => (r.checked = r.value === st.ckGaugeStyle));
      this.el.querySelector<HTMLInputElement>("[data-control=ck-tune]")!.checked = st.ckTuneBar;
      this.tune.hidden = !st.ckTuneBar;
      this.tuneKey = "";
      for (const p of this.pods) if (!p.wrap.hidden) p.dial.draw(true);
    }
    const fi = { coolantC: s.coolantC, oilC: s.oilC, oilPressureBar: s.oilPressureBar, boostBar: s.boostBar, egtC: s.egtC, lambda: s.lambda, running: s.running } as FieldInputs;
    for (const p of this.pods) {
      if (p.wrap.hidden) continue;
      const v = gaugeValue(p.id, s, u);
      if (st.ckGaugeStyle === "round") p.dial.set(v, f.dt);
      const t = formatField(p.id, fi, u, this.summary.limits);
      const k = `${t.value}|${t.warn}|${st.ckGaugeStyle === "bar" ? gaugeFraction(v, p.scale).toFixed(3) : ""}`;
      if (k === p.last) continue;
      p.last = k;
      p.val.textContent = t.value;
      p.wrap.classList.toggle("is-limit", t.warn);
      if (st.ckGaugeStyle === "bar") p.fill.style.width = `${(gaugeFraction(v, p.scale) * 100).toFixed(1)}%`;
    }
    if (st.ckTuneBar) {
      const items = tuneItems(this.cfg, { boostBar: s.boostBar, knock: s.knock, torqueLimited: s.torqueLimited, warnings: s.warnings.map((w) => w.code) }, u);
      const k = JSON.stringify(items);
      if (k !== this.tuneKey) {
        this.tuneKey = k;
        this.tune.innerHTML = items
          .map((i) => `<span class="ck-tune__item${i.active ? " is-active" : ""}${i.warn ? " is-limit" : ""}" data-tune="${i.key}"><small>${esc(i.label)}</small> <b>${esc(i.value)}</b></span>`)
          .join("");
      }
    }
  }
}

const fmtEnd = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
