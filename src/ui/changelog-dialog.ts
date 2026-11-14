// "Was ist neu" (#50): changelog dialog in the main menu, fed from src/data/changelog.ts (same source as
// CHANGELOG.md). Recent days are open, older ones collapsed (<details>). A "Neu" badge on the menu button shows
// entries newer than the last seen date (localStorage pruefzelle.changelogSeen); opening the dialog marks them seen.
import { CHANGELOG, KIND_LABEL, unseenEntries, type ChangelogEntry } from "../data/changelog.ts";

export const SEEN_KEY = "pruefzelle.changelogSeen";
/** Days (counted back from the newest entry) that start expanded. */
const RECENT_DAYS = 10;
const REPO = "https://github.com/SwissCheese26/engine-sandbox";

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function writeSeen(date: string) {
  try {
    localStorage.setItem(SEEN_KEY, date);
  } catch {
    // private mode / blocked storage: the badge simply comes back next time
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function entryHtml(e: ChangelogEntry, open: boolean, isNew: boolean): string {
  return `
    <details class="whatsnew__day"${open ? " open" : ""}>
      <summary><time datetime="${e.date}">${fmtDate(e.date)}</time> <span class="whatsnew__daytitle">${esc(e.title)}</span>${isNew ? ` <span class="whatsnew__new">Neu</span>` : ""}</summary>
      <ul class="whatsnew__items">
        ${e.items.map((i) => `
          <li class="whatsnew__item whatsnew__item--${i.kind === "geändert" ? "changed" : i.kind === "behoben" ? "fixed" : "new"}">
            <span class="whatsnew__kind">${KIND_LABEL[i.kind]}</span>
            <span>${esc(i.text)} ${i.refs.map((r) => `<a href="${REPO}/issues/${r}" target="_blank" rel="noopener">#${r}<span class="sr-only"> (öffnet neuen Tab)</span></a>`).join(" ")}</span>
          </li>`).join("")}
      </ul>
    </details>`;
}

export class ChangelogDialog {
  readonly el: HTMLDialogElement;
  readonly button: HTMLButtonElement;

  constructor() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn--small whatsnew-btn hall__whatsnew";
    b.dataset.action = "whats-new";
    b.setAttribute("aria-haspopup", "dialog");
    b.addEventListener("click", () => this.open());
    this.button = b;

    const d = document.createElement("dialog");
    d.className = "routepick whatsnew";
    d.setAttribute("aria-labelledby", "whatsnew-title");
    d.innerHTML = `
      <form method="dialog" class="routepick__form">
        <h2 id="whatsnew-title" class="routepick__title">Was ist neu</h2>
        <p class="routepick__lead">Was sich in der Prüfzelle geändert hat, neueste zuerst. Ältere Tage lassen sich aufklappen.</p>
        <div class="whatsnew__list" data-out="list"></div>
        <div class="routepick__foot">
          <a class="btn btn--small" href="${REPO}/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Ganzes Changelog auf GitHub<span class="sr-only"> (öffnet neuen Tab)</span></a>
          <button type="submit" class="btn btn--small" value="" data-action="close">Schließen</button>
        </div>
      </form>`;
    // backdrop click closes (press must start and end outside the box, as in the route picker)
    let downOutside = false;
    const outside = (e: MouseEvent) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    d.addEventListener("pointerdown", (e) => (downOutside = e.target === d && outside(e)));
    d.addEventListener("click", (e) => {
      if (downOutside && e.target === d && outside(e)) d.close("");
      downOutside = false;
    });
    d.addEventListener("close", () => this.button.focus());
    this.el = d;
    this.renderButton();
  }

  /** Button label with the "Neu" badge while there are unseen entries. */
  renderButton() {
    const unseen = unseenEntries(CHANGELOG, readSeen()).length;
    this.button.innerHTML = `<span>Was ist neu</span>${unseen ? `<span class="whatsnew__badge">Neu<span class="sr-only"> (${unseen === 1 ? "1 neuer Tag" : `${unseen} neue Tage`})</span></span>` : ""}`;
  }

  open() {
    if (this.el.open) return;
    const seen = readSeen();
    const newest = CHANGELOG[0]?.date ?? "";
    const cutoff = new Date(`${newest}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - RECENT_DAYS);
    const limit = cutoff.toISOString().slice(0, 10);
    this.el.querySelector<HTMLElement>('[data-out="list"]')!.innerHTML = CHANGELOG
      .map((e) => entryHtml(e, e.date > limit, seen !== null && e.date > seen))
      .join("");
    if (newest) writeSeen(newest);
    this.renderButton();
    if (typeof this.el.showModal === "function") this.el.showModal();
    else this.el.setAttribute("open", "");
    this.el.querySelector<HTMLElement>("summary")?.focus();
  }
}
