// Tuning stages (issue #16): "Serie / Stage 1 / Stage 2 / Stage 3" applied together to a production config.
// Pure data transformation, no DOM. Every stage is computed from the remembered production config, so
// "Serie" always leads back. Typical figures from tuner practice (docs/research, issue #16: M57 Stage 1 ≈ +20 %,
// ≈ +60 Nm): Stage 1 software only, Stage 2 adds exhaust/intercooler hardware, Stage 3 a bigger charger and
// stronger internals. The physics core punishes overdoing it (knock, EGT, peak pressure, smoke).
import { dynoSweep, summarize } from "../core/index.ts";
import type { EngineConfig, Warning } from "../core/index.ts";

export type TuningStage = 0 | 1 | 2 | 3;

export const STAGE_LABELS: Record<TuningStage, string> = { 0: "Serie", 1: "Stage 1", 2: "Stage 2", 3: "Stage 3" };

export interface TuningOptions {
  /** Stage 3: fit forged pistons and conrods (default true). Without them the cast parts are overloaded. */
  forgedInternals?: boolean;
}

export interface TuningResult {
  config: EngineConfig;
  /** Short German list "what is changed" for the UI. */
  changes: string[];
}

const isCharged = (c: EngineConfig) => c.induction.aspiration !== "naturally-aspirated" && c.induction.boostTargetBar > 0;
const isTurbo = (c: EngineConfig) => ["turbo", "twin-turbo-parallel", "twin-turbo-sequential", "e-turbo"].includes(c.induction.aspiration);
const r2 = (x: number) => Math.round(x * 100) / 100;
const de = (x: number, d = 2) => x.toFixed(d).replace(".", ",");

/**
 * Boost and ECU torque limit factors per stage relative to production [S, typical tuner maps]: petrol Stage 1
 * ≈ +0.3 … 0.4 bar on ≈ 1.3 bar, diesel ≈ +0.3 … 0.4 bar on ≈ 1.7 … 2 bar (VTG engines already run high boost).
 */
const BOOST = { petrol: { 1: 1.25, 2: 1.35, 3: 1.6 }, diesel: { 1: 1.2, 2: 1.3, 3: 1.5 } } as const;
const TORQUE_LIMIT = { 1: 1.25, 2: 1.35, 3: 1.6 } as const;

/**
 * Applies a stage to the production config `base`. Returns a new object (the model cache is per config object).
 * The name gets the stage appended.
 */
export function applyTuningStage(base: EngineConfig, stage: TuningStage, opts: TuningOptions = {}): TuningResult {
  const c = structuredClone(base);
  const changes: string[] = [];
  if (stage === 0) return { config: c, changes: ["Serienstand des geladenen Motors"] };
  const s = stage as 1 | 2 | 3;
  const charged = isCharged(c);
  const ind = c.induction;
  const fs = c.fuelSystem;

  // ── Stage 1: software ────────────────────────────────────────────────────
  if (charged) {
    const b = r2(base.induction.boostTargetBar * BOOST[c.fuel][s]);
    changes.push(`Ladedruck ${de(base.induction.boostTargetBar)} → ${de(b)} bar`);
    ind.boostTargetBar = b;
  }
  if (base.ecuTorqueLimitNm !== undefined) {
    const lim = Math.round((base.ecuTorqueLimitNm * TORQUE_LIMIT[s]) / 5) * 5;
    changes.push(`Drehmomentbegrenzung ${Math.round(base.ecuTorqueLimitNm)} → ${lim} Nm`);
    c.ecuTorqueLimitNm = lim;
  }
  if (base.ecuPowerLimitKw !== undefined) {
    // issue #31: truck power ratings are pure software, raised by the same share as the torque limit
    const lim = Math.round((base.ecuPowerLimitKw * TORQUE_LIMIT[s]) / 5) * 5;
    changes.push(`Leistungsbegrenzung ${Math.round(base.ecuPowerLimitKw)} → ${lim} kW`);
    c.ecuPowerLimitKw = lim;
  }
  if (fs.kind === "diesel" && base.fuelSystem.kind === "diesel") {
    // more quantity: the smoke limit is set richer (diesel.md §3.2, the injection capacity follows it)
    const d = { 1: 0.1, 2: 0.15, 3: 0.2 }[s];
    const lam = r2(Math.max(1.05, base.fuelSystem.smokeLimitLambda - (charged ? d : 0.05)));
    changes.push(`Rauchgrenze λ ${de(base.fuelSystem.smokeLimitLambda)} → ${de(lam)} (mehr Einspritzmenge)`);
    fs.smokeLimitLambda = lam;
    // tuner maps retard the start of injection slightly to keep the peak pressure in check (diesel.md §3.2)
    if (charged) {
      fs.injectionTimingOffsetDeg = base.fuelSystem.injectionTimingOffsetDeg - 1.5;
      changes.push("Spritzbeginn 1,5 °KW später (Spitzendruck)");
    }
  } else if (fs.kind === "petrol" && base.fuelSystem.kind === "petrol") {
    if (charged) {
      fs.ignitionAdvanceOffsetDeg = base.fuelSystem.ignitionAdvanceOffsetDeg + 2;
      changes.push("Zündung +2 °KW früher");
    } else {
      // Naturally aspirated: the production map already sits at MBT in this model (petrol.md §3.5), more advance
      // would cost work; the software only moves ignition back to MBT and the full-load λ to best power (≈ 0.88).
      // Real NA Stage 1 gains (+3 … 5 %) come from conservative production maps the model does not have.
      const adv = Math.max(0, base.fuelSystem.ignitionAdvanceOffsetDeg);
      if (adv !== base.fuelSystem.ignitionAdvanceOffsetDeg) changes.push("Zündung auf bestes Moment (MBT)");
      fs.ignitionAdvanceOffsetDeg = adv;
      const lam = 0.88;
      if (lam !== base.fuelSystem.fullLoadLambda) changes.push(`Volllast-λ ${de(base.fuelSystem.fullLoadLambda)} → ${de(lam)} (beste Leistung)`);
      fs.fullLoadLambda = lam;
      if (changes.length === 0) changes.push("Kennfeld-Feinschliff (Serie ist schon nah am Optimum)");
    }
    if (fs.fuel === "ron91" || fs.fuel === "ron95") {
      // the extra advance is only usable on 98 RON (knock control would take it back on 95, petrol.md §3.6)
      fs.fuel = "ron98";
      changes.push("Abstimmung auf Super Plus (98 ROZ)");
    }
  }

  // ── Stage 2: exhaust and charge air hardware ─────────────────────────────
  if (s >= 2) {
    if (c.exhaust.manifold === "cast-log") {
      c.exhaust.manifold = charged ? "tubular-short" : "tubular-long";
      changes.push(charged ? "Downpipe und Rohrkrümmer (weniger Gegendruck)" : "Fächerkrümmer lang");
    }
    if (c.exhaust.catalyst) changes.push("Sport-Kat statt Serien-Kat, Kat bleibt drin (nicht modelliert)");
    if (charged) {
      const ic = ind.intercooler === "none" ? "air-to-air" : "air-to-water";
      if (ic !== ind.intercooler) {
        changes.push(ic === "air-to-air" ? "Ladeluftkühler nachgerüstet" : "Größerer Ladeluftkühler (Luft-Wasser)");
        ind.intercooler = ic;
      }
    } else {
      const cam = r2(Math.min(1, base.head.camProfile + 0.1));
      changes.push(`Schärfere Nockenwelle (${Math.round(base.head.camProfile * 100)} → ${Math.round(cam * 100)} %)`);
      c.head.camProfile = cam;
    }
  }

  // ── Stage 3: charger, injection, internals ───────────────────────────────
  if (s >= 3) {
    if (isTurbo(c)) {
      const d = Math.round(base.induction.compressorInducerMm * 1.18);
      const ar = r2(Math.min(1.5, base.induction.turbineAR * 1.2));
      changes.push(`Größerer Turbo: Verdichterrad ${Math.round(base.induction.compressorInducerMm)} → ${d} mm, A/R ${de(base.induction.turbineAR)} → ${de(ar)}`);
      ind.compressorInducerMm = d;
      ind.turbineAR = ar;
    } else if (charged) {
      changes.push("Kleinere Kompressor-Riemenscheibe (wirkt über den Ladedruck oben)");
    } else {
      const cam = r2(Math.min(1, base.head.camProfile + 0.2));
      const eps = r2(base.block.compressionRatio + 0.5);
      changes.push(`Rennnocke (${Math.round(cam * 100)} %), Verdichtung ${de(base.block.compressionRatio, 1)} → ${de(eps, 1)}`);
      c.head.camProfile = cam;
      c.block.compressionRatio = eps;
    }
    if (fs.kind === "diesel" && base.fuelSystem.kind === "diesel") {
      const cap = fs.injection === "common-rail" ? 2500 : fs.injection === "unit-injector" ? 2200 : fs.injection === "mechanical-pump" ? 1300 : 500;
      const p = Math.round(Math.min(cap, base.fuelSystem.injectionPressureBar * 1.15) / 50) * 50;
      if (p > base.fuelSystem.injectionPressureBar) changes.push(`Größere Düsen, Einspritzdruck ${Math.round(base.fuelSystem.injectionPressureBar)} → ${p} bar`);
      fs.injectionPressureBar = Math.max(p, base.fuelSystem.injectionPressureBar);
    } else {
      changes.push("Größere Einspritzdüsen und Kraftstoffpumpe (nicht modelliert)");
    }
    if (opts.forgedInternals ?? true) {
      const pistons = c.block.pistons === "cast-aluminium" ? "forged-aluminium" : c.block.pistons;
      const rods = c.block.conrods === "cast-steel" ? "forged-steel" : c.block.conrods;
      if (pistons !== c.block.pistons || rods !== c.block.conrods) changes.push("Geschmiedete Kolben und Pleuel");
      c.block.pistons = pistons;
      c.block.conrods = rods;
    } else {
      changes.push("Serien-Kolben und -Pleuel bleiben (Risiko!)");
    }
  }
  c.name = `${base.name} ${STAGE_LABELS[stage]}`;
  return { config: c, changes };
}

/**
 * Static warnings for a tuned config from a full-load dyno sweep (issue #16): peak pressure above the design
 * value of the weakest part, exhaust gas temperature above the limit, and Stage 3 on cast internals.
 * Uses the same limits as the simulator (summarize().limits).
 */
export function tuningWarnings(cfg: EngineConfig, stage: TuningStage): Warning[] {
  const out: Warning[] = [];
  if (stage === 0) return out;
  const lim = summarize(cfg).limits;
  let pMax = 0;
  let egt = 0;
  for (const p of dynoSweep(cfg, { fromRpm: Math.max(1000, cfg.idleRpm), stepRpm: 250 })) {
    pMax = Math.max(pMax, p.peakPressureBar);
    egt = Math.max(egt, p.egtC);
  }
  const cast = cfg.block.pistons === "cast-aluminium" || cfg.block.conrods === "cast-steel";
  if (pMax > lim.peakPressureMaxBar) {
    out.push({
      code: "peak-pressure", severity: "warning", field: "block.pistons",
      message: `Spitzendruck bis ${Math.round(pMax)} bar, ausgelegt sind ${Math.round(lim.peakPressureMaxBar)} bar${cast ? ` – ${castParts(cfg)} halten das nicht dauerhaft` : ""}.`,
    });
  }
  if (Math.round(egt) > Math.round(lim.egtMaxC)) {
    out.push({ code: "egt-high", severity: "warning", field: "exhaust.manifold", message: `Abgastemperatur bis ${Math.round(egt)} °C bei Volllast (Grenze ${Math.round(lim.egtMaxC)} °C).` });
  }
  if (stage === 3 && cast) {
    out.push({
      code: "conrod-stress", severity: "warning", field: "block.conrods",
      message: "Stage 3 ohne geschmiedete Kolben und Pleuel: Die Serien-Gussteile sind für diese Leistung nicht ausgelegt.",
    });
  }
  return out;
}

function castParts(cfg: EngineConfig): string {
  const p = cfg.block.pistons === "cast-aluminium";
  const r = cfg.block.conrods === "cast-steel";
  return p && r ? "Guss-Kolben und -Pleuel" : p ? "die Guss-Kolben" : "die Guss-Pleuel";
}
