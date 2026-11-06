/**
 * Board computer (issues #40, #41): odometer that cannot be reset ("Gesamt") and a resettable trip
 * ("Trip A"), each with distance, fuel used and driving time → average consumption and average speed.
 *
 * Counts only while the car drives on the chassis dyno (dynoMode "vehicle") with the engine running:
 * an engine on the engine dyno has no road distance, and its fuel would distort l/100 km.
 * Average consumption = fuel used / distance (integrated), not the mean of momentary values.
 * Pure TypeScript, no DOM; persistence is done by the UI via toJSON()/fromJSON().
 */
import type { EngineState } from "./types.ts";

export interface TripCounter {
  /** Distance, km. */
  km: number;
  /** Fuel used, litres. */
  fuelL: number;
  /** Driving time (engine running, vehicle mode), seconds. */
  timeS: number;
}

export interface TripComputerData {
  total: TripCounter;
  tripA: TripCounter;
}

const empty = (): TripCounter => ({ km: 0, fuelL: 0, timeS: 0 });

/** Below this distance an average in l/100 km is not meaningful (shown as "–"). */
export const MIN_KM_FOR_AVERAGE = 0.1;

export class TripComputer {
  private d: TripComputerData = { total: empty(), tripA: empty() };

  get data(): Readonly<TripComputerData> {
    return this.d;
  }

  /**
   * Adds one frame. `dt` in s. Only counts when `driving` (chassis dyno) and the engine runs.
   * Ignores invalid values (NaN, negative) so a glitch can never corrupt the odometer.
   */
  step(dt: number, s: EngineState, driving: boolean): void {
    if (!driving || !s.running || !(dt > 0) || dt > 1) return;
    const v = s.vehicleSpeedMs ?? 0;
    const km = Number.isFinite(v) && v > 0 ? (v * dt) / 1000 : 0;
    const fuelL = Number.isFinite(s.fuelFlowLh) && s.fuelFlowLh > 0 ? (s.fuelFlowLh * dt) / 3600 : 0;
    for (const c of [this.d.total, this.d.tripA]) {
      c.km += km;
      c.fuelL += fuelL;
      c.timeS += dt;
    }
  }

  /** Trip A back to zero. The total (odometer) cannot be reset. */
  resetTripA(): void {
    this.d.tripA = empty();
  }

  toJSON(): TripComputerData {
    return structuredClone(this.d);
  }

  /** Restores saved data; invalid or missing values fall back to 0. */
  static fromJSON(raw: unknown): TripComputer {
    const t = new TripComputer();
    const ok = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
    const read = (c: unknown): TripCounter => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { km: ok(o.km), fuelL: ok(o.fuelL), timeS: ok(o.timeS) };
    };
    const r = (raw ?? {}) as Record<string, unknown>;
    t.d = { total: read(r.total), tripA: read(r.tripA) };
    return t;
  }
}

/** Average consumption in l/100 km, NaN below MIN_KM_FOR_AVERAGE. */
export function averageL100(c: TripCounter): number {
  return c.km >= MIN_KM_FOR_AVERAGE ? (c.fuelL / c.km) * 100 : Number.NaN;
}

/** Average speed in km/h over the driving time, NaN without time. */
export function averageKmh(c: TripCounter): number {
  return c.timeS > 1 ? c.km / (c.timeS / 3600) : Number.NaN;
}
