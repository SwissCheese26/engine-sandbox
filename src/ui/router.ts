// Hash router of the main menu (#42, stage 1). Pure functions, no DOM, so the mapping is unit-tested.
// A hash router works under any base path (GitHub Pages serves the game under /engine-sandbox/).

export type Route = "menu" | "sandbox" | "settings";

export const ROUTES: readonly Route[] = ["menu", "sandbox", "settings"];

/** "#sandbox" → "sandbox". Empty, unknown or not yet built modes (#builder, #career) open the menu. */
export function parseRoute(hash: string): Route {
  const id = hash.replace(/^#\/?/, "").split(/[?/]/)[0]!.toLowerCase();
  return (ROUTES as readonly string[]).includes(id) ? (id as Route) : "menu";
}

export function hrefOf(route: Route): string {
  return `#${route}`;
}

export const TITLES: Record<Route, string> = {
  menu: "Prüfzelle – Hauptmenü",
  sandbox: "Prüfzelle – Sandbox",
  settings: "Prüfzelle – Einstellungen",
};

/** Esc leads back to the menu, except while typing: text fields, number fields, selects, editable text. */
export function isTypingTarget(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!el?.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  // sliders, switches and buttons are not "Eingabefelder": Esc still goes back from them
  return !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"].includes((el.type ?? "text").toLowerCase());
}
