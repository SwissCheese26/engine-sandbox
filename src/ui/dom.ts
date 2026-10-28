// Tiny DOM helpers for the per-frame update path: write only when the visible value changes.

const lastText = new WeakMap<Node, string>();

/** Sets textContent only if the string differs from the last one written. */
export function setText(el: Node, text: string): void {
  if (lastText.get(el) === text) return;
  el.textContent = text;
  lastText.set(el, text);
}
