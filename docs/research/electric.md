# Elektroantrieb (Issue #108)

Recherche und Modellannahmen für den Elektroantrieb: E-Motor mit Wechselrichter, Traktionsakku, Rekuperation,
1-Gang-Untersetzung und Mehrmotor-Allrad. Umsetzung in `src/core/electric-motor.ts`, `src/core/battery.ts`,
`src/core/electric.ts`; Fahrzeuge in `src/data/ev-library.ts`, Tuning in `src/data/ev-tuning.ts`.

Kennzeichnung wie in den anderen Recherche-Dateien: **[S]** = Schätzung/typischer Wert der Klasse, sonst mit Quelle.

## 1 Überblick

Ein Elektroauto hat keinen Leerlauf, keinen Anlasser, keine Kupplung und kein Schaltgetriebe. Die Motoren sitzen
über eine feste Untersetzung (≈ 7 … 12 : 1) starr an den Rädern. Was die Beschleunigung begrenzt, ist der Reihe nach:

1. der Phasenstrom des Wechselrichters (Drehmoment bis zur Eckdrehzahl),
2. die Spannung des Akkus (Eckdrehzahl, darüber Feldschwächung mit konstanter Leistung),
3. der Akku selbst: Entladestrom (C-Rate), Spannungseinbruch am Innenwiderstand, Temperatur, Ladezustand,
4. die Haftung der Reifen (μ·N je Achse), bei starken Allradlern fast immer zuerst.

## 2 E-Motor und Wechselrichter

### 2.1 Kennlinie (Drehmoment und Leistung über der Drehzahl)

Quellen: R. De Doncker, D. Pulle, A. Veltman, *Advanced Electrical Drives*, Springer 2011, Kap. 7 (Feldschwächung
der PMSM) und Kap. 8 (Asynchronmaschine); Bosch, *Kraftfahrtechnisches Taschenbuch*, 29. Aufl., „Elektrische
Antriebe für Fahrzeuge“.

- **Grunddrehzahlbereich:** M = k_T · I. Der Wechselrichter begrenzt den Phasenstrom, also ist das Drehmoment
  konstant (M_max) bis zur **Eckdrehzahl** n_b.
- **Eckdrehzahl:** Dort erreicht die induzierte Spannung (∝ Drehzahl) die Spannung, die der Wechselrichter aus der
  Zwischenkreisspannung U_DC stellen kann: n_b ∝ U_DC. Modell: n_b = P_max / M_max bei Nennspannung, skaliert mit
  U_DC/U_nenn. Ein Akku, der unter Last einbricht, senkt also die Eckdrehzahl und damit die Leistung.
- **Feldschwächbereich:** Oberhalb n_b wird das Feld geschwächt, die Leistung bleibt ≈ konstant bis zur
  charakteristischen Drehzahl (PMSM ≈ 3·n_b, Asynchronmaschine ≈ 2·n_b … 2,5·n_b). Darüber fällt die Leistung ∝ 1/n
  (PMSM: begrenzter feldschwächender Strom; ASM: Kippmoment ∝ 1/n²).
- **Höchstdrehzahl:** mechanisch (Rotor, Lager). Tesla Plaid: Rotor mit Karbonhülse, > 20 000 1/min
  (Tesla Owner's Manual; InsideEVs, Engineering Analysis Model S Plaid, 2021: Schätzung ≈ 23 000 1/min bei 200 mph).

### 2.2 Strom über dem Nennstrom (Tuning)

Mehr Phasenstrom bringt mehr Drehmoment, aber das Statoreisen geht in die Sättigung: Das Drehmoment steigt oberhalb
des Auslegungsstroms nur noch etwa mit I^0,75 **[S]** (typische Sättigungskurven von PMSM-Traktionsmotoren, z. B.
Hendershot/Miller, *Design of Brushless Permanent-Magnet Machines*, Kap. 3). Wechselrichter-Module (SiC) vertragen
heute ≈ 1000 … 2500 A Spitze **[S]**.

### 2.3 Verluste und Wirkungsgradkennfeld

- Kupferverluste ∝ I² ∝ M² (Wicklung, bei der ASM auch Läuferkäfig).
- Eisenverluste ∝ f^1,5 (Steinmetz-Näherung) ∝ n^1,5; bei der PMSM auch ohne Last (Magnete), deshalb nutzt Tesla
  vorn eine ASM, die ohne Moment fast verlustfrei mitläuft. Unter Last braucht die ASM dafür Magnetisierungsstrom
  (zusätzlicher Verlust ≈ 0,5 % der Spitzenleistung, sobald sie Moment abgibt).
- Konstante Anteile (Lager, Luftreibung) und Wechselrichter ≈ 2 % (SiC/IGBT bei Last).

Modell: P_V = P_max · (c_cu·(M/M_max)² + c_fe·(n/n_max)^1,5 + c_0). Koeffizienten so gewählt, dass η_max der PMSM bei
≈ 96 … 97 % und der ASM bei ≈ 93 … 95 % liegt und bei Volllast an der Eckdrehzahl ≈ 92 … 94 % (typische Kennfelder,
z. B. ORNL, *Evaluation of the 2017 Toyota Prius Prime / 2014 BMW i3 Electric Drive System*, Benchmark-Reports **[S]**).

### 2.4 Motortemperatur

Ein-Massen-Modell: Wärmekapazität ≈ 200 J/K je kW Spitzenleistung, Kühlung ≈ 0,25 W/K je kW an einen 45-°C-Kreis
**[S]** (Wicklung + Stator ≈ 30 … 60 kg bei 250 kW). Ab 150 °C regelt die Software das Drehmoment herunter, bei 180 °C
(Isolierstoffklasse H) ist Schluss.

## 3 Traktionsakku

### 3.1 Leerlaufspannung (OCV) über dem Ladezustand

Quellen: G. Plett, *Battery Management Systems Vol. 1: Battery Modeling*, Artech House 2015, Kap. 2; Datenblätter
Panasonic NCR18650B (NCA), LG INR21700-M50 (NMC 811), CATL LFP-Prismatik.

| SoC | 0 | 10 % | 20 % | 50 % | 80 % | 100 % |
|---|---|---|---|---|---|---|
| NMC [V] | 3,00 | 3,45 | 3,55 | 3,74 | 3,98 | 4,18 |
| NCA [V] | 3,00 | 3,42 | 3,52 | 3,73 | 3,97 | 4,17 |
| LFP [V] | 2,60 | 3,18 | 3,24 | 3,30 | 3,33 | 3,45 |

Pack = S Zellen in Reihe × P parallel: U = S·U_Zelle, Q = P·Q_Zelle.

### 3.2 Innenwiderstand und Spannungseinbruch

Ersatzschaltbild R_int (Plett, Kap. 2.2): U_Klemme = U_OCV(SoC) − I·R_i. R_Pack = R_Zelle · S / P.
Temperatur: Arrhenius R(T) = R_25 · exp(E_a/R · (1/T − 1/298 K)) mit E_a ≈ 25 kJ/mol (E_a/R ≈ 3000 K) **[S]**: bei
0 °C etwa doppelter Widerstand.
Für eine geforderte Leistung P gilt P = (U_OCV − I·R)·I, also I = (U_OCV − √(U_OCV² − 4·R·P)) / (2R).
Zellwerte **[S]**: 18650 NCA ≈ 20 … 25 mΩ, 21700 NMC ≈ 15 mΩ, große Pouch-Zellen (78 Ah, MEB) ≈ 1,2 mΩ.

### 3.3 Leistungsgrenzen (BMS)

- Entladestrom ≤ C_max·Q, Zellspannung unter Last ≥ U_min (NMC/NCA 2,9 V, LFP 2,5 V).
- Unter 15 % SoC senkt das BMS die Leistung (bis 40 %), heiß (> 55 °C) ebenfalls, bis 20 % bei 65 °C.
- Laden (Rekuperation): ≤ C_lade·Q, Zellspannung ≤ U_max (4,2 V / 3,65 V); die Ladeakzeptanz fällt über 90 % SoC
  linear auf null bei 100 % und ist in der Kälte klein (Lithium-Plating), deshalb rekuperiert ein voller oder kalter
  Akku kaum (Plett, Vol. 2 *Battery Management Systems*, Kap. 6 „power limits“).

### 3.4 Wärme

Joule-Wärme I²·R_i in eine Masse (≈ 1000 J/(kg·K)), Kühlplatte ≈ 400 W/K an 25 °C **[S]**. Packmasse aus der
Energiedichte auf Pack-Ebene ≈ 160 Wh/kg **[S]** (Tesla 100 kWh ≈ 540 … 620 kg). Ein Plaid-Start mit ≈ 2000 A und
28 mΩ erzeugt ≈ 110 kW Wärme, also ≈ 0,2 K/s; mehrere Starts in Folge machen den Akku spürbar warm.

### 3.5 SoC und Reichweite

SoC durch Ladungszählung dSoC/dt = −I/(3600·Q). Restenergie = ∫ U_OCV dQ von 0 bis SoC. Reichweite = Restenergie /
Verbrauch; der Verbrauch ist auf den ersten Kilometern der WLTP-Wert, danach zunehmend der Fahrtdurchschnitt (Übergang
2 … 20 km). Nebenverbraucher (12-V-Bordnetz, Pumpen, Steuergeräte) ≈ 0,4 kW **[S]**.

## 4 Antriebsstrang

### 4.1 Untersetzung und Mehrmotor-Allrad

Jeder Motor hat seine eigene einstufige Untersetzung i_k (z. B. Model S Long Range vorn 7,56, hinten 9,04 laut Tesla
Owner's Manual). Für die vorhandene Längsdynamik (`simulator.ts` stepVehicle) werden alle Motoren auf eine
Bezugswelle (erster Hinterachsmotor, i_ref) reduziert: M_ref = Σ M_k·i_k/i_ref, J_ref = Σ J_k·(i_k/i_ref)².
Rotorträgheit ≈ 1,1·10⁻⁴ kg·m² je Nm Spitzenmoment **[S]**. Wirkungsgrad Getriebe + Differential ≈ 97 %.

### 4.2 Rekuperation

- **One-Pedal / Schubrekuperation:** Pedal unter 10 % = Rekuperation, darüber Antrieb. Verzögerung beim Lupfen:
  Tesla ≈ 0,18 g, VW „B“ ≈ 0,13 g, Lucid „High“ ≈ 0,15 g **[S]** (Herstellerangaben zur maximalen
  Rekuperationsleistung ≈ 60 … 250 kW).
- **Bremsblending:** Das Bremspedal wird zuerst von den Motoren bedient (bis ≈ 0,3 g, Motorkennlinie und
  Ladeleistung des Akkus), den Rest macht die Reibbremse (Bosch KTB, „Rekuperative Bremssysteme“).
- Keine Rekuperation unter ≈ 3 … 7 km/h (ausgeblendet) und nicht, solange das ABS regelt.

### 4.3 Traktionsregelung

Ein E-Motor stellt sein Moment in Millisekunden. Die Schlupfregelung ist deshalb als Vorsteuerung modelliert: Je
Achse höchstens 0,97·μ·N_Achse (N mit Achslastverlagerung m·a·h/l). Was die Vorderachse nicht übertragen kann, geht
an die Hinterachse und umgekehrt, wie bei Zwei- und Dreimotor-Autos (Tesla, Lucid: getrennte Motorsteuerung je Achse).

### 4.4 Fahrmodi

| Modus | Drehmoment | Akkuleistung | Pedal (Moment ∝ Pedal^x) |
|---|---|---|---|
| Chill | 50 % | 45 % | x = 1,6 |
| Sport | 85 % | 80 % | x = 1,2 |
| Plaid | 100 % | 100 % | x = 1,0 |

Angelehnt an Teslas „Chill / Sport (Standard) / Plaid“ **[S]**; Tesla nennt keine Zahlen, Chill halbiert in Tests
etwa die Beschleunigung.

## 5 Bibliothek

### 5.1 Kalibrierung

Die „Systemleistung“ der Hersteller ist die Wellenleistung, die der volle Akku erlaubt (die Summe der Motorleistungen
ist bei Tesla und Lucid größer). Die Zellzahl folgt aus Nennspannung und Energie, die Entlade-C-Rate ist so gewählt,
dass bei 90 % SoC und 25 °C die Systemleistung herauskommt (`evSystemPowerKw`, Test ±5 %). Das Moment je Motor folgt
aus der Startkraft (≈ μ·m·g) **[S]**.

### 5.2 Daten und Quellen

| Auto | Leistung | Masse | 0–100 | Vmax | Akku | Motoren, Übersetzung | Quelle |
|---|---|---|---|---|---|---|---|
| Model S Long Range | 493 kW | 2069 kg (+75) | 3,2 s* | 250 | 100 kWh, 407 V | 2 × PMSM, 7,56 / 9,04 | auto-data.net; Tesla Owner's Manual |
| Model S Plaid | 750 kW | 2265 kg EU | 2,1 s* | 300 | 100 kWh | 3 × PMSM (Karbonhülse), 7,56 | ADAC-Autokatalog; Owner's Manual |
| Model X Plaid | 750 kW | 2470 kg EU | 2,6 s* | 262 | 100/95 kWh | 3 × PMSM, 7,56 | ADAC-Autokatalog; Owner's Manual |
| Model Y Performance | 338 kW, 660 Nm | 2072 kg EU | 3,7 s* | 250 | 79 kWh netto, 345 V | ASM vorn + PMSM hinten, 9:1 | ADAC-Autokatalog; Owner's Manual |
| Lucid Air Sapphire | 920 kW, 1940 Nm | 2420 kg (+75) | 2,0 s* (0–60 mph 1,89 s) | 330 | 118 kWh, 900 V+ | 3 × PMSM, 7:1 / 6,8:1 | Lucid Technical Specs 2024; ultimatespecs |
| VW ID.3 Pro Performance | 150 kW, 310 Nm | 1805 kg EU | 7,3 s | 160 | 62/58 kWh | PMSM hinten, 11,5 **[S]** | ADAC-Autokatalog |
| VW ID.4 GTX | 220 kW, 460 Nm | 2239 kg EU | 6,3 s | 180 | 82/77 kWh | ASM vorn 80 kW + PMSM hinten 150 kW | ADAC-Autokatalog |

\* mit 1-ft-Rollout gemessen (US-Dragstrip-Konvention: Die Uhr startet erst nach 0,3 m). Der Test rechnet die
Zeit des Modells ebenfalls mit Rollout.

cW-Werte: Tesla S 0,208, X 0,24, Y 0,23 (Tesla), Lucid Air 0,197 (Lucid; Sapphire mit Abtrieb ≈ 0,21 **[S]**),
ID.3 0,267 (VW), ID.4 0,28 (VW; GTX ≈ 0,29 **[S]**). Stirnflächen aus Breite × Höhe × ≈ 0,82 **[S]**.

Vmax ist bei allen Autos elektronisch begrenzt (Motorhöchstdrehzahl und Software), deshalb trifft das Modell sie.

### 5.3 Ergebnisse und Ausreißer

Siehe `tests/core/ev-library.test.ts`. Ehrlich dokumentierte Ausreißer:

- **Model S Plaid** und **Lucid Air Sapphire** sind auf trockenem Asphalt mit dem UHP-Reifen des Modells
  (μ = 1,15, Bremswert) **haftungsbegrenzt**: ≈ 2,55 s (mit Rollout) statt 2,1 / 2,0 s. Die Werkszeiten entstehen auf
  präpariertem Belag mit warmen Pilot Sport 4S (μ ≈ 1,3); mit Haftungsfaktor 1,15 (μ ≈ 1,32) liegt das Modell bei
  ≈ 2,25 / 2,2 s, also innerhalb ±12 %.
- **VW ID.3 / ID.4 GTX** sind im Modell ≈ 8 … 10 % schneller als die Werksangabe. VW gibt die Zeit konservativ an;
  die Physik (150 kW, 310 Nm, 11,5:1, 1805 kg) ergibt ≈ 6,6 s. Fachpresse-Messungen liegen meist zwischen beiden.

## 6 Tuning bis ≈ 3000 PS

Physikalische Grenzen (`ev-tuning.ts`):

- Motorgröße ×0,5 … ×3 (Leistung und Moment ∝ Baugröße), Antriebseinheit ≈ 0,4 kg/kW **[S]** (≈ 2,5 kW/kg inkl.
  Wechselrichter und Getriebe).
- Wechselrichterstrom ×0,5 … ×2, Sättigung I^0,75 (§2.2), höchstens 2500 A je Wechselrichter **[S]**.
- Akku 30 … 200 kWh (≈ 160 Wh/kg), C-Rate 1 … 15 (Hochleistungszellen), 400- oder 800-V-Klasse.
- Der gesamte Akkustrom ist durch Hochvolt-Schütze, Sicherung und Stromschienen auf ≈ 3000 A begrenzt **[S]**. Bei
  400 V sind damit ≈ 1,1 MW möglich; erst 800 V bringt ≈ 2 MW (≈ 2800 … 3000 PS).
- Darüber entscheidet die Haftung: 2000 kW auf 2,5 t sind bei μ = 1,15 nur oberhalb ≈ 250 km/h nutzbar.
