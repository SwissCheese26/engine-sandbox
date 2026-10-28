// Naming helpers (pure): layout code for the nameplate and an automatic engine name.
import { displacementL } from "../core/index.ts";
import type { EngineConfig } from "../core/index.ts";
import { fmt } from "./format.ts";

const LAYOUT_NAME: Record<EngineConfig["block"]["layout"], string> = {
  inline: "R",
  v: "V",
  boxer: "Boxer ",
  vr: "VR",
  w: "W",
};

/** "R4", "V8", "VR6", "W12", "Boxer 6". */
export function layoutCode(cfg: EngineConfig): string {
  return `${LAYOUT_NAME[cfg.block.layout]}${cfg.block.cylinders}`;
}

const ASPIRATION: Record<EngineConfig["induction"]["aspiration"], string> = {
  "naturally-aspirated": "Sauger",
  turbo: "Turbo",
  "twin-turbo-parallel": "Biturbo",
  "twin-turbo-sequential": "Biturbo",
  "supercharger-roots": "Kompressor",
  "supercharger-centrifugal": "Kompressor",
  "e-turbo": "E-Turbo",
};

/** Name derived from the configuration, e.g. "V8 Benziner 6,2 Turbo". */
export function autoName(cfg: EngineConfig): string {
  const fuel = cfg.fuel === "diesel" ? "Diesel" : "Benziner";
  return `${layoutCode(cfg)} ${fuel} ${fmt(displacementL(cfg), 1)} ${ASPIRATION[cfg.induction.aspiration]}`;
}
