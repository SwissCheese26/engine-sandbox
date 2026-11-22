// Eigene Motoren (#72): engines built in the Engine Builder, stored per browser in localStorage
// (`pruefzelle.myEngines`). Pure, no DOM, so it runs in unit tests. Every stored engine is checked on load: the
// shape against the EngineConfig contract (types and enums), the numbers into the workbench ranges
// (normalizeConfig). Saving additionally refuses configurations with a critical finding of the core's
// validateConfig, so only physically sensible engines are stored.
import { validateConfig } from "../core/index.ts";
import type {
  Aspiration, BlockMaterial, ConrodType, CoolingType, CrankshaftType, CylinderLayout, DieselFuel, DieselInjection, EngineConfig,
  EmissionsStandard, ExhaustManifold, FuelKind, Intercooler, OverrunPops, PetrolFuel, PetrolMixture, PistonType, V8Crank, Valvetrain, VariableValveTiming,
  Warning,
} from "../core/index.ts";
import { ENGINE_LIBRARY, libraryConfig } from "../data/engine-library.ts";
import { normalizeConfig } from "./fields.ts";
import { autoName } from "./names.ts";

export const MY_ENGINES_KEY = "pruefzelle.myEngines";
/** At most this many own engines are kept (oldest beyond it are dropped on save). */
export const MY_ENGINES_MAX = 50;
/** Longest name (library names reach 56 characters). */
export const NAME_MAX = 64;
const ID_PREFIX = "my-";

export interface StoredEngine {
  /** Stable id, also `config.id`; starts with "my-". */
  id: string;
  /** Shown name, also `config.name`. */
  name: string;
  /** ISO time of the last save. */
  savedAt: string;
  config: EngineConfig;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function store(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// --- shape check against the contract ------------------------------------------------------------------------------

/** Compile-time check that an enum list names every member of its union (and nothing else). */
type Exhaustive<U, L extends readonly U[]> = Exclude<U, L[number]> extends never ? L : never;
const list = <U>() => <const L extends readonly U[]>(l: Exhaustive<U, L>) => l;

const LAYOUTS = list<CylinderLayout>()(["inline", "v", "boxer", "vr", "w"]);
const BLOCK_MATERIALS = list<BlockMaterial>()(["cast-iron", "compacted-graphite-iron", "aluminium"]);
const CRANKS = list<CrankshaftType>()(["cast", "forged", "billet"]);
const PISTONS = list<PistonType>()(["cast-aluminium", "forged-aluminium", "steel"]);
const RODS = list<ConrodType>()(["cast-steel", "forged-steel", "titanium"]);
const V8_CRANKS = list<V8Crank>()(["crossplane", "flatplane"]);
const VALVETRAINS = list<Valvetrain>()(["ohv", "sohc", "dohc"]);
const VVT = list<VariableValveTiming>()(["none", "intake-cam", "dual-cam", "cam-switching"]);
const EMISSIONS = list<EmissionsStandard>()(["pre-euro", "euro1", "euro2", "euro3", "euro4", "euro5", "euro6"]);
const ASPIRATIONS = list<Aspiration>()([
  "naturally-aspirated", "turbo", "twin-turbo-parallel", "twin-turbo-sequential", "supercharger-roots", "supercharger-centrifugal", "e-turbo",
]);
const INTERCOOLERS = list<Intercooler>()(["none", "air-to-air", "air-to-water"]);
const INJECTIONS = list<DieselInjection>()(["indirect-prechamber", "indirect-swirl-chamber", "unit-injector", "common-rail", "mechanical-pump"]);
const DIESEL_FUELS = list<DieselFuel>()(["diesel", "hvo", "biodiesel"]);
const MIXTURES = list<PetrolMixture>()(["carburettor", "port-injection", "direct-injection", "dual-injection"]);
const PETROL_FUELS = list<PetrolFuel>()(["ron91", "ron95", "ron98", "ron102", "e85"]);
const MANIFOLDS = list<ExhaustManifold>()(["cast-log", "tubular-short", "tubular-long"]);
const POPS = list<OverrunPops>()(["off", "mild", "popcorn", "brutal"]);
const COOLING = list<CoolingType>()(["liquid", "air", "oil-air"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

class Bad extends Error {}

function reader(o: Obj, at: string) {
  const fail = (k: string): never => {
    throw new Bad(`${at}${k}`);
  };
  return {
    num: (k: string): number => (isNum(o[k]) ? o[k] : fail(k)),
    bool: (k: string): boolean => (typeof o[k] === "boolean" ? o[k] : fail(k)),
    pick: <T extends string>(k: string, l: readonly T[]): T => (l.includes(o[k] as T) ? (o[k] as T) : fail(k)),
    obj: (k: string): Obj => (isObj(o[k]) ? o[k] : fail(k)),
    /** Optional field: undefined stays undefined, anything else must pass `get`. */
    opt: <T>(k: string, get: (k: string) => T): T | undefined => (o[k] === undefined ? undefined : get(k)),
  };
}

/** Removes keys whose value is undefined (optional fields that are not set). */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * Checks any value (stored JSON may be old, edited or broken) against the EngineConfig contract and returns a clean
 * copy with the numbers inside the workbench ranges, or null. Unknown extra keys are dropped.
 */
export function parseEngineConfig(raw: unknown): EngineConfig | null {
  if (!isObj(raw)) return null;
  try {
    const r = reader(raw, "");
    const fuel = r.pick<FuelKind>("fuel", ["diesel", "petrol"]);
    const bo = reader(r.obj("block"), "block.");
    const twin = bo.opt("twinCrankDeg", bo.num);
    if (twin !== undefined && twin !== 180 && twin !== 270 && twin !== 360) throw new Bad("block.twinCrankDeg");
    const cylinders = bo.num("cylinders");
    if (!Number.isInteger(cylinders) || cylinders < 1 || cylinders > 16) throw new Bad("block.cylinders");
    const block = compact<EngineConfig["block"]>({
      layout: bo.pick("layout", LAYOUTS), cylinders, bankAngleDeg: bo.num("bankAngleDeg"), v8Crank: bo.pick("v8Crank", V8_CRANKS),
      boreMm: bo.num("boreMm"), strokeMm: bo.num("strokeMm"), conrodLengthMm: bo.num("conrodLengthMm"), compressionRatio: bo.num("compressionRatio"),
      blockMaterial: bo.pick("blockMaterial", BLOCK_MATERIALS), crankshaft: bo.pick("crankshaft", CRANKS), pistons: bo.pick("pistons", PISTONS),
      conrods: bo.pick("conrods", RODS), twinCrankDeg: twin as 180 | 270 | 360 | undefined, crossplaneI4: bo.opt("crossplaneI4", bo.bool),
      lightFlywheel: bo.opt("lightFlywheel", bo.bool),
    });
    const ho = reader(r.obj("head"), "head.");
    const valves = ho.num("valvesPerCylinder");
    if (![2, 3, 4, 5].includes(valves)) throw new Bad("head.valvesPerCylinder");
    const head = compact<EngineConfig["head"]>({
      valvetrain: ho.pick("valvetrain", VALVETRAINS), valvesPerCylinder: valves as 2 | 3 | 4 | 5, camProfile: ho.num("camProfile"),
      variableTiming: ho.pick("variableTiming", VVT), valveMaterial: ho.opt("valveMaterial", (k) => ho.pick(k, ["steel", "titanium"] as const)),
      valveSprings: ho.opt("valveSprings", (k) => ho.pick(k, ["standard", "high-rate"] as const)), desmodromic: ho.opt("desmodromic", ho.bool),
    });
    const io = reader(r.obj("induction"), "induction.");
    const induction: EngineConfig["induction"] = {
      aspiration: io.pick("aspiration", ASPIRATIONS), compressorInducerMm: io.num("compressorInducerMm"), turbineAR: io.num("turbineAR"),
      variableGeometry: io.bool("variableGeometry"), boostTargetBar: io.num("boostTargetBar"), intercooler: io.pick("intercooler", INTERCOOLERS),
      intakeRunnerLengthMm: io.num("intakeRunnerLengthMm"), individualThrottleBodies: io.bool("individualThrottleBodies"),
    };
    const fo = reader(r.obj("fuelSystem"), "fuelSystem.");
    const fuelSystem: EngineConfig["fuelSystem"] = fuel === "diesel"
      ? {
          kind: fo.pick("kind", ["diesel"] as const), injection: fo.pick("injection", INJECTIONS), injectionPressureBar: fo.num("injectionPressureBar"),
          fuel: fo.pick("fuel", DIESEL_FUELS), smokeLimitLambda: fo.num("smokeLimitLambda"), injectionTimingOffsetDeg: fo.num("injectionTimingOffsetDeg"),
        }
      : {
          kind: fo.pick("kind", ["petrol"] as const), mixture: fo.pick("mixture", MIXTURES), fuel: fo.pick("fuel", PETROL_FUELS),
          fullLoadLambda: fo.num("fullLoadLambda"), ignitionAdvanceOffsetDeg: fo.num("ignitionAdvanceOffsetDeg"),
        };
    const eo = reader(r.obj("exhaust"), "exhaust.");
    const exhaust = compact<EngineConfig["exhaust"]>({
      manifold: eo.pick("manifold", MANIFOLDS), egr: eo.bool("egr"), catalyst: eo.bool("catalyst"), particulateFilter: eo.bool("particulateFilter"),
      scr: eo.bool("scr"), overrunPops: eo.opt("overrunPops", (k) => eo.pick(k, POPS)),
    });
    const co = reader(r.obj("cooling"), "cooling.");
    const cooling = compact<EngineConfig["cooling"]>({
      type: co.opt("type", (k) => co.pick(k, COOLING)), radiatorCapacityKw: co.num("radiatorCapacityKw"),
      thermostatOpenC: co.num("thermostatOpenC"), oilCooler: co.bool("oilCooler"),
    });
    let engineBrake: EngineConfig["engineBrake"];
    if (raw.engineBrake !== undefined) {
      const bk = reader(r.obj("engineBrake"), "engineBrake.");
      engineBrake = compact({ kind: bk.pick("kind", ["exhaust-flap", "decompression"] as const), maxKw: bk.num("maxKw"), ratedRpm: bk.opt("ratedRpm", bk.num) });
    }
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, NAME_MAX) : "";
    const cfg = compact<EngineConfig>({
      id: typeof raw.id === "string" && raw.id ? raw.id : "",
      name,
      fuel, block, head, induction, fuelSystem, exhaust, cooling,
      revLimitRpm: r.num("revLimitRpm"), idleRpm: r.num("idleRpm"),
      ecuTorqueLimitNm: r.opt("ecuTorqueLimitNm", r.num), ecuPowerLimitKw: r.opt("ecuPowerLimitKw", r.num), engineBrake,
      // emissions standard (#135): optional, unknown values are dropped (the core derives a default)
      emissions: EMISSIONS.includes(raw.emissions as EmissionsStandard) ? (raw.emissions as EmissionsStandard) : undefined,
    });
    if (block.boreMm <= 0 || block.strokeMm <= 0 || block.conrodLengthMm <= 0) throw new Bad("block");
    normalizeConfig(cfg);
    if (!cfg.name) cfg.name = autoName(cfg);
    return cfg;
  } catch (e) {
    if (e instanceof Bad) return null;
    throw e;
  }
}

// --- validation for saving -----------------------------------------------------------------------------------------

export type SaveCheck = { ok: true; config: EngineConfig; warnings: Warning[] } | { ok: false; reason: string; critical: Warning[] };

/** Can this config be saved? Shape must be valid and the core's validateConfig must report nothing critical. */
export function checkForSave(raw: unknown): SaveCheck {
  const cfg = parseEngineConfig(raw);
  if (!cfg) return { ok: false, reason: "Der Motor ist unvollständig oder beschädigt.", critical: [] };
  let warnings: Warning[];
  try {
    warnings = validateConfig(cfg);
  } catch {
    return { ok: false, reason: "Der Motor lässt sich nicht prüfen.", critical: [] };
  }
  const critical = warnings.filter((w) => w.severity === "critical");
  if (critical.length) return { ok: false, reason: "Erst die roten Punkte beheben, dann lässt sich der Motor speichern.", critical };
  return { ok: true, config: cfg, warnings };
}

/** A clean engine name: trimmed, at most NAME_MAX characters; empty means "follow the configuration". */
export function cleanName(name: unknown): string {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
}

export function isMyEngineId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(ID_PREFIX) && id.length > ID_PREFIX.length;
}

export function newEngineId(now = Date.now(), rnd = Math.random()): string {
  return `${ID_PREFIX}${now.toString(36)}${Math.floor(rnd * 36 ** 4).toString(36).padStart(4, "0")}`;
}

// --- storage -------------------------------------------------------------------------------------------------------

/** Parses the stored list. Broken entries are dropped one by one, the valid ones stay; duplicate ids keep the first. */
export function parseMyEngines(raw: unknown): StoredEngine[] {
  const arr = isObj(raw) && Array.isArray(raw.engines) ? raw.engines : Array.isArray(raw) ? raw : [];
  const out: StoredEngine[] = [];
  const seen = new Set<string>();
  for (const e of arr) {
    if (!isObj(e) || !isMyEngineId(e.id) || seen.has(e.id)) continue;
    const cfg = parseEngineConfig(e.config);
    if (!cfg) continue;
    const name = cleanName(e.name) || cfg.name;
    cfg.id = e.id;
    cfg.name = name;
    const savedAt = typeof e.savedAt === "string" && !Number.isNaN(Date.parse(e.savedAt)) ? e.savedAt : new Date(0).toISOString();
    seen.add(e.id);
    out.push({ id: e.id, name, savedAt, config: cfg });
    if (out.length >= MY_ENGINES_MAX) break;
  }
  return out;
}

export function loadMyEngines(st: Store | null = store()): StoredEngine[] {
  try {
    return parseMyEngines(JSON.parse(st?.getItem(MY_ENGINES_KEY) ?? "null"));
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

/** Called after every change of the own engines (save, rename, delete). Returns an unsubscribe function. */
export function onMyEnginesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function write(list: StoredEngine[], st: Store | null): boolean {
  try {
    if (!st) return false;
    st.setItem(MY_ENGINES_KEY, JSON.stringify({ version: 1, engines: list }));
    return true;
  } catch {
    return false;
  } finally {
    for (const l of listeners) l();
  }
}

export type SaveResult = { ok: true; engine: StoredEngine; stored: boolean } | { ok: false; reason: string; critical: Warning[] };

/**
 * Saves an engine. With `id` of an existing own engine it is overwritten (edit), otherwise a new one is added at the
 * front. `stored` is false when the browser blocks storage (the engine then lasts for this visit only).
 */
export function saveMyEngine(cfg: EngineConfig, opts: { id?: string; name?: string; now?: Date } = {}, st: Store | null = store()): SaveResult {
  const c = checkForSave(cfg);
  if (!c.ok) return c;
  const list = loadMyEngines(st);
  const existing = isMyEngineId(opts.id) ? list.find((e) => e.id === opts.id) : undefined;
  const id = existing?.id ?? newEngineId();
  const name = cleanName(opts.name ?? cfg.name) || autoName(c.config);
  const engine: StoredEngine = { id, name, savedAt: (opts.now ?? new Date()).toISOString(), config: { ...c.config, id, name } };
  const next = existing ? list.map((e) => (e.id === id ? engine : e)) : [engine, ...list].slice(0, MY_ENGINES_MAX);
  if (!existing) memory.set(id, engine);
  const stored = write(next, st);
  if (stored) memory.delete(id);
  return { ok: true, engine, stored };
}

export function renameMyEngine(id: string, name: string, st: Store | null = store()): StoredEngine | null {
  const list = loadMyEngines(st);
  const e = list.find((x) => x.id === id);
  const n = cleanName(name);
  if (!e || !n) return null;
  e.name = n;
  e.config.name = n;
  write(list, st);
  return e;
}

export function deleteMyEngine(id: string, st: Store | null = store()): boolean {
  const list = loadMyEngines(st);
  const next = list.filter((x) => x.id !== id);
  memory.delete(id);
  if (next.length === list.length) return false;
  write(next, st);
  return true;
}

/** Engines saved while storage is blocked (private mode): kept for this visit so "Hochdrehen" and "Fahren" still work. */
const memory = new Map<string, StoredEngine>();

export function findMyEngine(id: string, st: Store | null = store()): StoredEngine | undefined {
  return loadMyEngines(st).find((e) => e.id === id) ?? memory.get(id);
}

/** Any engine by id: an own engine or a library engine (deep copy), else null. */
export function resolveEngine(id: string, st: Store | null = store()): EngineConfig | null {
  if (isMyEngineId(id)) {
    const e = findMyEngine(id, st);
    return e ? structuredClone(e.config) : null;
  }
  return ENGINE_LIBRARY.some((e) => e.config.id === id) ? libraryConfig(id) : null;
}
