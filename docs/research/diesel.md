# Recherche: Dieselmotor (v0.1)

Stand: 2026-10-28 · Team Recherche · Bezug: `src/core/types.ts`

Legende: **[B]** = belegt (Quelle am Ende), **[S]** = Schätzung / Ingenieurs-Faustwert, zur Kalibrierung gegen die Referenzmotoren gedacht.

## Inhalt
1. Parameter (Min/Max/Default)
2. Wirkungen der Parameter
3. Echtzeit-Mittelwertmodell
4. Grenzen und Schäden
5. Referenzmotoren
6. Quellen
7. Offene Punkte an Architektur

(Abschnitte stehen nach Priorität sortiert in der Datei: 3, 5, 1, 4, 2, 7, 6.)

## 3. Echtzeit-Mittelwertmodell

Ziel: Mittelwertmodell (Mean Value Engine Model), ein Rechenschritt pro Tick (z. B. 1 ms … 16 ms), keine Kurbelwinkelauflösung. Alle Größen über ein Arbeitsspiel (720 °KW) gemittelt. Reihenfolge pro Tick: 3.1 Luftpfad → 3.2 Kraftstoff → 3.3 Wirkungsgrad → 3.4 Reibung/Ladungswechsel → 3.5 Drehmoment → 3.6 Spitzendruck → 3.7 Abgastemperatur → 3.8 Rauch → 3.9 Turbo → 3.10 Thermik → 3.11 Kurbeltrieb.

### 3.0 Konstanten und abgeleitete Größen

```ts
// Kraftstoffe (Diesel = Vorgabe Projekt/EN 590-typisch; HVO/FAME = Literatur-Mittelwerte) [B/S]
const FUEL = {
  diesel:    { lhvJkg: 42.6e6, densityKgL: 0.832, afrSt: 14.5, sootFactor: 1.00, noxFactor: 1.00 },
  hvo:       { lhvJkg: 44.0e6, densityKgL: 0.780, afrSt: 15.0, sootFactor: 0.75, noxFactor: 0.95 }, // paraffinisch, Cetanzahl > 70
  biodiesel: { lhvJkg: 37.2e6, densityKgL: 0.880, afrSt: 12.5, sootFactor: 0.55, noxFactor: 1.10 }, // FAME, ~11 % O2 im Molekül
};
const R_AIR = 287;        // J/(kg K)
const CP_AIR = 1005;      // J/(kg K)
const KAPPA_AIR = 1.4;
const CP_EXH = 1150;      // J/(kg K), Abgas 500–800 °C  [S, Lehrbuchwert]
const KAPPA_EXH = 1.33;

const Vh = Math.PI / 4 * (boreMm / 1000) ** 2 * (strokeMm / 1000) * cylinders; // m³, Gesamthubraum
const cm = 2 * (strokeMm / 1000) * rpm / 60;   // mittlere Kolbengeschwindigkeit m/s
const cyclesPerS = rpm / 120;                  // Arbeitsspiele pro s (4-Takt)
```

### 3.1 Luftpfad: Saugrohrdruck, -temperatur, Liefergrad

**Ladedruck und Temperatur nach Verdichter** (isentrope Verdichtung mit Wirkungsgrad) [B, Standard-Thermodynamik]:

```ts
const p1 = ambientKpa * 1e3 - dpAirFilter;               // dpAirFilter ≈ 2e3 Pa·(mDotAir/mDotAirRated)² [S]
const PR = (p1 + boostBar * 1e5 + dpIntercooler) / p1;    // Verdichter-Druckverhältnis
const etaC = 0.70;                                        // Verdichter-Wirkungsgrad, real 0,60 … 0,78 je Kennfeldpunkt [S]
const T1 = ambientC + 273.15;
const T2 = T1 * (1 + (PR ** ((KAPPA_AIR - 1) / KAPPA_AIR) - 1) / etaC);
// Ladeluftkühler (Wirkungsgrad-Methode): T3 = T2 - eps * (T2 - Tsink)
const epsIC = { "none": 0, "air-to-air": 0.75, "air-to-water": 0.85 }[intercooler]; // [S] typ. 0,6 … 0,9
const Tsink = intercooler === "air-to-water" ? T1 + 15 : T1;                        // NT-Kreis ≈ Umgebung + 15 K [S]
const T_int = T2 - epsIC * (T2 - Tsink);
const dpIntercooler = intercooler === "none" ? 0 : 8e3 * (mDotAir / mDotAirRated) ** 2; // 0,05 … 0,15 bar bei Nennlast [S]
const p_int = p1 * PR - dpIntercooler;                    // Saugrohr-Absolutdruck, Pa  → state.manifoldAbsKpa
const rho_int = p_int / (R_AIR * T_int);                  // kg/m³
```

Saugdiesel: `PR = 1`, `p_int = p1 - dpAirFilter` (keine Drosselklappe!). Beim Diesel ist `p_int` also auch im Leerlauf ≈ Umgebungsdruck, der Unterschied zum Benziner ist zentral für Sound und Pumpverluste.

**Liefergrad** (volumetric efficiency) als Glockenkurve um eine Resonanzdrehzahl [S, kalibriert auf typische Kurvenformen]:

```ts
const veMaxByValves = { 2: 0.85, 3: 0.88, 4: 0.92, 5: 0.93 }; // Diesel-Drallkanäle kosten ~2–4 % ggü. Benziner [S]
// Resonanzdrehzahl aus Saugrohrlänge (vereinfachte λ/4-Abstimmung, Faustformel):
let nPeak = 1.2e6 / intakeRunnerLengthMm;                      // 400 mm → 3000 rpm, 250 mm → 4800 rpm [S]
nPeak *= 0.85 + 0.4 * camProfile;                              // schärfere Nocke verschiebt nach oben
let width = 0.25 * (1 - 0.5 * camProfile);                     // Krümmung der Kurve
if (variableTiming !== "none") width *= 0.7;                   // VVT verbreitert das Plateau
const x = (rpm - nPeak) / nPeak;
let ve = veMaxByValves[valvesPerCylinder] * (1 + 0.04 * camProfile) * (1 - width * x * x);
// Abgasgegendruck-Korrektur (Restgas): ve *= 1 - 0.03 * Math.max(0, p_exh / p_int - 1)
ve = clamp(ve, 0.55, 1.0);
```

**Luftmasse pro Arbeitsspiel und Massenstrom:**

```ts
const mAirCycle = ve * rho_int * Vh;           // kg pro Arbeitsspiel (alle Zylinder)
const mDotAir = mAirCycle * cyclesPerS;        // kg/s → state.airMassFlowKgS
```

AGR (wenn `egr = true`): nur Teillast. AGR-Rate `xEgr = 0.35 * (1 - load)` bei `rpm < 3000`, sonst 0 [S]. Verdrängt Frischluft: `mAirCycle *= 1 - xEgr`; senkt NOx um bis zu ~50 %, erhöht Ruß leicht und verschlechtert η_i um ~1–2 % [S].

### 3.2 Kraftstoffmasse (qualitative Laststeuerung)

Diesel hat keine Drossel: Die Last wird **nur über die eingespritzte Menge** gesteuert. Luftmenge bleibt (nahezu) voll, λ steigt bei Teillast auf 3 … 8 (Leerlauf bis ~10). Folge: kaum Pumpverluste, guter Teillastwirkungsgrad.

```ts
const f = FUEL[fuel];
// a) Fahrerwunsch: Pedal skaliert die maximal zulässige Menge (vereinfachtes Mengenkennfeld)
// b) Rauchbegrenzung (Ladedruckabhängige Volllastbegrenzung, "LDA")
const mFuelSmokeMax = mAirCycle / (f.afrSt * smokeLimitLambda);
// c) Einspritzsystem-Kapazität (Düsendurchfluss ∝ sqrt(Δp), Einspritzfenster ≈ 35 °KW → Zeit ∝ 1/rpm) [S]
const injWindowS = 35 / 360 * 60 / rpm;
const mFuelInjMax = kInj * Math.sqrt(injectionPressureBar) * injWindowS * cylinders;
//   kInj so wählen, dass bei Nenndrehzahl ~10 % Reserve über mFuelSmokeMax bleibt (je Motor kalibrieren).
// d) Abregelung (Diesel-Regler: kein harter Schnitt, sondern Mengenrampe)
const governor = clamp((revLimitRpm - rpm) / 250, 0, 1);    // Abregelbereich ≈ 200–300 rpm [B, Reglerprinzip]
const mFuelFullLoad = Math.min(mFuelSmokeMax, mFuelInjMax, mFuelTorqueLimit) * governor;
let mFuelCycle = pedal * mFuelFullLoad;
// e) Leerlaufregler (PI), wirkt additiv bei pedal ≈ 0, siehe 3.11
mFuelCycle = Math.max(mFuelCycle, mFuelIdle);
if (!ignition) mFuelCycle = 0;                              // Diesel stellt über Mengenabschaltung ab

const lambda = mAirCycle / (mFuelCycle * f.afrSt);          // → state.lambda (Infinity bei 0 → auf 99 klemmen)
const fuelMassFlowGS = mFuelCycle * cyclesPerS * 1e3;       // → state.fuelMassFlowGS
const fuelFlowLh = fuelMassFlowGS * 3.6 / f.densityKgL;     // g/s → kg/h → l/h
```

`mFuelTorqueLimit` = optionaler Bauteilschutz (Spitzendruck, siehe 3.6): Menge so begrenzen, dass `peakPressureBar ≤ pMaxDesign`. Reale Steuergeräte tun genau das; ohne diese Begrenzung kann der Spieler den Motor per Ladedruck zerstören (gewollt, siehe Kap. 4).

### 3.3 Indizierter Wirkungsgrad: Seiliger-Prozess × Gütegrad

Seiliger (gemischter) Vergleichsprozess, ideal [B, Lehrbuch: Pischinger/Merker, Heywood]:

```ts
// eps = Verdichtung, kappa = 1.35 (realistischer Mittelwert für Ladung+Abgas statt 1.4) [S]
// pi  = Drucksteigerungsverhältnis (Gleichraum-Anteil), phi = Volldruckverhältnis/Einspritzverhältnis (Gleichdruck-Anteil)
function etaSeiliger(eps: number, pi: number, phi: number, kappa = 1.35): number {
  return 1 - (1 / eps ** (kappa - 1)) * (pi * phi ** kappa - 1) / ((pi - 1) + kappa * pi * (phi - 1));
}
```

Laststeuerung von `pi` und `phi` (mehr Kraftstoff = längere Gleichdruckphase = schlechterer idealer Wirkungsgrad) [S]:

```ts
const sys = {
  //                       piK   phiK  guete   pInjRef
  "common-rail":            [0.70, 0.90, 0.80,  1800],
  "unit-injector":          [0.80, 0.85, 0.78,  2050],
  "indirect-swirl-chamber": [0.40, 1.10, 0.68,   350],
  "indirect-prechamber":    [0.35, 1.20, 0.65,   300],
}[injection];
const pi  = 1 + sys.piK  / lambda;             // λ = 1,3 → CR: 1,54
const phi = 1 + sys.phiK / lambda;             // λ = 1,3 → CR: 1,69
let gueteGrad = sys.guete;
// Einspritzdruck: feinere Zerstäubung → schnellere Verbrennung (nur DI) [S]
if (injection === "common-rail" || injection === "unit-injector")
  gueteGrad *= 1 + 0.03 * Math.log(injectionPressureBar / sys.pInjRef);
// Spritzbeginn-Offset vom Optimum: quadratischer Verlust [S, Form typischer Δη-SB-Kurven]
gueteGrad *= 1 - 0.0012 * injectionTimingOffsetDeg ** 2;   // −5 °KW → −3 %, −10 °KW → −12 %
// Kleine Brennräume verlieren mehr Wärme (Oberfläche/Volumen) [S]
gueteGrad *= 1 - 0.04 * Math.max(0, (80 - boreMm) / 20);
// Sehr mageres Gemisch (Teillast) verbrennt langsamer/kälter: leichter Abfall
gueteGrad *= 1 - 0.02 * Math.max(0, lambda - 3);           // auf max. −8 % klemmen

const etaI = etaSeiliger(compressionRatio, pi, phi) * gueteGrad;   // indizierter Wirkungsgrad
```

Plausibilität [S, gegen Literaturbereiche geprüft]:
- CR, ε = 16, λ = 1,3: η_ideal ≈ 0,59, × 0,80 → **η_i ≈ 0,47** (Literatur moderner Pkw-DI: 0,44 … 0,48).
- Wirbelkammer, ε = 22, λ = 1,4: η_ideal ≈ 0,62, × 0,68 → η_i ≈ 0,42; nach Reibung η_e ≈ 0,33 → BSFC ≈ 255 g/kWh (Literatur IDI: 240 … 270 g/kWh). Die Kammermotoren verlieren durch Überströmverluste und größere Wärmeübergangsflächen.

Indizierter Mitteldruck:

```ts
const imep = etaI * mFuelCycle * f.lhvJkg / Vh;     // Pa → /1e5 → state.imepBar
```

### 3.4 Reibung (Chen-Flynn) und Ladungswechsel

Chen-Flynn-Ansatz [B, Chen & Flynn, SAE 650733; Form wie in GT-Power]:

```ts
// fmep in bar, pMax in bar, cm in m/s
const fmep = A + B * peakPressureBar + C * cm + D * cm * cm;
```

Koeffizienten (Pkw-Diesel, betriebswarm) [S, aus Literaturbereichen; x-engineer-Beispiel nutzt A=0,3, B=0,006, C=0,05 (mit Speed-Factor ω·S/2), D=85e-5]:

| Koeffizient | Pkw-Diesel (≤ 90 mm Bohrung) | Nfz/Industrie (> 100 mm) | Einheit |
|---|---|---|---|
| A | 0,40 | 0,50 | bar (Nebenaggregate, Hochdruckpumpe, Ölpumpe) |
| B | 0,005 | 0,004 | – |
| C | 0,09 | 0,08 | bar·s/m |
| D | 0,0009 | 0,0012 | bar·s²/m² |

Check: N57 bei 4000 rpm (cm = 12 m/s), pMax 170 bar: 0,40 + 0,85 + 1,08 + 0,13 = 2,46 bar. Bei 1500 rpm, Teillast pMax 80 bar: ≈ 1,2 bar. Realistisch (Literatur 1 … 3 bar).

Korrekturen [S]:
- Kalte Öltemperatur: `fmep *= 1 + 1.5 * Math.max(0, (80 - oilC) / 100)` (bei 20 °C ≈ ×1,9). Wichtig für Start und Warmlauf.
- Ventiltrieb: ohv ×1,03, sohc ×1,00, dohc ×1,02; 2V ×0,97, 4V ×1,0.
- Kolben `steel` ×1,03 (schwerer, aber engere Toleranz), Kurbeltrieb sonst neutral.
- Einspritzung: Hochdruckpumpe ist bereits in A enthalten; `unit-injector` A += 0,05 (Pumpe-Düse-Nocken), `indirect-*` A −= 0,05.

Ladungswechsel-Mitteldruck (pmep, als Verlust positiv) [S]:

```ts
// Diesel ohne Drossel: Pumpverlust nur durch Strömung und Abgasgegendruck
const pmep_bar = Math.max(0, (p_exh - p_int) / 1e5) + 0.10 * (rpm / 4000) ** 2;
// p_exh (vor Turbine): Saugmotor ≈ p1 + 0.1e5·(rpm/4000)²; Turbo: aus 3.9 oder vereinfacht
// p_exh ≈ p_int · (1.05 + 0.20·load) (VTG) bzw. (1.10 + 0.25·load) (Wastegate)
```

### 3.5 Drehmoment, Leistung, BSFC

```ts
const bmep_bar = imep / 1e5 - fmep - pmep_bar;          // state.bmepBar, state.fmepBar = fmep + pmep_bar
const torqueNm = bmep_bar * 1e5 * Vh / (4 * Math.PI);    // 4-Takt [B]
const powerKw = torqueNm * rpm * Math.PI / 30 / 1e3;
const bsfcGkWh = powerKw > 0.5 ? fuelMassFlowGS * 3600 / powerKw : NaN;
const efficiency = powerKw > 0.5 ? powerKw * 1e3 / (fuelMassFlowGS / 1e3 * f.lhvJkg) : 0;
const load = clamp(torqueNm / fullLoadTorqueAt(rpm), 0, 1); // fullLoadTorqueAt = gleiche Rechnung mit pedal = 1 (Cache pro 100 rpm)
```

Kalibrier-Check N57D30O1 (560 Nm, 2,993 l): bmep = 23,5 bar, mit fmep+pmep ≈ 1,8 bar → imep ≈ 25,3 bar → bei η_i 0,46 ≈ 64 mg/Hub; bei λ 1,3 und ve 0,92 braucht das ρ_int ≈ 2,64 kg/m³ ≈ 2,43 bar abs bei 47 °C, also ≈ 1,4 bar Überdruck. Passt zur Größenordnung realer Pkw-Diesel (1,3 … 1,8 bar Überdruck).

Faustwert: `BSFC [g/kWh] = 3600 / (η_e · Hu[MJ/kg])` → η_e = 0,42 ⇒ 201 g/kWh.

### 3.6 Spitzendruck

Kompressionsenddruck × Drucksteigerung durch Verbrennung [S, physikalisch begründet]:

```ts
const nPoly = 1.33;                                         // Polytropenexponent Verdichtung, warm [S]
const pComp = (p_int / 1e5) * compressionRatio ** nPoly;    // bar
let pMax = pComp * pi;                                      // pi aus 3.3
pMax *= 1 + 0.03 * injectionTimingOffsetDeg;               // +3 %/°KW Frühverstellung, − bei Spätverstellung [S]
const peakPressureBar = Math.max(pComp, pMax);
```

Check: p_int = 2,5 bar abs, ε = 16,5: p_comp = 2,5 · 16,5^1,33 ≈ 104 bar; π ≈ 1,54 (λ 1,3) … 1,61 (λ 1,15) → **160 … 168 bar** (Literatur moderner Pkw-Diesel: 160 … 200 bar, neueste bis 220 bar). Leerlauf (p_int = 1 bar, λ ≈ 8): ≈ 45 bar.

### 3.7 Abgastemperatur (Energiebilanz)

Energie, die nicht als indizierte Arbeit und nicht als Wandwärme den Brennraum verlässt, heizt das Abgas [B, Energiebilanz; Anteile S]:

```ts
const Qfuel = mFuelCycle * f.lhvJkg;                        // J pro Arbeitsspiel
const xWall = 0.18 + 0.10 * Math.min(1, (lambda - 1.2) / 4); // Wandwärmeanteil 0,18 (Volllast) … 0,28 (Teillast) [S]
// Spätverstellung verschiebt Energie ins Abgas (η_i sinkt bereits über gueteGrad → automatisch höhere EGT)
const dT = Qfuel * (1 - etaI - xWall) / ((mAirCycle + mFuelCycle) * CP_EXH);
const egtK = T_int + dT;
const egtC = egtK - 273.15;                                 // vor Turbine → state.egtC
```

Check: CR, λ = 1,3, η_i 0,46, T_int 320 K → ΔT ≈ 670 K → **≈ 720 °C** (Literatur Volllast vor Turbine 650 … 800 °C; bei Bedarf xWall-Volllast auf 0,20 anheben). Teillast λ = 3 → ≈ 290 °C, Leerlauf ≈ 120 … 200 °C. Hinter Turbine: `T4 = T3 · (1 − ηT·(1 − (1/PR_T)^((κ−1)/κ)))`, typ. 100 … 200 K kälter.

Dynamik: Abgaskrümmer-Thermik als Tiefpass, `τ ≈ 1.5 s` (Guss-Krümmer `cast-log` 2,5 s, Rohrkrümmer 1,0 s) [S].

### 3.8 Rauchtrübung (smoke 0 … 1)

Ruß steigt stark, wenn λ unter ~1,3 fällt; hoher Einspritzdruck verschiebt die Grenze zu kleineren λ [B qualitativ, Zahlen S]. Logistisches Modell, das den UI-Wert 0 … 1 (Trübung, ähnlich Opazimeter-Anzeige k-Wert/Trübung %) liefert:

```ts
let lambda50 = 0.95 + 0.30 * Math.sqrt(500 / injectionPressureBar); // λ bei 50 % Trübung
// CR 1800 bar → 1,11 · PD 2050 bar → 1,10 · Kammer 350 bar → 1,31
lambda50 += 0.004 * Math.max(0, -injectionTimingOffsetDeg);          // spät → mehr Ruß
lambda50 += egrActive ? 0.03 : 0;
let smoke = 1 / (1 + Math.exp((lambda - lambda50) / 0.06));
smoke *= f.sootFactor;
if (coolantC < 40) smoke = Math.max(smoke, 0.15 * (1 - coolantC / 40)); // Kaltstartrauch (weiß/blau)
if (particulateFilter) smoke *= 0.02;                                 // DPF: > 95 % Filtereffizienz [B]
```

Check: CR bei λ = 1,25 → ~0,09 (leichter Schleier), λ = 1,15 → 0,33, λ = 1,05 → 0,74 (schwarze Wolke). Turbo-Lag sorgt automatisch für "Rußwolke beim Gasstoß", wenn der Ladedruck nachhängt und die Rauchbegrenzung zu hoch gesetzt ist.

NOx-Index (optional, nicht im State): `nox ∝ exp(0.0045·(T_flame_adiab − 2200))`, praktisch: steigt mit Frühverstellung (+~5 %/°KW), sinkt mit AGR und Spätverstellung; SCR −90 % [S].

### 3.9 Turbolader

**Vollmodell (Wellenbilanz)** [B, Standard Turbolader-Thermodynamik]:

```ts
const PC = mDotAir * CP_AIR * T1 * (PR ** 0.2857 - 1) / etaC;                    // Verdichterleistung W
const PT = mDotExh * CP_EXH * egtK * (1 - (1 / PRT) ** ((KAPPA_EXH - 1) / KAPPA_EXH)) * etaT; // etaT ≈ 0,65–0,75 [S]
// J·ω·dω/dt = PT − PC − Plager  (Plager ≈ 2 % von PT)
```

Mit Regelung (VTG/Wastegate) wird `PRT` bzw. die wirksame Turbinenleistung so eingestellt, dass `boostBar → boostTargetBar`. Die Regelung kann aber nur **so viel** liefern, wie Abgasenthalpie vorhanden ist → Ladedruck baut erst ab ~1500 rpm (VTG ~1200 rpm) voll auf.

**Echtzeit-Vereinfachung (empfohlen für v0.1)** [S]:

```ts
// 1) Stationär verfügbarer Ladedruck aus Abgasleistung (vereinfachte Bilanz mit etaTC = etaC*etaT ≈ 0,5):
//    PR_avail so lösen, dass PC(PR) = etaTurbineMax * Pexh_available
//    Näherung: boostAvail = boostMaxAtRated * clamp((mDotExh*egtK)/(mDotExh*egtK)_rated, 0, 1)^1.3
// 2) Zielwert = min(boostTargetBar, boostAvail)
// 3) Ladedruck folgt mit Zeitkonstante (Wellenträgheit):
const tauTurbo = 0.6 * (compressorInducerMm / 45) ** 2.5 * Math.sqrt(turbineAR / 0.6) * (variableGeometry ? 0.6 : 1.0); // s
boostBar += (boostSet - boostBar) * (1 - Math.exp(-dt / tauTurbo));
// Lag verschärft bei kleiner Abgasenergie: tauEff = tauTurbo / clamp(Pexh/Pexh_rated, 0.15, 1)
```

Trägheitsmoment Läufer: `J ≈ 2.0e-5 · (compressorInducerMm/45)^5 kg·m²` [S; Masse ∝ D³, Radius² ∝ D²].

**Turbodrehzahl aus Druckverhältnis** (Euler-Arbeit mit Arbeitszahl μ ≈ 0,7) [B Form, S Werte]:

```ts
const D2 = compressorInducerMm / 0.70 / 1000;               // Austrittsdurchmesser ≈ Inducer / 0,7, m
const u2 = Math.sqrt((PR ** 0.2857 - 1) * CP_AIR * T1 / (0.7 * etaC)); // Umfangsgeschwindigkeit m/s
const turboRpm = u2 / (Math.PI * D2) * 60;
// Bsp.: PR 2,5, Inducer 45 mm → u2 ≈ 424 m/s → ≈ 127 000 rpm (realistisch für Pkw-Lader)
```

**Größe vs. Luftbedarf:** Stopfgrenze `mDotChoke ≈ 140 kg/(s·m²) · (π/4)·D_ind²` (z. B. 38 mm → 0,16 kg/s ≈ GT1749V-Klasse) [S]. Ist `mDotAir > 0,95·mDotChoke`, fällt etaC rapide (→ T2 steigt, Turbo dreht über) – so wird ein zu kleiner Lader spürbar. Pumpgrenze: bei `PR > 1,8` und `mDotAir < 0,3·mDotChoke` → Warnung `overboost`/Pumpen [S].

`twin-turbo-sequential`: kleiner Lader (τ × 0,5) bis ~2500 rpm, dann großer zugeschaltet (N57 Tx). `e-turbo`: τ × 0,25, Hilfsleistung bis 5 kW. Kompressoren (`supercharger-*`) sind bei Dieseln unüblich; Roots: PR ∝ rpm, Antriebsleistung als zusätzlicher fmep = PC/(Vh·cyclesPerS).

### 3.10 Thermik

Wärmestrom ins Kühlmittel [S, Literatur: 20 … 30 % der Kraftstoffenergie bei Volllast, Teillast relativ mehr]:

```ts
const Pfuel = fuelMassFlowGS / 1e3 * f.lhvJkg;               // W
const Pfric = fmep * 1e5 * Vh * cyclesPerS;                  // W, Reibleistung
const QtoCoolant = xWall * Pfuel + 0.5 * Pfric;              // W
const QtoOil = 0.5 * Pfric + 0.03 * Pfuel * load;            // W, inkl. Kolbenkühlung (Spritzdüsen) [S]
```

Wärmekapazitäten [S]:

```ts
const Vl = Vh * 1000;                                        // Liter
const engineMass = massKg;                                   // aus EngineSummary
const cMetal = blockMaterial === "aluminium" ? 900 : 460;    // J/(kg K)
const C_cool = (5 + 1.5 * Vl) * 1.04 * 3500 + 0.4 * engineMass * cMetal; // Kühlmittel 50 % Glykol (cp ≈ 3,5 kJ/kgK) + gekoppelte Metallmasse
const C_oil  = (3 + 1.0 * Vl) * 0.85 * 2000 + 0.1 * engineMass * cMetal;  // Öl cp ≈ 2,0 kJ/kgK
```

Thermostat und Kühler:

```ts
const open = clamp((coolantC - thermostatOpenC) / 12, 0.02, 1);  // voll offen ≈ +12 K, Leckstrom 2 % [S]
const fan = coolantC > 95 ? 1 : 0.4;                             // Prüfstand: kein Fahrtwind; Lüfter ab 95 °C [S]
const Qrad = radiatorCapacityKw * 1e3 * open * fan * (coolantC - ambientC) / (90 - 25);
const UAoil = oilCooler ? 150 : 40;                              // W/K Öl→Kühlmittel (Wärmetauscher) bzw. Wanne→Luft [S]
const QoilToCool = UAoil * (oilC - coolantC);
coolantC += (QtoCoolant + QoilToCool - Qrad) / C_cool * dt;
oilC     += (QtoOil - QoilToCool - 10 * (oilC - ambientC)) / C_oil * dt;
```

Öldruck [S]: `oilPressureBar = clamp(0.0015 * rpm * (1 + (90 - oilC) / 80), 0, 5.0)` (Überdruckventil 5 bar; heiß im Leerlauf ≈ 1,2 bar bei 800 rpm). Unter 0,5 bar bei > 1500 rpm → `low-oil-pressure`.

### 3.11 Kurbeltrieb, Starter, Leerlauf

Trägheitsmoment Kurbeltrieb + Schwungrad (Zweimassenschwungrad primärseitig) [S, Größenordnung aus Fahrzeugdaten 0,15 … 0,4 kg·m² Pkw]:

```ts
let J = 0.10 + 0.07 * Vl;              // kg·m²: 1,9 l → 0,23 · 3,0 l → 0,31
if (boreMm > 100) J *= 1.8;            // Nfz/Industrie: schwere Kurbelwelle, Schwungrad → 5,9 l ≈ 0,92
if (crankshaft === "billet") J *= 0.92; if (crankshaft === "forged") J *= 0.97;
// Prüfstandsbremse addiert J_dyno ≈ 0,1 kg·m² (Wirbelstrombremse) – optional
```

Bewegungsgleichung: `J · dω/dt = torqueNm − T_brake − T_starterLoss`; `torqueNm` enthält bereits Reibung (bmep). Bei stehendem Motor: Haftreibung `fmep(cm=0)` als Losbrechmoment.

Starter [S, Pkw-Diesel 1,8 … 2,8 kW, Nfz 4 … 7 kW; Schleppdrehzahl 150 … 250 rpm]:

```ts
const T0 = 80 + 60 * Vl;                        // Nm an der Kurbelwelle bei n = 0 (inkl. Ritzelübersetzung ~12:1)
const T_starter = starter ? T0 * Math.max(0, 1 - rpm / 400) : 0;
// Kompressionsverluste beim Schleppen: zusätzlich ~(0,3 · pComp/40) bar pmep, damit hohe Verdichtung schwerer dreht [S]
```

Zündbedingung Diesel (Selbstzündung) [S, physikalisch]:

```ts
const nCrank = 1.25 + 0.08 * Math.min(1, rpm / 250);           // Leckage/Wärmeverlust bei Schleppdrehzahl
const Tcomp = T_int * compressionRatio ** (nCrank - 1);         // K
const glow = coolantC < 60;                                     // Glühkerzen vor/während Start (immer verbaut angenommen)
const fires = ignition && rpm > 100 && (Tcomp > 650 || (glow && Tcomp > 540));
// Vorkammer/Wirbelkammer: Glühen zwingend unter 20 °C; Startdrehzahl-Schwelle 150 rpm
```

Leerlaufregler (PI auf Kraftstoffmasse) [S]:

```ts
const e = idleRpm - rpm;
idleInt = clamp(idleInt + e * dt, 0, intMax);
mFuelIdle = Math.max(0, Kp * e + Ki * idleInt);   // Kp ≈ 1.5e-9·Vl kg/rpm, Ki ≈ 3e-9·Vl kg/(rpm·s); nur aktiv bei pedal < 0.05
```

Abwürgen: `rpm < 0.5·idleRpm` ohne Starter und ohne Leerlauf-Kraftstoffreserve → `stall`. Mengenbedarf Leerlauf typ. 4 … 7 mg/Hub bei 2,0 l [S].

Kurbelwinkel (für Sound): `crankAngleDeg = (crankAngleDeg + rpm * 6 * dt) % 720`.

## 5. Referenzmotoren

Für `src/data/reference-engines.ts` und die Abgleichtests. Zielwerte: Modell sollte Spitzenmoment und -leistung auf ±7 % treffen [Vorschlag Recherche]. Wenn ein Wert [S] ist, gilt er nur als Plausibilitätsband.

| Feld | VW 1.9 TDI PD (ASZ/AVF) | BMW N57D30O1 | Mercedes OM654 (220d) | PSA/Ford 1.6 HDi 16V (DV6TED4) | Cummins 6BT 5.9 (12V, Dodge HX35) |
|---|---|---|---|---|---|
| Anordnung | R4, 2 V/Zyl., SOHC | R6, 4 V, DOHC | R4, 4 V, DOHC | R4, 4 V, DOHC | R6, 2 V, OHV |
| Bohrung × Hub [mm] | 79,5 × 95,5 [B] | 84,0 × 90,0 [B] | 82,0 × 92,3 [B] | 75,0 × 88,3 [B] | 102 × 120 [B] |
| Hubraum [l] | 1,896 [B] | 2,993 [B] | 1,950 [B] | 1,560 [B] | 5,883 [B] |
| Verdichtung | 18,0 [B] | 16,5 [B] | 15,5 [B] | 18,0 [S, gängige Angabe] | 17,5 [B] |
| Einspritzung (`injection`) | `unit-injector` [B] | `common-rail`, Piezo [B] | `common-rail`, Piezo [B] | `common-rail`, Bosch 2. Gen. [B] | Reiheneinspritzpumpe Bosch P7100 [B] → im Modell `unit-injector`-ähnlich, aber mit Druck ≈ 1000 bar [S]* |
| `injectionPressureBar` | 2050 [B] | 1800 [B] | 2050 [S, Serienstart 2016] (654 M: 2700 [B]) | 1600 [B] | ≈ 1000 [S] |
| Aufladung | VTG-Turbo, LLK [B] | VTG-Turbo (Mono), LLK [B] | VTG-Turbo, LLK (Topversion Twin) [B] | VTG Garrett GT15V, LLK [B] | Holset HX35 Wastegate, LLK [B] |
| Ladedruck (Überdruck) [bar] | ≈ 1,3 … 1,5 [S] | ≈ 1,5 … 1,8 [S] | ≈ 1,5 … 1,8 [S] | ≈ 1,1 … 1,3 [S] | ≈ 1,2 … 1,5 [S] |
| Leistung | 96 kW @ 4000 [B] | 190 kW @ 4000 [B] | 143 kW @ 3800 [B, Quelle markiert "citation needed"] | 80 kW @ 4000 [B Leistung, Drehzahl S] | 160 kW @ 2600 [B, Spitzenversion] |
| Drehmoment | 310 Nm @ 1900 [B] | 560 Nm @ 1500–3000 [B] | 400 Nm @ 1600–2400 [B] | 240 Nm @ 1750 (Overboost 260) [B] | 569 Nm @ 1600 [B] |
| bmep (berechnet) [bar] | 20,5 | 23,5 | 25,8 | 19,3 [B: Quelle nennt 19,32 bar] | 12,2 |
| Drehzahlgrenze [rpm] | ≈ 4800 … 5000 [S] | 5400 (Schaltgetriebe) [B] | ≈ 4800 [S] | ≈ 5000 [S] | ≈ 2800 (Regler-Endabregelung) [S] |
| Leerlauf [rpm] | 850 [S] | 750 [S] | 750 [S] | 800 [S] | 750 [S] |
| Block | Grauguss [B, allg. bekannt] | Aluminium [S] | Aluminium [B] | Aluminium [B] | Grauguss [B] |
| Masse ca. [kg] | ≈ 170 [S] | ≈ 195 [S] | ≈ 170 [S] | ≈ 125 [S] | ≈ 500 [B, engine-specs] |
| `smokeLimitLambda` (Vorschlag) | 1,20 | 1,25 | 1,25 | 1,25 | 1,40 (alte Abgasnorm, aber ohne Elektronik eher 1,3 …) |
| Abgasnachbehandlung | Oxi-Kat, AGR, kein DPF (bis ~2006) | AGR, Oxi-Kat, DPF | AGR (HD+ND), Oxi-Kat, DPF, SCR | AGR, Oxi-Kat, DPF (je nach Baujahr) | keine (1994–98) |

\* Der Typ kennt keine Verteiler-/Reihenpumpe. Für den 6BT `unit-injector` mit 1000 bar und `injectionTimingOffsetDeg = 0` verwenden, Gütegrad dadurch automatisch etwas schlechter (log-Term). Vorschlag an Architektur: Enum-Wert `"inline-pump"` (siehe Offene Punkte).

Vorgeschlagene Presets (`EngineConfig`-Felder, Diesel) – Konstruktions-Felder ohne Datenblattangabe sind [S]:

```ts
// VW 1.9 TDI PD 96 kW
{ block: { layout: "inline", cylinders: 4, bankAngleDeg: 0, v8Crank: "crossplane", boreMm: 79.5, strokeMm: 95.5,
           conrodLengthMm: 144, compressionRatio: 18, blockMaterial: "cast-iron", crankshaft: "forged",
           pistons: "cast-aluminium", conrods: "forged-steel" },
  head: { valvetrain: "sohc", valvesPerCylinder: 2, camProfile: 0.2, variableTiming: "none" },
  induction: { aspiration: "turbo", compressorInducerMm: 38, turbineAR: 0.5, variableGeometry: true,
               boostTargetBar: 1.4, intercooler: "air-to-air", intakeRunnerLengthMm: 380, individualThrottleBodies: false },
  fuelSystem: { kind: "diesel", injection: "unit-injector", injectionPressureBar: 2050, fuel: "diesel",
                smokeLimitLambda: 1.2, injectionTimingOffsetDeg: 0 },
  exhaust: { manifold: "cast-log", egr: true, catalyst: true, particulateFilter: false, scr: false },
  cooling: { radiatorCapacityKw: 70, thermostatOpenC: 87, oilCooler: true }, revLimitRpm: 4900, idleRpm: 850 }
// BMW N57D30O1: 6 Zyl., 84×90, Pleuel 145 [S], ε 16.5, aluminium, forged, cast-aluminium, forged-steel; dohc 4V camProfile 0.3;
//   turbo VTG inducer 46 mm, A/R 0.6, boost 1.7, air-to-air, runner 350; common-rail 1800 bar, λ 1.25; egr+cat+dpf;
//   radiator 120 kW, thermostat 88, oilCooler; revLimit 5400, idle 750
// Mercedes OM654 220d: 4 Zyl., 82×92.3, Pleuel 138 [S], ε 15.5, aluminium, forged, steel (Stahlkolben! [B, bekanntes Merkmal]), forged-steel;
//   dohc 4V camProfile 0.3, variableTiming "none"; turbo VTG 42 mm, A/R 0.55, boost 1.7, air-to-air; common-rail 2050, λ 1.25;
//   egr+cat+dpf+scr; radiator 95 kW, thermostat 90; revLimit 4800, idle 750
// PSA 1.6 HDi 80 kW: 4 Zyl., 75×88.3, Pleuel 136.8 [S], ε 18, aluminium, cast, cast-aluminium, forged-steel; dohc 4V 0.25;
//   turbo VTG 36 mm, A/R 0.45, boost 1.2, air-to-air; common-rail 1600, λ 1.25; egr+cat(+dpf); radiator 60, thermostat 88; revLimit 5000, idle 800
// Cummins 6BT 5.9 (Ram 1994–98, 160 kW Version): 6 Zyl., 102×120, Pleuel 192 [S], ε 17.5, cast-iron, forged, cast-aluminium, forged-steel;
//   ohv 2V camProfile 0.1; turbo Wastegate 55 mm, A/R 0.8 (HX35: 12 cm² Turbinengehäuse [S]), boost 1.4, air-to-air, runner 300;
//   unit-injector (Ersatz) 1000 bar, λ 1.35; egr/cat/dpf/scr false; radiator 150 kW, thermostat 83; revLimit 2800, idle 750
```

## 1. Parameter

Bereiche für den Konfigurator, wenn `fuel = "diesel"`. "Min/Max" = was die UI zulässt (darf auch unvernünftige, aber physikalisch mögliche Werte erlauben); "realistisch" = Serienband. Werte [S], sofern nicht in Kap. 5 belegt.

### BlockConfig

| Feld | Min | Max | Default | realistisch | Einheit / Hinweis |
|---|---|---|---|---|---|
| `layout` | – | – | `"inline"` | inline (R3–R6), v (V6/V8 90° bzw. 60°/72°) | `boxer` existiert (Subaru EE20), `vr`/`w` bei Diesel nicht in Serie (VW V10 TDI ist "v") |
| `cylinders` | 2 | 12 | 4 | 3 … 8 | – |
| `bankAngleDeg` | 45 | 180 | 90 | V6 60°/90°, V8 90° | ° |
| `v8Crank` | – | – | `"crossplane"` | Diesel-V8 immer crossplane | flatplane erlauben, aber Vibrationswarnung |
| `boreMm` | 65 | 140 | 81 | Pkw 75 … 90, Nfz 100 … 135 | mm |
| `strokeMm` | 70 | 165 | 93 | Pkw 80 … 100, Nfz 120 … 160 | mm; Diesel fast immer Langhuber (Hub/Bohrung 1,05 … 1,25) |
| `conrodLengthMm` | 1,4·Hub | 2,2·Hub | 1,55·Hub | λ_Pleuel = r/l = 0,28 … 0,33 | mm; Diesel 135 … 160 (Pkw) |
| `compressionRatio` | 12 | 24 | 16,5 | DI-CR 15 … 18, PD 18 … 19,5, Kammer 20 … 23 | – ; unter ~14 kein Kaltstart (siehe 3.11) |
| `blockMaterial` | – | – | `"cast-iron"` | alle drei | CGI: Nfz/V-Diesel (Audi 4.2 TDI, Ford 6.7) |
| `crankshaft` | – | – | `"forged"` | forged (Pkw-Diesel fast ausnahmslos) | cast nur bei alten Saugdieseln |
| `pistons` | – | – | `"cast-aluminium"` | cast-aluminium mit Kühlkanal; steel (OM654, Nfz) | – |
| `conrods` | – | – | `"forged-steel"` | forged-steel bzw. gecrackt | titanium unüblich |

### HeadConfig

| Feld | Min | Max | Default | realistisch | Hinweis |
|---|---|---|---|---|---|
| `valvetrain` | – | – | `"dohc"` | dohc (modern), sohc (TDI bis 2008), ohv (Nfz, Cummins) | – |
| `valvesPerCylinder` | 2 | 4 | 4 | 2 oder 4 | 3/5 bei Diesel nicht sinnvoll (Injektor mittig) → UI ausgrauen oder Malus |
| `camProfile` | 0 | 1 | 0,25 | 0,1 … 0,4 | Diesel: Drehzahlband schmal, scharfe Nocke bringt wenig (Ventiltaschen, Verdichtung!) |
| `variableTiming` | – | – | `"none"` | none; intake-cam selten (BMW B47-Einlass-Drall, Mazda Skyactiv-D Auslass-VVL) | – |

### InductionConfig

| Feld | Min | Max | Default | realistisch | Einheit / Hinweis |
|---|---|---|---|---|---|
| `aspiration` | – | – | `"turbo"` | turbo, twin-turbo-sequential; NA (alte Sauger), e-turbo (selten) | Kompressor bei Diesel exotisch |
| `compressorInducerMm` | 25 | 90 | 40 | Pkw 32 … 50, Nfz 55 … 75 | mm |
| `turbineAR` | 0,3 | 1,4 | 0,55 | Pkw 0,4 … 0,7, Nfz 0,7 … 1,2 | – |
| `variableGeometry` | – | – | `true` | Pkw seit ~1997 Standard | – |
| `boostTargetBar` | 0 | 3,5 | 1,5 | Pkw 1,2 … 2,0, Nfz 2 … 3 (zweistufig) | bar Überdruck |
| `intercooler` | – | – | `"air-to-air"` | air-to-air; air-to-water (OM654-Kompaktbau, BMW B57) | – |
| `intakeRunnerLengthMm` | 150 | 700 | 350 | 250 … 450 | mm |
| `individualThrottleBodies` | – | – | `false` | **immer false** | Diesel hat keine Drossel; UI ausblenden |

### DieselFuelSystem

| Feld | Min | Max | Default | realistisch | Einheit / Hinweis |
|---|---|---|---|---|---|
| `injection` | – | – | `"common-rail"` | alle vier | Kammer → max. 4500 … 5000 rpm erlaubt, langsame Verbrennung, laut |
| `injectionPressureBar` | 100 | 3000 | 1800 | Vorkammer 120 … 300, Wirbelkammer 250 … 400, PD 1600 … 2200, CR 1. Gen 1350 / 2. 1600 / 3. 1800 / 4. 2000 … 2700 | bar; für Kammermotoren UI-Max 500 |
| `fuel` | – | – | `"diesel"` | diesel, hvo, biodiesel | – |
| `smokeLimitLambda` | 1,0 | 2,0 | 1,25 | Serie Euro 4–6: 1,20 … 1,35; alt 1,4 … 1,6; Tuning bis 1,05 | – |
| `injectionTimingOffsetDeg` | −12 | +8 | 0 | ±3 | °KW, negativ = spät |

### ExhaustConfig

| Feld | Default | Hinweis |
|---|---|---|
| `manifold` | `"cast-log"` | Diesel fast immer Guss (EGT, Kompaktheit); tubular bringt wenig (+1 … 2 % ve, schnellere Turbo-Antwort τ ×0,9) |
| `egr` | `true` | Teillast-NOx; bei Volllast aus |
| `catalyst` | `true` | Oxi-Kat (DOC) |
| `particulateFilter` | `true` | Gegendruck +0,05 … 0,25 bar je Beladung |
| `scr` | `false` | AdBlue; NOx −90 % |

### CoolingConfig und Drehzahlen

| Feld | Min | Max | Default | realistisch | Einheit |
|---|---|---|---|---|---|
| `radiatorCapacityKw` | 20 | 400 | ≈ 0,55 · P_nenn | Pkw 50 … 120, Nfz 150 … 300 | kW |
| `thermostatOpenC` | 70 | 105 | 88 | 83 … 92 (Nfz 82 … 85) | °C |
| `oilCooler` | – | – | `true` | Turbodiesel praktisch immer | – |
| `revLimitRpm` | 2000 | 6000 | 4800 | Pkw-DI 4500 … 5200, Kammer 4800 … 5000, Nfz 2200 … 3000 | rpm; Reglerbeginn (3.2) |
| `idleRpm` | 500 | 1100 | 800 | Pkw 750 … 850, Nfz 600 … 750 | rpm |

## 4. Grenzen und Schäden

Prinzip: `warning` ab erster Schwelle, `critical` ab zweiter, Verschleiß akkumuliert oberhalb der Warnschwelle (`wear += rate·dt`), `fatal` bei dritter Schwelle bzw. wenn eine critical-Bedingung länger als die Haltezeit anliegt. Zahlen [S] aus Konstruktions-Faustwerten, sofern nicht anders markiert.

### 4.1 Mittlere Kolbengeschwindigkeit (`piston-speed`)

| Stufe | Pkw-Diesel | Nfz (> 100 mm Bohrung) |
|---|---|---|
| Serie Nennleistung | 11 … 14 m/s [B, Lehrbuchbereich] | 9 … 11 m/s |
| warning | 15 m/s | 12 m/s |
| critical | 17 m/s | 14 m/s |
| fatal (Pleuel/Kolben) | 19 m/s (> 2 s) | 16 m/s |

Modifikatoren der Schwellen: `forged-steel`-Pleuel ×1,0, `cast-steel` ×0,92, `titanium` ×1,10; `steel`-Kolben ×0,95 (Masse), `forged-aluminium` ×1,05; Kurbelwelle `cast` ×0,92, `billet` ×1,05. `safeMaxRpm = 30 · vCritical / (strokeMm/1000)` (min mit Ventilflattern 3.11 bzw. Benziner-Doku).

Ventilflattern (`valve-float`): Diesel-Ventiltriebe sind auf niedrige Drehzahl ausgelegt: Grenze `nFloat ≈ 5600 rpm · (1 − 0,15·(valvetrain==="ohv")) · (1 + 0,1·camProfile)` [S].

### 4.2 Spitzendruck (`peak-pressure`)

Zulässiger Zylinderspitzendruck `pMaxDesign` = Minimum aus Block, Kolben, Pleuel [S, Größenordnungen aus Literatur: Pkw-Diesel heute 180 … 200 bar Serie (SAE 2013-01-1622), Nfz 220 … 250 bar]:

| Bauteil | Wert [bar] |
|---|---|
| Block `aluminium` | 190 (mit Grauguss-Laufbuchsen) |
| Block `cast-iron` | 210 |
| Block `compacted-graphite-iron` | 250 |
| Kolben `cast-aluminium` | 190 |
| Kolben `forged-aluminium` | 215 |
| Kolben `steel` | 260 |
| Pleuel `cast-steel` | 180 |
| Pleuel `forged-steel` | 220 |
| Pleuel `titanium` | 240 |

Zylinderkopf/Kopfdichtung: zusätzlich Bohrungseinfluss, Kraft ∝ p·Bohrung² → `pMaxDesign *= (82 / boreMm)^0.5` für Bohrungen > 82 mm (große Bohrung = größere Kraft, aber in Nfz-Bauweise kompensiert, daher nur halber Exponent) [S].

| Stufe | Bedingung | Folge |
|---|---|---|
| warning | `peakPressureBar > 0,95·pMaxDesign` | Verschleiß ×2 |
| critical | `> 1,05·pMaxDesign` | Verschleiß ×10, Kopfdichtung (Kühlmittelverlust) bei > 3 s |
| fatal | `> 1,25·pMaxDesign` (sofort) oder critical > 10 s | Kolbenbruch / Pleuel knickt (`conrod-stress`) |

Pleuelbelastung (`conrod-stress`) zusätzlich aus Massenkraft (Zug im Ladungswechsel-OT): `F_inertia ≈ m_osc·r·ω²·(1+λ_Pl)`, `m_osc ≈ 0.9 · (boreMm/82)^2.2 kg` (Kolben+Bolzen+oszillierender Pleuel-Anteil; `steel`-Kolben ×1,25) [S]; Zuggrenze forged-steel ≈ 35 kN·(boreMm/82)² [S].

### 4.3 Abgastemperatur (`egt-high`) – vor Turbine

| Stufe | Wert | Hinweis |
|---|---|---|
| Serie Volllast | 700 … 800 °C | Pkw-VTG-Lader ausgelegt bis ~830 °C [S]; Nfz-Wastegate ~760 °C |
| warning | 800 °C | Steuergeräte reduzieren ab hier die Menge (Bauteilschutz) |
| critical | 850 °C | VTG-Schaufeln verklemmen, Kolbenmulde schmilzt an (Alu-Kolben) |
| fatal | 950 °C für > 5 s | Kolben-Muldenrand angeschmolzen / Turbinenrad |

`steel`-Kolben: Kolbenschaden erst ab 1000 °C, Turbinengrenze bleibt.

### 4.4 Turbolader (`turbo-overspeed`, `overboost`)

| Größe | warning | critical / fatal |
|---|---|---|
| Läuferdrehzahl | `turboRpm > 0,92·nMax` | `> 1,0·nMax` critical, `> 1,08·nMax` fatal (Verdichterrad berstet) |
| `nMax` | Umfangsgeschwindigkeit u2 ≈ 520 m/s (Alu-Verdichterrad) [S] → `nMax = 520·60 / (π·D2)` | 45 mm Inducer → ≈ 154 000 rpm; 38 mm → ≈ 183 000 rpm |
| Überladedruck | `boostBar > boostTargetBar + 0,3` für > 1 s | Regelfehler / Spieler-Tuning; führt meist zu Spitzendruck-Problem |
| Verdichteraustritt T2 | > 190 °C warning | > 220 °C critical (Ölkohle, Ladeluftschläuche) |

### 4.5 Kühlmittel und Öl

| Größe | warning | critical | fatal |
|---|---|---|---|
| Kühlmittel (`overheat-coolant`) | 108 °C | 118 °C (Siedepunkt bei 1,4 bar Deckel ≈ 125 °C) | 130 °C > 20 s: Kopf verzieht sich / Kopfdichtung |
| Öl (`overheat-oil`) | 135 °C | 150 °C | 165 °C > 20 s: Lagerschaden |
| Öldruck (`low-oil-pressure`) | < 1,0 bar bei > 2000 rpm | < 0,5 bar | < 0,3 bar > 3 s bei > 1500 rpm: Lagerfresser |
| Kalt-Volllast | Öl < 50 °C und load > 0,8 | – | nur Verschleiß ×3 |

### 4.6 Rauch und Sonstiges

- `smoke`: warning > 0,3, critical > 0,6 (keine Schäden, aber DPF-Beladung steigt; ohne DPF reine Optik/Sound). Mit DPF: Beladung `dpfLoad += smokeRaw·dt/600`; ab 1 → Gegendruck +0,3 bar (Leistungsverlust).
- `stall`: rpm < 0,5·idleRpm ohne Starter.
- `over-rev`: Diesel-Regler verhindert Überdrehen aus eigener Kraft; nur durch Prüfstand-Schleppen oder Ölansaugen ("Durchgehen", optional Easter Egg) möglich. warning > revLimit + 200, critical > safeMaxRpm.
- `knock`: Diesel immer 0 (das "Nageln" ist Verbrennungsgeräusch, siehe Sound-Hinweis in Kap. 2).

### 4.7 Zuverlässigkeit (EngineSummary.reliability)

Start 1,0, multiplikative Abzüge [S]: Auslegungs-Spitzendruck-Reserve `(pMaxDesign − pMaxAtRated)/pMaxDesign` < 5 % → ×0,8; cm bei Nenndrehzahl > 14 m/s → ×0,85; EGT bei Nennleistung > 780 °C → ×0,85; smokeLimitLambda < 1,15 → ×0,9; Aluminiumblock + Ladedruck > 2 bar → ×0,9; ohne Ölkühler und > 60 kW/l → ×0,85; `cast`-Kurbelwelle mit > 18 bar bmep → ×0,8.

## 2. Wirkungen

Pfeile: ↑ steigt, ↓ sinkt, ~ kaum Einfluss, (n) über das Modell aus Kap. 3 automatisch abgebildet. Wirkung jeweils bei **Erhöhung** des Parameters bzw. Wahl der Option, Rest gleich. Größenordnungen [S].

| Parameter | Drehmoment | Leistung | BSFC | EGT | Spitzendruck | Ruß / NOx | max. rpm | Gewicht | Zuverlässigkeit |
|---|---|---|---|---|---|---|---|---|---|
| `boreMm` (Hubraum) | ↑ ∝ Vh | ↑ | ↓ leicht (weniger Wandwärme) | ~ | ~ | ~ | ↓ wenig (Kolbenmasse) | ↑ | ↓ Kopfdichtung |
| `strokeMm` | ↑ ∝ Vh | ↑ bis cm-Grenze | ↓ leicht | ~ | ~ | ~ | **↓ stark** (cm) | ↑ (Blockhöhe) | ↓ bei hoher rpm |
| `conrodLengthMm` | ~ | ~ | ↓ minimal (Seitenkraft) | ~ | ~ | ~ | ↑ leicht | ↑ (Blockhöhe) | ↑ |
| `cylinders` (bei gleichem Vh) | ~ | ↑ (höhere rpm möglich) | ↑ leicht (Reibung) | ~ | ~ | ~ | ↑ | ↑ | ~; Laufruhe ↑ |
| `compressionRatio` | ↑ wenig (η +~1 %/Einheit) | ↑ wenig | ↓ | ↓ | **↑ stark** (p_comp ∝ ε^1,33) | Ruß ↓, NOx ↑, Kaltstart besser | ~ | ~ | ↓ (Spitzendruck-Reserve) |
| `blockMaterial` alu | ~ | ~ | ~ | ~ | Grenze ↓ | ~ | ~ | **↓ ~25–35 kg (R4)** | ↓ bei hohem pMax |
| CGI | ~ | ~ | ~ | ~ | Grenze ↑ | ~ | ~ | −10 % ggü. Grauguss (dünnere Wände) | ↑ |
| `crankshaft` forged/billet | ~ | ~ | ~ | ~ | ~ | ~ | ↑ | ~ | ↑ |
| `pistons` steel | ~ | ~ | ↓ leicht (Spaltmaß, Wärme) | ↑ leicht | Grenze ↑↑ | ~ | ↓ (Masse) | ↑ | ↑ (EGT-fest) |
| `conrods` forged/titanium | ~ | ~ | ~ | ~ | Grenze ↑ | ~ | ↑ | titan ↓ | ↑ |
| `valvesPerCylinder` 4 | ↑ (ve +~7 %) | ↑ | ↓ (zentrale Düse, bessere Gemischbildung) | ↓ | ~ | Ruß ↓ | ↑ | ↑ leicht | ~ |
| `valvetrain` dohc | ~ | ↑ (höhere Grenzdrehzahl) | ~ | ~ | ~ | ~ | ↑ | ↑ | ~ |
| `camProfile` ↑ | ↓ unten, ↑ oben | ↑ wenig | ↑ unten | ~ | ~ | ~ | ↑ | ~ | ~; Leerlauf unruhig |
| `variableTiming` | breiteres Plateau | ↑ wenig | ↓ wenig | ~ | ~ | NOx ↓ (interne AGR) | ~ | ↑ | ↓ leicht |
| `aspiration` turbo vs NA | **↑ ×1,8 … 2,5** | ↑↑ | ↓ (Teillast ~, Volllast besser) | ↑ vor Turbine | ↑↑ | Ruß ↓ (mehr Luft) | ~ | ↑ +10 … 15 kg | ↓ |
| `compressorInducerMm` ↑ | ↓ unten (Lag), ↑ oben | ↑ (Stopfgrenze) | ~ | ↓ oben | ↑ oben | Rauch beim Gasstoß ↑ | ~ | ↑ | ~ |
| `turbineAR` ↑ | ↓ unten | ↑ oben | ↓ oben (weniger Gegendruck) | ↓ | ~ | Rauch beim Gasstoß ↑ | ~ | ~ | ↑ (EGT) |
| `variableGeometry` | ↑ unten (Ladedruck ab ~1200 rpm) | ~ | ↓ | ~ | ~ | Ruß ↓ | ~ | +1 kg | ↓ leicht (Verkokung) |
| `boostTargetBar` ↑ | **↑ fast linear** (mehr Luft → mehr Menge bei gleichem λ) | ↑ | ↓ leicht | ↑ (T2, Gegendruck) | **↑ linear** (p_int) | Ruß ↓ bei festem Kraftstoff | ~ | ~ | ↓↓ |
| `intercooler` | ↑ +8 … 15 % (Dichte) | ↑ | ↓ | **↓ ~ 50 … 80 K** | ↓ leicht | NOx ↓ | ~ | ↑ | ↑ |
| `intakeRunnerLengthMm` ↑ | ↑ unten, ↓ oben | ↓ oben | ~ | ~ | ~ | ~ | ~ | ↑ | ~ |
| `injection` CR vs Kammer | ↑ +20 … 30 % | ↑ | **↓ 15 … 20 %** | ↓ | ↑ | Ruß ↓↓, NOx ↑; Lautstärke ↓ (Voreinspritzung) | Kammer ~ gleich | Kammer leichter (einfacher Kopf) | Kammer ↑ (robust, niedriger pMax) |
| `injectionPressureBar` ↑ | ↑ (λ-Grenze ↓ möglich) | ↑ | ↓ ~1 … 2 % pro +500 bar | ↓ leicht | ↑ leicht | **Ruß ↓↓**, NOx ↑ | Einspritzfenster → Leistung ↑ oben | ~ | ↓ leicht (Pumpe) |
| `fuel` hvo | ~ (+ Hu/kg, − Dichte) | ~ | ↓ g/kWh, ↑ l/h ~ | ~ | ~ | Ruß −25 %, NOx −5 % | ~ | ~ | ~ |
| `fuel` biodiesel | ↓ −8 … 10 % bei gleichem λ | ↓ | ↑ ~ +12 % g/kWh | ~ | ~ | Ruß −45 %, NOx +10 % | ~ | ~ | ↓ (Ölverdünnung) |
| `smokeLimitLambda` ↓ | **↑** (λ 1,4 → 1,2: +16 % Menge) | ↑ | ↑ (langsamere Verbrennung) | **↑ ~ +40 K je −0,1** | ↑ | **Ruß ↑↑** | ~ | ~ | ↓ (EGT, Kolben) |
| `injectionTimingOffsetDeg` früh (+) | ↑ bis Optimum, dann ↓ | ↑/↓ | quadr. Verlust | ↓ | **↑ +3 %/°** | Ruß ↓, NOx ↑↑, Nageln lauter | ~ | ~ | ↓ (pMax) |
| `injectionTimingOffsetDeg` spät (−) | ↓ | ↓ | ↑ | **↑** | ↓ | Ruß ↑, NOx ↓ | ~ | ~ | ↓ (EGT) |
| `manifold` tubular | ~ +1 % | ~ | ~ | ~ | ~ | ~ | ~ | ↓ leicht | ↓ (Risse bei hoher EGT) |
| `egr` | ~ (nur Teillast aktiv) | ~ | ↑ +1 … 2 % Teillast | ↑ Teillast | ↓ | NOx ↓↓, Ruß ↑ | ~ | ↑ +3 kg | ↓ (Verkokung) |
| `catalyst` | ~ | ~ | ~ | ~ | ~ | HC/CO ↓ | ~ | ↑ | ~ |
| `particulateFilter` | ↓ −1 … 3 % (Gegendruck) | ↓ | ↑ +1 … 3 % | ↑ | ~ | Ruß ↓↓ (Rauch ≈ 0) | ~ | ↑ +8 kg | ~ |
| `scr` | ~ | ~ | ↓ (erlaubt frühere SB → Kalibrierung) | ~ | ~ | NOx −90 % | ~ | ↑ +15 kg (inkl. Tank) | ~ |
| `radiatorCapacityKw` ↑ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ↑ | ↑ (Dauerlast) |
| `thermostatOpenC` ↑ | ~ | ~ | ↓ leicht (Reibung) | ~ | ~ | ~ | ~ | ~ | ↓ wenig |
| `oilCooler` | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ↑ +2 kg | ↑ |
| `revLimitRpm` ↑ | ~ | ↑ bis Rauch-/Einspritzgrenze | ↑ oben | ↑ | ~ | ~ | – | ~ | ↓ |

### Masse (für `EngineSummary.massKg`) [S, kalibriert auf Kap. 5]

```ts
const mBase = 40 + 50 * Vl;                                  // kg, Grauguss-Block (1,9 l → 135)
const matF = { "cast-iron": 1.0, "compacted-graphite-iron": 0.92, "aluminium": 0.80 }[blockMaterial];
let massKg = mBase * matF + 4 * cylinders;                   // Zylinderzahl-Zuschlag (Köpfe, Ventile, Injektoren)
if (layout === "v") massKg *= 1.05;                          // zwei Köpfe
if (aspiration !== "naturally-aspirated") massKg += 8 + 0.12 * compressorInducerMm; // Lader + Rohre
if (intercooler !== "none") massKg += 6;
if (boreMm > 100) massKg *= 1.25;                            // Nfz-Bauweise
// Check: VW 1.9 PD ≈ 173 · N57 ≈ 207 · OM654 ≈ 171 · 6BT ≈ 475 kg (Ziel 170 / 195 / 170 / ~500)
massKg += (particulateFilter ? 8 : 0) + (scr ? 15 : 0) + (egr ? 3 : 0);
```

### Sound-Hinweise (für das Sound-Team)
- Dieselnageln = steiler Druckanstieg `dp/dφ`; ∝ Zündverzug. Lauter bei: kalt, Kammerlos ohne Voreinspritzung (PD!), Frühverstellung, hoher Verdichtung kalt. CR mit Voreinspritzung deutlich leiser; Kammerdiesel weich, aber "dumpf-klopfend". Vorschlag: `nailIntensity = clamp(0.3 + 0.04·offset + 0.3·(coolantC<50) + {CR:0, PD:0.35, IDI:0.15}, 0, 1) · (1 − 0.5·load)` (unter Last verdeckt).
- Kein Drosselzischen; Turbo-Pfeifen ∝ turboRpm (Schaufelzahl ~ 6+6 → Grundton = turboRpm/60·12 Hz), VTG-Lader leiser, Wastegate-Lader mit Abblasen.

## 7. Offene Punkte an Architektur
- `DieselInjection` kennt keine mechanische Reihen-/Verteilerpumpe (Cummins 6BT, VW 1.9 TD/SDI-Vorgänger). Vorschlag: `"inline-pump" | "rotary-pump"` ergänzen (Druck 600 … 1100 bar, kein Mehrfacheinspritzen → Nageln lauter, Gütegrad ≈ 0,74).
- Glühkerzen fehlen im Typ; hier als immer verbaut angenommen (3.11).
- `EngineState` hat keinen NOx-Wert; falls Abgasnorm-Spielerei gewünscht, `noxIndex` ergänzen.
- `fullLoadTorqueAt(rpm)` für `load` braucht einen Cache im Simulator (Kap. 3.5).

## 6. Quellen

Belegt [B] heißt: Wert aus einer der folgenden Quellen bzw. aus Standard-Lehrbuchwissen (Heywood, *Internal Combustion Engine Fundamentals*; Pischinger/Merker, *Grundlagen Verbrennungsmotoren*; Bosch *Kraftfahrtechnisches Taschenbuch*), in eigenen Worten wiedergegeben. Alle Modell-Koeffizienten ohne [B] sind Schätzungen zur Kalibrierung.

- Chen, S. K.; Flynn, P. F.: *Development of a Single Cylinder Compression Ignition Research Engine*, SAE 650733 (Reibmodell-Form).
- x-engineer.org – Mechanical efficiency and FMEP (Chen-Flynn-Form, Beispielkoeffizienten): https://x-engineer.org/mechanical-efficiency-friction-mean-effective-pressure-fmep/
- SAE 2013-01-1622 – *Investigation of Extreme Mean Effective and Maximum Cylinder Pressures in a Passenger Car Diesel Engine* (heutige Pkw-Diesel: pme 20 … 30 bar, pMax ≈ 180 … 200 bar): https://saemobilus.sae.org/content/2013-01-1622
- Wikipedia – BMW N57 (Bohrung/Hub, Raildruck 1800/2000 bar, Leistung/Drehmoment, Drehzahlgrenzen): https://en.wikipedia.org/wiki/BMW_N57
- BimmerArchive – N57D30O1 (Verdichtung 16,5, 190 kW, 560 Nm): https://www.bimmerarchive.org/m-code/n57d30o1.html
- Wikipedia – Mercedes-Benz OM654 (Bohrung/Hub, ε 15,5, Alublock, Leistungsstufen, 2700 bar beim 654 M): https://en.wikipedia.org/wiki/Mercedes-Benz_OM654_engine
- motor-car.net – VW 1.9 TDI EA188 (ASZ/AVF 96 kW/310 Nm, 79,5 × 95,5, ε 18, PD bis 2050 bar, VTG): https://www.motor-car.net/vw-engines/item/20090-vw-1-9-tdi-ea188-engine
- km77.com – Peugeot 1.6 HDi (75 × 88,3, 1560 cm³, CR 1600 bar, GT15-VTG, 240/260 Nm, pme 19,3 bar, Alublock): https://www.km77.com/coches/peugeot/tecnica/2003/motor-16-hdi
- Wikipedia – Cummins B Series (102 × 120, ε 17,5, Bosch P7100, Grauguss): https://en.wikipedia.org/wiki/Cummins_B_Series_engine
- engine-specs.net – Cummins 6BT (Holset HX35, 120 … 160 kW, 542 … 569 Nm @ 1600, ≈ 498 kg): https://engine-specs.net/cummins/6bt.html
- Nicht abrufbar (Berechtigung abgelaufen): Tupy, *Compacted Graphite Iron for Diesel* – Spitzendruckgrenzen je Blockmaterial in Kap. 4.2 daher [S].

