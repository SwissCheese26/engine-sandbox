// Instrument panel: round gauges (canvas) for rpm, torque, power and boost, plus linear meters
// (DOM) for temperatures, oil pressure, consumption, λ and knock/soot. Yellow marks limits only.
import type { EngineConfig, EngineState, EngineSummary, WarningCode } from "../core/index.ts";
import { fitCanvas, reducedMotion, tokens } from "./canvas.ts";
import { setText } from "./dom.ts";
import { clamp, fmt, mixHex, niceCeil, tickStep } from "./format.ts";
import { FALLBACK_LIMITS as L, egtLimitC, lambdaLimit } from "./limits-fallback.ts";

const SWEEP_START = (135 * Math.PI) / 180; // 7:30 o'clock
const SWEEP = (270 * Math.PI) / 180;

interface RoundDef {
  id: string;
  label: string;
  unit: string;
  decimals: number;
  /** Shown scale divisor (e.g. rpm shown as ×1000). */
  scaleLabel?: string;
  scaleDiv?: number;
  value: (s: EngineState) => number;
  warns: WarningCode[];
}

class RoundGauge {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private readout: HTMLElement;
  private needle = 0;
  min = 0;
  max = 1;
  limitFrom = Infinity;
  private dirty = true;
  private alarm = false;

  constructor(readonly def: RoundDef, big = false) {
    this.el = document.createElement("figure");
    this.el.className = big ? "gauge gauge--big" : "gauge";
    this.el.dataset.gauge = def.id;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "gauge__face";
    this.canvas.setAttribute("aria-hidden", "true");
    const cap = document.createElement("figcaption");
    cap.className = "gauge__cap";
    this.readout = document.createElement("output");
    this.readout.className = "num gauge__value";
    const lab = document.createElement("span");
    lab.className = "gauge__label";
    lab.textContent = def.label;
    const unit = document.createElement("span");
    unit.className = "gauge__unit";
    unit.textContent = def.unit;
    cap.append(lab, this.readout, unit);
    this.el.append(this.canvas, cap);
  }

  setScale(min: number, max: number, limitFrom: number) {
    if (min !== this.min || max !== this.max || limitFrom !== this.limitFrom) {
      this.min = min;
      this.max = max;
      this.limitFrom = limitFrom;
      this.dirty = true;
    }
  }

  update(s: EngineState, dt: number, active: Set<WarningCode>) {
    const v = this.def.value(s);
    const target = Number.isFinite(v) ? v : 0;
    // Needle with first-order lag; reduced motion damps it further and suppresses jitter.
    const tau = reducedMotion() ? 0.35 : 0.06;
    const k = 1 - Math.exp(-dt / tau);
    const prev = this.needle;
    this.needle += (target - this.needle) * k;
    setText(this.readout, fmt(target, this.def.decimals));
    const alarm = this.def.warns.some((w) => active.has(w)) || target >= this.limitFrom;
    if (alarm !== this.alarm) {
      this.alarm = alarm;
      this.el.classList.toggle("is-limit", alarm);
      this.dirty = true;
    }
    if (this.dirty || Math.abs(prev - this.needle) > (this.max - this.min) * 1e-4) this.draw();
  }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    this.dirty = false;
    const t = tokens();
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 2;
    ctx.clearRect(0, 0, w, h);
    // face
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = t.hammerDeep;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.alarm ? t.signal : t.hammerLight;
    ctx.stroke();

    const span = this.max - this.min;
    const ang = (v: number) => SWEEP_START + (clamp((v - this.min) / span, 0, 1)) * SWEEP;
    // limit band
    if (this.limitFrom < this.max) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.86, ang(this.limitFrom), ang(this.max));
      ctx.lineWidth = R * 0.09;
      ctx.strokeStyle = t.signal;
      ctx.stroke();
    }
    // ticks
    const div = this.def.scaleDiv ?? 1;
    const step = div > 1 ? div : tickStep(span, R > 70 ? 8 : 2);
    const minor = step / (R > 70 ? 5 : 2);
    ctx.strokeStyle = t.alu;
    for (let v = this.min; v <= this.max + 1e-9; v += minor) {
      const a = ang(v);
      const major = Math.abs(((v - this.min) / step) - Math.round((v - this.min) / step)) < 1e-6;
      const r1 = R * 0.92;
      const r0 = major ? R * 0.76 : R * 0.84;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineWidth = major ? 2 : 1;
      ctx.stroke();
    }
    // numerals
    ctx.fillStyle = t.alu;
    const fs = Math.max(10, Math.round(R * (R > 70 ? 0.15 : 0.19)));
    ctx.font = `600 ${fs}px ${t.fontNum}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let v = this.min; v <= this.max + 1e-9; v += step) {
      const a = ang(v);
      const r = R * 0.6;
      const val = v / div;
      ctx.fillText(fmt(val, Math.abs(val - Math.round(val)) > 1e-6 ? 1 : 0), cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    if (this.def.scaleLabel) {
      ctx.font = `500 ${Math.max(10, Math.round(R * 0.11))}px ${t.font}`;
      ctx.fillStyle = t.aluShade;
      ctx.fillText(this.def.scaleLabel, cx, cy + R * 0.74);
    }
    // needle
    const a = ang(this.needle);
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * R * 0.12, cy - Math.sin(a) * R * 0.12);
    ctx.lineTo(cx + Math.cos(a) * R * 0.88, cy + Math.sin(a) * R * 0.88);
    ctx.lineWidth = Math.max(2, R * 0.035);
    ctx.lineCap = "round";
    ctx.strokeStyle = t.alu;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = t.aluShade;
    ctx.fill();
  }
}

interface MeterDef {
  id: string;
  label: string;
  unit: string;
  decimals: number;
  min: number;
  max: (cfg: EngineConfig) => number;
  /** From this value on the meter is at the limit (yellow). */
  limit: (cfg: EngineConfig) => number;
  /** Limit is on the low side (oil pressure, λ for diesel smoke). */
  lowLimit?: boolean;
  value: (s: EngineState) => number;
  warns: WarningCode[];
  /** Temperatures fill along cold → hot. */
  thermal?: boolean;
  visible?: (cfg: EngineConfig) => boolean;
}

class Meter {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private mark: HTMLElement;
  private out: HTMLElement;
  private max = 1;
  private limit = 1;
  private shown = 0;
  private alarm = false;

  constructor(readonly def: MeterDef) {
    this.el = document.createElement("div");
    this.el.className = "meter";
    this.el.dataset.meter = def.id;
    this.el.innerHTML = `<span class="meter__label"></span><output class="num meter__value"></output><span class="meter__unit"></span><span class="meter__track" aria-hidden="true"><span class="meter__fill"></span><span class="meter__mark"></span></span>`;
    this.el.querySelector(".meter__label")!.textContent = def.label;
    this.el.querySelector(".meter__unit")!.textContent = def.unit;
    this.fill = this.el.querySelector(".meter__fill")!;
    this.mark = this.el.querySelector(".meter__mark")!;
    this.out = this.el.querySelector(".meter__value")!;
  }

  configure(cfg: EngineConfig) {
    this.max = this.def.max(cfg);
    this.limit = this.def.limit(cfg);
    const p = clamp((this.limit - this.def.min) / (this.max - this.def.min), 0, 1);
    this.mark.style.left = `${p * 100}%`;
    this.el.hidden = this.def.visible ? !this.def.visible(cfg) : false;
  }

  update(s: EngineState, dt: number, active: Set<WarningCode>) {
    const v = this.def.value(s);
    const ok = Number.isFinite(v);
    const tau = reducedMotion() ? 0.35 : 0.08;
    if (ok) this.shown += (v - this.shown) * (1 - Math.exp(-dt / tau));
    setText(this.out, ok ? fmt(v, this.def.decimals) : "–");
    const p = clamp((this.shown - this.def.min) / (this.max - this.def.min), 0, 1);
    this.fill.style.transform = `scaleX(${ok ? p : 0})`;
    const atLimit = ok && (this.def.lowLimit ? v <= this.limit && s.running : v >= this.limit);
    const alarm = atLimit || this.def.warns.some((w) => active.has(w));
    if (alarm !== this.alarm) {
      this.alarm = alarm;
      this.el.classList.toggle("is-limit", alarm);
    }
    if (this.def.thermal && !alarm) {
      const t = tokens();
      // data colouring cold → hot, reaches signal yellow only at the limit
      const k = clamp((this.shown - 40) / (this.limit - 40), 0, 1);
      this.fill.style.background = mixHex(t.cold, mixHex(t.alu, t.signal, 0.35), k);
    } else if (this.def.thermal) {
      this.fill.style.background = "";
    }
  }
}

const isDiesel = (c: EngineConfig) => c.fuel === "diesel";

export class InstrumentPanel {
  readonly el: HTMLElement;
  private rpm: RoundGauge;
  private round: RoundGauge[];
  private meters: Meter[];

  constructor() {
    this.el = document.createElement("section");
    this.el.className = "instruments";
    this.el.setAttribute("aria-label", "Instrumente");
    this.rpm = new RoundGauge(
      { id: "rpm", label: "Drehzahl", unit: "1/min", decimals: 0, scaleLabel: "× 1000 1/min", scaleDiv: 1000, value: (s) => s.rpm, warns: ["over-rev", "valve-float", "piston-speed"] },
      true,
    );
    this.round = [
      this.rpm,
      new RoundGauge({ id: "torque", label: "Drehmoment", unit: "Nm", decimals: 0, value: (s) => Math.max(0, s.torqueNm), warns: ["conrod-stress"] }),
      new RoundGauge({ id: "power", label: "Leistung", unit: "kW", decimals: 0, value: (s) => Math.max(0, s.powerKw), warns: [] }),
      new RoundGauge({ id: "boost", label: "Ladedruck", unit: "bar", decimals: 2, value: (s) => s.boostBar, warns: ["overboost", "turbo-overspeed"] }),
    ];
    const T = (id: string, label: string, max: number, limit: (c: EngineConfig) => number, value: (s: EngineState) => number, warns: WarningCode[]): MeterDef => ({
      id, label, unit: "°C", decimals: 0, min: 0, max: () => max, limit, value, warns, thermal: true,
    });
    this.meters = [
      new Meter(T("coolant", "Kühlmittel", 130, () => L.coolantMaxC, (s) => s.coolantC, ["overheat-coolant"])),
      new Meter(T("oil", "Öl", 160, () => L.oilMaxC, (s) => s.oilC, ["overheat-oil"])),
      new Meter(T("egt", "Abgas", 1100, egtLimitC, (s) => s.egtC, ["egt-high"])),
      new Meter({ id: "oilp", label: "Öldruck", unit: "bar", decimals: 1, min: 0, max: () => 8, limit: () => L.oilPressureMinBar, lowLimit: true, value: (s) => s.oilPressureBar, warns: ["low-oil-pressure"] }),
      new Meter({ id: "flow", label: "Verbrauch", unit: "l/h", decimals: 1, min: 0, max: (c) => niceCeil(Math.max(10, c.block.cylinders * c.block.boreMm * 0.25)), limit: () => Infinity, value: (s) => s.fuelFlowLh, warns: [] }),
      new Meter({ id: "bsfc", label: "Spezifisch", unit: "g/kWh", decimals: 0, min: 150, max: () => 500, limit: () => Infinity, value: (s) => s.bsfcGkWh, warns: [] }),
      new Meter({ id: "lambda", label: "Lambda", unit: "", decimals: 2, min: 0.6, max: (c) => (isDiesel(c) ? 4 : 1.4), limit: lambdaLimit, lowLimit: true, value: (s) => (s.lambda > 9 ? Number.NaN : s.lambda), warns: ["smoke"] }),
      new Meter({ id: "knock", label: "Klopfen", unit: "%", decimals: 0, min: 0, max: () => 100, limit: () => L.knockMax * 100, value: (s) => s.knock * 100, warns: ["knock"], visible: (c) => !isDiesel(c) }),
      new Meter({ id: "smoke", label: "Ruß", unit: "%", decimals: 0, min: 0, max: () => 100, limit: () => L.smokeMax * 100, value: (s) => s.smoke * 100, warns: ["smoke"], visible: isDiesel }),
    ];
    const dial = document.createElement("div");
    dial.className = "instruments__dials";
    dial.append(...this.round.map((g) => g.el));
    const lin = document.createElement("div");
    lin.className = "instruments__meters";
    lin.append(...this.meters.map((m) => m.el));
    this.el.append(dial, lin);
  }

  configure(cfg: EngineConfig, sum: EngineSummary) {
    const rpmMax = Math.ceil((cfg.revLimitRpm * 1.1) / 1000) * 1000;
    this.rpm.setScale(0, rpmMax, Math.min(cfg.revLimitRpm, sum.safeMaxRpm));
    const [, tq, pw, bo] = this.round;
    tq!.setScale(0, niceCeil(Math.max(50, sum.peakTorqueNm * 1.15)), Infinity);
    pw!.setScale(0, niceCeil(Math.max(20, sum.peakPowerKw * 1.15)), Infinity);
    const charged = cfg.induction.aspiration !== "naturally-aspirated";
    const bmax = charged ? niceCeil(Math.max(0.5, cfg.induction.boostTargetBar * 1.4)) : 0.5;
    bo!.setScale(-1, bmax, charged ? cfg.induction.boostTargetBar * L.boostOvershoot : Infinity);
    for (const m of this.meters) m.configure(cfg);
    for (const g of this.round) g.draw();
  }

  update(s: EngineState, dt: number) {
    const active = new Set(s.warnings.map((w) => w.code));
    for (const g of this.round) g.update(s, dt, active);
    for (const m of this.meters) m.update(s, dt, active);
  }

  redraw() {
    for (const g of this.round) g.draw();
  }
}
