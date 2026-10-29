import { describe, expect, test } from "bun:test";
import { summarize } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import {
  ControlTracker,
  Smoother,
  bankSequence,
  bladePassingHz,
  buildPulsePlan,
  cycleFrequencyHz,
  crankFrequencyHz,
  deriveVoice,
  estimateTurboRpm,
  firingAnglesDeg,
  firingFrequencyHz,
  foldToAudible,
  headerExtraLengthsM,
  knockFrequencyHz,
  limiterActive,
  nailIntensity,
  onePoleCoef,
  pipeResonanceHz,
} from "../../src/audio/model.ts";
import { crossed, softClip } from "../../src/audio/dsp.ts";
import { ENGINES, state } from "./helpers.ts";

describe("frequencies (petrol.md §6.1)", () => {
  test("firing frequency rpm/60 · z/2", () => {
    expect(firingFrequencyHz(3000, 4)).toBeCloseTo(100, 9);
    expect(firingFrequencyHz(6000, 8)).toBeCloseTo(400, 9);
    expect(firingFrequencyHz(800, 3)).toBeCloseTo(20, 9);
    expect(firingFrequencyHz(-100, 4)).toBe(0);
  });
  test("crank and cycle orders", () => {
    expect(crankFrequencyHz(3000)).toBe(50);
    expect(cycleFrequencyHz(3000)).toBe(25);
  });
  test("pipe resonance k·a/(2L)", () => {
    expect(pipeResonanceHz(1, 500)).toBe(250);
    expect(pipeResonanceHz(1, 500, 2)).toBe(500);
  });
  test("Draper knock mode: B 86 mm ≈ 6.5 kHz, B 103 mm ≈ 5.4 kHz", () => {
    expect(knockFrequencyHz(86)).toBeGreaterThan(6200);
    expect(knockFrequencyHz(86)).toBeLessThan(6800);
    expect(knockFrequencyHz(103)).toBeGreaterThan(5100);
    expect(knockFrequencyHz(103)).toBeLessThan(5700);
  });
  test("blade passing frequency", () => {
    expect(bladePassingHz(150000, 6)).toBe(15000);
  });
  test("foldToAudible is monotonic, continuous, bounded and ~identity at low f", () => {
    expect(foldToAudible(1000)).toBeCloseTo(1000, -1);
    expect(foldToAudible(0)).toBe(0);
    let prev = 0;
    for (let f = 100; f < 60000; f += 100) {
      const y = foldToAudible(f);
      expect(y).toBeGreaterThan(prev);
      expect(y).toBeLessThan(11000);
      prev = y;
    }
  });
  test("turbo speed estimate: ≈ 100–200 k rpm at 1.3 bar on a 38 mm inducer, rises with boost", () => {
    const n = estimateTurboRpm(1.3, 38, 1);
    expect(n).toBeGreaterThan(100000);
    expect(n).toBeLessThan(200000);
    expect(estimateTurboRpm(0.5, 38, 0.5)).toBeLessThan(n);
  });
});

describe("pulse plan", () => {
  test("even intervals → cumulative angles", () => {
    expect(firingAnglesDeg([180, 180, 180, 180])).toEqual([0, 180, 360, 540]);
    expect(firingAnglesDeg([240, 240, 240])).toEqual([0, 240, 480]);
  });
  test("uneven intervals (odd-fire V6) are kept", () => {
    expect(firingAnglesDeg([90, 150, 90, 150, 90, 150])).toEqual([0, 90, 240, 330, 480, 570]);
  });
  test("invalid input falls back to even spacing; wrong sum is rescaled", () => {
    expect(firingAnglesDeg([], 4)).toEqual([0, 180, 360, 540]);
    expect(firingAnglesDeg([NaN, 1, 2], 3)).toEqual([0, 240, 480]);
    expect(firingAnglesDeg([90, 90, 90, 90])).toEqual([0, 180, 360, 540]);
  });
  test("crossplane V8: per bank 180-270-180-90 (petrol.md §6.3)", () => {
    const banks = bankSequence("v", 8, "crossplane");
    const angles = firingAnglesDeg(Array(8).fill(90));
    for (const [b, expected] of [[0, [180, 270, 180, 90]], [1, [180, 90, 180, 270]]] as const) {
      const a = angles.filter((_, i) => banks[i] === b);
      const gaps = a.map((x, i) => ((a[(i + 1) % a.length]! - x + 720) % 720));
      // rotate so we can compare the cyclic pattern
      const s = gaps.join(",") + "," + gaps.join(",");
      expect(s.includes(expected.join(","))).toBe(true);
    }
  });
  test("flatplane V8 and other V engines: banks alternate, each bank even", () => {
    expect(bankSequence("v", 8, "flatplane")).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(bankSequence("v", 6, "crossplane")).toEqual([0, 1, 0, 1, 0, 1]);
  });
  test("inline and boxer share one collector", () => {
    expect(bankSequence("inline", 4, "crossplane")).toEqual([0, 0, 0, 0]);
    expect(bankSequence("boxer", 4, "crossplane")).toEqual([0, 0, 0, 0]);
  });
  test("boxer with unequal headers: ΔL 0.3–0.5 m; equal-length (tubular-long) ≈ 0", () => {
    const u = headerExtraLengthsM("boxer", "cast-log", 4);
    expect(Math.max(...u) - Math.min(...u)).toBeGreaterThan(0.3);
    expect(Math.max(...u) - Math.min(...u)).toBeLessThan(0.55);
    const e = headerExtraLengthsM("boxer", "tubular-long", 4);
    expect(Math.max(...e) - Math.min(...e)).toBeLessThan(0.02);
  });
  test("buildPulsePlan converts header length to delay L/a", () => {
    const p = buildPulsePlan([360, 360], [0, 0], [0, 0.6], 600);
    expect(p[1]!.headerDelayS).toBeCloseTo(0.001, 9);
    expect(p[1]!.angleDeg).toBe(360);
  });
});

describe("voice from config", () => {
  test("defaults derive finite, serialisable parameters", () => {
    for (const fuel of ["diesel", "petrol"] as const) {
      const cfg = defaultConfig(fuel);
      const v = deriveVoice(cfg, summarize(cfg));
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
      expect(v.slots.length).toBe(4);
      expect(v.exhaustLpHz).toBeGreaterThan(200);
      expect(v.exhaustLpHz).toBeLessThan(1200);
    }
  });
  test("diesel is darker than petrol; prechamber nail band lower than DI", () => {
    const d = ENGINES["r4-diesel-2.0"]!;
    const p = defaultConfig("petrol");
    expect(deriveVoice(d, summarize(d)).exhaustLpHz).toBeLessThan(deriveVoice(p, summarize(p)).exhaustLpHz);
    const idi = structuredClone(d);
    if (idi.fuelSystem.kind === "diesel") idi.fuelSystem.injection = "indirect-prechamber";
    expect(deriveVoice(idi, summarize(idi)).nailHz[1]).toBeLessThan(deriveVoice(d, summarize(d)).nailHz[1]);
  });
  test("bigger displacement → lower exhaust resonance", () => {
    const small = ENGINES["r3-diesel-1.5"]!;
    const big = ENGINES["v8-crossplane-6.2"]!;
    expect(deriveVoice(big, summarize(big)).resonances[0]!.hz).toBeLessThan(deriveVoice(small, summarize(small)).resonances[0]!.hz);
  });
  test("crossplane V8 has two banks, R4 one; blow-off only on petrol turbos; Roots whines", () => {
    const v8 = ENGINES["v8-crossplane-6.2"]!;
    expect(deriveVoice(v8, summarize(v8)).bankCount).toBe(2);
    const r4 = defaultConfig("diesel");
    expect(deriveVoice(r4, summarize(r4)).bankCount).toBe(1);
    expect(deriveVoice(r4, summarize(r4)).blowOff).toBe(false);
    const pt = defaultConfig("petrol");
    expect(deriveVoice(pt, summarize(pt)).blowOff).toBe(true);
    pt.induction.aspiration = "supercharger-roots";
    const sc = deriveVoice(pt, summarize(pt));
    expect(sc.scGain).toBeGreaterThan(0);
    expect(sc.turboGain).toBe(0);
  });
  test("turbo blade count 6 … 11", () => {
    const c = defaultConfig("petrol");
    for (const mm of [20, 38, 60, 120]) {
      c.induction.compressorInducerMm = mm;
      const n = deriveVoice(c, summarize(c)).turboBlades;
      expect(n).toBeGreaterThanOrEqual(6);
      expect(n).toBeLessThanOrEqual(11);
    }
  });
});

describe("diesel nail intensity (diesel.md Sound-Hinweise, petrol.md §6.4)", () => {
  test("cold louder than warm, unit injector louder than common rail, prechamber in between", () => {
    expect(nailIntensity("common-rail", 0, 20, 0)).toBeGreaterThan(nailIntensity("common-rail", 0, 90, 0));
    expect(nailIntensity("unit-injector", 0, 90, 0)).toBeGreaterThan(nailIntensity("indirect-prechamber", 0, 90, 0));
    expect(nailIntensity("indirect-prechamber", 0, 90, 0)).toBeGreaterThan(nailIntensity("common-rail", 0, 90, 0));
  });
  test("masked by load, louder with advanced timing, bounded 0 … 1", () => {
    expect(nailIntensity("unit-injector", 0, 90, 1)).toBeLessThan(nailIntensity("unit-injector", 0, 90, 0));
    expect(nailIntensity("common-rail", 5, 90, 0)).toBeGreaterThan(nailIntensity("common-rail", 0, 90, 0));
    for (const o of [-20, 0, 40]) {
      const x = nailIntensity("unit-injector", o, -30, 0);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });
});

describe("control tracker", () => {
  const cfg = defaultConfig("petrol");
  const voice = deriveVoice(cfg, summarize(cfg));
  test("limiter flag near rev limit with pedal", () => {
    expect(limiterActive(6790, 6800, 1, true)).toBe(true);
    expect(limiterActive(6000, 6800, 1, true)).toBe(false);
    expect(limiterActive(6790, 6800, 0, true)).toBe(false);
  });
  test("blow-off fires once when lifting off under boost", () => {
    const tr = new ControlTracker(voice);
    let fired = 0;
    for (let i = 0; i < 60; i++) if (tr.next(state({ t: i / 60, rpm: 4000, load: 1, boostBar: 1 }), 1).blowOff > 0) fired++;
    expect(fired).toBe(0);
    for (let i = 60; i < 120; i++) if (tr.next(state({ t: i / 60, rpm: 4000, load: 0, boostBar: 0.9 }), 0).blowOff > 0) fired++;
    expect(fired).toBe(1);
  });
  test("no blow-off without boost", () => {
    const tr = new ControlTracker(voice);
    let fired = 0;
    for (let i = 0; i < 60; i++) tr.next(state({ t: i / 60, rpm: 3000, load: 1 }), 1);
    for (let i = 60; i < 120; i++) if (tr.next(state({ t: i / 60, rpm: 3000 }), 0).blowOff > 0) fired++;
    expect(fired).toBe(0);
  });
  test("turbo speed estimated from boost when the core gives 0, with lag", () => {
    const tr = new ControlTracker(voice);
    const f1 = tr.next(state({ t: 0, rpm: 4000, load: 1, boostBar: 1 }), 1);
    let f = f1;
    for (let i = 1; i < 120; i++) f = tr.next(state({ t: i / 60, rpm: 4000, load: 1, boostBar: 1 }), 1);
    expect(f.turboRpm).toBeGreaterThan(f1.turboRpm * 3);
    expect(f.turboRpm).toBeGreaterThan(80000);
    const real = tr.next(state({ t: 3, rpm: 4000, turboRpm: 123456 }), 1);
    expect(real.turboRpm).toBe(123456);
  });
  test("starter detected from rising rpm while not running, or from starterEngaged", () => {
    const tr = new ControlTracker(voice);
    tr.next(state({ t: 0, running: false, rpm: 50 }), 0);
    expect(tr.next(state({ t: 1 / 60, running: false, rpm: 80 }), 0).starter).toBe(true);
    const tr2 = new ControlTracker(voice);
    const s = state({ t: 0, running: false, rpm: 0 }) as ReturnType<typeof state> & { starterEngaged: boolean };
    s.starterEngaged = true;
    expect(tr2.next(s, 0).starter).toBe(true);
  });
  test("crash edge only once; destroyed has no combustion", () => {
    const tr = new ControlTracker(voice);
    tr.next(state({ t: 0, rpm: 5000 }), 1);
    const a = tr.next(state({ t: 0.02, rpm: 5000, destroyed: true }), 1);
    const b = tr.next(state({ t: 0.04, rpm: 4000, destroyed: true }), 1);
    expect(a.crash).toBe(true);
    expect(b.crash).toBe(false);
    expect(b.combustion).toBe(false);
  });
  test("NaN state values do not leak into frames", () => {
    const tr = new ControlTracker(voice);
    const f = tr.next(state({ t: 0, rpm: NaN, load: NaN, boostBar: NaN, knock: NaN }), NaN);
    for (const [k, x] of Object.entries(f)) if (typeof x === "number") expect(Number.isFinite(x), k).toBe(true);
  });
});

describe("smoothing and helpers", () => {
  test("one-pole reaches 63 % after τ", () => {
    const fs = 1000;
    const s = new Smoother(0, 0.1, fs);
    s.target = 1;
    for (let i = 0; i < 100; i++) s.step();
    expect(s.value).toBeCloseTo(1 - Math.exp(-1), 2);
    expect(onePoleCoef(0, fs)).toBe(1);
  });
  test("crossed() handles wrap-around at 720°", () => {
    expect(crossed(719, 2, 0)).toBe(true);
    expect(crossed(719, 2, 720)).toBe(true);
    expect(crossed(100, 5, 103)).toBe(true);
    expect(crossed(100, 5, 106)).toBe(false);
    expect(crossed(100, 5, 100 + 720 + 2)).toBe(true);
  });
  test("softClip: identity below 0.75, bounded by 0.97 (≈ −0.26 dBFS), odd, monotonic", () => {
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(-0.5)).toBe(-0.5);
    expect(softClip(100)).toBeLessThanOrEqual(0.97);
    expect(softClip(-100)).toBeGreaterThanOrEqual(-0.97);
    let prev = -1;
    for (let x = -3; x <= 3; x += 0.01) {
      const y = softClip(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
});
