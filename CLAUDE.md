# engine-sandbox – Arbeitsregeln für alle Teams

Ein Webgame: Motor konfigurieren (wie *Automation*), auf den Prüfstand stellen und Gas geben (wie *RevHeadz*), mit Live-Werten und passendem Sound. Alles soll physikalisch realistisch sein. Das Ziel für v0.1 sind **Diesel und Benziner**.

## Stack
- TypeScript (strict), **ohne Laufzeit-Abhängigkeiten**. Bun bündelt (`scripts/build.ts`), Bun testet (`bun test`).
- UI ist Vanilla TS mit Web Components oder Klassen. Kein Framework, kein npm-Paket: Die Entwicklungsumgebung hat keinen Registry-Zugriff.
- Sound läuft über die Web Audio API und wird prozedural erzeugt, ohne Samples.

## Befehle
```
tsc --noEmit -p .        # Typecheck (lokal globales tsc, in CI das aus devDependencies)
bun test tests/core tests/audio tests/ui
bun scripts/build.ts     # → dist/
bun scripts/dev.ts       # Dev-Server auf :5173
node tests/e2e/smoke.mjs # Playwright-Smoke-Test inkl. Screenshots (vorher bauen)
```
Vor jedem PR müssen alle vier grün sein: Typecheck, Unit-Tests, Build und, sobald vorhanden, der E2E-Smoke.

## Architektur und Zuständigkeiten
| Bereich | Pfad | Team |
|---|---|---|
| Vertrag (Typen, öffentliche API) | `src/core/types.ts`, `src/core/index.ts` (nur Signaturen) | Architektur (Lead). Änderungen per Issue mit Label `architecture` |
| Kern-Physik | `src/core/geometry.ts`, `airpath.ts`, `combustion-*.ts`, `friction.ts`, `dyno.ts`, `simulator.ts` | Kern-Physik |
| Turbo, Thermik, Grenzen | `src/core/turbo.ts`, `thermal.ts`, `limits.ts`, `mass.ts` | Thermik & Aufladung |
| UI | `src/ui/**`, `src/main.ts`, `index.html` | UI |
| Sound | `src/audio/**` | Sound |
| Tests, Referenzmotoren | `tests/**`, `src/data/reference-engines.ts` | Test |
| Recherche | `docs/research/**` | Recherche |

- UI und Sound importieren **nur** aus `src/core/index.ts` und `src/data/*`.
- `src/core` darf kein DOM verwenden, weil der Kern in Tests und Workern laufen muss.
- Physik-Formeln brauchen einen Kommentar mit Quelle bzw. Verweis auf den Abschnitt in `docs/research/*.md`.

## Git und GitHub
- Ein Branch pro Issue: `team/<kurzname>`, z. B. `physik/airpath`. Für parallele Arbeit gibt es Worktrees.
- Commits in Englisch, Conventional Commits (`feat(core): …`, `test: …`, `fix(ui): …`), kleine Schritte.
- Am Ende jeder Commit-Nachricht stehen die Co-Author-Zeilen aus den Session-Vorgaben.
- **GraphQL ist gesperrt**, daher funktionieren `gh pr create` und `gh issue create` nicht. Nutze die REST-API:
  - Issue: `gh api repos/SwissCheese26/engine-sandbox/issues -f title=… -f body=… -f "labels[]=…"`
  - PR: `gh api repos/SwissCheese26/engine-sandbox/pulls -f title=… -f head=<branch> -f base=main -f body=…`
  - Kommentar: `gh api repos/SwissCheese26/engine-sandbox/issues/<n>/comments -f body=…`
- PR-Beschreibung: was, warum, wie getestet und `Closes #<n>`. Gemergt wird erst nach dem Review.

## Vorgehen (Phasenmodell)
1. Anforderungen (Recherche): `docs/research/*.md`
2. Design (Architektur und Design-System): `docs/process/design.md`, Typen
3. Umsetzung: Die Teams arbeiten parallel, **das Testteam schreibt seine Tests gleichzeitig aus der Spezifikation**.
4. Test und Integration: Abgleich mit den Referenzmotoren und E2E
5. Abnahme und Deploy (GitHub Pages)

Nach jeder Phase gibt es eine **Statusrunde** als Kommentar im Issue „Statusrunden“.
