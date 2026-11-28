// Instrument panel: round gauges (canvas) for rpm, torque, power and boost, plus linear meters
// (DOM) for temperatures, oil pressure, consumption, λ and knock/soot. Yellow marks limits only.
import { evSystemPowerKw } from "../core/index.ts";
import type { EngineConfig, EngineState, EngineSummary, EvConfig, WarningCode } from "../core/index.ts";
import { fitCanvas, reducedMotion, tokens } from "./canvas.ts";
import { setText } from "./dom.ts";
import { evConsumption } from "./ev-fields.ts";
import { clamp, fmt, mixHex, niceCeil, tickStep } from "./format.ts";
import { ICON2 } from "./layouts/icons.ts";
import { UNITS, makeSwitchable, saveUnit, savedUnit, type UnitOpt } from "./units.ts";
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
  /** Labelled tick spacing in display units (default: scaleDiv, else automatic); EV motor speed: 2000 (#108). */
  scaleStep?: number;
  value: (s: EngineState) => number;
  warns: WarningCode[];
  /** Switchable display units (first = base). */
  units?: readonly UnitOpt[];
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
  private unitIdx = 0;
  private unitEl!: HTMLElement;
  private lastState?: EngineState;

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
    this.unitEl = unit;
    cap.append(lab, this.readout, unit);
    this.el.append(this.canvas, cap);
    const units = def.units;
    if (units && units.length > 1) {
      this.unitIdx = savedUnit(def.id, units);
      this.unitEl.textContent = units[this.unitIdx]!.unit;
      makeSwitchable(this.el, def.label, () => {
        this.unitIdx = (this.unitIdx + 1) % units.length;
        saveUnit(def.id, units, this.unitIdx);
        this.unitEl.textContent = units[this.unitIdx]!.unit;
        this.dirty = true;
        if (this.lastState) this.readout.textContent = this.fmtShown(this.def.value(this.lastState), this.lastState);
        this.draw();
      });
    }
  }

  private get unitOpt(): UnitOpt | undefined {
    return this.def.units?.[this.unitIdx];
  }

  /** Global unit setting changed or overrides were reset (#24): pick the unit again. */
  syncUnit() {
    const units = this.def.units;
    if (!units || units.length < 2) return;
    this.unitIdx = savedUnit(this.def.id, units);
    this.unitEl.textContent = units[this.unitIdx]!.unit;
    this.dirty = true;
    if (this.lastState) this.readout.textContent = this.fmtShown(this.def.value(this.lastState), this.lastState);
    this.draw();
  }

  private fmtShown(v: number, s?: EngineState): string {
    const u = this.unitOpt;
    if (!u) return fmt(v, this.def.decimals);
    const d = u.conv(v, s);
    return Number.isFinite(d) ? fmt(d, u.decimals) : "–";
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
    this.lastState = s;
    setText(this.readout, this.fmtShown(target, s));
    const alarm = this.def.warns.some((w) => active.has(w)) || target >= this.limitFrom;
    if (alarm !== this.alarm) {
      this.alarm = alarm;
      this.el.classList.toggle("is-limit", alarm);
      this.dirty = true;
    }
    if (this.dirty || Math.abs(prev - this.needle) > (this.max - this.min) * 1e-4) this.draw();
  }

  draw() {
    // hidden (menu open, #42): nothing to lay out; draw on the next visible frame
    if (!this.canvas.clientWidth) {
      this.dirty = true;
      return;
    }
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
    // ticks: laid out in the shown unit (linear conversion), angles from the base value
    const u = this.unitOpt;
    const k = u ? u.conv(1) - u.conv(0) : 1;
    const off = u ? u.conv(0) : 0;
    const toBase = (d: number) => (d - off) / k;
    const div = this.def.scaleDiv ?? 1;
    const dMin = this.min * k + off;
    const dSpan = span * k;
    const step = this.def.scaleStep ?? (div > 1 ? div : tickStep(dSpan, R > 70 ? 8 : 2) || 1); // guard: zero span → no endless loop
    const minor = step / (R > 70 ? 5 : 2);
    ctx.strokeStyle = t.alu;
    const first = Math.ceil(dMin / minor - 1e-9) * minor;
    for (let d = first; d <= dMin + dSpan + 1e-9; d += minor) {
      const a = ang(toBase(d));
      const major = Math.abs(d / step - Math.round(d / step)) < 1e-6;
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
    for (let d = Math.ceil(dMin / step - 1e-9) * step; d <= dMin + dSpan + 1e-9; d += step) {
      const a = ang(toBase(d));
      const r = R * 0.6;
      const val = d / div;
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
  /** Switchable display units (first = base). */
  units?: readonly UnitOpt[];
  /** Config-dependent label (e.g. "Zylinderkopf" for air cooling, issue #25). */
  labelFor?: (cfg: EngineConfig) => string;
  /** Status lamp next to the label (#135: "Kat heizt"), green while `on` is true. */
  lamp?: { label: string; icon: string; on: (s: EngineState) => boolean };
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
  private unitIdx = 0;
  private lastState?: EngineState;
  private lampEl: HTMLElement | null = null;

  constructor(readonly def: MeterDef) {
    this.el = document.createElement("div");
    this.el.className = "meter";
    this.el.dataset.meter = def.id;
    this.el.innerHTML = `<span class="meter__label"></span><output class="num meter__value"></output><span class="meter__unit"></span><span class="meter__track" aria-hidden="true"><span class="meter__fill"></span><span class="meter__mark"></span></span>`;
    this.el.querySelector(".meter__label")!.textContent = def.label;
    if (def.lamp) {
      this.lampEl = document.createElement("span");
      this.lampEl.className = "meter__lamp";
      this.lampEl.dataset.state = "off";
      this.lampEl.setAttribute("role", "img");
      this.lampEl.setAttribute("aria-label", `${def.lamp.label}: aus`);
      this.lampEl.title = def.lamp.label;
      this.lampEl.innerHTML = def.lamp.icon;
      this.el.querySelector(".meter__label")!.append(" ", this.lampEl);
    }
    this.el.querySelector(".meter__unit")!.textContent = def.unit;
    this.fill = this.el.querySelector(".meter__fill")!;
    this.mark = this.el.querySelector(".meter__mark")!;
    this.out = this.el.querySelector(".meter__value")!;
    const units = def.units;
    if (units && units.length > 1) {
      const unitEl = this.el.querySelector<HTMLElement>(".meter__unit")!;
      this.unitIdx = savedUnit(def.id, units);
      unitEl.textContent = units[this.unitIdx]!.unit;
      makeSwitchable(this.el, def.label, () => {
        this.unitIdx = (this.unitIdx + 1) % units.length;
        saveUnit(def.id, units, this.unitIdx);
        unitEl.textContent = units[this.unitIdx]!.unit;
        if (this.lastState) this.update(this.lastState, 0, new Set());
      });
    }
  }

  /** Global unit setting changed or overrides were reset (#24). */
  syncUnit() {
    const units = this.def.units;
    if (!units || units.length < 2) return;
    this.unitIdx = savedUnit(this.def.id, units);
    this.el.querySelector<HTMLElement>(".meter__unit")!.textContent = units[this.unitIdx]!.unit;
    if (this.lastState) this.update(this.lastState, 0, new Set());
  }

  configure(cfg: EngineConfig) {
    if (this.def.labelFor) setText(this.el.querySelector<HTMLElement>(".meter__label")!, this.def.labelFor(cfg));
    this.max = this.def.max(cfg);
    this.limit = this.def.limit(cfg);
    const p = clamp((this.limit - this.def.min) / (this.max - this.def.min), 0, 1);
    this.mark.style.left = `${p * 100}%`;
    this.el.hidden = this.def.visible ? !this.def.visible(cfg) : false;
  }

  update(s: EngineState, dt: number, active: Set<WarningCode>) {
    this.lastState = s;
    if (this.lampEl && this.def.lamp) {
      const st = s.running && this.def.lamp.on(s) ? "on" : "off";
      if (this.lampEl.dataset.state !== st) {
        this.lampEl.dataset.state = st;
        this.lampEl.setAttribute("aria-label", `${this.def.lamp.label}: ${st === "on" ? "an" : "aus"}`);
      }
    }
    const v = this.def.value(s);
    const ok = Number.isFinite(v);
    const tau = reducedMotion() ? 0.35 : 0.08;
    if (ok) this.shown += (v - this.shown) * (1 - Math.exp(-dt / tau));
    const u = this.def.units?.[this.unitIdx];
    const shown = ok && u ? u.conv(v, s) : v;
    setText(this.out, ok && Number.isFinite(shown) ? fmt(shown, u ? u.decimals : this.def.decimals) : "–");
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
const airCooled = (c: EngineConfig) => c.cooling.type === "air" || c.cooling.type === "oil-air";

export class InstrumentPanel {
  readonly el: HTMLElement;
  private rpm: RoundGauge;
  private round: RoundGauge[];
  private meters: Meter[];
  /** Board-net voltage of the last frame (#83). */
  private batteryV = Number.NaN;
  /** 24 V board net (truck/bus): the voltmeter scale is reconfigured. */
  private v24 = false;
  private cfgNow: EngineConfig | null = null;

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
      new RoundGauge({ id: "torque", label: "Drehmoment", unit: "Nm", decimals: 0, value: (s) => Math.max(0, s.torqueNm), warns: ["conrod-stress"], units: UNITS.torque }),
      new RoundGauge({ id: "power", label: "Leistung", unit: "kW", decimals: 0, value: (s) => Math.max(0, s.powerKw), warns: [], units: UNITS.power }),
      new RoundGauge({ id: "boost", label: "Ladedruck", unit: "bar", decimals: 2, value: (s) => s.boostBar, warns: ["overboost", "turbo-overspeed"], units: UNITS.pressure(2) }),
    ];
    const T = (id: string, label: string, max: number | ((c: EngineConfig) => number), limit: (c: EngineConfig) => number, value: (s: EngineState) => number, warns: WarningCode[]): MeterDef => ({
      id, label, unit: "°C", decimals: 0, min: 0, max: typeof max === "number" ? () => max : max, limit, value, warns, thermal: true, units: UNITS.temp,
    });
    this.meters = [
      // air / oil-air cooling (#25): no coolant, the meter shows the cylinder-head temperature
      new Meter({ ...T("coolant", "Kühlmittel", (c) => (airCooled(c) ? 300 : 130), (c) => (airCooled(c) ? 220 : L.coolantMaxC), (s) => s.coolantC, ["overheat-coolant"]), labelFor: (c: EngineConfig) => (airCooled(c) ? "Zylinderkopf" : "Kühlmittel") }),
      new Meter(T("oil", "Öl", 160, () => L.oilMaxC, (s) => s.oilC, ["overheat-oil"])),
      new Meter(T("egt", "Abgas", 1100, egtLimitC, (s) => s.egtC, ["egt-high"])),
      // catalyst temperature (#135): only with a catalyst; limit = overheat threshold 900 °C (core simulator.ts)
      new Meter({ ...T("cat", "Kat", 1000, () => 900, (s) => s.catalystC ?? Number.NaN, ["catalyst-overheat"]), visible: (c: EngineConfig) => c.exhaust.catalyst,
        lamp: { label: "Kat heizt", icon: ICON2.cat, on: (s) => s.coldStart === "cat-heating" } }),
      new Meter({ id: "oilp", label: "Öldruck", unit: "bar", decimals: 1, min: 0, max: () => 8, limit: () => L.oilPressureMinBar, lowLimit: true, value: (s) => s.oilPressureBar, warns: ["low-oil-pressure"], units: UNITS.pressure(1) }),
      new Meter({ id: "flow", label: "Verbrauch", unit: "l/h", decimals: 1, min: 0, max: (c) => niceCeil(Math.max(10, c.block.cylinders * c.block.boreMm * 0.25)), limit: () => Infinity, value: (s) => s.fuelFlowLh, warns: [], units: UNITS.fuelFlow }),
      new Meter({ id: "bsfc", label: "Spezifisch", unit: "g/kWh", decimals: 0, min: 150, max: () => 500, limit: () => Infinity, value: (s) => s.bsfcGkWh, warns: [], units: UNITS.bsfc }),
      new Meter({ id: "lambda", label: "Lambda", unit: "", decimals: 2, min: 0.6, max: (c) => (isDiesel(c) ? 4 : 1.4), limit: lambdaLimit, lowLimit: true, value: (s) => (s.lambda > 9 ? Number.NaN : s.lambda), warns: ["smoke"] }),
      new Meter({ id: "knock", label: "Klopfen", unit: "%", decimals: 0, min: 0, max: () => 100, limit: () => L.knockMax * 100, value: (s) => s.knock * 100, warns: ["knock"], visible: (c) => !isDiesel(c) }),
      // charge-air temperature (#105) and board-net voltage (#83, core vehicle-systems.ts)
      new Meter({ ...T("intake", "Ansaugluft", 100, () => Infinity, (s) => s.intakeAirC ?? Number.NaN, []), min: -20 }),
      new Meter({ id: "battery", label: "Batterie", unit: "V", decimals: 1, min: 8, max: () => (this.v24 ? 32 : 16), limit: () => (this.v24 ? 23.6 : 11.8), lowLimit: true, value: () => this.batteryV, warns: [] }),
      new Meter({ id: "smoke", label: "Ruß", unit: "%", decimals: 0, min: 0, max: () => 100, limit: () => L.smokeMax * 100, value: (s) => s.smoke * 100, warns: ["smoke"], visible: isDiesel }),
    ];
    const dial = document.createElement("div");
    dial.className = "instruments__dials";
    dial.append(...this.round.map((g) => g.el));
    const lin = document.createElement("div");
    lin.className = "instruments__meters";
    lin.append(...this.meters.map((m) => m.el));
    this.el.append(dial, lin);
    this.iceEls = [dial, lin];
  }

  // --- electric car (#108): own instruments, the combustion ones are hidden ---------------------------------------
  private iceEls: HTMLElement[] = [];
  private ev: { cfg: EvConfig; round: RoundGauge[]; meters: Meter[]; els: HTMLElement[] } | null = null;
  private evOn = false;

  /** Electric car on (motor speed, power incl. regen, torque, battery and motor values) or off (null). */
  setElectric(ev: EvConfig | null) {
    this.evOn = !!ev;
    this.el.dataset.drive = ev ? "ev" : "ice";
    if (ev && (!this.ev || this.ev.cfg !== ev)) {
      this.ev?.els.forEach((e) => e.remove());
      const E = (s: EngineState) => s.ev;
      const maxRpm = Math.max(...ev.motors.map((m) => m.maxRpm));
      const sys = evSystemPowerKw(ev);
      // same order as the combustion dials (#154): speed, torque, power
      const round = [
        new RoundGauge({ id: "ev-rpm", label: "Motordrehzahl", unit: "1/min", decimals: 0, scaleLabel: "× 1000 1/min", scaleDiv: 1000, scaleStep: maxRpm > 12000 ? 2000 : 1000, value: (s) => s.rpm, warns: [] }, true),
        new RoundGauge({ id: "ev-torque", label: "Drehmoment", unit: "Nm", decimals: 0, value: (s) => s.torqueNm, warns: ["motor-hot"], units: UNITS.torque }),
        new RoundGauge({ id: "ev-power", label: "Akkuleistung", unit: "kW", decimals: 0, value: (s) => E(s)?.powerKw ?? 0, warns: ["battery-hot"], units: UNITS.power }),
      ];
      round[0]!.setScale(0, Math.ceil(maxRpm / 1000) * 1000, maxRpm * 0.98);
      const tq = ev.motors.reduce((a, m) => a + m.peakTorqueNm * (m.ratio / (ev.motors.find((x) => x.axle === "rear") ?? ev.motors[0]!).ratio), 0);
      round[1]!.setScale(-niceCeil(tq * 0.5), niceCeil(tq * 1.1), Infinity);
      round[2]!.setScale(-Math.max(50, niceCeil(sys * 0.3)), niceCeil(sys * 1.1), Infinity);
      const temp = (id: string, label: string, max: number, limit: number, value: (s: EngineState) => number, warns: WarningCode[]): MeterDef => ({
        id, label, unit: "°C", decimals: 0, min: 0, max: () => max, limit: () => limit, value, warns, thermal: true, units: UNITS.temp,
      });
      // same rows as the combustion list (#154): temperatures, load, pressure ↔ voltage, consumption, energy last
      const meters = [
        new Meter(temp("ev-motor", "E-Motor", 180, 150, (s) => E(s)?.motorC ?? Number.NaN, ["motor-hot"])),
        new Meter(temp("ev-batt", "Akku", 70, 55, (s) => E(s)?.batteryC ?? Number.NaN, ["battery-hot"])),
        new Meter({ id: "ev-amp", label: "Akkustrom", unit: "A", decimals: 0, min: 0, max: () => niceCeil(ev.battery.maxDischargeC * ev.battery.cellAh * ev.battery.parallelCells), limit: () => Infinity, value: (s) => Math.abs(E(s)?.packA ?? Number.NaN), warns: [] }),
        new Meter({ id: "ev-regen", label: "Rekuperation", unit: "kW", decimals: 0, min: 0, max: () => niceCeil(Math.max(50, sys * 0.4)), limit: () => Infinity, value: (s) => E(s)?.regenKw ?? 0, warns: [] }),
        new Meter({ id: "ev-volt", label: "Akkuspannung", unit: "V", decimals: 0, min: 0, max: () => niceCeil(ev.battery.seriesCells * 4.25), limit: () => ev.battery.seriesCells * 3.1, lowLimit: true, value: (s) => E(s)?.packV ?? Number.NaN, warns: [] }),
        new Meter({ id: "ev-cons", label: "Ø Verbrauch", unit: "kWh/100 km", decimals: 1, min: 0, max: () => 60, limit: () => Infinity, value: (s) => { const e = E(s); return e ? evConsumption(e) : Number.NaN; }, warns: [] }),
        new Meter({ id: "ev-soc", label: "Ladezustand", unit: "%", decimals: 1, min: 0, max: () => 100, limit: () => 10, lowLimit: true, value: (s) => (E(s)?.soc ?? Number.NaN) * 100, warns: ["battery-low"] }),
      ];
      const cfgStub = {} as EngineConfig;
      for (const m of meters) m.configure(cfgStub);
      const dial = document.createElement("div");
      dial.className = "instruments__dials instruments__dials--ev";
      dial.append(...round.map((g) => g.el));
      const lin = document.createElement("div");
      lin.className = "instruments__meters instruments__meters--ev";
      lin.append(...meters.map((m) => m.el));
      this.el.append(dial, lin);
      this.ev = { cfg: ev, round, meters, els: [dial, lin] };
    }
    for (const e of this.iceEls) e.hidden = this.evOn;
    for (const e of this.ev?.els ?? []) e.hidden = !this.evOn;
    this.redraw();
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
    this.cfgNow = cfg;
    for (const m of this.meters) m.configure(cfg);
    for (const g of this.round) g.draw();
  }

  update(s: EngineState, dt: number, batteryV = Number.NaN) {
    this.batteryV = batteryV;
    const v24 = batteryV > 20;
    if (v24 !== this.v24 && this.cfgNow) {
      this.v24 = v24;
      this.meters.find((m) => m.def.id === "battery")?.configure(this.cfgNow);
    }
    const active = new Set(s.warnings.map((w) => w.code));
    if (this.evOn && this.ev) {
      for (const g of this.ev.round) g.update(s, dt, active);
      for (const m of this.ev.meters) m.update(s, dt, active);
      return;
    }
    for (const g of this.round) g.update(s, dt, active);
    for (const m of this.meters) m.update(s, dt, active);
  }

  redraw() {
    for (const g of this.evOn && this.ev ? this.ev.round : this.round) g.draw();
  }

  /** Re-reads the unit of every instrument (global setting or reset of the overrides, #24). */
  syncUnits() {
    for (const g of this.round) g.syncUnit();
    for (const m of this.meters) m.syncUnit();
  }
}
