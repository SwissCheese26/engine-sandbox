/**
 * Adapter to the subsystems of team "Thermik & Aufladung" (issue #4 / PR #12: turbo.ts, thermal.ts,
 * limits.ts, mass.ts). The physics core imports turbo, thermal, limits and mass ONLY from here.
 *
 * Until PR #12 is merged this file contains simple built-in stand-ins with exactly the PR #12 signatures.
 * After the merge it is replaced by plain re-exports:
 *   export * from "./turbo.ts"; export * from "./thermal.ts"; export * from "./limits.ts"; export * from "./mass.ts";
 *
 * Stand-in models (deliberately simple, all from the specs):
 * - turbo: stationary available boost from exhaust enthalpy, first-order lag (diesel.md §3.9 "Echtzeit-Vereinfachung"),
 *   shaft speed via Euler work (diesel.md §3.9), superchargers per petrol.md §3.12.
 * - thermal: two lumped capacities with thermostat/radiator (diesel.md §3.10), EGT first order (diesel.md §3.7).
 * - limits: warning/critical/fatal bands from diesel.md §4 and petrol.md §4 with exceedance timers.
 * - mass: diesel.md §2 "Masse" formula, petrol variant from petrol.md §7 Massen-Richtwerte.
 * Pure functions apart from the explicit LimitTracker. No DOM.
 */
import type { DamageEvent, EngineConfig, EngineState, Severity, Warning, WarningCode } from "./types.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const CP_AIR = 1005;
const EX_AIR = 0.2857;
const T1_STD_K = 298.15;

const displacementL = (cfg: EngineConfig) =>
  ((Math.PI / 4) * (cfg.block.boreMm / 10) ** 2 * (cfg.block.strokeMm / 10) * cfg.block.cylinders) / 1000;
const isCharged = (cfg: EngineConfig) => cfg.induction.aspiration !== "naturally-aspirated";
const isExhaustDriven = (cfg: EngineConfig) =>
  ["turbo", "twin-turbo-parallel", "twin-turbo-sequential", "e-turbo"].includes(cfg.induction.aspiration);

// ───────────────────────────────────────── turbo ─────────────────────────────────────────

export interface TurboState {
  shaftRpm: number;
  boostBar: number;
}

const d2M = (cfg: EngineConfig) => Math.max(15, cfg.induction.compressorInducerMm) / 1000 / 0.7;
const prFromBoost = (boostBar: number, ambientKpa: number) => (ambientKpa + Math.max(0, boostBar) * 100) / ambientKpa;

/** Max shaft speed at u2 = 520 m/s (diesel.md §4.4). 0 for naturally aspirated. */
export function turboMaxRpm(cfg: EngineConfig): number {
  const a = cfg.induction.aspiration;
  if (a === "naturally-aspirated") return 0;
  if (a === "supercharger-roots") return 18000;
  return (520 * 60) / (Math.PI * d2M(cfg));
}

/** Shaft speed from pressure ratio via Euler work, μ·ηC = 0.49 (diesel.md §3.9). */
function shaftFromPr(cfg: EngineConfig, pr: number): number {
  const u2 = Math.sqrt(Math.max(0, pr ** EX_AIR - 1) * CP_AIR * T1_STD_K / 0.49);
  return (u2 / (Math.PI * d2M(cfg))) * 60;
}

/** Relative exhaust enthalpy x = ṁ·T / (ṁ·T)_ref of the charger (diesel.md §3.9 simplification, sizing [S]). */
function exhaustLoad(cfg: EngineConfig, exhKgS: number, egtC: number): number {
  const D = Math.max(15, cfg.induction.compressorInducerMm) / 1000;
  const choke = 140 * (Math.PI / 4) * D * D; // compressor choke flow (diesel.md §3.9)
  const ind = cfg.induction;
  let ref = 0.5 * choke * Math.sqrt(clamp(ind.turbineAR, 0.3, 1.5) / 0.6) * (ind.variableGeometry ? 0.6 : 1);
  if (ind.aspiration === "twin-turbo-sequential") ref *= 0.6; // small stage at low flow
  return (Math.max(0, exhKgS) * (egtC + 273.15)) / (ref * 1000);
}

function rootsBoost(cfg: EngineConfig, rpm: number) {
  return Math.max(0, cfg.induction.boostTargetBar) * clamp(rpm / (0.5 * cfg.revLimitRpm), 0, 1);
}
function centrifugalBoost(cfg: EngineConfig, rpm: number) {
  return Math.max(0, cfg.induction.boostTargetBar) * clamp(rpm / cfg.revLimitRpm, 0, 1) ** 2;
}

export function steadyBoostBar(cfg: EngineConfig, rpm: number, exhaustMassFlowKgS: number, egtC: number, _ambientKpa: number): number {
  const a = cfg.induction.aspiration;
  const target = Math.max(0, cfg.induction.boostTargetBar);
  if (a === "naturally-aspirated" || target <= 0) return 0;
  if (a === "supercharger-roots") return rootsBoost(cfg, rpm);
  if (a === "supercharger-centrifugal") return centrifugalBoost(cfg, rpm);
  const x = exhaustLoad(cfg, exhaustMassFlowKgS, egtC);
  return Math.min(target, 3.0 * Math.pow(x, 1.3));
}

function boostDemandBar(cfg: EngineConfig, pedal: number) {
  return Math.max(0, cfg.induction.boostTargetBar) * clamp((pedal - 0.15) / 0.75, 0, 1);
}

export function stepTurbo(s: TurboState, cfg: EngineConfig, dt: number, exhaustMassFlowKgS: number, egtC: number, pedal: number, rpm: number, ambientKpa: number): TurboState {
  const a = cfg.induction.aspiration;
  if (a === "naturally-aspirated") return { shaftRpm: 0, boostBar: 0 };
  if (!(dt > 0)) return { ...s };
  const target = Math.max(0, cfg.induction.boostTargetBar);
  const demand = boostDemandBar(cfg, pedal);
  if (a === "supercharger-roots" || a === "supercharger-centrifugal") {
    const avail = a === "supercharger-roots" ? rootsBoost(cfg, rpm) : centrifugalBoost(cfg, rpm);
    const set = target > 0 ? avail * (demand / target) : 0;
    const boostBar = s.boostBar + (set - s.boostBar) * (1 - Math.exp(-dt / 0.08));
    const shaftRpm = a === "supercharger-roots" ? 2.5 * rpm : shaftFromPr(cfg, prFromBoost(avail, ambientKpa));
    return { shaftRpm, boostBar: Math.max(0, boostBar) };
  }
  const x = exhaustLoad(cfg, exhaustMassFlowKgS, egtC);
  const avail = Math.min(target, 3.0 * Math.pow(x, 1.3));
  const set = Math.min(demand, avail);
  // diesel.md §3.9: τ = 0.6·(D/45)^2.5·√(A/R/0.6)·(VTG 0.6); lag grows at low exhaust energy
  const ind = cfg.induction;
  let tau = 0.6 * (Math.max(15, ind.compressorInducerMm) / 45) ** 2.5 * Math.sqrt(clamp(ind.turbineAR, 0.3, 1.5) / 0.6) * (ind.variableGeometry ? 0.6 : 1);
  if (a === "e-turbo") tau *= 0.25;
  if (a === "twin-turbo-parallel") tau *= 0.6;
  if (a === "twin-turbo-sequential") tau *= 0.5;
  if (set > s.boostBar) tau /= clamp(x, 0.15, 1);
  const boostBar = Math.max(0, s.boostBar + (set - s.boostBar) * (1 - Math.exp(-dt / tau)));
  // idle spin from exhaust flow plus Euler speed at the current pressure ratio
  const shaftRpm = Math.max(shaftFromPr(cfg, prFromBoost(boostBar, ambientKpa)), 0.15 * turboMaxRpm(cfg) * Math.sqrt(clamp(x, 0, 1)));
  return { shaftRpm, boostBar };
}

/** Mechanical drive power of a supercharger, kW (petrol.md §3.12: 10 … 15 % of engine power). */
export function superchargerPowerKw(cfg: EngineConfig, rpm: number, boostBar: number): number {
  const a = cfg.induction.aspiration;
  if ((a !== "supercharger-roots" && a !== "supercharger-centrifugal") || rpm <= 0) return 0;
  const vh = displacementL(cfg) / 1000;
  const pr = prFromBoost(boostBar, 101.325);
  const eta = a === "supercharger-roots" ? 0.55 : 0.7;
  const t2 = T1_STD_K * (1 + (pr ** EX_AIR - 1) / eta);
  const rho = (101325 + Math.max(0, boostBar) * 1e5) / (287 * t2);
  const air = 0.9 * rho * vh * (rpm / 120);
  return (air * CP_AIR * T1_STD_K * (pr ** EX_AIR - 1)) / eta / 0.95 / 1000;
}

/** Charge-air temperature after compressor + intercooler, °C (diesel.md §3.1). */
export function chargeAirTempC(cfg: EngineConfig, boostBar: number, ambientC: number): number {
  const a = cfg.induction.aspiration;
  if (a === "naturally-aspirated" || boostBar <= 0) return ambientC;
  const etaC = a === "supercharger-roots" ? 0.55 : 0.7;
  const t1 = ambientC + 273.15;
  const t2 = t1 * (1 + (prFromBoost(boostBar, 101.325) ** EX_AIR - 1) / etaC);
  const ic = cfg.induction.intercooler;
  const eps = { none: 0, "air-to-air": 0.75, "air-to-water": 0.85 }[ic];
  const sink = ic === "air-to-water" ? t1 + 15 : t1;
  return t2 - eps * (t2 - sink) - 273.15;
}

// ───────────────────────────────────────── thermal ─────────────────────────────────────────

export interface ThermalState {
  coolantC: number;
  oilC: number;
  egtC: number;
}

/** Coolant/oil lumped capacities, thermostat, radiator, fan (diesel.md §3.10); EGT lag (diesel.md §3.7). */
export function stepThermal(s: ThermalState, cfg: EngineConfig, dt: number, heatToCoolantKw: number, targetEgtC: number, rpm: number, ambientC: number): ThermalState {
  if (!(dt > 0)) return { ...s };
  const vl = displacementL(cfg);
  const mass = engineMassKg(cfg);
  const cMetal = cfg.block.blockMaterial === "aluminium" ? 900 : 460;
  // small circuit (thermostat closed) – the radiator loop enters via the radiator term [S]
  const Cc = (1.5 + 0.6 * vl) * 1.04 * 3500 + 0.1 * mass * cMetal;
  const Co = (2 + 0.6 * vl) * 0.85 * 2000 + 0.03 * mass * cMetal;
  const vh = vl / 1000;
  const cm = (2 * (cfg.block.strokeMm / 1000) * Math.max(0, rpm)) / 60;
  const pFric = rpm > 50 ? (0.25 + 0.06 * cm + 0.0012 * cm * cm) * 1e5 * vh * (rpm / 120) : 0;
  const qOilIn = 0.5 * pFric + 0.08 * Math.max(0, heatToCoolantKw) * 1000;
  const uaOil = cfg.cooling.oilCooler ? 300 : 120;
  const n = Math.max(1, Math.ceil(dt / 0.25));
  const h = dt / n;
  let c = s.coolantC;
  let o = s.oilC;
  for (let i = 0; i < n; i++) {
    const open = clamp((c - cfg.cooling.thermostatOpenC) / 12, 0.01, 1);
    const fan = clamp((c - (cfg.cooling.thermostatOpenC + 6)) / 4, 0, 1);
    const pump = 0.7 + 0.3 * clamp(rpm / 3000, 0, 1);
    const qRad = (cfg.cooling.radiatorCapacityKw * 1000 * open * (0.4 + 0.6 * fan) * pump * Math.max(0, c - ambientC)) / 65;
    const qOc = uaOil * (o - c);
    c += ((Math.max(0, heatToCoolantKw) * 1000 + qOc - qRad - 0.03 * mass * (c - ambientC)) / Cc) * h;
    o += ((qOilIn - qOc - 6 * (o - ambientC)) / Co) * h;
  }
  const tau = cfg.exhaust.manifold === "cast-log" ? 2.5 : 1.0;
  return { coolantC: c, oilC: o, egtC: targetEgtC + (s.egtC - targetEgtC) * Math.exp(-dt / tau) };
}

/** Oil pressure, bar (diesel.md §3.10): 0.0015·rpm·(1 + (90 − oil)/80), relief 5 bar. */
export function oilPressureBar(cfg: EngineConfig, rpm: number, oilC: number): number {
  if (rpm <= 0) return 0;
  return clamp(0.0015 * rpm * clamp(1 + (90 - oilC) / 80, 0.55, 2.5), 0, cfg.fuel === "diesel" ? 5.0 : 5.5);
}

// ───────────────────────────────────────── limits ─────────────────────────────────────────

interface Band { warning: number; critical: number; fatal: number }

interface Thresholds {
  pistonSpeed: Band;
  valveFloatRpm: number;
  peakPressureDesignBar: number;
  egtC: Band;
  coolantC: Band;
  oilC: Band;
  turboShaftMaxRpm: number;
}

function valveFloat(cfg: EngineConfig): number {
  const h = cfg.head;
  if (cfg.fuel === "diesel") return 5600 * (h.valvetrain === "ohv" ? 0.85 : 1) * (1 + 0.1 * h.camProfile); // diesel.md §4.1
  const base = { ohv: 6600, sohc: 7400, dohc: 8200 }[h.valvetrain]; // petrol.md §4
  return base * (h.valvesPerCylinder >= 4 ? 1.08 : 1) * (1 + 0.1 * h.camProfile) * Math.sqrt(86 / cfg.block.boreMm);
}

function thresholds(cfg: EngineConfig): Thresholds {
  const b = cfg.block;
  let ps: Band;
  let pd: number;
  if (cfg.fuel === "diesel") {
    // diesel.md §4.1 + modifiers; §4.2 weakest component
    const truck = b.boreMm > 100;
    const f = { "cast-steel": 0.92, "forged-steel": 1, titanium: 1.1 }[b.conrods]
      * { "cast-aluminium": 1, "forged-aluminium": 1.05, steel: 0.95 }[b.pistons]
      * { cast: 0.92, forged: 1, billet: 1.05 }[b.crankshaft];
    ps = truck ? { warning: 12 * f, critical: 14 * f, fatal: 16 * f } : { warning: 15 * f, critical: 17 * f, fatal: 19 * f };
    pd = Math.min(
      { aluminium: 190, "cast-iron": 210, "compacted-graphite-iron": 250 }[b.blockMaterial],
      { "cast-aluminium": 190, "forged-aluminium": 215, steel: 260 }[b.pistons],
      { "cast-steel": 180, "forged-steel": 220, titanium: 240 }[b.conrods],
    );
    if (b.boreMm > 82) pd *= Math.sqrt(82 / b.boreMm);
  } else {
    // petrol.md §4 piston speed table (weakest part decides)
    const tier = Math.min(
      { cast: 0, forged: 1, billet: 2 }[b.crankshaft],
      { "cast-aluminium": 0, "forged-aluminium": 1, steel: 1 }[b.pistons] + (b.crankshaft === "billet" ? 1 : 0),
      { "cast-steel": 0, "forged-steel": 1, titanium: 2 }[b.conrods],
    );
    ps = [{ warning: 19, critical: 21, fatal: 23 }, { warning: 22, critical: 24.5, fatal: 26.5 }, { warning: 24, critical: 26, fatal: 28 }][tier]!;
    // petrol.md §4: cast 110, forged 140 bar, cast-iron block +10 % (modern turbo DI 130 … 140 bar on cast → 130 used)
    pd = { "cast-aluminium": 130, "forged-aluminium": 155, steel: 170 }[b.pistons] * (b.blockMaterial === "cast-iron" ? 1.1 : 1);
  }
  const egt: Band = cfg.fuel === "diesel"
    ? { warning: 800, critical: 850, fatal: b.pistons === "steel" ? 1000 : 950 } // diesel.md §4.3
    : { warning: 950, critical: 1000, fatal: 1050 }; // petrol.md §4
  return {
    pistonSpeed: ps,
    valveFloatRpm: valveFloat(cfg),
    peakPressureDesignBar: pd,
    egtC: egt,
    coolantC: cfg.fuel === "diesel" ? { warning: 108, critical: 118, fatal: 130 } : { warning: 110, critical: 120, fatal: 130 },
    oilC: cfg.fuel === "diesel" ? { warning: 135, critical: 150, fatal: 165 } : { warning: 130, critical: 145, fatal: 155 },
    turboShaftMaxRpm: turboMaxRpm(cfg),
  };
}

/** Mechanically safe max rpm: min(piston speed critical, valve float ×1.06) (diesel.md §4.1). */
export function safeMaxRpm(cfg: EngineConfig): number {
  const th = thresholds(cfg);
  return Math.min((30 * th.pistonSpeed.critical) / (Math.max(1, cfg.block.strokeMm) / 1000), 1.06 * th.valveFloatRpm);
}

/** Gauge limits (issue #9): onset of the warning range. */
export function engineLimits(cfg: EngineConfig): {
  coolantMaxC: number; oilMaxC: number; egtMaxC: number; oilPressureMinBar: number; boostMaxBar: number;
  peakPressureMaxBar: number; turboMaxRpm: number; meanPistonSpeedMaxMs: number;
} {
  const th = thresholds(cfg);
  return {
    coolantMaxC: th.coolantC.warning,
    oilMaxC: th.oilC.warning,
    egtMaxC: th.egtC.warning,
    oilPressureMinBar: 0.5,
    boostMaxBar: isCharged(cfg) ? cfg.induction.boostTargetBar + 0.3 : 0,
    peakPressureMaxBar: 0.95 * th.peakPressureDesignBar,
    turboMaxRpm: th.turboShaftMaxRpm * (cfg.fuel === "diesel" ? 0.92 : 0.95),
    meanPistonSpeedMaxMs: th.pistonSpeed.warning,
  };
}

export interface LimitTracker {
  lastT: number;
  timers: Partial<Record<string, number>>;
  levels: Partial<Record<WarningCode, number>>;
}

export function createLimitTracker(): LimitTracker {
  return { lastT: Number.NaN, timers: {}, levels: {} };
}

const thCache = new WeakMap<EngineConfig, Thresholds & { safe: number }>();
const implicitTrackers = new WeakMap<EngineConfig, LimitTracker>();

export function evaluateLimits(cfg: EngineConfig, s: EngineState, tracker?: LimitTracker): { warnings: Warning[]; wearRatePerS: number; fatal?: DamageEvent } {
  let tr = tracker ?? implicitTrackers.get(cfg);
  if (!tr) {
    tr = createLimitTracker();
    implicitTrackers.set(cfg, tr);
  }
  if (!(s.t >= tr.lastT)) {
    tr.timers = {};
    tr.levels = {};
  }
  const dt = Number.isFinite(tr.lastT) ? clamp(s.t - tr.lastT, 0, 0.5) : 0;
  tr.lastT = s.t;
  let th = thCache.get(cfg);
  if (!th) {
    th = { ...thresholds(cfg), safe: safeMaxRpm(cfg) };
    thCache.set(cfg, th);
  }
  const T = tr;
  const warnings: Warning[] = [];
  let wear = s.running ? 1e-6 * (0.3 + clamp(s.load, 0, 1)) : 0;
  let fatal: DamageEvent | undefined;
  const timer = (k: string, cond: boolean) => (T.timers[k] = cond ? (T.timers[k] ?? 0) + dt : Math.max(0, (T.timers[k] ?? 0) - 2 * dt));
  const warn = (code: WarningCode, v: number, w: number, c: number, msg: string) => {
    if (!(v >= w)) return;
    const severity: Severity = v >= c ? "critical" : "warning";
    warnings.push({ code, severity, message: msg });
    wear += severity === "critical" ? 2e-3 : 2e-4;
  };
  const kill = (code: WarningCode, message: string) => {
    if (!fatal) fatal = { code, t: s.t, message, fatal: true };
  };
  const rpm = Math.max(0, s.rpm);
  const fmt = (x: number) => String(Math.round(x));
  warn("over-rev", rpm, cfg.revLimitRpm + (cfg.fuel === "diesel" ? 200 : 100), th.safe, `Drehzahl ${fmt(rpm)} 1/min über dem Begrenzer`);
  if (timer("rev", rpm > 1.1 * th.safe) > 0.2) kill("over-rev", "Pleuelabriss durch Überdrehen.");
  warn("valve-float", rpm, 0.95 * th.valveFloatRpm, 1.06 * th.valveFloatRpm, `Ventilflattern droht ab ${fmt(th.valveFloatRpm)} 1/min`);
  if (timer("vf", rpm > 1.08 * th.valveFloatRpm) > 0.5) kill("valve-float", "Ventil trifft Kolben durch Ventilflattern.");
  const cm = s.meanPistonSpeedMs;
  warn("piston-speed", cm, th.pistonSpeed.warning, th.pistonSpeed.critical, `Mittlere Kolbengeschwindigkeit ${cm.toFixed(1)} m/s`);
  if (timer("ps", cm > th.pistonSpeed.fatal) > 1.5) kill("conrod-stress", "Pleuelabriss durch zu hohe Kolbengeschwindigkeit.");
  const pd = th.peakPressureDesignBar;
  warn("peak-pressure", s.peakPressureBar, 0.95 * pd, 1.05 * pd, `Spitzendruck ${fmt(s.peakPressureBar)} bar (zulässig ${fmt(pd)} bar)`);
  if (timer("pk", s.peakPressureBar > 1.25 * pd) > 0.1 || timer("pkc", s.peakPressureBar > 1.05 * pd) > 10) kill("peak-pressure", "Kolbenschaden durch zu hohen Spitzendruck.");
  warn("egt-high", s.egtC, th.egtC.warning, th.egtC.critical, `Abgastemperatur ${fmt(s.egtC)} °C`);
  if (timer("egt", s.egtC > th.egtC.fatal) > 5) kill("egt-high", "Abgastemperatur zu lange zu hoch: Kolben/Turbine beschädigt.");
  warn("overheat-coolant", s.coolantC, th.coolantC.warning, th.coolantC.critical, `Kühlmittel ${fmt(s.coolantC)} °C – Motor überhitzt`);
  if (timer("cool", s.coolantC > th.coolantC.fatal) > 20) kill("overheat-coolant", "Zylinderkopfdichtung durchgebrannt.");
  warn("overheat-oil", s.oilC, th.oilC.warning, th.oilC.critical, `Öltemperatur ${fmt(s.oilC)} °C`);
  if (timer("oil", s.oilC > th.oilC.fatal) > 20) kill("overheat-oil", "Lagerschaden durch überhitztes Öl.");
  if (s.running && rpm > 1500 && s.oilPressureBar < 0.5) warnings.push({ code: "low-oil-pressure", severity: "critical", message: "Öldruck zu niedrig" });
  if (th.turboShaftMaxRpm > 0 && isExhaustDriven(cfg)) {
    warn("turbo-overspeed", s.turboRpm, 0.92 * th.turboShaftMaxRpm, th.turboShaftMaxRpm, `Laderdrehzahl ${fmt(s.turboRpm)} 1/min`);
    if (timer("tc", s.turboRpm > 1.08 * th.turboShaftMaxRpm) > 0.3) kill("turbo-overspeed", "Verdichterrad geborsten.");
  }
  if (isCharged(cfg) && timer("ob", s.boostBar > cfg.induction.boostTargetBar + 0.3) > 1) {
    warnings.push({ code: "overboost", severity: "warning", message: `Überladedruck ${s.boostBar.toFixed(2)} bar` });
  }
  if (cfg.fuel === "petrol") {
    const k = clamp(s.knock, 0, 1);
    if (k > 0.2) warnings.push({ code: "knock", severity: k > 0.5 ? "critical" : "warning", message: k > 0.5 ? "Starkes Klopfen – Kolben in Gefahr" : "Motor klopft" });
    wear += 0.02 * k * k; // petrol.md §4
    if (timer("knock", k > 0.8 && s.bmepBar > 15) > 3) kill("knock", "Kolben durchgebrannt durch Klopfen.");
  } else if (s.smoke > 0.3) {
    warnings.push({ code: "smoke", severity: s.smoke > 0.6 ? "critical" : "warning", message: s.smoke > 0.6 ? "Schwarzer Rauch – viel zu fett" : "Motor rußt" });
  }
  if (s.wear >= 1) kill("conrod-stress", "Motorschaden: Der Verschleiß ist aufgebraucht.");
  return fatal ? { warnings, wearRatePerS: wear, fatal } : { warnings, wearRatePerS: wear };
}

// ───────────────────────────────────────── mass ─────────────────────────────────────────

/** Dry mass, kg (diesel.md §2 "Masse"; petrol: same structure, lighter base per petrol.md §7 Richtwerte [S]). */
export function engineMassKg(cfg: EngineConfig): number {
  const vl = displacementL(cfg);
  const b = cfg.block;
  const matF = { "cast-iron": 1.0, "compacted-graphite-iron": 0.92, aluminium: 0.8 }[b.blockMaterial];
  let m = (cfg.fuel === "diesel" ? 40 + 50 * vl : 35 + 30 * vl) * matF + 4 * b.cylinders;
  if (b.layout === "v" || b.layout === "w" || b.layout === "boxer") m *= 1.05;
  if (isCharged(cfg)) m += 8 + 0.12 * cfg.induction.compressorInducerMm;
  if (cfg.induction.intercooler !== "none" && isCharged(cfg)) m += 6;
  if (b.boreMm > 100 && cfg.fuel === "diesel") m *= 1.25;
  m += (cfg.exhaust.particulateFilter ? 8 : 0) + (cfg.exhaust.scr ? 15 : 0) + (cfg.exhaust.egr ? 3 : 0) + (cfg.exhaust.catalyst ? 4 : 0);
  return m;
}

/** Reliability 0 … 1 (diesel.md §4.7, simplified). */
export function reliabilityScore(cfg: EngineConfig): number {
  let r = 1;
  const th = thresholds(cfg);
  const cmLimit = (2 * (cfg.block.strokeMm / 1000) * cfg.revLimitRpm) / 60;
  if (cmLimit > th.pistonSpeed.warning) r *= 0.8;
  if (cfg.revLimitRpm > 0.95 * th.valveFloatRpm) r *= 0.85;
  if (cfg.fuelSystem.kind === "diesel" && cfg.fuelSystem.smokeLimitLambda < 1.15) r *= 0.9;
  if (cfg.block.blockMaterial === "aluminium" && cfg.induction.boostTargetBar > 2 && isCharged(cfg)) r *= 0.9;
  if (!cfg.cooling.oilCooler && isCharged(cfg) && cfg.induction.boostTargetBar > 1.2) r *= 0.9;
  return clamp(r, 0, 1);
}
