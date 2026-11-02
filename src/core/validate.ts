/**
 * Configuration plausibility checks with German messages and config field paths (issue #9).
 * Rules from docs/research/petrol.md §1 "Validierungsregeln" and docs/research/diesel.md §1. No DOM.
 */
import { displacementLiters, meanPistonSpeed } from "./geometry.ts";
import { engineLimits, safeMaxRpm } from "./subsystems.ts";
import type { EngineConfig, Severity, Warning, WarningCode } from "./types.ts";

const VALID_CYLINDERS: Record<EngineConfig["block"]["layout"], number[]> = {
  inline: [1, 2, 3, 4, 5, 6, 8],
  v: [2, 4, 6, 8, 10, 12, 16],
  boxer: [2, 4, 6, 8, 12],
  vr: [5, 6],
  w: [8, 12, 16],
};

export function validateConfig(cfg: EngineConfig): Warning[] {
  const out: Warning[] = [];
  const add = (severity: Severity, field: string, message: string, code: WarningCode = "config") =>
    out.push({ code, severity, message, field });
  const b = cfg.block;
  const h = cfg.head;
  const ind = cfg.induction;
  const charged = ind.aspiration !== "naturally-aspirated";
  const n = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");

  if (!VALID_CYLINDERS[b.layout].includes(b.cylinders)) {
    add("critical", "block.cylinders", `${b.cylinders} Zylinder passen nicht zur Bauform „${b.layout}“ (möglich: ${VALID_CYLINDERS[b.layout].join(", ")}).`);
  }
  if (b.layout === "v" && (b.bankAngleDeg < 10 || b.bankAngleDeg > 180)) add("warning", "block.bankAngleDeg", "Bankwinkel außerhalb 10 … 180° ist nicht baubar.");
  if (b.conrodLengthMm < 1.4 * b.strokeMm) {
    add(b.conrodLengthMm < 1.1 * b.strokeMm ? "critical" : "warning", "block.conrodLengthMm", `Pleuel sehr kurz (${n(b.conrodLengthMm / b.strokeMm)} × Hub, üblich 1,4 … 2,2): hohe Seitenkräfte.`, "conrod-stress");
  } else if (b.conrodLengthMm > 2.2 * b.strokeMm) {
    add("info", "block.conrodLengthMm", "Pleuel sehr lang (> 2,2 × Hub): Block baut hoch und schwer.");
  }
  if (h.valvetrain === "ohv" && h.valvesPerCylinder > 2) add("critical", "head.valvesPerCylinder", "Stoßstangen-Ventiltrieb (OHV) ist nur mit 2 Ventilen pro Zylinder sinnvoll.");
  if (charged && ind.boostTargetBar <= 0) add("warning", "induction.boostTargetBar", "Aufgeladener Motor mit 0 bar Ladedruck – der Lader bringt nichts.");
  if (!charged && ind.boostTargetBar > 0) add("info", "induction.boostTargetBar", "Saugmotor: Der Ladedruck-Sollwert wird ignoriert.");
  if (cfg.idleRpm >= cfg.revLimitRpm * 0.6) add("critical", "idleRpm", "Leerlaufdrehzahl liegt zu nah am Begrenzer.");
  const cmLimit = meanPistonSpeed(b.strokeMm, cfg.revLimitRpm);
  const lim = engineLimits(cfg);
  if (cfg.revLimitRpm > safeMaxRpm(cfg)) {
    add("critical", "revLimitRpm", `Begrenzer ${Math.round(cfg.revLimitRpm)} 1/min liegt über der mechanisch sicheren Drehzahl (${Math.round(safeMaxRpm(cfg))} 1/min).`, "over-rev");
  } else if (cmLimit > lim.meanPistonSpeedMaxMs) {
    add("warning", "revLimitRpm", `Kolbengeschwindigkeit am Begrenzer ${n(cmLimit)} m/s (Warnung ab ${n(lim.meanPistonSpeedMaxMs)} m/s).`, "piston-speed");
  }

  if (cfg.fuelSystem.kind !== cfg.fuel) add("critical", "fuelSystem.kind", "Kraftstoffsystem passt nicht zur Motorart.");

  if (cfg.fuelSystem.kind === "diesel") {
    const fs = cfg.fuelSystem;
    const eps = b.compressionRatio;
    const indirect = fs.injection === "indirect-prechamber" || fs.injection === "indirect-swirl-chamber";
    if (eps < 12) add("critical", "block.compressionRatio", `Verdichtung ${n(eps)}:1 – ein Diesel zündet so nicht selbst.`);
    else if (eps < 14) add("warning", "block.compressionRatio", `Verdichtung ${n(eps)}:1 – unter 14 springt ein Diesel kalt kaum an.`);
    else if (eps > 24) add("warning", "block.compressionRatio", `Verdichtung ${n(eps)}:1 – sehr hoher Spitzendruck.`, "peak-pressure");
    if (indirect && eps < 19) add("warning", "block.compressionRatio", "Kammerdiesel brauchen etwa 20 … 23:1 Verdichtung.");
    if (indirect && fs.injectionPressureBar > 500) add("warning", "fuelSystem.injectionPressureBar", "Kammerdiesel arbeiten mit 120 … 400 bar Einspritzdruck.");
    if (fs.injection === "common-rail" && fs.injectionPressureBar < 800) add("warning", "fuelSystem.injectionPressureBar", "Common Rail unter 800 bar zerstäubt schlecht: viel Ruß.", "smoke");
    if (fs.injection === "mechanical-pump" && fs.injectionPressureBar > 1300) add("warning", "fuelSystem.injectionPressureBar", "Mechanische Pumpen schaffen etwa 400 … 1000 bar.");
    if (fs.smokeLimitLambda < 1.1) add("warning", "fuelSystem.smokeLimitLambda", `Rauchgrenze λ ${n(fs.smokeLimitLambda)}: schwarze Rauchwolke und hohe Abgastemperatur.`, "smoke");
    if (Math.abs(fs.injectionTimingOffsetDeg) > 8) add("warning", "fuelSystem.injectionTimingOffsetDeg", "Spritzbeginn weit vom Optimum: Wirkungsgrad sinkt deutlich.");
    if (ind.individualThrottleBodies) add("warning", "induction.individualThrottleBodies", "Ein Diesel hat keine Drosselklappen.");
    if (h.valvesPerCylinder === 3 || h.valvesPerCylinder === 5) add("info", "head.valvesPerCylinder", "3 oder 5 Ventile sind beim Diesel unüblich (Injektor sitzt mittig).");
    if (b.layout === "v" && b.cylinders === 8 && b.v8Crank === "flatplane") add("info", "block.v8Crank", "Flatplane-Diesel-V8: starke Vibrationen durch Massenkräfte 2. Ordnung.");
  } else if (cfg.fuelSystem.kind === "petrol") {
    const fs = cfg.fuelSystem;
    const eps = b.compressionRatio;
    if (charged && eps > 12.5) add("critical", "block.compressionRatio", `Aufgeladener Benziner mit ${n(eps)}:1 Verdichtung klopft sich kaputt.`, "knock");
    else if (charged && eps > 10.5) add("warning", "block.compressionRatio", `Verdichtung ${n(eps)}:1 mit Aufladung: hohe Klopfneigung.`, "knock");
    else if (eps > 13.5) add("warning", "block.compressionRatio", `Verdichtung ${n(eps)}:1: nur mit sehr klopffestem Kraftstoff.`, "knock");
    if (eps < 7.5) add("warning", "block.compressionRatio", "Verdichtung unter 7,5:1: schlechter Wirkungsgrad.");
    const cylL = displacementLiters(cfg) / Math.max(1, b.cylinders);
    if (cylL < 0.15 || cylL > 1.0) add("warning", "block.boreMm", `${n(cylL * 1000)} cm³ pro Zylinder (üblich 150 … 1000 cm³).`);
    if (fs.fuel === "e85" && fs.mixture === "carburettor") add("warning", "fuelSystem.fuel", "E85 mit Vergaser: schlechter Kaltstart.");
    if (fs.mixture === "carburettor" && charged) add("info", "fuelSystem.mixture", "Vergaser mit Aufladung: keine Klopfregelung.", "knock");
    if (fs.fullLoadLambda < 0.75) add("warning", "fuelSystem.fullLoadLambda", "Gemisch sehr fett: Zündkerzen verrußen, Verbrauch hoch.");
    if (fs.ignitionAdvanceOffsetDeg > 6) add("warning", "fuelSystem.ignitionAdvanceOffsetDeg", "Viel Frühzündung: Klopfgefahr.", "knock");
  }
  return out;
}
