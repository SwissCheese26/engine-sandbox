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
4. **Bedienelemente wie in der Zelle:** Kippschalter für die Zündung, ein Taster für den Starter, ein großer vertikaler Pedalschieber. Sie müssen per Tastatur bedienbar sein: Leertaste oder W gibt Gas, S startet, I schaltet die Zündung.
5. **Bewegung nur als Antwort.** Nadeln, Stifte und das Schnittbild bewegen sich, weil der Motor läuft. Es gibt keine Einblend-Animationen. `prefers-reduced-motion` dämpft die Nadeln.
6. **Sprache:** Deutsch, Satzanfang groß, aktive Verben. „Motor starten“, nicht „Submit“.

## Review gegen Standard-Muster
- Es gibt keinen cremefarbenen Hintergrund mit Terrakotta-Akzent. Papierfarbe kommt nur im Schreiber vor, wo sie fachlich echt ist.
- Es ist kein fast schwarzer Hintergrund mit Neon-Akzent. Die Grundfarbe ist mittleres Maschinengrün-Grau, Gelb ist semantisch.
- Es gibt kein SaaS-Kartenraster. Die Werkbank-Platten sind Alu mit Schrauben-Ecken, Radien folgen der Hierarchie (Platten 3 px, Taster rund, Instrumente kreisrund).
- Es gibt keine Eyebrow-Labels in Großbuchstaben und keine Pfeile an Buttons.
