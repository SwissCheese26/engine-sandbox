# Hybridantrieb (Issue #157)

Verbrenner plus E-Motor(en) plus Akku. Umgesetzt in `src/core/hybrid.ts` (HybridSimulator), Daten in
`src/data/hybrid-library.ts`, Bausätze (48 V, Range Extender) in `src/data/drive-swap.ts`. Der Verbrenner ist der
normale `EngineSimulator` (Bibliotheksmotor des Autos, auf der Werkbank tunebar), Motoren, Akku, Rekuperation und
Reifen sind die des `EvSimulator` (electric.md). Werte mit [S] sind Schätzungen.

## 1 Topologien

| Typ | Beispiel | Kopplung im Modell |
|---|---|---|
| P2 parallel | BMW 330e, VW Golf GTE, Porsche 918, Ferrari SF90 | Motor 0 zwischen Trennkupplung K0 und Getriebe: dreht mit der Getriebeeingangswelle, sieht jede Gangübersetzung. Weitere Motoren sind E-Achsen mit fester Untersetzung. |
| Leistungsverzweigt | Toyota THS (Prius, Yaris) | Planetensatz: Verbrenner am Planetenträger, MG1 an der Sonne, Hohlrad (mit MG2) zu den Rädern. Motordrehzahl frei wählbar (eCVT). |
| Seriell / Range Extender | BMW i3 REx | Verbrenner treibt nur einen Generator, gefahren wird elektrisch. |
| Mild 48 V | Riemen-Startergenerator (BSG, P0) | BSG am Riementrieb der Kurbelwelle (Übersetzung ≈ 2,8), kein elektrisches Fahren, Boost, Rekuperation, Start-Stopp. |

Quellen: Guzzella & Sciarretta, *Vehicle Propulsion Systems*, 3. Aufl., Springer 2013, Kap. 4 (Topologien,
Leistungsverzweigung); Toyota, *Prius 2016 Technical Overview* (THS II, P610); Bosch, *Kraftfahrtechnisches
Taschenbuch*, 29. Aufl., Kap. „Hybridantriebe“ (P0–P4, 48-V-Systeme).

## 2 Kopplung des Verbrenners

Der Verbrenner läuft auf seiner eigenen Welle im Prüfstandsmodus „Drehzahl halten“: die Last ist das Getriebe, das
Hohlrad oder der Generator. Sein Moment geht auf die Referenzwelle des EvSimulator (`link.refNm`), Generatorleistung
auf dessen Gleichspannungsbus (`link.dcKw`).

### 2.1 P2 und Mild

- Kupplung geschlossen: Kurbelwelle = Getriebeeingang, n_Motor = v/r · i_Gang · i_Achse (· Riemen beim Mildhybrid).
  `EngineSimulator.syncRpm` setzt die Drehzahl, das Moment ist das des Motors bei dieser Drehzahl.
- Anfahren: Unter n_Anfahr = Leerlauf + 400 + 1600 · Pedal (höchstens 55 % des Begrenzers) schleift die Kupplung, das
  Motormoment geht voll durch (DCT/Wandler-Anfahrt, Leistung wird in der Kupplung Wärme).
- Gangwahl [S]: Vollgas → niedrigster Gang unter 93 % des Begrenzers, Sport → höchster Gang über 3000 1/min, sonst
  höchster Gang über 1500 1/min; höchstens alle 0,4 s, Schaltung ohne Zugkraftunterbrechung (Vereinfachung). Über dem
  Begrenzer im höchsten Gang schneidet der Motor ab, das begrenzt Vmax.
- Der P2-Motor bekommt dieselbe Übersetzung (`EvSimulator.setMotorRatio`), er läuft also durch die Gänge.

### 2.2 Leistungsverzweigung (THS)

Planetensatz mit Standübersetzung ρ = z_Sonne/z_Hohlrad = 30/78: Am Hohlrad liegt der Anteil ρ/(1+ρ)… genauer
z_H/(z_H+z_S) = 78/108 = 0,72 des Motormoments (Guzzella & Sciarretta §4.4.3). Im Modell:

- T_Rad,mech = 0,72 · T_Motor · i_Hohlrad→Rad, die mechanische Leistung P_mech = T_Rad,mech · ω_Rad.
- Der Rest P_Motor − P_mech fließt über MG1 (η = 0,9 Generator + Umrichter) auf den Bus und von dort zu MG2 oder in den
  Akku; ist P_mech größer (Overdrive), treibt MG1 und zieht Leistung vom Bus.
- MG2 liefert, was der Fahrer über den mechanischen Teil hinaus will; sein Strom ist durch Akku + MG1 begrenzt.
- Betriebslinie [S]: n = 1000 + (n_Pmax − 1000) · √(P/P_max) (Bestverbrauchslinie eines Atkinson-Motors, Toyota
  THS-Kennfeld qualitativ), mindestens Leerlauf + 300.
- Was weder Rad noch MG2 aufnehmen kann, muss in den Akku passen: P_Motor ≤ F·v/0,85 + Ladeleistung. Im Stand geht
  daher alle Motorleistung über MG1 in den Akku (Laden im Stand), wie beim echten THS.
- Vereinfacht: Drehzahlgrenzen von MG1 und Planetensatz, Wirkungsgradkennfelder von MG1/MG2 einzeln.

### 2.3 Seriell

Generatorleistung P_el = η_Gen · P_Motor mit η_Gen = 0,9 [S, i3 REx: 28 kW elektrisch aus 0,65 l]. Betriebspunkt
80 % der Drehzahl der Maximalleistung, Leistung `generatorKw` (Bausatz: 80 % der Motorleistung, höchstens 100 kW).

## 3 Betriebsstrategie

Regelbasierte Näherung der ECMS (Equivalent Consumption Minimization Strategy: Paganelli et al., „Equivalent
consumption minimization strategy for parallel hybrid powertrains“, IEEE VTC 2002; Sciarretta & Guzzella, „Control of
hybrid electric vehicles“, IEEE Control Systems Magazine 27(2), 2007). Die ECMS wählt in jedem Augenblick die
Aufteilung mit dem kleinsten Kraftstoff + s · Akkuenergie; die Regeln bilden ihr typisches Ergebnis nach:

1. **Elektrisch fahren** (§3.1): Fahrerleistung unter der EV-Schwelle und Tempo unter der EV-Grenze → Motor aus.
   Vollhybrid: 35 % der akkubegrenzten Motorleistung, 85 % von `evMaxKmh` [S]; Plug-in mit Ladung und Modus EV:
   95 % der Motorleistung bis `evMaxKmh` (Herstellerangabe).
2. **Boost** (§3.2): Bei Vollgas läuft der Motor voll, der E-Motor gibt dazu, was der Fahrer darüber hinaus will.
3. **Lastpunktverschiebung** (§3.3): Läuft der Motor, liefert er Fahrerleistung + Ladeleistung, Ladeleistung =
   20 % (Modus Laden 40 %) der Maximalleistung bei 0,1 SoC unter dem Ziel, linear; mindestens 18 % Last, solange der
   Akku Platz hat (darunter ist der Wirkungsgrad schlecht). Begrenzt auf 80 % der Ladegrenze des Akkus.
4. **Rekuperation zuerst** (§3.4): Lupfen und Bremsen laufen über die Motoren (electric.md §4.2, bis 0,3 g), die
   Reibbremse nimmt den Rest und alles, was der Akku nicht aufnimmt. P2: K0 öffnet, der Verbrenner schleppt nicht.
5. **Start/Stopp** (§3.5): Der Motor wird vom E-Motor angeworfen (Starterpfad des Simulators, Zündung bei ≈ 400
   1/min), bis er läuft fährt der E-Motor allein – das ist die Startverzögerung (≈ 0,1–0,5 s). Mindestlaufzeit 3 s
   gegen Pendeln [S], Abschalten erst unter 70 % der EV-Schwelle. Im Stand aus (außer Modus Laden/Sport oder Akku leer).
6. **SoC-Fenster** (§3.6): Vollhybrid 40–80 % (Ziel Mitte), Plug-in 12–95 % (ladungsentleerend bis unten, dann
   ladungserhaltend 5 % darüber), Modus Laden bis oben, Sport Mitte + 10 %. Unter dem Fenster kein Antrieb aus dem Akku,
   oben keine Ladung mehr (auch keine Rekuperation).

Modi (Bedienleiste, Platz der E-Fahrmodi): Hybrid, EV, Sport (Motor läuft immer), Laden. Mildhybrid: Hybrid, Sport;
Range Extender: Hybrid, EV, Laden.

## 4 Bausätze

### 4.3 48-V-Mildhybrid

BSG 15 kW / 50 Nm, Riemen 2,8:1 (Bosch BRM, Continental 48 V Eco Drive: 10–15 kW Boost [S]); Akku 48 V, 13 Zellen
× 20 Ah ≈ 0,96 kWh, 9 kg [S]. Der eigene Motor des Fahrzeugs mit seinem Getriebe.

### 4.4 Range Extender

E-Antrieb der Klasse BMW i3 94 Ah: 125 kW / 250 Nm, 11 400 1/min, 9,665:1, 33 kWh, 352 V (BMW Pressemappe i3 2016);
der eigene Motor des Fahrzeugs als Generator, 9 l Tank (i3 REx), Start bei 7 % SoC.

## 5 Bibliothek

### 5.1 Motoren

Atkinson-Motoren (Toyota): Das späte Schließen des Einlasses schiebt ≈ 25 % der Ladung zurück, das Luftpfadmodell kennt
das nicht. Die Steuergeräte-Momentengrenze (`ecuTorqueLimitNm` = Datenblattmoment) steht dafür; die hohe geometrische
Verdichtung (13–14) bleibt für den Wirkungsgrad. Turbomotoren: Lader und Ladedruck auf die Nennleistung gepasst [S].

### 5.2 Ergebnisse (Modus Sport, Vollgas, ASR an; Test `tests/core/hybrid-library.test.ts`, Band ±12 %)

| Auto | 0–100 Modell / Werk | Vmax Modell / Werk | Systemleistung Spitze / Werk |
|---|---|---|---|
| Toyota Prius 4 | 11,3 / 10,6 s | 181 / 180 km/h (abgeregelt) | 82 / 90 kW |
| Toyota Prius 5 Plug-in | 6,9 / 6,8 s | 178 / 177 km/h (abgeregelt) | 162 / 164 kW |
| Toyota Yaris Hybrid | 9,1 / 9,7 s | 176 / 175 km/h (abgeregelt) | 83 / 85 kW |
| BMW 330e | 5,5 / 5,9 s | 231 / 230 km/h | 211 / 215 kW |
| VW Golf GTE | 6,5 / 6,7 s | 225 / 225 km/h (abgeregelt) | 187 / 180 kW |
| Porsche 918 Spyder | 2,7 / 2,6 s | 349 / 345 km/h | 614 / 652 kW |
| Ferrari SF90 Stradale | 2,8 / 2,5 s | 339 / 340 km/h | 711 / 735 kW |

**Ausreißer SF90 (+12 %):** Traktion. 1000 PS auf Straßenreifen (μ 1,15 im Modell) gegen die Werksmessung auf
präparierter Fläche; mit Griffbeiwert 1,15-fach (μ ≈ 1,32) 2,4 s (−5 %). Gleiche Begründung wie Model S Plaid und
Lucid Sapphire (electric.md §5.3). Cw·A von 918 und SF90 sind auf die Werks-Vmax gepasst [S] (Hochabtriebsstellung).

## 6 Verbrauch Stadt gegen Autobahn

Test: Prius 4, Stadtzyklus (0–30–50–0 km/h, 15 s Stand, 8 Runden, 5,3 km) gegen 120 km/h konstant. Der Kraftstoff wird
um die Akkuänderung korrigiert (1 kWh ≙ 1/(0,3 · 8,9 kWh/l) l). Ergebnis: Stadt 4,2 l/100 km (Motor 16 % der Zeit an),
120 km/h 6,7 l/100 km. WLTP 4,4 l/100 km; ADAC-Autotest Prius 4: Innerorts ≈ 3,7, Autobahn ≈ 5,7 l/100 km. Die Stadt
ist im Modell wie in echt deutlich sparsamer (elektrisches Kriechen, Motor aus im Stand, Rekuperation). Das Modell liegt
auf der Autobahn ≈ 1 l zu hoch: Der Teillast-Wirkungsgrad des Atkinson-Motors (Bestwert ≈ 40 %) fehlt dem
Verbrennungsmodell (§5.1), es rechnet bei 20 kW ≈ 290 g/kWh statt ≈ 240 g/kWh.

## 7 Grenzen

- Schaltvorgänge ohne Zugkraftunterbrechung, keine Wandlerverluste beim 330e.
- MG1-Drehzahlgrenzen des THS nicht modelliert.
- Eigene Fahrzeuge aus dem Assistenten bekommen noch keinen Hybridantrieb (nur Bibliotheksfahrzeuge über „Antrieb“).
