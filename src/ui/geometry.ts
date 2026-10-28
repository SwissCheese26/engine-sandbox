// Pure kinematics and layout helpers for the schematic. No DOM.
import type { EngineConfig, EngineSummary } from "../core/index.ts";

/**
 * Piston position below TDC as a fraction of the stroke (0 = TDC, 1 = BDC) for a slider-crank
 * with crank radius r = stroke/2 and conrod length l:  s(θ) = r(1 − cos θ) + l − √(l² − r² sin² θ).
 * Standard slider-crank kinematics, e.g. Heywood, Internal Combustion Engine Fundamentals, eq. 2.4.
 */
export function pistonFraction(crankDeg: number, strokeMm: number, conrodMm: number): number {
  const r = strokeMm / 2;
  const l = Math.max(conrodMm, r * 1.05);
  const th = (crankDeg * Math.PI) / 180;
  const s = r * (1 - Math.cos(th)) + l - Math.sqrt(l * l - r * r * Math.sin(th) ** 2);
  return s / strokeMm;
}

/** Common firing orders (1-based physical cylinder numbers). Others fall back to 1…n. */
function firingOrder(cfg: EngineConfig): number[] {
  const { layout, cylinders: n, v8Crank } = cfg.block;
  const key = `${layout}${n}`;
  const table: Record<string, number[]> = {
    inline2: [1, 2],
    inline3: [1, 2, 3],
    inline4: [1, 3, 4, 2],
    inline5: [1, 2, 4, 5, 3],
    inline6: [1, 5, 3, 6, 2, 4],
    inline8: [1, 6, 2, 5, 8, 3, 7, 4],
    boxer4: [1, 3, 2, 4],
    boxer6: [1, 6, 2, 4, 3, 5],
    v6: [1, 4, 2, 5, 3, 6],
    v8: v8Crank === "flatplane" ? [1, 5, 3, 7, 4, 8, 2, 6] : [1, 5, 4, 8, 6, 3, 7, 2],
    v10: [1, 6, 5, 10, 2, 7, 3, 8, 4, 9],
    v12: [1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10],
    vr5: [1, 2, 4, 5, 3],
    vr6: [1, 5, 3, 6, 2, 4],
  };
  const order = table[key];
  if (order && order.length === n) return order;
  return Array.from({ length: n }, (_, i) => i + 1);
}

/**
 * Crank-angle offset (0 … 720) at which each physical cylinder (index 0 … n−1) reaches firing TDC,
 * derived from the summary's firing intervals and the firing order.
 */
export function firingOffsets(cfg: EngineConfig, summary: EngineSummary): number[] {
  const n = cfg.block.cylinders;
  const order = firingOrder(cfg);
  const iv = summary.firingIntervalsDeg.length === n ? summary.firingIntervalsDeg : Array.from({ length: n }, () => 720 / n);
  const out = new Array<number>(n).fill(0);
  let acc = 0;
  for (let k = 0; k < n; k++) {
    out[order[k]! - 1] = acc % 720;
    acc += iv[k]!;
  }
  return out;
}

export interface BankLayout {
  /** Angle of the bank axis from vertical, degrees (positive = to the right). */
  angleDeg: number;
  /** Physical cylinder indices on this bank, front to back. */
  cylinders: number[];
  /** VR/W: cylinders alternate in two staggered rows within the bank. */
  staggered: boolean;
}

/** Splits cylinders into banks for drawing. */
export function banks(cfg: EngineConfig): BankLayout[] {
  const { layout, cylinders: n, bankAngleDeg } = cfg.block;
  const idx = Array.from({ length: n }, (_, i) => i);
  switch (layout) {
    case "inline":
      return [{ angleDeg: 0, cylinders: idx, staggered: false }];
    case "vr":
      return [{ angleDeg: 0, cylinders: idx, staggered: true }];
    case "v":
    case "w": {
      const half = n / 2;
      const a = (layout === "w" ? bankAngleDeg || 72 : bankAngleDeg || 90) / 2;
      return [
        { angleDeg: -a, cylinders: idx.slice(0, half), staggered: layout === "w" },
        { angleDeg: a, cylinders: idx.slice(half), staggered: layout === "w" },
      ];
    }
    case "boxer": {
      const half = n / 2;
      return [
        { angleDeg: -90, cylinders: idx.slice(0, half), staggered: false },
        { angleDeg: 90, cylinders: idx.slice(half), staggered: false },
      ];
    }
  }
}

/** Crank angle of a cylinder relative to its own firing TDC, wrapped to 0 … 720. */
export function cylinderPhase(globalCrankDeg: number, offsetDeg: number): number {
  return (((globalCrankDeg - offsetDeg) % 720) + 720) % 720;
}

/** Stroke name for a cylinder phase (0 = firing TDC). */
export function strokeOf(phaseDeg: number): "power" | "exhaust" | "intake" | "compression" {
  if (phaseDeg < 180) return "power";
  if (phaseDeg < 360) return "exhaust";
  if (phaseDeg < 540) return "intake";
  return "compression";
}
