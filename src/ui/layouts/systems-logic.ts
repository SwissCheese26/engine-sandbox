// Readings of the vehicle systems (#83) for the cockpit: intake air (#105), battery, air brake, retarder, AdBlue and
// lean angle, taken from the engine state, core VehicleSystems and the route. Nothing is estimated here: a value the
// vehicle does not have is NaN and its field/gauge is not offered. DOM-free.
import { curvatureAt, isCommercialKind, isMotorcycleKind, leanAngle, terrainCurved, type EngineConfig } from "../../core/index.ts";
import { catalystOf, intakeAirOf } from "./fields-logic.ts";
import type { Frame } from "./view.ts";

export interface SystemReadings {
  intakeAirC: number;
  /** Catalyst temperature (#135), NaN without a catalyst; catalyst heating active. */
  catalystC: number;
  catHeating: boolean;
  batteryV: number;
  airBar: number;
  airWarn: boolean;
  retarderStage: number;
  adblueShare: number;
  adblueReserve: boolean;
  leanDeg: number;
  leanLimit: boolean;
  /** Which of them the vehicle has (FieldContext / GaugeContext). */
  has: { intake: boolean; commercial: boolean; adblue: boolean; lean: boolean; cat: boolean };
}

/** The engine has an SCR catalyst (AdBlue): diesel with exhaust.scr. */
export function hasScr(cfg: EngineConfig): boolean {
  return cfg.fuel === "diesel" && !!cfg.exhaust.scr;
}

export function systemReadings(f: Pick<Frame, "s" | "mode" | "drivetrain" | "systems">, cfg: EngineConfig): SystemReadings {
  const d = f.drivetrain;
  const sys = f.systems;
  const vehicle = f.mode === "vehicle";
  const intakeAirC = intakeAirOf(f.s);
  const catalystC = catalystOf(f.s);
  const commercial = vehicle && !!sys && isCommercialKind(d.kind);
  const adblue = vehicle && !!sys && hasScr(cfg);
  const terrain = d.environment.terrain ?? "static";
  const lean = vehicle && isMotorcycleKind(d.kind) && terrainCurved(terrain);
  const la = lean ? leanAngle(f.s.vehicleSpeedMs ?? 0, curvatureAt(terrain, d.state.positionM ?? 0), d.state.grip) : { deg: Number.NaN, limit: false };
  return {
    intakeAirC,
    catalystC,
    catHeating: f.s.coldStart === "cat-heating",
    batteryV: sys ? sys.batteryV : Number.NaN,
    airBar: commercial ? sys!.air.pressureBar : Number.NaN,
    airWarn: commercial && sys!.air.warning,
    retarderStage: commercial ? sys!.retarderStage : Number.NaN,
    adblueShare: adblue ? sys!.adblue.fraction : Number.NaN,
    adblueReserve: adblue && sys!.adblue.reserve,
    leanDeg: la.deg,
    leanLimit: la.limit,
    has: { intake: Number.isFinite(intakeAirC), commercial, adblue, lean, cat: Number.isFinite(catalystC) },
  };
}
