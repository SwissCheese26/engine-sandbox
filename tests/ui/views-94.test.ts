// Issue #94: only two views (Prüfzelle, Cockpit); Renn-Dash and Kompakt became cockpit designs. Stored settings of
// the old views are migrated in validateSettings, the design picker lists every choice once with name and hint.
import { beforeEach, describe, expect, test } from "bun:test";
import { AUTO_DESIGN, COCKPIT_DESIGNS, DESIGN_CHOICES, isCockpitChoice, resolveDesign } from "../../src/ui/layouts/designs.ts";
import { DEFAULT_SETTINGS, LAYOUTS, LEGACY_LAYOUT_DESIGN, getSettings, resetSettingsCache, setSettings, validateSettings } from "../../src/ui/settings.ts";
import { CREDITS } from "../../src/ui/credits.ts";

beforeEach(() => resetSettingsCache());

describe("views", () => {
  test("the view switcher offers only Prüfzelle and Cockpit", () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual(["pruefzelle", "cockpit"]);
    expect(LAYOUTS.map((l) => l.label)).toEqual(["Prüfzelle", "Cockpit"]);
  });
});

describe("settings migration (#94)", () => {
  test("layout race → cockpit with the Renn-Dash design", () => {
    const s = validateSettings({ layout: "race", cockpitDesign: "classic" });
    expect(s.layout).toBe("cockpit");
    expect(s.cockpitDesign).toBe("race");
  });
  test("layout compact → cockpit with Head-up, its successor", () => {
    const s = validateSettings({ layout: "compact", cockpitDesign: "digital" });
    expect(s.layout).toBe("cockpit");
    expect(s.cockpitDesign).toBe("hud");
    expect(LEGACY_LAYOUT_DESIGN.compact).toBe("hud");
  });
  test("other settings survive the migration", () => {
    const s = validateSettings({ layout: "race", preset: "imperial", speedo: "custom", speedoCustomKmh: 320, ckFields: ["oilT", "egt", "lambda"] });
    expect(s.preset).toBe("imperial");
    expect(s.speedo).toBe("custom");
    expect(s.speedoCustomKmh).toBe(320);
    expect(s.ckFields).toEqual(["oilT", "egt", "lambda"]);
  });
  test("current views and designs stay as stored; auto keeps working", () => {
    expect(validateSettings({ layout: "cockpit", cockpitDesign: "auto" })).toMatchObject({ layout: "cockpit", cockpitDesign: "auto" });
    expect(validateSettings({ layout: "pruefzelle", cockpitDesign: "motorrad" })).toMatchObject({ layout: "pruefzelle", cockpitDesign: "motorrad" });
    expect(validateSettings({ layout: "cockpit", cockpitDesign: "race" }).cockpitDesign).toBe("race");
    expect(resolveDesign("auto", "car")).toBe("classic");
    expect(resolveDesign("auto", "superbike")).toBe("motorrad");
  });
  test("only own keys migrate (no prototype names), unknown layouts fall back to the Prüfzelle", () => {
    expect(validateSettings({ layout: "toString" })).toMatchObject({ layout: "pruefzelle", cockpitDesign: DEFAULT_SETTINGS.cockpitDesign });
    expect(validateSettings({ layout: "Race" }).layout).toBe("pruefzelle");
  });
  test("a migrated setting is stored as the new form", () => {
    setSettings({ layout: "compact" } as never);
    expect(getSettings()).toMatchObject({ layout: "cockpit", cockpitDesign: "hud" });
    setSettings(DEFAULT_SETTINGS);
  });
});

describe("design list (#94)", () => {
  test("Renn-Dash is a design; there is no separate Kompakt design", () => {
    const ids = COCKPIT_DESIGNS.map((d) => d.id);
    expect(ids).toContain("race");
    expect(ids).toContain("hud");
    expect(ids).not.toContain("compact" as never);
    expect(isCockpitChoice("race")).toBe(true);
    expect(isCockpitChoice("compact")).toBe(false);
  });
  test("the picker lists Automatisch first, then every design once, each with name and hint", () => {
    expect(DESIGN_CHOICES[0]).toBe(AUTO_DESIGN);
    expect(DESIGN_CHOICES.slice(1)).toEqual([...COCKPIT_DESIGNS]);
    expect(new Set(DESIGN_CHOICES.map((d) => d.id)).size).toBe(DESIGN_CHOICES.length);
    for (const d of DESIGN_CHOICES) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.hint.length).toBeGreaterThan(0);
    }
    expect(COCKPIT_DESIGNS.find((d) => d.id === "hud")!.hint).toMatch(/Handy/);
  });
});

describe("credits (#94)", () => {
  test("Arthur and Claude with public links, no e-mail addresses", () => {
    expect(CREDITS.map((c) => c.name)).toEqual(["Arthur Reznikov", "Claude von Anthropic"]);
    expect(CREDITS[0]!.href).toBe("https://github.com/SwissCheese26");
    expect(CREDITS[1]!.href).toBe("https://claude.com/claude-code");
    for (const c of CREDITS) expect(JSON.stringify(c)).not.toMatch(/@[\w-]+\.\w|mailto:/);
  });
});
