// Smoke and steam overlay (Rauch/Dampf): a small canvas particle system above the sandbox stage.
//
// - Which emitter runs how strongly comes from smoke-emitters.ts (pure, unit-tested); this file only draws.
// - One fixed, non-interactive canvas over the viewport, clipped to the stage, so it never moves the layout and
//   never paints over the header or the control bar. It has no loop of its own: the app's frame calls update(),
//   so a hidden tab or a paused sandbox costs nothing, and with nothing emitting and no particle alive it returns
//   right after one final clear.
// - Pooled particles (MAX_PARTICLES, struct of arrays), soft radial sprites rendered once, low alpha.
// - prefers-reduced-motion: no particles, only a static faint haze at the source, redrawn when its strength changes.
import { EMITTERS, MAX_PARTICLES, MAX_RATE, spawnCount, type Emission, type EmitterKind } from "./smoke-emitters.ts";

/** A horizontal source line in viewport coordinates (CSS px). */
export interface SmokeSource {
  x0: number;
  x1: number;
  y: number;
}

export interface SmokeAnchors {
  /** Visible area the effect may paint in (the stage); null = nothing to paint on. */
  clip: DOMRect | null;
  /** Bottom edge of the instrument area: tyre smoke (and exhaust at its right end). */
  tyre: SmokeSource | null;
  /** Bonnet edge of the cockpit or the engine cutaway: steam and oil smoke. */
  engine: SmokeSource | null;
}

interface Look {
  rgb: string;
  /** Peak alpha at strength 1. */
  alpha: number;
  size: [number, number];
  grow: number;
  life: [number, number];
  rise: [number, number];
  drift: number;
}

/** Faint on purpose: the gauges stay readable through the thickest smoke. */
const LOOK: Record<EmitterKind, Look> = {
  tyre: { rgb: "222,222,216", alpha: 0.32, size: [30, 54], grow: 3, life: [1.8, 2.8], rise: [30, 60], drift: 26 },
  steam: { rgb: "246,248,250", alpha: 0.28, size: [12, 22], grow: 2.6, life: [1.0, 1.8], rise: [38, 70], drift: 14 },
  oilSmoke: { rgb: "128,140,160", alpha: 0.18, size: [16, 26], grow: 2.4, life: [1.8, 2.8], rise: [16, 30], drift: 10 },
  exhaust: { rgb: "70,70,66", alpha: 0.16, size: [14, 24], grow: 2.8, life: [1.2, 2.0], rise: [14, 28], drift: 18 },
};

const KIND_INDEX: Record<EmitterKind, number> = { tyre: 0, steam: 1, oilSmoke: 2, exhaust: 3 };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class SmokeOverlay {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private sprites: HTMLCanvasElement[] = [];
  // pool (struct of arrays): only the first `n` entries are alive
  private px = new Float32Array(MAX_PARTICLES);
  private py = new Float32Array(MAX_PARTICLES);
  private vx = new Float32Array(MAX_PARTICLES);
  private vy = new Float32Array(MAX_PARTICLES);
  private age = new Float32Array(MAX_PARTICLES);
  private life = new Float32Array(MAX_PARTICLES);
  private size = new Float32Array(MAX_PARTICLES);
  private peak = new Float32Array(MAX_PARTICLES);
  private kind = new Uint8Array(MAX_PARTICLES);
  private n = 0;
  private carry: Record<EmitterKind, number> = { tyre: 0, steam: 0, oilSmoke: 0, exhaust: 0 };
  /** Something is on the canvas that needs clearing. */
  private dirty = false;
  private hazeKey = "";
  /** Viewport size in CSS px without scrollbars (the canvas' box). */
  private cssW = 0;
  private cssH = 0;
  private reduced: MediaQueryList | null;

  constructor(private anchors: () => SmokeAnchors) {
    const c = document.createElement("canvas");
    c.className = "smoke-overlay";
    c.setAttribute("aria-hidden", "true");
    // inline: the overlay is self-contained and needs no layout rule (fixed, so it never shifts anything). inset 0
    // alone sizes it to the viewport without the scrollbar (100vw would include it).
    Object.assign(c.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "3" });
    c.dataset.active = "false";
    c.hidden = true;
    this.el = c;
    this.reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    // switched while smoke is shown: drop particles or haze, the next frame draws in the new mode
    this.reduced?.addEventListener?.("change", () => this.clear());
  }

  /** Live particles (tests, e2e). */
  get count(): number {
    return this.n;
  }

  /** Called once per app frame. `enabled` = setting "Effekte (Rauch/Dampf)". */
  update(e: Emission, dt: number, enabled: boolean) {
    if (!enabled || (typeof document !== "undefined" && document.hidden)) {
      this.clear();
      return;
    }
    const emitting = EMITTERS.some((k) => e[k] > 0);
    if (!emitting && this.n === 0) {
      if (this.dirty) this.clear();
      return;
    }
    const a = this.anchors();
    if (!a.clip || a.clip.width < 2 || a.clip.height < 2) {
      this.clear();
      return;
    }
    if (!this.prepare()) return;
    if (this.reduced?.matches) {
      this.n = 0;
      this.haze(e, a);
      return;
    }
    this.hazeKey = "";
    this.spawn(e, a, dt);
    this.step(dt);
    this.draw(a.clip);
  }

  /** Removes every particle and blanks the canvas (pause, setting off, idle). */
  clear() {
    this.n = 0;
    for (const k of EMITTERS) this.carry[k] = 0;
    this.hazeKey = "";
    if (this.dirty && this.ctx) this.ctx.clearRect(0, 0, this.el.width, this.el.height);
    this.dirty = false;
    this.el.hidden = true;
    this.el.dataset.active = "false";
  }

  private prepare(): boolean {
    this.el.hidden = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const root = document.documentElement;
    this.cssW = root.clientWidth || window.innerWidth;
    this.cssH = root.clientHeight || window.innerHeight;
    const w = Math.round(this.cssW * dpr);
    const h = Math.round(this.cssH * dpr);
    if (this.el.width !== w || this.el.height !== h) {
      this.el.width = w;
      this.el.height = h;
    }
    this.ctx ??= this.el.getContext("2d");
    if (!this.ctx) return false;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.sprites.length) this.sprites = EMITTERS.map((k) => sprite(LOOK[k].rgb));
    return true;
  }

  private spawn(e: Emission, a: SmokeAnchors, dt: number) {
    for (const k of EMITTERS) {
      const src = k === "tyre" || k === "exhaust" ? a.tyre : a.engine;
      if (!src || e[k] <= 0) {
        this.carry[k] = 0;
        continue;
      }
      const [count, carry] = spawnCount(e[k] * MAX_RATE[k], dt, this.carry[k]);
      this.carry[k] = carry;
      for (let i = 0; i < count && this.n < MAX_PARTICLES; i++) this.emit(k, src, e[k]);
    }
  }

  private emit(k: EmitterKind, src: SmokeSource, strength: number) {
    const L = LOOK[k];
    const i = this.n++;
    const w = src.x1 - src.x0;
    // exhaust leaves at the right end (the tail pipe), the rest along the whole edge, a little denser in the middle
    const u = k === "exhaust" ? rnd(0.85, 0.97) : (Math.random() + Math.random()) / 2;
    this.px[i] = src.x0 + u * w;
    // born just above the edge, so the puff is not half cut off by the stage below it
    this.py[i] = src.y - rnd(4, 14);
    this.vx[i] = rnd(-L.drift, L.drift) + (k === "exhaust" ? -12 : 0);
    this.vy[i] = -rnd(L.rise[0], L.rise[1]) * (0.7 + 0.3 * strength);
    this.age[i] = 0;
    this.life[i] = rnd(L.life[0], L.life[1]);
    this.size[i] = rnd(L.size[0], L.size[1]) * (0.75 + 0.25 * strength);
    this.peak[i] = L.alpha * (0.45 + 0.55 * strength);
    this.kind[i] = KIND_INDEX[k];
  }

  private step(dt: number) {
    const damp = Math.exp(-0.9 * dt);
    for (let i = 0; i < this.n; ) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) {
        // swap-remove: the last live particle takes this slot
        const j = --this.n;
        this.px[i] = this.px[j]!; this.py[i] = this.py[j]!; this.vx[i] = this.vx[j]!; this.vy[i] = this.vy[j]!;
        this.age[i] = this.age[j]!; this.life[i] = this.life[j]!; this.size[i] = this.size[j]!; this.peak[i] = this.peak[j]!;
        this.kind[i] = this.kind[j]!;
        continue;
      }
      this.vx[i]! *= damp;
      this.vy[i]! *= damp;
      this.px[i]! += this.vx[i]! * dt;
      this.py[i]! += this.vy[i]! * dt;
      i++;
    }
  }

  private draw(clip: DOMRect) {
    const ctx = this.ctx!;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.left, clip.top, clip.width, clip.height);
    ctx.clip();
    const looks = EMITTERS.map((k) => LOOK[k]);
    for (let i = 0; i < this.n; i++) {
      const f = this.age[i]! / this.life[i]!;
      // quick fade in, long fade out
      const env = f < 0.15 ? f / 0.15 : (1 - f) / 0.85;
      const s = this.size[i]! * (1 + (looks[this.kind[i]!]!.grow - 1) * f);
      ctx.globalAlpha = this.peak[i]! * env;
      ctx.drawImage(this.sprites[this.kind[i]!]!, this.px[i]! - s / 2, this.py[i]! - s / 2, s, s);
    }
    ctx.restore();
    this.dirty = this.n > 0;
    this.el.dataset.active = String(this.n > 0);
    if (!this.dirty) this.el.hidden = true;
  }

  /** Reduced motion: one still, faint cloud per active source. */
  private haze(e: Emission, a: SmokeAnchors) {
    const r = a.clip!;
    const key = `${EMITTERS.map((k) => Math.round(e[k] * 10)).join(",")}|${Math.round(a.tyre?.y ?? 0)},${Math.round(a.engine?.y ?? 0)}|${[r.left, r.top, r.width, r.height, this.cssW, this.cssH].map(Math.round).join(",")}`;
    if (key === this.hazeKey) return;
    this.hazeKey = key;
    const ctx = this.ctx!;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.clip!.left, a.clip!.top, a.clip!.width, a.clip!.height);
    ctx.clip();
    let any = false;
    for (const k of EMITTERS) {
      const src = k === "tyre" || k === "exhaust" ? a.tyre : a.engine;
      if (!src || e[k] <= 0) continue;
      any = true;
      const w = Math.max(60, (src.x1 - src.x0) * (k === "exhaust" ? 0.25 : 0.8));
      const cx = k === "exhaust" ? src.x0 + 0.9 * (src.x1 - src.x0) : (src.x0 + src.x1) / 2;
      ctx.globalAlpha = 0.07 * e[k];
      ctx.drawImage(this.sprites[KIND_INDEX[k]]!, cx - w / 2, src.y - w * 0.35, w, w * 0.5);
    }
    ctx.restore();
    this.dirty = any;
    this.el.dataset.active = String(any);
    if (!any) this.el.hidden = true;
  }
}

/** Soft round puff, rendered once per colour. */
function sprite(rgb: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, `rgba(${rgb},1)`);
    r.addColorStop(0.45, `rgba(${rgb},0.55)`);
    r.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  return c;
}
