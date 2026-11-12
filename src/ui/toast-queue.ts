// Hinweise zu Grenzwerten as short toasts (Arthur's phone feedback): which warnings pop up, for how long and how
// often. No DOM here, so the rules run in unit tests; toasts.ts draws what this queue says.
//
// Rules:
// - a toast appears when a condition becomes active (edge), never again while it stays active;
// - after it cleared it may come back, but only once the cooldown since its last toast has passed;
// - limit warnings only when the setting is on; "always" events (engine destroyed, tank empty) in every case;
// - at most `maxVisible` toasts at once: a new one pushes out the oldest (an "always" toast is pushed out last);
// - each toast disappears after its lifetime.

export type ToastSeverity = "warning" | "critical";

/** One condition the sandbox reports this frame. */
export interface ToastInput {
  /** Stable identity of the condition, e.g. "w:piston-speed:warning" or "destroyed". */
  key: string;
  text: string;
  severity: ToastSeverity;
  /** Shown even with the setting off (critical events). */
  always?: boolean;
}

export interface Toast extends ToastInput {
  id: number;
  shownAt: number;
  expiresAt: number;
}

export interface ToastQueueOptions {
  maxVisible: number;
  /** Lifetime of a limit toast, ms. */
  ttlMs: number;
  /** Lifetime of an "always" toast, ms (a destroyed engine deserves a little longer). */
  alwaysTtlMs: number;
  /** A condition that cleared and came back is shown again only after this time since its last toast, ms. */
  cooldownMs: number;
}

export const TOAST_DEFAULTS: ToastQueueOptions = { maxVisible: 2, ttlMs: 3000, alwaysTtlMs: 5000, cooldownMs: 12000 };

export interface ToastChange {
  added: Toast[];
  removed: Toast[];
}

export class ToastQueue {
  readonly opts: ToastQueueOptions;
  private shown: Toast[] = [];
  private active = new Set<string>();
  private lastShown = new Map<string, number>();
  private nextId = 1;

  constructor(opts: Partial<ToastQueueOptions> = {}) {
    this.opts = { ...TOAST_DEFAULTS, ...opts };
  }

  /** Toasts on screen, oldest first. */
  get visible(): readonly Toast[] {
    return this.shown;
  }

  /**
   * Per frame (or less often): the conditions active right now. Returns what to add and remove on screen.
   * `enabled` is the setting "Hinweise zu Grenzwerten"; "always" inputs ignore it.
   */
  sync(inputs: readonly ToastInput[], now: number, enabled: boolean): ToastChange {
    const removed: Toast[] = [];
    const added: Toast[] = [];
    this.shown = this.shown.filter((t) => {
      if (now < t.expiresAt) return true;
      removed.push(t);
      return false;
    });

    const nowActive = new Set<string>();
    for (const inp of inputs) {
      if (nowActive.has(inp.key)) continue;
      nowActive.add(inp.key);
      if (this.active.has(inp.key)) continue; // still the same condition: no repeat
      if (!enabled && !inp.always) continue;
      const last = this.lastShown.get(inp.key);
      if (last !== undefined && now - last < this.opts.cooldownMs) continue;
      const toast: Toast = { ...inp, id: this.nextId++, shownAt: now, expiresAt: now + (inp.always ? this.opts.alwaysTtlMs : this.opts.ttlMs) };
      this.lastShown.set(inp.key, now);
      this.shown.push(toast);
      added.push(toast);
    }
    this.active = nowActive;

    // too many: drop the oldest limit toast first, an "always" toast only if nothing else is left
    while (this.shown.length > this.opts.maxVisible) {
      let i = this.shown.findIndex((t) => !t.always);
      if (i < 0) i = 0;
      const [t] = this.shown.splice(i, 1);
      const j = added.indexOf(t!);
      if (j >= 0) added.splice(j, 1); // never shown: nothing to remove on screen
      else removed.push(t!);
    }
    return { added, removed };
  }

  /** Engine reset: forget everything, so a new run starts quiet. */
  clear(): Toast[] {
    const gone = this.shown;
    this.shown = [];
    this.active.clear();
    this.lastShown.clear();
    return gone;
  }
}
