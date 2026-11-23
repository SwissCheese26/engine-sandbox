import { describe, expect, test } from "bun:test";
import {
  Drivetrain, EvSimulator, batteryLimits, baseRpm, cellOcv, chargeAcceptance, currentForPower, defaultInputs, evPackKwh, evSystemPowerKw,
  motorEfficiency, motorLossKw, motorMaxTorque, stepMotorTemp, nominalV, packOcv, packResistance, stepBattery, summarize, torqueAtCurrent,
} from "../../src/core/index.ts";
import type { EvMotorConfig, SimInputs } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { libraryCar } from "../../src/data/vehicle-library.ts";
import { EV_LIBRARY } from "../../src/data/ev-library.ts";
import { estimateEv, evTopSpeed, evTuningOf, fastestTuning, maxTuning, tuneEv, validTuning, withMotorType } from "../../src/data/ev-tuning.ts";
import { driveEv, evRig } from "./ev-run.ts";

// Electric drive (issue #108): motor curve, battery sag, regen, SoC drain and range, AWD split, drive modes, tuning.
// Physics: docs/research/electric.md.

const PMSM: EvMotorConfig = { kind: "pmsm", axle: "rear", peakPowerKw: 260, peakTorqueNm: 450, maxRpm: 20000, ratio: 7.56, inverterA: 900 };
const ASM: EvMotorConfig = { ...PMSM, kind: "induction" };

describe("e-motor: torque/power envelope (electric.md §2.1)", () => {
  const nb = baseRpm(PMSM);
  test("constant torque up to the base speed, base speed = P/T", () => {
    expect(nb).toBeCloseTo((260000 / 450) * (30 / Math.PI), 0);
    expect(motorMaxTorque(PMSM, 0)).toBeCloseTo(450, 6);
    expect(motorMaxTorque(PMSM, 0.9 * nb)).toBeCloseTo(450, 6);
  });
  test("constant power in field weakening, falling beyond the characteristic speed", () => {
    const p = (n: number) => (motorMaxTorque(PMSM, n) * n * Math.PI) / 30 / 1000;
    expect(p(1.5 * nb)).toBeCloseTo(260, 0);
    expect(p(2.9 * nb)).toBeCloseTo(260, 0);
    expect(p(3.3 * nb)).toBeLessThan(250);
    // the induction motor leaves the constant-power region earlier (≈ 2.2 × n_b)
    const pa = (n: number) => (motorMaxTorque(ASM, n) * n * Math.PI) / 30 / 1000;
    expect(pa(2.9 * nb)).toBeLessThan(p(2.9 * nb));
  });
  test("no torque at the speed limit", () => {
    expect(motorMaxTorque(PMSM, 20000)).toBe(0);
    expect(motorMaxTorque(PMSM, 19900)).toBeLessThan(motorMaxTorque(PMSM, 19000));
  });
  test("base speed ∝ voltage: a sagging pack costs power at speed, not torque at standstill", () => {
    expect(baseRpm(PMSM, 0.85)).toBeCloseTo(0.85 * nb, 6);
    expect(motorMaxTorque(PMSM, 100, 0.85)).toBeCloseTo(450, 6);
    expect(motorMaxTorque(PMSM, 1.5 * nb, 0.85)).toBeLessThan(motorMaxTorque(PMSM, 1.5 * nb, 1));
  });
  test("torque ∝ current, saturating above the design current", () => {
    expect(torqueAtCurrent(PMSM, 450)).toBeCloseTo(225, 6);
    const t2 = torqueAtCurrent(PMSM, 1800);
    expect(t2).toBeGreaterThan(450 * 1.5);
    expect(t2).toBeLessThan(450 * 2);
  });
  test("efficiency map: PMSM ≈ 95–97 % at part load, lower at full torque, induction below PMSM", () => {
    const part = motorEfficiency(PMSM, 8000, 80);
    expect(part).toBeGreaterThan(0.93);
    expect(part).toBeLessThan(0.98);
    const full = motorEfficiency(PMSM, 0.8 * nb, 450);
    expect(full).toBeGreaterThan(0.85);
    expect(full).toBeLessThan(part);
    expect(motorEfficiency(ASM, 8000, 80)).toBeLessThan(part);
    // …but unloaded the induction motor drags less (no magnets): why Tesla puts it on the front axle
    expect(motorLossKw(ASM, 12000, 0)).toBeLessThan(motorLossKw(PMSM, 12000, 0));
  });
});

describe("battery: OCV, sag, limits (electric.md §3)", () => {
  const b = libraryCar("ev-tesla-model-s-plaid").setup.ev!.battery;
  test("OCV rises with SoC, Plaid pack ≈ 407 V nominal", () => {
    for (let s = 0; s < 0.85; s += 0.1) expect(cellOcv("nmc", s + 0.1)).toBeGreaterThan(cellOcv("nmc", s));
    expect(nominalV(b)).toBeGreaterThan(395);
    expect(nominalV(b)).toBeLessThan(420);
  });
  test("voltage sag U = U_OCV − I·R; resistance higher in the cold", () => {
    const ocv = packOcv(b, 0.9);
    const R = packResistance(b, 25);
    const i = currentForPower(ocv, R, 500);
    expect((ocv - i * R) * i).toBeCloseTo(500000, -1);
    const st = stepBattery(b, { soc: 0.9, tempC: 25, v: ocv, a: 0 }, 500, 0.001, 20);
    expect(st.v).toBeCloseTo(ocv - st.a * R, 3);
    expect(ocv - st.v).toBeGreaterThan(20);
    expect(packResistance(b, 0)).toBeGreaterThan(1.8 * R);
  });
  test("discharge limit falls with SoC and heat; regen acceptance tapers to 0 at 100 % and in the cold", () => {
    const full = batteryLimits(b, 0.9, 25);
    expect(batteryLimits(b, 0.1, 25).maxDischargeKw).toBeLessThan(full.maxDischargeKw * 0.8);
    expect(batteryLimits(b, 0.9, 64).maxDischargeKw).toBeLessThan(full.maxDischargeKw * 0.4);
    expect(chargeAcceptance(1, 25)).toBe(0);
    expect(chargeAcceptance(0.5, 25)).toBe(1);
    expect(chargeAcceptance(0.5, -10)).toBeLessThan(0.2);
    expect(batteryLimits(b, 1, 25).maxChargeKw).toBe(0);
  });
  test("SoC by coulomb counting: 1 C for 6 min takes 10 %", () => {
    let st = { soc: 0.8, tempC: 25, v: packOcv(b, 0.8), a: 0 };
    const ah = b.parallelCells * b.cellAh;
    for (let i = 0; i < 360; i++) st = stepBattery(b, st, (packOcv(b, st.soc) * ah) / 1000, 1, 20);
    expect(0.8 - st.soc).toBeGreaterThan(0.095);
    expect(0.8 - st.soc).toBeLessThan(0.11);
    expect(st.tempC).toBeGreaterThan(25);
  });
});

describe("EvSimulator on the chassis dyno", () => {
  test("Ready: no idle, no starter; drives off with the pedal, the power meter shows kW and SoC drops", () => {
    const car = libraryCar("ev-tesla-model-s-plaid");
    const r = evRig(car);
    r.inp.ignition = false;
    for (let i = 0; i < 30; i++) r.step(1);
    expect(r.sim.state.running).toBe(false);
    expect(r.dt.state.speedKmh).toBeLessThan(0.1);
    r.inp.ignition = true;
    const s0 = r.sim.state.ev!.soc;
    let s = r.sim.state;
    for (let i = 0; i < 120; i++) s = r.step(1);
    expect(s.running).toBe(true);
    expect(s.rpm).toBeGreaterThan(1000);
    expect(s.ev!.powerKw).toBeGreaterThan(400);
    expect(s.ev!.soc).toBeLessThan(s0);
    expect(r.dt.gearLabel()).toBe("D");
    expect(r.dt.state.electric).toBe(true);
  });

  test("lift-off regen: negative battery power, SoC rises, ≈ liftOffRegenG; none from a full pack", () => {
    const car = libraryCar("ev-tesla-model-s-lr");
    const r = evRig(car, "sport");
    for (let i = 0; i < 600; i++) r.step(1);
    const v0 = r.dt.state.speedKmh;
    expect(v0).toBeGreaterThan(120);
    const soc0 = r.sim.state.ev!.soc;
    let s = r.sim.state;
    for (let i = 0; i < 60; i++) s = r.step(0);
    expect(s.ev!.powerKw).toBeLessThan(-20);
    expect(s.ev!.regenKw).toBeGreaterThan(20);
    expect(s.ev!.soc).toBeGreaterThan(soc0);
    const decelG = -(s.accelMs2 ?? 0) / 9.81;
    // regen + rolling + aero at ≈ 130 km/h
    expect(decelG).toBeGreaterThan(car.setup.ev!.liftOffRegenG * 0.9);
    expect(decelG).toBeLessThan(car.setup.ev!.liftOffRegenG + 0.12);

    const full = evRig(car, "sport");
    full.sim.setSoc(1);
    for (let i = 0; i < 400; i++) full.step(1);
    for (let i = 0; i < 30; i++) full.step(0);
    expect(full.sim.state.ev!.regenKw).toBeLessThan(15);
  });

  test("blended braking: light braking is all regen, hard braking adds the friction brake", () => {
    const car = libraryCar("ev-vw-id4-gtx");
    const r = evRig(car, "sport");
    for (let i = 0; i < 480; i++) r.step(1);
    let s = r.sim.state;
    for (let i = 0; i < 30; i++) s = r.step(0, 0.1);
    const light = s.ev!.regenKw;
    expect(light).toBeGreaterThan(30);
    for (let i = 0; i < 30; i++) s = r.step(0, 1);
    expect(-(s.accelMs2 ?? 0) / 9.81).toBeGreaterThan(0.6);
  });

  test("SoC drain and range at 100 km/h: consumption plausible, range follows the charge", () => {
    const car = libraryCar("ev-vw-id3-pro-performance");
    const r = evRig(car, "sport");
    for (let i = 0; i < 60 * 600; i++) {
      // simple cruise: hold 100 km/h
      const v = r.dt.state.speedKmh;
      r.step(v < 100 ? Math.min(1, 0.35 + (100 - v) * 0.05) : 0.25);
    }
    const ev = r.sim.state.ev!;
    expect(r.dt.state.speedKmh).toBeGreaterThan(95);
    // WLTP 15.4 kWh/100 km; 100 km/h constant is ≈ 15–19 kWh/100 km for a compact EV
    expect(ev.kwhPer100).toBeGreaterThan(12);
    expect(ev.kwhPer100).toBeLessThan(21);
    expect(ev.tripKwhPer100).toBeGreaterThan(12);
    expect(ev.tripKwhPer100).toBeLessThan(21);
    // 10 min ≈ 16 km ≈ 2.7 kWh of 63 kWh → SoC −4 %
    expect(0.9 - ev.soc).toBeGreaterThan(0.03);
    expect(0.9 - ev.soc).toBeLessThan(0.07);
    // range = remaining energy / consumption
    expect(ev.rangeKm).toBeGreaterThan(250);
    expect(ev.rangeKm).toBeLessThan(450);
    // energy taken ≈ SoC drop × pack energy (losses in R are small at 100 km/h)
    expect(ev.energyKwh - ev.regenKwh).toBeCloseTo((0.9 - ev.soc) * evPackKwh(car.setup.ev!), 0);
  });

  test("AWD split with ASR: front + rear wheel force never beyond 0.97·μ·m·g; the axle torques add up", () => {
    const car = libraryCar("ev-tesla-model-s-plaid");
    const r = evRig(car);
    let s = r.sim.state;
    for (let i = 0; i < 40; i++) s = r.step(1);
    const ev = s.ev!;
    const f = (ev.frontNm + ev.rearNm) / r.dt.vehicle.wheelRadiusM;
    expect(f / (r.dt.vehicle.massKg * 9.81)).toBeLessThan(0.97 * r.dt.state.grip + 0.01);
    expect(ev.frontNm).toBeGreaterThan(0);
    expect(ev.rearNm).toBeGreaterThan(ev.frontNm);
    expect(ev.limitedBy).toBe("traction");
    expect(s.wheelSlip!).toBeLessThan(0.1);
  });

  test("without ASR a Plaid spins its tyres", () => {
    const car = libraryCar("ev-tesla-model-s-plaid");
    const r = evRig(car);
    r.dt.setAssists({ asr: false, esp: false });
    let spin = false;
    for (let i = 0; i < 60; i++) spin = r.step(1).wheelSpin === true || spin;
    expect(spin).toBe(true);
  });

  test("drive modes: Chill < Sport < Plaid", () => {
    const car = libraryCar("ev-tesla-model-y-performance");
    const t = (m: "chill" | "sport" | "plaid") => driveEv(car, 12, m).t100!;
    expect(t("chill")).toBeGreaterThan(t("sport"));
    expect(t("sport")).toBeGreaterThan(t("plaid") - 0.05);
  });

  test("the motor on the free bench spins up to its limit, held speed with the dyno brake", () => {
    const sim = new EvSimulator(libraryCar("ev-vw-id3-pro-performance").setup.ev!);
    const inp: SimInputs = { ...defaultInputs(), ignition: true, pedal: 1 };
    for (let i = 0; i < 300; i++) sim.step(1 / 60, inp);
    expect(sim.state.rpm).toBeGreaterThan(15000);
    expect(sim.state.rpm).toBeLessThan(16100);
    const hold = { ...inp, dynoMode: "hold-rpm" as const, dynoTargetRpm: 6000 };
    for (let i = 0; i < 600; i++) sim.step(1 / 60, hold);
    expect(Math.abs(sim.state.rpm - 6000)).toBeLessThan(250);
    expect(sim.state.powerKw).toBeGreaterThan(100);
  });

  test("a combustion car on the same Drivetrain is untouched (no ev flag, gears as before)", () => {
    const cfg = defaultConfig("petrol");
    const d = new Drivetrain(cfg, summarize(cfg));
    d.applyCar(libraryCar("ev-tesla-model-s-plaid").setup);
    expect(d.ev).not.toBeNull();
    d.applyCar(libraryCar("car-vw-golf7-gti").setup);
    expect(d.ev).toBeNull();
    expect(d.state.electric).toBe(false);
    expect(d.state.gearCount).toBe(6);
  });
});

describe("EV tuning (electric.md §6)", () => {
  const plaidCar = libraryCar("ev-tesla-model-s-plaid");
  const plaid = plaidCar.setup.ev!;
  const factory = evTuningOf(plaid, "uhp");
  test("factory values reproduce the car", () => {
    const t = tuneEv(plaid, factory);
    expect(t.systemKw / evSystemPowerKw(plaid)).toBeCloseTo(1, 2);
    expect(Math.abs(t.deltaKg)).toBeLessThan(1);
    expect(t.ev.battery.seriesCells).toBe(plaid.battery.seriesCells);
    expect(t.ev.motors.length).toBe(3);
  });
  test("an untouched tuner is the factory car, for every electric car", () => {
    for (const c of EV_LIBRARY) {
      const ev = c.setup.ev!;
      const t = tuneEv(ev, evTuningOf(ev, c.setup.tyre.type));
      expect(t.ev.battery.seriesCells).toBe(ev.battery.seriesCells);
      expect(t.ev.battery.parallelCells).toBe(ev.battery.parallelCells);
      expect(t.ev.battery.cellAh).toBe(ev.battery.cellAh);
      expect(t.ev.battery.maxDischargeC).toBeCloseTo(ev.battery.maxDischargeC, 9);
      expect(t.ev.motors.map((m) => [m.axle, m.peakTorqueNm, m.peakPowerKw, m.inverterA, m.ratio])).toEqual(ev.motors.map((m) => [m.axle, m.peakTorqueNm, m.peakPowerKw, m.inverterA, m.ratio]));
      expect(t.deltaKg).toBeCloseTo(0, 6);
      expect(t.systemKw).toBeCloseTo(evSystemPowerKw(ev), 6);
    }
  });
  test("1 … 8 motors (4 per axle), limits enforced", () => {
    const v = validTuning({ ...factory, frontMotors: 4, rearMotors: 4, cRate: 99, motorScale: -1, tyre: "rubber" }, factory);
    expect(v.frontMotors + v.rearMotors).toBe(8);
    expect(v.cRate).toBe(15);
    expect(v.motorScale).toBe(0.5);
    expect(v.tyre).toBe("uhp");
    expect(validTuning({ frontMotors: 0, rearMotors: 0 }, factory).rearMotors).toBe(1);
  });
  test("up to ≈ 3000 PS, only with 800 V; 400 V stops at the contactor current; the limit is named", () => {
    const max = tuneEv(plaid, maxTuning());
    expect(max.systemPs).toBeGreaterThan(2500);
    expect(max.systemPs).toBeLessThan(3300);
    expect(max.deltaKg).toBeGreaterThan(500);
    expect(max.limit).toBe("battery");
    const lv = tuneEv(plaid, { ...maxTuning(), highVoltage: false });
    expect(lv.systemPs).toBeLessThan(1800);
    expect(lv.notes.join(" ")).toContain("800 V");
    const inv = tuneEv(plaid, { ...factory, motorScale: 3, currentScale: 2 });
    expect(inv.inverterA).toBe(2500);
    expect(inv.notes.join(" ")).toContain("Wechselrichter");
    // more current: more torque, but saturating
    const cur = tuneEv(plaid, { ...factory, currentScale: 1.5 });
    expect(cur.motorNm).toBeGreaterThan(450 * 1.25);
    expect(cur.motorNm).toBeLessThan(450 * 1.5);
  });
  test("cell type, voltage and cooling change the pack", () => {
    const lfp = tuneEv(plaid, { ...factory, chemistry: "lfp" });
    expect(lfp.ev.battery.chemistry).toBe("lfp");
    expect(lfp.deltaKg).toBeGreaterThan(100); // LFP is heavier per kWh
    const hv = tuneEv(plaid, { ...factory, highVoltage: true });
    expect(hv.ev.battery.seriesCells).toBe(2 * plaid.battery.seriesCells);
    const track = tuneEv(plaid, { ...factory, cooling: "track" });
    expect(track.ev.coolingScale).toBe(2.5);
    expect(track.ev.battery.coolingWPerK).toBe(1400);
  });
  test("better cooling: a hot motor and battery shed their heat faster", () => {
    const m = plaid.motors[0]!;
    let a = 160;
    let b = 160;
    for (let i = 0; i < 60; i++) {
      a = stepMotorTemp(m, a, 5, 1, 20, 1);
      b = stepMotorTemp(m, b, 5, 1, 20, 2.5);
    }
    expect(b).toBeLessThan(a - 10);
    const serie = tuneEv(plaid, factory).ev.battery;
    const track = tuneEv(plaid, { ...factory, cooling: "track" }).ev.battery;
    let x = { soc: 0.8, tempC: 60, v: 400, a: 0 };
    let y = { ...x };
    for (let i = 0; i < 300; i++) {
      x = stepBattery(serie, x, 0, 1, 20);
      y = stepBattery(track, y, 0, 1, 20);
    }
    expect(y.tempC).toBeLessThan(x.tempC - 3);
  });
  test("estimate: factory Plaid ≈ the library run; a Plaid tuned beyond 2000 PS drives, traction-limited at launch", () => {
    const f = estimateEv(plaidCar.setup, tuneEv(plaid, factory));
    expect(f.t100!).toBeGreaterThan(2.5);
    expect(f.t100!).toBeLessThan(3.1);
    expect(f.rangeKm).toBeGreaterThan(450);
    const big = tuneEv(plaid, { ...factory, frontMotors: 2, rearMotors: 2, motorScale: 2, currentScale: 1.5, packKwh: 150, cRate: 12, highVoltage: true, cooling: "track", tyre: "semi-slick" });
    expect(big.systemPs).toBeGreaterThan(2000);
    const e = estimateEv(plaidCar.setup, big);
    expect(e.tractionLimited).toBe(true);
    expect(e.t100!).toBeLessThan(3.5);
    // driving it: much more power at speed than the factory car
    const car = structuredClone(plaidCar);
    car.setup.ev = big.ev;
    car.setup.vehicle.massKg += big.deltaKg;
    car.setup.speedLimitKmh = null;
    const r = driveEv(car, 25);
    expect(r.peakKw).toBeGreaterThan(1400);
  });
});

describe("stronger motors: size, type, motor cooling (#141)", () => {
  const plaidCar = libraryCar("ev-tesla-model-s-plaid");
  const plaid = plaidCar.setup.ev!;
  const factory = evTuningOf(plaid, "uhp");
  // a big pack so the motors, not the battery, decide
  const pack = { ...factory, packKwh: 200, chemistry: "nca" as const, cRate: 15, highVoltage: true };
  test("an upgraded motor gives more power, more mass and more heat; 800 V halves the current it needs", () => {
    const a = tuneEv(plaid, pack);
    const b = tuneEv(plaid, { ...pack, motorScale: 4 });
    expect(b.motorKw).toBeCloseTo(4 * 260, 0);
    expect(b.systemKw).toBeGreaterThan(1.5 * a.systemKw);
    expect(b.deltaKg - a.deltaKg).toBeCloseTo(3 * (4 - 1) * 260 * 0.4, 0); // 0.4 kg/kW drive unit
    expect(b.heatKw).toBeCloseTo(4 * a.heatKw, 6);
    expect(b.inverterA).toBeCloseTo(4 * 900 / 2, 0); // 400 V design rewound for 800 V
    expect(tuneEv(plaid, { ...factory, motorScale: 4 }).limit).toBe("battery"); // the factory pack caps it, said so
  });
  test("axial flux: lighter and stronger, but the disc rotor caps the speed", () => {
    const r = tuneEv(plaid, pack);
    const ax = tuneEv(plaid, { ...pack, motorType: "axial" });
    expect(ax.motorNm).toBeCloseTo(1.3 * r.motorNm, 6);
    // the same power: a radial motor 1.3 × the size is heavier (≈ 17 vs 7 kW/kg for the motor alone)
    expect(ax.deltaKg).toBeLessThan(tuneEv(plaid, { ...pack, motorScale: 1.3 }).deltaKg - 30);
    expect(Math.max(...ax.ev.motors.map((m) => m.maxRpm))).toBe(10000);
    expect(ax.rpmVmaxKmh).toBeLessThan(r.rpmVmaxKmh);
  });
  test("with stator oil cooling the derating comes later, direct winding oil later still", () => {
    const timeToDerate = (motorCooling: "jacket" | "stator-oil" | "winding-oil") => {
      const t = tuneEv(plaid, { ...pack, motorScale: 2, motorCooling });
      const m = t.ev.motors[0]!;
      let c = 60;
      let s = 0;
      while (c < 150 && s < 36000) c = stepMotorTemp(m, c, t.heatKw, 1, 25, t.ev.coolingScale), s++;
      return { s, cont: t.continuousKw };
    };
    const [w, o, d] = [timeToDerate("jacket"), timeToDerate("stator-oil"), timeToDerate("winding-oil")];
    expect(o.s).toBeGreaterThan(w.s);
    expect(d.s).toBeGreaterThan(o.s);
    expect(o.cont).toBeGreaterThan(w.cont);
  });
  test("Maximum builds the fastest car: no idle motor mass, quicker than factory, high Vmax", () => {
    const r = plaidCar.setup.vehicle.wheelRadiusM;
    const t = fastestTuning(plaidCar.setup);
    const fast = tuneEv(plaid, t, r);
    const heavy = tuneEv(plaid, maxTuning(), r);
    expect(fast.systemPs).toBeGreaterThan(2500);
    expect(fast.ev.motors.reduce((a, m) => a + m.peakPowerKw, 0)).toBeLessThan(1.1 * fast.systemKw); // motors ≈ pack
    expect(fast.deltaKg).toBeLessThan(heavy.deltaKg - 1000);
    expect(t.packKwh).toBeLessThan(200);
    const f100 = estimateEv(plaidCar.setup, tuneEv(plaid, factory, r)).t100!;
    expect(estimateEv(plaidCar.setup, fast).t100!).toBeLessThan(f100);
    expect(evTopSpeed(plaidCar.setup, fast).kmh).toBeGreaterThan(380);
  });
  test("another motor type adapts the reduction: axial flux keeps a usable Vmax", () => {
    const r = plaidCar.setup.vehicle.wheelRadiusM;
    const ax = withMotorType({ ...factory, vmaxKmh: null }, "axial");
    expect(ax.firstRatio).toBeLessThan(factory.firstRatio);
    expect(evTopSpeed(plaidCar.setup, tuneEv(plaid, ax, r)).kmh).toBeGreaterThan(250);
    expect(withMotorType(ax, "radial").firstRatio).toBeGreaterThan(ax.firstRatio); // back: longer reduction again
  });
  test("factory values are unchanged: radial, water jacket, the library untouched", () => {
    for (const c of EV_LIBRARY) {
      const ev = c.setup.ev!;
      const before = structuredClone(ev);
      const t = evTuningOf(ev, c.setup.tyre.type);
      expect([t.motorType, t.motorCooling, t.motorScale]).toEqual(["radial", "jacket", 1]);
      const tuned = tuneEv(ev, t);
      expect(tuned.ev.coolingScale).toBe(1);
      expect(tuned.deltaKg).toBeCloseTo(0, 6);
      tuneEv(ev, maxTuning());
      expect(ev).toEqual(before);
    }
  });
});
