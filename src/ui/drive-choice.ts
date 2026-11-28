// "Antrieb" choice (issue #154): any library engine, any own engine (Engine Builder) or any electric drive (library EV
// drives as delivered or as set in the E-Tuner) into any vehicle. The choice is a string id, stored per vehicle:
//   "" = factory drive · an engine id (library or "my-…") · "ev:<car id>" · "evt:<car id>" (that car's E-Tuner setup).
import type { DriveSpec, VehicleKind } from "../core/index.ts";
import { driveMassKg, engineDrive, factoryDrive, withDrive } from "../data/drive-swap.ts";
import { ENGINE_LIBRARY, type LibraryEngine } from "../data/engine-library.ts";
import { tuneEv } from "../data/ev-tuning.ts";
import { VEHICLE_LIBRARY, type LibraryCar } from "../data/vehicle-library.ts";
import { loadEvTuning } from "./ev-tuning-store.ts";
import { loadMyEngines, resolveEngine } from "./my-engines.ts";

export const DRIVE_KEY = "pruefzelle.drive";

const EV_CARS = () => VEHICLE_LIBRARY.filter((c) => c.setup.ev);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The drive behind an id; null when it does not exist (any more). `engineId`: the engine to put on the bench. */
export function resolveDrive(id: string, kind: VehicleKind = "car"): { spec: DriveSpec; engineId: string | null } | null {
  const m = /^(evt?):(.+)$/.exec(id);
  if (m) {
    const donor = EV_CARS().find((c) => c.id === m[2]);
    if (!donor) return null;
    const base = factoryDrive(donor);
    if (m[1] === "ev") return { spec: base, engineId: null };
    const stored = loadEvTuning(donor);
    if (!stored) return null;
    const t = tuneEv(donor.setup.ev!, stored, donor.setup.vehicle.wheelRadiusM);
    // deltaKg counts the motor/pack change too; driveMassKg already has it from the tuned config
    const extraKg = t.deltaKg - (driveMassKg({ ev: t.ev }) - driveMassKg(base));
    return { spec: { ev: t.ev, extraKg }, engineId: null };
  }
  const cfg = resolveEngine(id);
  return cfg ? { spec: engineDrive(cfg, kind), engineId: id } : null;
}

/**
 * The vehicle as it drives with that drive: the library car itself for "" (or an unknown drive), else a copy with the
 * swapped setup, the drive's engine and an own id (the E-Tuner stores its setup per vehicle and drive).
 */
export function carWithDrive(car: LibraryCar, id: string): LibraryCar {
  const d = id ? resolveDrive(id, car.setup.kind ?? "car") : null;
  if (!d) return car;
  return { ...car, id: `${car.id}@${id}`, engineId: d.engineId ?? "", setup: withDrive(car, d.spec) };
}

/** <option>s of the Antrieb select: factory (unless null), own engines, electric drives, library engines by class. */
export function driveOptionsHtml(factoryLabel: string | null = "Werksantrieb"): string {
  const opt = (v: string, t: string) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const group = (label: string, items: string[]) => (items.length ? `<optgroup label="${label}">${items.join("")}</optgroup>` : "");
  const lib = (pick: (e: LibraryEngine) => boolean) => ENGINE_LIBRARY.filter(pick).map((e) => opt(e.config.id, `${e.config.name}${e.cars ? ` – ${e.cars}` : ""}`));
  const cat = (e: LibraryEngine) => e.category ?? "car";
  return [
    factoryLabel === null ? "" : opt("", factoryLabel),
    group("Eigene Motoren", loadMyEngines().map((e) => opt(e.id, e.name))),
    group("Elektro ⚡", EV_CARS().flatMap((c) => [opt(`ev:${c.id}`, `⚡ ${c.name}`), ...(loadEvTuning(c) ? [opt(`evt:${c.id}`, `⚡ ${c.name} (E-Tuner)`)] : [])])),
    group("Diesel", lib((e) => cat(e) === "car" && e.config.fuel === "diesel")),
    group("Benziner", lib((e) => cat(e) === "car" && e.config.fuel === "petrol")),
    group("Lkw & Bus", lib((e) => cat(e) === "commercial")),
    group("Motorrad", lib((e) => cat(e) === "motorcycle")),
  ].join("");
}

type Store = Pick<Storage, "getItem" | "setItem">;
function store(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
function readAll(st: Store | null): Record<string, string> {
  try {
    const r = JSON.parse(st?.getItem(DRIVE_KEY) ?? "{}") as unknown;
    return r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Stored drive of a vehicle ("" = factory). */
export function loadDriveChoice(key: string, st: Store | null = store()): string {
  const v = readAll(st)[key];
  return typeof v === "string" ? v : "";
}

export function saveDriveChoice(key: string, id: string, st: Store | null = store()) {
  const all = readAll(st);
  if (id) all[key] = id;
  else delete all[key];
  try {
    st?.setItem(DRIVE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: lasts for this visit */
  }
}
