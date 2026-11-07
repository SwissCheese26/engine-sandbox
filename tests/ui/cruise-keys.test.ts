// Key mapping of the Tempomat-Leiste (issue #30, review PR #46): layout-independent ±, typing guard.
import { describe, expect, test } from "bun:test";
import { cruiseKeyAction, isTypingTarget } from "../../src/ui/cruise-panel.ts";

const ev = (key: string, code: string, target: unknown = { tagName: "BODY" }, mods: Record<string, boolean> = {}) => ({ key, code, target, ...mods });

describe("cruise keys", () => {
  test("letters C / R / L", () => {
    expect(cruiseKeyAction(ev("c", "KeyC"))).toBe("set");
    expect(cruiseKeyAction(ev("C", "KeyC"))).toBe("set");
    expect(cruiseKeyAction(ev("r", "KeyR"))).toBe("resume");
    expect(cruiseKeyAction(ev("l", "KeyL"))).toBe("limiter");
  });

  test("± by physical key: US (= / -), German (+ / -), numpad, also with Shift", () => {
    expect(cruiseKeyAction(ev("=", "Equal"))).toBe("plus");
    expect(cruiseKeyAction(ev("+", "Equal", undefined, { shiftKey: true }))).toBe("plus");
    expect(cruiseKeyAction(ev("-", "Minus"))).toBe("minus");
    expect(cruiseKeyAction(ev("+", "BracketRight"))).toBe("plus");
    expect(cruiseKeyAction(ev("*", "BracketRight", undefined, { shiftKey: true }))).toBe("plus");
    expect(cruiseKeyAction(ev("-", "Slash"))).toBe("minus");
    expect(cruiseKeyAction(ev("_", "Slash", undefined, { shiftKey: true }))).toBe("minus");
    expect(cruiseKeyAction(ev("+", "NumpadAdd"))).toBe("plus");
    expect(cruiseKeyAction(ev("-", "NumpadSubtract"))).toBe("minus");
  });

  test("page keys are left to the page (scrolling), other keys are not ours", () => {
    expect(cruiseKeyAction(ev("PageUp", "PageUp"))).toBeNull();
    expect(cruiseKeyAction(ev("PageDown", "PageDown"))).toBeNull();
    expect(cruiseKeyAction(ev("w", "KeyW"))).toBeNull();
    expect(cruiseKeyAction(ev("q", "KeyQ"))).toBeNull();
  });

  test("typing guard like controls.ts: number/text fields and selects keep their keys, sliders do not", () => {
    for (const t of [{ tagName: "INPUT", type: "number" }, { tagName: "INPUT", type: "text" }, { tagName: "SELECT" }, { tagName: "TEXTAREA" }]) {
      expect(isTypingTarget(t)).toBe(true);
      expect(cruiseKeyAction(ev("-", "Slash", t))).toBeNull();
      expect(cruiseKeyAction(ev("c", "KeyC", t))).toBeNull();
    }
    for (const t of [{ tagName: "INPUT", type: "range" }, { tagName: "INPUT", type: "checkbox" }, { tagName: "BUTTON" }, null]) {
      expect(isTypingTarget(t)).toBe(false);
      expect(cruiseKeyAction(ev("+", "BracketRight", t))).toBe("plus");
    }
  });

  test("Ctrl/Alt/Meta combinations stay with the browser", () => {
    expect(cruiseKeyAction(ev("+", "Equal", undefined, { ctrlKey: true }))).toBeNull();
    expect(cruiseKeyAction(ev("-", "Minus", undefined, { metaKey: true }))).toBeNull();
    expect(cruiseKeyAction(ev("l", "KeyL", undefined, { altKey: true }))).toBeNull();
  });
});
