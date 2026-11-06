// Cruise control ("Tempomat") and driver speed limiter (issue #30).
import { describe, expect, test } from "bun:test";
import { CruiseControl, averageL100 } from "../../src/core/index.ts";
import type { GearboxType } from "../../src/core/index.ts";
import { cruiseRig } from "./cruise-rig.ts";

const TDI = "car-vw-golf6-tdi"; // diesel, manual
const GTI = "car-vw-golf7-gti"; // petrol, DSG

/** Counts gear changes in a gear log. */
const changes = (g: number[]) => g.reduce((n, x, i) => n + (i > 0 && x !== g[i - 1] ? 1 : 0), 0);

describe("cruise control (issue #30): holds the set speed", () => {
  const cases: [string, string, GearboxType | undefined][] = [
    ["diesel manual", TDI, undefined], ["diesel DSG", TDI, "dsg"],
    ["petrol DSG", GTI, undefined], ["petrol manual", GTI, "manual"],
  ];
  for (const [name, id, gb] of cases) {
    test(`${name}: 100 km/h ± 1 on the level, no oscillation, no gear hunting`, () => {
      const r = cruiseRig(id, gb);
      r.accelerateTo(100);
      expect(r.dt.cruise.set()).toBe(true);
      expect(r.dt.state.cruise!.setKmh).toBe(100);
      // whole run after the set: never off by more than 1.5 km/h (transient), then ± 1
      let min = Infinity, max = -Infinity;
      const gears: number[] = [];
      const out: number[] = [];
      r.run(60, 0, 0, (i) => {
        const v = r.dt.state.speedKmh;
        min = Math.min(min, v);
        max = Math.max(max, v);
        if (i > 20 * 60) {
          expect(Math.abs(v - 100)).toBeLessThanOrEqual(1);
          gears.push(r.dt.state.gear);
          out.push(r.dt.state.cruise!.output);
        }
      });
      expect(max - min).toBeLessThan(3);
      expect(changes(gears)).toBe(0);
      // no oscillation: the controller output is steady at the end (± 0.02 pedal)
      expect(Math.max(...out.slice(-1200)) - Math.min(...out.slice(-1200))).toBeLessThan(0.02);
      expect(r.dt.state.cruise!.mode).toBe("active");
    });
  }

  test("set needs ≥ 30 km/h; brake switches off, resume picks the last set speed up again", () => {
    const r = cruiseRig(TDI);
    r.accelerateTo(25);
    expect(r.dt.cruise.set()).toBe(false);
    r.accelerateTo(80);
    expect(r.dt.cruise.set()).toBe(true);
    r.run(10);
    r.run(0.5, 0, 0.3);
    expect(r.dt.state.cruise!.mode).toBe("off");
    expect(r.dt.state.cruise!.setKmh).toBe(80);
    expect(r.dt.state.speedKmh).toBeLessThan(79);
    // coasting stays below, resume brings it back to 80
    r.run(3);
    expect(r.dt.state.speedKmh).toBeLessThan(78);
    expect(r.dt.cruise.resume()).toBe(true);
    r.run(25);
    expect(Math.abs(r.dt.state.speedKmh - 80)).toBeLessThan(1);
  });

  test("± 1 km/h short, ± 10 to the next multiple of 10 (long press); C while active switches off", () => {
    const r = cruiseRig(GTI);
    r.accelerateTo(87);
    r.dt.cruise.set();
    const set0 = r.dt.state.cruise!.setKmh!;
    r.dt.cruise.adjust(1);
    expect(r.dt.state.cruise!.setKmh).toBe(set0 + 1);
    r.dt.cruise.adjust(1, true);
    expect(r.dt.state.cruise!.setKmh).toBe(Math.floor((set0 + 1) / 10) * 10 + 10);
    r.dt.cruise.adjust(-1, true);
    expect(r.dt.state.cruise!.setKmh).toBe(80);
    r.run(30);
    expect(Math.abs(r.dt.state.speedKmh - 80)).toBeLessThan(1);
    r.dt.cruise.setOrOff();
    expect(r.dt.state.cruise!.mode).toBe("off");
  });

  test("driver pedal overrides (overtaking), afterwards back to the set speed without braking", () => {
    const r = cruiseRig(TDI);
    r.accelerateTo(100);
    r.dt.cruise.set();
    r.run(20);
    r.run(6, 0.9);
    expect(r.dt.state.cruise!.mode).toBe("override");
    expect(r.dt.state.speedKmh).toBeGreaterThan(110);
    let min = Infinity;
    r.run(60, 0, 0, () => (min = Math.min(min, r.dt.state.speedKmh)));
    expect(r.dt.state.cruise!.mode).toBe("active");
    expect(Math.abs(r.dt.state.speedKmh - 100)).toBeLessThan(1);
    // returns without a dip below the set speed (integrator frozen during the override)
    expect(min).toBeGreaterThan(98.5);
  });

  test("manual: neutral switches off, a shift (clutch) only pauses", () => {
    const r = cruiseRig(TDI);
    r.accelerateTo(90);
    r.dt.cruise.set();
    r.run(5);
    r.dt.shift(-1);
    r.run(3);
    expect(r.dt.state.cruise!.mode).toBe("active");
    for (let k = 0; k < 8 && r.dt.state.gear > 0; k++) {
      r.dt.shift(-1);
      r.run(0.5);
    }
    expect(r.dt.state.gear).toBe(0);
    expect(r.dt.state.cruise!.mode).toBe("off");
  });
});

describe("cruise control on gradients (issue #30)", () => {
  test("6 %: 130 km/h are held (TDI, GTI)", () => {
    for (const id of [TDI, GTI]) {
      const r = cruiseRig(id);
      r.accelerateTo(130);
      r.dt.cruise.set();
      r.run(10);
      r.dt.setEnvironment({ gradePct: 6 });
      const { min, max } = r.run(40);
      expect(min).toBeGreaterThan(129);
      expect(max).toBeLessThan(131);
      expect(r.dt.state.cruise!.notHoldable).toBe(false);
    }
  });

  test("6 % at 180 km/h, TDI manual: full pedal, 'Tempo nicht haltbar' and 'Runterschalten'", () => {
    const r = cruiseRig(TDI);
    r.accelerateTo(180, 0.9, 3500);
    r.dt.cruise.set();
    r.run(5);
    r.dt.setEnvironment({ gradePct: 6 });
    r.run(40);
    const c = r.dt.state.cruise!;
    expect(c.output).toBeCloseTo(1, 2);
    expect(r.dt.state.speedKmh).toBeLessThan(178);
    expect(c.notHoldable).toBe(true);
    expect(c.downshift).toBe(true);
    expect(c.mode).toBe("active");
  });

  test("6 % at 180 km/h, TDI DSG: the cruise control shifts down once and does not hunt", () => {
    const r = cruiseRig(TDI, "dsg");
    r.accelerateTo(180, 0.9);
    r.dt.cruise.set();
    r.run(5);
    const g0 = r.dt.state.gear;
    r.dt.setEnvironment({ gradePct: 6 });
    const gears: number[] = [];
    r.run(40, 0, 0, () => gears.push(r.dt.state.gear));
    expect(r.dt.state.gear).toBe(g0 - 1);
    expect(changes(gears)).toBe(1);
  });

  test("−10 % downhill at 80 km/h: no active braking, overspeed note", () => {
    const r = cruiseRig(TDI);
    r.accelerateTo(80);
    r.dt.cruise.set();
    r.run(10);
    r.dt.setEnvironment({ gradePct: -10 });
    r.run(20);
    const c = r.dt.state.cruise!;
    expect(c.output).toBe(0);
    expect(r.dt.state.speedKmh).toBeGreaterThan(83);
    expect(c.overspeed).toBe(true);
    expect(c.mode).toBe("active");
  });
});

describe("speed limiter (issue #30)", () => {
  test("limiter 50: full pedal is held at 50 ± 1.5, the driver gets his pedal below it", () => {
    const r = cruiseRig(GTI);
    r.dt.cruise.setLimit(50);
    r.dt.cruise.toggleLimiter();
    expect(r.dt.state.cruise!.limiterOn).toBe(true);
    let max = 0;
    const { min } = r.run(30, 0.9, 0, () => (max = Math.max(max, r.dt.state.speedKmh)));
    expect(max).toBeLessThan(51.5);
    expect(min).toBeGreaterThan(48.5);
    expect(r.dt.state.cruise!.limiting).toBe(true);
    // part pedal well below the limit is passed through unchanged
    r.run(10, 0.05);
    expect(r.dt.state.speedKmh).toBeLessThan(45);
    expect(r.dt.effectivePedal(0.05)).toBeCloseTo(0.05, 5);
  });

  test("limiter 130, TDI manual: holds without oscillating", () => {
    const r = cruiseRig(TDI);
    r.dt.cruise.setLimit(130);
    r.dt.cruise.toggleLimiter();
    let max = 0;
    const { min } = r.run(60, 0.8, 0, (i) => {
      r.autoShift(3000, 6);
      if (i > 40 * 60) max = Math.max(max, r.dt.state.speedKmh);
    });
    expect(max).toBeLessThan(131.5);
    expect(min).toBeGreaterThan(128.5);
  });

  test("kickdown (100 % for > 0.5 s) overrides, the limiter is back once below the limit", () => {
    const r = cruiseRig(GTI);
    r.dt.cruise.setLimit(80);
    r.dt.cruise.toggleLimiter();
    r.run(25, 0.8);
    expect(r.dt.state.speedKmh).toBeLessThan(81.5);
    r.run(0.3, 1);
    expect(r.dt.state.cruise!.kickdown).toBe(false);
    r.run(6, 1);
    expect(r.dt.state.cruise!.kickdown).toBe(true);
    expect(r.dt.state.speedKmh).toBeGreaterThan(95);
    // lift, coast back below the limit (brake), then the limiter holds again
    for (let i = 0; i < 600 && r.dt.state.speedKmh > 75; i++) r.step(0, 0.5);
    expect(r.dt.state.speedKmh).toBeLessThan(80);
    r.run(20, 0.8);
    expect(r.dt.state.cruise!.kickdown).toBe(false);
    expect(r.dt.state.speedKmh).toBeLessThan(81.5);
  });

  test("limiter and cruise control exclude each other; ± changes the limit when the limiter is on", () => {
    const c = new CruiseControl();
    c.update(1 / 60, { speedKmh: 90, driverPedal: 0.3, brake: 0, running: true, gear: 5, clutchOpen: false, manual: false, rpm: 2000, idleRpm: 800, governorKmh: 250 });
    c.set();
    expect(c.state.mode).toBe("active");
    c.toggleLimiter();
    expect(c.state.mode).toBe("off");
    c.setLimit(100);
    c.adjust(1, true);
    expect(c.state.limitKmh).toBe(110);
    c.adjust(-1);
    expect(c.state.limitKmh).toBe(109);
    c.resume();
    expect(c.state.limiterOn).toBe(false);
    expect(c.state.setKmh).toBe(90);
  });
});

describe("constant-speed consumption via the board computer (issues #30, #21)", () => {
  // Reference: Golf 6 2.0 TDI 103 kW: NEDC extra-urban 4.2 l/100 km, owners' constant-speed values ≈ 4.5–5 at
  // 100 km/h and 5.5–6.5 at 130 km/h; Golf 7 GTI: NEDC extra-urban 5.0, constant 100 km/h ≈ 6–7, 130 km/h ≈ 7.5–8.5
  // [VW technical data, spritmonitor.de constant-speed reports] – ranges widened by ± 0.5 for the mean-value model.
  const cases: [string, number, number, number][] = [
    [TDI, 100, 4.5, 6.5], [TDI, 130, 5.3, 7.5], [GTI, 100, 6, 8.5], [GTI, 130, 7, 9.5],
  ];
  for (const [id, kmh, lo, hi] of cases) {
    test(`${id} at a constant ${kmh} km/h: Trip A between ${lo} and ${hi} l/100 km`, () => {
      const r = cruiseRig(id);
      r.accelerateTo(kmh);
      r.dt.cruise.set();
      r.run(20);
      r.trip.resetTripA();
      r.run(60);
      const t = r.trip.data.tripA;
      expect(t.km).toBeGreaterThan((kmh / 60) * 0.98);
      const l100 = averageL100(t)!;
      console.log(`  ${id} ${kmh} km/h: ${l100.toFixed(2)} l/100 km, gear ${r.dt.state.gear}, ${Math.round(r.sim.state.rpm)} rpm`);
      expect(l100).toBeGreaterThan(lo);
      expect(l100).toBeLessThan(hi);
    });
  }
});
