/**
 * Mechanical and thermal limits, warnings, wear and fatal damage.
 *
 * Specification: docs/research/diesel.md §4 (4.1 … 4.7) and docs/research/petrol.md §4.
 * Principle (diesel.md §4): warning from the first threshold, critical from the second; wear accumulates
 * above the warning threshold; fatal at the third threshold or when a critical condition persists longer
 * than its hold time. Short excursions are tolerated: exceedance timers integrate while the condition
 * holds and decay at twice the rate otherwise, and warning levels have a small hysteresis band.
 *
 * Deliberate deviations from the spec (documented in the PR):
 * - Petrol piston peak-pressure limits 130 / 155 / 170 bar (cast / forged / steel) instead of 110 / 140:
 *   petrol.md §4 itself states modern turbo-DI series engines run 130 … 140 bar on cast pistons, and the
 *   EA888 reference engine would otherwise warn at stock full load.
 * - Petrol conrod inertia uses 0.6 × the diesel oscillating mass (no deep combustion bowl, shorter
 *   compression height), otherwise the K20A/F136 reference engines exceed the rod limit at their limiter.
 *
 * Pure functions apart from the exceedance timers, which live in an explicit `LimitTracker`. When the
 * caller does not pass one, a tracker is kept per config object (WeakMap) and reset when `s.t` goes back.
 * No DOM.
 */
import type { DamageEvent, EngineConfig, EngineState, Severity, Warning, WarningCode } from "./types.ts";
import { chargeAirTempC, turboMaxRpm } from "./turbo.ts";

// ------------------------------------------------------------------------------------------- thresholds

export interface Band {
  warning: number;
  critical: number;
  fatal: number;
}

export interface LimitThresholds {
  /** Mean piston speed, m/s (diesel.md §4.1, petrol.md §4 table). */
  pistonSpeed: Band;
  /** Valve float onset, rpm (diesel.md §4.1, petrol.md §4). */
  valveFloatRpm: number;
  /** Permissible peak cylinder pressure, bar (diesel.md §4.2, petrol.md §4). */
  peakPressureDesignBar: number;
  /** Factor on peakPressureDesignBar that destroys the engine instantly. */
  peakPressureFatalFactor: number;
  /** Conrod tensile limit (inertia force), N (diesel.md §4.2, petrol.md §4 conrod-stress). */
  conrodLimitN: number;
  egtC: Band;
  coolantC: Band;
  oilC: Band;
  /** Hold time above the fatal temperature, s. */
  coolantHoldS: number;
  oilHoldS: number;
  /** Max permissible charger shaft speed, rpm (0 = no charger). */
  turboShaftMaxRpm: number;
  /** Boost above target that counts as overboost, bar (diesel.md §4.4, petrol.md §4). */
  overboostMarginBar: number;
}

const DIESEL_PEAK_BLOCK = { aluminium: 190, "cast-iron": 210, "compacted-graphite-iron": 250 } as const;
const DIESEL_PEAK_PISTON = { "cast-aluminium": 190, "forged-aluminium": 215, steel: 260 } as const;
const DIESEL_PEAK_ROD = { "cast-steel": 180, "forged-steel": 220, titanium: 240 } as const;
const PETROL_PEAK_PISTON = { "cast-aluminium": 130, "forged-aluminium": 155, steel: 170 } as const;

/** Valve float onset, rpm. Diesel: diesel.md §4.1; petrol: petrol.md §4 "Ventilflattern". */
export function valveFloatRpm(cfg: EngineConfig): number {
  const { valvetrain, valvesPerCylinder, camProfile } = cfg.head;
  const cam = Math.min(1, Math.max(0, camProfile));
  if (cfg.fuel === "diesel") return 5600 * (valvetrain === "ohv" ? 0.85 : 1) * (1 + 0.1 * cam);
  const base = { ohv: 6600, sohc: 7400, dohc: 8200 }[valvetrain];
  return base * (valvesPerCylinder >= 4 ? 1.08 : 1) * (1 + 0.1 * cam) * Math.sqrt(86 / Math.max(40, cfg.block.boreMm));
}

function pistonSpeedBand(cfg: EngineConfig): Band {
  const { crankshaft, pistons, conrods, boreMm } = cfg.block;
  if (cfg.fuel === "diesel") {
    // diesel.md §4.1: Pkw 15/17/19, Nfz (> 100 mm bore) 12/14/16, times material modifiers.
    const base = boreMm > 100 ? [12, 14, 16] : [15, 17, 19];
    const f =
      { "cast-steel": 0.92, "forged-steel": 1.0, titanium: 1.1 }[conrods] *
      { "cast-aluminium": 1.0, "forged-aluminium": 1.05, steel: 0.95 }[pistons] *
      { cast: 0.92, forged: 1.0, billet: 1.05 }[crankshaft];
    return { warning: base[0]! * f, critical: base[1]! * f, fatal: base[2]! * f };
  }
  // petrol.md §4: three equipment tiers.
  if (conrods === "titanium" && pistons === "forged-aluminium" && crankshaft !== "cast") return { warning: 24, critical: 26, fatal: 28 };
  const forgedAny = crankshaft !== "cast" || pistons !== "cast-aluminium" || conrods !== "cast-steel";
  return forgedAny ? { warning: 22, critical: 24.5, fatal: 26.5 } : { warning: 19, critical: 21, fatal: 23 };
}

function peakPressureDesign(cfg: EngineConfig): number {
  const { blockMaterial, pistons, conrods, boreMm } = cfg.block;
  if (cfg.fuel === "diesel") {
    // diesel.md §4.2: minimum of block, piston, rod; head/gasket bore correction above 82 mm.
    let p = Math.min(DIESEL_PEAK_BLOCK[blockMaterial], DIESEL_PEAK_PISTON[pistons], DIESEL_PEAK_ROD[conrods]);
    if (boreMm > 82) p *= Math.sqrt(82 / boreMm);
    return p;
  }
  // petrol.md §4: piston limit, cast-iron block +10 %; weak cast rods −10 % [S].
  let p = PETROL_PEAK_PISTON[pistons] * (blockMaterial === "aluminium" ? 1 : 1.1);
  if (conrods === "cast-steel") p *= 0.9;
  return p;
}

function conrodLimitN(cfg: EngineConfig): number {
  // diesel.md §4.2: forged-steel ≈ 35 kN·(bore/82)²; petrol.md §4: factor 1.0 / 1.15 / 1.3 by material.
  const mat = { "cast-steel": 0.85, "forged-steel": 1.0, titanium: 1.3 }[cfg.block.conrods];
  const crank = { cast: 0.95, forged: 1.0, billet: 1.15 }[cfg.block.crankshaft];
  return 35000 * (cfg.block.boreMm / 82) ** 2 * mat * crank;
}

/** Oscillating inertia force at TDC of the gas exchange, N: F = m_osc·r·ω²·(1 + r/l) (diesel.md §4.2). */
export function conrodInertiaForceN(cfg: EngineConfig, rpm: number): number {
  const { boreMm, strokeMm, conrodLengthMm, pistons } = cfg.block;
  let m = 0.9 * (boreMm / 82) ** 2.2 * (pistons === "steel" ? 1.25 : 1);
  if (cfg.fuel === "petrol") m *= 0.6; // see header: lighter petrol pistons [S]
  if (pistons === "forged-aluminium") m *= 0.95;
  if (cfg.block.conrods === "titanium") m *= 0.9;
  const r = strokeMm / 2000;
  const omega = (rpm * Math.PI) / 30;
  return m * r * omega * omega * (1 + r / Math.max(1e-3, conrodLengthMm / 1000));
}

function egtBand(cfg: EngineConfig): Band {
  const charged = isTurbo(cfg);
  if (cfg.fuel === "diesel") {
    // diesel.md §4.3; steel pistons survive up to 1000 °C, the turbine limit (950) stays.
    const fatal = cfg.block.pistons === "steel" && !charged ? 1000 : 950;
    return { warning: 800, critical: 850, fatal };
  }
  // petrol.md §4 "Abgastemperatur": Ni-Resist turbine 950/1000/1050; petrol VTG max 950 (petrol.md §1).
  if (charged && cfg.induction.variableGeometry) return { warning: 900, critical: 950, fatal: 1000 };
  if (charged) return { warning: 950, critical: 1000, fatal: 1050 };
  return { warning: 950, critical: 1020, fatal: 1050 };
}

export function limitThresholds(cfg: EngineConfig): LimitThresholds {
  const diesel = cfg.fuel === "diesel";
  return {
    pistonSpeed: pistonSpeedBand(cfg),
    valveFloatRpm: valveFloatRpm(cfg),
    peakPressureDesignBar: peakPressureDesign(cfg),
    peakPressureFatalFactor: diesel ? 1.25 : 1.15,
    conrodLimitN: conrodLimitN(cfg),
    egtC: egtBand(cfg),
    // diesel.md §4.5 / petrol.md §4 "Überhitzung"
    coolantC: diesel ? { warning: 108, critical: 118, fatal: 130 } : { warning: 110, critical: 120, fatal: 130 },
    oilC: diesel ? { warning: 135, critical: 150, fatal: 165 } : { warning: 130, critical: 145, fatal: 155 },
    coolantHoldS: diesel ? 20 : 10,
    oilHoldS: 20,
    turboShaftMaxRpm: turboMaxRpm(cfg),
    overboostMarginBar: 0.3,
  };
}

function isCharged(cfg: EngineConfig): boolean {
  return cfg.induction.aspiration !== "naturally-aspirated" && cfg.induction.boostTargetBar > 0;
}

function isTurbo(cfg: EngineConfig): boolean {
  const a = cfg.induction.aspiration;
  return a === "turbo" || a === "twin-turbo-parallel" || a === "twin-turbo-sequential" || a === "e-turbo";
}

const VALVE_FLOAT_CRITICAL = 1.06;

/** Mechanically safe max rpm: min(piston-speed critical, valve-float critical, conrod limit) (diesel.md §4.1). */
export function safeMaxRpm(cfg: EngineConfig): number {
  const th = limitThresholds(cfg);
  const byPistonSpeed = (30 * th.pistonSpeed.critical) / (Math.max(1, cfg.block.strokeMm) / 1000);
  // Conrod inertia: F ∝ n², so n_crit = n_ref·√(F_limit/F(n_ref)).
  const byConrod = 6000 * Math.sqrt(th.conrodLimitN / Math.max(1, conrodInertiaForceN(cfg, 6000)));
  return Math.min(byPistonSpeed, VALVE_FLOAT_CRITICAL * th.valveFloatRpm, byConrod);
}

/**
 * Limit values for the UI gauges (issue #9). Every value is the **onset of the warning range** (start of the
 * yellow zone), so the UI and evaluateLimits() agree. Oil pressure: minimum permissible pressure at idle.
 */
export function engineLimits(cfg: EngineConfig): {
  coolantMaxC: number;
  oilMaxC: number;
  egtMaxC: number;
  oilPressureMinBar: number;
  boostMaxBar: number;
  peakPressureMaxBar: number;
  turboMaxRpm: number;
  meanPistonSpeedMaxMs: number;
} {
  const th = limitThresholds(cfg);
  return {
    coolantMaxC: th.coolantC.warning,
    oilMaxC: th.oilC.warning,
    egtMaxC: th.egtC.warning,
    oilPressureMinBar: 0.5,
    boostMaxBar: isCharged(cfg) ? cfg.induction.boostTargetBar + th.overboostMarginBar : 0,
    peakPressureMaxBar: 0.95 * th.peakPressureDesignBar,
    turboMaxRpm: th.turboShaftMaxRpm * (cfg.fuel === "diesel" ? 0.92 : 0.95),
    meanPistonSpeedMaxMs: th.pistonSpeed.warning,
  };
}

// --------------------------------------------------------------------- static full-load estimate

/** Rough rated-point estimate from the config alone (spec formulas, no simulator). Used for reliability. */
export interface FullLoadEstimate {
  ratedRpm: number;
  bmepBar: number;
  peakPressureBar: number;
  egtC: number;
  ratedPowerKw: number;
  specificPowerKwL: number;
  /** Petrol: RON margin at 2000 rpm full load (petrol.md §3.6), > 0 = knock free. Diesel: +∞. */
  knockMarginRon: number;
}

export function estimatedFullLoad(cfg: EngineConfig): FullLoadEstimate {
  const { boreMm, strokeMm, cylinders, compressionRatio } = cfg.block;
  const vl = ((Math.PI / 4) * (boreMm / 10) ** 2 * (strokeMm / 10) * cylinders) / 1000;
  const boost = isCharged(cfg) ? cfg.induction.boostTargetBar : 0;
  const pInt = 1.013 + boost; // bar abs
  const tIntC = chargeAirTempC(cfg, boost, 25);
  const fs = cfg.fuelSystem;
  let bmep: number;
  let peak: number;
  let egt: number;
  let knockMargin = Number.POSITIVE_INFINITY;
  let ratedRpm: number;
  if (fs.kind === "diesel") {
    ratedRpm = 0.82 * cfg.revLimitRpm;
    const lam = Math.max(1, fs.smokeLimitLambda);
    // diesel.md §3.3 table (piK, Gütegrad) and §3.6 peak pressure.
    const sys = { "common-rail": [0.7, 0.8], "unit-injector": [0.8, 0.78], "indirect-swirl-chamber": [0.4, 0.68], "indirect-prechamber": [0.35, 0.65] }[fs.injection];
    peak = pInt * compressionRatio ** 1.33 * (1 + sys[0]! / lam) * (1 + 0.03 * fs.injectionTimingOffsetDeg);
    const rho = (pInt * 1e5) / (287 * (tIntC + 273.15));
    const etaI = 0.59 * sys[1]!; // ≈ Seiliger 0.59 at ε 16, λ 1.3 (diesel.md §3.3 check)
    const imep = (etaI * 0.92 * rho * 42.6e6) / (14.5 * lam) / 1e5;
    bmep = imep - 1.8;
    // diesel.md §3.7 check 720 °C at λ 1.3 with intercooler; §2: +40 K per −0.1 λ; late SOI hotter.
    egt = 720 + 400 * (1.3 - lam) + (tIntC - 47) - 4 * fs.injectionTimingOffsetDeg;
  } else {
    ratedRpm = 0.9 * cfg.revLimitRpm;
    const lam = fs.fullLoadLambda;
    const imep = 13 * pInt ** 0.75; // NA ≈ 13 bar; EA888 2.3 bar abs ≈ 24 bar (petrol.md §3.9/§3.11)
    bmep = imep - 2;
    peak = pInt * compressionRatio ** 1.3 + 3.6 * imep * (1 + 0.03 * fs.ignitionAdvanceOffsetDeg); // petrol.md §3.11
    egt = 950 - 600 * Math.max(0, 1 - lam) + 6 * Math.max(0, -fs.ignitionAdvanceOffsetDeg) + (tIntC - 40); // petrol.md §3.10
    // petrol.md §3.6 at 2000 rpm (speed term 0), coolant 90 °C.
    let epsEff = compressionRatio;
    if (fs.mixture === "direct-injection" || fs.mixture === "dual-injection") epsEff -= 1;
    const ronReq =
      90 + 4 * (epsEff - 10) + 22 * Math.log(pInt) + 0.2 * (tIntC + 10 - 40) + 0.8 * fs.ignitionAdvanceOffsetDeg - 20 * Math.max(0, 1 - lam) + 0.15 * (boreMm - 86);
    const ronFuel = { ron91: 91, ron95: 95, ron98: 98, ron102: 102, e85: 105 }[fs.fuel] + (fs.fuel === "e85" && (fs.mixture === "direct-injection" || fs.mixture === "dual-injection") ? 2 : 0);
    knockMargin = ronFuel - ronReq;
  }
  const bmepRated = bmep * (cfg.fuel === "diesel" ? 0.8 : 0.9);
  const ratedPowerKw = (bmepRated * 1e5 * (vl / 1000) * ratedRpm) / 120 / 1000;
  return { ratedRpm, bmepBar: bmep, peakPressureBar: peak, egtC: egt, ratedPowerKw, specificPowerKwL: ratedPowerKw / vl, knockMarginRon: knockMargin };
}

// ------------------------------------------------------------------------------- runtime evaluation

/** Exceedance timers and active warning levels; one per running simulation. */
export interface LimitTracker {
  lastT: number;
  timers: Partial<Record<string, number>>;
  levels: Partial<Record<WarningCode, number>>;
}

export function createLimitTracker(): LimitTracker {
  return { lastT: Number.NaN, timers: {}, levels: {} };
}

const implicitTrackers = new WeakMap<EngineConfig, LimitTracker>();

/** Wear per second at warning / critical level [S]: ≈ 80 min resp. ≈ 8 min until worn out. */
const WEAR_WARNING = 2e-4;
const WEAR_CRITICAL = 2e-3;
/** Normal wear when running, per second at full load [S] (engine life ≈ 300 h in game terms). */
const WEAR_BASE = 1e-6;

type Level = 0 | 1 | 2;

/**
 * Evaluates all limits for the current state. Returns active warnings (German texts), the wear rate per
 * second (the simulator integrates `wear += wearRatePerS·dt`) and, if one occurred, the fatal damage event.
 */
export function evaluateLimits(
  cfg: EngineConfig,
  s: EngineState,
  tracker?: LimitTracker,
): { warnings: Warning[]; wearRatePerS: number; fatal?: DamageEvent } {
  let tr = tracker;
  if (!tr) {
    tr = implicitTrackers.get(cfg);
    if (!tr) {
      tr = createLimitTracker();
      implicitTrackers.set(cfg, tr);
    }
  }
  if (!(s.t >= tr.lastT)) {
    tr.timers = {};
    tr.levels = {};
    tr.lastT = s.t;
  }
  const dt = Math.min(0.5, Math.max(0, s.t - tr.lastT));
  tr.lastT = s.t;
  const T = tr;

  const th = limitThresholds(cfg);
  const warnings: Warning[] = [];
  let wear = s.running ? WEAR_BASE * (0.3 + Math.max(0, Math.min(1, s.load))) : 0;
  let fatal: DamageEvent | undefined;
  let worstWearCode: WarningCode = "conrod-stress";
  let worstWear = 0;

  /** Exceedance timer: integrates while `cond`, decays at 2× otherwise (tolerates brief spikes). */
  const timer = (key: string, cond: boolean): number => {
    const v = cond ? (T.timers[key] ?? 0) + dt : Math.max(0, (T.timers[key] ?? 0) - 2 * dt);
    T.timers[key] = v;
    return v;
  };
  /** Level with hysteresis: drop a level only when `value` is `hyst` below its threshold. */
  const level = (code: WarningCode, value: number, warnAt: number, critAt: number, hyst: number, higherIsWorse = true): Level => {
    const v = higherIsWorse ? value : -value;
    const w = higherIsWorse ? warnAt : -warnAt;
    const c = higherIsWorse ? critAt : -critAt;
    const prev = T.levels[code] ?? 0;
    let l: Level = v >= c ? 2 : v >= w ? 1 : 0;
    if (prev === 2 && l < 2 && v > c - hyst) l = 2;
    if (prev >= 1 && l < 1 && v > w - hyst) l = 1;
    T.levels[code] = l;
    return l;
  };
  const warn = (code: WarningCode, l: Level, message: string, wearScale = 1) => {
    if (l === 0) return;
    const severity: Severity = l === 2 ? "critical" : "warning";
    warnings.push({ code, severity, message });
    const w = (l === 2 ? WEAR_CRITICAL : WEAR_WARNING) * wearScale;
    wear += w;
    if (w > worstWear) {
      worstWear = w;
      worstWearCode = code;
    }
  };
  const kill = (code: WarningCode, message: string) => {
    if (!fatal) fatal = { code, t: s.t, message, fatal: true };
  };
  const f0 = (x: number) => Math.round(x).toLocaleString("de-DE");
  const f1 = (x: number) => x.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const rpm = Math.max(0, s.rpm);
  const turning = rpm > 50;

  // --- Drehzahl (petrol.md §4 "Drehzahl", diesel.md §4.6 "over-rev")
  const safe = safeMaxRpm(cfg);
  const overRevMargin = cfg.fuel === "diesel" ? 200 : 100;
  const lRev = level("over-rev", rpm, cfg.revLimitRpm + overRevMargin, safe, 50);
  warn("over-rev", lRev, lRev === 2 ? `Überdrehzahl: ${f0(rpm)} 1/min über der mechanischen Grenze (${f0(safe)} 1/min)` : `Drehzahl ${f0(rpm)} 1/min über dem Begrenzer`);
  if (timer("over-rev-fatal", rpm > 1.1 * safe) > 0.2) kill("over-rev", "Pleuelabriss durch Überdrehen: Ein Pleuel ist gerissen und hat den Block durchschlagen.");

  // --- Ventilflattern (diesel.md §4.1, petrol.md §4)
  const nf = th.valveFloatRpm;
  // Warning 0.95·n_float, fatal 1.08·n_float > 0.5 s (petrol.md §4); critical in between at 1.06 [S] so a
  // stock LS3 at its 6600 limiter ("Serienfedern am Limit") shows a warning, not a critical alarm.
  const lVf = level("valve-float", rpm, 0.95 * nf, VALVE_FLOAT_CRITICAL * nf, 50);
  warn("valve-float", lVf, lVf === 2 ? `Ventilflattern ab ${f0(nf)} 1/min: Ventile folgen dem Nocken nicht mehr` : `Drehzahl nahe der Ventilflattergrenze (${f0(nf)} 1/min)`);
  if (timer("valve-float-fatal", rpm > 1.08 * nf) > 0.5) kill("valve-float", "Ventil trifft Kolben: Durch Ventilflattern hat ein Ventil den Kolben berührt und ist abgerissen.");

  // --- Kolbengeschwindigkeit (diesel.md §4.1, petrol.md §4)
  const cm = s.meanPistonSpeedMs > 0 ? s.meanPistonSpeedMs : (2 * (cfg.block.strokeMm / 1000) * rpm) / 60;
  const ps = th.pistonSpeed;
  warn("piston-speed", level("piston-speed", cm, ps.warning, ps.critical, 0.3), `Mittlere Kolbengeschwindigkeit ${f1(cm)} m/s (Grenze ${f1(ps.critical)} m/s)`);
  if (timer("piston-speed-fatal", cm > ps.fatal) > (cfg.fuel === "diesel" ? 2 : 1)) {
    kill("conrod-stress", `Pleuelabriss: Bei ${f1(cm)} m/s Kolbengeschwindigkeit hat die Massenkraft das Pleuel zerrissen.`);
  }

  // --- Pleuel-Massenkraft (diesel.md §4.2, petrol.md §4 conrod-stress)
  const fRod = conrodInertiaForceN(cfg, rpm);
  const lRod = level("conrod-stress", fRod / th.conrodLimitN, 0.9, 1.0, 0.03);
  warn("conrod-stress", lRod, `Pleuelbelastung ${f0((fRod / th.conrodLimitN) * 100)} % der zulässigen Massenkraft`);
  if (timer("conrod-fatal", fRod > 1.15 * th.conrodLimitN) > 0.5) kill("conrod-stress", "Pleuelabriss: Die Massenkräfte haben das Pleuel überlastet.");

  // --- Spitzendruck (diesel.md §4.2, petrol.md §4)
  const pd = th.peakPressureDesignBar;
  const pk = s.peakPressureBar;
  const lPk = level("peak-pressure", pk, 0.95 * pd, 1.05 * pd, 2);
  warn("peak-pressure", lPk, `Spitzendruck ${f0(pk)} bar (zulässig ${f0(pd)} bar)`, lPk === 2 ? 1 : 2);
  const pkCritT = timer("peak-crit", pk > 1.05 * pd);
  if (timer("peak-fatal", pk > th.peakPressureFatalFactor * pd) > 0.1 || pkCritT > 10) {
    if (cfg.fuel === "petrol") kill("peak-pressure", "Zylinderkopfdichtung durchgebrannt und Kolben gebrochen: Der Spitzendruck war zu hoch.");
    else if (cfg.block.conrods === "cast-steel" || cfg.block.pistons === "steel") kill("conrod-stress", "Pleuel geknickt: Der Spitzendruck hat das Pleuel überlastet.");
    else kill("peak-pressure", "Kolbenschaden: Der Spitzendruck hat den Kolben gebrochen.");
  }

  // --- Abgastemperatur (diesel.md §4.3, petrol.md §4)
  const eb = th.egtC;
  warn("egt-high", level("egt-high", s.egtC, eb.warning, eb.critical, 10), `Abgastemperatur ${f0(s.egtC)} °C (Grenze ${f0(eb.critical)} °C)`);
  if (timer("egt-fatal", s.egtC > eb.fatal) > 5) {
    if (cfg.fuel === "diesel" && cfg.block.pistons !== "steel") kill("egt-high", "Kolbenschaden: Der Muldenrand des Kolbens ist durch die hohe Abgastemperatur angeschmolzen.");
    else if (isTurbo(cfg)) kill("egt-high", "Turboschaden: Das Turbinenrad ist durch die Abgastemperatur zerstört.");
    else kill("egt-high", "Auslassventil verbrannt: Die Abgastemperatur war zu lange zu hoch.");
  }

  // --- Kühlmittel (diesel.md §4.5, petrol.md §4)
  const cb = th.coolantC;
  warn("overheat-coolant", level("overheat-coolant", s.coolantC, cb.warning, cb.critical, 2), `Kühlmittel ${f0(s.coolantC)} °C – Motor überhitzt`);
  if (timer("coolant-fatal", s.coolantC > cb.fatal) > th.coolantHoldS) {
    kill("overheat-coolant", "Zylinderkopfdichtung durchgebrannt: Durch Überhitzung hat sich der Zylinderkopf verzogen.");
  }

  // --- Öltemperatur
  const ob = th.oilC;
  warn("overheat-oil", level("overheat-oil", s.oilC, ob.warning, ob.critical, 2), `Öltemperatur ${f0(s.oilC)} °C – Schmierfilm wird dünn`);
  if (timer("oil-fatal", s.oilC > ob.fatal) > th.oilHoldS) kill("overheat-oil", "Kolbenfresser: Das überhitzte Öl hat den Schmierfilm verloren, der Kolben hat sich festgefressen.");

  // --- Öldruck (diesel.md §4.5, petrol.md §4); only when the engine runs (cranking has no pressure yet)
  if (s.running && rpm > 400) {
    const p = s.oilPressureBar;
    let lOp: Level = 0;
    if (p < 0.5 && rpm > 1500) lOp = 2;
    else if (cfg.fuel === "petrol" && rpm > 3000 && p < 1.0) lOp = 2;
    else if (p < 0.5 || (rpm > 2000 && p < 1.0)) lOp = 1;
    T.levels["low-oil-pressure"] = lOp;
    warn("low-oil-pressure", lOp, `Öldruck ${f1(p)} bar bei ${f0(rpm)} 1/min zu niedrig`);
    if (timer("oilp-fatal", p < 0.3 && rpm > 1500) > 3) kill("low-oil-pressure", "Lagerschaden: Ohne Öldruck sind die Pleuellager gefressen.");
  } else {
    timer("oilp-fatal", false);
  }

  // --- Turbolader (diesel.md §4.4, petrol.md §4 "Turbo")
  if (th.turboShaftMaxRpm > 0 && cfg.induction.aspiration !== "supercharger-roots") {
    const nMax = th.turboShaftMaxRpm;
    const warnF = cfg.fuel === "diesel" ? 0.92 : 0.95;
    warn("turbo-overspeed", level("turbo-overspeed", s.turboRpm, warnF * nMax, nMax, 2000), `Laderdrehzahl ${f0(s.turboRpm / 1000)} 000 1/min (Grenze ${f0(nMax / 1000)} 000 1/min)`);
    if (timer("turbo-fatal", s.turboRpm > 1.08 * nMax) > 0.3) kill("turbo-overspeed", "Turboschaden: Das Verdichterrad ist durch Überdrehzahl geborsten.");
  }
  if (isCharged(cfg)) {
    const over = s.boostBar - cfg.induction.boostTargetBar;
    const tOver = timer("overboost", over > th.overboostMarginBar);
    const tOver2 = timer("overboost2", over > th.overboostMarginBar + 0.2);
    const lOb: Level = tOver2 > 1 ? 2 : tOver > 1 ? 1 : 0;
    warn("overboost", lOb, `Überladedruck: ${f1(s.boostBar)} bar statt ${f1(cfg.induction.boostTargetBar)} bar`);
  }

  // --- Klopfen (petrol.md §3.6 / §4): wear += 0.02·knock²·dt, fatal at knock > 0.8 and bmep > 15 for > 3 s
  if (cfg.fuel === "petrol") {
    const k = Math.max(0, Math.min(1, s.knock));
    const lK = level("knock", k, 0.2, 0.5, 0.05);
    if (lK > 0) warnings.push({ code: "knock", severity: lK === 2 ? "critical" : "warning", message: lK === 2 ? "Starkes Klopfen – Kolben in Gefahr" : "Motor klopft" });
    const kw = 0.02 * k * k;
    wear += kw;
    if (kw > worstWear) {
      worstWear = kw;
      worstWearCode = "knock";
    }
    if (timer("knock-fatal", k > 0.8 && s.bmepBar > 15) > 3) kill("knock", "Kolbenschaden: Durch Klopfen ist der Kolben durchgebrannt (Stegbruch).");
  } else {
    // --- Rauch (diesel.md §4.6): no damage
    const lS = level("smoke", s.smoke, 0.3, 0.6, 0.05);
    if (lS > 0) warnings.push({ code: "smoke", severity: lS === 2 ? "critical" : "warning", message: lS === 2 ? "Schwarzer Rauch – viel zu fett" : "Motor rußt" });
  }

  // --- Kalt-Volllast (diesel.md §4.5): wear only
  if (s.running && s.oilC < 50 && s.load > 0.8) wear += 3 * WEAR_WARNING * 0.5;

  // --- Verschleiß aufgebraucht
  if (s.wear >= 1 && !fatal) {
    const msg: Partial<Record<WarningCode, string>> = {
      knock: "Kolbenschaden: Dauerndes Klopfen hat den Kolben zerstört.",
      "overheat-oil": "Lagerschaden: Das Öl war zu lange zu heiß.",
      "overheat-coolant": "Zylinderkopfdichtung durchgebrannt: Der Motor war zu lange zu heiß.",
      "peak-pressure": "Kolbenschaden: Der Spitzendruck hat die Kolben ermüdet.",
      "low-oil-pressure": "Lagerschaden: Zu wenig Öldruck hat die Lager zerstört.",
    };
    kill(worstWearCode, msg[worstWearCode] ?? "Motorschaden: Der Verschleiß ist aufgebraucht, ein Lager ist gefressen.");
  }

  return fatal ? { warnings, wearRatePerS: wear, fatal } : { warnings, wearRatePerS: wear };
}
