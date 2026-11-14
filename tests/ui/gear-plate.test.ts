// Review PR #90: input parsing of the Gänge-Platte (issue #14) – decimal comma, junk, stored ratios.
import { describe, expect, test } from "bun:test";
import { parseRatioInput, parseSavedRatios } from "../../src/ui/gear-plate.ts";
import { validateRatios } from "../../src/core/index.ts";

describe("gear plate input (issue #14)", () => {
  test("decimal comma and point, whitespace", () => {
    expect(parseRatioInput("3,77")).toBeCloseTo(3.77, 9);
    expect(parseRatioInput(" 0.71 ")).toBeCloseTo(0.71, 9);
    expect(parseRatioInput(",9")).toBeCloseTo(0.9, 9);
    expect(parseRatioInput("4")).toBe(4);
  });

  test("invalid input is NaN and the core rejects the set", () => {
    for (const t of ["", "abc", "3,5,1", "-2", "1e3", "3.77x", "∞"]) expect(parseRatioInput(t)).toBeNaN();
    expect(validateRatios([3.77, parseRatioInput("abc"), 1.47, 1.1, 0.87, 0.71])).not.toBeNull();
    expect(validateRatios([3.77, parseRatioInput("2,09"), 1.47, 1.1, 0.87, 0.71])).toBeNull();
  });

  test("stored ratios: shape checked, corrupt data → null, non-numbers become NaN (rejected by the core)", () => {
    expect(parseSavedRatios({ kind: "car", type: "manual", ratios: [3, 2, 1.5, 1] })).toEqual({ kind: "car", type: "manual", ratios: [3, 2, 1.5, 1] });
    expect(parseSavedRatios(null)).toBeNull();
    expect(parseSavedRatios("x")).toBeNull();
    expect(parseSavedRatios({ kind: "car", type: "manual", ratios: "3,2,1" })).toBeNull();
    expect(parseSavedRatios({ kind: 1, type: "manual", ratios: [] })).toBeNull();
    const odd = parseSavedRatios({ kind: "car", type: "manual", ratios: [3, "2", null, 1] })!;
    expect(odd.ratios[1]).toBeNaN();
    expect(validateRatios(odd.ratios)).not.toBeNull();
  });
});
