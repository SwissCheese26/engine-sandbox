// Round instrument with a needle for the cockpit (#26). The dial face (ring, ticks, numerals, limit zone) is drawn once
// into an offscreen canvas per size/scale; each frame only blits the face and draws the needle, and only when the
// needle moved by more than a tenth of a degree. DPR-aware via fitCanvas().
import { fitCanvas, reducedMotion } from "../canvas.ts";
import { START_DEG, SWEEP_DEG } from "./logic.ts";

export interface DialScale {
  min: number;
  max: number;
  /** Spacing of labelled ticks and of minor ticks (display units). */
  major: number;
  minor: number;
  /** Numerals are value / labelDiv (rev counter: 1000). */
  labelDiv?: number;
  /** Limit zone (signal yellow, design.md "Gelb heißt Grenze"), in display units. */
  zone?: { from: number; to: number };
  /** Red zone from the limiter on (cockpit rev counter only). */
  red?: { from: number; to: number };
  /** Small instruments: print min and max at the ends of the arc. */
  ends?: boolean;
  /** Short caption under the hub, e.g. "km/h" or "1/min × 1000". */
  caption: string;
  start?: number;
  sweep?: number;
}

interface Palette {
  face: string;
  ring: string;
  light: string;
  dim: string;
  needle: string;
  zone: string;
  red: string;
  hub: string;
  font: string;
}

function palette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  return {
    face: v("--ck-face", "#18201f"),
    ring: v("--ck-ring", "#9da39a"),
    light: v("--ck-light", "#f1e9d2"),
    dim: v("--ck-dim", "#7c8075"),
    needle: v("--ck-needle", "#ff5326"),
    zone: v("--signal", "#f6a800"),
    red: v("--ck-redline", "#d8321f"),
    hub: v("--ck-hub", "#0e1312"),
    font: v("--font-num", "system-ui"),
  };
}

export class Dial {
  readonly canvas: HTMLCanvasElement;
  private face: HTMLCanvasElement | null = null;
  private scale: DialScale;
  private shown = Number.NaN;
  private target = 0;
  private drawnAngle = Number.NaN;
  private size = 0;
  private pal: Palette | null = null;
  private small: boolean;
  dimmed = false;

  constructor(scale: DialScale, opts: { small?: boolean; label: string }) {
    this.scale = scale;
    this.small = !!opts.small;
    this.canvas = document.createElement("canvas");
    this.canvas.className = opts.small ? "dial dial--small" : "dial";
    // the value is read out in text next to the dial; the canvas itself is decoration for screen readers
    this.canvas.setAttribute("aria-hidden", "true");
  }

  setScale(s: DialScale) {
    this.scale = s;
    this.face = null;
    this.drawnAngle = Number.NaN;
  }

  /** Colours come from CSS custom properties; call after the theme or the view changed. */
  invalidate() {
    this.pal = null;
    this.face = null;
    this.drawnAngle = Number.NaN;
  }

  private angle(v: number): number {
    const { min, max } = this.scale;
    const start = this.scale.start ?? START_DEG;
    const sweep = this.scale.sweep ?? SWEEP_DEG;
    const f = Number.isFinite(v) && max > min ? Math.min(1.015, Math.max(-0.01, (v - min) / (max - min))) : 0;
    return ((start + f * sweep) * Math.PI) / 180;
  }

  /** Sets the needle target; the needle follows with a short lag (none with reduced motion). */
  set(v: number, dt: number) {
    this.target = Number.isFinite(v) ? v : this.scale.min;
    if (!Number.isFinite(this.shown) || reducedMotion() || dt <= 0) this.shown = this.target;
    else {
      // ~60 ms time constant: a needle with mass, but it never trails the readout visibly
      const k = 1 - Math.exp(-dt / 0.06);
      this.shown += (this.target - this.shown) * k;
    }
    this.draw(false);
  }

  draw(force: boolean) {
    if (!this.canvas.isConnected || this.canvas.getClientRects().length === 0) return;
    const { ctx, w, h, changed } = fitCanvas(this.canvas);
    const size = Math.min(w, h);
    if (changed || size !== this.size) {
      this.size = size;
      this.face = null;
    }
    const a = this.angle(this.shown);
    if (!force && this.face && Math.abs(a - this.drawnAngle) < 0.0017) return;
    this.pal ??= palette(this.canvas);
    this.face ??= this.paintFace(size);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.face, (w - size) / 2, (h - size) / 2, size, size);
    this.paintNeedle(ctx, w / 2, h / 2, size / 2, a);
    this.drawnAngle = a;
  }

  private paintFace(size: number): HTMLCanvasElement {
    const p = this.pal!;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const c = document.createElement("canvas");
    c.width = c.height = Math.max(1, Math.round(size * dpr));
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const r = size / 2;
    const cx = r;
    const cy = r;
    const s = this.scale;
    const small = this.small;
    // bezel: a thin alu ring, then the face
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = p.face;
    ctx.fill();
    ctx.lineWidth = small ? 1.5 : 2.5;
    ctx.strokeStyle = p.ring;
    ctx.stroke();
    const rr = r * (small ? 0.86 : 0.9);
    // limit zone on the outer edge
    for (const [z, col] of [[s.zone, p.zone], [s.red, p.red]] as const) {
      if (!z || !(z.to > z.from)) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, rr - (small ? 3 : 5), this.angle(z.from), this.angle(z.to));
      ctx.lineWidth = small ? 5 : 9;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // ticks
    const n = Math.round((s.max - s.min) / s.minor);
    const majorEvery = Math.max(1, Math.round(s.major / s.minor));
    ctx.lineCap = "butt";
    for (let i = 0; i <= n; i++) {
      const v = s.min + i * s.minor;
      const major = i % majorEvery === 0;
      const a = this.angle(v);
      const len = major ? rr * (small ? 0.22 : 0.13) : rr * (small ? 0.12 : 0.065);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      ctx.lineTo(cx + Math.cos(a) * (rr - len), cy + Math.sin(a) * (rr - len));
      ctx.lineWidth = major ? (small ? 2 : 3) : 1.2;
      ctx.strokeStyle = major ? p.light : p.dim;
      ctx.stroke();
      // small instruments carry no numerals: their value is read out in text right below
      if (!major || small) continue;
      const label = String(Math.round((v / (s.labelDiv ?? 1)) * 10) / 10).replace(".", ",");
      const lr = rr - len - (small ? r * 0.2 : r * 0.14);
      ctx.fillStyle = p.light;
      // Nachtbeleuchtung: numerals glow faintly like backlit print
      ctx.shadowColor = p.light;
      ctx.shadowBlur = 5;
      ctx.font = `500 ${Math.round(small ? r * 0.26 : r * 0.13)}px ${p.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
      ctx.shadowBlur = 0;
    }
    if (small) {
      if (s.ends) {
        ctx.fillStyle = p.dim;
        ctx.font = `500 ${Math.max(9, Math.round(r * 0.26))}px ${p.font}`;
        ctx.textBaseline = "middle";
        const y = cy + r * 0.62;
        const f = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
        ctx.textAlign = "left";
        ctx.fillText(f(s.min), cx - r * 0.5, y);
        ctx.textAlign = "right";
        ctx.fillText(f(s.max), cx + r * 0.5, y);
      }
      return c;
    }
    // caption
    ctx.fillStyle = p.dim;
    ctx.font = `500 ${Math.round(small ? r * 0.22 : r * 0.085)}px ${p.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.caption, cx, small ? cy + r * 0.42 : cy - r * 0.34);
    return c;
  }

  private paintNeedle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a: number) {
    const p = this.pal!;
    const small = this.small;
    const len = r * (small ? 0.78 : 0.84);
    const tail = r * (small ? 0.12 : 0.16);
    const wBase = small ? 2.4 : 4.2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const nx = -sin;
    const ny = cos;
    ctx.save();
    ctx.globalAlpha = this.dimmed ? 0.35 : 1;
    ctx.shadowColor = p.needle;
    ctx.shadowBlur = small ? 3 : 8;
    ctx.beginPath();
    ctx.moveTo(cx - cos * tail + nx * wBase * 0.6, cy - sin * tail + ny * wBase * 0.6);
    ctx.lineTo(cx + cos * len + nx * 0.8, cy + sin * len + ny * 0.8);
    ctx.lineTo(cx + cos * len - nx * 0.8, cy + sin * len - ny * 0.8);
    ctx.lineTo(cx - cos * tail - nx * wBase * 0.6, cy - sin * tail - ny * wBase * 0.6);
    ctx.closePath();
    ctx.fillStyle = p.needle;
    ctx.fill();
    ctx.restore();
    // hub cap
    ctx.beginPath();
    ctx.arc(cx, cy, small ? r * 0.13 : r * 0.085, 0, Math.PI * 2);
    ctx.fillStyle = p.hub;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = p.ring;
    ctx.stroke();
  }
}
