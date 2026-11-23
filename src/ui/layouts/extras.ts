// Cockpit console (#83): the additional gauges ("Zusatzinstrumente", round or as bars, like the pods of a tuner car)
// and the tuning bar, plus the small picker that switches them. Shown under the cluster in every design; the choice
// is stored in the settings (ckGauges, ckGaugeStyle, ckTuneBar). Values and scales come from extras-logic.ts.
// The look follows the cockpit design: dial designs draw the pods in their DialTheme and tokens, screen designs
// (digital, head-up, Renn-Dash, motorcycle) show them as their own tiles or segment bars (gaugeDisplay, designs.ts).
import { GEARBOX_THERMAL, gearboxThermalKind, systemFactor, type EngineConfig, type EngineSummary, type GearboxThermalSpec } from "../../core/index.ts";
import { getSettings, prefs, setSettings } from "../settings.ts";
import { Dial, type DialScale } from "./dial.ts";
import { GAUGE_IDS, GAUGE_LABEL, GAUGE_SHORT, dialTheme, gaugeDisplay, gaugeStyleHint, type CockpitDesignId, type GaugeId } from "./designs.ts";
import { gaugeAvailable, gaugeFraction, gaugeScale, gaugeUnavailableHint, gaugeUnit, gaugeValue, toggleGauge, tuneItems, type GaugeContext } from "./extras-logic.ts";
import { systemReadings } from "./systems-logic.ts";
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
  red: HTMLElement;
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
  private design: CockpitDesignId = "classic";
  /** Gearbox oil (#53): thresholds of the gearbox on the dyno (null: no vehicle), and whether it reports a value. */
  private gear: GearboxThermalSpec | null = null;
  private gearKind = "";
  private gearOil = false;
  private hint: HTMLElement;
  /** Board-net factor of the vehicle (24 V trucks/buses = 2) for the voltmeter scale (#83). */
  private sys: 1 | 2 = 1;

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
            <p class="ck__extras-hint" data-ck="gstyle-hint" hidden></p>
          </fieldset>
        </div>
      </details>`;
    this.el = el;
    this.tune = el.querySelector(".ck__tune")!;
    this.hint = el.querySelector("[data-ck=gstyle-hint]")!;
    const host = el.querySelector(".ck__pods")!;
    const blank: DialScale = { min: 0, max: 1, major: 1, minor: 1, caption: "" };
    for (const id of GAUGE_IDS) {
      const wrap = document.createElement("figure");
      wrap.className = "ck-pod";
      wrap.dataset.pod = id;
      wrap.hidden = true;
      const dial = new Dial(blank, { small: true, label: GAUGE_LABEL[id] });
      wrap.innerHTML = `<div class="ck-pod__bar" aria-hidden="true"><i class="ck-pod__zone"></i><i class="ck-pod__red"></i><i class="ck-pod__fill"></i></div>
        <figcaption><span class="ck-pod__cap">${GAUGE_SHORT[id]}</span> <b class="num ck-pod__val">–</b> <small class="ck-pod__unit"></small></figcaption>`;
      wrap.prepend(dial.canvas);
      host.append(wrap);
      this.pods.push({
        id, wrap, dial, scale: blank, last: "",
        val: wrap.querySelector(".ck-pod__val")!, unit: wrap.querySelector(".ck-pod__unit")!,
        fill: wrap.querySelector(".ck-pod__fill")!, zone: wrap.querySelector(".ck-pod__zone")!, red: wrap.querySelector(".ck-pod__red")!,
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

  /** Takes on the look of a cockpit design: its DialTheme on the round pods, tiles/segments on screen designs. */
  setDesign(id: CockpitDesignId) {
    this.design = id;
    const t = dialTheme(id);
    for (const p of this.pods) p.dial.setTheme(t);
    const hint = gaugeStyleHint(id);
    this.hint.textContent = hint;
    this.hint.hidden = !hint;
    this.shownKey = "";
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
      const g = gaugeScale(p.id, this.summary.limits, this.cfg.fuel, u, this.gear ?? undefined, this.sys);
      const unit = gaugeUnit(p.id, u);
      p.scale = { ...g, caption: unit, ends: true };
      p.dial.setScale(p.scale);
      p.unit.textContent = unit;
      p.wrap.title = `${GAUGE_LABEL[p.id]}, Skala ${fmtEnd(g.min)} bis ${fmtEnd(g.max)} ${unit}`;
      const span = g.max - g.min;
      for (const [el, z] of [[p.zone, g.zone], [p.red, g.red]] as const) {
        el.hidden = !z;
        if (!z) continue;
        el.style.left = `${((Math.max(g.min, z.from) - g.min) / span) * 100}%`;
        el.style.width = `${((Math.min(g.max, z.to) - Math.max(g.min, z.from)) / span) * 100}%`;
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
    // gearbox oil (#53): only with a vehicle on the dyno; its scale follows the gearbox kind (warning, TCU protection)
    const d = f.drivetrain;
    const vehicle = f.mode === "vehicle";
    const gearboxOilC = vehicle ? d.state.gearboxOilC ?? Number.NaN : Number.NaN;
    const kind = vehicle ? gearboxThermalKind(d.state.type, d.kind) : "";
    if (kind !== this.gearKind) {
      this.gearKind = kind;
      this.gear = kind ? GEARBOX_THERMAL[kind] : null;
      this.syncUnits();
    }
    this.gearOil = Number.isFinite(gearboxOilC);
    const r = systemReadings(f, this.cfg);
    const sys = systemFactor(vehicle ? d.kind : "car");
    if (sys !== this.sys) {
      this.sys = sys;
      this.syncUnits();
    }
    const tyreCarcassC = vehicle ? d.state.tyreCarcassC ?? Number.NaN : Number.NaN;
    const avail: GaugeContext = { turbo: this.turbo, gearOil: this.gearOil, tyre: vehicle, ...r.has };
    // which pods are shown, the style and the tuning bar: only touched when the choice changes
    const shown = gaugeDisplay(this.design, st.ckGaugeStyle);
    const round = shown === "round";
    const key = `${st.ckGauges.join(",")}|${shown}|${st.ckTuneBar}|${this.turbo}|${this.gearOil}|${vehicle}|${Object.values(r.has).join("")}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.el.dataset.gstyle = shown;
      for (const p of this.pods) p.last = "";
      for (const p of this.pods) {
        const on = st.ckGauges.includes(p.id) && gaugeAvailable(p.id, avail);
        if (p.wrap.hidden === on) {
          p.wrap.hidden = !on;
          p.last = "";
          p.dial.invalidate();
        }
        const box = this.boxes.get(p.id)!;
        box.checked = st.ckGauges.includes(p.id);
        box.disabled = !gaugeAvailable(p.id, avail);
        box.closest("label")!.title = !box.disabled ? "" : gaugeUnavailableHint(p.id);
      }
      this.el.classList.toggle("has-pods", this.pods.some((p) => !p.wrap.hidden));
      this.el.querySelectorAll<HTMLInputElement>('input[name="ck-gstyle"]').forEach((r) => (r.checked = r.value === st.ckGaugeStyle));
      this.el.querySelector<HTMLInputElement>("[data-control=ck-tune]")!.checked = st.ckTuneBar;
      this.tune.hidden = !st.ckTuneBar;
      this.tuneKey = "";
      for (const p of this.pods) if (!p.wrap.hidden) p.dial.draw(true);
    }
    const fi = { coolantC: s.coolantC, oilC: s.oilC, oilPressureBar: s.oilPressureBar, boostBar: s.boostBar, egtC: s.egtC, lambda: s.lambda, running: s.running, gearboxOilC, gearboxOilWarn: vehicle && !!d.state.gearboxOilWarn, tyreCarcassC, tyreWarn: vehicle && !!d.state.tyreWarn, tyreFailed: vehicle && !!d.state.tyreFailed, ...r } as unknown as FieldInputs;
    const gi = { boostBar: s.boostBar, oilPressureBar: s.oilPressureBar, oilC: s.oilC, lambda: s.lambda, egtC: s.egtC, gearboxOilC, tyreCarcassC, ...r };
    for (const p of this.pods) {
      if (p.wrap.hidden) continue;
      const v = gaugeValue(p.id, gi, u);
      if (round) p.dial.set(v, f.dt);
      const t = formatField(p.id, fi, u, this.summary.limits);
      const k = `${t.value}|${t.warn}|${round ? "" : gaugeFraction(v, p.scale).toFixed(3)}`;
      if (k === p.last) continue;
      p.last = k;
      p.val.textContent = t.value;
      p.wrap.classList.toggle("is-limit", t.warn);
      if (!round) p.fill.style.width = `${(gaugeFraction(v, p.scale) * 100).toFixed(1)}%`;
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
