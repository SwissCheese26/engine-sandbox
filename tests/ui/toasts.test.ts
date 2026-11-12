// Toast queue for limit hints (Arthur's phone feedback): dedupe, max visible, cooldown, critical always; plus the
// new settings "Hinweise zu Grenzwerten", "Ton" and volume.
import { beforeEach, describe, expect, test } from "bun:test";
import type { EngineState } from "../../src/core/index.ts";
import { ToastQueue, type ToastInput } from "../../src/ui/toast-queue.ts";
import { toastInputs } from "../../src/ui/toasts.ts";
import { DEFAULT_SETTINGS, clampVolume, resetSettingsCache, validateSettings } from "../../src/ui/settings.ts";

const piston: ToastInput = { key: "w:piston-speed:warning", severity: "warning", text: "Mittlere Kolbengeschwindigkeit 14,4 m/s (Grenze 14,7 m/s)" };
const egt: ToastInput = { key: "w:egt-high:warning", severity: "warning", text: "Abgastemperatur 780 °C" };
const rev: ToastInput = { key: "w:over-rev:critical", severity: "critical", text: "Drehzahl über dem Begrenzer" };
const dead: ToastInput = { key: "destroyed", severity: "critical", text: "Motor zerstört.", always: true };

describe("ToastQueue", () => {
  test("setting off: limit warnings stay silent, critical events always show", () => {
    const q = new ToastQueue();
    expect(q.sync([piston, rev], 0, false).added).toEqual([]);
    const { added } = q.sync([piston, rev, dead], 16, false);
    expect(added.map((t) => t.key)).toEqual(["destroyed"]);
  });

  test("a warning that stays active is shown once", () => {
    const q = new ToastQueue();
    expect(q.sync([piston], 0, true).added).toHaveLength(1);
    for (let t = 16; t < 10000; t += 16) expect(q.sync([piston], t, true).added).toHaveLength(0);
  });

  test("toasts expire after their lifetime", () => {
    const q = new ToastQueue({ ttlMs: 3000 });
    q.sync([piston], 0, true);
    expect(q.sync([piston], 2999, true).removed).toHaveLength(0);
    const { removed } = q.sync([piston], 3000, true);
    expect(removed.map((t) => t.key)).toEqual([piston.key]);
    expect(q.visible).toHaveLength(0);
  });

  test("cleared and back: shown again only after the cooldown", () => {
    const q = new ToastQueue({ cooldownMs: 10000 });
    q.sync([piston], 0, true);
    q.sync([], 1000, true); // cleared
    expect(q.sync([piston], 2000, true).added).toHaveLength(0); // back too soon (flicker at the limit)
    q.sync([], 3000, true);
    expect(q.sync([piston], 10500, true).added).toHaveLength(1);
  });

  test("a warning flickering at the limit inside the cooldown is not shown again even later while active", () => {
    const q = new ToastQueue({ cooldownMs: 10000 });
    q.sync([piston], 0, true);
    q.sync([], 100, true);
    q.sync([piston], 200, true); // suppressed by cooldown, but now counted as active
    expect(q.sync([piston], 20000, true).added).toHaveLength(0);
  });

  test("at most two visible: the oldest limit toast goes, a critical event stays", () => {
    const q = new ToastQueue({ maxVisible: 2 });
    q.sync([dead], 0, true);
    q.sync([dead, piston], 10, true);
    const ch = q.sync([dead, piston, egt], 20, true);
    expect(q.visible.map((t) => t.key)).toEqual(["destroyed", egt.key]);
    expect(ch.removed.map((t) => t.key)).toEqual([piston.key]);
    expect(ch.added.map((t) => t.key)).toEqual([egt.key]);
  });

  test("three new at once: only two are added, nothing removed that was never shown", () => {
    const q = new ToastQueue({ maxVisible: 2 });
    const ch = q.sync([piston, egt, rev], 0, true);
    expect(ch.added).toHaveLength(2);
    expect(ch.removed).toHaveLength(0);
    expect(q.visible).toHaveLength(2);
  });

  test("duplicate keys in one frame count once; clear() starts fresh", () => {
    const q = new ToastQueue();
    expect(q.sync([piston, piston], 0, true).added).toHaveLength(1);
    expect(q.clear()).toHaveLength(1);
    expect(q.sync([piston], 1, true).added).toHaveLength(1);
  });

  test("critical events live longer than limit hints", () => {
    const q = new ToastQueue({ ttlMs: 3000, alwaysTtlMs: 5000 });
    q.sync([dead, piston], 0, true);
    q.sync([dead, piston], 3500, true);
    expect(q.visible.map((t) => t.key)).toEqual(["destroyed"]);
  });
});

describe("toastInputs", () => {
  const state = (p: Partial<EngineState>) => ({ destroyed: false, warnings: [], damage: [], ...p }) as unknown as EngineState;
  test("warnings without info, fatal damage as an always event, empty tank", () => {
    const inputs = toastInputs({
      state: state({
        destroyed: true,
        warnings: [
          { code: "piston-speed", severity: "warning", message: "Kolben" },
          { code: "smoke", severity: "info", message: "Rauch" },
        ],
        damage: [{ code: "conrod-stress", t: 3, message: "Pleuelabriss.", fatal: true }],
      }),
      outOfFuel: true,
    });
    expect(inputs.map((i) => [i.key, !!i.always])).toEqual([
      ["destroyed", true],
      ["fuel-empty", true],
      ["w:piston-speed:warning", false],
    ]);
    expect(inputs[0]!.text).toContain("Pleuelabriss");
  });
});

describe("settings: Hinweise and Ton", () => {
  beforeEach(() => resetSettingsCache());
  test("defaults: hints off, sound on", () => {
    expect(DEFAULT_SETTINGS.limitHints).toBe("off");
    expect(DEFAULT_SETTINGS.sound).toBe(true);
    const s = validateSettings({});
    expect(s.limitHints).toBe("off");
    expect(s.sound).toBe(true);
    expect(s.volume).toBe(0.6);
  });
  test("valid values kept, broken ones fall back", () => {
    expect(validateSettings({ limitHints: "toast", sound: false, volume: 0.3 })).toMatchObject({ limitHints: "toast", sound: false, volume: 0.3 });
    expect(validateSettings({ limitHints: "loud", sound: "yes", volume: "max" })).toMatchObject({ limitHints: "off", sound: true, volume: 0.6 });
  });
  test("volume clamped to 0 … 1 in 5 % steps", () => {
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(0.33)).toBe(0.35);
    expect(clampVolume(NaN)).toBe(0.6);
  });
});
