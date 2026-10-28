// Linienschreiber: a paper strip that runs while the engine runs. Three pens write rpm, torque and
// power live. "Volllastkurve messen" prints the full-load diagram (dynoSweep) onto the measuring
// sheet; earlier runs stay on the sheet, faded, for comparison.
import { dynoSweep } from "../core/index.ts";
import type { DynoPoint, EngineConfig, EngineState, EngineSummary } from "../core/index.ts";
import { fitCanvas, reducedMotion, tokens } from "./canvas.ts";
import { fmt, niceCeil, tickStep } from "./format.ts";

/** Paper feed in CSS px per second of simulation time. */
const FEED_PX_S = 36;
const SAMPLE_HZ = 30;
const MAX_SAMPLES = 60 * SAMPLE_HZ;
const MAX_RUNS = 4;

interface Sample {
  t: number;
  rpm: number;
  tq: number;
  pw: number;
}

export interface Run {
  label: string;
  points: DynoPoint[];
  peakTorque: DynoPoint;
  peakPower: DynoPoint;
}

export function makeRun(cfg: EngineConfig, points: DynoPoint[]): Run {
  let pt = points[0]!;
  let pp = points[0]!;
  for (const p of points) {
    if (p.torqueNm > pt.torqueNm) pt = p;
    if (p.powerKw > pp.powerKw) pp = p;
  }
  return { label: cfg.name, points, peakTorque: pt, peakPower: pp };
}

export class Recorder {
  readonly el: HTMLElement;
  private strip: HTMLCanvasElement;
  private sheet: HTMLCanvasElement;
  private legend: HTMLOListElement;
  private measureBtn: HTMLButtonElement;
  private clearBtn: HTMLButtonElement;
  private samples: Sample[] = [];
  private lastSampleT = -1;
  private rpmMax = 6000;
  private tqMax = 400;
  private pwMax = 150;
  private limitRpm = 6000;
  private runs: Run[] = [];
  /** Printing progress 0 … 1 of the newest run. */
  private print = 1;
  private cfg: EngineConfig | null = null;
  private live: { rpm: number; tq: number; pw: number } = { rpm: 0, tq: 0, pw: 0 };
  private onMeasure: (() => void) | null = null;

  constructor() {
    this.el = document.createElement("section");
    this.el.className = "recorder";
    this.el.setAttribute("aria-label", "Linienschreiber");
    this.el.innerHTML = `
      <div class="recorder__head">
        <h2 class="recorder__title">Linienschreiber</h2>
        <ul class="recorder__inks" aria-label="Stifte">
          <li class="ink ink--rpm">Drehzahl</li>
          <li class="ink ink--torque">Drehmoment</li>
          <li class="ink ink--power">Leistung</li>
        </ul>
        <div class="recorder__actions">
          <button type="button" class="btn btn--primary" data-action="measure">Volllastkurve messen</button>
          <button type="button" class="btn" data-action="clear" disabled>Bogen leeren</button>
        </div>
      </div>
      <div class="recorder__paper">
        <canvas class="recorder__strip" role="img" aria-label="Papierstreifen mit Drehzahl, Drehmoment und Leistung über der Zeit"></canvas>
        <figure class="recorder__sheetwrap">
          <canvas class="recorder__sheet" role="img" aria-label="Messbogen: Volllastkurve Drehmoment und Leistung über der Drehzahl"></canvas>
          <figcaption><ol class="recorder__runs"></ol></figcaption>
        </figure>
      </div>`;
    this.strip = this.el.querySelector(".recorder__strip")!;
    this.sheet = this.el.querySelector(".recorder__sheet")!;
    this.legend = this.el.querySelector(".recorder__runs")!;
    this.measureBtn = this.el.querySelector('[data-action="measure"]')!;
    this.clearBtn = this.el.querySelector('[data-action="clear"]')!;
    this.measureBtn.addEventListener("click", () => this.measure());
    this.clearBtn.addEventListener("click", () => {
      this.runs = [];
      this.renderLegend();
      this.clearBtn.disabled = true;
      this.drawSheet();
    });
    this.renderLegend();
  }

  /** Optional hook (e.g. to announce the result to screen readers). */
  onMeasured(cb: () => void) {
    this.onMeasure = cb;
  }

  configure(cfg: EngineConfig, sum: EngineSummary) {
    this.cfg = cfg;
    this.limitRpm = Math.min(cfg.revLimitRpm, sum.safeMaxRpm);
    // Scales fit the current engine but never shrink below earlier runs on the sheet.
    let tq = sum.peakTorqueNm;
    let pw = sum.peakPowerKw;
    let rpm = cfg.revLimitRpm;
    for (const r of this.runs) {
      tq = Math.max(tq, r.peakTorque.torqueNm);
      pw = Math.max(pw, r.peakPower.powerKw);
      rpm = Math.max(rpm, r.points[r.points.length - 1]!.rpm);
    }
    this.rpmMax = Math.ceil((rpm * 1.05) / 1000) * 1000;
    this.tqMax = niceCeil(Math.max(50, tq * 1.2));
    this.pwMax = niceCeil(Math.max(20, pw * 1.2));
    this.drawSheet();
  }

  measure() {
    if (!this.cfg) return;
    const pts = dynoSweep(this.cfg, { fromRpm: 1000, toRpm: this.cfg.revLimitRpm, stepRpm: 100 }).filter(
      (p) => Number.isFinite(p.torqueNm) && Number.isFinite(p.powerKw),
    );
    if (pts.length < 2) return;
    this.runs.unshift(makeRun(this.cfg, pts));
    this.runs.length = Math.min(this.runs.length, MAX_RUNS);
    this.clearBtn.disabled = false;
    this.print = reducedMotion() ? 1 : 0;
    this.renderLegend();
    this.onMeasure?.();
  }

  get latestRun(): Run | undefined {
    return this.runs[0];
  }

  private renderLegend() {
    this.legend.replaceChildren();
    if (this.runs.length === 0) {
      const li = document.createElement("li");
      li.className = "recorder__empty";
      li.textContent = "Noch kein Messbogen. Miss die Volllastkurve, um Drehmoment und Leistung über der Drehzahl zu sehen.";
      this.legend.append(li);
      return;
    }
    this.runs.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = i === 0 ? "run run--current" : "run";
      li.innerHTML = `<span class="run__name"></span> <span class="num run__vals"></span>`;
      li.querySelector(".run__name")!.textContent = i === 0 ? r.label : `${r.label} (Lauf ${this.runs.length - i})`;
      li.querySelector(".run__vals")!.textContent =
        `${fmt(r.peakTorque.torqueNm)} Nm bei ${fmt(r.peakTorque.rpm)} 1/min, ${fmt(r.peakPower.powerKw)} kW bei ${fmt(r.peakPower.rpm)} 1/min`;
      this.legend.append(li);
    });
  }

  update(s: EngineState, dt: number) {
    this.live = { rpm: s.rpm, tq: Math.max(0, s.torqueNm), pw: Math.max(0, s.powerKw) };
    // The paper only feeds while the engine turns (like a real recorder switched by the test bench).
    const feeding = s.rpm > 1;
    if (feeding && (this.lastSampleT < 0 || s.t - this.lastSampleT >= 1 / SAMPLE_HZ)) {
      this.samples.push({ t: s.t, rpm: s.rpm, tq: this.live.tq, pw: this.live.pw });
      if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
      this.lastSampleT = s.t;
    }
    if (feeding || this.samples.length === 0) this.drawStrip(s.t);
    if (this.print < 1) this.print = Math.min(1, this.print + dt / 1.4);
    this.drawSheet();
  }

  reset() {
    this.samples = [];
    this.lastSampleT = -1;
    this.drawStrip(0);
  }

  redraw(t = this.lastSampleT) {
    this.drawStrip(Math.max(0, t));
    this.drawSheet();
  }

  private paper(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const tk = tokens();
    ctx.fillStyle = tk.paper;
    ctx.fillRect(0, 0, w, h);
  }

  private drawStrip(now: number) {
    const { ctx, w, h } = fitCanvas(this.strip);
    const tk = tokens();
    this.paper(ctx, w, h);
    const padT = 10;
    const padB = 22;
    const padL = 6;
    const penX = w - 46; // pens sit here; paper moves leftwards under them
    const ph = h - padT - padB;
    const y = (v: number, max: number) => padT + ph * (1 - Math.min(1.04, v / max));

    // grid scrolls with the paper
    const offset = (now * FEED_PX_S) % 20;
    ctx.lineWidth = 1;
    ctx.strokeStyle = tk.paperGrid;
    ctx.beginPath();
    for (let x = penX - offset; x > padL; x -= 20) {
      ctx.moveTo(Math.round(x) + 0.5, padT);
      ctx.lineTo(Math.round(x) + 0.5, padT + ph);
    }
    for (let i = 0; i <= 10; i++) {
      const yy = Math.round(padT + (ph * i) / 10) + 0.5;
      ctx.moveTo(padL, yy);
      ctx.lineTo(penX, yy);
    }
    ctx.stroke();
    // heavier second marks every 5 s
    ctx.strokeStyle = mixGrid(tk);
    ctx.beginPath();
    const secOff = (now % 5) * FEED_PX_S;
    for (let x = penX - secOff; x > padL; x -= 5 * FEED_PX_S) {
      ctx.moveTo(Math.round(x) + 0.5, padT);
      ctx.lineTo(Math.round(x) + 0.5, padT + ph);
    }
    ctx.stroke();
    // time labels under the strip
    ctx.fillStyle = tk.engrave;
    ctx.font = `500 11px ${tk.fontNum}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let k = 0, x = penX - secOff; x > padL + 12; k++, x -= 5 * FEED_PX_S) {
      const ts = Math.round(now - (now % 5) - k * 5);
      if (ts < 0) break;
      ctx.fillText(`${ts} s`, x, padT + ph + 5);
    }

    // rev limit line on the rpm scale: yellow = limit
    const ly = y(this.limitRpm, this.rpmMax);
    ctx.strokeStyle = tk.signal;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, ly);
    ctx.lineTo(penX, ly);
    ctx.stroke();
    ctx.setLineDash([]);

    // traces
    const traces: [keyof Sample, number, string][] = [
      ["rpm", this.rpmMax, tk.inkRpm],
      ["tq", this.tqMax, tk.inkTorque],
      ["pw", this.pwMax, tk.inkPower],
    ];
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const [key, max, color] of traces) {
      ctx.beginPath();
      let started = false;
      for (let i = this.samples.length - 1; i >= 0; i--) {
        const smp = this.samples[i]!;
        const x = penX - (now - smp.t) * FEED_PX_S;
        if (x < padL) break;
        const yy = y(smp[key] as number, max);
        if (!started) {
          ctx.moveTo(x, yy);
          started = true;
        } else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    // pen carriage
    ctx.fillStyle = tk.hammerDeep;
    ctx.fillRect(penX + 8, 0, w - penX - 8, h);
    ctx.strokeStyle = tk.hammerDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(penX + 0.5, 0);
    ctx.lineTo(penX + 0.5, h);
    ctx.stroke();
    const pens: [number, number, string][] = [
      [this.live.rpm, this.rpmMax, tk.inkRpm],
      [this.live.tq, this.tqMax, tk.inkTorque],
      [this.live.pw, this.pwMax, tk.inkPower],
    ];
    for (const [v, max, color] of pens) {
      const yy = y(v, max);
      ctx.strokeStyle = tk.aluShade;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(penX, yy);
      ctx.lineTo(w - 4, yy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(penX, yy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    // scale captions inside the carriage
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.font = `600 11px ${tk.fontNum}`;
    const caps: [string, string][] = [
      [`${fmt(this.rpmMax)}`, tk.alu],
      [`${fmt(this.tqMax)}`, "#e8a39d"],
      [`${fmt(this.pwMax)}`, "#a9b9ea"],
    ];
    caps.forEach(([txt, c], i) => {
      ctx.fillStyle = c;
      ctx.fillText(txt, w - 4, 4 + i * 13);
    });
    ctx.fillStyle = tk.aluShade;
    ctx.textBaseline = "bottom";
    ctx.font = `500 10px ${tk.font}`;
    ctx.fillText("Endwert", w - 4, h - 4);
  }

  private drawSheet() {
    const { ctx, w, h } = fitCanvas(this.sheet);
    const tk = tokens();
    this.paper(ctx, w, h);
    const padL = 40;
    const padR = 40;
    const padT = 22;
    const padB = 26;
    const pw = w - padL - padR;
    const ph = h - padT - padB;
    const x = (rpm: number) => padL + (rpm / this.rpmMax) * pw;
    const yT = (v: number) => padT + ph * (1 - v / this.tqMax);
    const yP = (v: number) => padT + ph * (1 - v / this.pwMax);

    // grid
    ctx.strokeStyle = tk.paperGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const rStep = tickStep(this.rpmMax, pw > 320 ? 8 : 4);
    for (let r = 0; r <= this.rpmMax + 1; r += rStep / 2) {
      const xx = Math.round(x(r)) + 0.5;
      ctx.moveTo(xx, padT);
      ctx.lineTo(xx, padT + ph);
    }
    for (let i = 0; i <= 10; i++) {
      const yy = Math.round(padT + (ph * i) / 10) + 0.5;
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + pw, yy);
    }
    ctx.stroke();
    ctx.strokeStyle = mixGrid(tk);
    ctx.strokeRect(padL + 0.5, padT + 0.5, pw, ph);

    // axis labels
    ctx.font = `500 11px ${tk.fontNum}`;
    ctx.fillStyle = tk.engrave;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let r = 0; r <= this.rpmMax + 1; r += rStep) ctx.fillText(fmt(r), x(r), padT + ph + 5);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = tk.inkTorque;
    for (let i = 0; i <= 5; i++) ctx.fillText(fmt((this.tqMax * i) / 5), padL - 5, padT + ph * (1 - i / 5));
    ctx.textAlign = "left";
    ctx.fillStyle = tk.inkPower;
    for (let i = 0; i <= 5; i++) ctx.fillText(fmt((this.pwMax * i) / 5), padL + pw + 5, padT + ph * (1 - i / 5));
    ctx.font = `600 11px ${tk.font}`;
    ctx.textBaseline = "top";
    ctx.fillStyle = tk.inkTorque;
    ctx.textAlign = "right";
    ctx.fillText("Nm", padL - 5, 3);
    ctx.fillStyle = tk.inkPower;
    ctx.textAlign = "left";
    ctx.fillText("kW", padL + pw + 5, 3);

    // limit
    ctx.strokeStyle = tk.signal;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x(this.limitRpm), padT);
    ctx.lineTo(x(this.limitRpm), padT + ph);
    ctx.stroke();
    ctx.setLineDash([]);

    // runs (oldest first, so the current run is on top)
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const run = this.runs[i]!;
      const current = i === 0;
      const n = current ? Math.max(2, Math.ceil(run.points.length * this.print)) : run.points.length;
      const pts = run.points.slice(0, n);
      ctx.globalAlpha = current ? 1 : 0.4;
      ctx.lineWidth = current ? 2.2 : 1.4;
      ctx.setLineDash(current ? [] : [5, 3]);
      ctx.strokeStyle = tk.inkTorque;
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(x(p.rpm), yT(p.torqueNm)) : ctx.moveTo(x(p.rpm), yT(p.torqueNm))));
      ctx.stroke();
      ctx.strokeStyle = tk.inkPower;
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(x(p.rpm), yP(p.powerKw)) : ctx.moveTo(x(p.rpm), yP(p.powerKw))));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (current && this.print >= 1) {
        // peak marks
        ctx.fillStyle = tk.inkTorque;
        ctx.beginPath();
        ctx.arc(x(run.peakTorque.rpm), yT(run.peakTorque.torqueNm), 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = tk.inkPower;
        ctx.beginPath();
        ctx.arc(x(run.peakPower.rpm), yP(run.peakPower.powerKw), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // live operating point: where the engine is right now on this sheet
    if (this.live.rpm > 50) {
      ctx.strokeStyle = tk.engrave;
      ctx.lineWidth = 1.5;
      const lx = x(this.live.rpm);
      const ly = yT(this.live.tq);
      ctx.beginPath();
      ctx.arc(lx, ly, 5, 0, Math.PI * 2);
      ctx.moveTo(lx - 9, ly);
      ctx.lineTo(lx + 9, ly);
      ctx.moveTo(lx, ly - 9);
      ctx.lineTo(lx, ly + 9);
      ctx.stroke();
    }
    ctx.fillStyle = tk.engrave;
    ctx.font = `500 11px ${tk.font}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("1/min", padL + pw, padT + ph - 3);
  }
}

function mixGrid(tk: ReturnType<typeof tokens>): string {
  // a slightly darker grid line for major divisions, derived from the grid colour
  return tk.paperGrid === "#b9c9b5" ? "#93a990" : tk.paperGrid;
}
