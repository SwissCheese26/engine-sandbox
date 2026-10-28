# engine-sandbox · Prüfzelle

Stell dir deinen eigenen Motor zusammen: Zylinder, Bohrung, Hub, Verdichtung, Einspritzung, Turbo und vieles mehr. Dann stellst du ihn auf den Prüfstand und gibst Gas. Drehmoment, Leistung, Verbrauch, Ladedruck und Temperaturen reagieren physikalisch realistisch, und der Motor klingt so, wie er gebaut ist.

**Antriebe in v0.1:** Diesel und Benziner. Geplant sind außerdem Hybrid, Elektro, Wasserstoff, Gas und ein Atom-Konzept.

## Spielen
Die Live-Version liegt auf GitHub Pages: https://swisscheese26.github.io/engine-sandbox/

## Lokal starten
Du brauchst [Bun](https://bun.sh).
```
bun install
bun run dev      # http://localhost:5173
bun run check    # Typecheck, Tests, Build
```

## Wie es gebaut wird
Das Projekt entsteht in Nachtschichten durch mehrere Claude-Teams: Recherche, Kern-Physik, Thermik & Aufladung, UI, Sound und Test. Die Arbeitsregeln stehen in [`CLAUDE.md`](CLAUDE.md), die Physik-Grundlagen in [`docs/research`](docs/research) und das Designkonzept in [`docs/process/design.md`](docs/process/design.md).
