// Toast strip below the sandbox header: draws what ToastQueue decides (toast-queue.ts). It floats over the stage
// (position absolute), so a toast never changes the height of the control bar. One polite live region: each new
// toast is announced once, leaving toasts are not.
import type { DrivetrainState, EngineState } from "../core/index.ts";
import { ToastQueue, type Toast, type ToastInput } from "./toast-queue.ts";

/** What the sandbox reports for the toasts this frame. */
export interface ToastSources {
  state: EngineState;
  /** The engine stalled because the tank ran dry (latched until it runs again). */
  outOfFuel: boolean;
  /** Gearbox oil (issue #53), chassis dyno only. */
  gearbox?: Pick<DrivetrainState, "gearboxOilWarn" | "gearboxProtect" | "gearboxFailed">;
  /** Tyres (issue #144), chassis dyno only. */
  tyre?: Pick<DrivetrainState, "tyreWarn" | "tyreVibration" | "tyreFailed">;
}

/** Tyre message (issue #144) for the Getriebe-Pult note and the toast; "" = none. */
export function tyreNote(s: Pick<DrivetrainState, "tyreWarn" | "tyreVibration" | "tyreFailed">): string {
  if (s.tyreFailed) return "Reifen geplatzt: kaum Grip, hoher Rollwiderstand. Im Stand „Reifen wechseln“.";
  if (s.tyreVibration) return "Reifen beschädigt: Vibrationen, weniger Grip. Sofort langsamer fahren.";
  if (s.tyreWarn) return "Reifen überhitzen: über dem Geschwindigkeitsindex. Langsamer fahren.";
  return "";
}

/** Gearbox oil message (issue #53) for the Getriebe-Pult note and the toast; "" = none. */
export function gearboxOilNote(s: Pick<DrivetrainState, "gearboxOilWarn" | "gearboxProtect" | "gearboxFailed">): string {
  if (s.gearboxFailed) return "Getriebeschaden durch Überhitzung: Es wird keine Kraft mehr übertragen. Zurücksetzen hilft.";
  if (s.gearboxProtect) return "Getriebe überhitzt: Notlauf, die Leistung ist begrenzt. Gas wegnehmen oder rollen lassen.";
  if (s.gearboxOilWarn) return "Getriebeöl heiß: Last zurücknehmen, Fahrtwind kühlt.";
  return "";
}

/** Turns the engine state into toast conditions (pure, tested). */
export function toastInputs({ state: s, outOfFuel, gearbox, tyre }: ToastSources): ToastInput[] {
  const out: ToastInput[] = [];
  if (s.destroyed) {
    const fatal = [...s.damage].reverse().find((d) => d.fatal);
    out.push({ key: "destroyed", severity: "critical", always: true, text: fatal ? `Motor zerstört. ${fatal.message}` : "Motor zerstört." });
  }
  if (outOfFuel) out.push({ key: "fuel-empty", severity: "critical", always: true, text: "Tank leer: Der Motor ist ausgegangen." });
  // gearbox oil (issue #53): failure and protection mode always, the plain warning only with the setting (calm)
  if (gearbox) {
    const text = gearboxOilNote(gearbox);
    if (gearbox.gearboxFailed) out.push({ key: "gearbox-failed", severity: "critical", always: true, text });
    else if (gearbox.gearboxProtect) out.push({ key: "gearbox-protect", severity: "critical", always: true, text });
    else if (gearbox.gearboxOilWarn) out.push({ key: "gearbox-hot", severity: "warning", text });
  }
  // tyres (issue #144): the blowout always, the damage and the overheating warning only with the setting (calm)
  if (tyre) {
    const text = tyreNote(tyre);
    if (tyre.tyreFailed) out.push({ key: "tyre-failed", severity: "critical", always: true, text });
    else if (tyre.tyreVibration) out.push({ key: "tyre-damaged", severity: "warning", text });
    else if (tyre.tyreWarn) out.push({ key: "tyre-hot", severity: "warning", text });
  }
  // engine damage and critical warnings are shown in any case; only the limit approach waits for the setting
  for (const d of s.damage.slice(-3)) {
    if (!d.fatal) out.push({ key: `d:${d.code}:${d.t.toFixed(1)}`, severity: "warning", always: true, text: `Schaden: ${d.message}` });
  }
  // catalyst heating after a cold start (#135): a calm note, only with the toast setting on
  if (s.running && s.coldStart === "cat-heating") {
    out.push({ key: "cat-heating", severity: "info", text: "Kat heizt: erhöhter Leerlauf und späte Zündung, bis der Katalysator warm ist." });
  }
  for (const w of s.warnings) {
    if (w.severity === "info") continue;
    out.push({ key: `w:${w.code}:${w.severity}`, severity: w.severity, always: w.severity === "critical", text: w.message });
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

  /**
   * One live region per message: where the console shows its message list (wide screens) that list speaks and the
   * toasts are only visual; on phones (list hidden) the toasts are the polite live region.
   */
  setLive(live: boolean) {
    if (live) {
      this.el.setAttribute("aria-live", "polite");
      this.el.removeAttribute("aria-hidden");
    } else {
      this.el.removeAttribute("aria-live");
      this.el.setAttribute("aria-hidden", "true");
    }
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
