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
- **Bremsen mit Vollgas (Festbremsdrehzahl, #104):** Bei der Wandlerautomatik wirkt die Betriebsbremse im Stand auch auf die Antriebsräder (Handschalter, DSG und E-Antrieb unverändert). Ihre Kraft bei vollem Pedal (1,6 g · m · g) teilt sich nach der statischen Achslast auf die Achsen auf [B22, S]. Die Antriebsräder stehen, solange die Antriebskraft am Rad unter ihrer Bremskraft plus μ · N der Antriebsachse liegt. Dann steht die Turbine, und der Motor läuft auf der Festbremsdrehzahl, bei der sein Moment gleich dem Pumpenmoment (n / K)² ist. Allrad (Prado 120) hält so bei Vollgas, ≈ 2000 1/min. Bei starken Hecktrieblern (530d, E 220 d) übersteigt das Radmoment beim Festbremsen (≈ 9,4–9,8 kNm) die Hinterachsbremse (≈ 4 kNm) plus Reifen (≈ 2,5 kNm). Ohne Eingriff würden die Hinterräder gegen die Bremse durchdrehen (Brake-Stand). Echte Motor- und Getriebesteuerungen begrenzen deshalb das Motormoment, wenn Bremse und Gas im Stand zusammen getreten werden. Das schützt Wandler und Antriebsstrang (Beispiel, nicht verifiziert: GM-Patent US 11,390,281 B2) [B23, nicht verifiziert]. Im Modell (`VehicleCoupling.torqueLimitNm`, #119) gilt das nur für die Wandlerautomatik in D, mit Bremse (ab 3 % Pedal eingeblendet, voll ab 8 %), bei v ≈ 0 und mit Gas. Die Grenze liegt bei 90 % des Moments, das die gebremsten Antriebsräder halten. Die Kalibrierung ist geschätzt [S]. Die Räder stehen dann, und die Festbremsdrehzahl sinkt auf n = K · √T_Grenze (530d ≈ 1830, E 220 d ≈ 1800 1/min). Der Allrad hält die volle Festbremsdrehzahl ohne Eingriff. Werkstätten prüfen die Festbremsdrehzahl deshalb mit Fest- und Betriebsbremse und höchstens ≈ 5 s lang (Toyota-Reparaturhandbuch „Stall Test“) [S].

## 5. Gangabstufung (#14)

Die Gänge lassen sich aus der Übersetzung des 1. und des höchsten Gangs berechnen [B6, B9]. Nach Jante gilt i_j = i_n · φ₁^(n−j) · φ₂^((n−j)(n−j−1)/2).

- **geometrisch:** φ₂ = 1, also ein konstanter Stufensprung φ₁ = (i₁/i_n)^(1/(n−1)). Üblich bei Nfz-Getrieben.
- **progressiv:** φ₂ ≈ 1,05–1,15 (im Spiel 1,1), große Sprünge unten und kleine oben. Üblich bei Pkw, weil die Zugkraftlücken im Zugkraftdiagramm bei hohem Tempo kleiner werden sollen.
- **Gangzahl:** 4–10, Lkw-AMT bis 12. Die Übersetzungen müssen positiv und streng fallend sein (`validateRatios`).

## 6. Zugkraftdiagramm (#14)

- **Zugkraft am Rad** je Gang: F = T_Volllast(n) · i_Gang · i_Achse · η / r_dyn bei v = n · 2π · r_dyn / (60 · i_Gang · i_Achse) [B9, B5]. Die Kurven aller Gänge bilden die „Zugkrafthyperbel“.
- **Wandlerautomatik:** Im 1. Gang zeigt das Diagramm unterhalb des Kupplungspunkts den Wandlerbereich. Der Motor läuft dort, wo sein Volllastmoment gleich dem Pumpenmoment λ(ν)·(n/K)² ist, und am Rad wirkt μ(ν)·T_P (§4). Für die höheren Gänge bleibt die Wandlung weg: Dort ist die Überbrückungskupplung geschlossen bzw. ν liegt über dem Kupplungspunkt. Hinter dem Wandlerbereich gilt die normale Volllastkurve.
- **Fahrwiderstand:** F_W = m·g·(f_R·cos θ + sin θ) + ½·ρ·c_W·A·v² [B5].
- **Vmax** ist der höchste Schnittpunkt von Zugkraft und Fahrwiderstand über alle Gänge, oder die Geschwindigkeit am Drehzahlbegrenzer, wenn die Zugkraft dort noch über dem Widerstand liegt.
- **Bewertung** [B9, S]:
  - *zu kurz übersetzt:* Im höchsten Gang ist der Begrenzer erreicht, solange noch Zugkraftüberschuss besteht.
  - *zu lang übersetzt:* Der Schnittpunkt liegt im höchsten Gang unter ≈ 90 % der Nenndrehzahl, oder ein niedrigerer Gang ist schneller.
  - *auf Vmax ausgelegt:* Der Schnittpunkt liegt nahe der Nenndrehzahl, also bei maximaler Leistung.

## 7. Feststellbremse und Auto-Hold (#91)
- **Warum das Auto rollte:** Im Stand hält nur der Rollwiderstand (f_R ≈ 1,2 %). Bergab über ≈ 1,2 % und bei der kriechenden Wandlerautomatik rollt das Auto los, sobald die Bremse gelöst ist (§3). Das ist richtige Physik, es fehlte nur die Feststellbremse.
- **Haltegrenze:** Die Feststellbremse muss das beladene Fahrzeug auf 20 % Steigung und Gefälle halten [B10, B11]. Elektrische Feststellbremsen sind mit Reserve ausgelegt, im Modell 30 % [S]. Sie wirkt über die Hinterräder, also höchstens μ·N_hinten [B2].
- **Auto-Hold** [B2]: Bei laufendem Motor hält die ESP-Hydraulik das Auto über alle vier Räder (im Modell ≈ 0,5 g Haltedruck [S]), mit Motor aus übernimmt die Feststellbremse. Zusammen nie mehr als μ·m·g·cos θ. Gegen die Hydraulik kommt auch das Kriechmoment einer Wandlerautomatik in D nicht an. Der Wandler bleibt dabei im Festbremspunkt belastet, die Leerlaufregelung hält die Drehzahl.
- **Grenzen im Modell:**
  - *Bergab* rutscht das gehaltene Auto über der Haltegrenze vorwärts. Mit Motor aus liegt sie bei 30 % (−40 % rutscht, −25 % hält).
  - *Bergauf über 30 %* rollt das Auto trotzdem nicht zurück, weil die Geschwindigkeit im Modell ≥ 0 bleibt (§3, es gibt keinen Rückwärtsgang). Die Haltegrenze lässt sich deshalb nur bergab beobachten.
  - *Mit laufendem Motor* addieren sich Feststellbremse (0,29 g) und Hydraulik (0,5 g) auf ≈ 0,8 g und liegen damit über μ. Praktisch gilt dann μ·m·g·cos θ als Grenze: auf trockenem Asphalt ≈ 1 (das Auto hält auf jeder einstellbaren Steigung bis ±30 %), auf Schnee oder Eis entsprechend weniger.
- **Anziehen während der Fahrt** (P-Taste oder Auto-Hold unter 5 km/h): Die Räder blockieren erst im Stillstand. Bis dahin bremst die Feststellbremse wie eine kräftige Betriebsbremse, mit dem Bremspedal des Fahrers oder mindestens 0,25 g und höchstens 0,8·μ. Das entspricht dem dynamischen Bremsen einer EPB über die ESP-Hydraulik, ohne Blockieren [B2, S]. Unter 0,1 km/h gilt das Auto als stehend. Während der Fahrt löst Gas die Bremse nicht (keine Anfahrfreigabe über 5 km/h), nur die P-Taste.
- **Greift**, wenn v ≤ 5 km/h und kein Gas gegeben wird und zusätzlich gebremst wird, der Motor aus ist, N eingelegt ist oder das Auto schon langsamer als 1 km/h ist [S, Spielregel aus #91].
- **Löst** beim Anfahren aus dem Stand bis 5 km/h (Gas mit eingelegtem Gang bei laufendem Motor, wie die Anfahrfreigabe der EPB) oder per Hand mit der P-Taste. Die Kupplung zählt dabei nur am stehenden Auto. Nach dem Lösen per Hand greift Auto-Hold erst wieder nach einem neuen Bremstritt, nach dem Anfahren oder über 5 km/h.
- **Mit Motor aus und Gang drin** lässt der Fahrer die Kupplung erst kommen, wenn der Motor ausgelaufen ist. Sonst würde die Schwungmasse das blockierte Auto anrucken.

### Quellen zu §4–6
- [B6] Naunheimer, H.; Bertsche, B.; Lechner, G. et al.: Fahrzeuggetriebe, 2. Aufl., Springer 2007, Kap. „Anfahrelemente: Hydrodynamische Wandler“ und „Gangabstufung“.
- [B7] Robert Bosch GmbH: Kraftfahrtechnisches Taschenbuch, Kapitel „Getriebe: Drehmomentwandler, Automatikgetriebe“.
- [B8] SAE J643: Hydrodynamic Drive Test Code (K-Faktor, Wandlung, Wirkungsgrad über dem Drehzahlverhältnis).
- [B9] Haken, K.-L.: Grundlagen der Kraftfahrzeugtechnik, Hanser, Kap. „Zugkraftdiagramm, Getriebeauslegung“.
- [B10] UN ECE Regelung Nr. 13-H (Bremsen von Personenkraftwagen), Abs. 5.2.2.3: Feststellbremse hält das Fahrzeug auf 20 % Steigung bzw. Gefälle.
- [B23] US 11,390,281 B2 (GM Global Technology Operations): „Brake distribution control for combined brake and propulsion maneuvers“, mit Momentenbegrenzung zum Schutz des Antriebsstrangs. Nicht verifiziert (nur Kurzfassung gelesen).
- [B22] Breuer, B.; Bill, K. H. (Hrsg.): Bremsenhandbuch, Springer Vieweg, Kap. „Bremskraftverteilung“.
- [B11] StVZO §41 (Bremsen und Unterlegkeile); für Pkw über die Typgenehmigung nach UN ECE R13-H.

## 8. Getriebeöltemperatur (#53)
- **Wärmeeintrag:** Verlustleistung P_V = (1 − η)·P_Getriebe + P_Plansch + a·P_Schlupf [B6, B12]. P_Plansch sind die lastunabhängigen Verluste (Planschen, Lager, Dichtungen, bei Automatik und CVT die Ölpumpe), sie wachsen etwa mit n^1,5 und mit der Ölviskosität [B6, B13]. Der Schlupf ist P_Schlupf = T·Δω an Kupplung oder Wandler. Beim Wandler gilt P_Schlupf = T_P·ω_P − T_T·ω_T = T_P·ω_P·(1 − μ·ν) (§4) [B6, B8]. Anteil a im Öl: nasse Kupplungen (DSG DQ381, CVT-Anfahrkupplung, Wandler) a = 1. Bei trockenen Kupplungen (Handschalter, Lkw-AMT) geht die Wärme in Kupplung und Glocke, ins Öl gelangen nur ≈ 15 % [S].
- **Handschalter (Nachtrag, #122):** Von den ≈ 45 kg des MQ350 sind ≈ 18 kg Zahnräder und Wellen aus Stahl [S]. Sie laufen im Öl und zählen ganz zur Wärmekapazität (c ≈ 0,46 kJ/(kg·K)), vom Aluminiumgehäuse (≈ 27 kg) zählt die Hälfte. Das ergibt ≈ 24 kJ/K, praktisch derselbe Wert wie vorher: Die Erwärmung von ≈ 10 K/min unter Dauervolllast bleibt. Ohne TCU-Schutzmodus warnt das Modell beim Handschalter erst ab 130 °C, Schaden ab 150 °C [S].
- **Wärmekapazität:** m·c von Öl (ρ ≈ 0,87 kg/l, c ≈ 2,0 kJ/(kg·K)) plus der Hälfte des Gehäuses (Aluminium, c ≈ 0,9 kJ/(kg·K); die äußere Hälfte folgt dem Öl nur langsam) [S]. Füllmengen und Massen: MQ350 ≈ 2 l / 45 kg, DQ381 ≈ 5,2 l / 90 kg, ZF 8HP ≈ 8,5 l / 85 kg [B14], CVT ≈ 7 l / 80 kg, PowerShift G281-12 ≈ 13 l / 260 kg, ZF EcoLife ≈ 26 l / 350 kg [B15]. Das ergibt ≈ 24 / 49 / 52 / 48 / 140 / 200 kJ/K.
- **Kühlung:** Gehäuse an Umgebung UA = UA₀ + UA_Fahrt·(v / 25 m/s)^0,8. UA₀ ist freie Konvektion plus Strahlung (≈ 6 W/K beim Pkw), der Fahrtwind-Anteil folgt erzwungener Konvektion mit h ∝ v^0,8 [B16]. Über die Glocke ist das Getriebe an den Motor gekoppelt (≈ 4 W/K zum Kühlmittel) [S]. DSG, Automatik und CVT haben einen Öl-Wasser-Wärmetauscher am Kühlkreislauf (Pkw ≈ 120–150 W/K). Er heizt das Öl beim Warmlauf und kühlt es danach auf die Kühlmitteltemperatur herunter [B14, B17]. Lkw und Bus: Ölkühler am Kühlkreislauf (Retarder) [B15]. Der Kühler ist abschaltbar (ohne Ölkühler). **Nachrüst-Ölkühler (Luft/Öl, #100-Nachtrag):** Ein Lamellen-/Plattenkühler im Fahrtwind gibt UA_Zubehör·(v_Luft)^0,54 an die Umgebungsluft ab. Setrab ProLine STD Serie 6 mit 19 Reihen: ≈ 5 W/K je Reihe bei 3 m/s Anströmung → ≈ 95 W/K, bei 8 m/s Faktor ≈ 1,7 → ≈ 160 W/K. Daraus folgt der Exponent ln 1,7 / ln(8/3) ≈ 0,54 [B19]. Vorn eingebaut sieht der Kühler etwa ein Drittel der Fahrgeschwindigkeit als Anströmung [S], also gilt im Modell UA = 160 W/K · (v / 25 m/s)^0,54. Im Stand (ohne Lüfter) kühlt er praktisch nicht. Im Spiel wählbar: „Serie“, „Ölkühler (Zubehör)“ (zusätzlich zum Serien-Wärmetauscher) und „Aus“ (nur wo das Werk einen hat).
- **Viskosität:** Getriebeöle sind kalt deutlich zäher, bei 20 °C etwa 4–5-mal zäher als bei 80 °C, bei −10 °C über 10-mal [B13]. Im Modell gilt φ(T) = exp(0,025·(80 − T)), begrenzt auf 0,7 … 12. Die Planschverluste wachsen mit √φ. Der Wirkungsgrad sinkt kalt um Δη = 0,015·(√φ − 1), höchstens 0,05: ≈ 1,7 Punkte bei 20 °C und ≈ 3,7 Punkte bei −30 °C. Das deckt sich mit den Kaltverlusten im NEFZ/WLTP-Warmlauf von 2–5 % [B12, B13, S].
- **Typische Temperaturen:** Handschalter auf der Autobahn ≈ 80–90 °C, in der Stadt ≈ 50–70 °C [B12]. ATF im Normalbetrieb 80–95 °C, die Wärmetauscher-Thermostate regeln auf ≈ 80–90 °C [B14, B17]. ATF-Lebensdauer: Ab ≈ 100 °C halbiert sich die Öllebensdauer je +10 K (Arrhenius-Faustregel) [B17, B18]. Diese langsame Alterung zwischen 100 und 120 °C wirkt über das Ölwechselintervall (Tausende Kilometer) und wird im Modell nicht abgebildet; der Verschleiß im Spiel zählt erst ab der Warnschwelle (120 °C, siehe „Modell“) und folgt dort derselben Halbierungsregel je 10 K. Warnung bei ≈ 120 °C, Schutzmodus der Getriebesteuerung bei ≈ 130 °C (Momentenreduzierung, Notlauf), Schäden an Dichtungen, Belägen und Öl ab ≈ 150 °C [B14, B17, B18].
- **Modell:** Ein Knoten, linear-implizit integriert (stabil für jedes dt). Start bei Umgebungstemperatur. Mit „Motor warm starten“ startet das Getriebe bei 80 °C bzw. bei der Kühlmitteltemperatur, wenn diese niedriger ist [S]. Schadensmodell: Über der Warnschwelle wächst der Verschleiß mit der Rate 2^((T − 150 °C)/10 K) / 600 s. Bei 150 °C ist das Getriebe also nach ≈ 10 min hinüber, bei 130 °C nach ≈ 40 min. Die Realismusstufen gelten wie beim Motor (#66): „real“ mit Totalschaden, „nachsichtig“ nur bis knapp unter 1, „aus“ ohne Verschleiß und ohne Schutzmodus, die Warnung bleibt. Das Motorrad hat einen gemeinsamen Ölsumpf, dort ist das Getriebeöl das Motoröl.
- **Wandler-Festbremsprobe:** Beim ZF 8HP gehen 40–50 kW vollständig ins ATF. Der Gesamtvorrat erwärmt sich um ≈ 1 K/s, lokal am Wandler deutlich schneller. Deshalb begrenzen die Hersteller den Stall-Test auf ≈ 5 s [B14, B17].

### Quellen zu §8
- [B12] Naunheimer et al. [B6], Kap. „Wirkungsgrad und Verlustleistung“, „Getriebeschmierung und -kühlung“.
- [B13] SAE J306 (Automotive Gear Lubricant Viscosity Classification): Viskositätsklassen und Tieftemperatur-Grenzwerte von Getriebeölen. Dazu SAE-Papers zu Planschverlusten („spin losses“) von Getrieben bei tiefer Temperatur. Eine konkrete Paper-Nummer ist noch offen, die Zahlen hier sind als [S] markiert.
- [B14] ZF Friedrichshafen AG: 8HP Automatgetriebe, technische Daten und Service-Information zu Ölfüllmenge, ATF-Betriebstemperatur und Prüftemperatur (ATF-Stand bei 30–50 °C).
- [B15] ZF EcoLife Betriebsanleitung/Technische Daten (Ölfüllmenge, Wärmetauscher, zulässige Öltemperaturen); Mercedes-Benz PowerShift 3 (G 281-12), Datenblatt.
- [B16] VDI-Wärmeatlas, Abschnitt „Erzwungene Konvektion, umströmte Körper“ (Nu ∝ Re^0,8 turbulent).
- [B17] Aisin AW: ATF-Temperaturrichtlinien (Service Training, Stall-Test max. 5 s, ATF-Warnung ≈ 120–130 °C, Notlauf).
- [B18] Arrhenius-Faustregel für die Oxidation von Schmierstoffen: Die Öllebensdauer halbiert sich je +10 K. So steht sie in den technischen Merkblättern der Schmierstoffhersteller und bei Naunheimer et al. [B6] im Kapitel „Schmierstoffe“.
- [B19] Setrab ProLine STD, Performance-Diagramme (Serie 6): Wärmeabgabe je Reihe in W/°C über dem Öldurchsatz bei 3 m/s Luftgeschwindigkeit (≈ 5 W/°C je Reihe bei ≈ 2,5 l/min je Reihe), Korrekturfaktor für die Luftgeschwindigkeit 1–10 m/s (≈ 1,7 bei 8 m/s). https://www.s-v-c.co.uk/m/help_and_instructions/Setrab-ProLine-STD-performance-graphs.pdf

## 9. Launch Control als Sekundärbegrenzer (#38, Vertrag #101)

Echte Launch Control hält die Startdrehzahl nicht über das Gaspedal. Die Drosselklappe bleibt voll offen, und ein **zweiter Drehzahlbegrenzer** schneidet auf der Startdrehzahl Zündung und/oder Einspritzung [B19]. Turbo-Benziner mit Kupplung ziehen zusätzlich die Zündung stark auf spät (etwa 20° n. OT oder später). Die Verbrennung läuft dann in den Auslass, die Abgasenergie treibt die Turbine, und der Lader baut im Stand Ladedruck auf („Launch Anti-Lag“, ohne Lufteinblasung) [B19]. Mit Wandlerautomat schadet die Spätzündung, weil der Wandler selbst Last liefert [B19]. Deshalb gibt es im Modell keine Launch Control mit Wandler, wie schon seit #23.

Modell:
- `Drivetrain`: Launch Control ist scharf, wenn das Fahrzeug steht, die Bremse getreten ist und das Pedal über 50 % liegt (#23). Die Kupplung ist offen. Statt die Drehzahl wie bisher über das Pedal zu begrenzen (`launchCap`), sendet der Drivetrain `VehicleCoupling.launchLimitRpm` mit der Startdrehzahl (≈ 45 % des Begrenzers bei Vollgas, #22).
- `simulator.ts`: Der Begrenzer greift bei `min(revLimitRpm, launchLimitRpm)` mit derselben Schnitt-Hysterese wie der Hauptbegrenzer. Turbo-Benziner (nicht Vergaser) bekommen 35 °KW Spätzündung [S: etwa 20° n. OT gegenüber rund 15° v. OT bei Volllast]. Daraus folgen über petrol.md §3.5 (η_Zündung) und §3.10 (höhere Abgastemperatur bei Spätzündung) weniger Moment und mehr Turbinenenergie. Die Ladedruckanforderung folgt dem Pedal, die Wastegate bleibt also zu.
- Diesel: nur der Sekundärbegrenzer (Mengenabschaltung), keine Spätzündung. Wandlerautomat: keine Launch Control, mit Bremse und Gas arbeitet der Motor gegen den Wandler wie bisher.
- Nach dem Lösen der Bremse folgt der bisherige, nach Traktion dosierte Start (#37).

Ergebnisse (0–100 mit Launch Control, 3 s scharf): Golf 7 GTI baut im Stand ≈ 1,1 bar auf, Skyline R34 ≈ 0,45 bar und kommt auf 5,37 s statt 6,07 s (Fachpresse 5,0 s). Der Ferrari 458 als Sauger hat keine Vorspannung und kommt auf 3,75 s statt 4,0 s (Werk 3,4 s mit LC).

- [B19] Haltech: „How Launch Control Works“, https://support.haltech.com/portal/en/kb/articles/how-launch-control-works

## 10. Kurven und Schräglage (#83)

- Die Strecken „Flachland“, „Mittelgebirge“ und „Alpen“ bekommen neben dem Höhenprofil eine **Krümmung** κ(x) = 1/R als
  Summe von Sinuswellen mit ganzen Perioden über die Streckenlänge, also stetig und nahtlos wiederholbar. Kleinste
  Radien: Flachland ≈ 600 m, Mittelgebirge ≈ 150 m, Alpen ≈ 60 m [S]. Das liegt in der Größenordnung der
  Entwurfsradien von Landstraßen nach RAL (≈ 200–500 m) bzw. engen Passstraßen [B20, S]. Kehren werden nicht
  abgebildet. „Statisch“ und die Rampen „Berg hoch/runter“ sind gerade.
- **Schräglage** im stationären Kurvenflug, Punktmasse ohne Reifenbreite: tan φ = v²/(R·g) = v²·κ/g [B21]. Liegt
  v²·κ über μ·g, reicht der Reibwert nicht. Die Anzeige wird dann signalfarben, ein Sturz wird nicht simuliert.
  Der Fahrer bremst im Modell nicht vor Kurven, die Schräglage ist die zur gefahrenen Geschwindigkeit nötige.

### Quellen zu §10

- [B20] FGSV: Richtlinien für die Anlage von Landstraßen (RAL), Ausgabe 2012, Entwurfsklassen und Kurvenradien
- [B21] V. Cossalter: Motorcycle Dynamics, 2. Aufl. 2006, Kap. 1 (Steady turning, roll angle)

## 11. Reifen: Geschwindigkeitsindex, Überhitzung, Platzer (#144)
- **Geschwindigkeitsindex:** ECE-R 30, Anhang 7: Q 160, R 170, S 180, T 190, H 210, V 240, W 270, Y 300 km/h; „(Y)“ (ZR) über 300 km/h, Grenze vom Fahrzeughersteller [R1]. Lkw-Reifen M 130 km/h. Die Bibliotheksautos tragen den Index der Serienbereifung laut Datenblatt bzw. geschätzt [S]; der Test prüft Index ≥ Werks-Vmax.
- **Prüfung:** Der Last-/Geschwindigkeitstest nach ECE-R 30 Anhang 7 fährt den Reifen mit 80 % der Tragfähigkeit (bei V/W/Y die Tragfähigkeit bei dieser Geschwindigkeit), Prüfdruck 2,8–3,2 bar, in 10-km/h-Stufen zu je 10 min bis zur Nenngeschwindigkeit (letzte Stufe 20 min, auf der 2-m-Trommel) [R1]. Bestanden ist er ohne Laufflächen-, Lagen- oder Cordablösung. Daraus folgt: Bei Nenngeschwindigkeit und Nennlast bleibt der Reifen dauerhaft unter der Schadensgrenze, darüber gibt es keine Freigabe.
- **Wärme:** Die Rollwiderstands-Hysterese erzeugt Wärme proportional zu f_R·F_z·v; f_R steigt mit der Last, mit niedrigem Druck (Walkarbeit ∝ Einfederung, etwa p^−0,8) und mit der Geschwindigkeit [R2, R3]. Über der kritischen Geschwindigkeit bildet sich hinter dem Latsch eine stehende Welle (Stehwelle): Rollwiderstand und Wärme steigen dann sprunghaft, die Gürtelkanten überhitzen, es folgt Laufflächenablösung [R2 Kap. 7, R3]. Hersteller legen die Stehwellengrenze knapp über den Index.
- **Modell:** Ein Knoten für die heißeste Zone (Gürtelkante/Schulter) des höchstbelasteten Reifens. Beharrungswert T_ss − T_U = 75 K · L^1,2 · (p/p₀)^−0,8 · (r^1,3 + 40·max(0, r − 1)²), r = v/v_Index; Annäherung erster Ordnung mit τ = 240 s (Fahrtwind kühlt, h ∝ v^0,8; im Verhältnis zur Hysterese bleibt der Exponent 1,3) [S]. Bei Nenngeschwindigkeit ≈ 95 °C, Innentemperaturen 80–110 °C sind im Hochgeschwindigkeitstest typisch [R2]. Warnung ab 105 °C (≈ 6 % über Index). Ab 120 °C beginnt die Reversion der Gummimischung und die Haftung Gummi–Stahlcord lässt nach [R2, R4]: Schaden dD/dt = x·2^x / 300 s, x = (T − 120 °C)/10 K (Arrhenius, Verdopplung je 10 K) [S].
- **Stufen:** (a) Warnung „Reifen überhitzen“; (b) ab D = 0,25 Vibration (lokale Ablösung, Unrundheit), Grip fällt linear bis 0,7; (c) D = 1: Platzer/Laufflächenablösung. Grip der Antriebsachse dann Pkw × 0,45 (offenes Differenzial, ein Rad auf der Felge), Motorrad × 0,25, Lkw/Bus × 0,8 (Zwillingsreifen). Zusatz-Rollwiderstand des Fahrzeugs Δf = Radanteil · 0,1·(1 + (v / 25 m/s)²) (platter Reifen f ≈ 0,1 [R3], dazu schlagende Lauffläche und Felge, quadratisch mit v) [S]. Das Auto fährt weiter, Vmax bricht ein (Golf GTI: 251 → ≈ 160 km/h).
- **Zeitskala (W, 20 °C, Nennlast, vom Beharrungszustand bei 270 km/h):** +5 % nie, +8 % ≈ 35 min, +10 % ≈ 9 min, +15 % ≈ 3 min, +20 % ≈ 110 s, +25 % ≈ 70 s, +50 % ≈ 20 s. Mehr Last oder Hitze verkürzt das.
- **Realismus:** „real“ bis zum Platzer, „nachsichtig“ nur Warnung, Vibration und Gripverlust (D < 1), „aus“ ohne Schaden; die Warnung bleibt. „Reifen wechseln“ setzt alles zurück (wie Volltanken, nur im Stand).

### Quellen zu §11
- [R1] UNECE-Regelung Nr. 30 (ABl. EU L 307/2008, „Regulation No 30 … pneumatic tyres for motor vehicles“), Anhang 7 „Last-/Geschwindigkeitsprüfung“ und Anhang 6 (Geschwindigkeitssymbole). https://eur-lex.europa.eu/eli/reg/2008/30(2)/oj/eng
- [R2] Gent, A. N.; Walter, J. D. (Hrsg.): The Pneumatic Tire. NHTSA, DOT HS 810 561, 2006. Kap. 7 (Standing waves, critical speed), Kap. 12 (Rolling resistance, temperature), Kap. 14 (Tire durability, belt-edge separation).
- [R3] Bosch Kraftfahrtechnisches Taschenbuch, „Reifen: Rollwiderstand, Stehwellen, Luftdruck“; Wong, J. Y.: Theory of Ground Vehicles, Kap. 1.2 (rolling resistance vs. speed and inflation).
- [R4] NHTSA: Tire Aging/Belt-edge separation studies (Ford/Firestone-Untersuchung 2001, Engineering Analysis EA00-023): Ablösung bei hoher Innentemperatur, Unterdruck und Überlast.

## 12. Reifen: Schlupfwärme, Burnout, Verschleiß (#149)
- **Problem:** Das Modell aus §11 heizt nur über die Fahrgeschwindigkeit. Beim Burnout steht das Auto, die Antriebsräder drehen durch, und es entstand keine Wärme.
- **Reibleistung:** Gleitet der Reifen, wird im Latsch P = F_x · v_Gleit frei, mit v_Gleit = |ω·r − v| (durchdrehend) bzw. v (blockiert) [R5]. Pro Reifen: angetriebene Räder teilen sich F_x (Pkw 2, Allrad 4, Motorrad 1, Lkw/Bus 2 × Zwilling = 4). Blockierte Räder gleiten mit ≈ 0,9·μ·m·g über alle Räder. Die Wärme verteilt sich nach den Wärmeeindringzahlen e = √(λρc) zwischen Gummi (≈ 700) und Asphalt (≈ 1200), also zunächst etwa 35–40 % in den Reifen (Blok/Jaeger) [R5]. Beim stehenden Burnout heizt sich die Fahrbahnstelle dauernd auf, während die Lauffläche umläuft und abkühlt, deshalb steigt der Reifenanteil nach der ersten Sekunde. Gewählt: **60 %** (Spanne 50–70 %) [S].
- **Zwei Knoten:** Oberflächenschicht der Lauffläche und Karkasse, beide als Übertemperatur über den Modellen aus §11 bzw. tyres.ts. Wärmeleitung ist linear, deshalb überlagern sich die Anteile. Die Oberflächenschicht ist δ ≈ 1 mm dick, das entspricht der Eindringtiefe √(α·t) von Gummi in ≈ 10 s (α ≈ 1·10⁻⁷ m²/s). Fläche: Breite × Umfang. C_t = ρc·δ·b·2πr mit ρ ≈ 1150 kg/m³ und c ≈ 1,8 kJ/(kg·K) [R7], bei 245/40 R18 ≈ 1 kJ/K. τ_t ≈ 5 s. Die Hälfte der abfließenden Wärme geht in die Karkasse (C ≈ 15 kJ/K bei 225/45 R17, τ = 240 s wie §11), der Rest an Luft und Straße. Beim blockierten Rad bleibt die Wärme in einem Bogen von ≈ 0,9 m statt im ganzen Umfang (Latsch ≈ 0,12 m plus der Bogen, den das Rad beim Einbremsen bis zum Stillstand noch dreht, und Wärmeleitung). Dieser Wert ist an den Bremstests aus #22/#23 kalibriert [K]: blockiert ≈ v²/(2·0,9·μ·g) +10 %, und nass ist ABS ≥ 8 % kürzer.
- **Grip-Fenster:** Die kalte Seite bleibt unverändert (tyres.ts: coldFactor/warmC; Straßenreifen ohne Kaltabschlag, UHP ab 30 °C, Semi-Slick ab 50 °C, Slick ab 80 °C), damit die Werksstarts unverändert bleiben. Das Fenster endet bei Straßenreifen bei 120 °C, bei Semi-Slicks bei 130 °C und bei Slicks bei 140 °C. Rennmischungen sind auf höhere Oberflächentemperaturen ausgelegt [S]. Darüber sinkt der Grip um 0,4 %/K und ab 40 K über dem Fenster um weitere 0,6 %/K, weil die Oberfläche schmiert und Blasen wirft. Untergrenze ist Faktor 0,75. Ehrlich angemerkt: Für Straßenreifen nennt man oft 80–100 °C als Optimum. Das gelumpte Modell aus tyres.ts erreicht bei Vmax aber bis ≈ 80 °C, deshalb blieb die Grenze bei 120 °C.
- **Verschleiß:** Das abgeriebene Volumen ist proportional zur Reibarbeit (Grosch/Schallamach) [R6], und zwar nur, solange der Reifen gleitet. Unterhalb des μ-Maximums haftet der Latsch größtenteils (Schlupf durch Verformung). Ab 150 °C Oberfläche verdoppelt sich die Rate alle 25 K, höchstens auf das 8-Fache, weil die Mischung thermisch abbaut: Öle und Weichmacher verdampfen ab ≈ 200 °C, die Polymere zersetzen sich ab ≈ 350 °C [R8]. Durchgerieben ist die Lauffläche nach 25 MJ/m² Reibarbeit. Das ist so kalibriert, dass ein voller Burnout eines Hecktrieblers mit ≈ 300 kW den Reifen in einigen zehn Sekunden zerstört [K].
- **Stufen:** Der Verschleiß nutzt die Stufen aus §11: Ab 0,25 vibriert der Reifen und hat weniger Grip, bei 1 versagt er („real“). „Nachsichtig“ bleibt bei 0,99, dann gibt es nur Gripverlust. „Aus“ kennt keinen Verschleiß. Wärme und Temperatur-Grip wirken auf jeder Stufe. Die Warnung „Lauffläche überhitzt“ kommt ab 130 °C Oberfläche (über der Heißzone aus §11) und schaltet die Reifenlampe. Das Reifenfeld bzw. die Reifenanzeige zeigt die heißeste Zone. „Reifen wechseln“ setzt alles zurück.
- **Rauch:** Der Reifenrauch richtet sich weiter nach der Gleitgeschwindigkeit. Mit kalter Lauffläche erscheinen ≈ 40 % davon, ab ≈ 200 °C der volle Rauch [R8].
- **Zahlen (Corvette C6, 285er hinten, Radgeschwindigkeit 72 km/h im Stand, Grip-Rückkopplung):** nach 5 s ≈ 140 °C, nach 20 s ≈ 185 °C, Reifenversagen nach ≈ 70 s. BMW M3 E46: 160 °C, 220 °C, ≈ 45 s.

### Quellen zu §12
- [R5] Blok, H.: Theoretical study of temperature rise at surfaces of actual contact under oiliness lubricating conditions. Proc. General Discussion on Lubrication, IMechE, 1937; Jaeger, J. C.: Moving sources of heat and the temperature at sliding contacts. Proc. Royal Soc. N.S.W. 76 (1942). Aufteilung der Reibwärme nach Wärmeeindringzahlen und Pécletzahl.
- [R6] Grosch, K. A.; Schallamach, A.: Tyre wear at controlled slip. Wear 4 (1961), S. 356–371. Abrieb proportional zur Reibarbeit.
- [R7] Mark, J. E.; Erman, B.; Roland, C. M. (Hrsg.): The Science and Technology of Rubber, 4. Aufl., Academic Press 2013. Thermische Eigenschaften von Gummi: c ≈ 1,7–2,0 kJ/(kg·K), λ ≈ 0,2–0,3 W/(m·K), ρ ≈ 1,1–1,2 g/cm³.
- [R8] Williams, P. T.: Pyrolysis of waste tyres: A review. Waste Management 33 (2013), S. 1714–1728. TGA: Öle/Weichmacher ab ≈ 200 °C, NR/SBR-Abbau ≈ 350–450 °C.
