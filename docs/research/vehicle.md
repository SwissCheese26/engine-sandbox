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

## Umwelt/Strecke: Höhenprofile (#48)

- **Steigung:** Die Steigung in % ist die Ableitung der Höhe nach dem Weg (100 · dh/dx). Die Hangabtriebskraft ist m · g · sin(atan(s/100)) und läuft wie bisher über `VehicleCoupling.gradePct`.
- **Luft:** Luftdruck und Luftdichte kommen aus der Höhe nach ISA (barometrische Höhenformel, `environment.ts`). Sie wirken auf die Ansaugluft des Motors und auf den Luftwiderstand.
- **Typische Steigungen:**
  - Flachland unter 2–3 %
  - Mittelgebirgsstraßen 4–8 %
  - Alpenpässe 8–12 % mit einzelnen Rampen bis ≈ 15 %. Beispiele: Großglockner-Hochalpenstraße max. 12 %, Sustenpass ≈ 9 %, Stilfser Joch im Mittel ≈ 7–9 %. Quellen sind die Angaben der Passstraßen-Betreiber bzw. die Straßenbeschilderung.
- **Modell:** Jede Strecke ist eine geschlossene Summe von Sinuswellen mit ganzzahligen Perioden über die Streckenlänge. Höhe und Steigung sind dadurch stetig, ohne Sprünge in der Hangabtriebskraft, und die Strecke wiederholt sich nahtlos.
- **Berg hoch/runter:** konstant 8 %, nach 1600 m Höhenunterschied beginnt der nächste Berg.

## 4. Wandlerautomatik: hydrodynamischer Drehmomentwandler (#14)

Trilok-Wandler aus Pumpe (Motor), Turbine (Getriebe) und Leitrad auf Freilauf [B6, B7].

- **Drehzahlverhältnis** ν = n_T / n_P (Turbine / Pumpe).
- **Pumpenmoment** T_P = λ(ν) · (n_P / K)². K ist der Kapazitätsfaktor („K-Faktor“, n / √T, SAE J643) [B8]. Im Modell wird K aus der Festbremsdrehzahl und dem Spitzenmoment des eingebauten Motors bestimmt: K = n_Stall / √T_max. Hersteller stimmen den Wandler auf den Motor ab, deshalb bekommt ein stärkerer Motor einen „härteren“ Wandler [S].
- **Leistungszahl** λ(ν): bis zum Kupplungspunkt leicht fallend (−20 %), danach linear auf 0 bei ν = 1 [B6, S].
- **Wandlung** μ(ν) = T_T / T_P: μ₀ bei ν = 0, linear fallend auf 1 am Kupplungspunkt ν_K. Darüber läuft das Leitrad im Freilauf (Kupplungsbereich, μ = 1) [B6].
  - typische Werte Pkw: μ₀ ≈ 1,8–2,5, ν_K ≈ 0,85–0,9, Festbremsdrehzahl ≈ 2000–2800 1/min [B6, B7]
  - Nfz-Wandler: μ₀ ≈ 1,6–2,0 [B7, S]
- **Wirkungsgrad** η = μ · ν. Er ist im Wandlungsbereich klein, deshalb gibt es die Überbrückungskupplung.
- **Schub** (ν > 1): Rückwärtsdurchströmung mit etwa halber Kapazität, μ = 1 [S].
- **Überbrückungskupplung:**
  - schließt oberhalb einer Turbinendrehzahl, im Modell 1100–1600 1/min, mit mehr Gas später
  - bei Volllast erst ab dem 2. Gang
  - schließt in ≈ 0,5 s und rutscht während der Schaltungen geregelt [B7, S]
- **Kriechen:** Im Stand mit D und Leerlauf überträgt der Wandler (n_Leerlauf / K)², beim Pkw etwa 30–50 Nm. Ohne Bremse kriecht das Auto mit ≈ 5–7 km/h, mit Bremse muss der Motor dieses Moment im Leerlauf halten.
- **Schaltprogramm** wie beim DSG, aber auf der Turbinendrehzahl. Hochgeschaltet wird zusätzlich nach der Motordrehzahl, damit der schlupfende Wandler den Motor nicht im Begrenzer hält.
- **Bremsen mit Vollgas:** Die Bremse hält im Modell nur das Fahrzeug, nicht die Antriebsräder (wie beim Burnout mit Handschalter, #22). Mit Vollgas und Bremse drehen deshalb die Antriebsräder durch, statt den Motor auf der Festbremsdrehzahl zu halten.

## 5. Gangabstufung (#14)

Die Gänge lassen sich aus der Übersetzung des 1. und des höchsten Gangs berechnen [B6, B9]. Nach Jante gilt i_j = i_n · φ₁^(n−j) · φ₂^((n−j)(n−j−1)/2).

- **geometrisch:** φ₂ = 1, also ein konstanter Stufensprung φ₁ = (i₁/i_n)^(1/(n−1)). Üblich bei Nfz-Getrieben.
- **progressiv:** φ₂ ≈ 1,05–1,15 (im Spiel 1,1), große Sprünge unten und kleine oben. Üblich bei Pkw, weil die Zugkraftlücken im Zugkraftdiagramm bei hohem Tempo kleiner werden sollen.
- **Gangzahl:** 4–10, Lkw-AMT bis 12. Die Übersetzungen müssen positiv und streng fallend sein (`validateRatios`).

## 6. Zugkraftdiagramm (#14)

- **Zugkraft am Rad** je Gang: F = T_Volllast(n) · i_Gang · i_Achse · η / r_dyn bei v = n · 2π · r_dyn / (60 · i_Gang · i_Achse) [B9, B5]. Die Kurven aller Gänge bilden die „Zugkrafthyperbel“.
- **Fahrwiderstand:** F_W = m·g·(f_R·cos θ + sin θ) + ½·ρ·c_W·A·v² [B5].
- **Vmax** ist der höchste Schnittpunkt von Zugkraft und Fahrwiderstand über alle Gänge, oder die Geschwindigkeit am Drehzahlbegrenzer, wenn die Zugkraft dort noch über dem Widerstand liegt.
- **Bewertung** [B9, S]:
  - *zu kurz übersetzt:* Im höchsten Gang ist der Begrenzer erreicht, solange noch Zugkraftüberschuss besteht.
  - *zu lang übersetzt:* Der Schnittpunkt liegt im höchsten Gang unter ≈ 90 % der Nenndrehzahl, oder ein niedrigerer Gang ist schneller.
  - *auf Vmax ausgelegt:* Der Schnittpunkt liegt nahe der Nenndrehzahl, also bei maximaler Leistung.

### Quellen zu §4–6
- [B6] Naunheimer, H.; Bertsche, B.; Lechner, G. et al.: Fahrzeuggetriebe, 2. Aufl., Springer 2007, Kap. „Anfahrelemente: Hydrodynamische Wandler“ und „Gangabstufung“.
- [B7] Robert Bosch GmbH: Kraftfahrtechnisches Taschenbuch, Kapitel „Getriebe: Drehmomentwandler, Automatikgetriebe“.
- [B8] SAE J643: Hydrodynamic Drive Test Code (K-Faktor, Wandlung, Wirkungsgrad über dem Drehzahlverhältnis).
- [B9] Haken, K.-L.: Grundlagen der Kraftfahrzeugtechnik, Hanser, Kap. „Zugkraftdiagramm, Getriebeauslegung“.
