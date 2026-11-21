// Changelog (#50): the one source for CHANGELOG.md (scripts/changelog.ts) and the "Was ist neu" dialog in the
// main menu. Newest day first, written for players (German, short, concrete). Every user-facing PR adds its line
// here and regenerates CHANGELOG.md with `bun scripts/changelog.ts`.

export type ChangeKind = "neu" | "geändert" | "behoben";

export interface ChangeItem {
  kind: ChangeKind;
  text: string;
  /** Issue and PR numbers (GitHub links them the same way). */
  refs: number[];
}

export interface ChangelogEntry {
  /** Merge day in Europe/Berlin, YYYY-MM-DD. */
  date: string;
  title: string;
  items: ChangeItem[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-11-21",
    title: "Aufgeräumter Rollenprüfstand, Einstellungen pro Fahrzeug und Getriebeölkühler",
    items: [
      { kind: "geändert", text: "Rollenprüfstand aufgeräumt: Jede Einstellung gibt es nur noch einmal. Oben stehen die Anzeigen (Gang, Tempo, Vmax, 0–100, Getriebeöl, Tankinhalt, Bordcomputer), darunter die Abschnitte „Getriebe“ (Getriebeart, Achsübersetzung, Ölkühler, Gänge und Zugkraftdiagramm), „Fahrzeug & Reifen“ (Fahrzeugtyp, fertiges Fahrzeug, Vmax-Begrenzer, Karosserie, Reifen) und „Umwelt & Assistenten“. Die berechnete Vmax steht nur noch einmal, unter dem Zugkraftdiagramm.", refs: [112] },
      { kind: "geändert", text: "Einstellungen gelten pro Fahrzeug: Eigene Gänge, Getriebeart, Achsübersetzung, Reifen, Antrieb, Karosserie, Tankgröße, Vmax-Begrenzer und Ölkühler bleiben beim Fahrzeug, an dem du sie geändert hast. Ein anderes Fahrzeug startet im Werkszustand, beim Zurückwechseln sind deine Änderungen wieder da. Bisher gespeicherte Gänge übernimmt das zuletzt gefahrene Fahrzeug.", refs: [112] },
      { kind: "neu", text: "„Auf Werkszustand zurücksetzen“ unter „Fahrzeug & Reifen“ verwirft die eigenen Änderungen am aktuellen Fahrzeug.", refs: [112] },
      { kind: "neu", text: "Getriebeölkühler wählbar: „Serie“, „Ölkühler (Zubehör)“ (Luft-Öl-Kühler im Fahrtwind, kühlt bei schneller Fahrt deutlich, im Stand kaum) und „Aus“ bei Getrieben, die ab Werk einen Kühler haben.", refs: [112, 100] },
    ],
  },
  {
    date: "2026-11-20",
    title: "Engine Builder, Nutzfahrzeug-Cockpit, Getriebeöltemperatur und echte Launch Control",
    items: [
      { kind: "neu", text: "Engine Builder im Hauptmenü (Tor 2): Motor Schritt für Schritt bauen, von Kraftstoff und Block über Zylinderkopf, Gemisch, Turbo, Abgas und Kühlung bis zu Begrenzer und Steuergerät. Zu jeder Wahl steht dabei, was sie bewirkt, daneben siehst du Hubraum, Leistung, Drehmoment und Gewicht live. Unbaubare Werte halten „Weiter“ auf.", refs: [72, 107] },
      { kind: "neu", text: "Eigene Motoren speichern, umbenennen und löschen. Ein fertiger Motor lässt sich direkt im Stand hochdrehen (Zündung, Starter, Handgas, Ton) oder in der Sandbox fahren. Er steht auch in der Werkbank und bei „Eigenes Fahrzeug“ zur Wahl.", refs: [72, 107] },
      { kind: "neu", text: "Cockpit-Design „Nutzfahrzeug“: Tacho bis 125 km/h mit Markierung des Begrenzers, Drehzahlmesser mit grünem Bereich (Drehmomentplateau) und Anzeige der Motorbremse. Mit „Automatisch“ erscheint es bei Lkw und Bus von selbst.", refs: [83, 106] },
      { kind: "neu", text: "Zusatzinstrumente wie im Tuning-Auto: Ladedruck, Öldruck, Öltemperatur, Lambda und Abgastemperatur, als Rundinstrumente oder Balken, unter „+ Zusatzanzeigen“ im Cockpit.", refs: [83, 106] },
      { kind: "neu", text: "Tuning-Leiste: Ladedruck Soll und Ist, Zündung bzw. Förderbeginn gegenüber dem Kennfeld, Vollast-λ bzw. Rauchgrenze, Klopfen und die Leistungsgrenze des Steuergeräts, mit Hinweis, wenn sie greift.", refs: [83, 106] },
      { kind: "neu", text: "Das Getriebe hat jetzt eine eigene Öltemperatur. Sie steigt unter Last, beim Anfahren am Berg und mit schleifender Kupplung, und der Fahrtwind kühlt. Kaltes Öl ist zäh und kostet etwas Leistung. Zu sehen ist sie im Getriebe-Pult und als Feld „Getriebeöl“ im Digital-Cockpit.", refs: [53, 102] },
      { kind: "neu", text: "Wird das Getriebe zu heiß, leuchtet die Lampe „Getriebe heiß“. DSG und Automatik gehen in den Notlauf und begrenzen die Leistung. Mit „Realistisch“ kann das Getriebe Schaden nehmen, mit „Sandbox“ nicht.", refs: [53, 102] },
      { kind: "geändert", text: "Launch Control arbeitet jetzt wie im echten Auto: Die Drosselklappe bleibt offen, ein zweiter Drehzahlbegrenzer hält die Startdrehzahl, und Turbomotoren bauen mit Spätzündung schon im Stand Ladedruck auf. Der Skyline GT-R R34 schafft damit 0–100 in etwa 5,4 s.", refs: [38, 101, 103] },
      { kind: "behoben", text: "Nissan RB26DETT (Skyline GT-R): Die Nockenwelle ist jetzt anhand der Werks-Steuerzeiten als milde Turbo-Nocke eingeschätzt. Das Drehmoment liegt früher an (386 Nm, Plateau ab 3500 1/min) und die Leistung realistisch bei 216 kW statt 244 kW.", refs: [89, 103] },
    ],
  },
  {
    date: "2026-11-16",
    title: "Geführter Start, einfachere Ansichten und Credits",
    items: [
      { kind: "neu", text: "Die Sandbox führt jetzt Schritt für Schritt hinein: Fahrzeugart, Fahrzeug (mit PS, Gewicht, Getriebe und Tank), Strecke und zum Schluss „Kurz erklärt“, wo Zündung, Gas, Schalten, Handbremse, Tempomat, Umwelt und Einstellungen liegen. „Weiter wie zuletzt“ bleibt der schnelle Weg hinein.", refs: [93, 95] },
      { kind: "neu", text: "Eigenes Fahrzeug direkt beim Start: Auto, Lkw oder Motorrad mit eigenem Gewicht, cW-Wert, Stirnfläche, Reifen, Antrieb, Getriebe, Tank und einem Motor aus der Bibliothek.", refs: [93, 95] },
      { kind: "geändert", text: "Oben gibt es nur noch zwei Ansichten: Prüfzelle und Cockpit. Renn-Dash ist jetzt ein Cockpit-Design, Kompakt steckt im Design Head-up (mit Drehzahl und Leistung groß). Deine bisherige Wahl wird übernommen.", refs: [94, 96] },
      { kind: "geändert", text: "Das Cockpit-Design wählst du in den Einstellungen aus einer kurzen Liste mit Name und Beschreibung, direkt unter „Cockpit“.", refs: [94, 96] },
      { kind: "neu", text: "Renn-Dash im Cockpit mit Kontrollleuchten, (P)-Leuchte, Tempomat-Anzeige und Tankanzeige.", refs: [94, 96] },
      { kind: "neu", text: "„Credits“ im Hauptmenü: wer die Prüfzelle gebaut hat.", refs: [94, 96] },
      { kind: "geändert", text: "Die Reifengröße wählst du jetzt aus drei Listen: Breite, Querschnitt und Zoll, darunter stehen Durchmesser und Abrollumfang. Es gibt passende Größen für Autos, Motorräder sowie Lkw und Busse. Ungewöhnliche Kombinationen bekommen einen Hinweis. Ein gespeichertes eigenes Fahrzeug wird übernommen.", refs: [97, 98] },
      { kind: "neu", text: "In der Fahrzeugliste beim Start gibt es „+ Neues erstellen“: Das Formular für ein eigenes Fahrzeug öffnet sich direkt mit der passenden Fahrzeugart.", refs: [97, 98] },
    ],
  },
  {
    date: "2026-11-15",
    title: "Handbremse und Auto-Hold",
    items: [
      { kind: "neu", text: "Handbremse mit Auto-Hold: Im Stand hält sie das Auto von selbst, auch am Berg, Gas geben löst sie. Rote (P)-Leuchte in jedem Cockpit und eine P-Taste neben der Bremse; Auto-Hold lässt sich in den Einstellungen abschalten.", refs: [91, 92] },
      { kind: "behoben", text: "Das Auto rollt im Stand nicht mehr von selbst los, und mit angezogener Handbremse lassen sich die Übersetzungen ändern.", refs: [91, 92] },
    ],
  },
  {
    date: "2026-11-14",
    title: "Was ist neu",
    items: [
      { kind: "neu", text: "„Was ist neu“ im Hauptmenü: alle Änderungen auf einen Blick, mit Hinweis auf Neues seit deinem letzten Besuch.", refs: [50, 88] },
      { kind: "behoben", text: "Das Fenster „Fehler melden“ ist jetzt richtig gestaltet.", refs: [50, 88] },
    ],
  },
  {
    date: "2026-11-12",
    title: "Lkw, Busse und neue Cockpits",
    items: [
      { kind: "neu", text: "Lkw und Busse: Lkw- und Busdiesel, Motorbremse, Sattelzug und Stadtbus.", refs: [31, 82] },
      { kind: "neu", text: "Sechs neue Cockpit-Designs: Nachtfahrt, Sportlimousine, Oldschool, Digital, Head-up und Motorrad.", refs: [83, 84] },
      { kind: "neu", text: "„Fehler melden“ direkt im Spiel, mit Diagnose, die du vor dem Absenden prüfen kannst.", refs: [55, 79] },
      { kind: "neu", text: "Zündschlüssel und Startknopf; der Ton ist gleich eingeschaltet.", refs: [85] },
      { kind: "geändert", text: "Ruhigere Bedienleiste: Hinweise zu Grenzwerten erscheinen als kurze Einblendungen.", refs: [85] },
      { kind: "geändert", text: "Handy und Tablet: Touch wird erkannt, der Bildschirm bleibt an, kurze Vibration als Rückmeldung; neue Einstellungen dazu.", refs: [44, 66, 80] },
    ],
  },
  {
    date: "2026-11-08",
    title: "Strecken, Tank und Schaltknöpfe",
    items: [
      { kind: "neu", text: "Strecken mit Höhenprofil: Flachland, Hügel, Alpenpass, Bergauf und Bergab.", refs: [48, 57] },
      { kind: "neu", text: "Vor der Sandbox wählst du eine Strecke; der Tempomat hat Symbole und eine Markierung am Tacho.", refs: [61] },
      { kind: "neu", text: "Tank mit echtem Volumen, Tankuhr, Reservelampe und Volltanken; die Tankgröße ist einstellbar.", refs: [75, 76] },
      { kind: "neu", text: "Schaltknöpfe in der Bedienleiste, mit Einstellung und Beispielbild.", refs: [71] },
      { kind: "neu", text: "Einstellung für den Gashebel auf der Rolle: zurückfedern oder Handgas.", refs: [64] },
      { kind: "neu", text: "Citroën C1 1.0 (2008, 68 PS) in der Bibliothek; Motorräder mit echtem Gewicht.", refs: [65, 67] },
      { kind: "behoben", text: "Die Motorliste zeigt wieder die passenden Autos zum Motor.", refs: [69] },
      { kind: "behoben", text: "Cockpit am Handy: Tempomat und Mitteldisplay rutschen unter die kleinen Anzeigen.", refs: [68, 70] },
      { kind: "behoben", text: "Schaltknöpfe und Bremse sitzen auf Höhe des Gashebels.", refs: [73] },
    ],
  },
  {
    date: "2026-11-07",
    title: "Hauptmenü, Tempomat und Ansichten",
    items: [
      { kind: "neu", text: "Hauptmenü mit Werkstatttoren und Einstellungen; Einheiten gelten jetzt überall.", refs: [24, 42, 45] },
      { kind: "neu", text: "Tempomat und Limiter.", refs: [30, 46] },
      { kind: "neu", text: "Ansichten: Cockpit-Kombiinstrument, Renn-Dash und Kompakt.", refs: [26, 47] },
      { kind: "neu", text: "Tacho-Skala wählbar; das Fahrzeug passt sich dem gewählten Serienmotor an.", refs: [49] },
      { kind: "neu", text: "Bremspedal auf dem Handy.", refs: [52] },
      { kind: "behoben", text: "Der Linienschreiber läuft in allen Ansichten.", refs: [51] },
      { kind: "behoben", text: "Der Gashebel federt auf der Rolle zurück; das Cockpit zeigt Gefälle.", refs: [54] },
      { kind: "behoben", text: "Motor aus im Gang: Die Kupplung bleibt geschlossen, das Auto rollt nicht einfach weiter.", refs: [56] },
    ],
  },
  {
    date: "2026-11-06",
    title: "Bordcomputer",
    items: [
      { kind: "neu", text: "Bordcomputer mit Gesamtkilometern und Trip A samt Durchschnittsverbrauch.", refs: [40, 41, 43] },
    ],
  },
  {
    date: "2026-11-03",
    title: "Tuning, Motorräder und Fahrzeuge",
    items: [
      { kind: "neu", text: "Tuning-Stufen, Drehmomentbegrenzung im Steuergerät und Pops & Bangs.", refs: [16, 18, 35] },
      { kind: "neu", text: "Motorräder: eigene Bauformen, Luftkühlung, Motorbibliothek und Motorrad auf der Rolle.", refs: [25, 36] },
      { kind: "neu", text: "Fahrzeuge mit Reifen und Traktion, dazu fertige Autos zur Auswahl.", refs: [22, 37] },
      { kind: "neu", text: "Umwelt und Fahrassistenten: Nässe, Schnee und Eis, ABS, ASR, ESP und Kontrollleuchten.", refs: [23, 39] },
    ],
  },
  {
    date: "2026-11-02",
    title: "Diesel, Benziner und Rollenprüfstand",
    items: [
      { kind: "neu", text: "Diesel und Benziner mit realistischem Verbrennungsmodell.", refs: [3, 17] },
      { kind: "neu", text: "Turbo, Motortemperatur, Belastungsgrenzen und Motorgewicht.", refs: [4, 12] },
      { kind: "neu", text: "Rollenprüfstand mit Handschaltung, DSG und CVT.", refs: [14, 19] },
      { kind: "neu", text: "Motorbibliothek mit 17 Serienmotoren; Kühler bis 2000 kW.", refs: [15, 27] },
      { kind: "neu", text: "Motor warm oder kalt starten; Gasannahme einstellbar, Abgas kühlt realistisch ab.", refs: [28, 29] },
      { kind: "neu", text: "Vmax-Begrenzer, auf Wunsch abschaltbar.", refs: [32, 34] },
      { kind: "neu", text: "Einheiten per Klick wechseln (PS, lb·ft, l/100 km …).", refs: [21] },
      { kind: "geändert", text: "Steuerung: S bremst, der Anlasser liegt auf A.", refs: [20] },
    ],
  },
  {
    date: "2026-10-29",
    title: "Motorsound",
    items: [
      { kind: "neu", text: "Motorsound, live aus Drehzahl und Last erzeugt.", refs: [6, 11, 13] },
    ],
  },
  {
    date: "2026-10-28",
    title: "Die erste Prüfzelle",
    items: [
      { kind: "neu", text: "Werkbank zum Motorbau, Instrumente, Linienschreiber und Bedienpult.", refs: [5, 8] },
    ],
  },
];

export const KIND_LABEL: Record<ChangeKind, string> = { neu: "Neu", geändert: "Geändert", behoben: "Behoben" };

/** Problems with the data (empty = valid): dates, order, texts and refs. */
export function validateChangelog(list: ChangelogEntry[]): string[] {
  const out: string[] = [];
  let prev = "";
  for (const e of list) {
    const d = new Date(`${e.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== e.date) out.push(`ungültiges Datum ${e.date}`);
    if (prev && e.date >= prev) out.push(`${e.date} nicht absteigend sortiert (nach ${prev})`);
    prev = e.date;
    if (!e.title.trim()) out.push(`${e.date}: Titel fehlt`);
    if (!e.items.length) out.push(`${e.date}: keine Einträge`);
    for (const it of e.items) {
      if (!it.text.trim()) out.push(`${e.date}: leerer Text`);
      if (!(it.kind in KIND_LABEL)) out.push(`${e.date}: unbekannte Art ${it.kind}`);
      if (!it.refs.length || it.refs.some((r) => !Number.isInteger(r) || r <= 0)) out.push(`${e.date}: ungültige Verweise bei „${it.text}“`);
    }
  }
  return out;
}

/** Entries newer than the date the player last saw (all when never seen). */
export function unseenEntries(list: ChangelogEntry[], seen: string | null): ChangelogEntry[] {
  return seen ? list.filter((e) => e.date > seen) : list;
}
