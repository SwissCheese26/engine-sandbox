// Issue #55: in-app bug report (diagnosis text, issue link, trimming, ring buffer).
import { expect, test } from "bun:test";
import {
  FIELD_IDS, MAX_URL_LENGTH, RingBuffer, TRIM_NOTE, buildDiagnosis, buildIssueUrl, errorLine, issueTitle, samplesText, shortUserAgent,
  type BugReport, type ValueSample,
} from "../../src/ui/bug-report.ts";

const report = (o: Partial<BugReport> = {}): BugReport => ({ title: "Auto rollt", description: "Rollt im Leerlauf", steps: "N eingelegt", expected: "steht", diagnosis: "### App\nabc1234", ...o });

test("ring buffer keeps the newest entries", () => {
  const b = new RingBuffer<number>(3);
  for (let i = 1; i <= 5; i++) b.push(i);
  expect(b.toArray()).toEqual([3, 4, 5]);
  expect(b.size).toBe(3);
  b.clear();
  expect(b.toArray()).toEqual([]);
});

test("diagnosis contains only ticked sections, in order", () => {
  const s = [
    { id: "app", label: "App", text: "abc" },
    { id: "env", label: "Umwelt", text: "Gefälle −8 %" },
  ];
  expect(buildDiagnosis(s)).toBe("### App\nabc\n\n### Umwelt\nGefälle −8 %");
  expect(buildDiagnosis(s, new Set(["env"]))).toBe("### Umwelt\nGefälle −8 %");
  expect(buildDiagnosis(s, new Set())).toBe("");
});

test("value table is relative to the newest sample", () => {
  const v: ValueSample[] = [
    { t: 10, rpm: 800, speedKmh: 0, gear: "N", pedal: 0, braking: false, running: true },
    { t: 10.5, rpm: 2500.4, speedKmh: 12.34, gear: "1", pedal: 0.5, braking: true, running: true },
  ];
  const lines = samplesText(v).split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain("-0.50");
  expect(lines[2]).toMatch(/0\.00\s+2500\s+12\.3\s+1\s+50\s+ja ja/);
  expect(samplesText([])).toContain("keine Werte");
});

test("short user agent names browser and OS only", () => {
  expect(shortUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Mobile Safari/537.36")).toBe("Chrome 130 auf Android");
  expect(shortUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari 18 auf iOS");
  expect(shortUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Firefox 132 auf Windows");
  expect(shortUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge 130 auf Windows");
});

test("issue link targets the issue form with all field ids", () => {
  const { url, trimmed } = buildIssueUrl(report());
  expect(trimmed).toBe(false);
  const u = new URL(url);
  expect(u.origin + u.pathname).toBe("https://github.com/SwissCheese26/engine-sandbox/issues/new");
  expect(u.searchParams.get("template")).toBe("bug.yml");
  expect(u.searchParams.get("labels")).toBe("bug-meldung");
  expect(u.searchParams.get("title")).toBe("[Bug] Auto rollt");
  expect(u.searchParams.get(FIELD_IDS.description)).toBe("Rollt im Leerlauf");
  expect(u.searchParams.get(FIELD_IDS.steps)).toBe("N eingelegt");
  expect(u.searchParams.get(FIELD_IDS.expected)).toBe("steht");
  expect(u.searchParams.get(FIELD_IDS.diagnosis)).toBe("```\n### App\nabc1234\n```");
  // umlauts and & survive the round trip
  expect(new URL(buildIssueUrl(report({ description: "Öl & Wasser = 100 %" })).url).searchParams.get(FIELD_IDS.description)).toBe("Öl & Wasser = 100 %");
});

test("title falls back to the description and is capped", () => {
  expect(issueTitle({ title: " ", description: "Erste Zeile\nzweite" })).toBe("[Bug] Erste Zeile");
  expect(issueTitle({ title: "", description: "" })).toBe("[Bug] Fehlermeldung aus der App");
  expect(issueTitle({ title: "x".repeat(200), description: "" }).length).toBeLessThanOrEqual(86);
});

test("a long diagnosis is trimmed to fit the URL", () => {
  const { url, trimmed } = buildIssueUrl(report({ diagnosis: "Wert 1234 ÄÖÜ\n".repeat(2000) }));
  expect(trimmed).toBe(true);
  expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
  expect(url.length).toBeGreaterThan(MAX_URL_LENGTH - 200);
  const d = new URL(url).searchParams.get(FIELD_IDS.diagnosis)!;
  expect(d).toContain(TRIM_NOTE.trim());
  // the player's own texts stay complete
  expect(new URL(url).searchParams.get(FIELD_IDS.description)).toBe("Rollt im Leerlauf");
});

test("overlong player texts are trimmed too", () => {
  const { url, trimmed } = buildIssueUrl(report({ description: "ä".repeat(5000), steps: "b".repeat(5000), diagnosis: "c".repeat(5000) }));
  expect(trimmed).toBe(true);
  expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
});

test("error lines are short and keep only the file name", () => {
  expect(errorLine("TypeError: x is undefined", "https://swisscheese26.github.io/engine-sandbox/main.js?v=1", 12)).toBe("TypeError: x is undefined (main.js:12)");
  expect(errorLine("a\n   b")).toBe("a b");
  expect(errorLine("y".repeat(500)).length).toBe(240);
});
