// "Fehler melden" (#55, variant A): the pure part of the in-app bug report. Builds the diagnosis text the player
// sees (and can untick parts of) and the prefilled "New issue" link for the issue form .github/ISSUE_TEMPLATE/bug.yml.
// DOM-free so it can be unit tested (tests/ui/bug-report.test.ts); the dialog lives in bug-dialog.ts.

export const REPO_URL = "https://github.com/SwissCheese26/engine-sandbox";
/** Issue form file and label; the field ids below are the `id`s in bug.yml. */
export const ISSUE_TEMPLATE = "bug.yml";
export const ISSUE_LABEL = "bug-meldung";
export const FIELD_IDS = { description: "beschreibung", steps: "schritte", expected: "erwartet", diagnosis: "diagnose" } as const;
/** GitHub answers very long URLs with 414 / cuts the form; stay well below that. */
export const MAX_URL_LENGTH = 7000;
export const TRIM_NOTE = "\n… (gekürzt: der Link war zu lang)";

/** Fixed-size ring buffer (oldest entries drop out). */
export class RingBuffer<T> {
  private items: T[] = [];
  constructor(readonly capacity: number) {}
  push(v: T) {
    this.items.push(v);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  toArray(): T[] {
    return this.items.slice();
  }
  clear() {
    this.items = [];
  }
  get size(): number {
    return this.items.length;
  }
}

/** One sample of the live values (taken every SAMPLE_INTERVAL_S by the app). */
export interface ValueSample {
  /** Simulation time, s. */
  t: number;
  rpm: number;
  speedKmh: number;
  gear: string;
  /** 0…1 */
  pedal: number;
  braking: boolean;
  running: boolean;
}
export const SAMPLE_INTERVAL_S = 0.25;
/** About the last 5 s. */
export const SAMPLE_COUNT = 20;

/** Diagnosis block: one tickable section each. */
export interface DiagnosisSection {
  id: string;
  label: string;
  text: string;
}

export function samplesText(samples: readonly ValueSample[]): string {
  if (!samples.length) return "(keine Werte aufgezeichnet)";
  const t0 = samples[samples.length - 1]!.t;
  const rows = samples.map((s) =>
    [
      (s.t - t0).toFixed(2).padStart(6),
      Math.round(s.rpm).toString().padStart(5),
      s.speedKmh.toFixed(1).padStart(6),
      s.gear.padStart(4),
      Math.round(s.pedal * 100).toString().padStart(5),
      (s.braking ? "ja" : "-").padStart(6),
      s.running ? "ja" : "-",
    ].join(" "),
  );
  return ["  t[s]   rpm   km/h Gang Pedal Bremse Läuft", ...rows].join("\n");
}

/** Short browser / OS name from a user agent string (no version details beyond the major number). */
export function shortUserAgent(ua: string): string {
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "unbekannt";
  const m =
    /(Edg|OPR|SamsungBrowser|Firefox|FxiOS|CriOS)\/(\d+)/.exec(ua) ??
    /(Chrome)\/(\d+)/.exec(ua) ??
    (/Safari\//.test(ua) ? /(Version)\/(\d+)/.exec(ua) : null);
  const names: Record<string, string> = { Edg: "Edge", OPR: "Opera", SamsungBrowser: "Samsung Internet", FxiOS: "Firefox", CriOS: "Chrome", Version: "Safari" };
  const browser = m ? `${names[m[1]!] ?? m[1]} ${m[2]}` : "unbekannter Browser";
  return `${browser} auf ${os}`;
}

/** The diagnosis text from the ticked sections, in their order. */
export function buildDiagnosis(sections: readonly DiagnosisSection[], enabled: ReadonlySet<string> | null = null): string {
  return sections
    .filter((s) => !enabled || enabled.has(s.id))
    .map((s) => `### ${s.label}\n${s.text.trim()}`)
    .join("\n\n");
}

export interface BugReport {
  title: string;
  description: string;
  steps: string;
  expected: string;
  diagnosis: string;
}

export interface IssueLink {
  url: string;
  /** The diagnosis (or, if even that was not enough, the description) was shortened to fit the URL. */
  trimmed: boolean;
}

/** Issue title: the player's title, else the start of the description. */
export function issueTitle(r: Pick<BugReport, "title" | "description">): string {
  const t = (r.title.trim() || r.description.trim().split("\n")[0] || "Fehlermeldung aus der App").replace(/\s+/g, " ");
  return `[Bug] ${t.length > 80 ? t.slice(0, 79) + "…" : t}`;
}

/** Markdown code fence longer than the longest backtick run in `text` (at least ```), so the text cannot close it. */
export function codeFence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function linkFor(r: BugReport): string {
  const q = new URLSearchParams();
  q.set("template", ISSUE_TEMPLATE);
  q.set("labels", ISSUE_LABEL);
  q.set("title", issueTitle(r));
  q.set(FIELD_IDS.description, r.description);
  q.set(FIELD_IDS.steps, r.steps);
  q.set(FIELD_IDS.expected, r.expected);
  if (r.diagnosis) {
    const fence = codeFence(r.diagnosis);
    q.set(FIELD_IDS.diagnosis, `${fence}\n${r.diagnosis}\n${fence}`);
  }
  return `${REPO_URL}/issues/new?${q.toString()}`;
}

/** Longest prefix of `text` (plus TRIM_NOTE) that keeps the link within `max`. */
function fit(text: string, make: (t: string) => string, max: number): string {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (make(text.slice(0, mid) + TRIM_NOTE).length <= max) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + TRIM_NOTE;
}

/**
 * Prefilled "New issue" link (issue form via ?template=…, fields by id). Too long: the diagnosis is cut from the end
 * first (the value table is the bulk), then the free texts.
 */
export function buildIssueUrl(r: BugReport, max = MAX_URL_LENGTH): IssueLink {
  let url = linkFor(r);
  if (url.length <= max) return { url, trimmed: false };
  const noDiag = linkFor({ ...r, diagnosis: "" });
  if (noDiag.length + 40 < max) {
    const diagnosis = fit(r.diagnosis, (d) => linkFor({ ...r, diagnosis: d }), max);
    return { url: linkFor({ ...r, diagnosis }), trimmed: true };
  }
  // the player's texts alone are too long: keep a stub of the diagnosis, then shorten each text in turn
  let cur: BugReport = { ...r, diagnosis: fit(r.diagnosis, (d) => linkFor({ ...r, description: "", steps: "", expected: "", diagnosis: d }), Math.min(1500, max / 4)) };
  for (const k of ["steps", "expected", "description"] as const) {
    if (linkFor(cur).length <= max) break;
    cur = { ...cur, [k]: fit(cur[k], (v) => linkFor({ ...cur, [k]: v }), max) };
  }
  url = linkFor(cur);
  return { url, trimmed: true };
}

/** Error text for the console-error ring buffer: one line, no long stack, capped. */
export function errorLine(message: string, source?: string, line?: number): string {
  // only the file name of the source (no host/path), keeps it short and free of anything local
  const file = source ? source.split(/[/\\]/).pop()?.split("?")[0] : "";
  const where = file ? ` (${file}${line ? `:${line}` : ""})` : "";
  const msg = message.replace(/\s+/g, " ").trim();
  return (msg.length > 240 ? msg.slice(0, 239) + "…" : msg) + where;
}
