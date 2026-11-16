// Credits (#94): who made the game. A small "Credits" button in the hall footer opens a <dialog> in the style of the
// other menu dialogs (.routepick): modal, Esc and a click on the backdrop close it, focus returns to the button.
// No e-mail addresses, only public profile and project links.
const REPO = "https://github.com/SwissCheese26/engine-sandbox";

/** People and tools named in the credits, in order. Exported for tests. */
export const CREDITS: readonly { name: string; role: string; href: string; link: string }[] = [
  { name: "Arthur Reznikov", role: "Idee, Konzept & Product Owner", href: "https://github.com/SwissCheese26", link: "@SwissCheese26 auf GitHub" },
  { name: "Claude von Anthropic", role: "Entwicklung: Physik, Sound, Oberfläche und Tests. Gebaut mit Claude Code", href: "https://claude.com/claude-code", link: "Claude Code" },
];

const ext = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}<span class="sr-only"> (öffnet neuen Tab)</span></a>`;

export class CreditsDialog {
  readonly el: HTMLDialogElement;
  readonly button: HTMLButtonElement;

  constructor() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn--small hall__credits";
    b.dataset.action = "credits";
    b.setAttribute("aria-haspopup", "dialog");
    b.textContent = "Credits";
    b.addEventListener("click", () => this.open());
    this.button = b;

    const d = document.createElement("dialog");
    d.className = "routepick credits";
    d.setAttribute("aria-labelledby", "credits-title");
    d.innerHTML = `
      <form method="dialog" class="routepick__form">
        <h2 id="credits-title" class="routepick__title">Credits</h2>
        <dl class="credits__list">
          ${CREDITS.map((c) => `
          <div class="credits__entry">
            <dt class="credits__name">${c.name}</dt>
            <dd class="credits__role">${c.role}</dd>
            <dd class="credits__link">${ext(c.href, c.link)}</dd>
          </div>`).join("")}
        </dl>
        <p class="credits__note">Prüfzelle ist ein offenes Hobbyprojekt, der Quellcode liegt auf ${ext(REPO, "GitHub: SwissCheese26/engine-sandbox")}.</p>
        <div class="routepick__foot">
          <button type="submit" class="btn btn--small" value="" data-action="close">Schließen</button>
        </div>
      </form>`;
    // backdrop click closes (press must start and end outside the box, as in the other dialogs)
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
  }

  open() {
    if (this.el.open) return;
    if (typeof this.el.showModal === "function") this.el.showModal();
    else this.el.setAttribute("open", "");
    // focus on the heading's first action: the first link (Esc or "Schließen" leave again)
    this.el.querySelector<HTMLElement>(".credits__link a")?.focus();
  }
}
