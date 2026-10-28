// Pure formatting helpers (German number format, scale maths, colour interpolation). No DOM.

const formatters = new Map<number, Intl.NumberFormat>();

/** German number format with fixed decimals. Non-finite values become an en dash. */
export function fmt(v: number, decimals = 0): string {
  if (!Number.isFinite(v)) return "–";
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  // Avoid "-0"
  const r = Number(v.toFixed(decimals));
  return f.format(r === 0 ? 0 : r);
}

/** Smallest "nice" number (1, 2, 2.5, 5 × 10^n) that is ≥ v. Used for gauge and recorder scales. */
export function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * base >= v - 1e-9) return m * base;
  }
  return 10 * base;
}

/** Tick step for a scale 0 … max that gives roughly `target` major ticks. */
export function tickStep(max: number, target = 6): number {
  const raw = max / target;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= raw) return m * base;
  return 10 * base;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Snap to a step grid starting at min. */
export function snap(v: number, min: number, step: number): number {
  const n = Math.round((v - min) / step);
  return Number((min + n * step).toFixed(6));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear interpolation between two hex colours, t in 0 … 1. Returns #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = clamp(t, 0, 1);
  const c = ca.map((x, i) => Math.round(x + (cb[i]! - x) * k));
  return "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
}
