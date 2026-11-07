// Issue #42 stage 1: hash → screen.
import { expect, test } from "bun:test";
import { hrefOf, isTypingTarget, parseRoute } from "../../src/ui/router.ts";

test("hash maps to a screen, menu is the default", () => {
  expect(parseRoute("")).toBe("menu");
  expect(parseRoute("#")).toBe("menu");
  expect(parseRoute("#menu")).toBe("menu");
  expect(parseRoute("#sandbox")).toBe("sandbox");
  expect(parseRoute("#settings")).toBe("settings");
  expect(parseRoute("#/sandbox")).toBe("sandbox");
  expect(parseRoute("#SANDBOX")).toBe("sandbox");
  expect(parseRoute("#sandbox?x=1")).toBe("sandbox");
  // modes that do not exist yet open the menu
  expect(parseRoute("#builder")).toBe("menu");
  expect(parseRoute("#career")).toBe("menu");
  expect(parseRoute("#unsinn")).toBe("menu");
  expect(hrefOf("settings")).toBe("#settings");
  expect(parseRoute(hrefOf("sandbox"))).toBe("sandbox");
});

test("Esc is left alone while typing", () => {
  expect(isTypingTarget(null)).toBe(false);
  expect(isTypingTarget({ tagName: "INPUT", type: "text" })).toBe(true);
  expect(isTypingTarget({ tagName: "INPUT", type: "number" })).toBe(true);
  expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
  expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
  expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
  expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  expect(isTypingTarget({ tagName: "INPUT", type: "range" })).toBe(false);
  expect(isTypingTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
  expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
  expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
});
