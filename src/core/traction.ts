/**
 * Traction diagram ("Zugkraftdiagramm", issue #14, docs/research/vehicle.md §6): tractive force at the wheel per gear
 * over speed from the engine's steady full-load curve, the driving resistance (rolling + air + gradient), the top
 * speed as their highest intersection (or at the rev limiter) and whether the gearing is too short / too long.
 * Pure computation, no DOM.
 */
import type { GearboxSpec, GearboxType } from "./drivetrain.ts";
import type { VehicleParams } from "./types.ts";

export interface TractionSetup {
  type: GearboxType;
  spec: Pick<GearboxSpec, "ratios" | "efficiency">;
  finalDrive: number;
  vehicle: VehicleParams;
}

export interface TractionEnv {
  /** Road gradient in % (+ uphill), default 0. */
  gradePct?: number;
  /** Air density kg/m³, default 1.2. */
  airDensityKgM3?: number;
}

export interface TractionPoint {
  kmh: number;
  forceN: number;
}

export interface TractionGear {
  /** 1 … n (CVT: 1, the envelope over the ratio range). */
  gear: number;
  ratio: number;
  points: TractionPoint[];
  /** Highest speed this gear reaches: intersection with the resistance or the rev limiter. */
  vmaxKmh: number;
  limitedBy: "limiter" | "resistance";
}

export type TractionVerdict = "zu-kurz" | "zu-lang" | "passend";

export interface TractionResult {
  gears: TractionGear[];
  resistance: TractionPoint[];
  vmax: { kmh: number; forceN: number; gear: number; rpm: number; limitedBy: "limiter" | "resistance" };
  /** Gearing of the top gear relative to the power peak (vehicle.md §6). */
  verdict: TractionVerdict;
  /** Speed range worth drawing, km/h. */
  maxKmh: number;
}

const G = 9.81;
const RAD_TO_RPM = 30 / Math.PI;

/** Driving resistance at the wheel, N: m·g·(f_R·cos θ + sin θ) + ½·ρ·c_W·A·v² (vehicle.md §6, Mitschke/Wallentowitz). */
export function drivingResistanceN(v: VehicleParams, kmh: number, env: TractionEnv = {}): number {
  const th = Math.atan((env.gradePct ?? 0) / 100);
  const ms = kmh / 3.6;
  return v.massKg * G * (v.rollingResistance * Math.cos(th) + Math.sin(th)) + 0.5 * (env.airDensityKgM3 ?? 1.2) * v.dragCoefficient * v.frontalAreaM2 * ms * ms;
}

/** Linear interpolation of the full-load torque, clamped to the ends of the curve. */
function torqueAt(curve: readonly { rpm: number; torqueNm: number }[], rpm: number): number {
  if (rpm <= curve[0]!.rpm) return curve[0]!.torqueNm;
  for (let k = 1; k < curve.length; k++) {
    const b = curve[k]!;
    if (rpm <= b.rpm) {
      const a = curve[k - 1]!;
      return a.torqueNm + ((b.torqueNm - a.torqueNm) * (rpm - a.rpm)) / Math.max(1e-9, b.rpm - a.rpm);
    }
  }
  return curve[curve.length - 1]!.torqueNm;
}

/**
 * Tractive force curves of all gears (vehicle.md §6): F = T(n)·i_gear·i_axle·η / r at v = n·2π·r / (60·i_gear·i_axle),
 * from the lowest rpm of the full-load curve up to the rev limiter. peakPowerRpm judges the gearing.
 */
export function tractionCurves(
  fullLoad: readonly { rpm: number; torqueNm: number }[], limitRpm: number, peakPowerRpm: number,
  setup: TractionSetup, env: TractionEnv = {},
): TractionResult {
  const curve = fullLoad.filter((p) => Number.isFinite(p.torqueNm) && p.rpm <= limitRpm + 1e-9);
  const r = setup.vehicle.wheelRadiusM;
  const eta = setup.spec.efficiency;
  const fd = setup.finalDrive;
  const res = (kmh: number) => drivingResistanceN(setup.vehicle, kmh, env);
  const kmhAt = (rpm: number, ratio: number) => ((rpm / RAD_TO_RPM) * r * 3.6) / (ratio * fd);
  const force = (rpm: number, ratio: number) => (Math.max(0, torqueAt(curve, rpm)) * ratio * fd * eta) / r;
  const nLo = curve[0]?.rpm ?? 1000;
  const nHi = Math.min(limitRpm, curve[curve.length - 1]?.rpm ?? limitRpm);
  const steps = 60;

  const gearCurve = (ratio: number, gear: number): TractionGear => {
    const points: TractionPoint[] = [];
    for (let k = 0; k <= steps; k++) {
      const n = nLo + ((nHi - nLo) * k) / steps;
      points.push({ kmh: kmhAt(n, ratio), forceN: force(n, ratio) });
    }
    return { gear, ratio, points, ...gearVmax(points, res) };
  };

  let gears: TractionGear[];
  if (setup.type === "cvt") {
    // envelope over the ratio range (spec.ratios = [shortest, longest])
    const [hi, lo] = [setup.spec.ratios[0]!, setup.spec.ratios[1] ?? setup.spec.ratios[0]!];
    const vMax = kmhAt(nHi, lo);
    const vMin = kmhAt(nLo, hi);
    const points: TractionPoint[] = [];
    for (let k = 0; k <= steps * 2; k++) {
      const kmh = vMin + ((vMax - vMin) * k) / (steps * 2);
      let best = 0;
      for (let j = 0; j <= 40; j++) {
        const ratio = hi + ((lo - hi) * j) / 40;
        const n = (kmh / 3.6 / r) * ratio * fd * RAD_TO_RPM;
        if (n >= nLo - 1e-6 && n <= nHi + 1e-6) best = Math.max(best, force(n, ratio));
      }
      points.push({ kmh, forceN: best });
    }
    gears = [{ gear: 1, ratio: lo, points, ...gearVmax(points, res) }];
  } else {
    gears = setup.spec.ratios.map((ratio, k) => gearCurve(ratio, k + 1));
  }

  let best = gears[0]!;
  for (const g of gears) if (g.vmaxKmh > best.vmaxKmh + 1e-9) best = g;
  const top = gears[gears.length - 1]!;
  const rpmAt = (kmh: number, ratio: number) => (kmh / 3.6 / r) * ratio * fd * RAD_TO_RPM;
  const vRpm = setup.type === "cvt" ? nHi : rpmAt(best.vmaxKmh, best.ratio);
  let verdict: TractionVerdict;
  if (best.gear < top.gear) verdict = "zu-lang";
  else if (best.limitedBy === "limiter" || vRpm > 1.1 * peakPowerRpm) verdict = "zu-kurz";
  else verdict = setup.type !== "cvt" && vRpm < 0.9 * peakPowerRpm ? "zu-lang" : "passend";
  const maxKmh = Math.max(best.vmaxKmh * 1.15, ...gears.map((g) => Math.min(g.points[g.points.length - 1]!.kmh, best.vmaxKmh * 1.3)));
  const resistance: TractionPoint[] = [];
  for (let k = 0; k <= 60; k++) {
    const kmh = (maxKmh * k) / 60;
    resistance.push({ kmh, forceN: res(kmh) });
  }
  return {
    gears, resistance, verdict, maxKmh,
    vmax: { kmh: best.vmaxKmh, forceN: res(best.vmaxKmh), gear: best.gear, rpm: vRpm, limitedBy: best.limitedBy },
  };
}

/** First speed where the tractive force falls below the resistance (interpolated), else the end of the curve. */
function gearVmax(points: TractionPoint[], res: (kmh: number) => number): { vmaxKmh: number; limitedBy: "limiter" | "resistance" } {
  let prevSurplus = Number.NaN;
  for (let k = 0; k < points.length; k++) {
    const p = points[k]!;
    const surplus = p.forceN - res(p.kmh);
    if (surplus < 0) {
      if (k === 0 || !(prevSurplus >= 0)) return { vmaxKmh: k === 0 ? 0 : points[k - 1]!.kmh, limitedBy: "resistance" };
      const a = points[k - 1]!;
      const t = prevSurplus / (prevSurplus - surplus);
      return { vmaxKmh: a.kmh + t * (p.kmh - a.kmh), limitedBy: "resistance" };
    }
    prevSurplus = surplus;
  }
  return { vmaxKmh: points[points.length - 1]!.kmh, limitedBy: "limiter" };
}
