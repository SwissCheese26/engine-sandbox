/**
 * Engine brake of commercial-vehicle diesels (issue #31, docs/research/commercial.md §3). Pure function, no DOM.
 *
 * Model [S]: braking power P_b(n) = maxKw·(n/n_rated)², i.e. braking torque T_b = P_b/ω ∝ n — both the exhaust
 * flap (back pressure ∝ exhaust volume flow) and the decompression brake (compression work per cycle × firing
 * frequency, plus the rising back pressure) roughly double the torque from half to full rated speed (Hoepke/Breuer,
 * "Nutzfahrzeugtechnik", Kap. Dauerbremsen; Jacobs / Mercedes braking-power curves). Active on overrun only
 * (pedal released), faded in between idle + 200 and idle + 400 rpm so it cuts out before the engine reaches idle,
 * as the real control (≈ 900–1000 rpm cut-out) does.
 */
import type { EngineConfig } from "./types.ts";

/** Braking torque of the engine brake in Nm (≥ 0) at `rpm` with accelerator `pedal` (0 … 1). */
export function engineBrakeTorqueNm(cfg: EngineConfig, rpm: number, pedal: number): number {
  const eb = cfg.engineBrake;
  if (!eb || !(eb.maxKw > 0) || pedal >= 0.01 || !(rpm > 0)) return 0;
  const nRated = eb.ratedRpm && eb.ratedRpm > 0 ? eb.ratedRpm : 0.9 * cfg.revLimitRpm;
  const omegaRated = (nRated * Math.PI) / 30;
  const tRated = (eb.maxKw * 1000) / omegaRated;
  const fade = Math.min(1, Math.max(0, (rpm - cfg.idleRpm - 200) / 200));
  // decompression brakes hold more torque at low rpm than the flap (cylinder compression work is speed-independent) [S]
  const shape = eb.kind === "decompression" ? 0.35 + 0.65 * (rpm / nRated) : rpm / nRated;
  return tRated * shape * fade;
}
