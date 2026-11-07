// Game shell (#42, stage 1): main menu, settings and the sandbox as screens behind a hash router.
// The sandbox (App) is mounted the first time it is entered and only paused when it is left (loop stopped,
// keys ignored, sound muted), so the engine, the measured runs and the bench survive a visit to the menu.
import { App, mountApp } from "./app.ts";
import { MainMenu } from "./menu.ts";
import { TITLES, hrefOf, isTypingTarget, parseRoute, type Route } from "./router.ts";
import { SettingsScreen } from "./settings-screen.ts";

export class Shell {
  private menu = new MainMenu();
  private settings = new SettingsScreen();
  private sandboxRoot: HTMLElement;
  private screens: Record<Route, HTMLElement>;
  private app: App | null = null;
  private route: Route | null = null;
  private abort = new AbortController();

  constructor(private root: HTMLElement) {
    this.sandboxRoot = document.createElement("div");
    const wrap = (r: Route, child: HTMLElement) => {
      const s = document.createElement("div");
      s.className = `screen screen--${r}`;
      s.dataset.screen = r;
      s.hidden = true;
      s.append(child);
      return s;
    };
    this.screens = {
      menu: wrap("menu", this.menu.el),
      settings: wrap("settings", this.settings.el),
      sandbox: wrap("sandbox", this.sandboxRoot),
    };
    root.replaceChildren(this.screens.menu, this.screens.settings, this.screens.sandbox);
    const signal = this.abort.signal;
    window.addEventListener("hashchange", () => this.show(parseRoute(location.hash), true), { signal });
    // on window, so handlers inside the sandbox (closing the bench drawer) run first and can preventDefault
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape" || e.defaultPrevented || e.repeat || this.route === "menu") return;
        if (isTypingTarget(e.target as HTMLElement | null)) return;
        e.preventDefault();
        this.go("menu");
      },
      { signal },
    );
    this.show(parseRoute(location.hash), false);
  }

  go(route: Route) {
    if (location.hash !== hrefOf(route)) location.hash = hrefOf(route);
    else this.show(route, true);
  }

  private show(route: Route, moveFocus: boolean) {
    if (route === this.route) return;
    const from = this.route;
    this.route = route;
    if (from === "sandbox") this.app?.pause();
    if (from === "settings") this.settings.leave();
    for (const r of Object.keys(this.screens) as Route[]) this.screens[r].hidden = r !== route;
    document.title = TITLES[route];
    document.documentElement.dataset.screen = route;
    if (route === "sandbox") {
      if (!this.app) this.app = mountApp(this.sandboxRoot);
      else this.app.resume();
    }
    if (route === "settings") this.settings.sync();
    if (!moveFocus) return;
    window.scrollTo(0, 0);
    if (route === "menu") {
      // back in the hall: focus the door one came from
      const back = from ? this.menu.el.querySelector<HTMLElement>(`a[href="${hrefOf(from)}"]`) : null;
      (back ?? this.menu.heading).focus();
    } else if (route === "settings") {
      this.settings.heading.focus();
    } else {
      this.sandboxRoot.querySelector<HTMLElement>(".cell__title")?.setAttribute("tabindex", "-1");
      this.sandboxRoot.querySelector<HTMLElement>(".cell__title")?.focus();
    }
  }

  get current(): Route | null {
    return this.route;
  }

  dispose() {
    this.abort.abort();
    this.app?.dispose();
    this.app = null;
    this.root.replaceChildren();
  }
}

export function mountShell(root: HTMLElement): Shell {
  const shell = new Shell(root);
  (window as unknown as { __shell?: Shell }).__shell = shell;
  return shell;
}
