import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../../src/data/presets.ts";
import { parseNumber } from "../../src/ui/format.ts";
import { setPath } from "../../src/ui/fields.ts";
import { autoName, layoutCode } from "../../src/ui/names.ts";
import { FALLBACK_LIMITS, egtLimitC, lambdaLimit } from "../../src/ui/limits-fallback.ts";

describe("parseNumber", () => {
  test("dot and comma both work as decimal separator", () => {
    expect(parseNumber("81.5")).toBe(81.5);
    expect(parseNumber("81,5")).toBe(81.5);
    expect(parseNumber("0.88")).toBe(0.88);
    expect(parseNumber("0,88")).toBe(0.88);
    expect(parseNumber("-2.5")).toBe(-2.5);
    expect(parseNumber("−2,5")).toBe(-2.5);
    expect(parseNumber(" 16,5 ")).toBe(16.5);
  });
  test("thousands separators only when unambiguous", () => {
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("12.000.000")).toBe(12000000);
    expect(parseNumber("4800")).toBe(4800);
  });
  test("ambiguous groups follow the field range", () => {
    // what fmt() writes for the rev limiter must read back as the same value
    expect(parseNumber("4.800", { min: 2500, max: 6000 })).toBe(4800);
    // bore 100.5 mm typed with three decimals is unusual, but 81.500 must stay 81.5 in a mm field
    expect(parseNumber("81.500", { min: 50, max: 140 })).toBe(81.5);
    expect(parseNumber("1,125", { min: 0.3, max: 1.4 })).toBe(1.125);
    expect(parseNumber("1,125", { min: 500, max: 2000 })).toBe(1125);
  });
  test("garbage is NaN", () => {
    expect(parseNumber("")).toBeNaN();
    expect(parseNumber("abc")).toBeNaN();
    expect(parseNumber("1,2,3")).toBeNaN();
    expect(parseNumber("1.2.3,4")).toBeNaN();
  });
});

describe("autoName", () => {
  test("presets get a name from their configuration", () => {
    expect(autoName(defaultConfig("diesel"))).toBe("R4 Diesel 2,0 Turbo");
    expect(autoName(defaultConfig("petrol"))).toBe("R4 Benziner 2,0 Turbo");
  });
  test("follows layout, cylinders, displacement and charging", () => {
    let cfg = defaultConfig("petrol");
    cfg = setPath(cfg, "block.layout", "v");
    cfg = setPath(cfg, "block.cylinders", 8);
    cfg = setPath(cfg, "block.boreMm", 103.25);
    cfg = setPath(cfg, "block.strokeMm", 92);
    expect(autoName(cfg)).toBe("V8 Benziner 6,2 Turbo");
    cfg = setPath(cfg, "induction.aspiration", "naturally-aspirated");
    expect(autoName(cfg)).toBe("V8 Benziner 6,2 Sauger");
    expect(layoutCode(setPath(cfg, "block.layout", "boxer"))).toBe("Boxer 8");
  });
});

describe("limits fallback", () => {
  test("fuel dependent limits", () => {
    expect(egtLimitC(defaultConfig("diesel"))).toBeLessThan(egtLimitC(defaultConfig("petrol")));
    expect(lambdaLimit(defaultConfig("diesel"))).toBe(1.3);
    expect(lambdaLimit(defaultConfig("petrol"))).toBe(FALLBACK_LIMITS.petrolLambdaMin);
  });
});
