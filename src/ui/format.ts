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

/**
 * Parses a number typed by the user. Accepts German ("1.234,5", "81,5") and English ("1,234.5",
 * "81.5") notation. A lone separator is a decimal separator ("81.5" and "81,5" both give 81.5).
 * Thousands separators are only removed when that reading is unambiguous: both kinds present,
 * several of the same kind, or – for the single ambiguous form "4.800" / "1,125" – when only the
 * thousands reading fits the field's range (fmt() itself writes "4.800" for 4800 1/min).
 * Returns NaN for anything that is not a number.
 */
export function parseNumber(raw: string, range?: { min: number; max: number }): number {
  let s = raw.trim().replace(/[\s\u00a0\u202f]/g, "").replace(/^\u2212/, "-");
  if (!/^[+-]?[\d.,]+$/.test(s) || !/\d/.test(s)) return Number.NaN;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    // the separator that comes last is the decimal one
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thou = dec === "," ? "." : ",";
    if ((dec === "," ? commas : dots) > 1) return Number.NaN;
    if (!thousandsOk(s.slice(0, s.lastIndexOf(dec)), thou)) return Number.NaN;
    s = s.split(thou).join("").replace(dec, ".");
  } else if (dots + commas > 1) {
    const sep = dots ? "." : ",";
    if (!thousandsOk(s, sep)) return Number.NaN;
    s = s.split(sep).join("");
  } else if (dots + commas === 1) {
    const sep = dots ? "." : ",";
    const asDecimal = Number(s.replace(sep, "."));
    const ambiguous = /^[+-]?[1-9]\d{0,2}[.,]\d{3}$/.test(s);
    if (ambiguous) {
      const asThousands = Number(s.replace(sep, ""));
      const fits = (v: number) => !range || (v >= range.min && v <= range.max);
      // Prefer the reading that fits the field; without a range, a dot group is German thousands.
      if (fits(asThousands) && !fits(asDecimal)) return asThousands;
      if (fits(asDecimal) && !fits(asThousands)) return asDecimal;
      return sep === "." ? asThousands : asDecimal;
    }
    return Number.isFinite(asDecimal) ? asDecimal : Number.NaN;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : Number.NaN;
}

function thousandsOk(intPart: string, sep: string): boolean {
  const groups = intPart.replace(/^[+-]/, "").split(sep);
  return /^\d{1,3}$/.test(groups[0]!) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
}
