# Nutzfahrzeuge: Lkw und Busse (Issue #31)

> Kennzeichnung wie in `vehicle.md`: **[B]** = belegt (Quelle unten), **[S]** = Schätzung/Fachwissen, für Spielzwecke kalibriert.

## 1 Fahrzeuge

| Größe | Sattelzug (Actros 1845 LS + Auflieger) | Stadtbus (Citaro 12 m) |
|---|---|---|
| Masse leer inkl. Fahrer | ≈ 15 t (Zugmaschine ≈ 8 t, Auflieger ≈ 7 t) [S] | ≈ 11,6 t [S] |
| zulässige Gesamtmasse | 40 t (RL 96/53/EG) [B] | 19 t [S, Prospekt] |
| cW · A | 0,55 · 10,5 m² ≈ 5,8 m² (Literatur 5 … 6 m²) [S] | 0,65 · 7,5 m² ≈ 4,9 m² [S] |
| Reifen | 315/70 R22.5, Index M | 275/70 R22.5 |
| Getriebe | PowerShift 3, 12 Gänge 14,93 … 1,00, Achse 2,533 [B] | ZF EcoLife 6 Gänge 3,36 … 0,62, Achse 4,78 [S] |
| Vmax-Begrenzer | 85 km/h (EU-Pflicht ≤ 90 km/h, RL 92/6/EWG) [B] | 100 km/h (EU, Linienverkehr oft 80) [B] |
| Tank | 590 l [S] | 260 l [S] |

Modell: Die Beladung verschiebt nur die Masse zwischen leer und voll (`Drivetrain.setLoad`, 0 … 1). Schwerpunkthöhe und
Achslastverteilung bleiben fest (1,4 m, 30 % auf der Antriebsachse bei 40 t) [S]. Das Modell kennt nur zwei Achsen;
der „Vorderachsanteil“ ist beim Sattelzug der Anteil, der **nicht** auf der Antriebsachse liegt.

Plausibilität Steigung: Beharrungsgeschwindigkeit `v ≈ P·η / (m·g·(sin α + f_R))`. Mit 330 kW, η 0,9, 40 t, 4 % und
f_R 0,006 ergibt das ≈ 16 m/s ≈ 58 km/h. Das Modell erreicht ≈ 52 km/h, leer ≈ 85 km/h (Begrenzer).

Das AMT verwendet die Schaltlogik von `"dsg"` mit 0,5 s Schaltzeit. Die echte Zugkraftunterbrechung beim Schalten wird
nicht modelliert. Die Schaltpunkte liegen bei Volllast unter der Abregelrampe (Grenze − 150 1/min), damit Motoren mit
≈ 2000 1/min Begrenzer auch am Berg hochschalten.

## 2 Motoren

| Motor | Bohrung × Hub | Hubraum | Leistung | Drehmoment | Quelle |
|---|---|---|---|---|---|
| Mercedes OM 471 (2. Gen.) | 132 × 156 mm | 12,8 l R6 | 330 kW @ 1800 | 2200 Nm @ 1100 | kfz-tech.de [B]; MB Powertrain Truck VI 2021 [B] |
| Scania DC16 118 | 130 × 154 mm | 16,4 l V8 | 479 kW @ 1900 | 3300 Nm @ 950–1350 | Scania-Motorenübersicht Euro 6 2017 [B] |
| Mercedes OM 936 | 110 × 135 mm [S] | 7,7 l R6 | 220 kW @ 1800 | 1200 Nm @ 1200–1600 | MB Powertrain Bus VI 2021 [B] |

Modellannahmen:
- **Leistungsstufen**: Nfz-Motoren werden mit gleicher Hardware in mehreren Stufen verkauft (OM 471: 310 … 375 kW,
  2100 … 2500 Nm). Das bildet `ecuPowerLimitKw` ab: Oberhalb des Plateaus hält die ECU `T = P/ω`, zusammen mit
  `ecuTorqueLimitNm` als Minimum (`cycle.ts torqueLimitAt`).
- **Spitzendruck**: Nfz-Diesel mit Stahlkolben, Einzelzylinderköpfen und 4–6 Kopfschrauben pro Zylinder erreichen
  ≈ 200 … 250 bar [S]. Die Bohrungskorrektur aus `diesel.md` §4.2 endet für Stahlkolben deshalb bei 100 mm.
- **Lader**: Die realen Lader (OM 471 asymmetrisch mit Wastegate, DC16 fest) sind im Modell als VTG eingetragen. Sonst
  baut das Modell unter 1400 1/min kaum Ladedruck auf. Es ist ein Ersatz, kein Datenblattwert [S].
- ε, Pleuel, Laderad und Kühler sind geschätzt [S].

## 3 Motorbremse (Dauerbremse)

- **Auspuffklappe** (`exhaust-flap`): Die Klappe staut das Abgas, und der Kolben schiebt beim Ausstoßen gegen den
  Gegendruck. Die Bremsleistung wächst etwa mit n², das Bremsmoment etwa linear mit n.
- **Dekompressionsbremse** (`decompression`, Mercedes High Performance Engine Brake, Jacobs): Ein zusätzlicher
  Ventilhub nahe dem oberen Totpunkt lässt die verdichtete Ladung ab, sodass die Kompressionsarbeit verloren geht. Das
  Bremsmoment steigt schon bei niedriger Drehzahl stark an. Im Modell ist das ein Sockel von 35 % plus ein linearer
  Anteil.
- Größenordnung: Mercedes nennt für die schwere Baureihe „bis 480 kW“ und für die mittlere „bis 300 kW“ [B]. Scania
  nennt für den DC16 eine Auspuffbremse mit 297/320 kW @ 2400 1/min [B]. Im Spiel gilt OM 471 400 kW @ 2000, DC16
  320 kW @ 2400, OM 936 235 kW @ 2100 [S].
- Aktiv bei Pedal < 1 % und Zündung an. Eingeblendet wird zwischen Leerlauf + 200 und Leerlauf + 400 1/min, die
  echten Systeme schalten bei ≈ 900–1000 1/min ab. `EngineState.engineBrakeActive` meldet den Zustand.
- AMT-Bremsschaltung: Rollt der Lkw bergab im Schub schneller, schaltet das Getriebe zurück, damit die Motorbremse nahe
  der Nenndrehzahl arbeitet. Mit Motorbremse hält der beladene 40-t-Zug im Modell auf 4 % Gefälle ≈ 80 km/h, ohne
  Motorbremse rollt er auf > 100 km/h.
- Nicht modelliert: Retarder (hydrodynamisch, bis ≈ 600 kW), Bremsstufen am Lenkstockhebel, Bremstempomat.

## 4 Reifen

`truck`: μ trocken 0,8, nass 0,5. Nfz-Bremsungen erreichen ≈ 0,6–0,8 g [S]. Der Rollwiderstand ist 0,006, denn die
EU-Reifenkennzeichnung C3 Klasse A–C liegt bei ≈ 4–6,5 kg/t [B, VO (EU) 2020/740]. Bei 8,5 bar Fülldruck liegt die
Aquaplaning-Grenze nach Horne höher, im Modell bei 130 km/h vor der Breitenkorrektur [S].

## 5 Druckluftbremse (#83)

- **Kompressor**: einzylindrig, ≈ 360 cm³ Hubraum, über Zahnräder mit Motordrehzahl angetrieben (Übersetzung ≈ 1),
  Liefergrad ≈ 0,65 [S]. Gefördert wird freie Luft Q = V_h·n·η_L; isotherm in den Vorratsbehälter (≈ 80 l, alle
  Kreise zusammengefasst) steigt der Druck mit dp/dt = p_atm·Q / V_Beh [S]. Bei 1500 1/min dauert 0 → 10 bar
  ≈ 2,3 min. UN ECE R13, Anhang 7, verlangt bei Nenndrehzahl das Füllen in einigen Minuten (dort 3 min bis zum
  Teilwert, 6 min bis zum Solldruck) [B13].
- **Druckregler (Unloader)**: Abschaltdruck 10 bar, Einschaltdruck 8,5 bar. Dazwischen läuft der Kompressor leer [S].
- **Verbrauch je Bremsung**: Ein voller Bremsdruck von ≈ 6,5 bar füllt Bremszylinder mit zusammen ≈ 6 l. Der
  Behälter verliert dabei Δp = V_Zyl·p_Brems / V_Beh ≈ 0,5 bar. Teilbremsungen verbrauchen anteilig, Lösen entlüftet
  ins Freie. Nach 8 Vollbremsungen ohne Nachfüllen bleiben ≈ 6 bar. Das passt zur Forderung von R13 Anhang 7, dass
  nach 8 Vollbetätigungen noch die Hilfsbremswirkung erreichbar ist [B13]. Liegt im Behälter weniger als der
  Bremsdruck an, sinkt die Betriebsbremswirkung mit p_Beh / 6,5 bar.
- **Warnung** unter 5,5 bar (rote Leuchte; R13 fordert eine Warneinrichtung bei Energiemangel, den Schwellwert legt der Hersteller fest) [B13, S].
- **Federspeicher**: Sie lösen nur mit Luftdruck. Unter ≈ 4,5 bar beginnen sie zu bremsen, bei ≤ 1 bar wirken sie voll.
  Voll gilt die Feststellbremsleistung von R13 (beladen auf 18 % Steigung halten), im Modell also 0,18 g [B13, S].

## 6 Retarder (#83)

- Hydrodynamischer **Sekundärretarder** am Getriebeausgang (ZF Intarder, Voith VR). Nach dem Föttinger-
  Ähnlichkeitsgesetz gilt T = λ·ρ·ω²·D⁵, das Bremsmoment wächst also mit dem Quadrat der Gelenkwellendrehzahl [B14].
  Begrenzt wird es durch das Höchstmoment (Füllung) und die Bremsleistung, die das Kühlsystem abführen kann [B14].
- Im Modell: T_max = 3500 Nm, P_max = 600 kW (Größenordnung der Herstellerangaben, vgl. §3: „bis ≈ 600 kW“),
  volles Moment ab 1000 1/min an der Gelenkwelle (bei 2,53 Achse und 0,49 m Rad ≈ 72 km/h) [S].
- **Stufen** 0–5 am Lenkstockhebel. Stufe i gibt i/5 des Höchstmoments frei [S]. Unter ≈ 10 km/h bremst der Retarder
  praktisch nicht mehr, deshalb braucht es zum Anhalten die Betriebsbremse.
- Die Kraft am Rad ist F = T·i_Achse·η / r_dyn. Sie wirkt wie eine zusätzliche Bremse auf das Fahrzeug, begrenzt durch
  den Reibwert. Nicht modelliert: Aufheizen des Kühlmittels, Abregeln bei heißem Motor.

## 7 AdBlue (SCR, #83)

- Harnstofflösung AUS 32 (ISO 22241). Der Bedarf liegt bei ≈ 3–6 % des Dieselverbrauchs, im Modell 5 % [B15].
  Dosiert wird erst ab ≈ 200 °C Abgastemperatur (Hydrolyse, Anspringen des SCR-Katalysators) [B15].
- Tank: Pkw 15 l, Lkw 75 l, Bus 40 l [S]. Leuchte ab 10 % Rest [S].
- **Leer**: Schwere Nutzfahrzeuge reduzieren nach VO (EU) 582/2011, Anhang XIII, das Drehmoment um 25 %
  (Low-Level-Inducement) [B16]. Im Modell wird das Fahrpedal auf 75 % begrenzt, das ist ein Ersatz für die
  Momentenbegrenzung [S]. Pkw verhindern nach VO (EU) 2017/1151 den Neustart. Das ist nicht modelliert, auch dort
  gilt die Pedalgrenze. Beim Tanken wird AdBlue mit aufgefüllt.

## 8 Bordnetz (#83)

- Blei-Säure-Batterie: Ruhespannung der vollen Batterie ≈ 12,6 V (6 Zellen × 2,1 V), Lkw und Bus 24 V (zwei in
  Reihe, 25,2 V) [B17]. Beim Anlassen bricht sie unter dem Starterstrom auf ≈ 10,5 V (21 V) ein [B17].
- Läuft der Motor, regelt der Generatorregler auf ≈ 14,2 V (28,4 V) [B17]. Der Generator gibt erst ab ≈ 1500 1/min
  Generatordrehzahl Strom ab, bei einer Riemenübersetzung von ≈ 3 also ab ≈ 500 1/min Motordrehzahl [B17, S].
  Zeitkonstante der Anzeige ≈ 0,3 s [S].

## Quellen

- kfz-tech.de: „Mercedes OM 471 Euro 6 (2014)“, https://www.kfz-tech.de/Engl/Hersteller/Mercedes/MercedesOM471Euro62014.htm
- Mercedes-Benz Powertrain, Truck Euro VI 2021 (Broschüre), https://www.mercedes-benz.com/content/dam/brandhub/vehicles/aggregates/brochures/MB_Powertrain_Truck_VI_2021.pdf
- Mercedes-Benz Powertrain, Bus Euro VI 2021 (Broschüre), https://www.mercedes-benz.com/content/dam/brandhub/vehicles/aggregates/brochures/MB_Powertrain_Bus_VI_2021.pdf
- Scania: Motorenübersicht der neuen Lkw-Generation (2017), https://www.cadenadesuministro.es/wp-content/uploads/2017/09/Gama-y-datos-tecnicos-de-motores-Scania-disponible-para-la-nueva-generacion-de-camiones.pdf
- Richtlinie 96/53/EG (Maße und Gewichte), Richtlinie 92/6/EWG (Geschwindigkeitsbegrenzer), Verordnung (EU) 2020/740 (Reifenkennzeichnung)
- Hoepke/Breuer: Nutzfahrzeugtechnik, Kap. Dauerbremsen (allgemeine Kennlinien) [S]
- [B13] UN ECE Regelung Nr. 13 (Bremsen von Fahrzeugen der Klassen M, N, O), insbesondere Anhang 4 (Bremsprüfungen, Feststellbremse 18 %) und Anhang 7 (Energiequellen und -speicher, Füllzeiten, 8 Vollbetätigungen), https://unece.org/transport/vehicle-regulations-wp29/standards/addenda-1958-agreement-regulations-1-20
- [B14] Hoepke/Breuer: Nutzfahrzeugtechnik, Kap. Dauerbremsen (Retarder-Kennlinien); Föttinger-Ähnlichkeitsgesetz z. B. in Voith Turbo: Hydrodynamik in der Antriebstechnik (Vogel, 1987)
- [B15] Bosch: Kraftfahrtechnisches Taschenbuch, Kap. Abgasnachbehandlung Dieselmotor (SCR, Denoxtronic); ISO 22241-1 (AUS 32)
- [B16] Verordnung (EU) Nr. 582/2011 (Euro VI schwere Nfz), Anhang XIII (Fahreraufforderungssystem); Verordnung (EU) 2017/1151, Anhang XVI (Pkw)
- [B17] Bosch: Kraftfahrtechnisches Taschenbuch, Kap. Starterbatterien und Generatoren; DIN EN 50342-1
