// Round instrument with a needle for the cockpit (#26). The dial face (ring, ticks, numerals, limit zone) is drawn once
// into an offscreen canvas per size/scale; each frame only blits the face and draws the needle, and only when the
// needle moved by more than a tenth of a degree. DPR-aware via fitCanvas().
import { fitCanvas, reducedMotion } from "../canvas.ts";
import { DEFAULT_DIAL_THEME, type DialTheme } from "./designs.ts";
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
  /** Needle tip of the "tip" needle (#83); falls back to the needle colour. */
  tip: string;
  /** Shaft of the "tip" needle; falls back to the numeral colour. */
  shaft: string;
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
    font: v("--ck-font", "") || v("--font-num", "system-ui"),
    tip: v("--ck-tip", "") || v("--ck-needle", "#ff5326"),
    shaft: v("--ck-shaft", "") || v("--ck-light", "#f1e9d2"),
  };
}

/** Cruise control green and limiter orange (the colours of the cluster lamps). */
const MARK_CRUISE = "#5fd068";
const MARK_LIMIT = "#f08a24";

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
  /** Cruise set speed (green arc from the needle to it, arrow) and limiter (orange arrow), display units. */
  private marks: { cruise: number | null; limit: number | null } = { cruise: null, limit: null };
  private marksKey = "";
  dimmed = false;
  /** Needle shape, bezel and numeral style of the cockpit design (#83); the default is the classic dial. */
  private theme: DialTheme;

  constructor(scale: DialScale, opts: { small?: boolean; label: string; theme?: DialTheme }) {
    this.scale = scale;
    this.theme = opts.theme ?? DEFAULT_DIAL_THEME;
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

  /** Switches the drawing style (cockpit design, #83); colours still come from CSS. */
  setTheme(t: DialTheme) {
    if (t === this.theme) return;
    this.theme = t;
    this.invalidate();
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

  /** Cruise control / limiter marks on the scale (BMW style); null = not shown. */
  setMarks(cruise: number | null, limit: number | null) {
    const key = `${cruise}|${limit}`;
    if (key === this.marksKey) return;
    this.marksKey = key;
    this.marks = { cruise, limit };
    this.draw(true);
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
    this.paintMarks(ctx, w / 2, h / 2, size / 2);
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
    const t = this.theme;
    // bezel: a thin alu ring, then the face
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = p.face;
    ctx.fill();
    const rr = r * (small ? 0.86 : 0.9);
    if (t.ring === "alu") {
      ctx.lineWidth = small ? 1.5 : 2.5;
      ctx.strokeStyle = p.ring;
      ctx.stroke();
    } else if (t.ring === "chrome") {
      // polished ring: light from the upper left, a dark band at the lower right
      const w = small ? r * 0.12 : r * 0.07;
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, "#f7f7f2");
      g.addColorStop(0.35, "#8d918f");
      g.addColorStop(0.5, "#e9ebe6");
      g.addColorStop(0.75, "#5b5f5e");
      g.addColorStop(1, "#c9ccc7");
      ctx.beginPath();
      ctx.arc(cx, cy, r - w / 2 - 0.5, 0, Math.PI * 2);
      ctx.lineWidth = w;
      ctx.strokeStyle = g;
      ctx.stroke();
      // the face sits a little lower than the ring: a soft shadow on its edge
      const sh = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r - w);
      sh.addColorStop(0, "rgba(60,40,10,0)");
      sh.addColorStop(1, "rgba(60,40,10,0.28)");
      ctx.beginPath();
      ctx.arc(cx, cy, r - w, 0, Math.PI * 2);
      ctx.fillStyle = sh;
      ctx.fill();
    } else if (t.ring === "tunnel") {
      // looking down a tube: the face darkens towards the wall, a thin lit edge where the scale ends
      const g = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.82, "rgba(0,0,0,0.25)");
      g.addColorStop(1, "rgba(0,0,0,0.9)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, rr + (small ? 2 : 4), 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = p.ring;
      ctx.stroke();
    }
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
      if (!major && !t.minorTicks) continue;
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
      ctx.shadowBlur = t.glow;
      ctx.font = `${t.numeralWeight} ${Math.round((small ? r * 0.26 : r * 0.13) * t.numeralScale)}px ${p.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
      ctx.shadowBlur = 0;
    }
    if (t.glass) {
      // reflection on the cover glass: a soft crescent from the upper left
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
      ctx.clip();
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.2, cy + r * 0.2);
      g.addColorStop(0, "rgba(255,255,255,0.22)");
      g.addColorStop(0.45, "rgba(255,255,255,0.04)");
      g.addColorStop(0.5, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.25, cy - r * 0.35, r * 0.95, r * 0.6, -Math.PI / 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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

  /**
   * Cruise: a green band on the outer edge from the needle up (or down) to the set speed and a green arrow at it;
   * limiter: an orange arrow at the limit. Like the LED marks of BMW/VW clusters.
   */
  private paintMarks(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const { cruise, limit } = this.marks;
    if (cruise === null && limit === null) return;
    const s = this.scale;
    const clampV = (v: number) => Math.min(s.max, Math.max(s.min, v));
    const rr = r * 0.9;
    const arrow = (v: number, col: string) => {
      const a = this.angle(clampV(v));
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const tip = rr - 13;
      const base = rr + 2;
      const half = r * 0.045;
      ctx.beginPath();
      ctx.moveTo(cx + cos * tip, cy + sin * tip);
      ctx.lineTo(cx + cos * base - sin * half, cy + sin * base + cos * half);
      ctx.lineTo(cx + cos * base + sin * half, cy + sin * base - cos * half);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    };
    ctx.save();
    if (cruise !== null) {
      const a0 = this.angle(clampV(this.shown));
      const a1 = this.angle(clampV(cruise));
      if (Math.abs(a1 - a0) > 0.004) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr - 5, Math.min(a0, a1), Math.max(a0, a1));
        ctx.lineWidth = 9;
        ctx.strokeStyle = MARK_CRUISE;
        ctx.globalAlpha = 0.75;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      arrow(cruise, MARK_CRUISE);
    }
    if (limit !== null) arrow(limit, MARK_LIMIT);
    ctx.restore();
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
    const shape = this.theme.needle;
    // quad from distance d0 (half width w0) to d1 (half width w1) along the needle
    const seg = (d0: number, w0: number, d1: number, w1: number, col: string) => {
      ctx.beginPath();
      ctx.moveTo(cx + cos * d0 + nx * w0, cy + sin * d0 + ny * w0);
      ctx.lineTo(cx + cos * d1 + nx * w1, cy + sin * d1 + ny * w1);
      ctx.lineTo(cx + cos * d1 - nx * w1, cy + sin * d1 - ny * w1);
      ctx.lineTo(cx + cos * d0 - nx * w0, cy + sin * d0 - ny * w0);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    };
    ctx.save();
    ctx.globalAlpha = this.dimmed ? 0.35 : 1;
    ctx.shadowColor = p.needle;
    ctx.shadowBlur = small ? 3 : 8;
    if (shape === "tip") {
      // light shaft, the outer third in the tip colour (sport-saloon needles)
      const k = small ? 0.5 : 0.62;
      ctx.shadowColor = p.tip;
      seg(-tail, wBase * 0.55, len * k, wBase * 0.4, p.shaft);
      seg(len * k, wBase * 0.4, len, 0.7, p.tip);
    } else if (shape === "bar") {
      seg(-tail, wBase * 0.7, len, wBase * 0.5, p.needle);
    } else {
      seg(-tail, wBase * 0.6, len, 0.8, p.needle);
    }
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
