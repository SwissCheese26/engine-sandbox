// Small canvas utilities: DPR-aware sizing and reading design tokens from CSS.

/** Keeps a canvas' backing store in sync with its CSS size × devicePixelRatio. Returns the 2D context. */
export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number; changed: boolean } {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  let changed = false;
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    changed = true;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, changed };
}

export interface Tokens {
  hammer: string;
  hammerDeep: string;
  hammerLight: string;
  alu: string;
  aluShade: string;
  engrave: string;
  signal: string;
  paper: string;
  paperGrid: string;
  inkTorque: string;
  inkPower: string;
  inkRpm: string;
  cold: string;
  fontNum: string;
  font: string;
}

let cached: Tokens | null = null;

export function tokens(): Tokens {
  if (cached) return cached;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  cached = {
    hammer: v("--hammer", "#46564f"),
    hammerDeep: v("--hammer-deep", "#2e3a35"),
    hammerLight: v("--hammer-light", "#5b6b63"),
    alu: v("--alu", "#d3d6cf"),
    aluShade: v("--alu-shade", "#b8bcb3"),
    engrave: v("--engrave", "#23292a"),
    signal: v("--signal", "#f6a800"),
    paper: v("--paper", "#ecebdd"),
    paperGrid: v("--paper-grid", "#b9c9b5"),
    inkTorque: v("--ink-torque", "#b3261e"),
    inkPower: v("--ink-power", "#23408e"),
    inkRpm: v("--ink-rpm", "#23292a"),
    cold: v("--cold", "#3d6f8f"),
    fontNum: v("--font-num", "system-ui"),
    font: v("--font", "system-ui"),
  };
  return cached;
}

/** True if the user asked for reduced motion (re-evaluated live). */
const rm = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
export function reducedMotion(): boolean {
  return rm?.matches ?? false;
}
