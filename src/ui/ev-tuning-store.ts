// E-Tuner (#108): the tuning of each electric car is stored under its library id and comes back when that car is
// loaded again. Pure (no DOM); the storage is passed in, so it is unit-tested.
import { evTuningOf, validTuning, type EvTuning } from "../data/ev-tuning.ts";
import type { LibraryCar } from "../data/vehicle-library.ts";

export const EV_TUNING_KEY = "pruefzelle.evTuning";

export type Store = Pick<Storage, "getItem" | "setItem">;
function defaultStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(st: Store | null): Record<string, unknown> {
  try {
    const r = JSON.parse(st?.getItem(EV_TUNING_KEY) ?? "{}");
    return r && typeof r === "object" && !Array.isArray(r) ? r : {};
  } catch {
    return {};
  }
}

/** The stored tuning of an electric car (validated against its factory setup), null when it is as delivered. */
export function loadEvTuning(car: LibraryCar, st: Store | null = defaultStore()): EvTuning | null {
  if (!car.setup.ev) return null;
  const raw = readAll(st)[car.id];
  return raw ? validTuning(raw, evTuningOf(car.setup.ev, car.setup.tyre.type)) : null;
}

export function saveEvTuning(carId: string, t: EvTuning, st: Store | null = defaultStore()) {
  const all = readAll(st);
  all[carId] = t;
  try {
    st?.setItem(EV_TUNING_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: lasts for this visit */
  }
}

export function clearEvTuning(carId: string, st: Store | null = defaultStore()) {
  const all = readAll(st);
  delete all[carId];
  try {
    st?.setItem(EV_TUNING_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}
