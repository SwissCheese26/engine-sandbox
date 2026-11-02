/**
 * Thermal subsystem: coolant and oil as two lumped heat capacities, thermostat, radiator with fan,
 * oil cooler / sump losses, first-order exhaust gas temperature, and oil pressure.
 *
 * Specification: docs/research/diesel.md §3.10 (heat capacities, thermostat, radiator, oil, oil pressure),
 * §3.7 (EGT lag τ ≈ 1.5 s, cast-log 2.5 s, tubular 1.0 s), petrol.md §3.13.
 *
 * The signature (issue #4) gives only `heatToCoolantKw` (heat from combustion into the coolant jacket).
 * Oil heat is derived here: friction heat ∝ fmep(cm)·Vh·n (diesel.md §3.4 Chen-Flynn, cm terms) plus piston
 * cooling ∝ coolant heat. diesel.md §3.10 puts 0.5·P_fric into the oil; we use 0.25 (piston cooling 6 % of
 * the coolant heat), because a large part of
 * the piston/ring friction leaves through the liner into the coolant (review B1: with 0.5 high-revving petrol
 * engines reached 170 … 200 °C oil at sustained high rpm; real track values are 130 … 150 °C).
 *
 * Calibration [S] (deviations from diesel.md §3.10, documented in the PR):
 * - Coolant capacity = **small circuit** only (engine jacket, heater core, hoses: 1.5 + 0.6 l per litre)
 *   plus 10 % of the engine mass as coupled metal; oil: sump fill that circulates (2 + 0.6 l per litre)
 *   plus 3 % of the engine mass. While the thermostat is closed this is what really
 *   warms up; once it opens, the radiator loop's cold water enters through the radiator term (which scales
 *   with opening × ΔT). Idle warm-up of a 2 l engine (≈ 3 kW into the coolant) to thermostat − 5 K ≈ 8 min
 *   (game target 3 … 5 min, real 10 … 15 min) and ≈ 1 … 2 min under part load.
 * - Oil → coolant UA: 300 W/K with oil cooler, 220 W/K without (block walls) for 2 l at 3000 rpm, scaled with
 *   the oil pump flow (∝ rpm, 0.5 … 2.2×) and engine size (see oilToCoolantUA). diesel.md's constant 150/40 W/K let the oil reach > 150 °C at sustained
 *   full load, which is unrealistic.
 *
 * Integration: linearly implicit (Rosenbrock-Euler) sub-steps of ≤ 0.25 s with a numerical 2×2 Jacobian. This
 * is stable for any dt and any radiator size (stiff case: tiny engine + huge radiator), and accurate for the
 * slow warm-up dynamics. EGT uses the exact solution of the first-order lag.
 *
 * Pure functions, no DOM.
 */
import type { EngineConfig } from "./types.ts";
import { engineMassKg } from "./mass.ts";

export interface ThermalState {
  coolantC: number;
  oilC: number;
  egtC: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function displacementL(cfg: EngineConfig): number {
  const { boreMm, strokeMm, cylinders } = cfg.block;
  return ((Math.PI / 4) * (boreMm / 10) ** 2 * (strokeMm / 10) * cylinders) / 1000;
}

/** Heat capacities of the coolant and oil circuits, J/K (diesel.md §3.10, metal share see header). */
export function heatCapacities(cfg: EngineConfig): { coolantJK: number; oilJK: number } {
  const vl = displacementL(cfg);
  const mass = engineMassKg(cfg);
  const cMetal = cfg.block.blockMaterial === "aluminium" ? 900 : 460;
  return {
    // coolant 50 % glycol: ρ 1.04 kg/l, c_p 3.5 kJ/(kg K); small-circuit volume (see header)
    coolantJK: (1.5 + 0.6 * vl) * 1.04 * 3500 + 0.1 * mass * cMetal,
    // oil: ρ 0.85 kg/l, c_p 2.0 kJ/(kg K); circulating volume 2 + 0.6 l per litre displacement
    oilJK: (2 + 0.6 * vl) * 0.85 * 2000 + 0.03 * mass * cMetal,
  };
}

/** Thermostat opening 0.01 … 1: fully open at +12 K (diesel.md §3.10). Leak flow 1 % instead of 2 %, as the
 *  bypass flow of a wax thermostat with jiggle valve is small [S]. */
export function thermostatOpening(cfg: EngineConfig, coolantC: number): number {
  return clamp((coolantC - cfg.cooling.thermostatOpenC) / 12, 0.01, 1);
}

/**
 * Radiator heat rejection, W. Rated `radiatorCapacityKw` at full fan, 90 °C coolant and 25 °C ambient,
 * scaling with ΔT (diesel.md §3.10). Fan: ramps in from thermostat + 6 K to + 10 K (≈ 95 °C); otherwise the
 * engine-driven water pump flow and natural draught give 40 % (test bench, no ram air).
 */
export function radiatorHeatW(cfg: EngineConfig, coolantC: number, ambientC: number, rpm: number): number {
  const open = thermostatOpening(cfg, coolantC);
  const fanOn = clamp((coolantC - (cfg.cooling.thermostatOpenC + 6)) / 4, 0, 1);
  // Water pump flow rises with rpm; at idle the coolant-side heat transfer is lower [S].
  const pump = 0.7 + 0.3 * clamp(rpm / 3000, 0, 1);
  const airSide = 0.4 + 0.6 * fanOn;
  return cfg.cooling.radiatorCapacityKw * 1000 * open * airSide * pump * Math.max(0, coolantC - ambientC) / (90 - 25);
}

/** EGT time constant, s (diesel.md §3.7: τ 1.5 s, cast-log 2.5 s, tubular 1.0 s). */
export function egtTimeConstantS(cfg: EngineConfig): number {
  return cfg.exhaust.manifold === "cast-log" ? 2.5 : 1.0;
}

/** Oil heat input, W: friction heat share + piston cooling (diesel.md §3.10). */
function oilHeatW(cfg: EngineConfig, heatToCoolantKw: number, rpm: number): number {
  const vh = displacementL(cfg) / 1000;
  const cm = (2 * (cfg.block.strokeMm / 1000) * Math.max(0, rpm)) / 60;
  // speed-dependent Chen-Flynn part (diesel.md §3.4: C·cm + D·cm², plus a constant for the oil pump at rpm > 0)
  const fmepBar = rpm > 50 ? 0.25 + 0.06 * cm + 0.0012 * cm * cm : 0;
  const pFric = fmepBar * 1e5 * vh * (Math.max(0, rpm) / 120);
  const pistonCooling = 0.06 * Math.max(0, heatToCoolantKw) * 1000;
  return 0.25 * pFric + pistonCooling;
}

/**
 * Oil → coolant heat transfer, W/K [S]: oil cooler or block walls/jacketed liners, for a 2 l engine at 3000 rpm
 * 300 resp. 220 W/K; scaled with oil pump flow (∝ rpm, 0.5 … 2.2×) and engine size ((V/2 l)^0.6: more bearing
 * and liner area, bigger coolers).
 */
export function oilToCoolantUA(cfg: EngineConfig, rpm: number): number {
  const base = cfg.cooling.oilCooler ? 300 : 220;
  const size = (Math.max(0.1, displacementL(cfg)) / 2) ** 0.6;
  return base * size * clamp(0.3 + 0.7 * (Math.max(0, rpm) / 3000), 0.5, 2.2);
}

/**
 * Advances coolant, oil and EGT by dt seconds. Linearly implicit sub-steps (≤ 0.25 s), stable for any dt.
 * heatToCoolantKw: combustion heat into the coolant jacket (wall heat + ½ friction), from the simulator.
 * targetEgtC: quasi-steady EGT from the combustion model; the returned egtC lags it (first order, exact).
 */
export function stepThermal(
  s: ThermalState,
  cfg: EngineConfig,
  dt: number,
  heatToCoolantKw: number,
  targetEgtC: number,
  rpm: number,
  ambientC: number,
): ThermalState {
  if (!(dt > 0)) return { ...s };
  const { coolantJK, oilJK } = heatCapacities(cfg);
  const qComb = Math.max(0, heatToCoolantKw) * 1000;
  const qOilIn = oilHeatW(cfg, heatToCoolantKw, rpm);
  // Oil → coolant via oil cooler (plate heat exchanger) or block walls; sump → air (diesel.md §3.10).
  const uaOil = oilToCoolantUA(cfg, rpm);
  // Natural convection of the block surface to ambient, W/K [S].
  const uaBlock = 0.03 * engineMassKg(cfg);
  // sump → air, diesel.md §3.10: 10 W/K incl. block surface (here split into sump 6 W/K + block above)
  const uaSump = 6;
  const f = (c: number, o: number): [number, number] => {
    const qOilToCool = uaOil * (o - c);
    return [
      (qComb + qOilToCool - radiatorHeatW(cfg, c, ambientC, rpm) - uaBlock * (c - ambientC)) / coolantJK,
      (qOilIn - qOilToCool - uaSump * (o - ambientC)) / oilJK,
    ];
  };
  const n = Math.max(1, Math.ceil(dt / 0.25));
  const h = dt / n;
  let c = Number.isFinite(s.coolantC) ? s.coolantC : ambientC;
  let o = Number.isFinite(s.oilC) ? s.oilC : ambientC;
  for (let i = 0; i < n; i++) {
    // Rosenbrock-Euler: (I − h·J)·Δ = h·f(x), J by finite differences (radiator term is non-linear).
    const [fc, fo] = f(c, o);
    const e = 0.01;
    const [fcC, foC] = f(c + e, o);
    const [fcO, foO] = f(c, o + e);
    const a11 = 1 - (h * (fcC - fc)) / e;
    const a12 = -(h * (fcO - fc)) / e;
    const a21 = -(h * (foC - fo)) / e;
    const a22 = 1 - (h * (foO - fo)) / e;
    const det = a11 * a22 - a12 * a21;
    const dc = (h * fc * a22 - a12 * h * fo) / det;
    const dO = (a11 * h * fo - a21 * h * fc) / det;
    c += dc;
    o += dO;
  }
  const egt0 = Number.isFinite(s.egtC) ? s.egtC : targetEgtC;
  // Heating follows the gas quickly (sensor + thin gas boundary layer). Cooling is slower because the hot
  // manifold/turbine housing gives its heat back to the gas and the probe [S, Arthur's question 02.11.]:
  // with flow (overrun, idle) ≈ 3× slower; without flow (engine off) only natural convection, τ ≈ 4–5 min.
  const tauBase = egtTimeConstantS(cfg);
  const tau = targetEgtC >= egt0 ? tauBase : rpm < 50 ? 270 : tauBase * 3;
  const egtC = targetEgtC + (egt0 - targetEgtC) * Math.exp(-dt / tau);
  return { coolantC: c, oilC: o, egtC };
}

/**
 * Oil pressure, bar (diesel.md §3.10): ≈ 1 bar per 1000 rpm warm (petrol.md §4 rule of thumb), higher when
 * cold (viscosity), relief valve at 5 bar (diesel) / 5.5 bar (petrol). Hot idle ≈ 1.2 bar at 800 rpm.
 * Very hot oil (> 130 °C) thins further.
 */
export function oilPressureBar(cfg: EngineConfig, rpm: number, oilC: number): number {
  if (rpm <= 0) return 0;
  const relief = cfg.fuel === "diesel" ? 5.0 : 5.5;
  const visc = clamp(1 + (90 - oilC) / 80, 0.55, 2.5) - 0.01 * Math.max(0, oilC - 130);
  // Pump delivery ∝ rpm; leakage at the bearings makes the low end drop faster (offset) [S].
  const p = (0.0015 * rpm) * Math.max(0.3, visc);
  return clamp(p, 0, relief);
}
