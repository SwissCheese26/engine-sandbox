// Guided start of the Sandbox (#93): the pure part of the wizard (no DOM), so it can be tested on its own.
// Vehicle kinds and the library filter, the "Eigenes Fahrzeug" form with defaults and validation, the CarSetup built
// from it, and the pending setup the menu hands to the sandbox (App.applyPendingSetup).
import {
  BUS_AUTOMATIC, DEFAULT_SPEED_LIMIT_KMH, DEFAULT_TANK_L, GEARBOXES, TRUCK_AMT, VEHICLES, formatTyreSize, isCommercialKind,
  isMotorcycleKind, parseTyreSize, tyreRadii, withTyre,
} from "../core/index.ts";
import type { CarSetup, DriveLayout, GearboxType, Terrain, VehicleKind } from "../core/index.ts";
import { ENGINE_LIBRARY, type LibraryEngine } from "../data/engine-library.ts";
import { VEHICLE_LIBRARY, type LibraryCar } from "../data/vehicle-library.ts";
import { isListed, migrateTyreSize } from "./tyre-size-picker.ts";
import { findMyEngine, isMyEngineId } from "./my-engines.ts";

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
  /** Electric car (#108): usable battery energy, kWh (then there is no tank). */
  packKwh?: number;
}

/** What a vehicle card in step 2 shows: rated power of its engine, published weight, drive, gearbox, tank. */
export function vehicleFacts(car: LibraryCar): VehicleFacts {
  if (car.setup.ev) {
    // electric car (#108): system power, single-speed reduction, battery instead of a tank
    const n = car.setup.ev.motors.length;
    return {
      ps: Math.round((car.factory.powerKw ?? 0) * PS_PER_KW), kg: car.factory.kerbKg, drive: LAYOUT_SHORT[car.setup.vehicle.driveLayout ?? "rwd"],
      gearbox: `${n} ${n === 1 ? "E-Motor" : "E-Motoren"}, 1 Gang`, tankL: 0, packKwh: car.factory.packKwh ?? 0,
    };
  }
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
// Bike minimum mass = the vehicle panel's minimum (150 kg), so an own bike can be edited there afterwards.
// Dynamic wheel radius (from the tyre size, tyreRadii): the span of the library vehicles of each type with margin
// (Citroën C1 155/65 R14 ≈ 0,28 m … Land Cruiser 265/65 R17 ≈ 0,38 m; bikes ≈ 0,30–0,31 m; truck/bus R22.5 ≈ 0,46–0,49 m).
export const CUSTOM_LIMITS: Record<CustomBase, Record<"massKg" | "cw" | "areaM2" | "tankL" | "radiusM", Range>> = {
  car: { massKg: { min: 500, max: 4000 }, cw: { min: 0.15, max: 0.9 }, areaM2: { min: 1.2, max: 4.5 }, tankL: { min: 5, max: 150 }, radiusM: { min: 0.25, max: 0.45 } },
  truck: { massKg: { min: 3500, max: 44000 }, cw: { min: 0.4, max: 0.9 }, areaM2: { min: 4, max: 12 }, tankL: { min: 50, max: 1200 }, radiusM: { min: 0.4, max: 0.6 } },
  bike: { massKg: { min: 150, max: 600 }, cw: { min: 0.3, max: 0.9 }, areaM2: { min: 0.3, max: 1.5 }, tankL: { min: 2, max: 40 }, radiusM: { min: 0.25, max: 0.38 } },
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

/**
 * A number as typed in a German (or English) form: "1350", "1.350" (thousands), "1.350,5", "0,29", "0.29".
 * A dot followed by exactly three digits in groups is a thousands separator; anything else unclear ("1.2.3",
 * "1,5,0", "1,500.5") is rejected (NaN), never guessed.
 */
export function parseDecimal(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return Number.NaN;
  let t = v.trim().replace(/\s/g, "");
  if (!t) return Number.NaN;
  const dots = (t.match(/\./g) ?? []).length;
  const commas = (t.match(/,/g) ?? []).length;
  if (commas > 1) return Number.NaN;
  if (commas === 1) {
    // comma = decimal; dots before it only as thousands groups
    if (dots && !/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) return Number.NaN;
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  } else if (dots > 1) return Number.NaN;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}
const num = parseDecimal;
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
  const size = parseTyreSize(tyre);
  if (!size) errors.tyre = "Reifengröße als Breite/Querschnitt R Zoll, z. B. 225/45 R17.";
  else {
    const r = tyreRadii(size).dynamicM;
    const rl = lim.radiusM;
    if (r < rl.min || r > rl.max) errors.tyre = `Raddurchmesser passt nicht: Radius ${de(Math.round(r * 1000))} mm, erlaubt ${de(rl.min * 1000)} bis ${de(rl.max * 1000)} mm.`;
    // only sizes of the base type's list (tyre-size-picker.ts); old saves are migrated before (migrateCustomTyre)
    else if (!isListed(base, size)) errors.tyre = `Die Größe ${formatTyreSize(size)} gibt es für ${base === "car" ? "ein Auto" : base === "truck" ? "einen Lkw" : "ein Motorrad"} nicht in der Liste.`;
  }
  const drive = raw.drive as DriveLayout;
  if (!drivesFor(base).includes(drive)) errors.drive = "Diese Antriebsart passt nicht zum Fahrzeugtyp.";
  const gearbox = raw.gearbox as GearboxType;
  if (!gearboxesFor(base).includes(gearbox)) errors.gearbox = "Dieses Getriebe passt nicht zum Fahrzeugtyp.";
  const engineId = typeof raw.engineId === "string" ? raw.engineId : "";
  // own engines from the Engine Builder (#72) fit every vehicle type
  const own = isMyEngineId(engineId) && !!findMyEngine(engineId);
  if (!own && !enginesFor(base).some((e) => e.config.id === engineId)) errors.engineId = "Bitte einen Motor aus der Bibliothek oder einen eigenen Motor wählen.";
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

/**
 * Builds the pending setup from the wizard's choices; null when something is missing. `engineId` (Engine Builder,
 * #72) replaces the engine of a library vehicle and is loaded on the engine dyno too.
 */
export function buildSetup(kind: SetupKind, choice: { vehicleId?: string; custom?: CustomVehicle; route?: Terrain; engineId?: string }): PendingSetup | null {
  if (kind === "engine") return choice.engineId ? { kind, engineId: choice.engineId, route: null } : { kind, route: null };
  if (!choice.route) return null;
  if (kind === "custom") {
    if (!choice.custom) return null;
    return { kind, custom: choice.custom, engineId: choice.custom.engineId, route: choice.route };
  }
  const car = vehiclesOf(kind).find((c) => c.id === choice.vehicleId);
  if (!car) return null;
  return { kind, vehicleId: car.id, engineId: choice.engineId ?? car.engineId, route: choice.route };
}

// --- own vehicle across reloads (#93 review) ------------------------------------------------------------------------

export const OWN_VEHICLE_KEY = "pruefzelle.ownVehicle";

/** The last own vehicle and whether it was the last setup (then the sandbox loads it again on mount). */
export interface StoredOwnVehicle {
  custom: CustomVehicle;
  active: boolean;
}

type Store = Pick<Storage, "getItem" | "setItem">;
function store(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Accepts anything (stored JSON may be old, edited or broken); only a valid own vehicle comes back. */
export function parseOwnVehicle(raw: unknown): StoredOwnVehicle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const custom = (r.custom && typeof r.custom === "object" ? r.custom : {}) as Record<string, unknown>;
  const v = validateCustom(migrateCustomTyre(custom));
  return v.ok ? { custom: v.value, active: r.active === true } : null;
}

/**
 * Tyre of a stored own vehicle (tyre size picker): older saves may hold free text ("225/45ZR17", "225/45-17"), an
 * off-list size or only a wheel radius (tyre as a number, or radiusM / wheelRadiusM). It becomes the nearest size
 * of the base type's list (tyre-size-picker.ts), so the vehicle still loads.
 */
export function migrateCustomTyre(c: Record<string, unknown>): Record<string, unknown> {
  const base: CustomBase = c.base === "truck" || c.base === "bike" ? c.base : "car";
  const raw = c.tyre ?? c.radiusM ?? c.wheelRadiusM;
  const size = migrateTyreSize(base, raw);
  if (!size) return c;
  const { radiusM: _r, wheelRadiusM: _w, ...rest } = c;
  return { ...rest, tyre: formatTyreSize(size) };
}

export function loadOwnVehicle(st: Store | null = store()): StoredOwnVehicle | null {
  try {
    return parseOwnVehicle(JSON.parse(st?.getItem(OWN_VEHICLE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

/** Stores a validated own vehicle (invalid ones are not stored). */
export function saveOwnVehicle(custom: CustomVehicle, active: boolean, st: Store | null = store()) {
  const v = validateCustom(custom);
  if (!v.ok) return;
  try {
    st?.setItem(OWN_VEHICLE_KEY, JSON.stringify({ custom: v.value, active }));
  } catch {
    /* storage unavailable: lasts for this visit */
  }
}

/** Another vehicle (or the engine dyno) became the last setup: the own vehicle stays stored for the form. */
export function setOwnVehicleActive(active: boolean, st: Store | null = store()) {
  const o = loadOwnVehicle(st);
  if (o && o.active !== active) saveOwnVehicle(o.custom, active, st);
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
