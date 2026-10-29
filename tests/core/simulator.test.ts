// Transient simulator behaviour (issue #7; docs/research/diesel.md §3.11, petrol.md §3.3/§4).
// Cases the placeholder simulator on main cannot meet are `test.failing`:
// scharf schalten nach Integration (#3/#4) – then make `spec()` always use plain `test`.
import { describe, expect, test } from "bun:test";
import { EngineSimulator, defaultInputs, dynoSweep } from "../../src/core/index.ts";
import type { EngineConfig, EngineState } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { REFERENCE_ENGINES } from "../../src/data/reference-engines.ts";
import { mean, nonFiniteFields, randomConfig, rng, runPhases, sample, startEngine } from "./helpers.ts";

/** Cases that already hold with the placeholder simulator (normal tests, regression guards). */
const PASS_ON_PLACEHOLDER = new Set<string>([
  "default diesel: starts and idles within ±15 % of idleRpm",
  "default petrol: starts and idles within ±15 % of idleRpm",
  "VW 1.9 TDI PD (ASZ, 96 kW): starts and idles within ±15 % of idleRpm",
  "BMW N57D30O1 (3.0d, 190 kW): starts and idles within ±15 % of idleRpm",
  "Mercedes OM654 (220d, 143 kW): starts and idles within ±15 % of idleRpm",
  "PSA/Ford 1.6 HDi 16V (DV6TED4, 80 kW): starts and idles within ±15 % of idleRpm",
  "Cummins 6BT 5.9 12V (160 kW): starts and idles within ±15 % of idleRpm",
  "Honda K20A (DC5 Type R, 162 kW): starts and idles within ±15 % of idleRpm",
  "VW EA888 Gen3 (CHHB, Golf 7 GTI, 162 kW): starts and idles within ±15 % of idleRpm",
  "BMW S54B32 (E46 M3, 252 kW): starts and idles within ±15 % of idleRpm",
  "GM LS3 6.2 (C6 Corvette, 321 kW): starts and idles within ±15 % of idleRpm",
  "Ferrari F136 FB (458 Italia, 419 kW): starts and idles within ±15 % of idleRpm",
  "no start without ignition",
  "starter alone cranks at 100 … 400 rpm (diesel.md §3.11)",
  "ignition off → engine stops",
  "idle fuel flow is small (0.3 … 2.0 l/h for 2 l engines)",
  "diesel: pedal → rpm rises clearly within 1 s",
  "diesel: limiter holds (rpm ≤ revLimit + 3 %) at full pedal",
  "diesel: releasing the pedal returns to idle (±15 %)",
  "petrol: pedal → rpm rises clearly within 1 s",
  "petrol: limiter holds (rpm ≤ revLimit + 3 %) at full pedal",
  "petrol: releasing the pedal returns to idle (±15 %)",
  "crank angle advances with rpm and stays in 0 … 720°",
  "power = torque · ω (state consistency)",
  "steady hold-rpm full load matches dynoSweep torque within ±10 %",
  "moderate constant brake torque is carried at part pedal without stalling",
  "diesel: coolant and oil warm up under load, coolant settles near the thermostat",
  "petrol: coolant and oil warm up under load, coolant settles near the thermostat",
  "EGT rises with load",
  "reset() returns to a cold, stopped engine",
  "tiny and large dt (1 ms, 1/30 s) give the same idle within ±10 %",
  "fuzz: 200 random valid configs × 30 s never produce NaN/Infinity",
  "performance: mean step(1/60) ≤ 1 ms",
]);
function spec(name: string, fn: () => void, timeout = 60_000) {
  // scharf schalten nach Integration (#3/#4)
  (PASS_ON_PLACEHOLDER.has(name) ? test : test.failing)(name, fn, timeout);
}

const ENGINES: [string, EngineConfig][] = [
  ["default diesel", defaultConfig("diesel")],
  ["default petrol", defaultConfig("petrol")],
  ...REFERENCE_ENGINES.map((r) => [r.config.name, r.config] as [string, EngineConfig]),
];

describe("start and idle", () => {
  for (const [name, cfg] of ENGINES) {
    spec(`${name}: starts and idles within ±15 % of idleRpm`, () => {
      const sim = startEngine(cfg, 15);
      expect(sim.state.running).toBe(true);
      const rpm = sample(sim, 5, {}, (s) => s.rpm);
      for (const r of rpm) {
        expect(r).toBeGreaterThan(cfg.idleRpm * 0.85);
        expect(r).toBeLessThan(cfg.idleRpm * 1.15);
      }
    });
  }

  spec("no start without ignition", () => {
    const sim = new EngineSimulator(defaultConfig("diesel"));
    runPhases(sim, [{ seconds: 3, input: { starter: true } }, { seconds: 2, input: {} }]);
    expect(sim.state.running).toBe(false);
    expect(sim.state.rpm).toBeLessThan(50);
  });

  spec("starter alone cranks at 100 … 400 rpm (diesel.md §3.11)", () => {
    const sim = new EngineSimulator(defaultConfig("diesel"));
    // ignition off: starter only drags the engine (no fuel)
    const rpm = sample(sim, 2, { ignition: false, starter: true }, (s) => s.rpm);
    const settled = mean(rpm.slice(-30));
    expect(settled).toBeGreaterThan(100);
    expect(settled).toBeLessThan(400);
  });

  spec("ignition off → engine stops", () => {
    for (const fuel of ["diesel", "petrol"] as const) {
      const sim = startEngine(defaultConfig(fuel), 3);
      runPhases(sim, [{ seconds: 6, input: { ignition: false } }]);
      expect(sim.state.running).toBe(false);
      expect(sim.state.rpm).toBeLessThan(50);
    }
  });

  spec("idle fuel flow is small (0.3 … 2.0 l/h for 2 l engines)", () => {
    for (const fuel of ["diesel", "petrol"] as const) {
      const sim = startEngine(defaultConfig(fuel), 10);
      const f = mean(sample(sim, 2, {}, (s) => s.fuelFlowLh));
      expect(f).toBeGreaterThan(0.3);
      expect(f).toBeLessThan(2.0);
    }
  });

  spec("petrol idles with a vacuum (25 … 50 kPa abs), diesel near ambient", () => {
    const p = startEngine(defaultConfig("petrol"), 8);
    const d = startEngine(defaultConfig("diesel"), 8);
    const pm = mean(sample(p, 1, {}, (s) => s.manifoldAbsKpa));
    const dm = mean(sample(d, 1, {}, (s) => s.manifoldAbsKpa));
    expect(pm).toBeGreaterThan(25);
    expect(pm).toBeLessThan(50);
    expect(dm).toBeGreaterThan(90);
  });
});

describe("throttle response and limiter", () => {
  for (const fuel of ["diesel", "petrol"] as const) {
    spec(`${fuel}: pedal → rpm rises clearly within 1 s`, () => {
      const cfg = defaultConfig(fuel);
      const sim = startEngine(cfg, 5);
      const before = sim.state.rpm;
      runPhases(sim, [{ seconds: 1, input: { ignition: true, pedal: 1 } }]);
      expect(sim.state.rpm).toBeGreaterThan(before + 1000);
    });

    spec(`${fuel}: limiter holds (rpm ≤ revLimit + 3 %) at full pedal`, () => {
      const cfg = defaultConfig(fuel);
      const sim = startEngine(cfg, 3);
      let peak = 0;
      runPhases(sim, [{ seconds: 10, input: { ignition: true, pedal: 1 }, onStep: (s) => (peak = Math.max(peak, s.rpm)) }]);
      expect(peak).toBeLessThanOrEqual(cfg.revLimitRpm * 1.03);
      // and actually reaches the limiter region
      expect(peak).toBeGreaterThan(cfg.revLimitRpm * 0.9);
    });

    spec(`${fuel}: releasing the pedal returns to idle (±15 %)`, () => {
      const cfg = defaultConfig(fuel);
      const sim = startEngine(cfg, 3);
      runPhases(sim, [{ seconds: 3, input: { ignition: true, pedal: 1 } }, { seconds: 12, input: { ignition: true, pedal: 0 } }]);
      expect(sim.state.running).toBe(true);
      expect(Math.abs(sim.state.rpm - cfg.idleRpm)).toBeLessThan(cfg.idleRpm * 0.15);
    });
  }

  spec("crank angle advances with rpm and stays in 0 … 720°", () => {
    const sim = startEngine(defaultConfig("petrol"), 3);
    const angles = sample(sim, 2, { pedal: 0.3 }, (s) => s.crankAngleDeg);
    for (const a of angles) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(720);
    }
    expect(new Set(angles.map((a) => Math.round(a))).size).toBeGreaterThan(10);
  });

  spec("power = torque · ω (state consistency)", () => {
    const sim = startEngine(defaultConfig("diesel"), 3);
    runPhases(sim, [{ seconds: 5, input: { ignition: true, pedal: 0.7, dynoMode: "hold-rpm", dynoTargetRpm: 2500 } }]);
    const s = sim.state;
    expect(s.powerKw).toBeCloseTo((s.torqueNm * s.rpm * 2 * Math.PI) / 60000, 1);
  });
});

describe("dyno brake", () => {
  for (const fuel of ["diesel", "petrol"] as const) {
    spec(`${fuel}: hold-rpm keeps the target within ±2 % at full load`, () => {
      const target = fuel === "diesel" ? 2500 : 4000;
      const sim = startEngine(defaultConfig(fuel), 3);
      runPhases(sim, [{ seconds: 5, input: { ignition: true, pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: target } }]);
      const rpm = sample(sim, 3, { pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: target }, (s) => s.rpm);
      for (const r of rpm) expect(Math.abs(r - target)).toBeLessThan(target * 0.02);
    });
  }

  spec("hold-rpm follows a step of the target (2000 → 3000) within 3 s", () => {
    const sim = startEngine(defaultConfig("diesel"), 3);
    runPhases(sim, [
      { seconds: 4, input: { ignition: true, pedal: 0.8, dynoMode: "hold-rpm", dynoTargetRpm: 2000 } },
      { seconds: 3, input: { ignition: true, pedal: 0.8, dynoMode: "hold-rpm", dynoTargetRpm: 3000 } },
    ]);
    expect(Math.abs(sim.state.rpm - 3000)).toBeLessThan(60);
  });

  spec("steady hold-rpm full load matches dynoSweep torque within ±10 %", () => {
    for (const fuel of ["diesel", "petrol"] as const) {
      const cfg = defaultConfig(fuel);
      const rpm = 3000;
      const sim = startEngine(cfg, 3);
      runPhases(sim, [{ seconds: 12, input: { ignition: true, pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: rpm } }]);
      const sweep = dynoSweep(cfg, { fromRpm: rpm, toRpm: rpm, stepRpm: 100 })[0]!;
      expect(Math.abs(sim.state.torqueNm - sweep.torqueNm)).toBeLessThan(sweep.torqueNm * 0.1);
    }
  });

  spec("too much brake torque stalls the engine (stall warning or running=false)", () => {
    const cfg = defaultConfig("diesel");
    const sim = startEngine(cfg, 3);
    let warned = false;
    runPhases(sim, [{ seconds: 6, input: { ignition: true, pedal: 0, dynoMode: "torque", dynoBrakeTorqueNm: 600 }, onStep: (s) => (warned ||= s.warnings.some((w) => w.code === "stall")) }]);
    expect(sim.state.rpm).toBeLessThan(cfg.idleRpm * 0.5);
    expect(!sim.state.running || warned).toBe(true);
  });

  spec("moderate constant brake torque is carried at part pedal without stalling", () => {
    const cfg = defaultConfig("diesel");
    const sim = startEngine(cfg, 3);
    runPhases(sim, [{ seconds: 8, input: { ignition: true, pedal: 0.6, dynoMode: "torque", dynoBrakeTorqueNm: 100 } }]);
    expect(sim.state.running).toBe(true);
    expect(sim.state.rpm).toBeGreaterThan(cfg.idleRpm);
  });
});

describe("warm-up and thermal behaviour", () => {
  for (const fuel of ["diesel", "petrol"] as const) {
    spec(`${fuel}: coolant and oil warm up under load, coolant settles near the thermostat`, () => {
      const cfg = defaultConfig(fuel);
      const sim = startEngine(cfg, 2);
      const c0 = sim.state.coolantC;
      const o0 = sim.state.oilC;
      // 10 min at 3000 rpm / ~60 % pedal (real warm-up 5 … 10 min)
      runPhases(sim, [{ seconds: 600, input: { ignition: true, pedal: 0.6, dynoMode: "hold-rpm", dynoTargetRpm: 3000 } }], 1 / 20);
      const s = sim.state;
      expect(s.coolantC).toBeGreaterThan(c0 + 40);
      expect(s.oilC).toBeGreaterThan(o0 + 30);
      expect(s.coolantC).toBeGreaterThan(cfg.cooling.thermostatOpenC - 10);
      expect(s.coolantC).toBeLessThan(cfg.cooling.thermostatOpenC + 15);
    });
  }

  spec("small radiator overheats at sustained full load (overheat-coolant warning)", () => {
    const cfg = { ...defaultConfig("diesel"), cooling: { radiatorCapacityKw: 20, thermostatOpenC: 88, oilCooler: false } };
    const sim = startEngine(cfg, 2);
    let warned = false;
    runPhases(sim, [{ seconds: 900, input: { ignition: true, pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: 4000 }, onStep: (s) => (warned ||= s.warnings.some((w) => w.code === "overheat-coolant")) }], 1 / 20);
    expect(warned || sim.state.coolantC > 108).toBe(true);
  });

  spec("EGT rises with load", () => {
    const sim = startEngine(defaultConfig("diesel"), 3);
    const low = mean(sample(sim, 4, { pedal: 0.1, dynoMode: "hold-rpm", dynoTargetRpm: 2500 }, (s) => s.egtC).slice(-60));
    const high = mean(sample(sim, 6, { pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: 2500 }, (s) => s.egtC).slice(-60));
    expect(high).toBeGreaterThan(low + 200);
  });

  spec("turbo spins up under load (turboRpm 50 000 … 250 000 at full load)", () => {
    const sim = startEngine(defaultConfig("diesel"), 3);
    runPhases(sim, [{ seconds: 8, input: { ignition: true, pedal: 1, dynoMode: "hold-rpm", dynoTargetRpm: 3000 } }]);
    expect(sim.state.turboRpm).toBeGreaterThan(50_000);
    expect(sim.state.turboRpm).toBeLessThan(250_000);
  });
});

describe("robustness", () => {
  spec("reset() returns to a cold, stopped engine", () => {
    const sim = startEngine(defaultConfig("petrol"), 3);
    runPhases(sim, [{ seconds: 3, input: { ignition: true, pedal: 1 } }]);
    sim.reset();
    expect(sim.state.rpm).toBe(0);
    expect(sim.state.running).toBe(false);
    expect(sim.state.t).toBe(0);
  });

  spec("tiny and large dt (1 ms, 1/30 s) give the same idle within ±10 %", () => {
    const cfg = defaultConfig("diesel");
    const a = startEngine(cfg, 8, 2, 1 / 1000).state.rpm;
    const b = startEngine(cfg, 8, 2, 1 / 30).state.rpm;
    expect(Math.abs(a - b)).toBeLessThan(cfg.idleRpm * 0.1);
  });

  spec("fuzz: 200 random valid configs × 30 s never produce NaN/Infinity", () => {
    const r = rng(0xc0ffee);
    const failures: string[] = [];
    const dt = 1 / 60;
    for (let i = 0; i < 200; i++) {
      const cfg = randomConfig(r, i);
      const sim = new EngineSimulator(cfg);
      // start, rev, dyno load, cold-ish, release: 30 s in total
      const phases = [
        { seconds: 2, input: { ignition: true, starter: true } },
        { seconds: 5, input: { ignition: true, pedal: 1 } },
        { seconds: 8, input: { ignition: true, pedal: 1, dynoMode: "hold-rpm" as const, dynoTargetRpm: cfg.revLimitRpm * 0.5 } },
        { seconds: 5, input: { ignition: true, pedal: 0.3, dynoMode: "torque" as const, dynoBrakeTorqueNm: 50 + r() * 400 } },
        { seconds: 5, input: { ignition: true, pedal: r() } },
        { seconds: 5, input: { ignition: false } },
      ];
      let bad: string[] = [];
      let at = -1;
      try {
        runPhases(sim, phases.map((p) => ({ ...p, onStep: (s: EngineState) => {
          if (bad.length) return;
          const nf = nonFiniteFields(s);
          if (nf.length) {
            bad = nf;
            at = s.t;
          }
        } })), dt);
      } catch (e) {
        bad = [`threw: ${(e as Error).message}`];
      }
      if (bad.length) failures.push(`#${i} (${cfg.fuel} ${cfg.block.layout}${cfg.block.cylinders} ${cfg.induction.aspiration}) t=${at.toFixed(2)}: ${bad.slice(0, 4).join(", ")}`);
    }
    expect(failures).toEqual([]);
  });

  spec("performance: mean step(1/60) ≤ 1 ms", () => {
    for (const cfg of [defaultConfig("diesel"), defaultConfig("petrol"), REFERENCE_ENGINES[REFERENCE_ENGINES.length - 1]!.config]) {
      const sim = startEngine(cfg, 2);
      const input = { ...defaultInputs(), ignition: true, pedal: 0.7, dynoMode: "hold-rpm" as const, dynoTargetRpm: 3000 };
      for (let i = 0; i < 200; i++) sim.step(1 / 60, input); // warm-up / JIT
      const n = 2000;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) sim.step(1 / 60, input);
      const perStep = (performance.now() - t0) / n;
      expect(perStep).toBeLessThanOrEqual(1);
    }
  });
});
