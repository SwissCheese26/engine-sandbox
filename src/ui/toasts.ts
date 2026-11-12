// Toast strip below the sandbox header: draws what ToastQueue decides (toast-queue.ts). It floats over the stage
// (position absolute), so a toast never changes the height of the control bar. One polite live region: each new
// toast is announced once, leaving toasts are not.
import type { EngineState } from "../core/index.ts";
import { ToastQueue, type Toast, type ToastInput } from "./toast-queue.ts";

/** What the sandbox reports for the toasts this frame. */
export interface ToastSources {
  state: EngineState;
  /** Chassis dyno with an empty tank and the engine stopped. */
  outOfFuel: boolean;
}

/** Turns the engine state into toast conditions (pure, tested). */
export function toastInputs({ state: s, outOfFuel }: ToastSources): ToastInput[] {
  const out: ToastInput[] = [];
  if (s.destroyed) {
    const fatal = [...s.damage].reverse().find((d) => d.fatal);
    out.push({ key: "destroyed", severity: "critical", always: true, text: fatal ? `Motor zerstört. ${fatal.message}` : "Motor zerstört." });
  }
  if (outOfFuel) out.push({ key: "fuel-empty", severity: "critical", always: true, text: "Tank leer: Der Motor ist ausgegangen." });
  for (const d of s.damage.slice(-3)) {
    if (!d.fatal) out.push({ key: `d:${d.code}:${d.t.toFixed(1)}`, severity: "warning", text: `Schaden: ${d.message}` });
  }
  for (const w of s.warnings) {
    if (w.severity === "info") continue;
    out.push({ key: `w:${w.code}:${w.severity}`, severity: w.severity, text: w.message });
  }
  return out;
}

const LEAVE_MS = 220;

export class ToastStrip {
  readonly el: HTMLElement;
  private queue = new ToastQueue();
  private nodes = new Map<number, HTMLElement>();

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "toasts";
    this.el.setAttribute("aria-live", "polite");
    this.el.setAttribute("aria-relevant", "additions");
    this.el.setAttribute("aria-label", "Hinweise");
  }

  /** Per frame. `enabled` = setting "Hinweise zu Grenzwerten" is "toast". */
  update(src: ToastSources, now: number, enabled: boolean) {
    const { added, removed } = this.queue.sync(toastInputs(src), now, enabled);
    for (const t of removed) this.drop(t);
    for (const t of added) this.show(t);
  }

  /** Engine reset: all toasts go, conditions start fresh. */
  clear() {
    for (const t of this.queue.clear()) this.drop(t);
  }

  private show(t: Toast) {
    const p = document.createElement("p");
    p.className = `toast toast--${t.severity}`;
    p.textContent = t.text;
    p.title = t.text;
    this.nodes.set(t.id, p);
    this.el.append(p);
  }

  private drop(t: Toast) {
    const p = this.nodes.get(t.id);
    if (!p) return;
    this.nodes.delete(t.id);
    p.classList.add("is-leaving");
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) p.remove();
    else setTimeout(() => p.remove(), LEAVE_MS);
  }
}
