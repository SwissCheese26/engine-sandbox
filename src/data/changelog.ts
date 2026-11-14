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
    date: "2026-11-14",
    title: "Was ist neu",
    items: [
      { kind: "neu", text: "„Was ist neu“ im Hauptmenü: alle Änderungen auf einen Blick, mit Hinweis auf Neues seit deinem letzten Besuch.", refs: [50] },
      { kind: "behoben", text: "Das Fenster „Fehler melden“ ist wieder richtig gestaltet.", refs: [50] },
    ],
  },
  {
    date: "2026-11-12",
    title: "Lkw, Busse und neue Cockpits",
    items: [
      { kind: "neu", text: "Lkw und Busse: Nfz-Dieselmotoren, Motorbremse, Sattelzug und Stadtbus.", refs: [31, 82] },
      { kind: "neu", text: "Sieben Cockpit-Designs zur Wahl: Nachtfahrt, Sportlimousine, Oldschool, Digital, Head-up und Motorrad.", refs: [83, 84] },
      { kind: "neu", text: "„Fehler melden“ direkt im Spiel, mit Diagnose, die du vor dem Absenden prüfen kannst.", refs: [55, 79] },
      { kind: "neu", text: "Zündschlüssel und Startknopf; der Ton ist von Anfang an an.", refs: [85] },
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
      { kind: "geändert", text: "Zuverlässigere Veröffentlichung, auch wenn GitHub kurz hakt.", refs: [62, 63] },
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
      { kind: "geändert", text: "Rechenwerte werden gegen echte Referenzmotoren geprüft.", refs: [7, 10] },
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
