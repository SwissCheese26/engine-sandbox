# Recherche: Ottomotor (Benziner) + Akustik

> Stand: 2026-10-28 · Recherche-Team (Teil 2) · Gegenstück: `diesel.md` (nicht hier).
> Feldnamen und Enum-Werte exakt wie in `src/core/types.ts`.
> Kennzeichnung: **[B]** = belegt (Quelle unten), **[S]** = Schätzung/Fachwissen, für Spielzwecke kalibriert.

## Gliederung (Abschnitte in der Datei nach Priorität sortiert: 3, 7, 6, 1, 4, 2, 5, 8)
1. Parameter (Min/Max/Default)
2. Wirkung der Parameter
3. Echtzeit-Mittelwertmodell
4. Grenzen & Schäden
5. Gemeinsame Bausteine mit Diesel
6. Akustik (Benzin + Diesel)
7. Referenzmotoren
8. Quellen

## 3. Echtzeit-Mittelwertmodell

Mittelwertmodell (Mean Value Engine Model): pro Simulationsschritt (z. B. 1 ms … 16 ms) werden alle Größen
als Mittel über ein Arbeitsspiel (720 °KW) berechnet. Kein Kurbelwinkel-aufgelöster Druckverlauf nötig,
`crankAngleDeg` wird nur integriert (für Sound/Schema). Alle Formeln sind in Reihenfolge rechenbar.
Bezeichner `cfg` = `EngineConfig`, `n` = Drehzahl in 1/min.

### 3.1 Geometrie
```ts
const B = cfg.block.boreMm / 1000, S = cfg.block.strokeMm / 1000, z = cfg.block.cylinders;
const Vh = Math.PI / 4 * B * B * S * z;          // Gesamthubraum [m³]
const cm = 2 * S * n / 60;                        // mittlere Kolbengeschwindigkeit [m/s]
const omega = 2 * Math.PI * n / 60;               // [rad/s]
```
[B] Standarddefinitionen (Pischinger/Heywood).

### 3.2 Liefergrad η_L(n) (volumetric efficiency)

Aufbau: Grundniveau × Nockenkurve + Saugrohr-Resonanzbeule. Alle Konstanten **[S]**, kalibriert auf die
Referenzmotoren in Abschnitt 7 (Drehmomentspitzen-Lage ±10 %).

**a) Grundniveau (Spitzenwert)**
```ts
const veValves = { 2: 0.92, 3: 0.94, 4: 0.97, 5: 0.98 }[valvesPerCylinder];
let vePeak = veValves + 0.05 * camProfile           // schärfere Nocke = mehr Überschneidung/Hub
           + (individualThrottleBodies ? 0.02 : 0)
           + (mixture === "carburettor" ? -0.04 : 0)  // Vergaser-Venturi drosselt
           + (mixture === "direct-injection" || mixture === "dual-injection" ? 0.02 : 0); // Innenkühlung
// typ. Ergebnis: 2V-OHV 0.90 … 4V-Rennmotor 1.05 (mit Resonanz bis ~1.10)
```

**b) Nockenkurve: Lage und Breite des Maximums.** Die Lage hängt physikalisch an der Kolbengeschwindigkeit
(Strömungsgeschwindigkeit im Ventil), daher über `cm` definiert:
```ts
const cmPeak = 10 + 10 * camProfile;               // [m/s] mild: 10 m/s, Rennnocke: 20 m/s
const nPeak  = cmPeak * 60 / (2 * S);              // Drehzahl des VE-Maximums
// relative Halbwertsbreite; VVT verbreitert
const vvtWiden = { "none": 1.0, "intake-cam": 1.15, "dual-cam": 1.3, "cam-switching": 1.35 }[variableTiming];
const w   = (0.55 - 0.2 * camProfile) * vvtWiden;
const wLo = 1.25 * w, wHi = 0.8 * w;               // unterhalb flacher Abfall, oberhalb Drosselung
const x   = (n - nPeak) / (nPeak * (n < nPeak ? wLo : wHi));
let veCam = Math.exp(-0.5 * x * x);
veCam = 0.55 + 0.45 * veCam;                        // Untergrenze: auch weit weg >= 55 %
```
- `cam-switching` (VTEC-artig): zusätzlich zweite Kurve mit `camProfile + 0.3` (max 1) ab Umschaltdrehzahl
  `nSwitch ≈ 0.7 · nPeak(hohe Nocke)`; verwendet wird `max(veLow, veHigh)` → typischer Knick in der Kurve.
- Hohe `camProfile` (> 0,7) zusätzlich: Leerlauf unruhig, Liefergrad unter 2000 1/min × (1 − 0.25·(camProfile−0.7)/0.3).
- Prüfwerte: K20A (S = 86 mm, cam 0,85) → nPeak ≈ 6450 (real Drehmoment-Max 7000). LS3 (S = 92 mm, cam 0,3) → 4240 (real 4600).

**c) Saugrohrresonanz (Schwingrohr / λ/4-Welle)** [B für Prinzip, S für Konstanten]
Eine Druckwelle läuft im Saugrohr hin und zurück; Resonanz, wenn die λ/4-Eigenfrequenz `a/(4·L)` ein
ganzzahliges Vielfaches m der Einlassfrequenz pro Zylinder `n/120` ist. Für die nutzbare Ordnung m ≈ 6:
```ts
const Tin = intakeAirTempK;                          // nach Ladeluftkühler bzw. Umgebung + ~10 K
const a   = 20.05 * Math.sqrt(Tin);                  // Schallgeschwindigkeit Luft [m/s] (≈ 343 bei 20 °C)
const Leff = intakeRunnerLengthMm / 1000 + 0.08;      // + Kanal im Kopf
const nRes = 30 * a / (Leff * 6);                     // = 5·a/Leff  → 300 mm ≈ 4500 1/min, 200 mm ≈ 6150
const r = (n - nRes) / (0.18 * nRes);
const veRes = 0.06 * Math.exp(-r * r)                // Hauptresonanz +6 %
            - 0.03 * Math.exp(-((n - 0.75 * nRes) / (0.1 * nRes)) ** 2); // "Delle" unterhalb
// Turbo: Resonanzeffekt × 0.5 (Druckspeicher dämpft)
```
**d) Gesamt**
```ts
const etaL = Math.min(1.15, vePeak * veCam + veRes);
```

### 3.3 Drosselklappe → Saugrohrdruck
Physikalisch: Massenbilanz Saugrohr (Füll-/Entleermodell), echtzeitfähig mit explizitem Euler:
```ts
// Drosselfluss (kompressible Blende) [B: Heywood App. C]
const pr = Math.max(pMan / pUp, 0.0);               // pUp = Umgebung (Sauger) bzw. Ladedruck nach LLK
const prCrit = 0.528;
const psi = pr <= prCrit ? 1 : Math.sqrt(Math.max(0, 1 - ((pr - prCrit) / (1 - prCrit)) ** 2)); // Ellipsen-Näherung [S]
const phi = phiIdle + (1 - phiIdle) * pedal ** 1.8;  // progressive Pedalkennlinie [S], phiIdle ≈ 0.012 (+ Leerlaufregler)
const mDotTh  = phi * kTh * pUp / Math.sqrt(287 * Tup) * psi;   // [kg/s]
const mDotEng = etaL * (pMan / (287 * TMan)) * Vh * n / 120;     // [kg/s]
pMan += (287 * TMan / VMan) * (mDotTh - mDotEng) * dt;           // VMan ≈ 1.0…1.5 · Vh (ITB: 0.2 · Vh)
```
- `kTh` (effektive Vollöffnungsfläche × Cd) so wählen, dass bei Pedal 1 und Nenndrehzahl `pMan/pUp ≈ 0,97`.
  Faustregel: Drosselklappe ≈ 0,7 · √(Vh in Liter) · 60 mm Durchmesser [S]; einfacher: `kTh` aus der Bedingung
  oben einmalig bei Konfiguration berechnen (Fixpunkt).
- Ergebnis-Richtwerte [B/S]: Leerlauf 30–40 kPa abs, Teillast 50–90 kPa, Volllast Sauger 95–99 kPa.
- ITB: Totvolumen klein → Zeitkonstante ~3× kürzer → schärferes Ansprechen (Spielgefühl!).
- Turbo-Benziner: Drosselklappe sitzt nach dem Verdichter; Ladedruckregelung über Wastegate,
  `pUp = pAmb + boostActual`. Bei Teillast ist die Klappe teils zu UND die Wastegate offen.
- Alternativ ohne ODE (für Dyno-Sweep `DynoPoint`): Fixpunkt `pMan` aus `mDotTh = mDotEng`, 5 Iterationen Bisektion.

### 3.4 Luft- und Kraftstoffmasse
```ts
const rhoMan  = pMan * 1000 / (287 * TMan);          // pMan in kPa
const mAirCyc = etaL * rhoMan * Vh;                  // Luft pro Arbeitsspiel (alle Zylinder) [kg]
const airMassFlowKgS = mAirCyc * n / 120;
// λ-Strategie: Teillast stöchiometrisch (Kat!), Volllast angefettet
const lam = load < 0.8 ? 1.0 : 1.0 + (fullLoadLambda - 1.0) * Math.min(1, (load - 0.8) / 0.15);
// + Kaltstart: lam *= 0.85 bei Kühlmittel < 20 °C, linear auf 1 bis 60 °C [S]
// + Schubabschaltung: pedal == 0 && n > idle + 300 → mFuel = 0 (lambda → ∞, Anzeige "—")
const mFuelCyc = mAirCyc / (lam * fuel.afr);
const fuelMassFlowGS = mFuelCyc * n / 120 * 1000;
const fuelFlowLh     = fuelMassFlowGS * 3.6 / fuel.densityKgL;
```

**Kraftstofftabelle (`PetrolFuel`)**
| fuel | RON | Heizwert Hu [MJ/kg] | AFR stöch. | Dichte [kg/l] | Verdampfungswärme [kJ/kg] | Status |
|---|---|---|---|---|---|---|
| `ron91` | 91 | 43,0 | 14,7 | 0,740 | ~350 | B (Hu, AFR), S (Dichte) |
| `ron95` | 95 | 43,0 | 14,7 | 0,745 | ~350 | B |
| `ron98` | 98 | 42,8 | 14,6 | 0,750 | ~350 | S (mehr Aromaten/Ether) |
| `ron102` | 102 | 42,5 | 14,4 | 0,755 | ~360 | S (Rennbenzin, oxygeniert) |
| `e85` | ~105 | **29,2** | **9,8** | 0,782 | ~840 | S, gerechnet aus Mischung |

E85-Rechnung (85 Vol-% Ethanol): Massenanteil Ethanol = 0,85·0,789 / (0,85·0,789 + 0,15·0,745) ≈ 0,857.
Hu = 0,857·26,8 + 0,143·43,0 ≈ 29,1 MJ/kg; AFR = 0,857·9,0 + 0,143·14,7 ≈ 9,8 [B für Ethanol-Stoffwerte Hu 26,8 MJ/kg, AFR 9,0].
Folge: ~45 % mehr Kraftstoffmasse für gleiche Leistung, aber gleiche Energie pro kg Luft (≈ 2,9 MJ/kg Luft
bei beiden) → Leistung ähnlich, dazu Klopffestigkeit und Ladungskühlung → mehr Zündung/Ladedruck möglich.
Kraftstoffverbrauch in l/h steigt um ~40 %.

### 3.5 Indizierter Wirkungsgrad
```ts
const kappa = 1.30;                                     // effektiver Isentropenexponent des Arbeitsgases [S, übliche Näherung]
const etaOtto = 1 - Math.pow(compressionRatio, 1 - kappa); // ε=10 → 0,499; ε=12 → 0,525
// Gütegrad (realer Prozess / Vergleichsprozess): Wärmeverluste, endliche Brenndauer, Undichtigkeit
let etaG = 0.82;                                        // modern 4V, Dachbrennraum [S]
if (valvesPerCylinder === 2) etaG -= 0.03;              // flacher Brennraum, langsamere Verbrennung
if (mixture === "carburettor") etaG -= 0.04;            // schlechte Gemischverteilung
if (boreMm > 95) etaG -= 0.001 * (boreMm - 95);          // lange Flammwege
etaG *= 1 - 0.10 * Math.exp(-n / 1500);                  // Wandwärmeverluste bei niedriger Drehzahl
// Ergebnis η_i,HD ≈ 0,36 … 0,42 (Hochdruckteil, ohne Ladungswechsel) – deckt sich mit realen Benzinern
```
**λ-Einfluss** (Leistungsmaximum bei λ ≈ 0,88, Wirkungsgrad-Max. leicht mager) [B: Heywood Kap. 4/15, Kurvenform; S: Koeffizienten]:
```ts
// relative indizierte Arbeit bezogen auf gleiche Luftmasse
const d = 1 - lam;
const pRel = lam <= 1
  ? 1 + 0.6 * d - 2.5 * d * d            // λ 0,88 → +3,6 %, λ 0,80 → +2 %, λ 0,70 → −4,5 %
  : 1 - 0.55 * (lam - 1) - 0.5 * (lam - 1) ** 2;   // mager: weniger Leistung; > 1,35 Zündaussetzer
// Wirkungsgrad-Faktor bezogen auf eingesetzten Kraftstoff:
const etaLam = lam * pRel;                // λ 0,85 → 0,88 (12 % Kraftstoff verschwendet)
```
**Zündwinkel** (quadratischer Verlust um MBT) [B Prinzip; Koeffizient S, passt zu typ. 10° Spät → ≈ −5 %, 20° → ≈ −20 %]:
```ts
const dIgn = ignitionAdvanceOffsetDeg - knockRetardDeg;        // 0 = MBT
const etaIgn = Math.max(0.3, 1 - 0.0005 * dIgn * dIgn);        // symmetrisch; Frühverstellung bringt nichts, nur Klopfen
```
Spätzündung verschiebt Energie ins Abgas (→ EGT, Kat-Heizen, Schubknallen).

### 3.6 Klopfmodell (Oktanbedarf vs. Oktanzahl)
Ansatz: erforderliche Oktanzahl `ronReq` aus Betriebszustand, verglichen mit der effektiven Oktanzahl des
Kraftstoffs. Alle Koeffizienten **[S]**, so kalibriert, dass die Referenzmotoren (Abschnitt 7) auf ihrem
Serienkraftstoff knapp klopffrei oder leicht klopfbegrenzt bei niedriger Drehzahl laufen (wie real).
```ts
let epsEff = compressionRatio;
if (mixture === "direct-injection") epsEff -= 1.0;      // Verdampfungskühlung im Zylinder ≈ 1 Verdichtungspunkt
if (mixture === "dual-injection")   epsEff -= 1.0;
const pAbs = manifoldAbsKpa / 100;                      // [bar]
let ronReq = 90
  + 4.0 * (epsEff - 10)                                  // Verdichtung
  + 22  * Math.log(Math.max(pAbs, 0.2))                  // Lastdruck (log): 1 bar Ladedruck ≈ +15 ROZ
  + 0.20 * (TManC - 40)                                  // Ladelufttemperatur
  + 0.10 * Math.max(0, coolantC - 90)                    // heißer Motor
  + 0.8  * dIgn                                          // jeder Grad früher ≈ +0,8 ROZ
  - 1.5  * Math.min(4, Math.max(-1, (n - 2000) / 1000))  // höhere Drehzahl = weniger Zeit für Selbstzündung
  - 20   * Math.max(0, 1 - lam)                          // Anfetten kühlt (λ 0,85 → −3)
  + 0.15 * (boreMm - 86);                                // große Bohrung = lange Flammwege
const ronFuel = { ron91: 91, ron95: 95, ron98: 98, ron102: 102, e85: 105 }[fuel]
              + (fuel === "e85" && (mixture === "direct-injection" || mixture === "dual-injection") ? 2 : 0);
const margin = ronFuel - ronReq;                         // > 0: klopffrei
```
Plausibilitätscheck: K20A (ε 11,5, Saugrohr, 1 bar, 40 °C, 3000 1/min) → ronReq ≈ 94,5 (läuft auf 98/100 mit Reserve);
EA888 (ε 9,6 DI, 2,3 bar abs, 50 °C) → ≈ 105 bei 1500 1/min → auf 95/98 klopfbegrenzt, Regelung nimmt Zündung zurück (real so).

**Klopfregelung** (Klopfsensor + Steuergerät) [B Prinzip, S Raten]:
```ts
const needRetard = Math.max(0, -margin / 0.8);           // Grad, um margin auf 0 zu bringen
const maxRetard = 15;                                    // °KW Regelbereich; carburettor: keine Regelung (maxRetard = 0)
// schnelles Zurücknehmen (≈ 3 °/Klopfereignis, ~0,1 s), langsames Vorstellen (≈ 1 °/s)
knockRetardDeg = needRetard > knockRetardDeg
  ? Math.min(needRetard, knockRetardDeg + 30 * dt)
  : Math.max(needRetard, knockRetardDeg - 1 * dt);
knockRetardDeg = Math.min(knockRetardDeg, maxRetard);
const residual = -margin - 0.8 * knockRetardDeg;         // nicht weggeregeltes Klopfen in ROZ
const knock = Math.min(1, Math.max(0, residual / 5));    // → EngineState.knock
```
Zusätzlich Regel-Rücknahme (Ladedruck −) bei Turbo, wenn `knockRetardDeg > 10`. Klopfgeräusch → Abschnitt 6.

### 3.7 Ladungswechsel (Pumpverluste)
```ts
const pBack = pAmb + dpExh;   // Abgasgegendruck vor Turbine bzw. vor Schalldämpfer [kPa]
// Sauger: dpExh ≈ 15 kPa · (airMassFlow / airMassFlowRated)²  (+5 kPa mit catalyst, Rohr kurz/lang ±) [S]
// Turbo: pExh vor Turbine ≈ (1.1 … 1.6) · pBoostAbs, größer bei kleinem turbineAR (siehe turbo.ts)
const pmepBar = (pBack - pMan) / 100;      // positiv = Verlust; Leerlauf ≈ 0,7 bar, Volllast Sauger ≈ 0,15 bar
```
[B: Heywood, PMEP ≈ Differenz Auslass- zu Einlassdruck]. Beim Turbo unter Last kann `pmep` negativ werden
(Gewinn), wenn `pMan > pExh` (großer Lader, hohe Drehzahl).

### 3.8 Reibung (Chen-Flynn)
[B] Chen-Flynn-Korrelation: `FMEP = A + B·p_max + C·S_f + D·S_f²`, mit Beispielkoeffizienten für einen
2,0-l-R4-Benziner A = 0,3 bar, B = 0,006, C = 0,05 bar·s/m, D = 8,5·10⁻⁴ bar·s²/m², `S_f = ω·S/2`.
Da `ω·S/2 = (π/2)·cm`, umgerechnet auf mittlere Kolbengeschwindigkeit:
```ts
// Literatur-Koeffizienten, direkt umgerechnet:
// fmep = 0.30 + 0.006*pMax + 0.0785*cm + 0.0021*cm²   → bei cm 20 m/s ≈ 3,2 bar: für Hochdrehzahl-Motoren zu hoch
// Spielkalibrierung [S] (trifft K20A @ 7000 und LS3 @ 4600 auf ±5 % Drehmoment):
let fmepBar = 0.30 + 0.006 * peakPressureBar + 0.060 * cm + 0.0012 * cm * cm;
// Modifikatoren [S]:
fmepBar *= { ohv: 0.92, sohc: 1.0, dohc: 1.04 }[valvetrain];            // weniger Nockenwellen/Lager
fmepBar *= 1 + 0.03 * (valvesPerCylinder - 2) / 3;                        // mehr Federn
fmepBar *= 1 + 1.5 * Math.max(0, (90 - oilC) / 70);                       // kaltes Öl: bei 20 °C ×2,5
// Werte (warm): cm 5 ≈ 0,75 bar; cm 14 ≈ 1,8 bar; cm 20 ≈ 2,5 bar (inkl. Ölpumpe/Wasserpumpe) – plausibel
```
Nachrechnung (von Hand, mit obigen Formeln, λ 0,88):
- LS3 @ 4600: η_L ≈ 0,96, η_i ≈ 0,36 → imep ≈ 12,8 bar, p_max ≈ 68 bar, fmep ≈ 1,65, pmep ≈ 0,15 → bmep ≈ 11,0 bar → **≈ 540 Nm** (real 575 Nm, −6 %).
- K20A @ 7000: cm 20,1 m/s, η_L ≈ 1,0 (ohne Resonanz), η_i ≈ 0,39 → imep ≈ 14,3, fmep ≈ 2,6 → bmep ≈ 11,5 → **≈ 183 Nm**; mit auf 7000 abgestimmter Resonanz (+6 %) ≈ 197 Nm (real 206 Nm, −4 %).
- Fazit: Modell liegt systematisch 4–6 % zu tief → Testteam darf Toleranz ±10 % ansetzen; Feinkalibrierung über `etaG` (0,82 → 0,85). Turbo-Benziner: Serienmotoren begrenzen das
Drehmoment per Steuergerät auf ein Plateau (EA888: 350 Nm ab 1500) – im Spiel als Ladedruck-Sollkurve abbilden,
sonst rechnet das Modell bei niedriger Drehzahl zu viel.

### 3.9 Mitteldrücke, Drehmoment, Leistung, Verbrauch
```ts
const QfuelCyc = mFuelCyc * fuelLhv;                                  // [J] pro Arbeitsspiel
const Wi = etaOtto * etaG * etaLam * etaIgn * QfuelCyc;               // indizierte Arbeit (Hochdruck)
const imepBar = Wi / Vh / 1e5;
const bmepBar = imepBar - pmepBar - fmepBar;
const torqueNm = bmepBar * 1e5 * Vh / (4 * Math.PI);                  // 4-Takt [B]
const powerKw  = torqueNm * omega / 1000;
const bsfcGkWh = powerKw > 0.5 ? fuelMassFlowGS * 3600 / powerKw : NaN;
const efficiency = powerKw > 0 ? powerKw * 1000 / (fuelMassFlowGS / 1000 * fuelLhv) : 0;
```
Zielwerte [B, Heywood/Pischinger]: bmep Sauger Serie 11–13 bar, Sauger Rennmotor 13–14,5 bar,
Turbo-DI 18–25 bar. Best-BSFC Benziner 230–260 g/kWh (η_e 0,33–0,36), modern bis ~225 (η 0,38).
Leerlauf-Verbrauch ~0,6–1,0 l/h für 2 l.

### 3.10 Abgastemperatur (vor Turbine bzw. Krümmer)
```ts
const Qrel = mAirCyc / fuel.afr * fuelLhv * Math.min(1, 1 / lam);    // tatsächlich umgesetzte Energie
let fExh = 0.36 + 0.006 * Math.max(0, -dIgn) + 0.02 * n / 6000;     // Anteil in den Abgasen; Spätzündung ↑
fExh *= 0.75 + 0.25 * load;                                          // Teillast: mehr Wärmeverlust im Krümmer
const cpExh = 1200;                                                  // J/(kg·K)
let egtC = TManC + fExh * Qrel / ((mAirCyc + mFuelCyc) * cpExh);
egtC -= 600 * Math.max(0, 1 - lam);                                   // Anfettungskühlung: λ 0,85 → −90 K
// Richtwerte: Leerlauf 350–500 °C, Teillast 600–750 °C, Volllast λ 1: 900–1000 °C, λ 0,85: ~850 °C
// Diesel zum Vergleich: Volllast 600–750 °C
```
Für das Thermik-Team: Kühlmittel-Wärmestrom ≈ 0,25–0,30 · Q̇_Kraftstoff bei Volllast, bei Teillast anteilig höher (~0,35). [S/B Heywood: Größenordnung]

### 3.11 Spitzendruck
```ts
const pComp = (manifoldAbsKpa / 100) * Math.pow(compressionRatio, 1.3);     // Kompressionsende [bar]
const peakPressureBar = pComp + 3.6 * imepBar * (1 + 0.03 * dIgn);           // [S] kalibriert
// Sauger ε 11, imep 13 → ~70 bar; Turbo ε 9,6, 2,3 bar abs, imep 22 → ~125 bar; Diesel 160–220 bar
```

### 3.12 Turbo (kurz, gemeinsam mit Diesel)
- Ladedruckregelung Benziner: **Wastegate** (`variableGeometry` meist `false`; VTG nur bei sehr hitzefesten Ladern, z. B. Porsche 911 Turbo seit 2006, da Benzin-EGT bis ~1000 °C).
- Lader-Trägheit: Wellendrehzahl-ODE `J·dω/dt = (P_Turbine − P_Verdichter)/ω`, Details in `turbo.ts`/Diesel-Doku.
- Benziner haben bei niedriger Drehzahl mehr Abgasenergie (höhere EGT) als Diesel, aber weniger Massenstrom bei Teillast (Drosselung) → Turboloch aus Teillast größer.
- `e-turbo`: E-Motor unterstützt die Welle (≈ 5–10 kW), praktisch kein Loch.
- `supercharger-roots`: Ladedruck ∝ Drehzahl ab Leerlauf (fast konstant über n), Antriebsleistung 10–15 % der Motorleistung. `supercharger-centrifugal`: Ladedruck ∝ n², oben voll.
- Ladeluftkühler: `air-to-air` Wirkungsgrad 0,65–0,8, `air-to-water` 0,8–0,9 (dafür Wärme ins Kühlsystem), `none`: T nach Verdichter (bei 1 bar Ladedruck ~100–120 °C!).

### 3.13 Thermik (kurz)
Kühlmittel/Öl als 2 Wärmekapazitäten (Thermik-Team). Thermostat (`thermostatOpenC`, typ. 87–95 °C) öffnet über ~10 K.
Benziner ~ gleiche Wärmeströme ins Kühlmittel wie Diesel bei gleicher Leistung, aber höhere Abgastemperatur.

## 7. Referenzmotoren

Für `src/data/reference-engines.ts` und die Abgleich-Tests. Werte Datenblatt **[B]**, wo nicht anders markiert.
Abgleich-Toleranz-Vorschlag: Spitzendrehmoment ±10 %, Spitzenleistung ±10 %, Drehzahl der Spitze ±12 %.

| | Honda K20A (DC5 Type R, JDM) | VW EA888 Gen3 (CHHB, Golf 7 GTI) | BMW S54B32 (E46 M3) | GM LS3 6.2 (C6 Corvette) | Ferrari F136 FB (458 Italia) |
|---|---|---|---|---|---|
| `layout` / `cylinders` | inline / 4 | inline / 4 | inline / 6 | v / 8 | v / 8 |
| `bankAngleDeg` | – | – | – | 90 | 90 |
| `v8Crank` | – | – | – | crossplane | flatplane |
| `boreMm` × `strokeMm` | 86 × 86 | 82,5 × 92,8 | 87 × 91 | 103,25 × 92 | 94 × 81 |
| Hubraum | 1998 cm³ | 1984 cm³ | 3246 cm³ | 6162 cm³ | 4499 cm³ |
| `conrodLengthMm` | 139 [S] | 144 [S] | 139 [S] | 154,9 (6,098 in) [S, gängiger LS-Wert] | ~140 [S] |
| `compressionRatio` | 11,5 | 9,6 | 11,5 | 10,7 | 12,5 |
| `blockMaterial` | aluminium | cast-iron (Grauguss, dünnwandig) | cast-iron | aluminium | aluminium |
| `valvetrain` / `valvesPerCylinder` | dohc / 4 | dohc / 4 | dohc / 4 | ohv / 2 | dohc / 4 |
| `variableTiming` | cam-switching (i-VTEC) | dual-cam (+ AVS Auslasshub) | dual-cam (Doppel-VANOS) | none (Corvette); Camaro L99 hat VVT | dual-cam |
| `camProfile` [S] | 0,85 | 0,35 | 0,8 | 0,35 | 0,95 |
| `mixture` | port-injection | dual-injection | port-injection | port-injection | direct-injection (200 bar) |
| `aspiration` / Ladedruck | naturally-aspirated | turbo (IHI, im Kopf integrierter Krümmer), ~1,3 bar Spitze | naturally-aspirated | naturally-aspirated | naturally-aspirated |
| `individualThrottleBodies` | false | false | **true** | false | false |
| `fuel` (Serie) | ron98 (JDM 100 Oktan „High Octane“) | ron95 (GTI auch 98 empf.) | ron98 | ron91 (US 91 AKI ≈ 95–96 ROZ → ron95 im Spiel) [S] | ron98 |
| Leistung | 162 kW (220 PS) @ 8000 | 162 kW @ 4500–6200 | 252 kW (343 PS) @ 7900 | 321 kW (430 hp) @ 5900 | 419 kW (570 PS) @ 9000 |
| Drehmoment | 206 Nm @ 7000 | 350 Nm @ 1500–4400 | 365 Nm @ 4900 | 575 Nm (424 lb·ft) @ 4600 | 540 Nm @ 6000 |
| `revLimitRpm` | 8400 (Begrenzer 8400–8600) | ~6800 [S] | 8000 | 6600 [S, Corvette-Begrenzer] | 9000 |
| mittl. Kolbengeschw. bei Begrenzer | 24,1 m/s | 21,0 m/s | 24,3 m/s | 20,2 m/s | 24,3 m/s |
| bmep Spitze (berechnet) | 13,0 bar | 22,2 bar | 14,1 bar | 11,7 bar | 15,1 bar |
| Charakter / Testzweck | Hochdrehzahl-Sauger, VTEC-Knick | Turbo-Plateau, DI-Klopfgrenze | ITB, R6-Klang, hohe cm | Crossplane-Blubbern, OHV-Drehzahlgrenze | Flatplane-Schrei, hohe Verdichtung + DI |

Hinweise:
- K20A: Bohrung/Hub 86 × 86 ist der bekannte K20-Wert (Quadrat-Hubverhältnis) [B allgemein K-Serie; S für die exakte Zuordnung].
  FD2 (2007): ε 11,7, 165 kW @ 8000, 215 Nm @ 6100.
- EA888 Gen3: Drehmoment ist **vom Steuergerät begrenzt** (Plateau), nicht durch Luftaufwand. Für den Test:
  `boostTargetBar` so setzen, dass bmep ≈ 22 bar bis ~4400 1/min; darüber fällt der Ladedruck (Lader am Stopfgrenze/Turbine ausgelastet).
- LS3: Zündfolge 1-8-7-2-6-5-4-3 [B]. Eigener Gewichts-Referenzpunkt: ~183 kg Langblock [S].
- F136 FB: Flatplane, Trockensumpf. Bohrung/Hub: 94 × 81 (überquadratisch) [B, Zuordnung aus Hubraum 4499 cm³ verifiziert: π/4·9,4²·8,1·8 = 4497 cm³].
- Optionaler Turbo-Referenzmotor: Honda K20C1 (Civic Type R FK8): ε 9,8, 235 kW @ 6500, 400 Nm @ 2500–4500, DI, Monoscroll-Turbo [B Wikipedia].
- Massen-Richtwerte für `mass.ts` [S]: R4 Alu 2 l ≈ 110–130 kg, R4 Turbo Grauguss ≈ 140 kg, R6 3 l ≈ 180–210 kg, V8 Alu OHV ≈ 185 kg, V8 Alu DOHC ≈ 200 kg.

## 6. Akustik (Benzin und Diesel, für prozedurale Synthese)

### 6.1 Grundfrequenz
```ts
const fFire = rpm / 60 * cylinders / 2;      // Zündfrequenz [Hz] (4-Takt): R4 @ 3000 → 100 Hz, V8 @ 6000 → 400 Hz
const fCrank = rpm / 60;                      // 1. Motorordnung; bei ungleichem Zündabstand stark hörbar
const fCam = rpm / 120;                       // 0,5. Ordnung: Arbeitsspiel; Grundton jeder einzelnen Bank
```
Hörbar ist vor allem die **Zündordnung** (Ordnung z/2) und ihre Harmonischen. Ungleiche Zündabstände erzeugen
Energie in den **Halbordnungen** (0,5., 1., 1,5. …) → „Blubbern/Grollen“. Synthese-Empfehlung: pro Zylinder einen
Impuls bei seinem Zündwinkel (aus `EngineSummary.firingIntervalsDeg` und `crankAngleDeg`) erzeugen und
durch einen Bank-/Krümmer-spezifischen Verzögerungs- + Filterpfad schicken. Dann entsteht der Charakter automatisch.

### 6.2 Zündabstände und Zündfolgen
Gleichmäßiger Abstand = 720° / z. [B: Wikipedia „Firing order“ für Zündfolgen; Abstände aus Kurbelgeometrie]
| Bauform | `firingIntervalsDeg` | Typische Zündfolge | Klangcharakter |
|---|---|---|---|
| R3 | 240,240,240 | 1-2-3 | Knurrig, starke 1,5. Ordnung |
| R4 | 180×4 | 1-3-4-2 (britisch auch 1-2-4-3) | Neutral, „sägend“ bei hoher n; 2. Ordnung dominant |
| R5 | 144×5 | 1-2-4-5-3 | Warm-heiser, „halber V10“; 2,5. Ordnung liegt zwischen R4 und R6 → eigentümlich |
| R6 | 120×6 | 1-5-3-6-2-4 | Glatt, seidig, harmonisch („Turbinen“-artig bei hoher n) |
| V6 60° | 120×6 | R1-L1-R2-L2-R3-L3 (bzw. 1-2-3-4-5-6) | Glatt, etwas rauer als R6 |
| V6 90° gleichmäßig (Hubzapfenversatz 30°) | 120×6 | R1-L2-R2-L3-L1-R3 | wie 60° |
| V6 90° ungleich (gemeinsamer Hubzapfen, alte Buick 231) | 90,150,90,150,90,150 | 1-6-5-4-3-2 | Unrund, hinkend [B Abstand, S Zündfolge] |
| V6 120° (z. B. McLaren/Ferrari Hybrid-V6) | 120×6 | – | gleichmäßig |
| V8 Crossplane 90° | 90×8 (gesamt gleichmäßig) | GM LS: 1-8-7-2-6-5-4-3 [B]; Ford 5.0: 1-5-4-2-6-3-7-8 | „Blubbern“ (siehe 6.3) |
| V8 Flatplane 90° | 90×8 | Ferrari: 1-5-3-7-4-8-2-6 (Bank A: 1–4, B: 5–8) [S] | Kreischend, wie zwei R4 |
| Boxer-4 | 180×4 | R1-R2-L1-L2 (Subaru 1-3-2-4) | Grollen nur durch ungleiche Krümmer (6.3) |
| Boxer-6 | 120×6 | R1-L2-R3-L1-R2-L3 (Porsche 1-6-2-4-3-5) | Heiser-metallisch, glatt |
| V10 72° | 72×10 | R1-L5-R5-L2-R2-L3-R3-L4-R4-L1 | Hoch, „F1-artig“, sehr dicht |
| V10 90° ungleich (Dodge Viper, gemeinsame Hubzapfen) | 90,54 abwechselnd | 1-10-9-4-3-6-5-8-7-2 | Rau, LKW-artig [S] |
| V12 60° | 60×12 | z. B. 1-7-5-11-3-9-6-12-2-8-4-10 [S] | Dichter, sehr glatter „Schrei“ |
| VR6 15° | 120×6 | 1-5-3-6-2-4 | Fast wie R6, aber kehliger (gemeinsamer Krümmer) |
| W12 | 60×12 | – | wie V12, gedämpfter |

### 6.3 Warum es so klingt
- **Crossplane-V8 „blubbert“:** Insgesamt zündet alle 90° ein Zylinder, aber **pro Bank** nicht gleichmäßig.
  LS-Zündfolge 1-8-7-2-6-5-4-3 mit Bank links = 1,3,5,7 und rechts = 2,4,6,8: Bank links zündet in Abständen
  180-270-180-90°, Bank rechts 180-90-180-270°. Jeder Krümmer (bzw. jedes Auspuffrohr) sieht also unregelmäßige
  Pulse → starke Energie bei der 0,5. bis 2. Ordnung neben der Hauptordnung 4 → Blubbern. Mit X-/H-Rohr oder
  180°-Krümmern („bundle of snakes“) wird es glatter. [B Zündfolge; Mechanismus: Ableitung]
  Synthese: zwei Bank-Pfade, je 4 Pulse/720° an den genannten Positionen, leicht unterschiedliche Rohrlänge.
- **Flatplane-V8:** Bänke zünden abwechselnd, jede Bank gleichmäßig alle 180° → zwei R4 → klarer, hoher Ton (Ordnung 4, kaum Halbordnungen).
- **Boxer-Grollen (Subaru EJ):** Zündabstand ist gleichmäßig 180°, aber die Krümmerrohre sind ungleich lang
  (Sammler sitzt seitlich versetzt). Pulse kommen am Sammelpunkt paarweise ungleich verzögert an → Klumpen
  statt gleichmäßiger Folge → tiefes „Wummern“. Gleichlange Krümmer machen ihn neutral wie einen R4. [B: SlashGear]
  Synthese: pro Zylinder Delay `Δt = L_i / a_Abgas` (a ≈ 550–650 m/s bei 600–800 °C), L-Unterschied ≈ 0,3–0,5 m.
- **R5:** 144°-Abstand → Hauptordnung 2,5; zusammen mit der Ungleichförmigkeit zwischen Zylinder 1 und 5 (lange Kurbelwelle) ergibt sich eine Mischung aus R4-Rauheit und R6-Glätte (Audi-Quattro-Klang).
- **Hochdrehzahl-Sauger (K20A, S54):** Ansauggeräusch (Schwingrohr/ITB) prägt stark mit, besonders ITB → „Ansaug-Röhren“.

### 6.4 Verbrennungsgeräusche
- **Benzin-Klopfen:** Druckschwingung im Brennraum, 1. Umfangsmode nach Draper: `f = 1.841 · a / (π · B)`,
  mit a ≈ 900–1000 m/s im verbrannten Gas → B = 86 mm: ≈ 6,5 kHz; B = 103 mm: ≈ 5,4 kHz [B Formel Draper/Heywood; S a].
  Synthese: kurzer abklingender Sinus (Abklingzeit ~1–2 ms) mit Amplitude ∝ `knock`, zufällig pro Zündung („Klingeln/Scheppern“).
- **Diesel-Nageln:** Zündverzug → schlagartige Verbrennung einer vorgemischten Menge → steiler Druckanstieg
  (dp/dφ 5–15 bar/°KW gegenüber 2–4 beim Benziner) → Breitbandanregung der Struktur, hörbar ~**1–3 kHz** (bis 4 kHz).
  Kalt stärker (längerer Zündverzug), Leerlauf/Teillast deutlich, Volllast relativ maskiert; Common-Rail mit
  Voreinspritzung stark leiser, Vorkammer/Wirbelkammer weicher als frühe Direkteinspritzer (`unit-injector` laut).
  Synthese: pro Zündung kurzer Bandpass-Rauschburst 1–3 kHz, Pegel ∝ (1 + kalt-Faktor) × Einspritzart-Faktor
  (`common-rail` 0,4, `unit-injector` 1,0, `indirect-*` 0,6). [B Frequenzbereich als Größenordnung, S Faktoren]
- Benziner allgemein: weichere Verbrennung → Klang dominiert durch Auspuff-Pulse, nicht durch Struktur.

### 6.5 Aufladung
- **Turbopfeifen:** Schaufeldurchgangsfrequenz `f = Schaufelzahl · turboRpm / 60`. Typischer PKW-Verdichter 6 Haupt- + 6 Splitterschaufeln:
  bei 150 000 1/min → 2500 Hz Wellenfrequenz → 15 kHz (6 Schaufeln) bzw. 30 kHz (12). Hörbar sind v. a. die Wellenordnung und
  „Buzz-Saw“/Rotations-Subharmonische 2–8 kHz → im Spiel: Sinus bei `6 · turboRpm/60` mit Begrenzung auf hörbaren Bereich
  + leiser Ton bei `turboRpm/60`, Pegel ∝ Massenstrom. [B Prinzip BPF; S Pegel]
- **Abblasventil (Schubumluft/BOV):** Pedal schlagartig zu bei Ladedruck > 0,3 bar → offenes BOV: „Pssscht“ = Rauschen, Bandpass 1–4 kHz,
  Abklingen 0,2–0,5 s ∝ Ladedruck; Umluftventil (Serie): leises Rauschen + kurzes Verdichterpumpen-„Flattern“ (Pumpgrenze, 10–20 Hz Flatter).
- **Kompressor (Roots):** Heulen mit `Rotorflügel × Laderdrehzahl` (Übersetzung ~2:1 zur Kurbelwelle) → stark drehzahlgekoppelter Pfeifton.
- **Schubknallen/Patschen:** Unverbrannter Kraftstoff bzw. Spätzündung im Schub → Nachverbrennung im heißen Krümmer/Auspuff.
  Auslösen, wenn `pedal` → 0 bei n > 3500 und hoher EGT, oder Spätzündungs-Mapping (Sportmodus). Zufallsknalle 2–6 pro s, abklingend.
  Benziner-typisch; Diesel nicht (mager).

### 6.6 Anteile und Filterung
- Richtwerte für die Mischung im Prüfstandsraum [S]: Auspuff 60–70 %, Ansaugung 15–25 % (ITB/Kompressor bis 40 %),
  Mechanik/Struktur 10–20 % (Diesel: Struktur/Nageln bis 30 %), Turbo 5–10 %.
- Pegel steigt mit Last (`EngineState.load`) und Drehzahl: Auspuffpegel ≈ +6 dB pro Verdopplung der Drehzahl, +6–10 dB von Schub auf Volllast.
- **Auspuff als Filter:** Krümmer + Rohr = Wellenleiter mit Resonanzen bei `f_k = k · a / (2 · L)` (beidseitig offen) bzw. `(2k−1)·a/(4L)`;
  Schalldämpfer = Tiefpass (Kat und Mittelschalldämpfer: Grenzfrequenz ~300–800 Hz), Endrohr-Resonator betont 50–200 Hz.
  Synthese-Kette: Pulsfolge → Comb-/Delay-Resonator (Rohrlänge, a ≈ 550 m/s heißes Abgas) → Tiefpass (Cutoff steigt leicht mit Last) →
  Leichte Sättigung (Waveshaper) für Volllast.
- `catalyst`/`particulateFilter` dämpfen hohe Frequenzen zusätzlich (−3 … −6 dB über 1 kHz) [S].
- Ansaugung: Helmholtz-Resonator Airbox `f = a/(2π) · √(A/(V·L))`; ITB ohne Airbox → offener, schnarrender Klang.
- Diesel: tiefer, weil niedrigere Drehzahl; Turbo dämpft Auspuffpulse stark (Turbine wirkt wie Schalldämpfer, auch beim Benziner-Turbo).

## 1. Parameter (Benziner: Min / Max / Default)

Min/Max = sinnvoller Spielbereich (UI-Slider), Default = brauchbarer 2-l-R4-Sauger. Status überwiegend **[S]**
(Bandbreite realer Serien- und Rennmotoren), Eckpunkte durch Abschnitt 7 belegt.

**BlockConfig**
| Feld | Min | Max | Default | Einheit / Hinweis |
|---|---|---|---|---|
| `layout` | – | – | `"inline"` | Benziner: alle Werte; `vr` nur 6 Zyl. (15°), `w` nur 8/12/16 |
| `cylinders` | 1 | 16 | 4 | inline 1–6 (8 historisch), v 6–16, boxer 2/4/6, vr 5/6, w 8/12/16 |
| `bankAngleDeg` | 10 | 180 | 90 | V6: 60/90/120, V8: 90, V10: 72/90, V12: 60/65; vr 10,6–15; boxer ignoriert (=180) |
| `v8Crank` | – | – | `"crossplane"` | nur V8 |
| `boreMm` | 50 | 110 | 86 | Pkw 70–105; > 105 nur große US-V8 |
| `strokeMm` | 40 | 110 | 86 | Bohrung/Hub 0,8 … 1,5 (F1 ~2,5, nicht freigeben) |
| `conrodLengthMm` | 1,4·Hub | 2,2·Hub | 1,62·Hub | Pleuelverhältnis λ_s = r/l 0,25–0,35 (Benziner eher lang) |
| `compressionRatio` | 7,5 | 14,0 | 10,5 | Turbo-Saugrohr 8–9,5; Turbo-DI 9,5–10,5; Sauger 10–12,5; Mazda Skyactiv 14 |
| `blockMaterial` | – | – | `"aluminium"` | `compacted-graphite-iron` bei Benzin selten (nur Gewicht/Kosten-Nachteil) |
| `crankshaft` | – | – | `"cast"` | forged ab ~100 kW/l oder > 7500 1/min, billet Rennsport |
| `pistons` | – | – | `"cast-aluminium"` | forged-aluminium bei Turbo > 90 kW/l; `steel` beim Benziner unüblich (schwer, Klopf-Hotspot) |
| `conrods` | – | – | `"forged-steel"` | titanium nur Hochdrehzahl (Ferrari, Honda NSX) |

**HeadConfig**
| Feld | Min | Max | Default | Hinweis |
|---|---|---|---|---|
| `valvetrain` | – | – | `"dohc"` | `ohv` nur mit 2 Ventilen sinnvoll (Validierung: ohv ⇒ valvesPerCylinder 2) |
| `valvesPerCylinder` | 2 | 5 | 4 | 3: sohc (Mercedes M112), 5: Audi/VW 20V |
| `camProfile` | 0 | 1 | 0,4 | 0 Ökonomie, 0,4 Serie, 0,7 Sport, 1 Rennnocke |
| `variableTiming` | – | – | `"intake-cam"` | `cam-switching` = VTEC/Valvelift |

**InductionConfig**
| Feld | Min | Max | Default | Hinweis |
|---|---|---|---|---|
| `aspiration` | – | – | `"naturally-aspirated"` | |
| `compressorInducerMm` | 30 | 80 | 45 | Richtwert: ≈ 15 + 13·√(Leistungsziel kW / 100) [S]; 2 l Serie 40–48 |
| `turbineAR` | 0,35 | 1,2 | 0,6 | |
| `variableGeometry` | false | true | false | Benziner: nur möglich, erhöht Kosten; EGT-Grenze für VTG 950 °C |
| `boostTargetBar` | 0 | 2,5 | 0 (NA) / 1,0 (Turbo) | Serie 0,6–1,5; Tuning bis 2,0; > 2,5 nur Rennsport |
| `intercooler` | – | – | `"air-to-air"` (Turbo) | |
| `intakeRunnerLengthMm` | 100 | 700 | 350 | Hochdrehzahl 150–250, Drehmoment 400–700 |
| `individualThrottleBodies` | – | – | false | |

**PetrolFuelSystem**
| Feld | Min | Max | Default | Hinweis |
|---|---|---|---|---|
| `mixture` | – | – | `"port-injection"` | |
| `fuel` | – | – | `"ron95"` | |
| `fullLoadLambda` | 0,72 | 1,05 | 0,88 | Leistungsoptimum 0,85–0,90; Turbo-Bauteilschutz 0,75–0,82; ab EU7/RDE λ 1 bei Volllast |
| `ignitionAdvanceOffsetDeg` | −20 | +10 | 0 | |

**ExhaustConfig** (Benzin): `manifold` Default `"tubular-short"`; `egr` Default false (Benzin-AGR selten, kühlt aber Klopfen → −2 ROZ Bedarf, −1 % Leistung);
`catalyst` Default **true** (Dreiwegekat); `particulateFilter` false (OPF ab DI/2018 möglich, +~5 kPa Gegendruck); `scr` immer false (nicht relevant).

**CoolingConfig**: `radiatorCapacityKw` 20–150, Default ≈ 0,5 × Nennleistung kW [S]; `thermostatOpenC` 80–105, Default 90; `oilCooler` Default false (true ab ~70 kW/l).

**EngineConfig**: `revLimitRpm` 4000–12000, Default 7000; `idleRpm` 600–1200, Default 800 (Rennnocke 1100).

**Validierungsregeln** [S]: `cylinders` × Layout-Kombination prüfen; `valvetrain = "ohv"` mit `valvesPerCylinder > 2` verbieten;
`carburettor` + Turbo erlaubt (Saugvergaser), aber keine Klopfregelung; `e85` + `carburettor` → Warnung (Kaltstart);
Hubraum pro Zylinder 0,15–1,0 l.

## 2. Wirkung der Parameter

Pfeile: ↑ steigt, ↓ sinkt. Alle qualitativ belegt durch Standardliteratur, Größenordnungen [S].
| Parameter | Drehmomentkurve / Leistung | BSFC | EGT | Klopfgrenze | Turboloch | Gewicht | Zuverlässigkeit |
|---|---|---|---|---|---|---|---|
| Hubraum (Bohrung, Hub) | Drehmoment ∝ Vh | große Zylinder (0,4–0,6 l) optimal | – | große Bohrung ↓ | mehr Abgas → ↓ | ↑ | – |
| Hub/Bohrung > 1 (Langhuber) | Drehmoment früh, Drehzahl begrenzt (cm) | leicht ↓ (kompakter Brennraum) | – | etwas besser | – | höher bauend | cm-Grenze früher |
| Kurzhuber | Drehzahl/Leistung oben | ↑ | – | schlechter (lange Flammwege) | – | – | Hochdrehzahl möglich |
| Pleuellänge ↑ | minimal (Seitenkraft ↓) | ↓ ~0,5 % | – | – | – | ↑ Bauhöhe | ↑ |
| Verdichtung ↑ | +~2–3 % je Punkt | ↓ ~2–3 % je Punkt | ↓ | **stark ↓** (≈ +4 ROZ Bedarf je Punkt) | Turbo: weniger Spielraum Ladedruck | – | Klopfrisiko |
| Ventiltrieb ohv → dohc | höhere Drehzahl möglich | dohc leicht ↑ Reibung | – | – | – | ohv kompakter/leichter (V8) | ohv Ventilflattern früh |
| Ventilzahl 2 → 4 | Liefergrad oben +5–8 % | ↓ (zentrale Kerze) | – | besser (zentrale Kerze) | – | +Kopf | – |
| camProfile ↑ | Peak nach oben, schmäler, unten Einbruch | Teillast ↑ | ↑ (Überschneidung) | – (mehr Restgas unten) | Turbo: Spülung hilft bei Abgasturbo-Ansprechen | – | Leerlauf unruhig, Ventilfedern stärker |
| VVT | breitere Kurve, +5–10 % im Bereich | Teillast ↓ 2–4 % (innere AGR) | – | – | Spülen hilft Ansprechen | +3 kg | – |
| Saugrohrlänge ↑ | Resonanz zu niedriger n | – | – | – | – | – | – |
| ITB | +2–4 % oben, Ansprechen schneller | Leerlauf ↑ | – | – | – | +2–4 kg | – |
| Turbo / boost ↑ | Drehmoment ∝ Saugrohrdruck | Volllast ↑ (Anfettung), Teillast Downsizing ↓ | ↑↑ | **stark ↓** (≈ +15 ROZ je bar) | größerer Lader = mehr Loch | +15–25 kg | Kolben, Pleuel, Kopfdichtung |
| inducer ↑ / A/R ↑ | Leistung oben ↑, unten ↓ | – | A/R ↑ → ↓ | A/R ↓ → Restgas ↑ → schlechter | **↑** | – | – |
| Ladeluftkühler | +5–10 % | ↓ | ↓ | **stark besser** (−0,2 ROZ/K) | Rohrvolumen +Loch leicht | +5–10 kg | ↑ |
| Kompressor | Drehmoment sofort | ↑ (Antriebsleistung) | – | ↓ | kein Loch | +10–15 kg | – |
| mixture: Vergaser → MPI → DI | +3–5 % | ↓ | – | DI ≈ 1 Verdichtungspunkt besser | – | – | – |
| fuel RON ↑ / E85 | erlaubt Zündung/Boost | E85: Masse +40 %, Energie gleich | E85 ↓ | ↑ | – | – | – |
| fullLoadLambda ↓ | max bei ~0,88, darunter ↓ | ↑↑ | ↓ (Kühlung) | besser | – | – | Bauteilschutz; < 0,75 Kerzen verrußen |
| ignitionAdvanceOffsetDeg + | ~0 (MBT) | ~0 | ↓ | **↓↓** | – | – | Klopfschäden |
| ignitionAdvanceOffsetDeg − | ↓ (quadr.) | ↑ | **↑↑** | besser | Abgasenergie ↑ → Loch ↓ (Anti-Lag-Prinzip) | – | Kat/Ventile heiß |
| manifold log → tubular-long | +3–5 % oben, Mitte Resonanz | – | – | Restgas ↓ besser | log/kurz: Turbo-Ansprechen besser | Fächer leichter als Guss? (≈ gleich) | Gusskrümmer robuster |
| catalyst / OPF | −1–3 % | – | Kat +Exothermie (+50–100 K im Kat) | – | – | +3–8 kg | Kat-Temperatur-Grenze |
| blockMaterial Alu | – | – | – | – | – | Grauguss ≈ +25–35 % Blockmasse | Grauguss ↑ bei Turbo |
| forged / billet | – | – | – | – | – | – | höhere Drehzahl/Last-Grenzen |
| radiatorCapacityKw | – | – | – | Kühlmittel heiß → Klopfen ↑ | – | +kg | Überhitzungsschutz |

## 4. Grenzen & Schäden (Schwellwerte für `limits.ts`)

Werte **[S]** aus Fachwissen/Rennsport-Praxis, außer markiert. Jeweils Warnung (warning) → kritisch → fataler Schaden.

**Mittlere Kolbengeschwindigkeit `meanPistonSpeedMs`** (`piston-speed`)
| Ausstattung | warning | critical | fatal (Pleuel/Kolben) |
|---|---|---|---|
| cast crank + cast pistons + cast-steel rods | 19 | 21 | 23 |
| forged crank / forged pistons / forged-steel rods | 22 | 24,5 | 26,5 |
| billet + forged + titanium | 24 | 26 | 28 |
Real: Serie bis ~21 m/s, Hochdrehzahl-Serie (S54, K20A, 458) 24–24,3 m/s (Abschnitt 7, berechnet), F1-V8 (2006–13) ~25–26 m/s.
Zusatz `conrod-stress`: Massenkraft ∝ m_osz · r · ω² · (1 + r/l); bei Turbo zusätzlich Gasdruck. Schwelle über `n²·S·(1+λs)` relativ zu Referenz, Faktor 1,0 / 1,15 / 1,3 je Material.

**Ventilflattern (`valve-float`)** – Drehzahl, ab der die Feder dem Nocken nicht mehr folgt. Kriterium über
Ventilbeschleunigung ∝ n² und bewegte Masse; vereinfachte Spiellogik:
```ts
// Grenze n_float [1/min], abhängig vom Ventiltrieb und der Nockenschärfe
const base = { ohv: 6600, sohc: 7400, dohc: 8200 }[valvetrain];
const nFloat = base
  * (valvesPerCylinder >= 4 ? 1.08 : 1.0)              // leichtere Einzelventile
  * (1 + 0.10 * camProfile)                             // Rennnocke ⇒ steifere Federn angenommen
  * Math.sqrt(86 / boreMm);                             // größere Ventile ⇒ schwerer
// Warnung ab 0,95·nFloat, Schaden (Ventil trifft Kolben, fatal bei Interferenzmotor) ab 1,08·nFloat für > 0,5 s
```
Plausibel: LS3 (OHV 2V, cam 0,35, B 103) → 6600·1,035·0,914 ≈ 6240 → Warnung ab ~5900, Flattern knapp unter dem Begrenzer 6600 (real: Serienfedern am Limit, Tuner tauschen sie).
K20A → ~9600, S54 → ~9600, 458 → ~9500 (pneumatische Federn in F1 nicht modelliert).
Ventilflattern äußert sich zuerst als Leistungsabfall (Liefergrad ×0,8 ab nFloat).

**Klopfen (`knock`)**: `EngineState.knock` > 0,2 = warning, > 0,5 = critical. Schaden akkumulieren:
`wear += 0.02 * knock² * dt` (bei knock 1 → 50 s bis zerstört); bei `knock > 0.8` und `bmep > 15 bar` für > 3 s → fatal
(„Kolben durchgebrannt / Stegbruch“). Ohne Klopfregelung (Vergaser) sofort spürbar.

**Spitzendruck (`peak-pressure`)**: Benziner Serie 70–120 bar, Turbo-DI modern bis 130–140 bar.
Grenze: cast pistons 110 bar, forged 140 bar, Grauguss-Block +10 %; Kopfdichtung: > Grenze·1,15 → fatal.

**Abgastemperatur (`egt-high`)**: Sensor vor Turbine/Krümmer.
| | warning | critical | Schaden |
|---|---|---|---|
| Turbine (Serie, Ni-Resist) | 950 °C | 1000 °C | > 1050 °C für 5 s → Turbinenrad/Gehäuseriss |
| Turbine (Mar-M/Inconel, Porsche/Rennsport) | 1000 | 1050 | > 1100 |
| Sauger-Krümmer / Auslassventil | 950 | 1020 | > 1050 → Ventilschaden |
| Katalysator (Monolith) | 900 °C | 950 °C | > 1000 °C → Alterung (wear), > 1100 °C → Schmelzen/Sintern (Kat zerstört, Gegendruck ↑) |
Kat-Temperatur ≈ EGT − 50 K + Exothermie (+100 K bei λ 1 und hohem Schadstoffumsatz; Zündaussetzer/Spätzündung +200 K). Anspringtemperatur (light-off) ~250–300 °C.

**Überhitzung**: Kühlmittel (`overheat-coolant`) warning 110 °C, critical 120 °C (Druckkappe ~1,4 bar abs → Sieden ~125 °C), > 130 °C für 10 s → Kopfdichtung/Zylinderkopfverzug (Alu-Kopf: fatal).
Öl (`overheat-oil`) warning 130 °C, critical 145 °C, > 155 °C → Lagerschaden (wear stark). Öldruck (`low-oil-pressure`): < 0,5 bar im Leerlauf bzw. < 1,0 bar über 3000 1/min = critical; Faustregel Soll ≈ 1 bar je 1000 1/min bis ~4,5 bar.

**Turbo**: `turbo-overspeed` bei > 95 % der max. Wellendrehzahl (kleiner Lader ~250 000, großer ~150 000 1/min; ∝ 1/inducer);
`overboost` bei > boostTarget + 0,3 bar (Steuergerät schaltet Zündung/Kraftstoff ab).

**Drehzahl**: `over-rev` > revLimit (Begrenzer schneidet; mechanisch nur durch Verschalten), fatal falls > `safeMaxRpm`·1,1 (Ventile oder Pleuel).

## 5. Gemeinsame Bausteine mit Diesel vs. benzinspezifisch

**Gemeinsam (einmal implementieren, `airpath.ts`, `friction.ts`, `turbo.ts`, `thermal.ts`, `dyno.ts`):**
- Geometrie, Hubraum, Kolbengeschwindigkeit, Massenkräfte, Zündabstände (`EngineSummary`).
- Liefergrad-Grundmodell (Nocke, Ventile, Saugrohrresonanz) – Diesel: kleinere camProfile-Werte, keine ITB.
- Luftmasse aus Saugrohrdruck, Ladeluftkühler, Turbo-/Kompressor-Modell (Diesel meist VTG, Benzin Wastegate).
- Reibung Chen-Flynn (Diesel: höheres p_max → mehr Reibung automatisch).
- Pumpverluste PMEP, Drehmoment/Leistung/BSFC aus Mitteldrücken, Dyno, Trägheit, Thermik, Öl.
- Grenzen: Kolbengeschwindigkeit, Ventilflattern, Spitzendruck, Überhitzung, EGT, Turbodrehzahl.

**Benzinspezifisch (`combustion-petrol.ts`):**
- Drosselklappe als Laststeuerung (Qualitäts- vs. Quantitätsregelung: Benzin regelt die Luftmenge, Diesel die Kraftstoffmenge bei offener Luft).
- λ-Strategie (1,0 / Anfettung) statt Rauchgrenze; `PetrolFuel`-Tabelle inkl. E85.
- Otto-Vergleichsprozess (Gleichraum) statt Seiliger/gemischt.
- Zündwinkel-Verlust und **Klopfmodell + Klopfregelung** (Diesel: Zündverzug/Nageln stattdessen).
- Schubabschaltung, Schubknallen, Kat-Temperatur.
- Kaltstartanfettung (Diesel: Glühen).
- `EngineState.knock` belegt, `smoke` = 0.

## 8. Quellen

Belegt per Recherche (2026-10-28), Inhalte in eigenen Worten:
1. x-engineer.org: „Mechanical efficiency and friction mean effective pressure (FMEP)“ – Chen-Flynn-Formel und Beispielkoeffizienten. https://x-engineer.org/mechanical-efficiency-friction-mean-effective-pressure-fmep/
2. Wikipedia: „Honda K engine“ – K20A/K20C1 Daten. https://en.wikipedia.org/wiki/Honda_K_engine
3. australiancar.reviews: „VW Mk7 Golf GTI CHHA/CHHB EA888 Gen 3“. https://australiancar.reviews/vw-mk-7-golf-gti-chha-chhb-ea888-gen-3/
4. BMWBlog: „BMW S54 engine – everything you need to know“ (2022). https://www.bmwblog.com/2022/10/10/bmw-s54-engine-everything-you-need-to-know/
5. GM Authority: „LS3 engine“. https://gmauthority.com/blog/gm/gm-engines/ls3/
6. Diariomotor: „Ferrari 458 Italia, los datos técnicos al completo“ (2009). https://www.diariomotor.com/2009/09/17/ferrari-458-italia-los-datos-tecnicos-al-completo
7. Wikipedia: „Firing order“. https://en.wikipedia.org/wiki/Firing_order
8. SlashGear: „How Subaru's Unequal Length Headers Create That Distinctive Rumble Sound“. https://www.slashgear.com/1970710/subaru-unequal-length-headers-rumble-sound

Fachliteratur (aus Fachwissen, nicht online geprüft):
- J. B. Heywood, *Internal Combustion Engine Fundamentals*, 2. Aufl. 2018 – Liefergrad, Drosselfluss (App. C), PMEP, λ-Einfluss, Klopfen, Draper-Moden.
- R. van Basshuysen, F. Schäfer (Hrsg.), *Handbuch Verbrennungsmotor* – Kennwerte Serienmotoren, Grenzen.
- R. Pischinger et al., *Thermodynamik der Verbrennungskraftmaschine* – Gütegrad, Vergleichsprozesse.
- Chen, S. K.; Flynn, P. F.: „Development of a Single Cylinder Compression Ignition Research Engine“, SAE 650733 (Ursprung der Reibungskorrelation).

Nicht belegt / bewusst geschätzt: alle Klopfmodell-Koeffizienten, VE-Kurvenkonstanten, Ventilflatter-Basisdrehzahlen,
Akustik-Mischanteile, Kat-/EGT-Schwellen (gängige Praxiswerte), Pleuellängen der Referenzmotoren, Kraftstoffdichten ron98/ron102.
