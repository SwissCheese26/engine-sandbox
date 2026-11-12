/**
 * Fuel tank of the vehicle on the chassis dyno (Arthur's request): capacity from the vehicle (library cars and
 * bikes carry the manufacturer's tank volume), drained by the engine's fuel flow. An empty tank starves the engine
 * (SimInputs.fuelEmpty → no injection), it stalls like a car that ran dry. Pure, no DOM.
 *
 * Reserve: the warning lamp of most cars comes on with roughly 1/8 of the tank left (e.g. Golf: ≈ 7 l of 55 l),
 * motorcycles ≈ 3–4 l [S].
 */
import type { VehicleKind } from "./drivetrain.ts";

/** Tank volume when the vehicle does not say (custom body): a compact car, a superbike, a touring bike. */
export const DEFAULT_TANK_L: Record<VehicleKind, number> = { car: 55, superbike: 17, tourer: 20, truck: 600, bus: 300 };

/** Share of the tank at which the reserve lamp lights. */
export const RESERVE_SHARE = 0.125;

export class FuelTank {
  private cap: number;
  private level: number;

  constructor(capacityL: number, levelL = capacityL) {
    this.cap = FuelTank.clampCap(capacityL);
    this.level = Math.min(this.cap, Math.max(0, Number.isFinite(levelL) ? levelL : this.cap));
  }

  private static clampCap(l: number): number {
    return Number.isFinite(l) && l > 0 ? Math.min(400, Math.max(2, l)) : DEFAULT_TANK_L.car;
  }

  get capacityL(): number {
    return this.cap;
  }

  get levelL(): number {
    return this.level;
  }

  /** 0 … 1 */
  get fraction(): number {
    return this.level / this.cap;
  }

  get reserve(): boolean {
    return this.fraction <= RESERVE_SHARE;
  }

  get empty(): boolean {
    return this.level <= 0;
  }

  /** Drains the fuel the engine burned in dt (l/h from the engine state). */
  step(dt: number, fuelFlowLh: number): void {
    if (!(dt > 0) || dt > 1 || !(fuelFlowLh > 0) || !Number.isFinite(fuelFlowLh)) return;
    this.level = Math.max(0, this.level - (fuelFlowLh * dt) / 3600);
  }

  /** Sets the content (clamped to 0 … capacity), e.g. a saved level. */
  setLevel(levelL: number): void {
    if (Number.isFinite(levelL)) this.level = Math.min(this.cap, Math.max(0, levelL));
  }

  refill(): void {
    this.level = this.cap;
  }

  /** Another vehicle: its tank, full (a new car comes fuelled). */
  setCapacity(capacityL: number, full = true): void {
    const f = this.fraction;
    this.cap = FuelTank.clampCap(capacityL);
    this.level = full ? this.cap : f * this.cap;
  }

  toJSON(): { capacityL: number; levelL: number } {
    return { capacityL: this.cap, levelL: this.level };
  }

  static fromJSON(raw: unknown): FuelTank | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const c = o.capacityL;
    const l = o.levelL;
    if (typeof c !== "number" || typeof l !== "number" || !Number.isFinite(c) || !Number.isFinite(l)) return null;
    return new FuelTank(c, l);
  }
}
