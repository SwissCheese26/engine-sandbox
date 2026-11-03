// Review PR #39: stored environment / assistant settings are validated before they reach the drivetrain.
import { describe, expect, test } from "bun:test";
import { parseAssists, parseEnvironment } from "../../src/ui/environment-panel.ts";

describe("environment storage (issue #23)", () => {
  test("valid values pass, out-of-range numbers are clamped, junk is dropped", () => {
    expect(parseEnvironment({ weather: "snow", ambientC: -3, altitudeM: 800, gradePct: 4 })).toEqual({ weather: "snow", ambientC: -3, altitudeM: 800, gradePct: 4 });
    expect(parseEnvironment({ weather: "lava", ambientC: 99, altitudeM: Number.NaN, gradePct: "5" })).toEqual({ ambientC: 40 });
    expect(parseEnvironment(null)).toEqual({});
    expect(parseEnvironment("x")).toEqual({});
  });

  test("assists: only booleans of known keys", () => {
    expect(parseAssists({ abs: false, esp: true, asr: "no", turbo: true })).toEqual({ abs: false, esp: true });
    expect(parseAssists(42)).toEqual({});
  });
});
