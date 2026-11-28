# Changelog

Alle sichtbaren Änderungen an der Prüfzelle, neueste zuerst. Aufbau nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

_Diese Datei wird erzeugt: Einträge stehen in `src/data/changelog.ts`, danach `bun scripts/changelog.ts` ausführen._

## 2026-11-28 – Jeder Antrieb in jedes Fahrzeug, gleicher Aufbau für Verbrenner und E-Auto

### Neu

- Antriebstausch: In der Fahrzeug-Platte wählst du unter „Antrieb“ jeden Motor aus der Bibliothek, deine eigenen Motoren aus dem Engine Builder oder einen Elektroantrieb (ab Werk oder wie im E-Tuner eingestellt), auch im Assistenten unter „Neues erstellen“. So fährt der Citaro mit dem Tesla-Antrieb, das Model S mit dem V8 der Corvette oder ein Motorrad elektrisch. Die Masse wird neu berechnet (Motor, Getriebe und Tank oder Motoren und Akku), die Übersetzung passt sich an die neue Drehzahl und den Reifen an, und das Cockpit schaltet selbst um (Drehzahl oder kW, Tank oder Akku, Zündung oder Ready). Die Wahl bleibt je Fahrzeug gespeichert, „Auf Werkszustand“ bringt den Werksantrieb zurück. ([#154](https://github.com/SwissCheese26/engine-sandbox/issues/154), [#160](https://github.com/SwissCheese26/engine-sandbox/issues/160))

### Geändert

- Verbrenner und E-Auto sind jetzt gleich aufgebaut. In der Bedienleiste sitzt Ready an der Stelle von Zündung und Starter, P N D an der Stelle von ▲ Gang ▼, nichts verrutscht mehr beim Wechsel. P N D folgt der Einstellung „Schaltknöpfe in der Bedienleiste“ (am PC mit „Immer“). Die Rundinstrumente der Prüfzelle stehen in derselben Reihenfolge (Drehzahl, Drehmoment, Leistung), ebenso die Werte darunter. Die Werkbank hat dieselbe Plattenfolge und am Ende für beide dieselbe „Zusammenfassung“ (Leistung, Drehmoment, Vmax, 0–100, Reichweite, Masse, begrenzt durch) mit „Maximum“ und „Auf Werkszustand“. ([#154](https://github.com/SwissCheese26/engine-sandbox/issues/154), [#160](https://github.com/SwissCheese26/engine-sandbox/issues/160))

## 2026-11-24 – Reifen werden beim Burnout heiß

### Behoben

- Bei einem Burnout und mit blockierten Rädern heizen sich die Reifen jetzt auf. Die Reibung der durchdrehenden oder rutschenden Räder erwärmt die Lauffläche, nach 5 s Burnout eines starken Hecktrieblers sind es etwa 140–160 °C. Das Reifenfeld und das Zusatzinstrument (in jedem Cockpit-Design) zeigen die Temperatur. Ab etwa 130 °C leuchtet die Reifenleuchte, und es erscheint „Lauffläche überhitzt“. Zu heiße Reifen haben weniger Grip, kalte Semi-Slicks und Slicks greifen schlechter. Ein langer Burnout verschleißt das Profil: Nach einigen zehn Sekunden vibriert der Reifen, am Ende versagt er („nachsichtig“: nur Gripverlust, „aus“: kein Verschleiß). Mit heißer Lauffläche raucht es stärker. Das gilt für alle Fahrzeuge, auch E-Autos und Allradler. ([#149](https://github.com/SwissCheese26/engine-sandbox/issues/149), [#152](https://github.com/SwissCheese26/engine-sandbox/issues/152))

## 2026-11-23 – E-Tuner: Max. Motordrehzahl für mehr Vmax, viel stärkere Motoren mit Axialfluss und Ölkühlung, Reifen überhitzen und platzen über dem Geschwindigkeitsindex

### Neu

- Reifen haben jetzt Grenzen: Wer schneller fährt, als der Geschwindigkeitsindex erlaubt (z. B. W = 270 km/h), heizt die Reifen auf. Erst kommt „Reifen überhitzen“ mit gelber Reifenleuchte, dann vibriert der Reifen und hat weniger Grip, am Ende platzt er: kaum Grip, hoher Rollwiderstand, das Fahrzeug fährt nur noch langsam. 10 % zu schnell hält ein paar Minuten, 25 % etwa eine Minute. Das gilt für Autos, Motorräder, Lkw, Busse und E-Autos und folgt der Realismus-Einstellung („nachsichtig“: kein Platzer, „aus“: kein Schaden). Im Stand hilft „Reifen wechseln“ im Rollenprüfstand. Neues Feld und Zusatzinstrument „Reifen“ in jedem Cockpit-Design, dazu leises Rumpeln, Vibration auf dem Handy und Qualm beim Platzer. ([#144](https://github.com/SwissCheese26/engine-sandbox/issues/144), [#148](https://github.com/SwissCheese26/engine-sandbox/issues/148))
- Im E-Tuner (Werkbank, „Elektromotoren“) geht die Motorgröße jetzt bis 400 %, beim Plaid also bis etwa 1000 kW je Motor. Neu sind die „Motorbauart“ (Radialfluss wie ab Werk oder Axialfluss: leichter und stärker, aber teurer und höchstens 10 000 1/min) und die „Motorkühlung“ (Wassermantel, Stator-Ölsprühkühlung oder direkte Wicklungs-Ölkühlung: mehr Dauerleistung, der Motor regelt erst später ab). Größere Motoren wiegen mehr, werden wärmer und brauchen mehr Strom; mit 800 V reicht der halbe. Die Zusammenfassung zeigt die Dauerleistung und die Wärme je Motor. Akku, Wechselrichter und Haftung begrenzen weiter: „Maximum“ baut jetzt das schnellste statt des schwersten Autos: Motoren nur so groß, wie Akku und Wechselrichter sie nutzen können, der kleinste Akku, der den vollen Strom liefert, und Axialfluss, wenn er schneller ist. Der Plaid kommt so auf etwa 2650 PS, 0–100 in 2,75 s und 420 km/h. Wechselst du die Motorbauart, passt sich die Untersetzung an die neue Drehzahlgrenze an. ([#141](https://github.com/SwissCheese26/engine-sandbox/issues/141), [#147](https://github.com/SwissCheese26/engine-sandbox/issues/147))
- Im E-Tuner (Werkbank, „Getriebe und Vmax“) lässt sich die „Max. Motordrehzahl“ bis 25 000 1/min anheben, ab Werk steht der Wert des Autos (Plaid 20 000 1/min). Das braucht eine Karbonhülse um den Rotor: etwas mehr Gewicht und mehr Verluste bei hoher Drehzahl. Oben fällt das Moment weiter ab, die Leistung begrenzen Akku und Motoren. Mit ausgeschaltetem Begrenzer fährt der Plaid so etwa 415 statt 335 km/h. Der Vmax-Begrenzer reicht bis zur neuen Grenze, die Zusammenfassung zeigt „begrenzt durch Motordrehzahl“, „Luftwiderstand“ oder „Begrenzer“. ([#139](https://github.com/SwissCheese26/engine-sandbox/issues/139), [#140](https://github.com/SwissCheese26/engine-sandbox/issues/140))

## 2026-11-22 – Elektroantrieb in der Werkbank, 2-Gang-Getriebe und Vmax für E-Autos, Live-Reichweite für alle Fahrzeuge und Fahrstufen P N D, Bremse hält bei der Automatik die Antriebsräder, Katheizen nach dem Kaltstart

### Neu

- Kaltstart wie im echten Auto: Neuere Benziner (ab Euro 3) heizen nach dem Start ihren Katalysator. Etwa 20–60 s läuft der Leerlauf bei rund 1200–1500 1/min, die Zündung kommt sehr spät, der Motor verbraucht mehr und klingt rauer. Danach bleibt der Leerlauf leicht erhöht und sinkt mit der Kühlmitteltemperatur, bis der Motor bei etwa 70 °C normal läuft. Diesel ab Euro 5 heben den Leerlauf an und spritzen nach, um den Kat zu heizen. Ältere Motoren wie der Supra 2JZ haben nur einen leicht erhöhten Kaltleerlauf wie mit Choke. Mit „Motor warm starten“ läuft der Motor sofort im normalen Leerlauf. ([#135](https://github.com/SwissCheese26/engine-sandbox/issues/135), [#137](https://github.com/SwissCheese26/engine-sandbox/issues/137))
- „Kat-Temp“: Die Temperatur des Katalysators steht als Feld im digitalen Cockpit, als Zusatzinstrument in jedem Cockpit-Design und als Anzeige in der Prüfzelle, bei allen Motoren mit Kat. Während der Kat heizt, leuchtet in jedem Cockpit-Design und in der Prüfzelle die grüne Kontrollleuchte „Kat heizt“, und das Feld ist in Signalfarbe. Mit eingeschalteten Hinweisen erscheint zusätzlich kurz „Kat heizt“. ([#135](https://github.com/SwissCheese26/engine-sandbox/issues/135), [#137](https://github.com/SwissCheese26/engine-sandbox/issues/137))
- Drei neue fertige Autos mit eigenem Motor: Cupra Leon Sportstourer VZ 2.0 TSI 4Drive (333 PS, 420 Nm, DSG, Allrad), Audi A1 1.4 TFSI (122 PS, 7-Gang S tronic) und BMW 116i F20 (136 PS, 6-Gang-Handschalter, Hinterradantrieb). Du findest sie in der Fahrzeugliste, im Sandbox-Assistenten und ihre Motoren in der Motorliste. ([#131](https://github.com/SwissCheese26/engine-sandbox/issues/131), [#132](https://github.com/SwissCheese26/engine-sandbox/issues/132))
- Drei neue Cockpit-Designs im Stil bekannter Kombiinstrumente: „Spanisch Kupfer (digital)“ (volldigital, dunkel mit Kupferakzenten und großem Tempo in der Mitte), „Ingolstadt Rot“ (zwei Rundinstrumente mit roten Zeigern und roter Beleuchtung) und „München Orange“ (orange Beleuchtung, Verbrauchsanzeige im Drehzahlmesser). Steht das Design auf „Automatisch“, nimmt ein Fahrzeug aus der Bibliothek, das ein eigenes Kombiinstrument mitbringt, dieses Design. ([#133](https://github.com/SwissCheese26/engine-sandbox/issues/133))
- Jedes Fahrzeug zeigt jetzt seine Reichweite, auch Benziner und Diesel: Tankinhalt geteilt durch den Verbrauch der letzten Kilometer und Minuten, live und ohne Sprünge. Sie steht in jedem Cockpit-Design neben Tank oder Ladezustand und in der Prüfzelle neben dem Tankinhalt. Auf dem Motorprüfstand ohne Fahrzeug bleibt sie ausgeblendet. ([#129](https://github.com/SwissCheese26/engine-sandbox/issues/129), [#130](https://github.com/SwissCheese26/engine-sandbox/issues/130))
- 2-Gang-Getriebe für E-Autos wie bei Porsche Taycan und Audi e-tron GT: kurzer 1. Gang (etwa 15 : 1) zum Anfahren, langer 2. Gang (etwa 8 : 1) für Vmax, mit einstellbarem Schaltpunkt und kurzer Zugkraftunterbrechung beim Schalten. Die Untersetzung lässt sich auch beim 1-Gang-Getriebe ändern. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#124](https://github.com/SwissCheese26/engine-sandbox/issues/124), [#125](https://github.com/SwissCheese26/engine-sandbox/issues/125))
- Den Vmax-Begrenzer von E-Autos kannst du in der Werkbank anheben, bis zur Drehzahlgrenze der Motoren. Am rechten Anschlag ist er aus, dann steht „begrenzt durch Motordrehzahl“. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#125](https://github.com/SwissCheese26/engine-sandbox/issues/125))
- Fahrstufen P, N und D statt ▲ D ▼ neben den Pedalen eines Elektroautos. P zieht die Parkbremse, N nimmt den Antrieb weg. Löst „Halten“ die Parkbremse, springt die Fahrstufe auf N. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#125](https://github.com/SwissCheese26/engine-sandbox/issues/125))

### Geändert

- E-Tuner: Jetzt gehen bis zu 4 Motoren je Achse, also bis zu 8 insgesamt. Änderungen wirken sofort wie beim Verbrenner, der Knopf „Anwenden“ entfällt. ([#136](https://github.com/SwissCheese26/engine-sandbox/issues/136))
- Beim eigenen Fahrzeug kommt der Antrieb zuerst: Motor, Getriebe und Antrieb, dann Reifen, dann Gewicht, cW-Wert und Stirnfläche, zuletzt der Tank. ([#127](https://github.com/SwissCheese26/engine-sandbox/issues/127), [#128](https://github.com/SwissCheese26/engine-sandbox/issues/128))
- Der E-Tuner sitzt jetzt in der Werkbank: Mit einem Elektroauto zeigt sie statt der Motorplatten die Platten „Elektromotoren“, „Getriebe und Vmax“, „Akku“ und „Kühlung und Reifen“ im gleichen Look wie beim Verbrenner, dazu eine Zusammenfassung mit PS, Vmax, 0–100 und Reichweite. Gespeichert wird weiter je Fahrzeug, „Auf Werkszustand“ setzt zurück. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#125](https://github.com/SwissCheese26/engine-sandbox/issues/125))
- Die Reichweite ist jetzt live: Ladezustand mal Akkuinhalt geteilt durch den Verbrauch der letzten Kilometer und Minuten. Wer zügig fährt, sieht sie sinken, Rekuperation hebt sie sanft an. Das gilt in jedem Cockpit, im E-Tacho und im Rollenprüfstand. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#125](https://github.com/SwissCheese26/engine-sandbox/issues/125))
- Die Werte des Elektroautos (Ladezustand, Reichweite, Akkuleistung, Rekuperiert, Ø Verbrauch, Akku, Temperaturen) stehen im Rollenprüfstand in derselben Liste wie Tempo und Vmax. „Laden auf 90 %, 100 %, 10 %“ ersetzt „Volltanken“. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#125](https://github.com/SwissCheese26/engine-sandbox/issues/125))
- 0–100 km/h zählt erst, wenn du aus dem Stand mit Gas losfährst (Gas gegen die Bremse zählt noch nicht). Gehst du unterwegs vom Gas oder bremst, wird der Lauf verworfen; kurze Schaltpausen sind erlaubt. ([#122](https://github.com/SwissCheese26/engine-sandbox/issues/122), [#123](https://github.com/SwissCheese26/engine-sandbox/issues/123))
- Schaltgetriebe warnen erst ab 130 °C Öltemperatur, weil sie keinen Schutzmodus haben. Die Erwärmung selbst war schon realistisch (etwa 10 °C pro Minute unter Dauervollgas). ([#53](https://github.com/SwissCheese26/engine-sandbox/issues/53), [#123](https://github.com/SwissCheese26/engine-sandbox/issues/123))

### Behoben

- Auf schmalen Handys (360–420 px) überdecken sich die Bedienelemente unten nicht mehr: Schaltknöpfe, P N D, Halten, Bremse und Gas sitzen neben Zündschlüssel, Starter und „Prüfstand und Ton“, alle mindestens 44 px groß. Die Beschriftungen unter Schlüssel und Starter entfallen dort. ([#133](https://github.com/SwissCheese26/engine-sandbox/issues/133))
- Im E-Tuner lassen sich jetzt 4 Motoren wählen, z. B. 2 vorn und 2 hinten wie beim Rimac, aber auch 1 + 3, 3 + 1, 0 + 4 oder 4 + 0. Die Achse, die du gerade einstellst, bleibt, die andere gibt nach. ([#127](https://github.com/SwissCheese26/engine-sandbox/issues/127), [#128](https://github.com/SwissCheese26/engine-sandbox/issues/128))
- Der Verbrauch eines Elektroautos zeigt beim Rekuperieren keine negativen Werte mehr, sondern den Durchschnitt der Fahrt. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#125](https://github.com/SwissCheese26/engine-sandbox/issues/125))
- Auf dem Handy ist die Leistungsanzeige im E-Tacho kleiner, Tempo und Anzeigen passen wieder auf den Schirm. Felder, Knöpfe und Auswahllisten der Werkbank sind dort mindestens 44 px hoch, nichts ragt mehr über den Rand. ([#120](https://github.com/SwissCheese26/engine-sandbox/issues/120), [#125](https://github.com/SwissCheese26/engine-sandbox/issues/125))
- Automatik: Vollgas bei voll getretener Bremse lässt die Räder nicht mehr frei durchdrehen. Die Bremse hält jetzt auch die Antriebsräder, der Motor bleibt auf der Festbremsdrehzahl des Wandlers (z. B. ≈ 2000 1/min beim Land Cruiser statt durchdrehender Räder). Bei starken Hecktrieblern wie 530d und E 220 d nimmt die Steuerung wie in echt Motormoment zurück, damit die Bremse hält (≈ 1800 statt über 4000 1/min). Das Getriebeöl wird dabei schnell heiß. ([#104](https://github.com/SwissCheese26/engine-sandbox/issues/104), [#118](https://github.com/SwissCheese26/engine-sandbox/issues/118), [#119](https://github.com/SwissCheese26/engine-sandbox/issues/119))

## 2026-11-21 – Elektroautos mit E-Tuner und E-Tacho, Zusatzinstrumente im Look jedes Cockpits, Druckluft, Retarder und AdBlue, Kurven mit Schräglage, Reifenqualm, aufgeräumter Rollenprüfstand, Einstellungen pro Fahrzeug und Getriebeölkühler

### Neu

- Elektroautos: Tesla Model S Long Range, Model S Plaid, Model X Plaid, Model Y Performance, Lucid Air Sapphire, VW ID.3 und ID.4 GTX. Sie stehen mit ⚡ in der Fahrzeugliste und im Start-Assistenten. Statt Zündschlüssel und Starter gibt es „Ready“, die Motoren hängen ohne Kupplung und Gänge direkt an den Rädern. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#115](https://github.com/SwissCheese26/engine-sandbox/issues/115))
- Echte E-Physik: Der Akku bricht unter Last ein, wird warm und nimmt voll oder kalt kaum Rekuperation an. Gas lupfen und leicht bremsen rekuperiert, Allradler verteilen die Kraft auf die Achse mit Grip. Fahrmodi Chill, Sport und Plaid. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#115](https://github.com/SwissCheese26/engine-sandbox/issues/115))
- Jedes Cockpit-Design hat eine Elektro-Variante: Leistungsanzeige mit grüner Rekuperation statt Drehzahlmesser, Ladezustand statt Tank, Reichweite und Ready-Leuchte. Neu ist das Design „E-Tacho“ mit Ladezustand, Reichweite, kWh/100 km, Akkutemperatur und Fahrmodus. „Automatisch“ wählt es im Elektroauto. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#115](https://github.com/SwissCheese26/engine-sandbox/issues/115))
- E-Tuner: Motoren (1 bis 4, vorn und hinten), Motorgröße, Wechselrichterstrom, Akku (kWh, Zelltyp, C-Rate, 400/800 V), Kühlung und Reifen, gespeichert je Fahrzeug. Live siehst du PS und kW, was begrenzt, 0–100 und Reichweite. Bis etwa 2800 PS, solange Akkustrom, Wechselrichter und Haftung mitspielen. „Auf Werkszustand zurücksetzen“ bringt den Serienzustand zurück. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#115](https://github.com/SwissCheese26/engine-sandbox/issues/115))
- Elektroautos klingen nach Elektroauto: Motor und Wechselrichter heulen mit der Drehzahl, dazu kommt das Getriebeheulen unter Last. ([#108](https://github.com/SwissCheese26/engine-sandbox/issues/108), [#115](https://github.com/SwissCheese26/engine-sandbox/issues/115))
- Neues Zusatzinstrument „Getriebeöl“, rund oder als Balken: gelb ab der Warnschwelle, rot ab dem Notlauf des Getriebesteuergeräts (beim Handschalter ab der Schadensgrenze), passend zur Getriebeart. Es erscheint, sobald ein Fahrzeug auf dem Prüfstand steht. ([#53](https://github.com/SwissCheese26/engine-sandbox/issues/53), [#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#109](https://github.com/SwissCheese26/engine-sandbox/issues/109))
- Drehen die Räder durch oder blockieren sie, steigt unter den Instrumenten ein Hauch Reifenqualm auf, je mehr Schlupf und Tempo, desto mehr. Wird der Motor zu heiß, dampft es über dem Cockpit bzw. dem Motor-Schnittbild, bei kritischer Hitze oder Motorschaden dichter. Ein Motorschaden oder viel zu heißes Öl zeigt sich als bläulicher Rauch, ein rußender Diesel als dunkle Wolke. Abschalten lässt sich das unter Einstellungen › Effekte (Rauch/Dampf). ([#110](https://github.com/SwissCheese26/engine-sandbox/issues/110), [#114](https://github.com/SwissCheese26/engine-sandbox/issues/114))
- „Auf Werkszustand zurücksetzen“ unter „Fahrzeug & Reifen“ verwirft die eigenen Änderungen am aktuellen Fahrzeug. ([#112](https://github.com/SwissCheese26/engine-sandbox/issues/112), [#113](https://github.com/SwissCheese26/engine-sandbox/issues/113))
- Lkw und Bus haben jetzt Druckluftbremsen: Der Kompressor füllt den Vorrat bis 10 bar, jede Bremsung kostet Luft. Unter 5,5 bar leuchtet die rote Warnleuchte, unter 4,5 bar greifen die Federspeicher. Der Druck steht im Nutzfahrzeug-Design und als Zusatzinstrument „Druckluft“. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#117](https://github.com/SwissCheese26/engine-sandbox/issues/117))
- Retarder für Lkw und Bus: Stufe 0–5 mit „−“ und „+“ im Nutzfahrzeug-Design, daneben die Bremsleistung. Er bremst bei Tempo kräftig und lässt bei Schrittgeschwindigkeit nach, zum Anhalten braucht es die Bremse. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#117](https://github.com/SwissCheese26/engine-sandbox/issues/117))
- AdBlue bei Dieseln mit SCR: Der Tank leert sich mit etwa 5 % des Dieselverbrauchs. Bei Reserve leuchtet die AdBlue-Leuchte, ist er leer, blinkt sie und der Motor läuft im Notlauf mit weniger Leistung. Beim Tanken wird AdBlue mit aufgefüllt. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#117](https://github.com/SwissCheese26/engine-sandbox/issues/117))
- Neue Anzeigen in allen Cockpits: Ansauglufttemperatur und Batteriespannung (12,6 V aus, rund 14,2 V bei laufendem Motor, beim Lkw 24-V-Bordnetz), auch in der Prüfzelle. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#105](https://github.com/SwissCheese26/engine-sandbox/issues/105), [#117](https://github.com/SwissCheese26/engine-sandbox/issues/117))
- Flachland, Mittelgebirge und Alpen haben jetzt Kurven. Auf dem Motorrad zeigt das Cockpit die Schräglage, die das Tempo in der Kurve verlangt, in Signalfarbe, wenn der Reifen das nicht mehr hält. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#117](https://github.com/SwissCheese26/engine-sandbox/issues/117))
- Getriebeölkühler wählbar: „Serie“, „Ölkühler (Zubehör)“ (Luft-Öl-Kühler im Fahrtwind, kühlt bei schneller Fahrt deutlich, im Stand kaum) und „Aus“ bei Getrieben, die ab Werk einen Kühler haben. ([#112](https://github.com/SwissCheese26/engine-sandbox/issues/112), [#113](https://github.com/SwissCheese26/engine-sandbox/issues/113), [#100](https://github.com/SwissCheese26/engine-sandbox/issues/100))

### Geändert

- Die Zusatzinstrumente passen sich jetzt dem Cockpit-Design an: elfenbeinfarbene Blätter mit Chromring im Oldschool, orange Beleuchtung in der Nachtfahrt, tiefe Röhren in der Sportlimousine und kräftige Lkw-Instrumente im Nutzfahrzeug. In Digital, Head-up, Renn-Dash und Motorrad erscheinen sie als Kacheln oder Segmentbalken im Stil des Displays. Grenzwerte bleiben überall gelb. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#109](https://github.com/SwissCheese26/engine-sandbox/issues/109))
- Rollenprüfstand aufgeräumt: Jede Einstellung gibt es nur noch einmal. Oben stehen die Anzeigen (Gang, Tempo, Vmax, 0–100, Getriebeöl, Tankinhalt, Bordcomputer), darunter die Abschnitte „Getriebe“ (Getriebeart, Achsübersetzung, Ölkühler, Gänge und Zugkraftdiagramm), „Fahrzeug & Reifen“ (Fahrzeugtyp, fertiges Fahrzeug, Vmax-Begrenzer, Karosserie, Reifen) und „Umwelt & Assistenten“. Die berechnete Vmax steht nur noch einmal, unter dem Zugkraftdiagramm. ([#112](https://github.com/SwissCheese26/engine-sandbox/issues/112), [#113](https://github.com/SwissCheese26/engine-sandbox/issues/113))
- Einstellungen gelten pro Fahrzeug: Eigene Gänge, Getriebeart, Achsübersetzung, Reifen, Antrieb, Karosserie, Tankgröße, Vmax-Begrenzer und Ölkühler bleiben beim Fahrzeug, an dem du sie geändert hast. Ein anderes Fahrzeug startet im Werkszustand, beim Zurückwechseln sind deine Änderungen wieder da. Bisher gespeicherte Gänge übernimmt das zuletzt gefahrene Fahrzeug. ([#112](https://github.com/SwissCheese26/engine-sandbox/issues/112), [#113](https://github.com/SwissCheese26/engine-sandbox/issues/113))

## 2026-11-20 – Engine Builder, Nutzfahrzeug-Cockpit, Getriebeöltemperatur und echte Launch Control

### Neu

- Engine Builder im Hauptmenü (Tor 2): Motor Schritt für Schritt bauen, von Kraftstoff und Block über Zylinderkopf, Gemisch, Turbo, Abgas und Kühlung bis zu Begrenzer und Steuergerät. Zu jeder Wahl steht dabei, was sie bewirkt, daneben siehst du Hubraum, Leistung, Drehmoment und Gewicht live. Unbaubare Werte halten „Weiter“ auf. ([#72](https://github.com/SwissCheese26/engine-sandbox/issues/72), [#107](https://github.com/SwissCheese26/engine-sandbox/issues/107))
- Eigene Motoren speichern, umbenennen und löschen. Ein fertiger Motor lässt sich direkt im Stand hochdrehen (Zündung, Starter, Handgas, Ton) oder in der Sandbox fahren. Er steht auch in der Werkbank und bei „Eigenes Fahrzeug“ zur Wahl. ([#72](https://github.com/SwissCheese26/engine-sandbox/issues/72), [#107](https://github.com/SwissCheese26/engine-sandbox/issues/107))
- Cockpit-Design „Nutzfahrzeug“: Tacho bis 125 km/h mit Markierung des Begrenzers, Drehzahlmesser mit grünem Bereich (Drehmomentplateau) und Anzeige der Motorbremse. Mit „Automatisch“ erscheint es bei Lkw und Bus von selbst. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#106](https://github.com/SwissCheese26/engine-sandbox/issues/106))
- Zusatzinstrumente wie im Tuning-Auto: Ladedruck, Öldruck, Öltemperatur, Lambda und Abgastemperatur, als Rundinstrumente oder Balken, unter „+ Zusatzanzeigen“ im Cockpit. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#106](https://github.com/SwissCheese26/engine-sandbox/issues/106))
- Tuning-Leiste: Ladedruck Soll und Ist, Zündung bzw. Förderbeginn gegenüber dem Kennfeld, Vollast-λ bzw. Rauchgrenze, Klopfen und die Leistungsgrenze des Steuergeräts, mit Hinweis, wenn sie greift. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#106](https://github.com/SwissCheese26/engine-sandbox/issues/106))
- Das Getriebe hat jetzt eine eigene Öltemperatur. Sie steigt unter Last, beim Anfahren am Berg und mit schleifender Kupplung, und der Fahrtwind kühlt. Kaltes Öl ist zäh und kostet etwas Leistung. Zu sehen ist sie im Getriebe-Pult und als Feld „Getriebeöl“ im Digital-Cockpit. ([#53](https://github.com/SwissCheese26/engine-sandbox/issues/53), [#102](https://github.com/SwissCheese26/engine-sandbox/issues/102))
- Wird das Getriebe zu heiß, leuchtet die Lampe „Getriebe heiß“. DSG und Automatik gehen in den Notlauf und begrenzen die Leistung. Mit „Realistisch“ kann das Getriebe Schaden nehmen, mit „Sandbox“ nicht. ([#53](https://github.com/SwissCheese26/engine-sandbox/issues/53), [#102](https://github.com/SwissCheese26/engine-sandbox/issues/102))

### Geändert

- Launch Control arbeitet jetzt wie im echten Auto: Die Drosselklappe bleibt offen, ein zweiter Drehzahlbegrenzer hält die Startdrehzahl, und Turbomotoren bauen mit Spätzündung schon im Stand Ladedruck auf. Der Skyline GT-R R34 schafft damit 0–100 in etwa 5,4 s. ([#38](https://github.com/SwissCheese26/engine-sandbox/issues/38), [#101](https://github.com/SwissCheese26/engine-sandbox/issues/101), [#103](https://github.com/SwissCheese26/engine-sandbox/issues/103))

### Behoben

- Nissan RB26DETT (Skyline GT-R): Die Nockenwelle ist jetzt anhand der Werks-Steuerzeiten als milde Turbo-Nocke eingeschätzt. Das Drehmoment liegt früher an (386 Nm, Plateau ab 3500 1/min) und die Leistung realistisch bei 216 kW statt 244 kW. ([#89](https://github.com/SwissCheese26/engine-sandbox/issues/89), [#103](https://github.com/SwissCheese26/engine-sandbox/issues/103))

## 2026-11-16 – Geführter Start, einfachere Ansichten und Credits

### Neu

- Die Sandbox führt jetzt Schritt für Schritt hinein: Fahrzeugart, Fahrzeug (mit PS, Gewicht, Getriebe und Tank), Strecke und zum Schluss „Kurz erklärt“, wo Zündung, Gas, Schalten, Handbremse, Tempomat, Umwelt und Einstellungen liegen. „Weiter wie zuletzt“ bleibt der schnelle Weg hinein. ([#93](https://github.com/SwissCheese26/engine-sandbox/issues/93), [#95](https://github.com/SwissCheese26/engine-sandbox/issues/95))
- Eigenes Fahrzeug direkt beim Start: Auto, Lkw oder Motorrad mit eigenem Gewicht, cW-Wert, Stirnfläche, Reifen, Antrieb, Getriebe, Tank und einem Motor aus der Bibliothek. ([#93](https://github.com/SwissCheese26/engine-sandbox/issues/93), [#95](https://github.com/SwissCheese26/engine-sandbox/issues/95))
- Renn-Dash im Cockpit mit Kontrollleuchten, (P)-Leuchte, Tempomat-Anzeige und Tankanzeige. ([#94](https://github.com/SwissCheese26/engine-sandbox/issues/94), [#96](https://github.com/SwissCheese26/engine-sandbox/issues/96))
- „Credits“ im Hauptmenü: wer die Prüfzelle gebaut hat. ([#94](https://github.com/SwissCheese26/engine-sandbox/issues/94), [#96](https://github.com/SwissCheese26/engine-sandbox/issues/96))
- In der Fahrzeugliste beim Start gibt es „+ Neues erstellen“: Das Formular für ein eigenes Fahrzeug öffnet sich direkt mit der passenden Fahrzeugart. ([#97](https://github.com/SwissCheese26/engine-sandbox/issues/97), [#98](https://github.com/SwissCheese26/engine-sandbox/issues/98))

### Geändert

- Oben gibt es nur noch zwei Ansichten: Prüfzelle und Cockpit. Renn-Dash ist jetzt ein Cockpit-Design, Kompakt steckt im Design Head-up (mit Drehzahl und Leistung groß). Deine bisherige Wahl wird übernommen. ([#94](https://github.com/SwissCheese26/engine-sandbox/issues/94), [#96](https://github.com/SwissCheese26/engine-sandbox/issues/96))
- Das Cockpit-Design wählst du in den Einstellungen aus einer kurzen Liste mit Name und Beschreibung, direkt unter „Cockpit“. ([#94](https://github.com/SwissCheese26/engine-sandbox/issues/94), [#96](https://github.com/SwissCheese26/engine-sandbox/issues/96))
- Die Reifengröße wählst du jetzt aus drei Listen: Breite, Querschnitt und Zoll, darunter stehen Durchmesser und Abrollumfang. Es gibt passende Größen für Autos, Motorräder sowie Lkw und Busse. Ungewöhnliche Kombinationen bekommen einen Hinweis. Ein gespeichertes eigenes Fahrzeug wird übernommen. ([#97](https://github.com/SwissCheese26/engine-sandbox/issues/97), [#98](https://github.com/SwissCheese26/engine-sandbox/issues/98))

## 2026-11-15 – Handbremse und Auto-Hold

### Neu

- Handbremse mit Auto-Hold: Im Stand hält sie das Auto von selbst, auch am Berg, Gas geben löst sie. Rote (P)-Leuchte in jedem Cockpit und eine P-Taste neben der Bremse; Auto-Hold lässt sich in den Einstellungen abschalten. ([#91](https://github.com/SwissCheese26/engine-sandbox/issues/91), [#92](https://github.com/SwissCheese26/engine-sandbox/issues/92))

### Behoben

- Das Auto rollt im Stand nicht mehr von selbst los, und mit angezogener Handbremse lassen sich die Übersetzungen ändern. ([#91](https://github.com/SwissCheese26/engine-sandbox/issues/91), [#92](https://github.com/SwissCheese26/engine-sandbox/issues/92))

## 2026-11-14 – Was ist neu

### Neu

- „Was ist neu“ im Hauptmenü: alle Änderungen auf einen Blick, mit Hinweis auf Neues seit deinem letzten Besuch. ([#50](https://github.com/SwissCheese26/engine-sandbox/issues/50), [#88](https://github.com/SwissCheese26/engine-sandbox/issues/88))

### Behoben

- Das Fenster „Fehler melden“ ist jetzt richtig gestaltet. ([#50](https://github.com/SwissCheese26/engine-sandbox/issues/50), [#88](https://github.com/SwissCheese26/engine-sandbox/issues/88))

## 2026-11-12 – Lkw, Busse und neue Cockpits

### Neu

- Lkw und Busse: Lkw- und Busdiesel, Motorbremse, Sattelzug und Stadtbus. ([#31](https://github.com/SwissCheese26/engine-sandbox/issues/31), [#82](https://github.com/SwissCheese26/engine-sandbox/issues/82))
- Sechs neue Cockpit-Designs: Nachtfahrt, Sportlimousine, Oldschool, Digital, Head-up und Motorrad. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#84](https://github.com/SwissCheese26/engine-sandbox/issues/84))
- „Fehler melden“ direkt im Spiel, mit Diagnose, die du vor dem Absenden prüfen kannst. ([#55](https://github.com/SwissCheese26/engine-sandbox/issues/55), [#79](https://github.com/SwissCheese26/engine-sandbox/issues/79))
- Zündschlüssel und Startknopf; der Ton ist gleich eingeschaltet. ([#85](https://github.com/SwissCheese26/engine-sandbox/issues/85))

### Geändert

- Ruhigere Bedienleiste: Hinweise zu Grenzwerten erscheinen als kurze Einblendungen. ([#85](https://github.com/SwissCheese26/engine-sandbox/issues/85))
- Handy und Tablet: Touch wird erkannt, der Bildschirm bleibt an, kurze Vibration als Rückmeldung; neue Einstellungen dazu. ([#44](https://github.com/SwissCheese26/engine-sandbox/issues/44), [#66](https://github.com/SwissCheese26/engine-sandbox/issues/66), [#80](https://github.com/SwissCheese26/engine-sandbox/issues/80))

## 2026-11-08 – Strecken, Tank und Schaltknöpfe

### Neu

- Strecken mit Höhenprofil: Flachland, Hügel, Alpenpass, Bergauf und Bergab. ([#48](https://github.com/SwissCheese26/engine-sandbox/issues/48), [#57](https://github.com/SwissCheese26/engine-sandbox/issues/57))
- Vor der Sandbox wählst du eine Strecke; der Tempomat hat Symbole und eine Markierung am Tacho. ([#61](https://github.com/SwissCheese26/engine-sandbox/issues/61))
- Tank mit echtem Volumen, Tankuhr, Reservelampe und Volltanken; die Tankgröße ist einstellbar. ([#75](https://github.com/SwissCheese26/engine-sandbox/issues/75), [#76](https://github.com/SwissCheese26/engine-sandbox/issues/76))
- Schaltknöpfe in der Bedienleiste, mit Einstellung und Beispielbild. ([#71](https://github.com/SwissCheese26/engine-sandbox/issues/71))
- Einstellung für den Gashebel auf der Rolle: zurückfedern oder Handgas. ([#64](https://github.com/SwissCheese26/engine-sandbox/issues/64))
- Citroën C1 1.0 (2008, 68 PS) in der Bibliothek; Motorräder mit echtem Gewicht. ([#65](https://github.com/SwissCheese26/engine-sandbox/issues/65), [#67](https://github.com/SwissCheese26/engine-sandbox/issues/67))

### Behoben

- Die Motorliste zeigt wieder die passenden Autos zum Motor. ([#69](https://github.com/SwissCheese26/engine-sandbox/issues/69))
- Cockpit am Handy: Tempomat und Mitteldisplay rutschen unter die kleinen Anzeigen. ([#68](https://github.com/SwissCheese26/engine-sandbox/issues/68), [#70](https://github.com/SwissCheese26/engine-sandbox/issues/70))
- Schaltknöpfe und Bremse sitzen auf Höhe des Gashebels. ([#73](https://github.com/SwissCheese26/engine-sandbox/issues/73))

## 2026-11-07 – Hauptmenü, Tempomat und Ansichten

### Neu

- Hauptmenü mit Werkstatttoren und Einstellungen; Einheiten gelten jetzt überall. ([#24](https://github.com/SwissCheese26/engine-sandbox/issues/24), [#42](https://github.com/SwissCheese26/engine-sandbox/issues/42), [#45](https://github.com/SwissCheese26/engine-sandbox/issues/45))
- Tempomat und Limiter. ([#30](https://github.com/SwissCheese26/engine-sandbox/issues/30), [#46](https://github.com/SwissCheese26/engine-sandbox/issues/46))
- Ansichten: Cockpit-Kombiinstrument, Renn-Dash und Kompakt. ([#26](https://github.com/SwissCheese26/engine-sandbox/issues/26), [#47](https://github.com/SwissCheese26/engine-sandbox/issues/47))
- Tacho-Skala wählbar; das Fahrzeug passt sich dem gewählten Serienmotor an. ([#49](https://github.com/SwissCheese26/engine-sandbox/issues/49))
- Bremspedal auf dem Handy. ([#52](https://github.com/SwissCheese26/engine-sandbox/issues/52))

### Behoben

- Der Linienschreiber läuft in allen Ansichten. ([#51](https://github.com/SwissCheese26/engine-sandbox/issues/51))
- Der Gashebel federt auf der Rolle zurück; das Cockpit zeigt Gefälle. ([#54](https://github.com/SwissCheese26/engine-sandbox/issues/54))
- Motor aus im Gang: Die Kupplung bleibt geschlossen, das Auto rollt nicht einfach weiter. ([#56](https://github.com/SwissCheese26/engine-sandbox/issues/56))

## 2026-11-06 – Bordcomputer

### Neu

- Bordcomputer mit Gesamtkilometern und Trip A samt Durchschnittsverbrauch. ([#40](https://github.com/SwissCheese26/engine-sandbox/issues/40), [#41](https://github.com/SwissCheese26/engine-sandbox/issues/41), [#43](https://github.com/SwissCheese26/engine-sandbox/issues/43))

## 2026-11-03 – Tuning, Motorräder und Fahrzeuge

### Neu

- Tuning-Stufen, Drehmomentbegrenzung im Steuergerät und Pops & Bangs. ([#16](https://github.com/SwissCheese26/engine-sandbox/issues/16), [#18](https://github.com/SwissCheese26/engine-sandbox/issues/18), [#35](https://github.com/SwissCheese26/engine-sandbox/issues/35))
- Motorräder: eigene Bauformen, Luftkühlung, Motorbibliothek und Motorrad auf der Rolle. ([#25](https://github.com/SwissCheese26/engine-sandbox/issues/25), [#36](https://github.com/SwissCheese26/engine-sandbox/issues/36))
- Fahrzeuge mit Reifen und Traktion, dazu fertige Autos zur Auswahl. ([#22](https://github.com/SwissCheese26/engine-sandbox/issues/22), [#37](https://github.com/SwissCheese26/engine-sandbox/issues/37))
- Umwelt und Fahrassistenten: Nässe, Schnee und Eis, ABS, ASR, ESP und Kontrollleuchten. ([#23](https://github.com/SwissCheese26/engine-sandbox/issues/23), [#39](https://github.com/SwissCheese26/engine-sandbox/issues/39))

## 2026-11-02 – Diesel, Benziner und Rollenprüfstand

### Neu

- Diesel und Benziner mit realistischem Verbrennungsmodell. ([#3](https://github.com/SwissCheese26/engine-sandbox/issues/3), [#17](https://github.com/SwissCheese26/engine-sandbox/issues/17))
- Turbo, Motortemperatur, Belastungsgrenzen und Motorgewicht. ([#4](https://github.com/SwissCheese26/engine-sandbox/issues/4), [#12](https://github.com/SwissCheese26/engine-sandbox/issues/12))
- Rollenprüfstand mit Handschaltung, DSG und CVT. ([#14](https://github.com/SwissCheese26/engine-sandbox/issues/14), [#19](https://github.com/SwissCheese26/engine-sandbox/issues/19))
- Motorbibliothek mit 17 Serienmotoren; Kühler bis 2000 kW. ([#15](https://github.com/SwissCheese26/engine-sandbox/issues/15), [#27](https://github.com/SwissCheese26/engine-sandbox/issues/27))
- Motor warm oder kalt starten; Gasannahme einstellbar, Abgas kühlt realistisch ab. ([#28](https://github.com/SwissCheese26/engine-sandbox/issues/28), [#29](https://github.com/SwissCheese26/engine-sandbox/issues/29))
- Vmax-Begrenzer, auf Wunsch abschaltbar. ([#32](https://github.com/SwissCheese26/engine-sandbox/issues/32), [#34](https://github.com/SwissCheese26/engine-sandbox/issues/34))
- Einheiten per Klick wechseln (PS, lb·ft, l/100 km …). ([#21](https://github.com/SwissCheese26/engine-sandbox/issues/21))

### Geändert

- Steuerung: S bremst, der Anlasser liegt auf A. ([#20](https://github.com/SwissCheese26/engine-sandbox/issues/20))

## 2026-10-29 – Motorsound

### Neu

- Motorsound, live aus Drehzahl und Last erzeugt. ([#6](https://github.com/SwissCheese26/engine-sandbox/issues/6), [#11](https://github.com/SwissCheese26/engine-sandbox/issues/11), [#13](https://github.com/SwissCheese26/engine-sandbox/issues/13))

## 2026-10-28 – Die erste Prüfzelle

### Neu

- Werkbank zum Motorbau, Instrumente, Linienschreiber und Bedienpult. ([#5](https://github.com/SwissCheese26/engine-sandbox/issues/5), [#8](https://github.com/SwissCheese26/engine-sandbox/issues/8))
