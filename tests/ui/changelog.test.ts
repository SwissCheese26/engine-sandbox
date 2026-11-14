// Changelog (#50): one source (src/data/changelog.ts) for CHANGELOG.md and the "Was ist neu" dialog.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CHANGELOG, unseenEntries, validateChangelog } from "../../src/data/changelog.ts";
import { renderChangelog } from "../../scripts/changelog.ts";

describe("changelog", () => {
  test("entries are valid and sorted newest first", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(validateChangelog(CHANGELOG)).toEqual([]);
  });

  test("validation catches bad data", () => {
    const bad = [
      { date: "2026-11-01", title: "A", items: [{ kind: "neu" as const, text: "x", refs: [1] }] },
      { date: "2026-11-05", title: "", items: [{ kind: "neu" as const, text: " ", refs: [0] }] },
      { date: "2026-02-30", title: "C", items: [] },
    ];
    const errs = validateChangelog(bad).join("\n");
    expect(errs).toContain("nicht absteigend");
    expect(errs).toContain("Titel fehlt");
    expect(errs).toContain("leerer Text");
    expect(errs).toContain("ungültige Verweise");
    expect(errs).toContain("ungültiges Datum 2026-02-30");
  });

  test("committed CHANGELOG.md equals the generated output", () => {
    const file = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
    expect(file).toBe(renderChangelog());
  });

  test("unseen entries: all when never seen, only newer ones after", () => {
    expect(unseenEntries(CHANGELOG, null)).toHaveLength(CHANGELOG.length);
    expect(unseenEntries(CHANGELOG, CHANGELOG[0]!.date)).toHaveLength(0);
    expect(unseenEntries(CHANGELOG, CHANGELOG[1]!.date)).toEqual([CHANGELOG[0]!]);
  });
});
