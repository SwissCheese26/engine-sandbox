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
    date: "2026-11-22",
    title: "Festbremsdrehzahl der Automatik: Bremse hält die Antriebsräder",
    items: [
      { kind: "behoben", text: "Automatik: Vollgas bei voll getretener Bremse lässt die Räder nicht mehr frei durchdrehen. Die Bremse hält jetzt auch die Antriebsräder, der Motor bleibt auf der Festbremsdrehzahl des Wandlers (z. B. ≈ 2000 1/min beim Land Cruiser statt durchdrehender Räder). Bei starken Hecktrieblern wie 530d und E 220 d nimmt die Steuerung wie in echt Motormoment zurück, damit die Bremse hält (≈ 1800 statt über 4000 1/min). Das Getriebeöl wird dabei schnell heiß.", refs: [104, 118, 119] },
      { kind: "geändert", text: "0–100 km/h zählt erst, wenn du aus dem Stand mit Gas losfährst (Gas gegen die Bremse zählt noch nicht). Gehst du unterwegs vom Gas oder bremst, wird der Lauf verworfen; kurze Schaltpausen sind erlaubt.", refs: [122, 123] },
      { kind: "geändert", text: "Schaltgetriebe warnen erst ab 130 °C Öltemperatur, weil sie keinen Schutzmodus haben. Die Erwärmung selbst war schon realistisch (etwa 10 °C pro Minute unter Dauervollgas).", refs: [53, 123] },
    ],
  },
  {
    date: "2026-11-21",
    title: "Elektroautos mit E-Tuner und E-Tacho, Zusatzinstrumente im Look jedes Cockpits, Druckluft, Retarder und AdBlue, Kurven mit Schräglage, Reifenqualm, aufgeräumter Rollenprüfstand, Einstellungen pro Fahrzeug und Getriebeölkühler",
    items: [
      { kind: "neu", text: "Elektroautos: Tesla Model S Long Range, Model S Plaid, Model X Plaid, Model Y Performance, Lucid Air Sapphire, VW ID.3 und ID.4 GTX. Sie stehen mit ⚡ in der Fahrzeugliste und im Start-Assistenten. Statt Zündschlüssel und Starter gibt es „Ready“, die Motoren hängen ohne Kupplung und Gänge direkt an den Rädern.", refs: [108, 115] },
      { kind: "neu", text: "Echte E-Physik: Der Akku bricht unter Last ein, wird warm und nimmt voll oder kalt kaum Rekuperation an. Gas lupfen und leicht bremsen rekuperiert, Allradler verteilen die Kraft auf die Achse mit Grip. Fahrmodi Chill, Sport und Plaid.", refs: [108, 115] },
      { kind: "neu", text: "Jedes Cockpit-Design hat eine Elektro-Variante: Leistungsanzeige mit grüner Rekuperation statt Drehzahlmesser, Ladezustand statt Tank, Reichweite und Ready-Leuchte. Neu ist das Design „E-Tacho“ mit Ladezustand, Reichweite, kWh/100 km, Akkutemperatur und Fahrmodus. „Automatisch“ wählt es im Elektroauto.", refs: [108, 115] },
      { kind: "neu", text: "E-Tuner: Motoren (1 bis 4, vorn und hinten), Motorgröße, Wechselrichterstrom, Akku (kWh, Zelltyp, C-Rate, 400/800 V), Kühlung und Reifen, gespeichert je Fahrzeug. Live siehst du PS und kW, was begrenzt, 0–100 und Reichweite. Bis etwa 2800 PS, solange Akkustrom, Wechselrichter und Haftung mitspielen. „Auf Werkszustand zurücksetzen“ bringt den Serienzustand zurück.", refs: [108, 115] },
      { kind: "neu", text: "Elektroautos klingen nach Elektroauto: Motor und Wechselrichter heulen mit der Drehzahl, dazu kommt das Getriebeheulen unter Last.", refs: [108, 115] },
      { kind: "neu", text: "Neues Zusatzinstrument „Getriebeöl“, rund oder als Balken: gelb ab der Warnschwelle, rot ab dem Notlauf des Getriebesteuergeräts (beim Handschalter ab der Schadensgrenze), passend zur Getriebeart. Es erscheint, sobald ein Fahrzeug auf dem Prüfstand steht.", refs: [53, 83, 109] },
      { kind: "neu", text: "Drehen die Räder durch oder blockieren sie, steigt unter den Instrumenten ein Hauch Reifenqualm auf, je mehr Schlupf und Tempo, desto mehr. Wird der Motor zu heiß, dampft es über dem Cockpit bzw. dem Motor-Schnittbild, bei kritischer Hitze oder Motorschaden dichter. Ein Motorschaden oder viel zu heißes Öl zeigt sich als bläulicher Rauch, ein rußender Diesel als dunkle Wolke. Abschalten lässt sich das unter Einstellungen › Effekte (Rauch/Dampf).", refs: [110, 114] },
      { kind: "geändert", text: "Die Zusatzinstrumente passen sich jetzt dem Cockpit-Design an: elfenbeinfarbene Blätter mit Chromring im Oldschool, orange Beleuchtung in der Nachtfahrt, tiefe Röhren in der Sportlimousine und kräftige Lkw-Instrumente im Nutzfahrzeug. In Digital, Head-up, Renn-Dash und Motorrad erscheinen sie als Kacheln oder Segmentbalken im Stil des Displays. Grenzwerte bleiben überall gelb.", refs: [83, 109] },
      { kind: "geändert", text: "Rollenprüfstand aufgeräumt: Jede Einstellung gibt es nur noch einmal. Oben stehen die Anzeigen (Gang, Tempo, Vmax, 0–100, Getriebeöl, Tankinhalt, Bordcomputer), darunter die Abschnitte „Getriebe“ (Getriebeart, Achsübersetzung, Ölkühler, Gänge und Zugkraftdiagramm), „Fahrzeug & Reifen“ (Fahrzeugtyp, fertiges Fahrzeug, Vmax-Begrenzer, Karosserie, Reifen) und „Umwelt & Assistenten“. Die berechnete Vmax steht nur noch einmal, unter dem Zugkraftdiagramm.", refs: [112, 113] },
      { kind: "geändert", text: "Einstellungen gelten pro Fahrzeug: Eigene Gänge, Getriebeart, Achsübersetzung, Reifen, Antrieb, Karosserie, Tankgröße, Vmax-Begrenzer und Ölkühler bleiben beim Fahrzeug, an dem du sie geändert hast. Ein anderes Fahrzeug startet im Werkszustand, beim Zurückwechseln sind deine Änderungen wieder da. Bisher gespeicherte Gänge übernimmt das zuletzt gefahrene Fahrzeug.", refs: [112, 113] },
      { kind: "neu", text: "„Auf Werkszustand zurücksetzen“ unter „Fahrzeug & Reifen“ verwirft die eigenen Änderungen am aktuellen Fahrzeug.", refs: [112, 113] },
      { kind: "neu", text: "Lkw und Bus haben jetzt Druckluftbremsen: Der Kompressor füllt den Vorrat bis 10 bar, jede Bremsung kostet Luft. Unter 5,5 bar leuchtet die rote Warnleuchte, unter 4,5 bar greifen die Federspeicher. Der Druck steht im Nutzfahrzeug-Design und als Zusatzinstrument „Druckluft“.", refs: [83, 117] },
      { kind: "neu", text: "Retarder für Lkw und Bus: Stufe 0–5 mit „−“ und „+“ im Nutzfahrzeug-Design, daneben die Bremsleistung. Er bremst bei Tempo kräftig und lässt bei Schrittgeschwindigkeit nach, zum Anhalten braucht es die Bremse.", refs: [83, 117] },
      { kind: "neu", text: "AdBlue bei Dieseln mit SCR: Der Tank leert sich mit etwa 5 % des Dieselverbrauchs. Bei Reserve leuchtet die AdBlue-Leuchte, ist er leer, blinkt sie und der Motor läuft im Notlauf mit weniger Leistung. Beim Tanken wird AdBlue mit aufgefüllt.", refs: [83, 117] },
      { kind: "neu", text: "Neue Anzeigen in allen Cockpits: Ansauglufttemperatur und Batteriespannung (12,6 V aus, rund 14,2 V bei laufendem Motor, beim Lkw 24-V-Bordnetz), auch in der Prüfzelle.", refs: [83, 105, 117] },
      { kind: "neu", text: "Flachland, Mittelgebirge und Alpen haben jetzt Kurven. Auf dem Motorrad zeigt das Cockpit die Schräglage, die das Tempo in der Kurve verlangt, in Signalfarbe, wenn der Reifen das nicht mehr hält.", refs: [83, 117] },
      { kind: "neu", text: "Getriebeölkühler wählbar: „Serie“, „Ölkühler (Zubehör)“ (Luft-Öl-Kühler im Fahrtwind, kühlt bei schneller Fahrt deutlich, im Stand kaum) und „Aus“ bei Getrieben, die ab Werk einen Kühler haben.", refs: [112, 113, 100] },
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
