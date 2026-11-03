/**
 * Mean value cycle evaluation shared by the steady dyno sweep and the transient simulator.
 * One call = all quantities averaged over one working cycle (720 °CA) at an operating point.
 * Order follows docs/research/diesel.md §3 (3.1 … 3.8) and docs/research/petrol.md §3 (3.1 … 3.11).
 * Pure functions, no DOM.
 */
import { R_AIR, steadyManifoldRatio, throttlePsi, veParams, volumetricEfficiency } from "./airpath.ts";
import type { VeParams } from "./airpath.ts";
import { dieselCombustion, dieselConsts, governor, injectionCapacity, smokeLimitFuel } from "./combustion-diesel.ts";
import type { DieselConsts } from "./combustion-diesel.ts";
import { knockIntensity, knockMargin, petrolCombustion, petrolConsts, petrolLambda } from "./combustion-petrol.ts";
import type { PetrolConsts } from "./combustion-petrol.ts";
import { fmepBar, frictionParams } from "./friction.ts";
import type { FrictionParams } from "./friction.ts";
import { crankInertia, meanPistonSpeed, sweptVolumeM3 } from "./geometry.ts";
import { chargeAirTempC, engineLimits, steadyBoostBar, superchargerPowerKw } from "./subsystems.ts";
import type { EngineConfig } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export interface Model {
  cfg: EngineConfig;
  fuel: "diesel" | "petrol";
  Vh: number;
  J: number;
  ve: VeParams;
  fr: FrictionParams;
  d: DieselConsts | null;
  p: PetrolConsts | null;
  charged: boolean;
  exhaustDriven: boolean;
  supercharged: boolean;
  /** Rated rpm used for scaling (≈ power peak estimate). */
  nRated: number;
  /** Rated air mass flow [kg/s] for flow-dependent pressure drops. */
  mDotAirRated: number;
  /** Petrol throttle: a = φ·A0/(ηL·n) (dimensionless, see airpath.steadyManifoldRatio). */
  throttleA0: number;
  /** Intake manifold volume [m³] (petrol.md §3.3: 1.0 … 1.5·Vh, ITB 0.2·Vh). */
  VMan: number;
  /** Compressor choke mass flow [kg/s] (diesel.md §3.9: 140 kg/(s·m²)·π/4·D²), Infinity without exhaust turbo. */
  chokeKgS: number;
  /** ECU peak pressure protection [bar] (diesel.md §3.2 mFuelTorqueLimit). */
  pMaxProtect: number;
  /** Lazily filled full-load table (100 rpm grid) for load and λ strategy. */
  fullTorque: Float64Array | null;
  fullAir: Float64Array | null;
  /** ECU torque limit [Nm] (issue #18), +Infinity when the config has none. */
  torqueLimitNm: number;
  /** Per table row: diesel fuel quantity cap [kg/cycle], petrol manifold pressure cap [kPa abs]; +Infinity = limit inactive. */
  capFuel: Float64Array | null;
  capPMan: Float64Array | null;
}

const isExhaust = (a: EngineConfig["induction"]["aspiration"]) =>
  a === "turbo" || a === "twin-turbo-parallel" || a === "twin-turbo-sequential" || a === "e-turbo";

const modelCache = new WeakMap<EngineConfig, Model>();

/** Precomputes everything that depends only on the config (configs are treated as immutable). */
export function getModel(cfg: EngineConfig): Model {
  let m = modelCache.get(cfg);
  if (m) return m;
  const Vh = sweptVolumeM3(cfg);
  const fuel = cfg.fuel;
  const asp = cfg.induction.aspiration;
  const charged = asp !== "naturally-aspirated" && cfg.induction.boostTargetBar > 0;
  const ve = veParams(cfg);
  const nRated = Math.max(1000, 0.85 * cfg.revLimitRpm);
  const TStd = 303;
  const boost = charged ? cfg.induction.boostTargetBar : 0;
  const rhoRated = ((101.325 + 100 * boost) * 1000) / (R_AIR * (charged ? 320 : TStd));
  const veRated = volumetricEfficiency(ve, nRated, TStd);
  const mDotAirRated = Math.max(1e-4, veRated * rhoRated * Vh * (nRated / 120));
  // petrol.md §3.3: kTh so that pMan/pUp ≈ 0.97 at full pedal and rated rpm
  const aRated = 0.97 / throttlePsi(0.97);
  const throttleA0 = aRated * veRated * nRated;
  m = {
    cfg, fuel, Vh, J: crankInertia(cfg), ve, fr: frictionParams(cfg),
    d: fuel === "diesel" ? dieselConsts(cfg) : null,
    p: fuel === "petrol" ? petrolConsts(cfg) : null,
    charged, exhaustDriven: charged && isExhaust(asp),
    supercharged: charged && (asp === "supercharger-roots" || asp === "supercharger-centrifugal"),
    nRated, mDotAirRated, throttleA0,
    VMan: (cfg.induction.individualThrottleBodies && fuel === "petrol" ? 0.2 : 1.2) * Vh,
    pMaxProtect: engineLimits(cfg).peakPressureMaxBar / 0.95,
    chokeKgS: charged && isExhaust(asp)
      ? 140 * (Math.PI / 4) * (Math.max(15, cfg.induction.compressorInducerMm) / 1000) ** 2 * (asp === "twin-turbo-sequential" ? 1.5 : 1)
      : Number.POSITIVE_INFINITY,
    fullTorque: null, fullAir: null,
    torqueLimitNm: cfg.ecuTorqueLimitNm !== undefined && Number.isFinite(cfg.ecuTorqueLimitNm) && cfg.ecuTorqueLimitNm > 0
      ? cfg.ecuTorqueLimitNm
      : Number.POSITIVE_INFINITY,
    capFuel: null, capPMan: null,
  };
  if (m.d) {
    // diesel.md §3.2c: capacity ∝ √Δp · injection window (35 °CA → time ∝ 1/n). Calibration decision [S, PR]:
    // at the system's reference pressure the capacity equals the smoke-limited quantity at the end of the
    // torque plateau n_c = 0.55·revLimit (reference engines: N57 3000/5400, OM654 2400/4800, 6BT 1600/2800).
    // Above n_c the fuel per cycle falls (∝ n^−0.73, see injectionCapacity), which gives the typical diesel torque drop towards rated power.
    // Lower injection pressure than the reference → proportionally less capacity (e.g. 6BT at 1000 bar).
    const nC = Math.max(800, 0.55 * cfg.revLimitRpm);
    const mAirCyc = volumetricEfficiency(ve, nC, 320) * rhoRated * Vh;
    m.d.nC = nC;
    m.d.kInj = smokeLimitFuel(m.d, mAirCyc) / Math.sqrt(m.d.sys.pInjRef);
  }
  modelCache.set(cfg, m);
  return m;
}

export interface OpPoint {
  rpm: number;
  /** Intake manifold pressure abs [kPa]. */
  pManKpa: number;
  /** Charge temperature in the manifold [K]. */
  TManK: number;
  ambientKpa: number;
  TambK: number;
  /** Charger boost (gauge) [bar]; petrol: pressure upstream of the throttle. */
  boostBar: number;
  /** Diesel: fuel command 0 … 1 as fraction of the full-load quantity. */
  fuelCmd: number;
  /** Petrol: relative air charge 0 … 1 for the λ strategy. */
  relLoad: number;
  knockRetardDeg: number;
  coolantC: number;
  oilC: number;
  egrRate: number;
  /** Combustion possible (ignition, compression ignition condition, not destroyed). */
  combust: boolean;
  /** Fuel cut (limiter, overrun). */
  fuelCut: boolean;
  /** Load of the previous step (backpressure and EGT estimates). */
  loadPrev: number;
  /** Starter is cranking: extra compression losses (diesel.md §3.11). */
  cranking: boolean;
  /** Diesel: ECU quantity cap from the torque limit [kg/cycle] (issue #18), +Infinity = none. */
  fuelCapKg: number;
  /** Petrol overrun afterfire (issue #16): fuel injected in overrun as share of the stoichiometric idle-air quantity, 0 = off. */
  afterfireFuel: number;
}

export interface CycleOut {
  mAirCyc: number;
  airMassFlowKgS: number;
  mFuelCyc: number;
  fuelMassFlowGS: number;
  lambda: number;
  imepBar: number;
  pmepBar: number;
  fmepBar: number;
  bmepBar: number;
  torqueNm: number;
  peakPressureBar: number;
  egtC: number;
  smoke: number;
  knock: number;
  knockMargin: number;
  heatToCoolantKw: number;
  exhaustMassFlowKgS: number;
  /** Diesel: full-load fuel quantity at this point [kg/cycle]. */
  mFuelFull: number;
  /** Diesel: full-load quantity before the governor ramp [kg/cycle] (reference for the boost request). */
  mFuelMax: number;
  fuelLhv: number;
  fuelDensity: number;
}

export function newOpPoint(): OpPoint {
  return {
    rpm: 0, pManKpa: 101.325, TManK: 293, ambientKpa: 101.325, TambK: 293.15, boostBar: 0, fuelCmd: 0, relLoad: 0,
    knockRetardDeg: 0, coolantC: 90, oilC: 90, egrRate: 0, combust: true, fuelCut: false, loadPrev: 1, cranking: false,
    fuelCapKg: Number.POSITIVE_INFINITY, afterfireFuel: 0,
  };
}

/** Exhaust backpressure before turbine/silencer [kPa abs] (diesel.md §3.4, petrol.md §3.7). */
function exhaustPressureKpa(m: Model, op: OpPoint, airFlow: number, pUpKpa: number): number {
  const rel = airFlow / m.mDotAirRated;
  const ex = m.cfg.exhaust;
  // silencer, catalyst, DPF: quadratic in flow [S, petrol.md §3.7: 15 kPa at rated, +5 kPa catalyst; OPF/DPF +5 kPa]
  const base = m.fuel === "petrol" ? 15 : 10;
  const manifold = { "cast-log": 1.0, "tubular-short": 0.9, "tubular-long": 0.8 }[ex.manifold];
  const dp = (base * manifold + (ex.catalyst ? 5 : 0) + (ex.particulateFilter ? 5 : 0) + (ex.scr ? 2 : 0)) * rel * rel;
  let p = op.ambientKpa + dp;
  if (m.exhaustDriven) {
    // diesel.md §3.4: p_exh ≈ p_int·(1.05 + 0.20·load) VTG, (1.10 + 0.25·load) wastegate; petrol.md §3.7: ×pBoostAbs,
    // higher for a small turbine A/R [S: ×(0.6/AR)^0.2]
    const vtg = m.cfg.induction.variableGeometry;
    const L = clamp(op.loadPrev, 0, 1);
    const f = (vtg ? 1.05 + 0.2 * L : 1.1 + 0.25 * L) * Math.pow(0.6 / clamp(m.cfg.induction.turbineAR, 0.3, 1.5), 0.2);
    p = Math.max(p, pUpKpa * f + dp * 0.5);
  } else if (m.fuel === "diesel") {
    p += 10 * (op.rpm / 4000) ** 2; // diesel.md §3.4 naturally aspirated: p1 + 0.1e5·(rpm/4000)²
  }
  return p;
}

/** Evaluates one mean-value cycle. */
export function evaluateCycle(m: Model, op: OpPoint): CycleOut {
  const n = Math.max(0, op.rpm);
  const Vh = m.Vh;
  const cyclesPerS = n / 120;
  const cm = meanPistonSpeed(m.cfg.block.strokeMm, n);
  const veEff = volumetricEfficiency(m.ve, Math.max(n, 50), op.TManK);
  const rho = (op.pManKpa * 1000) / (R_AIR * op.TManK);
  let mAirCyc = veEff * rho * Vh;
  const pUpKpa = op.ambientKpa + 100 * Math.max(0, op.boostBar);
  const pExhKpa = exhaustPressureKpa(m, op, mAirCyc * cyclesPerS, m.fuel === "diesel" ? op.pManKpa : pUpKpa);
  // diesel.md §3.1 residual gas correction: ve ·= 1 − 0.03·max(0, p_exh/p_int − 1)
  mAirCyc *= 1 - 0.03 * Math.max(0, pExhKpa / op.pManKpa - 1);
  let mFuelCyc = 0;
  let mFuelFull = 0;
  let mFuelMax = 0;
  let lambda = 99;
  let imep = 0;
  let peak = 0;
  let egtC = op.TManK - 273.15;
  let smoke = 0;
  let knock = 0;
  let margin = 99;
  let xWall = 0.25;
  let lhv: number;
  let density: number;
  let residual = 0;
  if (m.d) {
    const d = m.d;
    lhv = d.lhv;
    density = d.density;
    // diesel.md §3.1 EGR (part load only) displaces fresh air
    const mFresh = mAirCyc * (1 - op.egrRate);
    // diesel.md §3.2: full-load quantity = min(smoke limit, injection capacity, peak pressure protection) · governor
    let full = Math.min(smokeLimitFuel(d, mFresh), injectionCapacity(d, n));
    const pIntBar = op.pManKpa / 100;
    const pComp = pIntBar * d.eps ** 1.33;
    const piMax = m.pMaxProtect / (pComp * Math.max(0.5, 1 + 0.03 * d.fs.injectionTimingOffsetDeg));
    if (piMax > 1.05) full = Math.min(full, mFresh / (d.afr * (d.sys.piK / (piMax - 1))));
    mFuelMax = full;
    full *= governor(d, n);
    mFuelFull = full;
    mFuelCyc = op.combust && !op.fuelCut ? Math.min(clamp(op.fuelCmd, 0, 1) * full, op.fuelCapKg) : 0;
    const c = dieselCombustion(d, mFresh, mFuelCyc, Vh, pIntBar, op.TManK, op.coolantC, op.egrRate);
    lambda = c.lambda;
    imep = c.imepBar;
    peak = c.peakPressureBar;
    egtC = c.egtC;
    smoke = c.smoke;
    xWall = c.xWall;
    mAirCyc = mFresh;
  } else {
    const p = m.p!;
    lhv = p.lhv;
    density = p.density;
    // Residual gas (Heywood ch. 6 qualitatively; coefficients [S]): at low manifold pressure exhaust flows back
    // during valve overlap, displacing fresh charge and slowing combustion. Relative to WOT (pExh/pMan ≈ 1):
    // idle (≈ 4) loses ≈ 15 %; together with the accessory load and the idle spark reserve (simulator.ts) the
    // warm idle manifold pressure lands at ≈ 30 … 33 kPa (petrol.md §3.3: 30 … 40 kPa).
    const xr = 0.11 * (1 + 0.6 * m.cfg.head.camProfile) * Math.max(0, Math.sqrt(Math.max(1, pExhKpa / Math.max(5, op.pManKpa))) - 1.1);
    residual = Math.min(0.5, xr);
    mAirCyc *= 1 - 0.5 * residual;
    const lam = petrolLambda(p, op.relLoad, op.coolantC);
    if (op.combust && !op.fuelCut) {
      mFuelCyc = mAirCyc / (lam * p.afr);
      lambda = lam;
      margin = knockMargin(p, op.pManKpa, op.TManK - 273.15, op.coolantC, n, lam);
      knock = knockIntensity(margin, op.knockRetardDeg);
    }
    const c = petrolCombustion(p, n, mAirCyc, mFuelCyc, lam, Vh, op.knockRetardDeg, op.pManKpa, op.TManK - 273.15, op.relLoad);
    imep = c.imepBar * (1 - 0.5 * residual);
    peak = c.peakPressureBar;
    egtC = c.egtC;
    if (op.combust && op.fuelCut && op.afterfireFuel > 0 && mAirCyc > 0) {
      // Overrun afterfire, "pops & bangs" (issue #16) [S]: the ECU injects afterfireFuel × the stoichiometric
      // quantity of the (throttled) air charge and fires the spark ≈ 30 … 40 °CA after TDC. Combustion runs into
      // the exhaust stroke: ≈ 5 % of the ideal Otto work reaches the piston, ≈ 85 % of the heat is released in
      // the runner / manifold (energy balance ΔT = 0.85·ṁF·Hu / (ṁ·cp), cp ≈ 1.2 kJ/(kg·K) as petrol.md §3.10),
      // the rest oxidises later in the catalyst (simulator.ts catalyst temperature).
      mFuelCyc = (op.afterfireFuel * mAirCyc) / p.afr;
      lambda = 1 / op.afterfireFuel;
      imep = (0.05 * p.etaOtto * mFuelCyc * p.lhv) / Vh / 1e5;
      egtC += (0.85 * mFuelCyc * p.lhv) / ((mAirCyc + mFuelCyc) * 1200);
    }
  }
  // pumping losses (diesel.md §3.4 / petrol.md §3.7), positive = loss
  let pmep: number;
  if (m.fuel === "diesel") pmep = Math.max(0, (pExhKpa - op.pManKpa) / 100) + 0.1 * (n / 4000) ** 2;
  else pmep = (pExhKpa - op.pManKpa) / 100;
  // cranking: compression losses of the dragged engine (diesel.md §3.11: + 0.3·pComp/40 bar)
  if (op.cranking && mFuelCyc === 0) pmep += (0.3 * ((op.pManKpa / 100) * m.cfg.block.compressionRatio ** 1.3)) / 40;
  // Accessories (review #17 B3) [S]: alternator with base electrical load (ECU, fuel pump, fans ≈ 50 A,
  // η ≈ 0.55 → ≈ 1.4 kW) plus a small speed-dependent share; water and oil pump are already part of the
  // Chen-Flynn constants (petrol.md §3.8), A/C off. Expressed as an fmep share; the torque is capped below
  // 0.5·idle so cranking stays possible.
  const nAcc = Math.max(n, 0.5 * m.cfg.idleRpm);
  const pAccW = 1400 + 20 * (Vh * 1000) * (nAcc / 1000);
  const fmep = fmepBar(m.fr, peak, cm, op.oilC) + (pAccW * 120) / (Vh * nAcc) / 1e5;
  const bmep = imep - fmep - pmep;
  let torque = (bmep * 1e5 * Vh) / (4 * Math.PI);
  // supercharger drive power (petrol.md §3.12, PR #12 superchargerPowerKw)
  if (m.supercharged && n > 1) torque -= (superchargerPowerKw(m.cfg, n, op.boostBar) * 1000) / ((n * Math.PI) / 30);
  const fuelMassFlowGS = mFuelCyc * cyclesPerS * 1000;
  const pFuelW = mFuelCyc * lhv * cyclesPerS;
  const pFricW = fmep * 1e5 * Vh * cyclesPerS;
  // heat into the coolant (diesel.md §3.10: xWall·P_fuel + ½·P_fric; petrol.md §3.10: 0.25 … 0.35·P_fuel)
  const wallShare = m.fuel === "diesel" ? xWall : 0.25 + 0.1 * (1 - clamp(op.relLoad, 0, 1));
  // petrol.md §3.10 gives the total (incl. friction) as a share of the fuel power → no extra friction term
  const heatToCoolantKw = (wallShare * pFuelW + (m.fuel === "diesel" ? 0.5 * pFricW : 0)) / 1000;
  return {
    mAirCyc, airMassFlowKgS: mAirCyc * cyclesPerS, mFuelCyc, fuelMassFlowGS, lambda, imepBar: imep, pmepBar: pmep,
    fmepBar: fmep, bmepBar: bmep, torqueNm: torque, peakPressureBar: peak, egtC, smoke, knock, knockMargin: margin,
    heatToCoolantKw, exhaustMassFlowKgS: (mAirCyc + mFuelCyc) * cyclesPerS, mFuelFull, mFuelMax, fuelLhv: lhv, fuelDensity: density,
  };
}

/**
 * Pressure after the compressor, limited by the compressor choke line (diesel.md §3.9 "Stopfgrenze"):
 * the charger cannot pass more than ṁ_choke, so above it the deliverable pressure falls with rpm.
 */
export function chokeLimitedUpKpa(m: Model, pUpKpa: number, rpm: number, TManK: number, ambientKpa: number): number {
  if (!Number.isFinite(m.chokeKgS) || rpm < 100) return pUpKpa;
  const veEff = volumetricEfficiency(m.ve, rpm, TManK);
  const flow = (veEff * ((pUpKpa * 1000) / (R_AIR * TManK)) * m.Vh * rpm) / 120;
  // approaching choke the compressor efficiency collapses (diesel.md §3.9: "fällt etaC rapide → T2 steigt"),
  // modelled as a density/pressure loss of up to 8 % between 0.9 and 1.0·ṁ_choke [S]
  const r = flow / m.chokeKgS;
  if (r <= 0.9) return pUpKpa;
  const eff = 1 - 0.8 * Math.min(0.1, r - 0.9);
  const p = pUpKpa * eff;
  return Math.max(ambientKpa, r * eff > 1 ? p / (r * eff) : p);
}

/** Charge temperature in the manifold [K]: compressor + intercooler (PR #12) + manifold pick-up (petrol.md §3.2c). */
export function manifoldTempK(m: Model, boostBar: number, ambientC: number): number {
  const t = m.charged ? chargeAirTempC(m.cfg, boostBar, ambientC) + 5 : ambientC + 10;
  return t + 273.15;
}

/** Petrol throttle parameter a = φ·A0/(ηL·n) for the steady manifold ratio (petrol.md §3.3). */
export function throttleA(m: Model, phi: number, rpm: number, TManK: number): number {
  const veEff = volumetricEfficiency(m.ve, Math.max(rpm, 50), TManK);
  return (phi * m.throttleA0) / (veEff * Math.max(rpm, 50));
}

export interface SteadyPoint {
  out: CycleOut;
  boostBar: number;
  pManKpa: number;
  knockRetardDeg: number;
  /** ECU torque limit active at this point (issue #18). */
  limited: boolean;
  /** Diesel quantity cap [kg/cycle] / petrol manifold pressure cap [kPa abs] that holds the limit; +Infinity if inactive. */
  fuelCapKg: number;
  pManCapKpa: number;
}

/**
 * Steady full-load point at `rpm` (dyno sweep): fixed point between boost, exhaust flow and EGT
 * (PR #12 steadyBoostBar), petrol throttle wide open (petrol.md §3.3 Fixpunkt), knock control settled
 * (petrol.md §3.6), warm engine (coolant/oil 90 °C).
 */
export function steadyFullLoad(m: Model, rpm: number, ambientC = 20, ambientKpa = 101.325): SteadyPoint {
  const op = newOpPoint();
  op.rpm = rpm;
  op.ambientKpa = ambientKpa;
  op.TambK = ambientC + 273.15;
  op.fuelCmd = 1;
  op.relLoad = 1;
  op.loadPrev = 1;
  let boost = m.charged ? m.cfg.induction.boostTargetBar * 0.5 : 0;
  let out!: CycleOut;
  let retard = 0;
  let pMan = ambientKpa;
  for (let it = 0; it < 8; it++) {
    const TManK = manifoldTempK(m, boost, ambientC);
    op.TManK = TManK;
    op.boostBar = boost;
    const cut = knockBoostCutBar(m, retard);
    const pUp = chokeLimitedUpKpa(m, ambientKpa - 2 + 100 * Math.max(0, boost - cut), rpm, TManK, ambientKpa); // air filter ≈ 2 kPa (diesel.md §3.1)
    if (m.fuel === "petrol") pMan = pUp * steadyManifoldRatio(throttleA(m, 1, rpm, TManK), 1);
    else pMan = pUp;
    op.pManKpa = pMan;
    op.knockRetardDeg = retard;
    out = evaluateCycle(m, op);
    if (m.p) {
      // steady knock control (petrol.md §3.6): retard until margin 0, max 15 °CA
      // knock retard counted from the current retard: margin already includes it via knockIntensity only
      const need = Math.min(m.p.maxRetard, Math.max(0, -out.knockMargin / 0.8));
      if (Math.abs(need - retard) > 0.05) {
        retard = need;
        op.knockRetardDeg = retard;
        out = evaluateCycle(m, op);
      }
    }
    if (!m.charged) break;
    const nb = steadyBoostBar(m.cfg, rpm, out.exhaustMassFlowKgS, out.egtC, ambientKpa);
    const cutChanged = Math.abs(knockBoostCutBar(m, retard) - cut) > 0.002;
    if (Math.abs(nb - boost) < 0.002 && !cutChanged) {
      boost = nb;
      break;
    }
    boost = 0.5 * (boost + nb);
  }
  const res: SteadyPoint = { out, boostBar: boost, pManKpa: pMan, knockRetardDeg: retard, limited: false, fuelCapKg: Infinity, pManCapKpa: Infinity };
  if (out.torqueNm > m.torqueLimitNm) applyTorqueLimit(m, op, res, ambientC, ambientKpa);
  return res;
}

/**
 * ECU torque limit (issue #18, petrol.md §7 "ECU-Plateau"): modern ECUs hold the brake torque at a calibrated
 * maximum (gearbox protection) by requesting less instead of cutting: the diesel ECU limits the injected quantity
 * (diesel.md §3.2 "mFuelTorqueLimit"), the petrol turbo ECU lowers the boost target (wastegate opens) and, below
 * ambient pressure, closes the throttle (petrol.md §3.3). Solved by bisection on the quantity / manifold
 * pressure so that the steady brake torque equals the limit; knock control settles at each trial point.
 */
function applyTorqueLimit(m: Model, op: OpPoint, res: SteadyPoint, ambientC: number, ambientKpa: number) {
  const lim = m.torqueLimitNm;
  let out = res.out;
  if (m.d) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      op.fuelCmd = 0.5 * (lo + hi);
      if (evaluateCycle(m, op).torqueNm > lim) hi = op.fuelCmd;
      else lo = op.fuelCmd;
    }
    op.fuelCmd = lo;
    out = evaluateCycle(m, op);
    op.fuelCmd = 1;
    res.fuelCapKg = out.mFuelCyc;
  } else {
    const p = m.p!;
    const ratio = res.pManKpa / Math.max(1, ambientKpa - 2 + 100 * Math.max(0, res.boostBar));
    let lo = 0.2 * ambientKpa;
    let hi = res.pManKpa;
    let retard = res.knockRetardDeg;
    const at = (pMan: number) => {
      // boost that the wastegate has to hold for this manifold pressure (throttle stays at its WOT ratio)
      const boost = m.charged ? clamp((pMan / Math.max(0.5, ratio) - ambientKpa + 2) / 100, 0, res.boostBar) : 0;
      op.boostBar = boost;
      op.TManK = manifoldTempK(m, boost, ambientC);
      op.pManKpa = pMan;
      op.knockRetardDeg = retard;
      let o = evaluateCycle(m, op);
      const need = Math.min(p.maxRetard, Math.max(0, -o.knockMargin / 0.8));
      if (Math.abs(need - retard) > 0.05) {
        retard = need;
        op.knockRetardDeg = retard;
        o = evaluateCycle(m, op);
      }
      return { o, boost };
    };
    for (let i = 0; i < 30; i++) {
      const mid = 0.5 * (lo + hi);
      if (at(mid).o.torqueNm > lim) hi = mid;
      else lo = mid;
    }
    const r = at(lo);
    out = r.o;
    res.boostBar = r.boost;
    res.pManKpa = lo;
    res.knockRetardDeg = retard;
    res.pManCapKpa = lo;
  }
  res.out = out;
  res.limited = true;
}

/**
 * Boost reduction of the knock control for charged petrol engines (petrol.md §3.6: "Regel-Rücknahme
 * (Ladedruck −) bei Turbo, wenn knockRetardDeg > 10"). Rate 0.03 bar per degree above 10 °CA [S], so at the
 * 15 °CA end stop the ECU takes 0.15 bar off.
 */
export function knockBoostCutBar(m: Model, retardDeg: number): number {
  if (!m.p || !m.charged) return 0;
  return 0.03 * Math.max(0, retardDeg - 10);
}

/** Full-load torque [Nm] and air charge [kg/cycle] at rpm (100 rpm table, filled on first use). */
export function fullLoadAt(m: Model, rpm: number): { torque: number; air: number } {
  if (!m.fullTorque || !m.fullAir) {
    const nMax = Math.ceil((m.cfg.revLimitRpm * 1.3) / 100) + 1;
    m.fullTorque = new Float64Array(nMax);
    m.fullAir = new Float64Array(nMax);
    m.capFuel = new Float64Array(nMax);
    m.capPMan = new Float64Array(nMax);
    for (let i = 0; i < nMax; i++) {
      const sp = steadyFullLoad(m, Math.max(300, i * 100));
      m.fullTorque[i] = Math.max(1, sp.out.torqueNm);
      m.fullAir[i] = Math.max(1e-7, sp.out.mAirCyc);
      m.capFuel[i] = sp.fuelCapKg;
      m.capPMan[i] = sp.pManCapKpa;
    }
  }
  const x = clamp(rpm / 100, 0, m.fullTorque.length - 1.001);
  const i = Math.floor(x);
  const f = x - i;
  return {
    torque: m.fullTorque[i]! * (1 - f) + m.fullTorque[i + 1]! * f,
    air: m.fullAir[i]! * (1 - f) + m.fullAir[i + 1]! * f,
  };
}

/**
 * ECU torque limit caps at rpm (issue #18): diesel quantity [kg/cycle] and petrol manifold pressure [kPa abs],
 * interpolated from the full-load table (+Infinity where the limit is inactive; the smaller neighbour wins at the edge).
 */
// Interpolation: caps are linear between the 100 rpm grid points. At the edge of the limited band one neighbour is
// +Infinity (limit inactive there); then the smaller (finite) cap is used for the whole interval, so the ECU never
// lets torque overshoot the limit inside the 100 rpm step (conservative by at most one grid step, < 1 % torque).
// Caps come from the steady warm full-load point (90 °C, 20 °C ambient); in transients with less boost the
// quantity cap stays above the smoke limit, so the limit only acts where the steady torque would exceed it.
export function torqueLimitCaps(m: Model, rpm: number): { fuelKg: number; pManKpa: number } {
  if (!Number.isFinite(m.torqueLimitNm)) return { fuelKg: Infinity, pManKpa: Infinity };
  fullLoadAt(m, rpm);
  const a = m.capFuel!;
  const b = m.capPMan!;
  const x = clamp(rpm / 100, 0, a.length - 1.001);
  const i = Math.floor(x);
  const f = x - i;
  const lerp = (t: Float64Array) => {
    const u = t[i]!;
    const v = t[i + 1]!;
    if (!Number.isFinite(u) || !Number.isFinite(v)) return Math.min(u, v);
    return u * (1 - f) + v * f;
  };
  return { fuelKg: lerp(a), pManKpa: lerp(b) };
}
