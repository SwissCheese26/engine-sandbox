import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../../src/data/presets.ts";
import { summarize } from "../../src/core/index.ts";
import type { EngineConfig } from "../../src/core/index.ts";
import { fmt, mixHex, niceCeil, tickStep, snap } from "../../src/ui/format.ts";
import { FIELDS, cylinderOptions, getPath, isVisible, normalizeConfig, setPath } from "../../src/ui/fields.ts";
import { banks, cylinderPhase, firingOffsets, pistonFraction } from "../../src/ui/geometry.ts";

function leaves(o: unknown, prefix = ""): string[] {
  if (o === null || typeof o !== "object") return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("format", () => {
  test("German decimals and dash for NaN", () => {
    expect(fmt(1234.5, 1)).toBe("1.234,5");
    expect(fmt(Number.NaN)).toBe("–");
    expect(fmt(-0.0001, 1)).toBe("0,0");
  });
  test("nice scales", () => {
    expect(niceCeil(430)).toBe(500);
    expect(niceCeil(180)).toBe(200);
    expect(niceCeil(4800)).toBe(5000);
    expect(tickStep(7000, 7)).toBe(1000);
    expect(snap(16.53, 14, 0.1)).toBeCloseTo(16.5, 6);
  });
  test("colour mix", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#3d6f8f", "#f6a800", 1)).toBe("#f6a800");
  });
});

describe("workbench fields", () => {
  for (const fuel of ["diesel", "petrol"] as const) {
    test(`${fuel}: every config leaf has a field (except id, fuel and the fuel-system tag)`, () => {
      const cfg = defaultConfig(fuel);
      const covered = new Set(FIELDS.map((f) => f.path));
      const skip = new Set(["id", "fuel", "fuelSystem.kind"]);
      for (const leaf of leaves(cfg)) {
        if (skip.has(leaf)) continue;
        expect(covered.has(leaf)).toBe(true);
      }
    });
    test(`${fuel}: preset values lie inside the field ranges`, () => {
      const cfg = defaultConfig(fuel);
      for (const f of FIELDS) {
        if (f.kind !== "number" || !isVisible(f, cfg)) continue;
        const r = f.range(cfg);
        const v = getPath(cfg, f.path) as number;
        expect(v).toBeGreaterThanOrEqual(r.min);
        expect(v).toBeLessThanOrEqual(r.max);
      }
    });
  }
  test("compression ranges differ by fuel", () => {
    const f = FIELDS.find((x) => x.path === "block.compressionRatio")!;
    if (f.kind !== "number") throw new Error();
    expect(f.range(defaultConfig("diesel")).min).toBe(14);
    expect(f.range(defaultConfig("petrol")).max).toBe(14);
  });
  test("cylinder options follow the layout", () => {
    expect(cylinderOptions("boxer").every((n) => n % 2 === 0)).toBe(true);
    expect(cylinderOptions("v").every((n) => n % 2 === 0 && n >= 4)).toBe(true);
    expect(cylinderOptions("w")).toEqual([8, 12, 16]);
    expect(cylinderOptions("vr")).toEqual([5, 6]);
  });
  test("switching layout snaps cylinders and bank angle", () => {
    let cfg: EngineConfig = defaultConfig("petrol");
    cfg = setPath(cfg, "block.layout", "vr");
    expect(cfg.block.cylinders).toBe(5);
    expect(cfg.block.bankAngleDeg).toBe(15);
    cfg = setPath(cfg, "block.layout", "w");
    expect(cfg.block.cylinders).toBe(8);
  });
  test("v8 crank only visible for V8, ITBs never for diesel", () => {
    const v8 = FIELDS.find((x) => x.path === "block.v8Crank")!;
    const itb = FIELDS.find((x) => x.path === "induction.individualThrottleBodies")!;
    let cfg = defaultConfig("petrol");
    expect(isVisible(v8, cfg)).toBe(false);
    cfg = setPath(setPath(cfg, "block.layout", "v"), "block.cylinders", 8);
    expect(isVisible(v8, cfg)).toBe(true);
    expect(isVisible(itb, defaultConfig("diesel"))).toBe(false);
  });
  test("normalize clamps out-of-range values", () => {
    const cfg = defaultConfig("petrol");
    cfg.block.compressionRatio = 20;
    expect(normalizeConfig(cfg).block.compressionRatio).toBe(14);
  });
});

describe("schematic geometry", () => {
  test("piston at TDC and BDC", () => {
    expect(pistonFraction(0, 90, 145)).toBeCloseTo(0, 6);
    expect(pistonFraction(180, 90, 145)).toBeCloseTo(1, 6);
    expect(pistonFraction(360, 90, 145)).toBeCloseTo(0, 6);
  });
  test("firing offsets are distinct and within 0…720", () => {
    const cfg = defaultConfig("diesel");
    const off = firingOffsets(cfg, summarize(cfg));
    expect(new Set(off).size).toBe(4);
    expect(off.every((o) => o >= 0 && o < 720)).toBe(true);
    expect(cylinderPhase(10, 700)).toBeCloseTo(30, 6);
  });
  test("V and boxer split into two banks", () => {
    const cfg = setPath(defaultConfig("petrol"), "block.layout", "v");
    expect(banks(cfg).length).toBe(2);
    expect(banks(cfg).reduce((a, b) => a + b.cylinders.length, 0)).toBe(cfg.block.cylinders);
  });
});
