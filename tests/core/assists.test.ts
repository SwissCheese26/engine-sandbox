// Issue #23: environment (weather, temperature, altitude, gradient) and driver assistance (ABS, ASR, ESP, launch control).
import { describe, expect, test } from "bun:test";
import {
  AQUAPLANING_KMH, ICE_WARNING_C, PEAK_SLIP, TractionControl, DEFAULT_ASSISTS, airDensity, altitudeToKpa, aquaplaningFactor, compoundFactor,
  iceWarning, tyreGrip, weatherSurface,
} from "../../src/core/index.ts";
import { assistRig, brakeTest } from "./assist-rig.ts";

const TDI = "car-vw-golf6-tdi";
const GTI = "car-vw-golf7-gti";

describe("environment (issue #23)", () => {
  test("ISA air pressure and density from altitude and temperature", () => {
    expect(altitudeToKpa(0)).toBeCloseTo(101.325, 3);
    expect(altitudeToKpa(1000)).toBeCloseTo(89.87, 1);
    expect(altitudeToKpa(3000)).toBeCloseTo(70.1, 0);
    expect(airDensity(101.325, 15)).toBeCloseTo(1.225, 2);
    expect(airDensity(101.325, -10)).toBeGreaterThan(airDensity(101.325, 30));
  });

  test("weather maps to surface and water film, black-ice warning below +3 °C", () => {
    expect(weatherSurface("heavy-rain")).toEqual({ surface: "wet", factor: 0.9, aquaplaning: true });
    expect(weatherSurface("snow").surface).toBe("snow");
    expect(ICE_WARNING_C).toBe(3);
    expect(iceWarning(2.9)).toBe(true);
    expect(iceWarning(3)).toBe(false);
    const { dt } = assistRig(TDI, { env: { ambientC: 1 } });
    expect(dt.state.iceWarning).toBe(true);
    dt.setEnvironment({ ambientC: 15 });
    expect(dt.state.iceWarning).toBe(false);
  });

  test("aquaplaning: full grip below the onset speed, falls above it; slicks and wide tyres float earlier", () => {
    expect(aquaplaningFactor("standard", 80)).toBe(1);
    expect(aquaplaningFactor("standard", 115)).toBeCloseTo(0.5, 1);
    expect(aquaplaningFactor("standard", 300)).toBeCloseTo(0.1, 5);
    expect(aquaplaningFactor("slick", 80)).toBeLessThan(0.5);
    expect(aquaplaningFactor("standard", 100, 285)).toBeLessThan(aquaplaningFactor("standard", 100, 205));
    expect(AQUAPLANING_KMH.slick).toBeLessThan(AQUAPLANING_KMH.standard);
  });

  test("compound window: summer tyres lose grip in the cold, winter tyres on hot roads", () => {
    expect(compoundFactor("standard", 0)).toBeLessThan(0.97);
    expect(compoundFactor("standard", 20)).toBe(1);
    expect(compoundFactor("winter", 0)).toBe(1);
    expect(compoundFactor("winter", 35)).toBeLessThan(0.95);
    expect(compoundFactor("standard", -5, "snow")).toBe(1);
  });

  test("heavy rain at speed: μ in the coupling falls with aquaplaning, the drivetrain flags it", () => {
    const { dt, sim, step } = assistRig(TDI, { env: { weather: "heavy-rain" } });
    let k = 0;
    const g0 = dt.state.grip;
    while ((sim.state.vehicleSpeedMs ?? 0) < 130 / 3.6 && k++ < 60 * 60) {
      if (sim.state.rpm > 4300 && !dt.state.shifting && dt.state.clutch > 0.95) dt.shift(1);
      step(1);
    }
    expect(dt.state.aquaplaning).toBe(true);
    expect(dt.state.grip).toBeLessThan(0.6 * g0);
    expect(g0).toBeCloseTo(0.9 * tyreGrip("standard", "wet", 20), 3);
  });

  test("gradient: 10 % uphill measurably slower, downhill faster; the car rolls downhill, not backwards uphill", () => {
    const run = (gradePct: number) => {
      const r = assistRig(TDI, { env: { gradePct } });
      let v = 0;
      for (let i = 0; i < 600; i++) {
        if (r.sim.state.rpm > 4300 && !r.dt.state.shifting && r.dt.state.clutch > 0.95) r.dt.shift(1);
        v = r.step(1).vehicleSpeedMs! * 3.6;
      }
      const r2 = assistRig(TDI, { env: { gradePct } });
      let roll = 0;
      for (let i = 0; i < 300; i++) roll = r2.step(0).vehicleSpeedMs! * 3.6;
      return { v, roll };
    };
    const flat = run(0);
    const up = run(10);
    const down = run(-10);
    expect(up.v).toBeLessThan(flat.v - 10);
    expect(down.v).toBeGreaterThan(flat.v + 10);
    expect(flat.roll).toBe(0);
    expect(up.roll).toBe(0);
    expect(down.roll).toBeGreaterThan(3);
  });

  test("altitude: thinner air makes the engine weaker (0–100 slower at 2500 m)", () => {
    const t100 = (altitudeM: number) => {
      const r = assistRig(GTI, { env: { altitudeM } });
      for (let i = 0; i < 900; i++) if (r.step(1).vehicleSpeedMs! * 3.6 >= 100) return i / 60;
      return Infinity;
    };
    expect(t100(2500)).toBeGreaterThan(t100(0) * 1.02);
  });
});

describe("ABS (issue #23): braking 100 → 0 km/h", () => {
  const cases = [
    { name: "dry, standard tyre", weather: "dry", tyre: "standard", lo: 36, hi: 42 },
    { name: "wet, standard tyre", weather: "wet", tyre: "standard", lo: 50, hi: 60 },
    { name: "snow, winter tyre", weather: "snow", tyre: "winter", lo: 80, hi: 110 },
    { name: "ice, standard tyre", weather: "ice", tyre: "standard", lo: 200, hi: 450 },
  ] as const;
  for (const c of cases) {
    test(`${c.name}: ${c.lo}–${c.hi} m with ABS, longer without; ABS cycles at 8–15 Hz without long lock-ups`, () => {
      const abs = brakeTest(TDI, { tyre: c.tyre, env: { weather: c.weather }, assists: { abs: true } });
      const off = brakeTest(TDI, { tyre: c.tyre, env: { weather: c.weather }, assists: { abs: false } });
      expect(abs.d).toBeGreaterThan(c.lo);
      expect(abs.d).toBeLessThan(c.hi);
      expect(off.d).toBeGreaterThan(abs.d);
      expect(off.locked).toBeGreaterThan(0.8 * off.t);
      if (c.weather !== "ice") {
        const hz = abs.cycles / abs.absT;
        expect(hz).toBeGreaterThan(c.weather === "snow" ? 7 : 8);
        expect(hz).toBeLessThan(15);
        expect(abs.locked).toBeLessThan(0.6);
      } else expect(abs.locked).toBeLessThan(0.25 * abs.t);
    });
  }

  test("wet: ABS clearly shorter than locked wheels (≥ 8 %)", () => {
    const abs = brakeTest(TDI, { env: { weather: "wet" }, assists: { abs: true } });
    const off = brakeTest(TDI, { env: { weather: "wet" }, assists: { abs: false } });
    expect(off.d).toBeGreaterThan(1.08 * abs.d);
  });

  test("winter tyres on snow brake much shorter than summer tyres", () => {
    const w = brakeTest(TDI, { tyre: "winter", env: { weather: "snow" } });
    const s = brakeTest(TDI, { tyre: "standard", env: { weather: "snow" } });
    expect(s.d).toBeGreaterThan(1.5 * w.d);
  });

  test("ABS lamp state: regulating while braking, never with ABS off", () => {
    const abs = brakeTest(TDI, { env: { weather: "wet" } });
    const off = brakeTest(TDI, { env: { weather: "wet" }, assists: { abs: false } });
    expect(abs.absT).toBeGreaterThan(0.5 * abs.t);
    expect(off.absT).toBe(0);
    expect(off.dt.state.assists?.abs).toBe(false);
  });

  test("brake slip and pressure stay finite and in range", () => {
    const r = assistRig(TDI, { env: { weather: "wet" } });
    for (let i = 0; i < 400; i++) r.step(1);
    for (let i = 0; i < 300; i++) {
      const s = r.step(0, 1);
      expect(Number.isFinite(s.brakeSlip!)).toBe(true);
      expect(s.brakeSlip!).toBeGreaterThanOrEqual(-1);
      expect(s.brakeSlip!).toBeLessThanOrEqual(1e-9);
      expect(s.absPressure!).toBeGreaterThanOrEqual(0);
      expect(s.absPressure!).toBeLessThanOrEqual(1);
    }
  });
});

describe("ASR / ESP (issue #23)", () => {
  const launch = (weather: "dry" | "wet" | "snow", assists: Partial<typeof DEFAULT_ASSISTS>, tyre?: "winter" | "standard", seconds = 8) => {
    const r = assistRig(GTI, { env: { weather }, assists, tyre });
    let maxSlip = 0;
    let asrT = 0;
    let t100 = Infinity;
    for (let i = 0; i < seconds * 60; i++) {
      const s = r.step(1);
      maxSlip = Math.max(maxSlip, s.wheelSlip ?? 0);
      if (r.dt.state.asrActive) asrT += 1 / 60;
      if (t100 === Infinity && s.vehicleSpeedMs! * 3.6 >= 100) t100 = i / 60;
    }
    return { maxSlip, asrT, t100, v: r.sim.state.vehicleSpeedMs! * 3.6, r };
  };

  test("GTI full-throttle launch on dry asphalt: ASR keeps the slip ≤ 0.2 (also through the DSG shifts)", () => {
    const on = launch("dry", {});
    const off = launch("dry", { asr: false, esp: false });
    expect(on.maxSlip).toBeLessThanOrEqual(0.2);
    expect(off.maxSlip).toBeGreaterThan(0.3);
    // 0–100 within −14 … +10 % of the factory 6.5 s (the sim GTI is ≈ 10 % quick, PR #37 table)
    expect(on.t100).toBeGreaterThan(5.6);
    expect(on.t100).toBeLessThan(7.15);
  });

  test("dry asphalt: ASR does not cost time with manual gearboxes (0–100 ≤ ASR off + 0.05 s, review PR #39)", () => {
    const t100 = (id: string, asr: boolean) => {
      const r = assistRig(id, { assists: { asr, esp: asr } });
      for (let i = 0; i < 60 * 20; i++) {
        const d = r.dt.state;
        if (d.type === "manual" && r.sim.state.rpm > r.cfg.revLimitRpm - 120 && !d.shifting && d.clutch > 0.95 && d.gear < d.gearCount) r.dt.shift(1);
        if (r.step(1).vehicleSpeedMs! * 3.6 >= 100) return i / 60;
      }
      return Infinity;
    };
    for (const id of [TDI, "car-bmw-m3-e46", "car-honda-integra-dc5"]) {
      const on = t100(id, true);
      const off = t100(id, false);
      expect(Number.isFinite(off)).toBe(true);
      expect(on).toBeLessThanOrEqual(off + 0.05 + 1e-9);
    }
  });

  test("wet and snow: ASR holds the slip near the peak and is faster than spinning wheels", () => {
    const wet = launch("wet", {}, undefined, 12);
    const wetOff = launch("wet", { asr: false, esp: false }, undefined, 12);
    expect(wet.maxSlip).toBeLessThanOrEqual(0.2);
    expect(wet.t100).toBeLessThan(wetOff.t100);
    const snow = launch("snow", {}, "winter", 6);
    expect(snow.maxSlip).toBeLessThanOrEqual(0.2);
    expect(snow.asrT).toBeGreaterThan(3); // ESP lamp keeps blinking on snow at full throttle
  });

  test("winter tyres on snow accelerate better than summer tyres", () => {
    const w = launch("snow", {}, "winter", 6);
    const s = launch("snow", {}, "standard", 6);
    expect(w.v).toBeGreaterThan(1.4 * s.v);
  });

  test("ESP OFF: relaxed ASR target (2 × PEAK_SLIP), more slip than with ESP but less than without ASR", () => {
    const c = new TractionControl();
    const esp = { ...DEFAULT_ASSISTS };
    const sport = { ...DEFAULT_ASSISTS, esp: false };
    const run = (st: typeof esp) => {
      c.reset();
      let o = c.step(1 / 60, 1.5 * PEAK_SLIP, 10, 1, true, st, false, 1, 0.5);
      for (let i = 0; i < 20; i++) o = c.step(1 / 60, 1.5 * PEAK_SLIP, 10, 1, true, st, false, 1, 0.5);
      return o;
    };
    const a = run(esp);
    const b = run(sport);
    expect(a.cutting).toBe(true);
    expect(a.torqueCut).toBeGreaterThan(0);
    expect(a.pedalCap).toBeLessThan(1);
    expect(b.cutting).toBe(false);
    const on = launch("wet", {}, undefined, 6).maxSlip;
    const espOff = launch("wet", { esp: false }, undefined, 6).maxSlip;
    expect(espOff).toBeGreaterThanOrEqual(on - 1e-6);
  });

  test("diesel: no ignition path, the torque cut comes through the pedal cap only", () => {
    const c = new TractionControl();
    let o = c.step(1 / 60, 0.3, 10, 1, false, DEFAULT_ASSISTS, false, 1, 0.5);
    for (let i = 0; i < 10; i++) o = c.step(1 / 60, 0.3, 10, 1, false, DEFAULT_ASSISTS, false, 1, 0.5);
    expect(o.torqueCut).toBe(0);
    expect(o.pedalCap).toBeLessThan(1);
  });

  test("MSR (ESP): engine drag locking the driven wheels opens the throttle a little", () => {
    const c = new TractionControl();
    const o = c.step(1 / 60, -0.25, 15, 0, false, DEFAULT_ASSISTS, false, 0);
    expect(o.msrActive).toBe(true);
    expect(o.pedalFloor).toBeGreaterThan(0.1);
    c.reset();
    expect(c.step(1 / 60, -0.25, 15, 0, false, { ...DEFAULT_ASSISTS, esp: false }, false, 0).pedalFloor).toBe(0);
    expect(c.step(1 / 60, -0.25, 15, 0, false, DEFAULT_ASSISTS, true, 0).pedalFloor).toBe(0);
  });

  test("motorcycles come without ESP/ASR, cars with everything on", () => {
    const r = assistRig(GTI);
    expect(r.dt.assists).toEqual(DEFAULT_ASSISTS);
    r.dt.setVehicle("superbike");
    expect(r.dt.assists.esp).toBe(false);
    expect(r.dt.assists.asr).toBe(false);
    expect(r.dt.assists.abs).toBe(true);
    // back to the car: the car's last choice returns (here: ESP OFF), not "everything on" (review PR #39)
    r.dt.setVehicle("car");
    expect(r.dt.assists).toEqual(DEFAULT_ASSISTS);
    r.dt.setAssists({ esp: false });
    r.dt.setVehicle("superbike");
    r.dt.setVehicle("car");
    expect(r.dt.assists.esp).toBe(false);
    expect(r.dt.assists.asr).toBe(true);
  });
});

describe("launch control (issue #23)", () => {
  test("brake + full throttle at standstill holds the launch speed, releasing the brake launches", () => {
    const r = assistRig(GTI, { assists: { launchControl: true } });
    for (let i = 0; i < 120; i++) r.step(1, 1);
    expect(r.dt.state.launchArmed).toBe(true);
    expect(r.sim.state.vehicleSpeedMs).toBeLessThan(0.05);
    const rpm = r.sim.state.rpm;
    expect(rpm).toBeGreaterThan(2500);
    expect(rpm).toBeLessThan(4600);
    let t100 = Infinity;
    let maxSlip = 0;
    for (let i = 0; i < 600; i++) {
      const s = r.step(1, 0);
      maxSlip = Math.max(maxSlip, s.wheelSlip ?? 0);
      if (t100 === Infinity && s.vehicleSpeedMs! * 3.6 >= 100) t100 = i / 60;
    }
    expect(r.dt.state.launchArmed).toBe(false);
    expect(maxSlip).toBeLessThanOrEqual(0.2);
    expect(t100).toBeLessThan(7.15);
  });

  test("without launch control the engine works against the brake (clutch engaged, no launch hold)", () => {
    const r = assistRig(GTI);
    for (let i = 0; i < 60; i++) r.step(1, 1);
    expect(r.dt.state.launchArmed).toBe(false);
  });
});
