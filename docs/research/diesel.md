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
_in Arbeit_

## 1. Parameter
_in Arbeit_

## 4. Grenzen und Schäden
_in Arbeit_

## 2. Wirkungen
_in Arbeit_

## 6. Quellen
_in Arbeit_
