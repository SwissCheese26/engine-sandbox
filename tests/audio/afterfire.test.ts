// Pops & bangs sound (issue #16): afterfire events when EngineState.afterfire > 0, none at 0, no clipping.
import { describe, expect, test } from "bun:test";
import { ENGINES, type Key, mono, peakDbfs, renderRun, rmsDbfs } from "./helpers.ts";

/** Lift-off from 5000 1/min and 3 s overrun down to 2500 1/min with the given afterfire intensity. */
const liftOff = (af: number): Key[] => [
  { t: 0, rpm: 5000, pedal: 1 },
  { t: 0.5, rpm: 5000, pedal: 1 },
  { t: 0.52, rpm: 4900, pedal: 0, afterfire: af },
  { t: 3.5, rpm: 2500, pedal: 0, afterfire: af },
];

/** Count of short loud transients: samples above 4× the overrun RMS, merged within 5 ms. */
function transients(x: Float32Array, fs: number): number {
  let sum = 0;
  for (const v of x) sum += v * v;
  const thr = 4 * Math.sqrt(sum / x.length);
  let n = 0;
  let last = -1e9;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]!) > thr && i - last > 0.005 * fs) n++;
    if (Math.abs(x[i]!) > thr) last = i;
  }
  return n;
}

describe("pops & bangs (afterfire)", () => {
  const cfg = ENGINES["r6-petrol-3.0"]!;
  const runs = Object.fromEntries([0, 0.35, 0.65, 1].map((af) => [af, renderRun(cfg, liftOff(af), 48000, 7)]));
  test("no afterfire events at afterfire = 0", () => {
    expect(runs[0]!.afterfireEvents).toBe(0);
  });
  test("afterfire > 0 produces events, density grows with the level (mild < popcorn < brutal)", () => {
    const n = [0.35, 0.65, 1].map((a) => runs[a]!.afterfireEvents!);
    expect(n[0]!).toBeGreaterThan(5);
    expect(n[1]!).toBeGreaterThan(n[0]!);
    expect(n[2]!).toBeGreaterThan(n[1]!);
  });
  test("pops are audible transients in the overrun and louder than the plain overrun", () => {
    const fs = 48000;
    const off = mono(runs[0]!, 0.6, 3.4);
    const brutal = mono(runs[1]!, 0.6, 3.4);
    expect(rmsDbfs(brutal)).toBeGreaterThan(rmsDbfs(off) + 3);
    expect(transients(brutal, fs)).toBeGreaterThan(10);
  });
  test("peak level stays below 0 dBFS for every level", () => {
    for (const r of Object.values(runs)) expect(peakDbfs(r)).toBeLessThan(0);
  });
  test("diesel voice ignores afterfire (no spark, no overrun injection)", () => {
    expect(renderRun(ENGINES["r4-diesel-2.0"]!, liftOff(1), 48000, 7).afterfireEvents).toBe(0);
  });
});
