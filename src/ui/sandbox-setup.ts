// Guided start of the Sandbox (#93): the pure part of the wizard (no DOM), so it can be tested on its own.
// Vehicle kinds and the library filter, the "Eigenes Fahrzeug" form with defaults and validation, the CarSetup built
// from it, and the pending setup the menu hands to the sandbox (App.applyPendingSetup).
import {
  BUS_AUTOMATIC, DEFAULT_SPEED_LIMIT_KMH, DEFAULT_TANK_L, GEARBOXES, TRUCK_AMT, VEHICLES, formatTyreSize, isCommercialKind,
  isMotorcycleKind, parseTyreSize, withTyre,
} from "../core/index.ts";
import type { CarSetup, DriveLayout, GearboxType, Terrain, VehicleKind } from "../core/index.ts";
import { ENGINE_LIBRARY, type LibraryEngine } from "../data/engine-library.ts";
import { VEHICLE_LIBRARY, type LibraryCar } from "../data/vehicle-library.ts";

/** Library groups of step 1 (Auto, Lkw & Bus, Motorrad). */
export type VehicleGroup = "car" | "commercial" | "bike";
/** Step 1 choice: a library group, an own vehicle, or the engine dyno without a vehicle. */
export type SetupKind = VehicleGroup | "custom" | "engine";

export const KIND_LABEL: Record<SetupKind, string> = {
  car: "Auto",
  commercial: "Lkw & Bus",
  bike: "Motorrad",
  custom: "Eigenes Fahrzeug",
  engine: "Nur Motorprüfstand",
};

/** Mechanical PS per kW (DIN 70020: 1 PS = 735.49875 W). */
export const PS_PER_KW = 1000 / 735.49875;

export function groupOfKind(kind: VehicleKind): VehicleGroup {
  return isMotorcycleKind(kind) ? "bike" : isCommercialKind(kind) ? "commercial" : "car";
}

export function groupOf(car: LibraryCar): VehicleGroup {
  return groupOfKind(car.setup.kind ?? "car");
}

/** Library vehicles of one group, in library order. */
export function vehiclesOf(group: VehicleGroup): LibraryCar[] {
  return VEHICLE_LIBRARY.filter((c) => groupOf(c) === group);
}

export function engineById(id: string): LibraryEngine | undefined {
  return ENGINE_LIBRARY.find((e) => e.config.id === id);
}

const LAYOUT_SHORT: Record<DriveLayout, string> = { fwd: "Frontantrieb", rwd: "Heckantrieb", awd: "Allrad" };
export const GEARBOX_SHORT: Record<GearboxType, string> = {
  manual: "Handschalter",
  dsg: "Doppelkupplung",
  automatic: "Wandlerautomatik",
  cvt: "Stufenlos (CVT)",
  sequential: "Sequenziell",
};

export interface VehicleFacts {
  ps: number;
  kg: number;
  drive: string;
  gearbox: string;
  tankL: number;
}

/** What a vehicle card in step 2 shows: rated power of its engine, published weight, drive, gearbox, tank. */
export function vehicleFacts(car: LibraryCar): VehicleFacts {
  const e = engineById(car.engineId);
  const kind = car.setup.kind ?? "car";
  const bike = isMotorcycleKind(kind);
  const gears = car.setup.gearboxSpec?.ratios.length ?? GEARBOXES[car.setup.gearbox].ratios.length;
  return {
    ps: Math.round((e?.expected.peakPowerKw ?? 0) * PS_PER_KW),
    kg: car.factory.kerbKg,
    drive: bike ? "Kette" : truckLike(kind) ? "Heckantrieb" : LAYOUT_SHORT[car.setup.vehicle.driveLayout ?? "fwd"],
    // the truck AMT is modelled as "dsg" (automated shifting); the label says what a driver would call it
    gearbox: `${kind === "truck" && car.setup.gearbox === "dsg" ? "Automatisiert (AMT)" : GEARBOX_SHORT[car.setup.gearbox]}, ${gears} Gänge`,
    tankL: car.setup.tankL ?? DEFAULT_TANK_L[kind],
  };
}

const truckLike = (k: VehicleKind) => k === "truck" || k === "bus";

// --- Eigenes Fahrzeug ----------------------------------------------------------------------------------------------

/** Base types of an own vehicle and the drivetrain preset each starts from. */
export type CustomBase = "car" | "truck" | "bike";
export const CUSTOM_BASE_LABEL: Record<CustomBase, string> = { car: "Auto", truck: "Lkw", bike: "Motorrad" };
const BASE_KIND: Record<CustomBase, VehicleKind> = { car: "car", truck: "truck", bike: "superbike" };

export interface CustomVehicle {
  base: CustomBase;
  massKg: number;
  cw: number;
  areaM2: number;
  /** Tyre size as written on the sidewall, e.g. "225/45 R17". */
  tyre: string;
  drive: DriveLayout;
  gearbox: GearboxType;
  tankL: number;
  engineId: string;
}

export type CustomField = Exclude<keyof CustomVehicle, "base">;

interface Range {
  min: number;
  max: number;
}
/** Plausible ranges per base type (mass incl. driver; the vehicle panel allows 150 … 44 000 kg overall). */
export const CUSTOM_LIMITS: Record<CustomBase, Record<"massKg" | "cw" | "areaM2" | "tankL", Range>> = {
  car: { massKg: { min: 500, max: 4000 }, cw: { min: 0.15, max: 0.9 }, areaM2: { min: 1.2, max: 4.5 }, tankL: { min: 5, max: 150 } },
  truck: { massKg: { min: 3500, max: 44000 }, cw: { min: 0.4, max: 0.9 }, areaM2: { min: 4, max: 12 }, tankL: { min: 50, max: 1200 } },
  bike: { massKg: { min: 100, max: 600 }, cw: { min: 0.3, max: 0.9 }, areaM2: { min: 0.3, max: 1.5 }, tankL: { min: 2, max: 40 } },
};

/** Gearboxes an own vehicle of this base can have (the drivetrain presets' choice; Lkw: AMT or converter automatic). */
export function gearboxesFor(base: CustomBase): GearboxType[] {
  return base === "truck" ? ["dsg", "automatic"] : [...VEHICLES[BASE_KIND[base]].gearboxes];
}

export function drivesFor(base: CustomBase): DriveLayout[] {
  // a motorcycle drives the rear wheel, a truck the rear axle
  return base === "car" ? ["fwd", "rwd", "awd"] : ["rwd"];
}

/** Engines offered for an own vehicle: the library category that fits the base type. */
export function enginesFor(base: CustomBase): LibraryEngine[] {
  const cat = base === "bike" ? "motorcycle" : base === "truck" ? "commercial" : "car";
  return ENGINE_LIBRARY.filter((e) => (e.category ?? "car") === cat);
}

const DEFAULT_ENGINE: Record<CustomBase, string> = {
  car: "lib-vw-ea189-20tdi-103kw",
  truck: "lib-mercedes-om471",
  bike: "lib-honda-cbr1000rr-sc59",
};

/** Sensible start values: the drivetrain preset of the base type (Golf-class car, 40 t truck, superbike). */
export function defaultCustom(base: CustomBase): CustomVehicle {
  const p = VEHICLES[BASE_KIND[base]];
  const engine = enginesFor(base).find((e) => e.config.id === DEFAULT_ENGINE[base]) ?? enginesFor(base)[0];
  return {
    base,
    // the truck preset carries its empty mass; an own truck starts fully loaded (the preset's gross mass)
    massKg: base === "truck" ? (p.fullMassKg ?? p.params.massKg) : p.params.massKg,
    cw: p.params.dragCoefficient,
    areaM2: p.params.frontalAreaM2,
    tyre: formatTyreSize(p.tyre.size),
    drive: base === "car" ? (p.params.driveLayout ?? "fwd") : "rwd",
    gearbox: gearboxesFor(base)[0]!,
    tankL: DEFAULT_TANK_L[BASE_KIND[base]],
    engineId: engine?.config.id ?? "",
  };
}

export type CustomResult = { ok: true; value: CustomVehicle } | { ok: false; errors: Partial<Record<CustomField, string>> };

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : Number.NaN);
const de = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });

/** Checks the form values (strings from inputs or numbers). Every bad field gets a German message. */
export function validateCustom(raw: Partial<Record<keyof CustomVehicle, unknown>>): CustomResult {
  const base: CustomBase = raw.base === "truck" || raw.base === "bike" ? raw.base : "car";
  const lim = CUSTOM_LIMITS[base];
  const errors: Partial<Record<CustomField, string>> = {};
  const range = (k: "massKg" | "cw" | "areaM2" | "tankL", what: string, unit: string): number => {
    const n = num(raw[k]);
    const r = lim[k];
    if (!Number.isFinite(n)) errors[k] = `${what}: bitte eine Zahl eingeben.`;
    else if (n < r.min || n > r.max) errors[k] = `${what}: ${de(r.min)} bis ${de(r.max)}${unit} für ${CUSTOM_BASE_LABEL[base] === "Auto" ? "ein Auto" : CUSTOM_BASE_LABEL[base] === "Lkw" ? "einen Lkw" : "ein Motorrad"}.`;
    return n;
  };
  const massKg = range("massKg", "Gewicht", " kg");
  const cw = range("cw", "cW-Wert", "");
  const areaM2 = range("areaM2", "Stirnfläche", " m²");
  const tankL = range("tankL", "Tank", " l");
  const tyre = typeof raw.tyre === "string" ? raw.tyre.trim() : "";
  if (!parseTyreSize(tyre)) errors.tyre = "Reifengröße als Breite/Querschnitt R Zoll, z. B. 225/45 R17.";
  const drive = raw.drive as DriveLayout;
  if (!drivesFor(base).includes(drive)) errors.drive = "Diese Antriebsart passt nicht zum Fahrzeugtyp.";
  const gearbox = raw.gearbox as GearboxType;
  if (!gearboxesFor(base).includes(gearbox)) errors.gearbox = "Dieses Getriebe passt nicht zum Fahrzeugtyp.";
  const engineId = typeof raw.engineId === "string" ? raw.engineId : "";
  if (!enginesFor(base).some((e) => e.config.id === engineId)) errors.engineId = "Bitte einen Motor aus der Bibliothek wählen.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { base, massKg, cw, areaM2, tyre: formatTyreSize(parseTyreSize(tyre)!), drive, gearbox, tankL, engineId } };
}

/** The CarSetup of a (validated) own vehicle: preset of the base type with the player's values on top. */
export function customSetup(c: CustomVehicle): CarSetup {
  const kind = BASE_KIND[c.base];
  const p = VEHICLES[kind];
  const tyre = { ...p.tyre, size: parseTyreSize(c.tyre) ?? { ...p.tyre.size } };
  const gearboxSpec = c.base === "truck"
    ? structuredClone(c.gearbox === "automatic" ? BUS_AUTOMATIC : TRUCK_AMT)
    : structuredClone({ ...GEARBOXES[c.gearbox], finalDrive: c.gearbox === p.gearboxes[0] ? p.finalDrive : GEARBOXES[c.gearbox].finalDrive });
  return {
    kind,
    tankL: c.tankL,
    // the mass is the mass as driven (incl. driver, and the load of a truck): no separate load control
    vehicle: withTyre({ ...p.params, massKg: c.massKg, dragCoefficient: c.cw, frontalAreaM2: c.areaM2, driveLayout: c.drive }, tyre),
    tyre,
    gearbox: c.gearbox,
    gearboxSpec,
    // trucks: EU limiter 85 km/h (RL 92/6/EWG); cars: the voluntary 250 km/h; motorcycles: none
    speedLimitKmh: c.base === "truck" ? 85 : c.base === "car" ? DEFAULT_SPEED_LIMIT_KMH : null,
  };
}

// --- pending setup: menu → sandbox ----------------------------------------------------------------------------------

export interface PendingSetup {
  kind: SetupKind;
  /** Library vehicle (kinds car / commercial / bike). */
  vehicleId?: string;
  /** Own vehicle (kind custom). */
  custom?: CustomVehicle;
  /** Library engine to load with the vehicle. */
  engineId?: string;
  /** Route on the chassis dyno; null for the engine dyno. */
  route: Terrain | null;
}

/** Builds the pending setup from the wizard's choices; null when something is missing. */
export function buildSetup(kind: SetupKind, choice: { vehicleId?: string; custom?: CustomVehicle; route?: Terrain }): PendingSetup | null {
  if (kind === "engine") return { kind, route: null };
  if (!choice.route) return null;
  if (kind === "custom") {
    if (!choice.custom) return null;
    return { kind, custom: choice.custom, engineId: choice.custom.engineId, route: choice.route };
  }
  const car = vehiclesOf(kind).find((c) => c.id === choice.vehicleId);
  if (!car) return null;
  return { kind, vehicleId: car.id, engineId: car.engineId, route: choice.route };
}

let pending: PendingSetup | null = null;

/** Set by the wizard; null = "Weiter wie zuletzt" (the sandbox stays as it was). */
export function setPendingSetup(p: PendingSetup | null) {
  pending = p;
}

/** The setup chosen in the menu, once (the sandbox takes it when it is shown). */
export function takePendingSetup(): PendingSetup | null {
  const p = pending;
  pending = null;
  return p;
}
