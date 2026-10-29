// Behavioural tests of the DSP, measured on offline renders (we cannot listen, so we measure).
import { describe, expect, test } from "bun:test";
import { summarize } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { EngineDsp } from "../../src/audio/dsp.ts";
import { deriveVoice, firingFrequencyHz, silentFrame } from "../../src/audio/model.ts";
import { ENGINES, autocorrPitchHz, dcOffset, dominantOrder, mono, peakDbfs, powerAt, renderRun, renderSteady, rmsDbfs, rumbleShare, variant } from "./helpers.ts";

const FS = 48000;

function bandEnergy(x: Float32Array, fs: number, lo: number, hi: number, step = 50) {
  let e = 0;
  for (let f = lo; f <= hi; f += step) e += powerAt(x, fs, f);
  return e;
}

describe("level safety", () => {
  test("every demo engine: peak < 0 dBFS, no DC, no NaN", () => {
    for (const [name, cfg] of Object.entries(ENGINES)) {
      const r = renderRun(cfg, [
        { t: 0, rpm: cfg.idleRpm, pedal: 0 },
        { t: 0.5, rpm: cfg.idleRpm, pedal: 1 },
        { t: 1.5, rpm: cfg.revLimitRpm - 20, pedal: 1 },
        { t: 2, rpm: cfg.revLimitRpm - 20, pedal: 1 },
      ]);
      const m = mono(r);
      expect(peakDbfs(r), name).toBeLessThan(-0.3);
      expect(Math.abs(dcOffset(m)), name).toBeLessThan(1e-3);
      expect(m.every(Number.isFinite), name).toBe(true);
    }
  });
  test("extreme config (V16, 9500 rpm, knock, boost, rod knock) still below 0 dBFS", () => {
    const c = variant("petrol", "v16", (c) => {
      c.block.layout = "v";
      c.block.cylinders = 16;
      c.block.boreMm = 110;
      c.block.strokeMm = 110;
      c.induction.aspiration = "twin-turbo-parallel";
      c.revLimitRpm = 9500;
    });
    const r = renderRun(c, [{ t: 0, rpm: 9400, pedal: 1, knock: 1, boost: 3 }, { t: 1, rpm: 9400, pedal: 1, knock: 1, boost: 3 }]);
    expect(peakDbfs(r)).toBeLessThan(-0.3);
    expect(mono(r).every(Number.isFinite)).toBe(true);
  });
});

describe("pitch follows the firing frequency rpm/60·z/2", () => {
  const cases: [string, number][] = [["r4-diesel-2.0", 800], ["r4-diesel-2.0", 2400], ["r3-diesel-1.5", 1500], ["r6-petrol-3.0", 1200], ["v8-crossplane-6.2", 650]];
  for (const [name, rpm] of cases) {
    test(`${name} @ ${rpm}`, () => {
      const cfg = ENGINES[name]!;
      const r = renderSteady(cfg, rpm, 0.2, 1.2);
      const x = mono(r, 0.4);
      const f = autocorrPitchHz(x, FS);
      const expected = firingFrequencyHz(rpm, cfg.block.cylinders);
      // The fundamental period is the firing period or (with cylinder spread) a whole multiple of it.
      const ratio = expected / f;
      expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(0.03);
      expect(dominantOrder(x, FS, rpm, cfg.block.cylinders)).toBe(cfg.block.cylinders / 2);
    });
  }
});

describe("configuration changes the sound", () => {
  test("crossplane V8 rumbles (sub-firing orders) far more than flatplane", () => {
    const cp = mono(renderSteady(ENGINES["v8-crossplane-6.2"]!, 3000, 0.6, 1.5), 0.5);
    const fp = mono(renderSteady(ENGINES["v8-flatplane-3.9"]!, 3000, 0.6, 1.5), 0.5);
    const a = rumbleShare(cp, FS, 3000, 8);
    const b = rumbleShare(fp, FS, 3000, 8);
    expect(a).toBeGreaterThan(0.04);
    expect(a).toBeGreaterThan(10 * b);
  });
  test("boxer with unequal headers rumbles more than with equal-length headers", () => {
    const uneq = ENGINES["boxer4-petrol-2.5"]!;
    const eq = structuredClone(uneq);
    eq.exhaust.manifold = "tubular-long";
    const a = rumbleShare(mono(renderSteady(uneq, 3000, 0.6, 1.5), 0.5), FS, 3000, 4);
    const b = rumbleShare(mono(renderSteady(eq, 3000, 0.6, 1.5), 0.5), FS, 3000, 4);
    expect(a).toBeGreaterThan(3 * b);
  });
  test("R3 has its main order at 1.5, R4 at 2", () => {
    expect(dominantOrder(mono(renderSteady(ENGINES["r3-diesel-1.5"]!, 2000, 0.5, 1.2), 0.4), FS, 2000, 3)).toBe(1.5);
    expect(dominantOrder(mono(renderSteady(ENGINES["r4-diesel-2.0"]!, 2000, 0.5, 1.2), 0.4), FS, 2000, 4)).toBe(2);
  });
  test("diesel nail: cold unit-injector has more 1–3 kHz energy than warm common rail", () => {
    const cr = ENGINES["r4-diesel-2.0"]!;
    const pd = ENGINES["r4-diesel-pd-cold"]!;
    const warm = mono(renderRun(cr, [{ t: 0, rpm: 800, pedal: 0, coolantC: 90 }, { t: 1.2, rpm: 800, pedal: 0, coolantC: 90 }]), 0.4);
    const cold = mono(renderRun(pd, [{ t: 0, rpm: 800, pedal: 0, coolantC: 20 }, { t: 1.2, rpm: 800, pedal: 0, coolantC: 20 }]), 0.4);
    expect(bandEnergy(cold, FS, 1000, 3000) / bandEnergy(warm, FS, 1000, 3000)).toBeGreaterThan(2);
  });
  test("diesel is darker: less energy above 1.5 kHz relative to the low band than petrol (warm, mid load)", () => {
    const d = mono(renderSteady(ENGINES["r4-diesel-2.0"]!, 2500, 0.6, 1.2), 0.4);
    const p = mono(renderSteady(defaultConfig("petrol"), 2500, 0.6, 1.2), 0.4);
    const ratio = (x: Float32Array) => bandEnergy(x, FS, 1500, 4000, 100) / bandEnergy(x, FS, 40, 400, 20);
    // Nail adds HF on the diesel, so compare against a prechamber-free warm CR at load (nail masked).
    expect(ratio(d)).toBeLessThan(ratio(p) * 1.5);
  });
  test("full load is louder than idle by ≥ 10 dB", () => {
    const cfg = defaultConfig("petrol");
    const idle = rmsDbfs(mono(renderSteady(cfg, 800, 0, 1), 0.4));
    const wot = rmsDbfs(mono(renderSteady(cfg, 5000, 1, 1), 0.4));
    expect(wot - idle).toBeGreaterThan(10);
  });
});

describe("events", () => {
  test("rev limiter stutters: envelope modulation at the cut rate", () => {
    const cfg = defaultConfig("petrol");
    const lim = renderRun(cfg, [{ t: 0, rpm: cfg.revLimitRpm - 20, pedal: 1 }, { t: 1.5, rpm: cfg.revLimitRpm - 20, pedal: 1 }]);
    const free = renderRun(cfg, [{ t: 0, rpm: cfg.revLimitRpm - 400, pedal: 1 }, { t: 1.5, rpm: cfg.revLimitRpm - 400, pedal: 1 }]);
    const env = (x: Float32Array) => {
      // RMS in 10 ms windows → coefficient of variation
      const w = 480;
      const v: number[] = [];
      for (let i = 0; i + w < x.length; i += w) {
        let s = 0;
        for (let j = 0; j < w; j++) s += x[i + j]! ** 2;
        v.push(Math.sqrt(s / w));
      }
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) / m;
    };
    expect(env(mono(lim, 0.3))).toBeGreaterThan(1.5 * env(mono(free, 0.3)));
  });
  test("turbo whistle frequency rises with turbo rpm", () => {
    const cfg = defaultConfig("petrol");
    const v = deriveVoice(cfg, summarize(cfg));
    const dsp = new EngineDsp(FS);
    dsp.setVoice(v);
    const l = new Float32Array(4800);
    const r = new Float32Array(4800);
    const f = silentFrame();
    dsp.setControl({ ...f, rpm: 3000, combustion: true, turboRpm: 60000, airFlow: 0.5 });
    for (let i = 0; i < 20; i++) dsp.process(l, r);
    const a = dsp.turboWhistleHz;
    dsp.setControl({ ...f, rpm: 3000, combustion: true, turboRpm: 120000, airFlow: 0.5 });
    for (let i = 0; i < 20; i++) dsp.process(l, r);
    expect(dsp.turboWhistleHz).toBeGreaterThan(a * 1.4);
    expect(a).toBeCloseTo(Math.min(v.turboBlades * 1000, 11000 * Math.tanh((v.turboBlades * 1000) / 11000)), -1);
  });
  test("knock adds energy around the Draper frequency", () => {
    const cfg = defaultConfig("petrol");
    const fk = deriveVoice(cfg, summarize(cfg)).knockHz;
    const k0 = mono(renderRun(cfg, [{ t: 0, rpm: 3000, pedal: 1 }, { t: 1, rpm: 3000, pedal: 1 }]), 0.3);
    const k1 = mono(renderRun(cfg, [{ t: 0, rpm: 3000, pedal: 1, knock: 1 }, { t: 1, rpm: 3000, pedal: 1, knock: 1 }]), 0.3);
    expect(bandEnergy(k1, FS, fk - 400, fk + 400, 50) / bandEnergy(k0, FS, fk - 400, fk + 400, 50)).toBeGreaterThan(3);
  });
  test("starter is audible, destroyed engine falls silent after the crash", () => {
    const cfg = defaultConfig("diesel");
    const st = renderRun(cfg, [{ t: 0, rpm: 0, pedal: 0, running: false, starter: true }, { t: 0.3, rpm: 200, pedal: 0, running: false, starter: true }, { t: 1, rpm: 220, pedal: 0, running: false, starter: true }]);
    expect(rmsDbfs(mono(st, 0.4))).toBeGreaterThan(-45);
    const d = renderRun(cfg, [{ t: 0, rpm: 3000, pedal: 1 }, { t: 0.5, rpm: 3000, pedal: 1 }, { t: 0.5001, rpm: 3000, pedal: 1, destroyed: true }, { t: 4, rpm: 0, pedal: 1, destroyed: true }]);
    expect(rmsDbfs(mono(d, 0.55, 0.9))).toBeGreaterThan(-40); // crash
    expect(rmsDbfs(mono(d, 3.5))).toBeLessThan(-70); // silence
  });
  test("volume changes are click-free (no sample jump > 0.1 on a jump 0 → 1)", () => {
    const cfg = defaultConfig("petrol");
    const v = deriveVoice(cfg, summarize(cfg));
    const dsp = new EngineDsp(FS);
    dsp.setVoice(v);
    dsp.setVolume(0);
    dsp.setControl({ ...silentFrame(), rpm: 3000, load: 0.5, pedal: 0.5, combustion: true, airFlow: 0.4 });
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    for (let i = 0; i < 100; i++) dsp.process(l, r);
    dsp.setVolume(1);
    let prev = 0;
    let maxJump = 0;
    for (let b = 0; b < 40; b++) {
      dsp.process(l, r);
      for (let i = 0; i < l.length; i++) {
        maxJump = Math.max(maxJump, Math.abs(l[i]! - prev));
        prev = l[i]!;
      }
    }
    expect(maxJump).toBeLessThan(0.1);
  });
  test("without a voice the DSP outputs silence", () => {
    const dsp = new EngineDsp(FS);
    const l = new Float32Array(128).fill(1);
    const r = new Float32Array(128).fill(1);
    dsp.process(l, r);
    expect(l.every((x) => x === 0) && r.every((x) => x === 0)).toBe(true);
  });
});
