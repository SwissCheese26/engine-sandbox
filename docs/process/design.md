# Designkonzept: „Prüfzelle“

## Thema
Das Spiel ist ein Motorenprüfstand. Wer es öffnet, steht in einer Prüfzelle. Links ist die Werkbank, auf der der Motor zusammengestellt wird. In der Mitte steht der Motor als lebendes Schnittbild. Darunter liegen die Instrumententafel und ein Linienschreiber, der jeden Lauf auf Papier mitschreibt.

**Zielgruppe:** Auto- und Technikbegeisterte, die schrauben und ausprobieren wollen.
**Hauptaufgabe:** konfigurieren, dann Gas geben und die Folgen sehen, hören und ablesen.

## Farben (Tokens in `src/ui/styles/tokens.css`)
| Name | Hex | Rolle |
|---|---|---|
| Hammerschlag | `#46564F` | Grundfläche der Zelle, Maschinenlack |
| Hammerschlag tief | `#2E3A35` | Vertiefungen, Instrumentenhintergrund |
| Typenschild-Alu | `#D3D6CF` | Werkbank-Platten, helle Flächen |
| Gravur | `#23292A` | Text auf Alu, Skalen |
| Signalgelb (RAL 1003) | `#F6A800` | ausschließlich Grenzen: roter Bereich, Warnungen, Schäden |
| Schreiberpapier | `#ECEBDD` | nur im Linienschreiber, Raster `#B9C9B5` |
| Tinte Drehmoment | `#B3261E` | Schreiberspur Drehmoment |
| Tinte Leistung | `#23408E` | Schreiberspur Leistung |

Temperaturen werden nur in Daten gefärbt, als Verlauf von kalt (Gravur-Blau) bis heiß (Signalgelb). Es gibt keine dekorativen Verläufe.

## Schrift
- **Barlow** (Google Fonts) für alles. Die Schrift ist aus Verkehrsschildern abgeleitet, nüchtern und nah an DIN.
- Zahlen in **Barlow Semi Condensed**, mit `font-variant-numeric: tabular-nums`, damit Live-Werte nicht springen.
- Großbuchstaben gibt es nur auf dem Typenschild. Das ist echtes Typenschild-Vokabular und keine Label-Mode.
- Schriftgrade (Modular Scale 1,25): 12 · 14 · 16 · 20 · 25 · 31 · 39 px.

## Layout
```
Desktop ≥ 1100px
┌───────────┬──────────────────────────────────┐
│ Werkbank  │  Motor-Schnittbild (SVG, live)   │
│ Alu-      │                    [Typenschild] │
│ platten   ├──────────────────────────────────┤
│ je Gruppe │  Instrumente (Rundinstrumente)   │
│ (scroll)  ├──────────────────────────────────┤
│           │  Linienschreiber (Papierstreifen)│
└───────────┴──────────────────────────────────┤
  Bedienpult: Zündung · Starter · Prüfstand-Modus   [Pedal ▮]
```
Mobil: Die Zelle wird gestapelt. Die Werkbank ist eine ausklappbare Lade, das Pedal bleibt unten rechts im Daumenbereich. Alles ist linksbündig, Zahlen stehen rechtsbündig in ihren Feldern.

## Prinzipien
1. **Die Mutigkeit steckt im Linienschreiber.** Ein Papierstreifen läuft durch, Stifte schreiben Drehzahl, Drehmoment und Leistung live mit, und das Volllastdiagramm erscheint als gedruckter Bogen. Alles andere bleibt ruhig.
2. **Gelb heißt Grenze.** Wenn etwas gelb ist, ist etwas am Limit. Das gilt immer und ohne Ausnahme.
3. **Jede Zahl hat eine Einheit**, und jede Einstellung zeigt sofort ihre Wirkung. Jede Werkbank-Platte hat eine kurze Wirkungszeile, z. B. „+ Verdichtung → besserer Wirkungsgrad, höherer Spitzendruck“.
4. **Bedienelemente wie in der Zelle:** Kippschalter für die Zündung, ein Taster für den Starter, ein großer vertikaler Pedalschieber. Sie müssen per Tastatur bedienbar sein: Leertaste oder W gibt Gas, S bremst (Rollenprüfstand), A betätigt den Starter, I schaltet die Zündung.
5. **Bewegung nur als Antwort.** Nadeln, Stifte und das Schnittbild bewegen sich, weil der Motor läuft. Es gibt keine Einblend-Animationen. `prefers-reduced-motion` dämpft die Nadeln.
6. **Sprache:** Deutsch, Satzanfang groß, aktive Verben. „Motor starten“, nicht „Submit“.

## Review gegen Standard-Muster
- Es gibt keinen cremefarbenen Hintergrund mit Terrakotta-Akzent. Papierfarbe kommt nur im Schreiber vor, wo sie fachlich echt ist.
- Es ist kein fast schwarzer Hintergrund mit Neon-Akzent. Die Grundfarbe ist mittleres Maschinengrün-Grau, Gelb ist semantisch.
- Es gibt kein SaaS-Kartenraster. Die Werkbank-Platten sind Alu mit Schrauben-Ecken, Radien folgen der Hierarchie (Platten 3 px, Taster rund, Instrumente kreisrund).
- Es gibt keine Eyebrow-Labels in Großbuchstaben und keine Pfeile an Buttons.

## Cockpit-Layout (Issue #26)
Neben der Prüfzelle gibt es drei weitere Ansichten (Einstellungen → Ansicht, Schnellumschalter in der Kopfleiste). Sie zeigen dieselben Daten, nur anders. Gerechnet wird nichts doppelt (`src/ui/layouts/`).

**Cockpit / Kombiinstrument: Nachtfahrt.** Das Kombiinstrument sitzt unter einer Hutze aus dunklem Maschinenlack (`--ck-housing #1A221F`), oben rund und unten gerade, weil dort das Armaturenbrett weitergeht. Die Zifferblätter sind dunkel (`--ck-face #121816`) mit einem dünnen Ring aus Typenschild-Alu. Ziffern und Skalen leuchten im warmen **Instrumentenlicht** `#EFE6CC`, wie die Glühlampen hinter einem Tacho der 90er. Die Zeiger sind **Zeigerrot** `#FF5A2E` mit leichtem Schein. Das ist die eine mutige Stelle der Ansicht, alles andere bleibt dunkel und ruhig.
```
┌──────────── Kontrollleuchten (aus = unsichtbar) ────────────┐
│  ◜ Tacho ◝      ┌ Mitteldisplay ┐      ◜ Drehzahl ◝        │
│ (km/h | mph)    │ Gang  Tempo   │     (1/min×1000, Grenz-   │
│                 │ Außen, Gesamt,│      bereich gelb)        │
│                 │ Trip A, Ø,    │                           │
│                 │ Tempomat      │                           │
│   Kühlmittel · Öl · Öldruck · Ladedruck · Verbrauch         │
└─────────────────────────────────────────────────────────────┘
  Rollenprüfstand-Pult darunter, Werkbank als Lade, Bedienpult unten
```
- **Gelb heißt Grenze** gilt weiter: Der Drehzahlmesser zeigt Gelb als Vorwarnung ab 500 1/min unter dem Begrenzer oder ab der mechanisch sicheren Drehzahl, wenn diese niedriger ist. Die Grenzbereiche der kleinen Instrumente sind ebenfalls Signalgelb.
- **Rote Zone ab dem Drehzahlbegrenzer** (nur im Drehzahlmesser des Cockpits): Jeder Fahrer kennt den roten Bereich aus dem Auto. Im Kombiinstrument ist er die übliche Konvention, und ein gelber Bereich allein würde dort wie ein Fehler wirken. Die Arbeitsteilung bleibt eindeutig: Gelb heißt „du näherst dich der Grenze“, Rot heißt „hier regelt der Begrenzer ab“. Rot kommt sonst nur bei den Kontrollleuchten vor.
- **Kontrollleuchten** dürfen die Fahrzeugfarben nach ISO 2575 tragen: Rot für Ladekontrolle, Öldruck und Kühlmittel, Bernstein für Motorkontrolle, Vorglühen, ABS und ESP, Weiß für Glätte und Grün für den Tempomat. Die Logik ist realistisch: Lampentest für 2 s nach „Zündung an“; bei stehendem Motor leuchten Ladekontrolle, Öldruck und Motorkontrolle; ESP blinkt, solange ASR oder ESP eingreifen.
- Im **Motorprüfstand-Modus** ruht der Tacho gedimmt, das Mitteldisplay zeigt „–“ und bietet „Auf die Rolle“ an.
- Mobil (< 900 px): Die beiden Rundinstrumente stehen nebeneinander, das Mitteldisplay liegt quer darunter.

**Renn-Dash.** Ein digitales Display wie im Motorsport. Die Schaltblitz-Leiste hat 12 LEDs (Grün → Gelb → Rot). Am optimalen Schaltpunkt blinken alle LEDs blau mit 8 Hz, bei reduzierter Bewegung leuchten sie dauerhaft. Der Schaltpunkt wird aus der Volllastkurve berechnet: Es wird dort geschaltet, wo die Zugkraft im nächsten Gang größer ist. Die LEDs sind Signal-LEDs und tragen deshalb ihre Motorsport-Farben. Grenzen (Drehzahl-Grenzbereich, Öl/Wasser) bleiben Signalgelb.

**Kompakt.** Vier große Werte (Drehzahl, Tempo, Gang, Leistung) und ein Drehzahlbalken auf dem Hammerschlag der Prüfzelle. Das Pedal bleibt im Bedienpult unten. Diese Ansicht ist die Grundlage für das Touch-Overlay aus #44.

**Für alle Ansichten außer der Prüfzelle gilt:** Die Werkbank wird zur ausklappbaren Lade, und Schnittbild, Instrumententafel und Linienschreiber werden nicht gezeichnet. Der Schreiber misst im Hintergrund weiter. Canvas-Zifferblätter werden einmal je Größe vorgezeichnet. Pro Frame wird nur der Zeiger neu gezeichnet, und zwar nur dann, wenn er sich bewegt hat. Dabei wird die DPR berücksichtigt.
