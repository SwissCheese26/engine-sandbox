// Offline helpers for the sound tests and render-demo: engine variants, scripted runs, WAV writer
// and simple numeric analysis (peak, DC, autocorrelation pitch, order energies).
import { summarize } from "../../src/core/index.ts";
import type { EngineConfig, EngineState } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { EngineDsp } from "../../src/audio/dsp.ts";
import { ControlTracker, deriveVoice } from "../../src/audio/model.ts";

export function variant(fuel: EngineConfig["fuel"], name: string, edit: (c: EngineConfig) => void): EngineConfig {
  const c = defaultConfig(fuel);
  c.id = name;
  c.name = name;
  edit(c);
  return c;
}

export const ENGINES: Record<string, EngineConfig> = {
  "r4-diesel-2.0": defaultConfig("diesel"),
  "r3-diesel-1.5": variant("diesel", "r3-diesel-1.5", (c) => {
    c.block.cylinders = 3;
    c.block.boreMm = 84;
    c.block.strokeMm = 90;
    c.induction.compressorInducerMm = 34;
  }),
  "r4-diesel-pd-cold": variant("diesel", "r4-diesel-pd-cold", (c) => {
    if (c.fuelSystem.kind === "diesel") c.fuelSystem.injection = "unit-injector";
    c.exhaust.particulateFilter = false;
  }),
  "r6-petrol-3.0": variant("petrol", "r6-petrol-3.0", (c) => {
    c.block.cylinders = 6;
    c.block.boreMm = 84;
    c.block.strokeMm = 89.6;
    c.induction.aspiration = "naturally-aspirated";
    c.exhaust.manifold = "tubular-short";
    c.revLimitRpm = 7000;
  }),
  "v8-crossplane-6.2": variant("petrol", "v8-crossplane-6.2", (c) => {
    c.block.layout = "v";
    c.block.cylinders = 8;
    c.block.bankAngleDeg = 90;
    c.block.v8Crank = "crossplane";
    c.block.boreMm = 103.25;
    c.block.strokeMm = 92;
    c.head.valvetrain = "ohv";
    c.head.valvesPerCylinder = 2;
    c.induction.aspiration = "naturally-aspirated";
    c.exhaust.manifold = "tubular-short";
    c.revLimitRpm = 6600;
    c.idleRpm = 650;
  }),
  "v8-flatplane-3.9": variant("petrol", "v8-flatplane-3.9", (c) => {
    c.block.layout = "v";
    c.block.cylinders = 8;
    c.block.bankAngleDeg = 90;
    c.block.v8Crank = "flatplane";
    c.block.boreMm = 94;
    c.block.strokeMm = 71;
    c.induction.aspiration = "naturally-aspirated";
    c.exhaust.manifold = "tubular-long";
    c.revLimitRpm = 9000;
    c.idleRpm = 900;
  }),
  "boxer4-petrol-2.5": variant("petrol", "boxer4-petrol-2.5", (c) => {
    c.block.layout = "boxer";
    c.block.cylinders = 4;
    c.block.bankAngleDeg = 180;
    c.block.boreMm = 99.5;
    c.block.strokeMm = 79;
    c.exhaust.manifold = "cast-log";
    c.revLimitRpm = 6700;
  }),
};

export function state(partial: Partial<EngineState>): EngineState {
  return {
    t: 0, running: true, destroyed: false, rpm: 0, crankAngleDeg: 0, torqueNm: 0, powerKw: 0, imepBar: 0, bmepBar: 0,
    fmepBar: 0, load: 0, manifoldAbsKpa: 101, boostBar: 0, turboRpm: 0, airMassFlowKgS: 0, fuelMassFlowGS: 0,
    fuelFlowLh: 0, bsfcGkWh: Number.NaN, efficiency: 0, lambda: 1, egtC: 300, coolantC: 90, oilC: 95,
    oilPressureBar: 3, peakPressureBar: 0, meanPistonSpeedMs: 0, knock: 0, smoke: 0, wear: 0, warnings: [], damage: [],
    ...partial,
  };
}

/** A scripted point: at time t (s) the engine is at these values (linear interpolation in between). */
export interface Key {
  t: number;
  rpm: number;
  pedal: number;
  running?: boolean;
  starter?: boolean;
  coolantC?: number;
  knock?: number;
  boost?: number;
  destroyed?: boolean;
}

export interface Render {
  l: Float32Array;
  r: Float32Array;
  fs: number;
}

const FRAME = 1 / 60;
const BLOCK = 128;

/** Renders a scripted run through the same ControlTracker + EngineDsp path the browser uses. */
export function renderRun(cfg: EngineConfig, keys: Key[], fs = 48000, seed = 1): Render {
  const summary = summarize(cfg);
  const voice = deriveVoice(cfg, summary);
  const tracker = new ControlTracker(voice);
  const dsp = new EngineDsp(fs, seed);
  dsp.setVoice(voice);
  dsp.setVolume(0.8);
  const dur = keys[keys.length - 1]!.t;
  const total = Math.ceil(dur * fs / BLOCK) * BLOCK;
  const l = new Float32Array(total);
  const r = new Float32Array(total);
  const turbo = cfg.induction.aspiration !== "naturally-aspirated";
  let nextFrame = 0;
  for (let i = 0; i < total; i += BLOCK) {
    const t = i / fs;
    if (t >= nextFrame) {
      nextFrame += FRAME;
      const k = sample(keys, t);
      const load = k.pedal;
      // Boost builds with rpm and load (placeholder-physics-like), or as scripted.
      const boost = k.boost ?? (turbo ? cfg.induction.boostTargetBar * load * Math.min(1, k.rpm / 2500) : 0);
      const s = state({
        t,
        rpm: k.rpm,
        load,
        running: k.running ?? true,
        destroyed: k.destroyed ?? false,
        coolantC: k.coolantC ?? 90,
        knock: k.knock ?? 0,
        boostBar: boost,
      });
      (s as EngineState & { starterEngaged?: boolean }).starterEngaged = k.starter ?? false;
      dsp.setControl(tracker.next(s, k.pedal));
    }
    dsp.process(l.subarray(i, i + BLOCK), r.subarray(i, i + BLOCK), BLOCK);
  }
  return { l, r, fs };
}

function sample(keys: Key[], t: number): Key {
  let a = keys[0]!;
  for (const k of keys) {
    if (k.t <= t) a = k;
    else {
      const x = (t - a.t) / Math.max(1e-9, k.t - a.t);
      const lerp = (p: number, q: number) => p + (q - p) * x;
      return {
        ...a,
        t,
        rpm: lerp(a.rpm, k.rpm),
        pedal: lerp(a.pedal, k.pedal),
        coolantC: lerp(a.coolantC ?? 90, k.coolantC ?? 90),
        knock: lerp(a.knock ?? 0, k.knock ?? 0),
      };
    }
  }
  return a;
}

/** Steady run at constant rpm/pedal (for spectral checks). */
export function renderSteady(cfg: EngineConfig, rpm: number, pedal: number, seconds: number, fs = 48000): Render {
  return renderRun(cfg, [{ t: 0, rpm, pedal }, { t: seconds, rpm, pedal }], fs);
}

// ---------------------------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------------------------

export function mono(r: Render, from = 0, to = 1e9): Float32Array {
  const a = Math.max(0, Math.floor(from * r.fs));
  const b = Math.min(r.l.length, Math.floor(to * r.fs));
  const m = new Float32Array(Math.max(0, b - a));
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (r.l[a + i]! + r.r[a + i]!);
  return m;
}

export function peakDbfs(r: Render): number {
  let p = 0;
  for (let i = 0; i < r.l.length; i++) p = Math.max(p, Math.abs(r.l[i]!), Math.abs(r.r[i]!));
  return 20 * Math.log10(Math.max(1e-12, p));
}

export function rmsDbfs(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return 10 * Math.log10(Math.max(1e-24, s / Math.max(1, x.length)));
}

export function dcOffset(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  return s / Math.max(1, x.length);
}

/** Goertzel power at frequency hz (normalised by length). */
export function powerAt(x: Float32Array, fs: number, hz: number): number {
  const w = (2 * Math.PI * hz) / fs;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  const n = x.length;
  for (let i = 0; i < n; i++) {
    // Hann window
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const s0 = x[i]! * win + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / (n * n);
}

/**
 * Pitch by normalised autocorrelation of the low-passed signal, searching periods for 15 … 600 Hz.
 * Returns the frequency of the first lag whose correlation is within 10 % of the global maximum
 * (prefers the shortest true period, avoids octave errors to sub-multiples).
 */
export function autocorrPitchHz(x: Float32Array, fs: number, minHz = 15, maxHz = 600): number {
  // Simple 2-pole low-pass at 1 kHz to suppress noise.
  const y = new Float32Array(x.length);
  const a = Math.exp((-2 * Math.PI * 1000) / fs);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < x.length; i++) {
    p1 = (1 - a) * x[i]! + a * p1;
    p2 = (1 - a) * p1 + a * p2;
    y[i] = p2;
  }
  const minLag = Math.floor(fs / maxHz);
  const maxLag = Math.min(Math.floor(fs / minHz), Math.floor(y.length / 2));
  const n = y.length - maxLag;
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += y[i]! * y[i]!;
  const r = new Float64Array(maxLag + 1);
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) {
      s += y[i]! * y[i + lag]!;
      e1 += y[i + lag]! * y[i + lag]!;
    }
    r[lag] = s / Math.sqrt(e0 * e1 + 1e-30);
    if (r[lag]! > best) best = r[lag]!;
  }
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag]! >= 0.9 * best && r[lag]! >= r[lag - 1]! && r[lag]! >= r[lag + 1]!) {
      // parabolic interpolation
      const d = (r[lag - 1]! - r[lag + 1]!) / (2 * (r[lag - 1]! - 2 * r[lag]! + r[lag + 1]!) || 1);
      return fs / (lag + d);
    }
  }
  return Number.NaN;
}

/**
 * Energy (Goertzel) at engine orders k/2 (k = 1 … 2·z) at a steady rpm. Returns the share of energy in
 * "half orders" (orders that are not multiples of the firing order z/2) — high for crossplane V8 / boxer
 * rumble, low for even engines.
 */
export function halfOrderShare(x: Float32Array, fs: number, rpm: number, cylinders: number): number {
  const fCycle = rpm / 120;
  let fire = 0;
  let other = 0;
  for (let k = 1; k <= 2 * cylinders; k++) {
    const p = powerAt(x, fs, k * fCycle);
    if (k % cylinders === 0) fire += p;
    else other += p;
  }
  return other / (fire + other + 1e-30);
}

export function writeWav(path: string, r: Render) {
  const n = r.l.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 4, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, r.fs, true);
  v.setUint32(28, r.fs * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, r.l[i]!)) * 32767), true);
    v.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, r.r[i]!)) * 32767), true);
  }
  return Bun.write(path, buf);
}

/**
 * "Rumble" share: energy in the sub-firing orders 0.5, 1 and 1.5 (k = 1 … 3 below the firing order z/2)
 * relative to all orders 0.5 … z. ≈ 0 for even engines and the flatplane V8 (each bank fires every 180°);
 * high for the crossplane V8 (per bank 180-270-180-90) and unequal-length boxer headers. petrol.md §6.3
 */
export function rumbleShare(x: Float32Array, fs: number, rpm: number, cylinders: number): number {
  const fCycle = rpm / 120;
  const top = Math.min(cylinders, 4);
  let sub = 0;
  let all = 0;
  for (let k = 1; k <= 2 * cylinders; k++) {
    const p = powerAt(x, fs, k * fCycle);
    all += p;
    if (k < top) sub += p;
  }
  return sub / (all + 1e-30);
}

/** Engine order (k/2, k = 1 … 2z) with the most energy. */
export function dominantOrder(x: Float32Array, fs: number, rpm: number, cylinders: number): number {
  const fCycle = rpm / 120;
  let best = 0;
  let bk = 0;
  for (let k = 1; k <= 2 * cylinders; k++) {
    const p = powerAt(x, fs, k * fCycle);
    if (p > best) {
      best = p;
      bk = k;
    }
  }
  return bk / 2;
}
