// Electric cars in the cockpit (#108): the pure part (no DOM), unit-tested. Every design gets an EV variant: the power
// meter (kW, regen green) replaces the rev counter, the state of charge the fuel gauge, the range and the Ready lamp
// join the centre display, and lamps that make no sense (oil pressure, coolant, glow plug, alternator) stay dark.
import { DRIVE_MODES, evSystemPowerKw } from "../../core/index.ts";
import type { EngineState, EvConfig, EvDriveMode, EvState } from "../../core/index.ts";
import { fmt } from "../format.ts";
import { evConsumption } from "../ev-fields.ts";
import type { UnitPrefs } from "../settings.ts";
import { toUnit } from "../units.ts";
import type { FieldId } from "./designs.ts";
import type { LampSet } from "./logic.ts";

/** Below this state of charge the "fuel" (low charge) lamp lights, like the 10 % warning of real EVs. */
export const LOW_SOC = 0.1;

/** Scale of the power meter, kW: regen down to −(the battery's charge power), drive up to the system power. */
export function powerMeterScale(ev: EvConfig): { min: number; max: number; major: number; minor: number } {
  const sys = evSystemPowerKw(ev);
  const major = sys > 1200 ? 500 : sys > 500 ? 200 : sys > 250 ? 100 : 50;
  const max = Math.ceil((sys * 1.05) / major) * major;
  // regen of real EVs: ≈ 60 … 250 kW; the scale shows one major step (or two for the big ones) below zero
  const min = -major * (sys > 500 ? 1 : 2);
  return { min, max, major, minor: major / 2 };
}

/** Needle value of the power meter: battery power, clamped to the scale. */
export function powerMeterValue(ev: EvState, scale: { min: number; max: number }): number {
  return Math.min(scale.max, Math.max(scale.min, ev.powerKw));
}

export interface EvLampInput {
  ready: boolean;
  ignition: boolean;
  soc: number;
  warnings: readonly string[];
}

/**
 * Lamps of an electric car from the combustion lamp set: oil, coolant, glow plug and alternator are dark; the engine
 * lamp (amber) means "power reduced" (battery or motor hot, battery nearly empty), the fuel lamp means low charge.
 */
export function evLamps(base: LampSet, x: EvLampInput): LampSet & { ready: "on" | "off" } {
  const l: LampSet & { ready: "on" | "off" } = { ...base, oil: "off", coolant: "off", glow: "off", battery: "off", gearbox: "off", cat: "off", ready: x.ready ? "on" : "off" };
  if (!x.ignition) return { ...l, engine: "off", fuel: "off" };
  const reduced = x.warnings.some((w) => w === "battery-hot" || w === "motor-hot" || w === "battery-low");
  l.engine = reduced ? "on" : "off";
  l.fuel = x.soc < LOW_SOC ? "on" : "off";
  return l;
}

/** Range in the chosen distance unit, whole numbers. */
export function rangeText(km: number, u: Pick<UnitPrefs, "distance">): string {
  return Number.isFinite(km) ? `${fmt(Math.max(0, toUnit("distance", km, u.distance)))} ${u.distance}` : "–";
}

/** Consumption: kWh/100 km (or kWh/100 mi in miles), "–" at standstill. */
export function consumptionText(kwh100: number, u: Pick<UnitPrefs, "distance">): { value: string; unit: string } {
  const mi = u.distance === "mi";
  const v = mi ? kwh100 * 1.609344 : kwh100;
  return { value: Number.isFinite(v) ? fmt(v, 1) : "–", unit: mi ? "kWh/100 mi" : "kWh/100 km" };
}

export function socText(soc: number): string {
  return `${fmt(Math.round(Math.max(0, Math.min(1, soc)) * 100))} %`;
}

export function driveModeLabel(m: EvDriveMode): string {
  return DRIVE_MODES[m].label;
}

export function nextDriveMode(m: EvDriveMode): EvDriveMode {
  const ids = Object.keys(DRIVE_MODES) as EvDriveMode[];
  return ids[(ids.indexOf(m) + 1) % ids.length]!;
}

/**
 * The switchable fields of the digital design for an EV: the same slots, EV quantities where a combustion value has
 * no meaning (coolant → battery temperature, oil → motor, oil pressure → pack voltage, boost → pack current,
 * exhaust → state of charge, lambda → regen power, consumption and range from the battery).
 */
export function evField(id: FieldId, s: EngineState, u: UnitPrefs): { label: string; value: string; unit: string; warn: boolean } | null {
  const ev = s.ev;
  if (!ev) return null;
  const T = (c: number) => fmt(toUnit("temp", c, u.temp));
  switch (id) {
    case "coolant": return { label: "Akku", value: T(ev.batteryC), unit: u.temp, warn: ev.batteryC > 55 };
    case "oilT":
    case "gearOil": return { label: "E-Motor", value: T(ev.motorC), unit: u.temp, warn: ev.motorC > 150 };
    case "oilP": return { label: "Akkuspannung", value: fmt(ev.packV), unit: "V", warn: false };
    case "boost": return { label: "Akkustrom", value: fmt(ev.packA), unit: "A", warn: false };
    case "egt": return { label: "Ladezustand", value: fmt(Math.round(ev.soc * 100)), unit: "%", warn: ev.soc < LOW_SOC };
    case "lambda": return { label: "Rekuperation", value: fmt(toUnit("power", ev.regenKw, u.power)), unit: u.power, warn: false };
    case "fuelNow": {
      const c = consumptionText(evConsumption(ev), u);
      return { label: "Ø Verbrauch", value: c.value, unit: c.unit, warn: false };
    }
    case "range": {
      const t = rangeText(ev.rangeKm, u);
      return { label: "Reichweite", value: t.split(" ")[0]!, unit: u.distance, warn: ev.soc < LOW_SOC };
    }
    default: return null;
  }
}
