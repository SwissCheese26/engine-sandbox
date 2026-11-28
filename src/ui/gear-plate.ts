// Gänge-Platte on the chassis dyno (issue #14): gear count and single ratios, "Abstufung" helper (geometric /
// progressive from 1st and top gear) and the Zugkraftdiagramm (tractive force per gear and driving resistance over
// speed, Vmax intersection, "zu kurz / zu lang übersetzt"). Ratios can only be changed at standstill.
// Since the "Getriebe" consolidation the plate is the one gearbox section: the Getriebe-Pult puts gearbox type, final
// drive and oil cooler into its setup slot. Own ratios are stored per vehicle by the vehicle panel (vehicle-custom.ts).
import {
  GEAR_COUNT_MIN, GEAR_RATIO_MAX, GEAR_RATIO_MIN, airDensity, altitudeToKpa, dynoSweep, gradedRatios, tractionCurves,
} from "../core/index.ts";
import type { DynoPoint, Drivetrain, EngineConfig, EngineSummary, TractionResult } from "../core/index.ts";
import { fitCanvas, tokens } from "./canvas.ts";
import { fmt, tickStep } from "./format.ts";
import { prefs } from "./settings.ts";
import { toUnit } from "./units.ts";

/** Hints of the gear plate (issue #91): locked while rolling in gear; open with the parking brake applied. */
export const GEAR_LOCKED_HINT = "Anhalten (Handbremse) oder N";
export const GEAR_HELD_HINT = "Handbremse aktiv – Übersetzungen änderbar";

/** Lock hint under the ratio fields: "" = none. Pure, unit-tested. */
export function gearLockHint(editable: boolean, held: boolean): string {
  return !editable ? GEAR_LOCKED_HINT : held ? GEAR_HELD_HINT : "";
}
/** Progression factor φ₂ of the "progressiv" Abstufung (docs/research/vehicle.md §5). */
const PROGRESSIVE = 1.1;
const UI_MAX_GEARS = 10;

export interface SavedRatios {
  kind: string;
  type: string;
  ratios: number[];
}

/** Stored own ratios (localStorage JSON), shape-checked; anything else → null. The values are checked by the core. */
export function parseSavedRatios(raw: unknown): SavedRatios | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Record<keyof SavedRatios, unknown>>;
  if (typeof r.kind !== "string" || typeof r.type !== "string" || !Array.isArray(r.ratios)) return null;
  return { kind: r.kind, type: r.type, ratios: r.ratios.map((x) => (typeof x === "number" ? x : Number.NaN)) };
}

/** A typed ratio: German decimal comma or point, e.g. "3,77" → 3.77; anything else → NaN. */
export function parseRatioInput(text: string): number {
  const t = text.trim().replace(",", ".");
  return /^\d+(\.\d*)?$|^\.\d+$/.test(t) ? Number(t) : Number.NaN;
}

export class GearPlate {
  readonly el: HTMLElement;
  private countSel: HTMLSelectElement;
  private gradeSel: HTMLSelectElement;
  private gradeBtn: HTMLButtonElement;
  private grid: HTMLElement;
  private msg: HTMLElement;
  private editor: HTMLElement;
  private canvas: HTMLCanvasElement;
  private verdictEl: HTMLElement;
  private sweep: DynoPoint[] = [];
  private traction: TractionResult | null = null;
  /** Vmax of the present gearing (#154: Werkbank summary); null without a full-load sweep. */
  get vmax(): TractionResult["vmax"] | null {
    return this.traction?.vmax ?? null;
  }
  private locked = false;
  private lockEl!: HTMLElement;
  /** Slot at the top of the section for the gearbox type, final drive and oil cooler (filled by the Getriebe-Pult). */
  readonly setupSlot: HTMLElement;
  private envKey = "";
  /** Called after own ratios were applied (stored for this vehicle, Vmax is recalculated). */
  onEdit: () => void = () => {};

  constructor(private drivetrain: Drivetrain, private cfg: EngineConfig, private summary: EngineSummary) {
    const el = document.createElement("div");
    el.className = "gears";
    el.innerHTML = `
      <h3 class="vehicle__title">Getriebe</h3>
      <div class="gears__left">
      <div class="gears__setup" data-slot="gear-setup"></div>
      <div class="gears__editor">
        <h4 class="gears__sub">Gänge &amp; Übersetzungen</h4>
        <div class="gears__row">
          <label class="vehicle__num"><span>Gänge</span>
            <select data-control="gear-count"></select>
          </label>
          <label class="vehicle__num"><span>Abstufung</span>
            <select data-control="gear-grading">
              <option value="geo">geometrisch</option>
              <option value="pro">progressiv</option>
            </select>
          </label>
          <button type="button" class="btn btn--small" data-control="gear-grade" title="Gänge zwischen 1. und höchstem Gang neu verteilen">Abstufen</button>
        </div>
        <div class="gears__grid" data-out="gear-inputs"></div>
        <p class="vehicle__hint" data-out="gear-lock" role="status" hidden></p>
        <p class="vehicle__hint" data-out="gear-msg" role="status"></p>
      </div>
      </div>
      <figure class="gears__traction">
        <h4 class="gears__sub">Zugkraft</h4>
        <canvas role="img" aria-label="Zugkraftdiagramm: Zugkraft am Rad je Gang und Fahrwiderstand über der Geschwindigkeit"></canvas>
        <figcaption class="gearbox__calc" data-out="traction-verdict"></figcaption>
      </figure>`;
    this.el = el;
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    this.countSel = q("[data-control=gear-count]");
    this.gradeSel = q("[data-control=gear-grading]");
    this.gradeBtn = q("[data-control=gear-grade]");
    this.grid = q("[data-out=gear-inputs]");
    this.msg = q("[data-out=gear-msg]");
    this.editor = q(".gears__editor");
    this.canvas = q(".gears__traction canvas");
    this.verdictEl = q("[data-out=traction-verdict]");
    this.lockEl = q("[data-out=gear-lock]");
    this.setupSlot = q("[data-slot=gear-setup]");
    this.countSel.addEventListener("change", () => this.regrade(Number(this.countSel.value)));
    this.gradeBtn.addEventListener("click", () => this.regrade(this.drivetrain.gearbox.ratios.length));
    this.grid.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      const k = Number(input.dataset.gear);
      const v = parseRatioInput(input.value);
      const r = [...this.drivetrain.gearbox.ratios];
      r[k] = v;
      this.apply(r);
    });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => this.draw()).observe(this.canvas);
    this.sweep = this.measure();
    this.sync();
  }

  configure(cfg: EngineConfig, summary: EngineSummary) {
    this.cfg = cfg;
    this.summary = summary;
    this.sweep = this.measure();
    this.sync();
  }

  private measure(): DynoPoint[] {
    try {
      return dynoSweep(this.cfg, { stepRpm: 100 });
    } catch {
      return [];
    }
  }

  private regrade(count: number) {
    const r = this.drivetrain.gearbox.ratios;
    const first = r[0]!;
    const top = r[r.length - 1]!;
    this.apply(gradedRatios(first, top, count, this.gradeSel.value === "pro" ? PROGRESSIVE : 1));
  }

  private apply(ratios: number[]) {
    if (this.locked) {
      this.msg.textContent = `Nicht übernommen: ${GEAR_LOCKED_HINT}.`;
      return this.syncInputs();
    }
    const err = this.drivetrain.setRatios(ratios);
    if (err) {
      this.msg.textContent = `Nicht übernommen: ${err}.`;
      this.syncInputs();
      return;
    }
    this.msg.textContent = "";
    this.sync();
    this.onEdit();
  }

  private syncInputs() {
    const r = this.drivetrain.gearbox.ratios;
    const n = r.length;
    const counts: number[] = [];
    for (let k = GEAR_COUNT_MIN; k <= UI_MAX_GEARS; k++) counts.push(k);
    if (n > UI_MAX_GEARS) counts.push(n);
    this.countSel.innerHTML = counts.map((k) => `<option value="${k}">${k}</option>`).join("");
    this.countSel.value = String(n);
    if (this.grid.childElementCount !== n) {
      this.grid.innerHTML = r.map((_, k) => `
        <label class="vehicle__num"><span>${k + 1}. Gang</span>
          <input type="number" inputmode="decimal" data-gear="${k}" min="${GEAR_RATIO_MIN}" max="${GEAR_RATIO_MAX}" step="0.001" />
        </label>`).join("");
    }
    this.grid.querySelectorAll<HTMLInputElement>("input").forEach((inp, k) => (inp.value = r[k]!.toFixed(3)));
    this.setLocked(this.locked);
  }

  /** Computed Vmax of the traction diagram (km/h), null without a curve. */
  get vmaxKmh(): number | null {
    return this.traction?.vmax.kmh ?? null;
  }

  /** Shows a note under the ratios (e.g. stored ratios that could not be applied). */
  note(text: string) {
    this.msg.textContent = text;
  }

  /** Fills the editor from the drivetrain and redraws the diagram (after any vehicle/gearbox change). */
  sync() {
    const cvt = this.drivetrain.state.type === "cvt";
    this.editor.hidden = cvt;
    if (!cvt) this.syncInputs();
    this.compute();
    this.draw();
  }

  private compute() {
    const d = this.drivetrain;
    const env = d.environment;
    this.envKey = `${env.gradePct}|${env.altitudeM}|${env.ambientC}`;
    if (this.sweep.length < 2) {
      this.traction = null;
      this.verdictEl.textContent = "";
      return;
    }
    const spec = d.gearbox;
    this.traction = tractionCurves(this.sweep, this.cfg.revLimitRpm, this.summary.peakPowerRpm,
      { type: d.state.type, spec, finalDrive: d.state.finalDrive, vehicle: d.vehicle },
      { gradePct: env.gradePct, airDensityKgM3: airDensity(altitudeToKpa(env.altitudeM), env.ambientC) });
    const t = this.traction;
    const u = prefs().speed;
    const v = `${fmt(toUnit("speed", t.vmax.kmh))} ${u}`;
    const where = t.vmax.limitedBy === "limiter"
      ? `Vmax ${v} im ${t.vmax.gear}. Gang am Drehzahlbegrenzer`
      : `Vmax ${v} im ${t.vmax.gear}. Gang bei ${fmt(t.vmax.rpm)} 1/min (Schnittpunkt mit dem Fahrwiderstand)`;
    const verdict = t.verdict === "zu-kurz"
      ? "zu kurz übersetzt: Ein längerer letzter Gang bringt mehr Vmax."
      : t.verdict === "zu-lang"
        ? "zu lang übersetzt: Der letzte Gang erreicht die Nennleistung nicht, ein kürzerer bringt mehr Vmax und Durchzug."
        : "auf Vmax ausgelegt: Der Schnittpunkt liegt bei der Nennleistung.";
    const cu = t.gears[0]?.converterUntilKmh;
    const conv = cu ? ` Im 1. Gang verstärkt der Wandler das Moment bis ${fmt(toUnit("speed", cu))} ${u}.` : "";
    this.verdictEl.textContent = `${where}, ${verdict}${conv}`;
  }

  private draw() {
    const t = this.traction;
    if (!t || this.el.offsetParent === null) return;
    const { ctx, w, h } = fitCanvas(this.canvas);
    const tk = tokens();
    ctx.fillStyle = tk.paper;
    ctx.fillRect(0, 0, w, h);
    const padL = 46;
    const padR = 12;
    const padT = 20;
    const padB = 26;
    const pw = w - padL - padR;
    const ph = h - padT - padB;
    const u = prefs().speed;
    const vMax = t.maxKmh;
    let fMax = 0;
    for (const g of t.gears) for (const p of g.points) if (p.kmh <= vMax) fMax = Math.max(fMax, p.forceN);
    fMax = Math.max(1000, fMax * 1.08);
    const kN = fMax > 3000;
    const x = (kmh: number) => padL + (Math.min(kmh, vMax) / vMax) * pw;
    const y = (f: number) => padT + ph * (1 - Math.min(f, fMax) / fMax);
    // grid and axes
    ctx.strokeStyle = tk.paperGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const vShown = toUnit("speed", vMax, u);
    const vStep = tickStep(vShown, pw > 320 ? 8 : 4);
    const fStep = tickStep(fMax, 5);
    for (let s = 0; s <= vShown + 1e-6; s += vStep) {
      const xx = Math.round(padL + (s / vShown) * pw) + 0.5;
      ctx.moveTo(xx, padT);
      ctx.lineTo(xx, padT + ph);
    }
    for (let f = 0; f <= fMax + 1e-6; f += fStep) {
      const yy = Math.round(y(f)) + 0.5;
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + pw, yy);
    }
    ctx.stroke();
    ctx.strokeStyle = tk.engrave;
    ctx.strokeRect(padL + 0.5, padT + 0.5, pw, ph);
    ctx.font = `500 11px ${tk.fontNum}`;
    ctx.fillStyle = tk.engrave;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let s = 0; s <= vShown + 1e-6; s += vStep) ctx.fillText(fmt(s), padL + (s / vShown) * pw, padT + ph + 5);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let f = 0; f <= fMax + 1e-6; f += fStep) ctx.fillText(kN ? fmt(f / 1000, f % 1000 ? 1 : 0) : fmt(f), padL - 5, y(f));
    ctx.font = `600 11px ${tk.font}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(kN ? "Zugkraft kN" : "Zugkraft N", 4, 3);
    // unit above the plot (top right), clear of the Vmax line and its label
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`v in ${u}`, padL + pw, padT - 3);
    // gears: alternating ink so neighbours stay apart, labels at the curve's peak
    ctx.lineWidth = 2;
    t.gears.forEach((g, k) => {
      const col = k % 2 ? tk.inkPower : tk.inkTorque;
      ctx.strokeStyle = col;
      ctx.beginPath();
      let peak = g.points[0]!;
      g.points.forEach((p, j) => {
        if (p.forceN > peak.forceN) peak = p;
        if (j) ctx.lineTo(x(p.kmh), y(p.forceN));
        else ctx.moveTo(x(p.kmh), y(p.forceN));
      });
      ctx.stroke();
      if (peak.kmh < vMax) {
        ctx.fillStyle = col;
        ctx.font = `600 11px ${tk.fontNum}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(this.drivetrain.state.type === "cvt" ? "CVT" : String(g.gear), x(peak.kmh), Math.max(padT + 12, y(peak.forceN) - 3));
      }
    });
    // driving resistance
    ctx.strokeStyle = tk.engrave;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    t.resistance.forEach((p, j) => (j ? ctx.lineTo(x(p.kmh), y(p.forceN)) : ctx.moveTo(x(p.kmh), y(p.forceN))));
    ctx.stroke();
    ctx.setLineDash([]);
    // Vmax mark
    const vx = x(t.vmax.kmh);
    ctx.strokeStyle = tk.signal;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vx, padT);
    ctx.lineTo(vx, padT + ph);
    ctx.stroke();
    ctx.fillStyle = tk.signal;
    ctx.beginPath();
    ctx.arc(vx, y(t.vmax.forceN), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tk.engrave;
    ctx.font = `600 11px ${tk.font}`;
    ctx.textAlign = vx > padL + pw * 0.75 ? "right" : "left";
    ctx.textBaseline = "top";
    ctx.fillText(`Vmax ${fmt(toUnit("speed", t.vmax.kmh, u))}`, vx + (ctx.textAlign === "right" ? -5 : 5), padT + 4);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("Fahrwiderstand", x(t.resistance[Math.round(t.resistance.length * 0.25)]!.kmh) + 4, y(t.resistance[Math.round(t.resistance.length * 0.25)]!.forceN) - 4);
  }

  private setLocked(locked: boolean) {
    for (const c of this.editor.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) c.disabled = locked;
  }

  /** Per frame: lock while rolling in gear (hint: brake or N); redraw when the environment changed. */
  update() {
    const d = this.drivetrain;
    const locked = !d.ratiosEditable;
    if (locked !== this.locked) {
      this.locked = locked;
      this.setLocked(locked);
    }
    const hint = gearLockHint(!locked, !!d.state.parkingBrake);
    if (hint !== this.lockEl.textContent || this.lockEl.hidden !== !hint) {
      this.lockEl.textContent = hint;
      this.lockEl.hidden = !hint;
      this.lockEl.classList.toggle("is-held", hint === GEAR_HELD_HINT);
    }
    const env = d.environment;
    if (`${env.gradePct}|${env.altitudeM}|${env.ambientC}` !== this.envKey) {
      this.compute();
      this.draw();
    }
  }

  /** Redraw after the plate became visible (canvas had no size while hidden). */
  redraw() {
    this.draw();
  }
}
