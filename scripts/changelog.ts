// Generates CHANGELOG.md from src/data/changelog.ts (#50). Run: bun scripts/changelog.ts
import { CHANGELOG, KIND_LABEL, type ChangeKind, type ChangelogEntry } from "../src/data/changelog.ts";

const REPO = "https://github.com/SwissCheese26/engine-sandbox";
const ORDER: ChangeKind[] = ["neu", "geändert", "behoben"];

/** Keep-a-Changelog style markdown in German (Neu / Geändert / Behoben), one section per day. */
export function renderChangelog(list: ChangelogEntry[] = CHANGELOG): string {
  const lines = [
    "# Changelog",
    "",
    "Alle sichtbaren Änderungen an der Prüfzelle, neueste zuerst. Aufbau nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).",
    "",
    "_Diese Datei wird erzeugt: Einträge stehen in `src/data/changelog.ts`, danach `bun scripts/changelog.ts` ausführen._",
  ];
  for (const e of list) {
    lines.push("", `## ${e.date} – ${e.title}`);
    for (const kind of ORDER) {
      const items = e.items.filter((i) => i.kind === kind);
      if (!items.length) continue;
      lines.push("", `### ${KIND_LABEL[kind]}`, "");
      // GitHub redirects /issues/<n> to the PR when <n> is a pull request
      for (const i of items) lines.push(`- ${i.text} (${i.refs.map((r) => `[#${r}](${REPO}/issues/${r})`).join(", ")})`);
    }
  }
  return lines.join("\n") + "\n";
}

if (import.meta.main) {
  await Bun.write(new URL("../CHANGELOG.md", import.meta.url), renderChangelog());
  console.log("CHANGELOG.md geschrieben");
}
