import { describe, expect, test } from "bun:test";
import {
  conrodInertiaForceN,
  createLimitTracker,
  engineLimits,
  evaluateLimits,
  limitThresholds,
  safeMaxRpm,
  valveFloatRpm,
  type LimitTracker,
} from "../../src/core/limits.ts";
import type { EngineConfig, EngineState, WarningCode } from "../../src/core/types.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { REF, REF_LIST } from "./subsystems-fixtures.ts";

/** A healthy, warm engine at 3000 rpm / half load. */
function healthy(cfg: EngineConfig, patch: Partial<EngineState> = {}): EngineState {
  const rpm = patch.rpm ?? 3000;
  return {
    t: 0, running: true, destroyed: false, rpm, crankAngleDeg: 0, torqueNm: 150, powerKw: 47,
    imepBar: 10, bmepBar: 9, fmepBar: 1, load: 0.5, manifoldAbsKpa: 150,
    boostBar: cfg.induction.aspiration === "naturally-aspirated" ? 0 : cfg.induction.boostTargetBar * 0.5,
    turboRpm: 90000, airMassFlowKgS: 0.08, fuelMassFlowGS: 3, fuelFlowLh: 12, bsfcGkWh: 230, efficiency: 0.36,
    lambda: cfg.fuel === "diesel" ? 2 : 1, egtC: cfg.fuel === "diesel" ? 450 : 750, coolantC: 90, oilC: 100,
    oilPressureBar: 3, peakPressureBar: cfg.fuel === "diesel" ? 120 : 60,
    meanPistonSpeedMs: (2 * (cfg.block.strokeMm / 1000) * rpm) / 60, knock: 0, smoke: 0, wear: 0, warnings: [], damage: [],
    ...patch,
  };
}

/** Holds a state for `seconds`, returns the first fatal event, the time it happened and all warning codes seen. */
function hold(cfg: EngineConfig, patch: Partial<EngineState>, seconds: number, dt = 0.05, tr: LimitTracker = createLimitTracker()) {
  const codes = new Map<WarningCode, string>();
  let wear = 0;
  for (let t = 0; t <= seconds + 1e-9; t += dt) {
    const r = evaluateLimits(cfg, healthy(cfg, { ...patch, t }), tr);
    for (const w of r.warnings) codes.set(w.code, w.severity);
    wear += r.wearRatePerS * dt;
    if (r.fatal) return { fatal: r.fatal, at: t, codes, wear };
  }
  return { fatal: undefined, at: Infinity, codes, wear };
}

const diesel = () => defaultConfig("diesel");
const petrol = () => defaultConfig("petrol");

describe("limits: no false alarms", () => {
  test("default and reference engines at 3000 rpm / half load: no warnings, tiny wear", () => {
    for (const cfg of [diesel(), petrol(), ...REF_LIST]) {
      const rpm = Math.min(3000, 0.8 * cfg.revLimitRpm);
      const r = hold(cfg, { rpm, meanPistonSpeedMs: (2 * (cfg.block.strokeMm / 1000) * rpm) / 60 }, 5);
      expect([...r.codes.keys()]).toEqual([]);
      expect(r.fatal).toBeUndefined();
      expect(r.wear).toBeLessThan(1e-4);
    }
  });

  test("reference engines at their rev limiter: no critical mechanical warning", () => {
    for (const cfg of REF_LIST) {
      const rpm = cfg.revLimitRpm;
      const r = evaluateLimits(cfg, healthy(cfg, { rpm, meanPistonSpeedMs: (2 * (cfg.block.strokeMm / 1000) * rpm) / 60 }), createLimitTracker());
      const crit = r.warnings.filter((w) => w.severity === "critical").map((w) => `${cfg.name}: ${w.code}`);
      expect(crit).toEqual([]);
    }
  });

  test("stock peak pressure of the references stays below the warning (diesel ≈ 160 … 180 bar, EA888 ≈ 125 bar)", () => {
    const cases: [EngineConfig, number][] = [[REF.n57!, 175], [REF.om654!, 180], [REF.ea888!, 125]];
    for (const [cfg, p] of cases) {
      expect(evaluateLimits(cfg, healthy(cfg, { peakPressureBar: p }), createLimitTracker()).warnings.map((w) => w.code)).not.toContain("peak-pressure");
    }
  });

  test("engine not running (cranking/off): no oil pressure warning", () => {
    const r = evaluateLimits(diesel(), healthy(diesel(), { running: false, rpm: 200, oilPressureBar: 0 }), createLimitTracker());
    expect(r.warnings).toEqual([]);
  });
});

describe("limits: thresholds", () => {
  test("valve float: OHV < SOHC < DOHC, sharper cam raises the limit; LS3 ≈ 6240 rpm (petrol.md §4)", () => {
    const mk = (vt: "ohv" | "sohc" | "dohc", cam = 0.4): EngineConfig => {
      const c = petrol();
      c.head = { ...c.head, valvetrain: vt, valvesPerCylinder: 2, camProfile: cam };
      return c;
    };
    expect(valveFloatRpm(mk("ohv"))).toBeLessThan(valveFloatRpm(mk("sohc")));
    expect(valveFloatRpm(mk("sohc"))).toBeLessThan(valveFloatRpm(mk("dohc")));
    expect(valveFloatRpm(mk("dohc", 1))).toBeGreaterThan(valveFloatRpm(mk("dohc", 0)));
    expect(valveFloatRpm(structuredClone(REF.ls3!))).toBeCloseTo(6240, -2);
    // diesel valvetrains are designed for low rpm (diesel.md §4.1)
    expect(valveFloatRpm(diesel())).toBeLessThan(6000);
  });

  test("piston speed bands: diesel 15/17/19 (forged), petrol tiers 19 → 22 → 24 m/s", () => {
    expect(limitThresholds(diesel()).pistonSpeed).toEqual({ warning: 15, critical: 17, fatal: 19 });
    const cast = petrol();
    cast.block = { ...cast.block, crankshaft: "cast", pistons: "cast-aluminium", conrods: "cast-steel" };
    expect(limitThresholds(cast).pistonSpeed.warning).toBe(19);
    expect(limitThresholds(petrol()).pistonSpeed.warning).toBe(22);
    expect(limitThresholds(structuredClone(REF.f136!)).pistonSpeed.warning).toBe(24);
    const truck = structuredClone(REF.cummins!);
    expect(limitThresholds(truck).pistonSpeed.critical).toBe(14);
  });

  test("peak pressure design: min(block, piston, rod) with bore correction (diesel.md §4.2)", () => {
    const c = diesel(); // 81 mm, cast iron 210, cast-alu piston 190, forged rod 220
    expect(limitThresholds(c).peakPressureDesignBar).toBe(190);
    c.block = { ...c.block, pistons: "steel", blockMaterial: "compacted-graphite-iron" };
    expect(limitThresholds(c).peakPressureDesignBar).toBe(220);
    c.block = { ...c.block, boreMm: 100 };
    expect(limitThresholds(c).peakPressureDesignBar).toBeCloseTo(220 * Math.sqrt(82 / 100), 6);
  });

  test("safeMaxRpm: lower for a long stroke and for cast parts", () => {
    const short = petrol();
    short.block = { ...short.block, strokeMm: 75 };
    const long = petrol();
    long.block = { ...long.block, strokeMm: 100 };
    expect(safeMaxRpm(long)).toBeLessThan(safeMaxRpm(short));
    const cast = petrol();
    cast.block = { ...cast.block, crankshaft: "cast", pistons: "cast-aluminium", conrods: "cast-steel" };
    const race = petrol();
    race.block = { ...race.block, crankshaft: "billet", pistons: "forged-aluminium", conrods: "titanium" };
    expect(safeMaxRpm(race)).toBeGreaterThan(safeMaxRpm(cast));
    // reference engines: safe max rpm is in the vicinity of the stock limiter
    for (const config of REF_LIST) {
      expect(safeMaxRpm(config)).toBeGreaterThan(config.revLimitRpm * 0.9);
      expect(safeMaxRpm(config)).toBeLessThan(config.revLimitRpm * 1.4);
    }
  });

  test("conrod inertia force grows with rpm²", () => {
    const c = petrol();
    expect(conrodInertiaForceN(c, 6000) / conrodInertiaForceN(c, 3000)).toBeCloseTo(4, 6);
  });
});

describe("limits: engineLimits for the UI (#9)", () => {
  test("returns the warning onsets and the expected shape", () => {
    for (const cfg of [diesel(), petrol()]) {
      const l = engineLimits(cfg);
      expect(Object.keys(l).sort()).toEqual(
        ["boostMaxBar", "coolantMaxC", "egtMaxC", "meanPistonSpeedMaxMs", "oilMaxC", "oilPressureMinBar", "peakPressureMaxBar", "turboMaxRpm"].sort(),
      );
      for (const v of Object.values(l)) expect(Number.isFinite(v)).toBe(true);
      expect(l.boostMaxBar).toBeCloseTo(cfg.induction.boostTargetBar + 0.3, 6);
      expect(l.oilPressureMinBar).toBe(0.5);
    }
    expect(engineLimits(diesel()).egtMaxC).toBe(800);
    expect(engineLimits(petrol()).egtMaxC).toBe(950);
    expect(engineLimits(diesel()).coolantMaxC).toBe(108);
    expect(engineLimits(petrol()).oilMaxC).toBe(130);
    expect(engineLimits(diesel()).meanPistonSpeedMaxMs).toBe(15);
    expect(engineLimits(diesel()).peakPressureMaxBar).toBeCloseTo(0.95 * 190, 6);
  });

  test("naturally aspirated: no boost and no turbo limit", () => {
    const na = structuredClone(REF.k20a!);
    expect(engineLimits(na).boostMaxBar).toBe(0);
    expect(engineLimits(na).turboMaxRpm).toBe(0);
  });

  test("UI limits are consistent with evaluateLimits (just above → warning)", () => {
    for (const cfg of [diesel(), petrol()]) {
      const l = engineLimits(cfg);
      const at = (patch: Partial<EngineState>) => evaluateLimits(cfg, healthy(cfg, patch), createLimitTracker()).warnings.map((w) => w.code);
      expect(at({ coolantC: l.coolantMaxC + 0.5 })).toContain("overheat-coolant");
      expect(at({ coolantC: l.coolantMaxC - 0.5 })).not.toContain("overheat-coolant");
      expect(at({ oilC: l.oilMaxC + 0.5 })).toContain("overheat-oil");
      expect(at({ egtC: l.egtMaxC + 1 })).toContain("egt-high");
      expect(at({ peakPressureBar: l.peakPressureMaxBar + 1 })).toContain("peak-pressure");
      expect(at({ turboRpm: l.turboMaxRpm + 100 })).toContain("turbo-overspeed");
      expect(at({ turboRpm: l.turboMaxRpm - 100 })).not.toContain("turbo-overspeed");
    }
  });
});

describe("limits: warnings, hysteresis and hold times", () => {
  test("severity escalates: coolant 112 → warning, 122 → critical (diesel)", () => {
    const c = diesel();
    expect(hold(c, { coolantC: 112 }, 0.5).codes.get("overheat-coolant")).toBe("warning");
    expect(hold(c, { coolantC: 122 }, 0.5).codes.get("overheat-coolant")).toBe("critical");
  });

  test("warnings are German, non-empty texts", () => {
    const r = evaluateLimits(petrol(), healthy(petrol(), { coolantC: 125, oilC: 150, egtC: 1010, knock: 0.6 }), createLimitTracker());
    expect(r.warnings.length).toBeGreaterThanOrEqual(4);
    for (const w of r.warnings) expect(w.message).toMatch(/[a-zäöüß]{4}/i);
    expect(r.warnings.find((w) => w.code === "knock")?.message).toContain("Klopfen");
  });

  test("hysteresis: a warning stays active just below the threshold, clears clearly below", () => {
    const c = diesel();
    const tr = createLimitTracker();
    const codes = (t: number, coolantC: number) => evaluateLimits(c, healthy(c, { t, coolantC }), tr).warnings.map((w) => w.code);
    expect(codes(0, 109)).toContain("overheat-coolant");
    expect(codes(0.1, 107)).toContain("overheat-coolant");
    expect(codes(0.2, 104)).not.toContain("overheat-coolant");
  });

  test("short excursion above a fatal limit is survived, sustained is not (EGT, 5 s)", () => {
    const c = diesel();
    expect(hold(c, { egtC: 980 }, 3).fatal).toBeUndefined();
    const r = hold(c, { egtC: 980 }, 8);
    expect(r.fatal?.code).toBe("egt-high");
    expect(r.at).toBeGreaterThan(4.9);
    expect(r.fatal?.message).toContain("Kolben");
  });

  test("timers decay: alternating spikes do not add up to a fatal event", () => {
    const c = diesel();
    const tr = createLimitTracker();
    let fatal = false;
    for (let t = 0; t < 60; t += 0.05) {
      const spike = t % 4 < 1; // 1 s at 980 °C, 3 s normal
      fatal ||= !!evaluateLimits(c, healthy(c, { t, egtC: spike ? 980 : 700 }), tr).fatal;
    }
    expect(fatal).toBe(false);
  });

  test("tracker resets when simulation time goes back (sim.reset())", () => {
    const c = diesel();
    const tr = createLimitTracker();
    hold(c, { egtC: 980 }, 4, 0.05, tr);
    expect(hold(c, { egtC: 980 }, 3, 0.05, tr).fatal).toBeUndefined(); // starts at t = 0 again → reset
  });

  test("works without an explicit tracker (one per config object)", () => {
    const c = diesel();
    let fatal: string | undefined;
    for (let t = 0; t < 10 && !fatal; t += 0.1) fatal = evaluateLimits(c, healthy(c, { t, egtC: 990 })).fatal?.code;
    expect(fatal).toBe("egt-high");
  });

  test("wear rate rises with severity", () => {
    const c = petrol();
    const ok = hold(c, {}, 1).wear;
    const warn = hold(c, { oilC: 135 }, 1).wear;
    const crit = hold(c, { oilC: 148 }, 1).wear;
    expect(warn).toBeGreaterThan(ok * 10);
    expect(crit).toBeGreaterThan(warn * 5);
  });

  test("worn out (wear ≥ 1) → fatal", () => {
    const c = petrol();
    const r = evaluateLimits(c, healthy(c, { wear: 1, knock: 0.5 }), createLimitTracker());
    expect(r.fatal?.fatal).toBe(true);
    expect(r.fatal?.code).toBe("knock");
  });
});

describe("limits: fatal damage causes", () => {
  test("over-revving far beyond the mechanical limit → conrod failure", () => {
    const c = petrol();
    c.block = { ...c.block, strokeMm: 100, crankshaft: "cast", pistons: "cast-aluminium", conrods: "cast-steel" };
    c.revLimitRpm = 11000;
    const rpm = 10000;
    const r = hold(c, { rpm, meanPistonSpeedMs: (2 * 0.1 * rpm) / 60 }, 3);
    expect(r.codes.get("piston-speed")).toBe("critical");
    expect(["over-rev", "conrod-stress"]).toContain(r.fatal?.code);
    expect(r.fatal?.message).toMatch(/Pleuel/);
  });

  test("valve float beyond 1.08 × n_float for > 0.5 s → valve hits piston", () => {
    const c = structuredClone(REF.ls3!);
    const rpm = 1.1 * valveFloatRpm(c);
    const short = hold(c, { rpm, meanPistonSpeedMs: 15 }, 0.3);
    expect(short.fatal).toBeUndefined();
    expect(short.codes.get("valve-float")).toBe("critical");
    const r = hold(c, { rpm, meanPistonSpeedMs: 15 }, 2);
    expect(r.fatal?.code).toBe("valve-float");
    expect(r.fatal?.message).toContain("Ventil trifft Kolben");
  });

  test("peak pressure: +30 % over design → immediate piston damage (diesel)", () => {
    const c = diesel();
    const r = hold(c, { peakPressureBar: 1.3 * 190 }, 1);
    expect(r.fatal?.code).toBe("peak-pressure");
    expect(r.at).toBeLessThan(0.3);
    expect(r.fatal?.message).toContain("Kolben");
  });

  test("peak pressure slightly over design: critical, fatal only after 10 s", () => {
    const c = diesel();
    const r = hold(c, { peakPressureBar: 1.1 * 190 }, 12);
    expect(r.codes.get("peak-pressure")).toBe("critical");
    expect(r.at).toBeGreaterThan(9.9);
  });

  test("coolant > 130 °C for > 20 s (diesel) → head gasket", () => {
    const r = hold(diesel(), { coolantC: 135 }, 25);
    expect(r.fatal?.code).toBe("overheat-coolant");
    expect(r.at).toBeGreaterThan(19.9);
    expect(r.fatal?.message).toContain("Zylinderkopf");
  });

  test("oil > 155 °C (petrol) for 20 s → piston seizure", () => {
    const r = hold(petrol(), { oilC: 160 }, 25);
    expect(r.fatal?.code).toBe("overheat-oil");
    expect(r.fatal?.message).toContain("Kolbenfresser");
  });

  test("oil pressure < 0.3 bar at > 1500 rpm for 3 s → bearing failure", () => {
    const r = hold(diesel(), { oilPressureBar: 0.2 }, 5);
    expect(r.codes.get("low-oil-pressure")).toBe("critical");
    expect(r.fatal?.code).toBe("low-oil-pressure");
    expect(r.at).toBeGreaterThan(2.9);
  });

  test("turbo overspeed > 1.08 × n_max → compressor wheel bursts", () => {
    const c = petrol();
    const nMax = limitThresholds(c).turboShaftMaxRpm;
    expect(hold(c, { turboRpm: 0.97 * nMax }, 1).codes.get("turbo-overspeed")).toBe("warning");
    const r = hold(c, { turboRpm: 1.1 * nMax }, 1);
    expect(r.fatal?.code).toBe("turbo-overspeed");
    expect(r.fatal?.message).toContain("Turboschaden");
  });

  test("overboost needs > 1 s above target + 0.3 bar", () => {
    const c = petrol();
    const b = c.induction.boostTargetBar + 0.4;
    expect(hold(c, { boostBar: b }, 0.5).codes.has("overboost")).toBe(false);
    expect(hold(c, { boostBar: b }, 1.5).codes.get("overboost")).toBe("warning");
  });

  test("petrol knock: > 0.8 at bmep > 15 bar for 3 s → piston burnt; diesel ignores knock", () => {
    const r = hold(petrol(), { knock: 0.9, bmepBar: 18 }, 5);
    expect(r.fatal?.code).toBe("knock");
    expect(r.at).toBeGreaterThan(2.9);
    expect(hold(petrol(), { knock: 0.9, bmepBar: 10 }, 5).fatal).toBeUndefined();
    expect(hold(diesel(), { knock: 0.9, bmepBar: 18 }, 5).codes.has("knock")).toBe(false);
  });

  test("diesel smoke: warning/critical, but never fatal", () => {
    const r = hold(diesel(), { smoke: 0.8 }, 30);
    expect(r.codes.get("smoke")).toBe("critical");
    expect(r.fatal).toBeUndefined();
    expect(hold(petrol(), { smoke: 0.8 }, 1).codes.has("smoke")).toBe(false);
  });

  test("fatal event carries the simulation time and fatal = true", () => {
    const c = diesel();
    const r = evaluateLimits(c, healthy(c, { t: 42, peakPressureBar: 400 }), createLimitTracker());
    // first call has dt = 0; sustain one more tick
    const tr = createLimitTracker();
    evaluateLimits(c, healthy(c, { t: 42, peakPressureBar: 400 }), tr);
    const f = evaluateLimits(c, healthy(c, { t: 42.2, peakPressureBar: 400 }), tr).fatal;
    expect(r.warnings.some((w) => w.code === "peak-pressure")).toBe(true);
    expect(f).toMatchObject({ code: "peak-pressure", t: 42.2, fatal: true });
  });
});
