// Issue #66 settings (gas ramp, warm start, auto measure, pedal side, wake lock, vibration, realism, fuel price,
// reset) and #44 device helpers (input mode, wake lock, vibration).
import { beforeEach, describe, expect, test } from "bun:test";
import type { EngineState } from "../../src/core/index.ts";
import { Haptics, ScreenWake, nextInputMode, type WakeLockApi } from "../../src/ui/device.ts";
import {
  DEFAULT_SETTINGS, clampFuelPrice, clearAllStorage, migrateLegacy, resetSettingsCache, validateSettings,
} from "../../src/ui/settings.ts";
import { tripCosts } from "../../src/ui/trip-panel.ts";

beforeEach(() => resetSettingsCache());

describe("validateSettings (#66 fields)", () => {
  test("defaults for missing or broken values", () => {
    const s = validateSettings({ gasRamp: 2, startWarm: "yes", autoMeasure: 1, pedalSide: "middle", wakeLock: null, vibration: "always", realism: "hard", fuelPrice: "cheap" });
    expect(s.gasRamp).toBe(0);
    expect(s.startWarm).toBe(false);
    expect(s.autoMeasure).toBe(true);
    expect(s.pedalSide).toBe("right");
    expect(s.wakeLock).toBe(true);
    expect(s.vibration).toBe("auto");
    expect(s.realism).toBe("real");
    expect(s.fuelPrice).toEqual(DEFAULT_SETTINGS.fuelPrice);
  });
  test("valid values are kept", () => {
    const s = validateSettings({ gasRamp: 3, startWarm: true, autoMeasure: false, pedalSide: "left", wakeLock: false, vibration: "off", realism: "lenient", fuelPrice: { diesel: 1.599, petrol: 2 } });
    expect(s).toMatchObject({ gasRamp: 3, startWarm: true, autoMeasure: false, pedalSide: "left", wakeLock: false, vibration: "off", realism: "lenient" });
    expect(s.fuelPrice).toEqual({ diesel: 1.6, petrol: 2 });
    expect(validateSettings({ realism: "off" }).realism).toBe("off");
    expect(validateSettings({ gasRamp: 1 }).gasRamp).toBe(1);
  });
  test("fuel price is clamped and rounded to cents", () => {
    expect(clampFuelPrice(-1, 1.7)).toBe(0.1);
    expect(clampFuelPrice(99, 1.7)).toBe(10);
    expect(clampFuelPrice("1,859", 1.7)).toBe(1.86);
    expect(clampFuelPrice(Number.NaN, 1.7)).toBe(1.7);
    expect(clampFuelPrice(undefined, 1.7)).toBe(1.7);
  });
});

describe("legacy keys of the Bedienpult and the recorder", () => {
  const store = (o: Record<string, string>) => (k: string) => o[k] ?? null;
  test("moved into the settings where the settings lack them", () => {
    const m = validateSettings(migrateLegacy({}, store({ "pruefzelle.gasRamp": "3", "pruefzelle.startWarm": "1", "pruefzelle.autoMeasure": "0" })));
    expect(m).toMatchObject({ gasRamp: 3, startWarm: true, autoMeasure: false });
  });
  test("settings win over legacy keys; broken legacy values give defaults", () => {
    expect(migrateLegacy({ gasRamp: 1 }, store({ "pruefzelle.gasRamp": "3" })).gasRamp).toBe(1);
    expect(validateSettings(migrateLegacy({}, store({ "pruefzelle.gasRamp": "x" }))).gasRamp).toBe(0);
  });
});

test("clearAllStorage removes only pruefzelle.* keys", () => {
  const data = new Map([["pruefzelle.settings", "{}"], ["pruefzelle.tripcomputer", "{}"], ["other.app", "1"]]);
  const st = {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
  };
  expect(clearAllStorage(st)).toBe(2);
  expect([...data.keys()]).toEqual(["other.app"]);
  expect(clearAllStorage(null)).toBe(0);
});

test("trip costs from consumption and price", () => {
  const c = tripCosts({ km: 200, fuelL: 12, timeS: 7200 }, 1.8);
  expect(c.per100).toBeCloseTo(10.8, 9); // 6 l/100 km · 1,80 €/l
  expect(c.trip).toBeCloseTo(21.6, 9);
  const short = tripCosts({ km: 0.01, fuelL: 0.01, timeS: 1 }, 1.8);
  expect(Number.isNaN(short.per100)).toBe(true); // no average below the minimum distance
  expect(short.trip).toBeCloseTo(0.018, 9);
  // per 100 mi: 100 mi = 160,9 km → 1,609344 × the cost per 100 km
  expect(tripCosts({ km: 200, fuelL: 12, timeS: 7200 }, 1.8, 1 / 1.609344).per100).toBeCloseTo(10.8 * 1.609344, 9);
});

describe("input mode", () => {
  test("touch pointer switches to touch, a key press back; mouse events change nothing", () => {
    expect(nextInputMode("keyboard", { kind: "pointer", pointerType: "touch" })).toBe("touch");
    expect(nextInputMode("touch", { kind: "pointer", pointerType: "mouse" })).toBe("touch"); // emulated after a tap
    expect(nextInputMode("keyboard", { kind: "pointer", pointerType: "mouse" })).toBe("keyboard");
    expect(nextInputMode("touch", { kind: "key", inField: false, key: "w" })).toBe("keyboard");
  });
  test("typing into a field (on-screen keyboard) keeps touch", () => {
    expect(nextInputMode("touch", { kind: "key", inField: true, key: "1" })).toBe("touch");
    expect(nextInputMode("touch", { kind: "key", inField: false, key: "Unidentified" })).toBe("touch");
  });
});

describe("ScreenWake", () => {
  function fake() {
    const log: string[] = [];
    let onRelease: (() => void) | undefined;
    const api: WakeLockApi = {
      request: async () => {
        log.push("request");
        return { release: async () => void log.push("release"), addEventListener: (_t, fn) => (onRelease = fn) };
      },
    };
    return { api, log, browserRelease: () => onRelease?.() };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test("requests once while wanted and releases when not", async () => {
    const f = fake();
    const w = new ScreenWake(f.api, () => true);
    w.update(true);
    w.update(true);
    await tick();
    w.update(true);
    expect(w.held).toBe(true);
    expect(f.log).toEqual(["request"]);
    w.update(false);
    await tick();
    expect(w.held).toBe(false);
    expect(f.log).toEqual(["request", "release"]);
  });
  test("re-acquires after the browser dropped the lock (page hidden, visible again)", async () => {
    const f = fake();
    let visible = true;
    const w = new ScreenWake(f.api, () => visible);
    w.update(true);
    await tick();
    visible = false;
    f.browserRelease();
    w.update(true);
    expect(w.held).toBe(false);
    visible = true;
    w.onVisible();
    w.update(true);
    await tick();
    expect(w.held).toBe(true);
    expect(f.log.filter((x) => x === "request").length).toBe(2);
  });
  test("refused request is not retried every frame; missing API is a no-op", async () => {
    let n = 0;
    const w = new ScreenWake({ request: () => (n++, Promise.reject(new Error("NotAllowed"))) }, () => true);
    w.update(true);
    await tick();
    w.update(true);
    await tick();
    expect(n).toBe(1);
    const none = new ScreenWake(undefined, () => true);
    none.update(true);
    expect(none.held).toBe(false);
  });
});

describe("Haptics", () => {
  const st = (p: Partial<EngineState>) => ({ running: true, destroyed: false, rpm: 3000, absActive: false, ...p }) as EngineState;
  test("limiter pulses throttled, ABS and destroyed", () => {
    const calls: unknown[] = [];
    const h = new Haptics((p) => calls.push(p));
    for (let i = 0; i < 60; i++) h.update(1 / 60, st({ rpm: 5000 }), 5000, 1, true); // 1 s on the limiter
    expect(calls.filter((c) => c === Haptics.LIMITER).length).toBe(3); // 0, 0,4, 0,8 s
    calls.length = 0;
    h.update(1 / 60, st({ rpm: 2000, absActive: true }), 5000, 0, true);
    expect(calls).toEqual([Haptics.ABS]);
    calls.length = 0;
    h.update(1 / 60, st({ running: false, destroyed: true, rpm: 0 }), 5000, 1, true);
    h.update(1 / 60, st({ running: false, destroyed: true, rpm: 0 }), 5000, 1, true);
    expect(calls).toEqual([Haptics.DESTROYED]);
  });
  test("off when disabled or unsupported", () => {
    const calls: unknown[] = [];
    const h = new Haptics((p) => calls.push(p));
    h.update(1 / 60, st({ rpm: 5000 }), 5000, 1, false);
    expect(calls).toEqual([]);
    expect(() => new Haptics(undefined).update(1 / 60, st({ rpm: 5000 }), 5000, 1, true)).not.toThrow();
  });
});
