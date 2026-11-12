// "Fehler melden" dialog (#55, variant A): description fields plus a visible, editable diagnosis the player can
// untick parts of. "Auf GitHub melden" opens the prefilled issue form (bug.yml) in a new tab; nothing is sent from
// the page itself, no token in the browser. Pure parts (text, link, trimming) are in bug-report.ts.
import {
  ISSUE_LABEL, RingBuffer, buildDiagnosis, buildIssueUrl, errorLine, shortUserAgent,
  type DiagnosisSection,
} from "./bug-report.ts";
import { LAYOUTS, getSettings } from "./settings.ts";

export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/** Sections the sandbox adds (view, engine, vehicle, environment, values); set by the App. */
let contextProvider: (() => DiagnosisSection[]) | null = null;
export function setBugContext(fn: (() => DiagnosisSection[]) | null) {
  contextProvider = fn;
}

/** Last console errors (window.onerror / unhandledrejection). */
const errors = new RingBuffer<string>(5);
let capturing = false;
export function installErrorCapture() {
  if (capturing) return;
  capturing = true;
  window.addEventListener("error", (e) => errors.push(errorLine(e.message || String(e.error ?? "Fehler"), e.filename, e.lineno)));
  window.addEventListener("unhandledrejection", (e) => {
    const r: unknown = e.reason;
    errors.push(errorLine(`Unbehandelt: ${r instanceof Error ? `${r.name}: ${r.message}` : String(r)}`));
  });
}

function baseSections(): { before: DiagnosisSection[]; after: DiagnosisSection[] } {
  const st = getSettings();
  const layout = LAYOUTS.find((l) => l.id === st.layout)?.label ?? st.layout;
  const touch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  return {
    before: [
      { id: "app", label: "App-Version", text: `Commit ${APP_VERSION}` },
      {
        id: "device",
        label: "Gerät und Browser",
        text: `${shortUserAgent(navigator.userAgent)}, Fenster ${innerWidth}×${innerHeight} px, Pixelverhältnis ${Math.round(devicePixelRatio * 100) / 100}, ${touch ? "Touch" : "kein Touch"}`,
      },
    ],
    after: [
      {
        id: "settings",
        label: "Einstellungen",
        text: `Einheiten ${st.preset}, Ansicht ${layout}, Tacho ${st.speedo}, Gas ${st.throttle}, Schaltknöpfe ${st.shiftPad}`,
      },
      { id: "errors", label: "Konsolenfehler", text: errors.size ? errors.toArray().map((e) => `- ${e}`).join("\n") : "(keine)" },
    ],
  };
}

/** All sections in display order (sandbox sections only once the sandbox was opened). */
export function collectSections(): DiagnosisSection[] {
  const { before, after } = baseSections();
  let ctx: DiagnosisSection[] = [];
  try {
    ctx = contextProvider?.() ?? [];
  } catch (e) {
    console.warn("Diagnose unvollständig", e);
  }
  if (!ctx.length) ctx = [{ id: "view", label: "Ansicht", text: `${location.hash || "#menu"} (Sandbox noch nicht geöffnet)` }];
  return [...before, ...ctx, ...after];
}

let instance: BugDialog | null = null;
/** Opens the one shared dialog (created on first use, appended to <body>). */
export function openBugReport(opener?: HTMLElement) {
  instance ??= new BugDialog();
  instance.open(opener);
}

/** Small "Fehler melden" button (icon + text, or icon only with `compact`). */
export function bugButton(compact: boolean, extraClass = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn btn--small bug-btn ${compact ? "bug-btn--icon" : ""} ${extraClass}`.trim();
  b.dataset.action = "bug-report";
  b.setAttribute("aria-haspopup", "dialog");
  if (compact) {
    b.setAttribute("aria-label", "Fehler melden");
    b.title = "Fehler melden";
  }
  b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3 2 20h20L12 3Zm0 6v5m0 3v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>${compact ? "" : "<span>Fehler melden</span>"}`;
  b.addEventListener("click", () => openBugReport(b));
  return b;
}

export class BugDialog {
  readonly el: HTMLDialogElement;
  private sections: DiagnosisSection[] = [];
  private q<T extends HTMLElement>(sel: string): T {
    return this.el.querySelector<T>(sel)!;
  }
  private opener: HTMLElement | null = null;
  /** The diagnosis text was edited by hand: ticking sections asks before overwriting it. */
  private edited = false;

  constructor() {
    const d = document.createElement("dialog");
    d.className = "routepick bugreport";
    d.setAttribute("aria-labelledby", "bugreport-title");
    d.innerHTML = `
      <form method="dialog" class="routepick__form bugreport__form">
        <h2 id="bugreport-title" class="routepick__title">Fehler melden</h2>
        <p class="routepick__lead">Die Meldung wird als Issue auf GitHub angelegt (dafür brauchst du ein GitHub-Konto). Ein Support-Assistent prüft sie zuerst: Dublette, nachstellbar, Fehler oder gewolltes Verhalten.</p>
        <label class="bugreport__field"><span>Kurzer Titel</span>
          <input type="text" name="title" maxlength="100" placeholder="z. B. Auto rollt im Leerlauf weg" autocomplete="off" /></label>
        <label class="bugreport__field"><span>Beschreibung <em>(Pflicht)</em></span>
          <textarea name="description" rows="3" required placeholder="Was ist passiert?"></textarea></label>
        <label class="bugreport__field"><span>Was hast du gemacht?</span>
          <textarea name="steps" rows="3" placeholder="1. Sandbox geöffnet&#10;2. …"></textarea></label>
        <label class="bugreport__field"><span>Was hast du erwartet?</span>
          <textarea name="expected" rows="2"></textarea></label>
        <fieldset class="bugreport__diag">
          <legend>Diagnose (wird mitgeschickt)</legend>
          <p class="bugreport__hint">Keine persönlichen Daten: nur Version, Gerätetyp, Spielzustand und die letzten Sekunden der Werte. Abwählen, was nicht mit soll; der Text lässt sich auch bearbeiten.</p>
          <div class="bugreport__checks" data-out="checks"></div>
          <textarea name="diagnosis" rows="8" class="num bugreport__text" spellcheck="false" aria-label="Diagnose-Text"></textarea>
          <p class="bugreport__note" data-out="note" role="status"></p>
        </fieldset>
        <p class="bugreport__privacy">Datenschutz: Das Issue ist öffentlich und erscheint unter deinem GitHub-Konto. Screenshots kannst du auf GitHub selbst anhängen.</p>
        <div class="routepick__foot">
          <button type="button" class="btn btn--small" data-action="copy">Diagnose kopieren</button>
          <a class="btn btn--small bugreport__send" data-action="send" target="_blank" rel="noopener" href="#">Auf GitHub melden<span class="sr-only"> (öffnet neuen Tab)</span></a>
          <button type="button" class="btn btn--small" data-action="cancel">Abbrechen</button>
        </div>
      </form>`;
    this.el = d;
    // keys typed here must not drive the engine (document handlers) or leave the sandbox (window Esc handler);
    // the dialog's own Esc (cancel) is the browser default and still works
    for (const t of ["keydown", "keyup"] as const) d.addEventListener(t, (e) => e.stopPropagation());
    d.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).getAttribute("name") === "diagnosis") this.edited = true;
      this.refreshLink();
    });
    d.addEventListener("change", (e) => {
      if ((e.target as HTMLInputElement).type === "checkbox") this.rebuildDiagnosis();
    });
    d.addEventListener("close", () => this.opener?.focus());
    this.q<HTMLAnchorElement>('[data-action="send"]').addEventListener("click", (e) => {
      const desc = this.q<HTMLTextAreaElement>('[name="description"]');
      if (!desc.value.trim()) {
        e.preventDefault();
        desc.focus();
        desc.reportValidity();
        return;
      }
      this.refreshLink();
      // the link opens in a new tab; the dialog closes here
      setTimeout(() => d.close(""), 0);
    });
    // Enter in the title field must not close the dialog (form method=dialog)
    this.q<HTMLFormElement>("form").addEventListener("submit", (e) => e.preventDefault());
    this.q<HTMLButtonElement>('[data-action="cancel"]').addEventListener("click", () => d.close(""));
    this.q<HTMLButtonElement>('[data-action="copy"]').addEventListener("click", () => void this.copy());
    document.body.append(d);
  }

  open(opener?: HTMLElement) {
    if (this.el.open) return;
    this.opener = opener ?? null;
    this.sections = collectSections();
    const box = this.q<HTMLElement>('[data-out="checks"]');
    box.replaceChildren(
      ...this.sections.map((s) => {
        const l = document.createElement("label");
        l.innerHTML = `<input type="checkbox" checked data-section="${s.id}" /> <span></span>`;
        l.querySelector("span")!.textContent = s.label;
        return l;
      }),
    );
    this.edited = false;
    this.rebuildDiagnosis();
    if (typeof this.el.showModal === "function") this.el.showModal();
    else this.el.setAttribute("open", "");
    this.q<HTMLInputElement>('[name="title"]').focus();
  }

  private rebuildDiagnosis() {
    const ta = this.q<HTMLTextAreaElement>('[name="diagnosis"]');
    if (this.edited && !confirm("Deine Änderungen am Diagnose-Text werden überschrieben. Fortfahren?")) return;
    const on = new Set([...this.el.querySelectorAll<HTMLInputElement>("[data-section]:checked")].map((c) => c.dataset.section!));
    ta.value = buildDiagnosis(this.sections, on);
    this.edited = false;
    this.refreshLink();
  }

  private val(name: string): string {
    return this.q<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`).value;
  }

  /** Current issue link (also read by the E2E test from the link's href). */
  refreshLink(): string {
    const { url, trimmed } = buildIssueUrl({
      title: this.val("title"),
      description: this.val("description"),
      steps: this.val("steps"),
      expected: this.val("expected"),
      diagnosis: this.val("diagnosis").trim(),
    });
    this.q<HTMLAnchorElement>('[data-action="send"]').href = url;
    this.q<HTMLElement>('[data-out="note"]').textContent = trimmed
      ? "Die Diagnose ist für den Link zu lang und wird gekürzt. Mit „Diagnose kopieren“ kannst du den vollständigen Text auf GitHub einfügen."
      : `Label „${ISSUE_LABEL}“, Vorlage „Fehlermeldung“.`;
    return url;
  }

  private async copy() {
    const ta = this.q<HTMLTextAreaElement>('[name="diagnosis"]');
    const note = this.q<HTMLElement>('[data-out="note"]');
    try {
      await navigator.clipboard.writeText(ta.value);
    } catch {
      // older browsers / no permission: select the text and use the legacy command
      ta.focus();
      ta.select();
      if (!document.execCommand?.("copy")) {
        note.textContent = "Kopieren nicht möglich: Text ist markiert, bitte selbst kopieren (Strg+C).";
        return;
      }
    }
    note.textContent = "Diagnose kopiert.";
  }
}
