// Hauptmenü (#42, stage 1): the front of the workshop hall. Three roller doors lead to the modes, a
// narrow side door to the settings. Only the sandbox door opens for now; Car Builder and Karriere are shown
// closed with "kommt bald". No engine sound here (planned later).

interface Door {
  no: string;
  title: string;
  text: string;
  href?: string;
}

const DOORS: Door[] = [
  { no: "Tor 1", title: "Sandbox", text: "Alles frei: Motor bauen, Prüfstand, Rollenprüfstand, Bibliothek.", href: "#sandbox" },
  { no: "Tor 2", title: "Car Builder", text: "Schritt für Schritt vom Karosserietyp zum fertigen Auto." },
  { no: "Tor 3", title: "Karriere", text: "Mit der Schrottkarre anfangen, Rennen fahren, aufsteigen." },
];

export class MainMenu {
  readonly el: HTMLElement;
  readonly heading: HTMLElement;

  constructor() {
    const el = document.createElement("div");
    el.className = "hall";
    el.innerHTML = `
      <header class="hall__wall">
        <h1 class="hall__name" tabindex="-1">Prüfzelle</h1>
        <a class="btn btn--small hall__settings-top" href="#settings">Einstellungen</a>
        <p class="hall__sub">Motorenprüfstand und Werkstatt. Motor bauen, auf den Prüfstand stellen, Gas geben.</p>
      </header>
      <nav class="hall__front" aria-label="Hauptmenü">
        <ul class="hall__doors">
          ${DOORS.map((d) => MainMenu.door(d)).join("")}
          <li class="hall__side">
            <a class="sidedoor" href="#settings">
              <span class="sidedoor__window" aria-hidden="true"></span>
              <span class="sidedoor__sign"><span class="sidedoor__title">Einstellungen</span><span class="sidedoor__text">Einheiten</span></span>
              <span class="sidedoor__handle" aria-hidden="true"></span>
            </a>
          </li>
        </ul>
      </nav>
      <footer class="hall__floor">
        <p>Mit <kbd>Tab</kbd> wählen, mit <kbd>Enter</kbd> öffnen. <kbd>Esc</kbd> führt aus jedem Bereich zurück hierher.</p>
        <p class="hall__credit">
          Gebaut von <a href="https://github.com/SwissCheese26" rel="author noopener" target="_blank">Arthur Reznikov (@SwissCheese26)<span class="sr-only"> (öffnet neuen Tab)</span></a>
          · <a href="https://github.com/SwissCheese26/engine-sandbox" rel="noopener" target="_blank">Quellcode auf GitHub<span class="sr-only"> (öffnet neuen Tab)</span></a>
        </p>
      </footer>`;
    this.el = el;
    this.heading = el.querySelector(".hall__name")!;
    // a locked door does nothing; the sign says why
    el.querySelectorAll<HTMLButtonElement>(".door.is-closed").forEach((b) => b.addEventListener("click", (e) => e.preventDefault()));
  }

  private static door(d: Door): string {
    const inner = `
        <span class="door__lintel"><span class="door__no">${d.no}</span></span>
        <span class="door__opening" aria-hidden="true"><span class="door__shutter"></span></span>
        <span class="door__plate">
          <span class="screw screw--tl"></span><span class="screw screw--tr"></span>
          <span class="door__title">${d.title}</span>
          <span class="door__text">${d.text}</span>
          ${d.href ? `<span class="door__open">Tor offen</span>` : `<span class="door__soon">kommt bald</span>`}
        </span>`;
    return d.href
      ? `<li class="hall__bay"><a class="door" href="${d.href}" data-mode="${d.title.toLowerCase()}">${inner}</a></li>`
      // locked bays stay focusable (aria-disabled, not disabled), so keyboard and screen reader users find
      // them; "kommt bald" is part of the accessible name
      : `<li class="hall__bay"><button type="button" class="door is-closed" aria-disabled="true">${inner}</button></li>`;
  }
}
