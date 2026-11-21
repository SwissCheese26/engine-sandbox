// Per-vehicle customisations on the chassis dyno: what the player changed on one vehicle (gearbox type, own gear
// ratios, final drive, tyres, body and drive layout, tank size, Vmax governor) is stored under that vehicle and only
// comes back on that vehicle. Library vehicles are keyed by their id, an own vehicle by "own:<kind>" together with a
// signature of the setup it was built from (a newly built own vehicle starts from its own factory state).
// Pure module (no DOM); the storage is passed in, so it is unit-tested.
import { AFTERMARKET_OIL_COOLER_WK, GEARBOX_THERMAL, GEAR_COUNT_MIN, gearboxThermalKind } from "../core/index.ts";
import type { CarSetup, Drivetrain, DriveLayout, GearboxType, TyreSetup, VehicleKind, VehicleParams } from "../core/index.ts";

export const CUSTOM_KEY = "pruefzelle.vehicleCustom";
/** Before this change: one global set of own ratios ({ kind, type, ratios }) and one global governor choice. */
export const LEGACY_RATIOS_KEY = "pruefzelle.gearRatios";
export const LEGACY_LIMIT_KEY = "pruefzelle.vmaxLimit";
/** The tank record names the vehicle that was active last (gearbox-panel.ts). */
export const TANK_KEY = "pruefzelle.tank";

const GEARBOX_TYPES: readonly GearboxType[] = ["manual", "dsg", "automatic", "cvt", "sequential"];
const LAYOUTS: readonly DriveLayout[] = ["fwd", "rwd", "awd"];
const BODY_KEYS = ["massKg", "dragCoefficient", "frontalAreaM2", "cgHeightM", "cgToRearAxleM", "wheelbaseM"] as const;

export type BodyEdit = Partial<Pick<VehicleParams, (typeof BODY_KEYS)[number] | "driveLayout">>;

/** Everything the player can change on one vehicle. Missing parts keep the factory value. */
export interface VehicleCustom {
  /** Own vehicle only: signature of the setup it was built from. */
  sig?: string;
  kind: VehicleKind;
  gearbox?: GearboxType;
  /** Own gear ratios, valid for this gearbox type. */
  ratios?: { type: GearboxType; ratios: number[] };
  finalDrive?: number;
  tyre?: TyreSetup;
  body?: BodyEdit;
  tankL?: number;
  /** Vmax governor in km/h, null = off; undefined = factory. */
  speedLimitKmh?: number | null;
  /** Gearbox oil cooler: factory, aftermarket air-to-oil cooler on top, or the factory cooler off. */
  oilCooler?: OilCooler;
}

export type OilCooler = "serie" | "zubehoer" | "aus";
export const OIL_COOLER_LABEL: Record<OilCooler, string> = { serie: "Serie", zubehoer: "Ölkühler (Zubehör)", aus: "Aus" };

/** Cooler choices of the loaded gearbox: "Aus" only where the factory has a cooler; none for a shared sump (motorcycle). */
export function oilCoolerChoices(d: Drivetrain): OilCooler[] {
  const spec = GEARBOX_THERMAL[gearboxThermalKind(d.state.type, d.kind)];
  if (spec.sharedSump) return [];
  return spec.coolerWK > 0 ? ["serie", "zubehoer", "aus"] : ["serie", "zubehoer"];
}

export function currentOilCooler(d: Drivetrain): OilCooler {
  return d.gearboxAuxCoolerWK > 0 ? "zubehoer" : d.gearboxCooler ? "serie" : "aus";
}

/** Puts a cooler choice on the drivetrain (a choice the gearbox does not offer falls back to "Serie"). */
export function setOilCooler(d: Drivetrain, c: OilCooler) {
  const ok = oilCoolerChoices(d).includes(c) ? c : "serie";
  d.setGearboxCooler(ok !== "aus");
  d.setGearboxAuxCooler(ok === "zubehoer" ? AFTERMARKET_OIL_COOLER_WK : 0);
}

export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function defaultStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Storage key of a vehicle: the library id, or "own:<kind>" for an own vehicle (carId ""). */
export function vehicleKey(carId: string, kind: VehicleKind): string {
  return carId ? carId : `own:${kind}`;
}

/** Short, stable signature of an own vehicle's base setup (FNV-1a over its JSON). */
export function setupSig(setup: CarSetup): string {
  const s = JSON.stringify(setup);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isType = (x: unknown): x is GearboxType => typeof x === "string" && (GEARBOX_TYPES as readonly string[]).includes(x);

/** One stored entry, shape-checked; broken parts are dropped, a broken entry → null. The values are checked by the core. */
export function parseCustom(raw: unknown): VehicleCustom | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== "string") return null;
  const out: VehicleCustom = { kind: r.kind as VehicleKind };
  if (typeof r.sig === "string") out.sig = r.sig;
  if (isType(r.gearbox)) out.gearbox = r.gearbox;
  const rt = r.ratios as Record<string, unknown> | undefined;
  if (rt && isType(rt.type) && Array.isArray(rt.ratios) && rt.ratios.length >= GEAR_COUNT_MIN && rt.ratios.every(isNum)) {
    out.ratios = { type: rt.type, ratios: [...(rt.ratios as number[])] };
  }
  if (isNum(r.finalDrive)) out.finalDrive = r.finalDrive;
  const t = r.tyre as Record<string, unknown> | undefined;
  const size = t?.size as Record<string, unknown> | undefined;
  if (t && typeof t.type === "string" && typeof t.speedIndex === "string" && size && isNum(size.widthMm) && isNum(size.aspectPct) && isNum(size.rimInch)) {
    out.tyre = { type: t.type, speedIndex: t.speedIndex, size: { widthMm: size.widthMm, aspectPct: size.aspectPct, rimInch: size.rimInch } } as TyreSetup;
  }
  const b = r.body as Record<string, unknown> | undefined;
  if (b && typeof b === "object") {
    const body: BodyEdit = {};
    for (const k of BODY_KEYS) if (isNum(b[k])) body[k] = b[k] as number;
    if (typeof b.driveLayout === "string" && (LAYOUTS as readonly string[]).includes(b.driveLayout)) body.driveLayout = b.driveLayout as DriveLayout;
    if (Object.keys(body).length) out.body = body;
  }
  if (isNum(r.tankL)) out.tankL = r.tankL;
  if (r.speedLimitKmh === null || isNum(r.speedLimitKmh)) out.speedLimitKmh = r.speedLimitKmh as number | null;
  if (r.oilCooler === "serie" || r.oilCooler === "zubehoer" || r.oilCooler === "aus") out.oilCooler = r.oilCooler;
  return out;
}

export function loadAll(st: Store | null = defaultStore()): Record<string, VehicleCustom> {
  try {
    const raw = JSON.parse(st?.getItem(CUSTOM_KEY) ?? "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, VehicleCustom> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const c = parseCustom(v);
      if (c) out[k] = c;
    }
    return out;
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, VehicleCustom>, st: Store | null) {
  try {
    if (Object.keys(all).length) st?.setItem(CUSTOM_KEY, JSON.stringify(all));
    else st?.removeItem(CUSTOM_KEY);
  } catch {
    // storage blocked: the changes last for this visit
  }
}

/** The customisation of one vehicle; for an own vehicle only when it was built from the same setup (sig). */
export function loadCustom(key: string, sig?: string, st: Store | null = defaultStore()): VehicleCustom | null {
  migrateLegacy(st);
  const c = loadAll(st)[key] ?? null;
  if (!c) return null;
  // an entry without sig (migrated) belongs to whatever own vehicle of that kind comes next
  if (sig !== undefined && c.sig !== undefined && c.sig !== sig) return null;
  return c;
}

export function saveCustom(key: string, c: VehicleCustom, st: Store | null = defaultStore()) {
  const all = loadAll(st);
  all[key] = c;
  saveAll(all, st);
}

/** "Auf Werkszustand zurücksetzen": forgets the vehicle's changes. */
export function clearCustom(key: string, st: Store | null = defaultStore()) {
  const all = loadAll(st);
  if (!(key in all)) return;
  delete all[key];
  saveAll(all, st);
}

/**
 * Old saves: the global own ratios ({ kind, type, ratios }) and the global governor choice are attached to the
 * vehicle that was active last (named by the tank record), when its kind matches; otherwise they are dropped. The
 * old keys are removed either way, so this runs once.
 */
export function migrateLegacy(st: Store | null = defaultStore()) {
  if (!st) return;
  let ratiosText: string | null;
  let limitText: string | null;
  try {
    ratiosText = st.getItem(LEGACY_RATIOS_KEY);
    limitText = st.getItem(LEGACY_LIMIT_KEY);
  } catch {
    return;
  }
  if (ratiosText === null && limitText === null) return;
  let active: { vehicle: string; kind: VehicleKind } | null = null;
  try {
    const t = JSON.parse(st.getItem(TANK_KEY) ?? "null") as Record<string, unknown> | null;
    if (t && typeof t === "object") active = { vehicle: typeof t.vehicle === "string" ? t.vehicle : "", kind: (typeof t.kind === "string" ? t.kind : "car") as VehicleKind };
  } catch {
    active = null;
  }
  const all = loadAll(st);
  if (active) {
    const key = vehicleKey(active.vehicle, active.kind);
    const entry: VehicleCustom = all[key] ?? { kind: active.kind };
    let changed = false;
    try {
      const r = JSON.parse(ratiosText ?? "null") as Record<string, unknown> | null;
      if (r && r.kind === active.kind && isType(r.type) && Array.isArray(r.ratios) && r.ratios.length >= GEAR_COUNT_MIN && r.ratios.every(isNum)) {
        entry.gearbox = r.type;
        entry.ratios = { type: r.type, ratios: [...(r.ratios as number[])] };
        changed = true;
      }
    } catch {
      // broken: dropped
    }
    // the governor choice was a car's choice (trucks/buses never stored it)
    if (limitText !== null && (active.kind === "car" || active.kind === "superbike" || active.kind === "tourer")) {
      if (limitText === "off") entry.speedLimitKmh = null;
      else if (isNum(Number(limitText)) && Number(limitText) > 0) entry.speedLimitKmh = Number(limitText);
      changed = changed || entry.speedLimitKmh !== undefined;
    }
    if (changed) {
      all[key] = entry;
      saveAll(all, st);
    }
  }
  try {
    st.removeItem(LEGACY_RATIOS_KEY);
    st.removeItem(LEGACY_LIMIT_KEY);
  } catch {
    // storage blocked
  }
}

/** Snapshot of the vehicle as it is now on the drivetrain (stored after every own change). */
export function captureCustom(d: Drivetrain, sig?: string): VehicleCustom {
  const v = d.vehicle;
  const s = d.state;
  const body: BodyEdit = { driveLayout: v.driveLayout };
  for (const k of BODY_KEYS) if (isNum(v[k])) body[k] = v[k] as number;
  return {
    ...(sig !== undefined ? { sig } : {}),
    kind: d.kind,
    gearbox: s.type,
    ...(s.type !== "cvt" ? { ratios: { type: s.type, ratios: [...d.gearbox.ratios] } } : {}),
    finalDrive: s.finalDrive,
    tyre: { type: d.tyre.type, speedIndex: d.tyre.speedIndex, size: { ...d.tyre.size } },
    body,
    tankL: d.tank.capacityL,
    speedLimitKmh: s.speedLimitKmh,
    oilCooler: currentOilCooler(d),
  };
}

/**
 * Puts a stored customisation on top of the factory setup that was just loaded (vehicle at standstill). Parts the
 * core refuses are skipped; returns the parts that could not be applied (for a note).
 */
export function applyCustom(d: Drivetrain, c: VehicleCustom): string[] {
  const failed: string[] = [];
  if (c.kind !== d.kind) return ["Fahrzeugart"];
  if (c.gearbox && c.gearbox !== d.state.type) d.setType(c.gearbox);
  if (c.ratios && c.ratios.type === d.state.type) {
    const err = d.setRatios(c.ratios.ratios);
    if (err) failed.push(`Übersetzungen (${err})`);
  }
  if (c.finalDrive !== undefined) d.setFinalDrive(c.finalDrive);
  if (c.tyre) d.setTyre(c.tyre);
  if (c.body) d.setVehicleParams(c.body);
  if (c.tankL !== undefined && c.tankL > 0) {
    d.tank.setCapacity(c.tankL);
  }
  if (c.speedLimitKmh !== undefined) d.setSpeedLimit(c.speedLimitKmh);
  if (c.oilCooler) setOilCooler(d, c.oilCooler);
  return failed;
}

/**
 * Loads a vehicle: its factory state (`factory` puts it on the drivetrain), then its own stored changes, if any.
 * Returns whether the vehicle carries own changes, and the parts that could not be applied.
 */
export function loadVehicle(d: Drivetrain, factory: () => void, key: string, sig?: string, st: Store | null = defaultStore()): { custom: boolean; failed: string[] } {
  factory();
  setOilCooler(d, "serie");
  const c = loadCustom(key, sig, st);
  if (!c) return { custom: false, failed: [] };
  const failed = applyCustom(d, c);
  return { custom: true, failed };
}
