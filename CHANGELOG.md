# Changelog

Alle sichtbaren Änderungen an der Prüfzelle, neueste zuerst. Aufbau nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

_Diese Datei wird erzeugt: Einträge stehen in `src/data/changelog.ts`, danach `bun scripts/changelog.ts` ausführen._

## 2026-11-12 – Lkw, Busse und neue Cockpits

### Neu

- Lkw und Busse: Nfz-Dieselmotoren, Motorbremse, Sattelzug und Stadtbus. ([#31](https://github.com/SwissCheese26/engine-sandbox/issues/31), [#82](https://github.com/SwissCheese26/engine-sandbox/issues/82))
- Sieben Cockpit-Designs zur Wahl: Nachtfahrt, Sportlimousine, Oldschool, Digital, Head-up und Motorrad. ([#83](https://github.com/SwissCheese26/engine-sandbox/issues/83), [#84](https://github.com/SwissCheese26/engine-sandbox/issues/84))
- „Fehler melden“ direkt im Spiel, mit Diagnose, die du vor dem Absenden prüfen kannst. ([#55](https://github.com/SwissCheese26/engine-sandbox/issues/55), [#79](https://github.com/SwissCheese26/engine-sandbox/issues/79))
- Zündschlüssel und Startknopf; der Ton ist von Anfang an an. ([#85](https://github.com/SwissCheese26/engine-sandbox/issues/85))

### Geändert

- Ruhigere Bedienleiste: Hinweise zu Grenzwerten erscheinen als kurze Einblendungen. ([#85](https://github.com/SwissCheese26/engine-sandbox/issues/85))
- Handy und Tablet: Touch wird erkannt, der Bildschirm bleibt an, Vibration beim Schalten; neue Einstellungen dazu. ([#44](https://github.com/SwissCheese26/engine-sandbox/issues/44), [#66](https://github.com/SwissCheese26/engine-sandbox/issues/66), [#80](https://github.com/SwissCheese26/engine-sandbox/issues/80))

## 2026-11-08 – Strecken, Tank und Schaltknöpfe

### Neu

- Strecken mit Höhenprofil: Flachland, Hügel, Alpenpass, Bergauf und Bergab. ([#48](https://github.com/SwissCheese26/engine-sandbox/issues/48), [#57](https://github.com/SwissCheese26/engine-sandbox/issues/57))
- Vor der Sandbox wählst du eine Strecke; der Tempomat hat Symbole und eine Markierung am Tacho. ([#61](https://github.com/SwissCheese26/engine-sandbox/issues/61))
- Tank mit echtem Volumen, Tankuhr, Reservelampe und Volltanken; die Tankgröße ist einstellbar. ([#75](https://github.com/SwissCheese26/engine-sandbox/issues/75), [#76](https://github.com/SwissCheese26/engine-sandbox/issues/76))
- Schaltknöpfe in der Bedienleiste, mit Einstellung und Beispielbild. ([#71](https://github.com/SwissCheese26/engine-sandbox/issues/71))
- Einstellung für den Gashebel auf der Rolle: zurückfedern oder Handgas. ([#64](https://github.com/SwissCheese26/engine-sandbox/issues/64))
- Citroën C1 1.0 (2008, 68 PS) in der Bibliothek; Motorräder mit echtem Gewicht. ([#65](https://github.com/SwissCheese26/engine-sandbox/issues/65), [#67](https://github.com/SwissCheese26/engine-sandbox/issues/67))

### Geändert

- Zuverlässigere Veröffentlichung, auch wenn GitHub kurz hakt. ([#62](https://github.com/SwissCheese26/engine-sandbox/issues/62), [#63](https://github.com/SwissCheese26/engine-sandbox/issues/63))

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
- Rechenwerte werden gegen echte Referenzmotoren geprüft. ([#7](https://github.com/SwissCheese26/engine-sandbox/issues/7), [#10](https://github.com/SwissCheese26/engine-sandbox/issues/10))

## 2026-10-29 – Motorsound

### Neu

- Motorsound, live aus Drehzahl und Last erzeugt. ([#6](https://github.com/SwissCheese26/engine-sandbox/issues/6), [#11](https://github.com/SwissCheese26/engine-sandbox/issues/11), [#13](https://github.com/SwissCheese26/engine-sandbox/issues/13))

## 2026-10-28 – Die erste Prüfzelle

### Neu

- Werkbank zum Motorbau, Instrumente, Linienschreiber und Bedienpult. ([#5](https://github.com/SwissCheese26/engine-sandbox/issues/5), [#8](https://github.com/SwissCheese26/engine-sandbox/issues/8))
