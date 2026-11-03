// Tyre squeal and ABS rattle (issue #23): numeric checks of the sound events.
import { describe, expect, test } from "bun:test";
import { summarize } from "../../src/core/index.ts";
import { ControlTracker, deriveVoice, silentFrame, tyreSqueal } from "../../src/audio/model.ts";
import type { ControlFrame } from "../../src/audio/model.ts";
import { EngineDsp } from "../../src/audio/dsp.ts";
import { ENGINES, state } from "./helpers.ts";

const FS = 48000;
const BLOCK = 128;

/** Renders `seconds` with frames from `frameAt(t)` at 60 Hz; returns the DSP and the mono output. */
function render(frameAt: (t: number) => Partial<ControlFrame>, seconds: number) {
  const cfg = ENGINES["r4-diesel-2.0"]!;
  const dsp = new EngineDsp(FS, 3);
  dsp.setVoice(deriveVoice(cfg, summarize(cfg)));
  dsp.setVolume(0.8);
  const n = Math.ceil((seconds * FS) / BLOCK) * BLOCK;
  const out = new Float32Array(n);
  const r = new Float32Array(BLOCK);
  let next = 0;
  let sqMax = 0;
  for (let i = 0; i < n; i += BLOCK) {
    const t = i / FS;
    if (t >= next) {
      next += 1 / 60;
      dsp.setControl({ ...silentFrame(), ...frameAt(t) });
    }
    const l = out.subarray(i, i + BLOCK);
    dsp.process(l, r, BLOCK);
    sqMax = Math.max(sqMax, dsp.squealPeak);
  }
  return { dsp, out, sqMax };
}

function rms(x: Float32Array, from = 0, to = x.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

describe("tyre squeal (issue #23)", () => {
  test("level grows with slip and speed, needs grip, pitch rises with slip", () => {
    expect(tyreSqueal(0.08, 20, 1).level).toBe(0); // at the μ peak (ABS / ASR) no squeal
    const a = tyreSqueal(0.25, 20, 1);
    const b = tyreSqueal(0.6, 20, 1);
    expect(b.level).toBeGreaterThan(a.level);
    expect(tyreSqueal(0.6, 5, 1).level).toBeLessThan(b.level);
    expect(tyreSqueal(0.6, 20, 0.7).level).toBeLessThan(b.level); // wet: quieter
    expect(tyreSqueal(1, 20, 0.08).level).toBe(0); // ice: silent slide
    expect(b.hz).toBeGreaterThan(a.hz);
    expect(tyreSqueal(Number.NaN, Number.NaN, Number.NaN).level).toBe(0);
  });

  test("tracker: locked wheels on dry asphalt squeal, ABS braking near the peak hardly", () => {
    const cfg = ENGINES["r4-diesel-2.0"]!;
    const tr = new ControlTracker(deriveVoice(cfg, summarize(cfg)));
    const locked = tr.next(state({ t: 0.1, rpm: 800, vehicleSpeedMs: 25, brakeSlip: -1, roadGrip: 1 }), 0);
    const abs = tr.next(state({ t: 0.2, rpm: 800, vehicleSpeedMs: 25, brakeSlip: -0.1, roadGrip: 1, absCycles: 3 }), 0);
    const burnout = tr.next(state({ t: 0.3, rpm: 5000, vehicleSpeedMs: 0, wheelSpeedMs: 20, wheelSlip: 1, roadGrip: 1 }), 1);
    expect(locked.tyreSqueal!).toBeGreaterThan(0.9);
    expect(abs.tyreSqueal!).toBe(0);
    expect(abs.absCycles).toBe(3);
    expect(burnout.tyreSqueal!).toBeGreaterThan(0.9);
  });

  test("DSP: squeal is narrow-band noise, loud when sliding, silent otherwise, never clips", () => {
    const quiet = render(() => ({ tyreSqueal: 0 }), 0.5);
    const loud = render(() => ({ tyreSqueal: 1, squealHz: 1100 }), 0.5);
    expect(quiet.sqMax).toBe(0);
    expect(loud.sqMax).toBeGreaterThan(0.05);
    expect(rms(loud.out, FS * 0.2)).toBeGreaterThan(5 * rms(quiet.out, FS * 0.2) + 1e-4);
    let peak = 0;
    for (const v of loud.out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(0.98);
    // energy sits around the squeal pitch: zero-crossing rate between the fundamental (1.1 kHz) and the partial
    let zc = 0;
    for (let i = FS * 0.2 + 1; i < loud.out.length; i++) if ((loud.out[i - 1]! < 0) !== (loud.out[i]! < 0)) zc++;
    const hz = zc / 2 / (loud.out.length / FS - 0.2);
    expect(hz).toBeGreaterThan(700);
    expect(hz).toBeLessThan(2400); // the upper partial (2.03 ×) adds crossings
  });
});

describe("ABS rattle (issue #23)", () => {
  test("one rattle per ABS cycle, synchronous to a 12 Hz rhythm", () => {
    const hz = 12;
    const { dsp, out } = render((t) => ({ absCycles: Math.floor(t * hz) }), 2);
    // 2 s at 12 Hz → 23 increments after the first frame
    expect(dsp.absEvents).toBeGreaterThanOrEqual(22);
    expect(dsp.absEvents).toBeLessThanOrEqual(24);
    // envelope: the output pulses at the ABS rate (loud right after an event, quiet before the next one)
    const per = FS / hz;
    let early = 0;
    let late = 0;
    for (let k = 4; k < 20; k++) {
      const s0 = Math.round(k * per);
      early += rms(out, s0 + 100, s0 + 0.25 * per);
      late += rms(out, s0 + 0.7 * per, s0 + 0.98 * per);
    }
    expect(early).toBeGreaterThan(3 * late);
  });

  test("no rattle without ABS cycles; counter reset / NaN frames are ignored safely", () => {
    const none = render(() => ({ absCycles: 5 }), 0.5);
    expect(none.dsp.absEvents).toBe(0);
    const bad = render((t) => ({ absCycles: t < 0.25 ? Number.NaN : t < 0.4 ? 7 : 0, tyreSqueal: Number.NaN, squealHz: Number.POSITIVE_INFINITY }), 0.6);
    for (const v of bad.out) expect(Number.isFinite(v)).toBe(true);
    expect(bad.dsp.absEvents).toBeLessThanOrEqual(1);
  });
});
