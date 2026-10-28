// Motor-Schnittbild (SVG). Left: cross-section along the crank axis (one cylinder per bank, true
// slider-crank kinematics). Right: longitudinal section of every bank, all pistons moving with
// crankAngleDeg and the firing offsets. Charger and intercooler appear when fitted.
import type { EngineConfig, EngineState, EngineSummary } from "../core/index.ts";
import { reducedMotion } from "./canvas.ts";
import { banks, cylinderPhase, firingOffsets, strokeOf } from "./geometry.ts";
import type { BankLayout } from "./geometry.ts";

const NS = "http://www.w3.org/2000/svg";
const W = 860;
const H = 290;
const FRONT_W = 330;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

interface FrontCyl {
  bank: BankLayout;
  cyl: number;
  piston: SVGRectElement;
  rod: SVGLineElement;
  pin: SVGCircleElement;
  charge: SVGRectElement;
  ux: number;
  uy: number;
  deck: number;
  ph: number;
}

interface RowCyl {
  cyl: number;
  piston: SVGGElement;
  rod: SVGLineElement;
  charge: SVGRectElement;
  x: number;
  top: number;
  cx: number;
  crankY: number;
}

const LAYOUT_NAME: Record<EngineConfig["block"]["layout"], string> = {
  inline: "Reihe",
  v: "V",
  boxer: "Boxer",
  vr: "VR",
  w: "W",
};

export function layoutCode(cfg: EngineConfig): string {
  const { layout, cylinders } = cfg.block;
  return layout === "inline" ? `R${cylinders}` : `${LAYOUT_NAME[layout]}${cylinders}`;
}

export class Schematic {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private dyn: SVGGElement;
  private front: FrontCyl[] = [];
  private rows: RowCyl[] = [];
  private crankWeb: SVGLineElement | null = null;
  private impellers: SVGGElement[] = [];
  private offsets: number[] = [];
  private cfg: EngineConfig | null = null;
  private k = 1; // px per mm (front view)
  private rc = 1;
  private rodLen = 1;
  private C = { x: 165, y: 250 };
  private rowStroke = 1;
  private rowK = 1;
  private impAngle = 0;
  private caption: HTMLElement;

  constructor() {
    this.el = document.createElement("figure");
    this.el.className = "schematic";
    this.svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "schematic__svg", role: "img" });
    this.dyn = el("g", {}, this.svg);
    this.caption = document.createElement("figcaption");
    this.caption.className = "schematic__cap";
    this.el.append(this.svg, this.caption);
  }

  configure(cfg: EngineConfig, sum: EngineSummary) {
    this.cfg = cfg;
    this.offsets = firingOffsets(cfg, sum);
    this.dyn.replaceChildren();
    this.front = [];
    this.rows = [];
    this.impellers = [];
    const bs = banks(cfg);
    const { boreMm, strokeMm, conrodLengthMm, cylinders } = cfg.block;
    this.svg.setAttribute(
      "aria-label",
      `Schnittbild: ${layoutCode(cfg)}-Motor, ${cylinders} Zylinder, Bohrung ${boreMm} mm, Hub ${strokeMm} mm` +
        (cfg.induction.aspiration !== "naturally-aspirated" ? ", aufgeladen" : ""),
    );
    this.drawFront(cfg, bs, boreMm, strokeMm, conrodLengthMm);
    this.drawRows(cfg, bs, boreMm, strokeMm);
    this.caption.textContent = `Querschnitt und Längsschnitt · Zündfolge ${firingOrderText(this.offsets)}`;
  }

  private drawFront(cfg: EngineConfig, bs: BankLayout[], bore: number, stroke: number, rod: number) {
    const g = el("g", { class: "sx-front" }, this.dyn);
    const horizontal = cfg.block.layout === "boxer";
    const reach = rod + stroke / 2 + bore * 0.55 + 18;
    const avail = horizontal ? FRONT_W / 2 - 14 : 200;
    this.k = Math.min(0.9, avail / reach);
    this.rc = (stroke / 2) * this.k;
    this.rodLen = rod * this.k;
    this.C = horizontal ? { x: FRONT_W / 2, y: 150 } : { x: FRONT_W / 2, y: 228 };
    const C = this.C;
    const bw = bore * this.k;
    const ph = bore * 0.42 * this.k; // piston height
    // crankcase
    el("circle", { cx: C.x, cy: C.y, r: this.rc + 22 * this.k + 8, class: "sx-case" }, g);
    bs.forEach((bank) => {
      const staggerList = bank.staggered ? bank.cylinders.slice(0, 2) : bank.cylinders.slice(0, 1);
      staggerList.forEach((cyl, si) => {
        const a = ((bank.angleDeg + (bank.staggered ? (si === 0 ? -7.5 : 7.5) : 0)) * Math.PI) / 180;
        const ux = Math.sin(a);
        const uy = -Math.cos(a);
        const deg = (a * 180) / Math.PI;
        // cylinder liner + head along the bank axis, drawn in a rotated frame
        const frame = el("g", { transform: `translate(${C.x} ${C.y}) rotate(${deg})` }, g);
        const dTop = this.rodLen + this.rc + ph * 0.6 + 2; // deck height above crank centre (crown at TDC + clearance)
        const linerBot = this.rodLen - this.rc - 4;
        const fade = bank.staggered && si === 1 ? " sx-behind" : "";
        el("rect", { x: -bw / 2 - 5, y: -(dTop + 6), width: bw + 10, height: dTop + 6 - linerBot, class: "sx-liner" + fade }, frame);
        el("rect", { x: -bw / 2, y: -(dTop + 6), width: bw, height: dTop + 6 - linerBot, class: "sx-bore" + fade }, frame);
        // head
        el("rect", { x: -bw / 2 - 10, y: -(dTop + 6 + 18 * this.k + 10), width: bw + 20, height: 18 * this.k + 10, rx: 2, class: "sx-head" + fade }, frame);
        // valves hint
        el("line", { x1: -bw * 0.22, y1: -(dTop + 6 + 14), x2: -bw * 0.22, y2: -(dTop + 6), class: "sx-valve" + fade }, frame);
        el("line", { x1: bw * 0.22, y1: -(dTop + 6 + 14), x2: bw * 0.22, y2: -(dTop + 6), class: "sx-valve" + fade }, frame);
        const charge = el("rect", { x: -bw / 2, y: -(dTop + 6), width: bw, height: 6, class: "sx-charge" }, frame);
        const rodEl = el("line", { class: "sx-rod" + fade }, g);
        const piston = el("rect", { x: -bw / 2 + 1, width: bw - 2, height: ph, rx: 2, class: "sx-piston" + fade }, frame);
        const pin = el("circle", { r: Math.max(3, 9 * this.k), class: "sx-pin" }, g);
        this.front.push({ bank, cyl, piston, rod: rodEl, pin, charge, ux, uy, deck: dTop + 6, ph });
      });
    });
    // crank web drawn last so it sits on top of the rods' big ends
    this.crankWeb = el("line", { x1: C.x, y1: C.y, x2: C.x, y2: C.y - this.rc, class: "sx-web" }, g);
    el("circle", { cx: C.x, cy: C.y, r: Math.max(4, 14 * this.k), class: "sx-main" }, g);
    this.drawCharger(cfg, g);
  }

  private drawCharger(cfg: EngineConfig, g: SVGGElement) {
    const asp = cfg.induction.aspiration;
    if (asp === "naturally-aspirated") return;
    const twin = asp === "twin-turbo-parallel" || asp === "twin-turbo-sequential";
    const roots = asp === "supercharger-roots";
    const sx = FRONT_W - 34;
    const sy = 64;
    if (roots) {
      // Roots blower sits on top, between the banks
      const bx = this.C.x - 34;
      const by = 18;
      el("rect", { x: bx, y: by, width: 68, height: 30, rx: 4, class: "sx-charger" }, g);
      for (const dx of [17, 51]) {
        const imp = el("g", { transform: `translate(${bx + dx} ${by + 15})` }, g);
        el("path", { d: "M-11 0a5.5 5.5 0 0 1 11 0a5.5 5.5 0 0 0 11 0", class: "sx-lobe", transform: "translate(0 0)" }, imp);
        this.impellers.push(imp);
      }
      return;
    }
    const n = twin ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const cx = sx;
      const cy = sy + i * 62;
      el("circle", { cx, cy, r: 24, class: "sx-charger" }, g);
      el("path", { d: `M${cx} ${cy - 24}a24 24 0 0 1 24 24h-8a16 16 0 0 0-16-16z`, class: "sx-volute" }, g);
      const imp = el("g", { transform: `translate(${cx} ${cy})` }, g);
      for (let b = 0; b < 6; b++) el("line", { x1: 0, y1: 0, x2: 0, y2: -14, class: "sx-blade", transform: `rotate(${b * 60})` }, imp);
      this.impellers.push(imp);
      if (asp === "e-turbo") el("rect", { x: cx - 8, y: cy + 26, width: 16, height: 9, rx: 1, class: "sx-motor" }, g);
      if (asp === "twin-turbo-sequential") {
        const t = el("text", { x: cx - 30, y: cy + 4, class: "sx-tag", "text-anchor": "end" }, g);
        t.textContent = i === 0 ? "klein" : "groß";
      }
    }
    if (cfg.induction.intercooler !== "none") {
      const ix = 12;
      const iy = 30;
      el("rect", { x: ix, y: iy, width: 22, height: 70, rx: 2, class: "sx-cooler" }, g);
      for (let f = 1; f < 7; f++) el("line", { x1: ix + 3, y1: iy + f * 10, x2: ix + 19, y2: iy + f * 10, class: "sx-fin" }, g);
    }
  }

  private drawRows(cfg: EngineConfig, bs: BankLayout[], bore: number, stroke: number) {
    const g = el("g", { class: "sx-rows", transform: `translate(${FRONT_W + 20} 0)` }, this.dyn);
    const areaW = W - FRONT_W - 30;
    const perRow = Math.max(...bs.map((b) => b.cylinders.length));
    const rowsN = bs.length;
    const rowH = (H - 20) / rowsN;
    const pitch = Math.min(64, areaW / perRow);
    const cw = pitch * Math.min(0.86, 0.62 + bore / 400);
    this.rowK = Math.min((rowH * 0.34) / stroke, cw / bore * 1.1);
    this.rowStroke = stroke * this.rowK;
    const ph = Math.min(cw * 0.42, this.rowStroke * 0.55);
    bs.forEach((bank, r) => {
      const y0 = 6 + r * rowH;
      const label = el("text", { x: 0, y: y0 + 8, class: "sx-label" }, g);
      label.textContent = rowsN > 1 ? `Bank ${r === 0 ? "A" : "B"}` : "Zylinderreihe";
      const top = y0 + 24;
      const crankY = top + ph + this.rowStroke * 1.5 + 10;
      const startX = (areaW - pitch * bank.cylinders.length) / 2;
      el("line", { x1: startX, y1: crankY, x2: startX + pitch * bank.cylinders.length, y2: crankY, class: "sx-shaft" }, g);
      bank.cylinders.forEach((cyl, i) => {
        const x = startX + i * pitch + (pitch - cw) / 2;
        const cx = x + cw / 2;
        const off = bank.staggered ? (i % 2 ? 6 : -6) : 0;
        el("rect", { x: x - 3, y: top - 4 + off, width: cw + 6, height: ph + this.rowStroke + 8, class: "sx-liner" }, g);
        el("rect", { x, y: top + off, width: cw, height: ph + this.rowStroke + 4, class: "sx-bore" }, g);
        const charge = el("rect", { x, y: top + off, width: cw, height: 1, class: "sx-charge" }, g);
        const rod = el("line", { class: "sx-rod" }, g);
        const piston = el("g", {}, g);
        el("rect", { x: x + 1, y: 0, width: cw - 2, height: ph, rx: 2, class: "sx-piston" }, piston);
        el("line", { x1: x + 3, y1: ph * 0.3, x2: x + cw - 3, y2: ph * 0.3, class: "sx-ring" }, piston);
        const num = el("text", { x: cx, y: crankY + 18, class: "sx-num", "text-anchor": "middle" }, g);
        num.textContent = String(cyl + 1);
        this.rows.push({ cyl, piston, rod, charge, x, top: top + off, cx, crankY });
      });
    });
  }

  update(s: EngineState, dt: number) {
    if (!this.cfg) return;
    // With reduced motion the pistons are drawn at a slowed, stroboscopic angle so they stay readable.
    const crank = reducedMotion() ? (s.t * 30) % 720 * (s.rpm > 1 ? 1 : 0) + (s.rpm > 1 ? 0 : s.crankAngleDeg) : s.crankAngleDeg;
    const C = this.C;
    for (const f of this.front) {
      const phase = cylinderPhase(crank, this.offsets[f.cyl] ?? 0);
      const th = (phase * Math.PI) / 180;
      const d = this.rc * Math.cos(th) + Math.sqrt(this.rodLen ** 2 - (this.rc * Math.sin(th)) ** 2);
      // crank pin: rotated by phase from the bank axis
      const a = Math.atan2(f.ux, -f.uy) + th;
      const px = C.x + this.rc * Math.sin(a);
      const py = C.y - this.rc * Math.cos(a);
      const wx = C.x + f.ux * d;
      const wy = C.y + f.uy * d;
      f.rod.setAttribute("x1", px.toFixed(1));
      f.rod.setAttribute("y1", py.toFixed(1));
      f.rod.setAttribute("x2", wx.toFixed(1));
      f.rod.setAttribute("y2", wy.toFixed(1));
      f.pin.setAttribute("cx", px.toFixed(1));
      f.pin.setAttribute("cy", py.toFixed(1));
      const crown = d + f.ph * 0.6;
      f.piston.setAttribute("y", (-crown).toFixed(1));
      f.charge.setAttribute("height", Math.max(1, f.deck - crown).toFixed(1));
      setCharge(f.charge, phase, s.running);
      if (f === this.front[0] && this.crankWeb) {
        this.crankWeb.setAttribute("x2", px.toFixed(1));
        this.crankWeb.setAttribute("y2", py.toFixed(1));
      }
    }
    for (const r of this.rows) {
      const phase = cylinderPhase(crank, this.offsets[r.cyl] ?? 0);
      const th = (phase * Math.PI) / 180;
      const rr = this.rowStroke / 2;
      const l = rr * 3;
      const s0 = rr * (1 - Math.cos(th)) + l - Math.sqrt(l * l - (rr * Math.sin(th)) ** 2);
      const y = r.top + 2 + s0;
      r.piston.setAttribute("transform", `translate(0 ${y.toFixed(1)})`);
      const ph = Number((r.piston.firstChild as SVGRectElement).getAttribute("height"));
      r.rod.setAttribute("x1", r.cx.toFixed(1));
      r.rod.setAttribute("y1", (y + ph * 0.6).toFixed(1));
      r.rod.setAttribute("x2", (r.cx + rr * Math.sin(th) * 0.9).toFixed(1));
      r.rod.setAttribute("y2", (r.crankY - rr * Math.cos(th) * 0.5).toFixed(1));
      r.charge.setAttribute("height", Math.max(1, y - r.top).toFixed(1));
      setCharge(r.charge, phase, s.running);
    }
    if (this.impellers.length) {
      const rps = Math.min(s.turboRpm > 0 ? s.turboRpm / 60 : s.boostBar * 40 + s.rpm / 120, 60);
      this.impAngle = (this.impAngle + rps * 360 * dt * (reducedMotion() ? 0.1 : 0.25)) % 360;
      for (const imp of this.impellers) {
        const base = imp.getAttribute("transform")!.replace(/ rotate\([^)]*\)/, "");
        imp.setAttribute("transform", `${base} rotate(${this.impAngle.toFixed(1)})`);
      }
    }
  }
}

function setCharge(r: SVGRectElement, phase: number, running: boolean) {
  const st = running ? strokeOf(phase) : "intake";
  const cls = running && st === "power" && phase < 70 ? "sx-charge is-burn" : `sx-charge is-${st}`;
  if (r.getAttribute("class") !== cls) r.setAttribute("class", cls);
}

function firingOrderText(offsets: number[]): string {
  return offsets
    .map((o, i) => [o, i + 1] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, n]) => n)
    .join("-");
}

export { firingOrderText };
