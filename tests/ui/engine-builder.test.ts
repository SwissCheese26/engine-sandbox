// Issue #72: Engine Builder – checking stored engines, saving / renaming / deleting own engines, the builder steps,
// explanations, live figures, blockers and the draft. Pure modules only (no DOM).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { summarize, validateConfig } from "../../src/core/index.ts";
import type { EngineConfig } from "../../src/core/index.ts";
import { ENGINE_LIBRARY, libraryConfig } from "../../src/data/engine-library.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import {
  BUILDER_DRAFT_KEY, OPTION_INFO, STEPS, STEP_COUNT, boreStrokeLabel, builderStats, clearDraft, loadDraft, optionInfo, parseDraft, saveDraft,
  startConfig, stepBlockers, stepOfField,
} from "../../src/ui/builder-model.ts";
import { FIELDS, GROUPS, normalizeConfig } from "../../src/ui/fields.ts";
import {
  MY_ENGINES_KEY, MY_ENGINES_MAX, NAME_MAX, checkForSave, cleanName, deleteMyEngine, findMyEngine, isMyEngineId, loadMyEngines, newEngineId,
  onMyEnginesChange, parseEngineConfig, parseMyEngines, renameMyEngine, resolveEngine, saveMyEngine,
} from "../../src/ui/my-engines.ts";
import { buildSetup, defaultCustom, validateCustom } from "../../src/ui/sandbox-setup.ts";

/** In-memory Storage stand-in. */
class MemStore {
  map = new Map<string, string>();
  failWrites = false;
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** A 4-cylinder petrol turbo as the E2E builds it. */
function turboFour(): EngineConfig {
  const c = defaultConfig("petrol");
  c.induction.aspiration = "turbo";
  c.induction.boostTargetBar = 1.2;
  c.block.pistons = "forged-aluminium";
  c.name = "Mein Turbo-Vierer";
  return c;
}

describe("parseEngineConfig: stored engines are checked against the contract", () => {
  test("every library engine passes and keeps its values (inside the workbench ranges)", () => {
    for (const e of ENGINE_LIBRARY) {
      const parsed = parseEngineConfig(structuredClone(e.config));
      expect(parsed, e.config.id).not.toBeNull();
      expect(parsed).toEqual(normalizeConfig(structuredClone(e.config)));
    }
  });

  test("base equipment of both fuels passes unchanged", () => {
    for (const fuel of ["diesel", "petrol"] as const) {
      const c = defaultConfig(fuel);
      expect(parseEngineConfig(c)).toEqual(normalizeConfig(structuredClone(c)));
    }
  });

  test("broken values are refused, never guessed", () => {
    const bad: [string, (c: Record<string, any>) => void][] = [
      ["no block", (c) => delete c.block],
      ["unknown layout", (c) => (c.block.layout = "x")],
      ["NaN bore", (c) => (c.block.boreMm = Number.NaN)],
      ["bore as text", (c) => (c.block.boreMm = "82")],
      ["fractional cylinders", (c) => (c.block.cylinders = 2.5)],
      ["zero cylinders", (c) => (c.block.cylinders = 0)],
      ["3,5 valves", (c) => (c.head.valvesPerCylinder = 3.5)],
      ["fuel system of the other fuel", (c) => (c.fuelSystem = defaultConfig("diesel").fuelSystem)],
      ["unknown fuel", (c) => (c.fuel = "kerosene")],
      ["boolean as text", (c) => (c.exhaust.catalyst = "true")],
      ["odd twin crank", (c) => (c.block.twinCrankDeg = 90)],
      ["broken optional ECU limit", (c) => (c.ecuTorqueLimitNm = "viel")],
      ["unknown pops", (c) => (c.exhaust.overrunPops = "laut")],
      ["negative stroke", (c) => (c.block.strokeMm = -5)],
    ];
    for (const [what, f] of bad) {
      const c = structuredClone(defaultConfig("petrol")) as unknown as Record<string, any>;
      f(c);
      expect(parseEngineConfig(c), what).toBeNull();
    }
    for (const junk of [null, undefined, 42, "motor", [], { fuel: "petrol" }]) expect(parseEngineConfig(junk)).toBeNull();
  });

  test("numbers outside the workbench ranges are clamped, extra keys dropped, missing name follows the config", () => {
    const c = structuredClone(defaultConfig("petrol")) as unknown as Record<string, any>;
    c.block.boreMm = 400;
    c.idleRpm = 50;
    c.hack = "<script>";
    c.block.extra = 1;
    c.name = "";
    const p = parseEngineConfig(c)!;
    expect(p.block.boreMm).toBe(170);
    expect(p.idleRpm).toBe(500);
    expect("hack" in p).toBe(false);
    expect("extra" in p.block).toBe(false);
    expect(p.name).toBe("R4 Benziner 8,4 Turbo"); // 170 mm bore
  });
});

describe("checkForSave: the core's validateConfig decides", () => {
  test("sensible engines can be saved", () => {
    expect(checkForSave(defaultConfig("diesel")).ok).toBe(true);
    expect(checkForSave(turboFour()).ok).toBe(true);
  });

  test("critical findings block saving and are handed back", () => {
    const c = defaultConfig("petrol");
    c.block.compressionRatio = 13.5; // charged petrol above 12.5 : 1 knocks itself to pieces
    const r = checkForSave(c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.critical.length).toBeGreaterThan(0);
      expect(r.critical.every((w) => w.severity === "critical")).toBe(true);
      expect(r.critical.some((w) => w.field === "block.compressionRatio")).toBe(true);
    }
    const rev = defaultConfig("petrol");
    rev.revLimitRpm = 16000; // far above the mechanically safe speed of a cast-piston road engine
    expect(checkForSave(rev).ok).toBe(false);
    expect(checkForSave({ fuel: "petrol" }).ok).toBe(false);
  });
});

describe("own engines in localStorage (pruefzelle.myEngines)", () => {
  let st: MemStore;
  beforeEach(() => {
    st = new MemStore();
  });

  test("save, reload, several engines, newest first", () => {
    const a = saveMyEngine(turboFour(), {}, st);
    const b = saveMyEngine(defaultConfig("diesel"), { name: "Ackerdiesel" }, st);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.stored).toBe(true);
    expect(isMyEngineId(a.engine.id)).toBe(true);
    expect(a.engine.id).not.toBe(b.engine.id);
    const list = loadMyEngines(st);
    expect(list.map((e) => e.name)).toEqual(["Ackerdiesel", "Mein Turbo-Vierer"]);
    expect(list[1]!.config.id).toBe(a.engine.id);
    expect(list[1]!.config.induction.aspiration).toBe("turbo");
    expect(list[1]!.config.block.pistons).toBe("forged-aluminium");
    // the stored JSON is versioned
    expect(JSON.parse(st.getItem(MY_ENGINES_KEY)!).version).toBe(1);
  });

  test("an empty name follows the configuration", () => {
    const r = saveMyEngine({ ...defaultConfig("diesel"), name: "   " }, {}, st);
    expect(r.ok && r.engine.name).toBe("R4 Diesel 2,0 Turbo");
  });

  test("saving with the id of an own engine overwrites it (edit)", () => {
    const a = saveMyEngine(turboFour(), {}, st);
    if (!a.ok) throw new Error("not saved");
    const edited = { ...a.engine.config, induction: { ...a.engine.config.induction, boostTargetBar: 1.5 } };
    const b = saveMyEngine(edited, { id: a.engine.id }, st);
    expect(b.ok && b.engine.id).toBe(a.engine.id);
    const list = loadMyEngines(st);
    expect(list.length).toBe(1);
    expect(list[0]!.config.induction.boostTargetBar).toBe(1.5);
    // a library id is never overwritten: a copy is stored
    const c = saveMyEngine(libraryConfig("ref-honda-k20a-type-r"), { id: "ref-honda-k20a-type-r" }, st);
    expect(c.ok && isMyEngineId(c.engine.id)).toBe(true);
    expect(loadMyEngines(st).length).toBe(2);
  });

  test("critical engines are not stored", () => {
    const c = defaultConfig("petrol");
    c.block.compressionRatio = 13.5;
    expect(saveMyEngine(c, {}, st).ok).toBe(false);
    expect(st.getItem(MY_ENGINES_KEY)).toBeNull();
  });

  test("rename and delete", () => {
    const a = saveMyEngine(turboFour(), {}, st);
    const b = saveMyEngine(defaultConfig("diesel"), {}, st);
    if (!a.ok || !b.ok) throw new Error("not saved");
    expect(renameMyEngine(a.engine.id, "  Kleiner   Renner  ", st)?.name).toBe("Kleiner Renner");
    expect(findMyEngine(a.engine.id, st)?.config.name).toBe("Kleiner Renner");
    expect(renameMyEngine(a.engine.id, "   ", st)).toBeNull();
    expect(renameMyEngine("my-gibtsnicht", "X", st)).toBeNull();
    expect(cleanName("x".repeat(80)).length).toBe(NAME_MAX);
    expect(deleteMyEngine(a.engine.id, st)).toBe(true);
    expect(deleteMyEngine(a.engine.id, st)).toBe(false);
    expect(loadMyEngines(st).map((e) => e.id)).toEqual([b.engine.id]);
  });

  test("broken storage: bad JSON, junk and broken entries are dropped one by one", () => {
    st.setItem(MY_ENGINES_KEY, "{kaputt");
    expect(loadMyEngines(st)).toEqual([]);
    st.setItem(MY_ENGINES_KEY, JSON.stringify("hallo"));
    expect(loadMyEngines(st)).toEqual([]);
    const good = { id: "my-abc123", name: "Gut", savedAt: "2026-11-20T10:00:00.000Z", config: turboFour() };
    const list = [
      good,
      { id: "my-def456", name: "Kaputt", config: { ...turboFour(), block: null } },
      { id: "lib-fremd", name: "Falsche Id", config: turboFour() },
      { id: "my-abc123", name: "Doppelt", config: defaultConfig("diesel") },
      { id: "my-ghi789", name: 42, savedAt: "nie", config: defaultConfig("diesel") },
      null,
      "text",
    ];
    st.setItem(MY_ENGINES_KEY, JSON.stringify({ version: 1, engines: list }));
    const out = loadMyEngines(st);
    expect(out.map((e) => e.id)).toEqual(["my-abc123", "my-ghi789"]);
    expect(out[0]!.name).toBe("Gut");
    expect(out[0]!.config.id).toBe("my-abc123");
    // a missing name falls back to the config's name, a bad date to the epoch
    expect(out[1]!.name).toBe(defaultConfig("diesel").name);
    expect(out[1]!.savedAt).toBe(new Date(0).toISOString());
    // an old plain array is read too
    expect(parseMyEngines([good]).length).toBe(1);
  });

  test("at most MY_ENGINES_MAX engines", () => {
    for (let i = 0; i < MY_ENGINES_MAX + 3; i++) saveMyEngine(defaultConfig("diesel"), { name: `D${i}` }, st);
    const list = loadMyEngines(st);
    expect(list.length).toBe(MY_ENGINES_MAX);
    expect(list[0]!.name).toBe(`D${MY_ENGINES_MAX + 2}`);
  });

  test("storage blocked: the engine lasts for this visit", () => {
    st.failWrites = true;
    const r = saveMyEngine(turboFour(), {}, st);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stored).toBe(false);
    expect(findMyEngine(r.engine.id, st)?.name).toBe("Mein Turbo-Vierer");
    expect(resolveEngine(r.engine.id, st)?.induction.aspiration).toBe("turbo");
  });

  test("listeners hear every change", () => {
    let n = 0;
    const off = onMyEnginesChange(() => n++);
    const a = saveMyEngine(turboFour(), {}, st);
    if (a.ok) renameMyEngine(a.engine.id, "Neu", st);
    if (a.ok) deleteMyEngine(a.engine.id, st);
    off();
    saveMyEngine(turboFour(), {}, st);
    expect(n).toBe(3);
  });

  test("resolveEngine: own, library (a copy) or nothing", () => {
    const a = saveMyEngine(turboFour(), {}, st);
    if (!a.ok) throw new Error("not saved");
    expect(resolveEngine(a.engine.id, st)?.name).toBe("Mein Turbo-Vierer");
    const lib = resolveEngine("ref-honda-k20a-type-r", st)!;
    lib.block.boreMm = 1;
    expect(libraryConfig("ref-honda-k20a-type-r").block.boreMm).not.toBe(1);
    expect(resolveEngine("gibts-nicht", st)).toBeNull();
    expect(resolveEngine("my-gibtsnicht", st)).toBeNull();
  });

  test("ids are unique and recognisable", () => {
    expect(newEngineId(1, 0)).not.toBe(newEngineId(1, 0.5));
    expect(isMyEngineId(newEngineId())).toBe(true);
    expect(isMyEngineId("my-")).toBe(false);
    expect(isMyEngineId("ref-bmw-s54b32")).toBe(false);
    expect(isMyEngineId(42)).toBe(false);
  });
});

describe("builder steps", () => {
  test("nine steps; every workbench group belongs to exactly one step", () => {
    expect(STEP_COUNT).toBe(9);
    expect(STEPS[0]!.id).toBe("basis");
    expect(STEPS[STEP_COUNT - 1]!.id).toBe("finish");
    const groups = STEPS.flatMap((s) => s.groups);
    expect([...groups].sort()).toEqual(GROUPS.map((g) => g.id).sort());
    expect(new Set(groups).size).toBe(groups.length);
    for (const s of STEPS) expect(s.intro.length).toBeGreaterThan(40);
  });

  test("every option of an explained field has an explanation (incl. library-only values)", () => {
    for (const path of Object.keys(OPTION_INFO)) {
      const fields = FIELDS.filter((f) => f.path === path && f.kind === "select");
      expect(fields.length, path).toBeGreaterThan(0);
      for (const fuel of ["diesel", "petrol"] as const) {
        const cfg = defaultConfig(fuel);
        for (const f of fields) if (f.kind === "select") for (const o of f.options(cfg)) expect(optionInfo(path, o.value), `${path}=${o.value}`).toBeTruthy();
      }
    }
    // materials name weight, strength or rev limit
    for (const v of ["cast-iron", "compacted-graphite-iron", "aluminium"]) expect(optionInfo("block.blockMaterial", v)).toMatch(/leicht|schwer|Gewicht|fest|Druck/);
    expect(optionInfo("block.conrods", "titanium")).toMatch(/Drehzahl/);
    // the Cummins pump only exists in the library, it is explained anyway
    expect(optionInfo("fuelSystem.injection", "mechanical-pump")).toBeTruthy();
    expect(optionInfo("block.layout", "gibts-nicht")).toBeUndefined();
  });

  test("findings lead to the step of their field", () => {
    expect(stepOfField("block.compressionRatio")).toBe("block");
    expect(stepOfField("head.valvesPerCylinder")).toBe("head");
    expect(stepOfField("fuelSystem.smokeLimitLambda")).toBe("mixture");
    expect(stepOfField("induction.boostTargetBar")).toBe("induction");
    expect(stepOfField("idleRpm")).toBe("limits");
    expect(stepOfField("ecuTorqueLimitNm")).toBe("limits");
    expect(stepOfField("fuelSystem.kind")).toBe("basis");
    expect(stepOfField(undefined)).toBe("basis");
  });

  test("critical findings block Weiter only on their own step", () => {
    const c = defaultConfig("petrol");
    c.head.valvetrain = "ohv";
    c.head.valvesPerCylinder = 5; // not buildable with pushrods
    const ws = validateConfig(c);
    expect(stepBlockers(ws, "head").length).toBeGreaterThan(0);
    expect(stepBlockers(ws, "block")).toEqual([]);
    expect(stepBlockers(validateConfig(turboFour()), "head")).toEqual([]);
  });
});

describe("live figures", () => {
  test("come from the core and match the nameplate", () => {
    const c = turboFour();
    const s = summarize(c);
    const st = builderStats(c);
    expect(st.displacementL).toBeCloseTo(s.displacementL, 9);
    expect(st.peakPowerKw).toBeCloseTo(s.peakPowerKw, 9);
    expect(st.peakTorqueNm).toBeCloseTo(s.peakTorqueNm, 9);
    expect(st.pistonSpeedMs).toBeCloseTo(s.maxMeanPistonSpeedMs, 9);
    expect(st.massKg).toBeCloseTo(s.massKg, 9);
    expect(st.boreStrokeRatio).toBeCloseTo(82.5 / 92.8, 9);
    expect(st.boreStrokeLabel).toBe("langhubig");
    expect(st.compressionRatio).toBe(c.block.compressionRatio);
    expect(st.warnings).toEqual(validateConfig(c));
  });

  test("bore/stroke words", () => {
    expect(boreStrokeLabel(1.2)).toBe("überquadratisch");
    expect(boreStrokeLabel(1.0)).toBe("quadratisch");
    expect(boreStrokeLabel(0.85)).toBe("langhubig");
  });
});

describe("start and draft", () => {
  test("start from base equipment or a copy of a library engine", () => {
    const d = startConfig("diesel");
    expect(d.config.fuel).toBe("diesel");
    expect(d.config.id).toBe("builder-draft");
    const k20 = startConfig("diesel", "ref-honda-k20a-type-r");
    expect(k20.config.fuel).toBe("petrol");
    expect(k20.config.id).toBe("builder-draft");
    expect(k20.config.block.boreMm).toBe(libraryConfig("ref-honda-k20a-type-r").block.boreMm);
    expect(startConfig("petrol", "gibts-nicht").config.fuel).toBe("petrol");
  });

  test("draft survives a reload, broken drafts are ignored", () => {
    const st = new MemStore();
    saveDraft({ step: 4, config: turboFour(), customName: true, baseId: "ref-honda-k20a-type-r" }, st);
    const d = loadDraft(st)!;
    expect(d.step).toBe(4);
    expect(d.customName).toBe(true);
    expect(d.config.name).toBe("Mein Turbo-Vierer");
    expect(d.baseId).toBe("ref-honda-k20a-type-r");
    clearDraft(st);
    expect(loadDraft(st)).toBeNull();
    st.setItem(BUILDER_DRAFT_KEY, "{");
    expect(loadDraft(st)).toBeNull();
    expect(parseDraft({ step: 2, config: { fuel: "petrol" } })).toBeNull();
    expect(parseDraft({ step: 99, config: turboFour() })!.step).toBe(STEP_COUNT - 1);
    expect(parseDraft({ step: "drei", config: turboFour() })!.step).toBe(0);
  });
});

describe("own engines in the Sandbox start (#93 wizard)", () => {
  // validateCustom reads the browser storage: give it one for these tests
  const g = globalThis as unknown as { localStorage?: MemStore };
  let had: MemStore | undefined;
  beforeEach(() => {
    had = g.localStorage;
    g.localStorage = new MemStore();
  });
  afterEach(() => {
    g.localStorage = had;
  });

  test("an own engine is a valid engine for every vehicle type; an unknown one is not", () => {
    const r = saveMyEngine(turboFour());
    if (!r.ok) throw new Error("not saved");
    for (const base of ["car", "truck", "bike"] as const) {
      expect(validateCustom({ ...defaultCustom(base), engineId: r.engine.id }).ok).toBe(true);
      expect(validateCustom({ ...defaultCustom(base), engineId: "my-geloescht" }).ok).toBe(false);
    }
  });

  test("a preselected engine goes into the library vehicle and onto the engine dyno", () => {
    expect(buildSetup("car", { vehicleId: "car-vw-golf7-gti", route: "flat", engineId: "my-x1" })?.engineId).toBe("my-x1");
    expect(buildSetup("car", { vehicleId: "car-vw-golf7-gti", route: "flat" })?.engineId).not.toBe("my-x1");
    expect(buildSetup("engine", { engineId: "my-x1" })).toEqual({ kind: "engine", engineId: "my-x1", route: null });
    expect(buildSetup("engine", {})).toEqual({ kind: "engine", route: null });
  });
});
