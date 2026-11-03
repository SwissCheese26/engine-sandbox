# Recherche: Fahrzeug, Umwelt und Fahrassistenten (Issue #23)

> Stand: 2026-11-03 · Ergänzung zu #22 (Reifen) und #23 (Umwelt & Assistenten).
> Kennzeichnung: **[B]** = belegt (Quelle unten), **[S]** = Schätzung/Fachwissen, für Spielzwecke kalibriert.

## 1. Umwelt
- Luftdruck aus der Höhe nach ISA: p = 101,325 · (1 − 2,25577·10⁻⁵ · h)^5,25588 kPa [B1]. Die Luftdichte ist ρ = p / (287,05 · T) [B1].
- Fahrbahn (μ je Reifentyp in `src/core/tyres.ts`):
  - nass: μ ≈ 0,5–0,8 [B2]
  - starker Regen: Wasserfilm ×0,9 [S], Aquaplaning ab ≈ 80–100 km/h [B3]. Die Horne-Formel v ≈ 6,36·√p[kPa] gibt die obere Grenze für einen glatten Reifen [B4].
- Mischungsfenster [S]: Sommerreifen verlieren unter +7 °C Haftung, Winterreifen über ≈ 20 °C.

## 2. Fahrassistenten
- ABS-Regelzyklus nach Bosch [B2]:
  - Druckabbau, sobald der Bremsschlupf den μ-Peak überschreitet
  - Halten bzw. Wiederaufbau in Stufen, sobald das Rad wieder beschleunigt
  - typisch 4–15 Regelzyklen pro Sekunde, unter ≈ 5–7 km/h passiv
- ASR [B2]: Momenteneingriff über Drosselklappe/Einspritzung (langsam) und Zündwinkel (schnell). Der Sollschlupf hängt vom Reibwert ab: Auf griffigem Asphalt toleriert ASR mehr Schlupf (hier 0,18), auf glatter Fahrbahn regelt es nahe am Peak (0,08). Kurze Schlupfspitzen beim Einkuppeln werden nicht weggeregelt (Review PR #39: ASR darf auf trockener Fahrbahn keine Zeit kosten).
- MSR (Motorschleppmomentregelung, Teil von ESP) [B2]: Blockieren die Antriebsräder durch die Motorbremse, gibt die Motorsteuerung etwas Gas.

## 3. Halten am Berg
Hangabtriebskraft F = m·g·sin θ mit θ = atan(p/100) und Normalkraft m·g·cos θ [B5].

Vereinfachung im Modell: Die Fahrzeuggeschwindigkeit bleibt ≥ 0. Rückwärtsfahren gibt es nicht. Bergauf ohne Bremse und ohne genug Antrieb bleibt das Auto deshalb stehen. Das entspricht einer Berganfahrhilfe (Hill-Hold), wie sie bei vielen Autos ab Werk eingebaut ist, nur ohne deren Zeitlimit von ≈ 2 s [S].

Bergab rollt das Auto los, sobald der Hangabtrieb den Rollwiderstand übersteigt. Rückwärtsrollen kommt erst mit einem Rückwärtsgang.

## Quellen
- [B1] ISO 2533:1975, Standard Atmosphere (ICAO-Normatmosphäre).
- [B2] Robert Bosch GmbH: Kraftfahrtechnisches Taschenbuch, Kapitel „Kraftschlussbeiwerte“, „Antiblockiersystem ABS“, „Antriebsschlupfregelung ASR“, „Fahrdynamikregelung ESP“.
- [B3] ADAC: Aquaplaning-Tests (Reifentests, Profiltiefe und Wasserhöhe).
- [B4] Horne, W. B.; Dreher, R. C.: Phenomena of Pneumatic Tire Hydroplaning, NASA TN D-2056 (1963).
- [B5] Mitschke, M.; Wallentowitz, H.: Dynamik der Kraftfahrzeuge, Kapitel „Fahrwiderstände“.
