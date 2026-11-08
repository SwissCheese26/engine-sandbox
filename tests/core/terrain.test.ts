// Issue #48: routes with an elevation profile.
import { expect, test } from "bun:test";
import { RAMP_PCT, roadAt, terrainAt, terrainLengthM, terrainSamples } from "../../src/core/index.ts";
import { DEFAULT_ENVIRONMENT } from "../../src/core/environment.ts";
import { cruiseRig } from "./cruise-rig.ts";

const stats = (t: "flat" | "hills" | "alps") => {
  const L = terrainLengthM(t);
  let maxG = 0, lo = Infinity, hi = -Infinity;
  for (let x = 0; x <= L; x += 5) {
    const r = terrainAt(t, x);
    maxG = Math.max(maxG, Math.abs(r.gradePct));
    lo = Math.min(lo, r.altitudeM);
    hi = Math.max(hi, r.altitudeM);
  }
  return { maxG, lo, hi };
};

test("profiles have realistic gradients and altitudes", () => {
  const f = stats("flat");
  expect(f.maxG).toBeLessThan(3.5);
  expect(f.hi - f.lo).toBeLessThan(40);
  const h = stats("hills");
  expect(h.maxG).toBeGreaterThan(5);
  expect(h.maxG).toBeLessThan(13);
  const a = stats("alps");
  expect(a.maxG).toBeGreaterThan(8);
  expect(a.maxG).toBeLessThan(16);
  expect(a.hi).toBeGreaterThan(1700); // pass height
  expect(a.hi - a.lo).toBeGreaterThan(700);
});

test("the gradient is the slope of the altitude (no jumps), and the route repeats seamlessly", () => {
  for (const t of ["flat", "hills", "alps"] as const) {
    const L = terrainLengthM(t);
    for (const x of [0, 1234, 7777, L - 10]) {
      const dx = 0.5;
      const num = ((terrainAt(t, x + dx).altitudeM - terrainAt(t, x - dx).altitudeM) / (2 * dx)) * 100;
      expect(Math.abs(num - terrainAt(t, x).gradePct)).toBeLessThan(0.01);
    }
    expect(terrainAt(t, L).altitudeM).toBeCloseTo(terrainAt(t, 0).altitudeM, 6);
    expect(terrainAt(t, L + 500).gradePct).toBeCloseTo(terrainAt(t, 500).gradePct, 6);
  }
});

test("Berg hoch / runter: constant ramp, altitude rises or falls with distance", () => {
  expect(terrainAt("uphill", 1000).gradePct).toBe(RAMP_PCT);
  expect(terrainAt("uphill", 1000).altitudeM - terrainAt("uphill", 0).altitudeM).toBeCloseTo(80, 6);
  expect(terrainAt("downhill", 1000).gradePct).toBe(-RAMP_PCT);
  expect(terrainAt("downhill", 1000).altitudeM).toBeLessThan(terrainAt("downhill", 0).altitudeM);
  expect(terrainSamples("alps", 60).altitudeM).toHaveLength(61);
});

test("static terrain keeps the fixed gradient and altitude", () => {
  expect(roadAt({ ...DEFAULT_ENVIRONMENT, gradePct: -5, altitudeM: 800 }, 5000)).toEqual({ gradePct: -5, altitudeM: 800 });
});

test("driving a route: position follows the distance, the gradient changes and costs speed uphill", () => {
  const flat = cruiseRig("car-vw-golf6-tdi");
  const up = cruiseRig("car-vw-golf6-tdi");
  up.dt.setEnvironment({ terrain: "uphill" });
  flat.run(20, 0.8, 0, () => flat.autoShift(3000, 4));
  up.run(20, 0.8, 0, () => up.autoShift(3000, 4));
  const s = up.dt.state;
  expect(s.positionM!).toBeGreaterThan(100);
  expect(s.roadGradePct).toBe(RAMP_PCT);
  expect(s.roadAltitudeM!).toBeGreaterThan(300);
  expect(up.dt.state.speedKmh).toBeLessThan(flat.dt.state.speedKmh - 5);
  // the gradient follows the hills profile along the way
  const h = cruiseRig("car-vw-golf6-tdi");
  h.dt.setEnvironment({ terrain: "hills" });
  const g0 = h.dt.state.roadGradePct!;
  h.run(30, 0.7, 0, () => h.autoShift(3000, 5));
  expect(h.dt.state.roadGradePct).not.toBeCloseTo(g0, 3);
  // switching the route starts it over
  h.dt.setEnvironment({ terrain: "alps" });
  expect(h.dt.state.positionM).toBe(0);
});
