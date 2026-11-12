// Device adaptation (#44): touch detection (root class `is-touch`), Screen Wake Lock while the engine runs and
// vibration on limiter cut, ABS and engine damage. Every browser API is optional: where it is missing, the
// feature is a no-op. Logic is kept in small classes with injected APIs so it runs in unit tests.
import type { EngineState } from "../core/index.ts";

// ---------------------------------------------------------------- input mode

export type InputMode = "touch" | "keyboard";

/** Next input mode after an input event. Touch wins on a touch pointer, keyboard on a key press outside a text
 *  field (the on-screen keyboard types into fields). A mouse pointer changes nothing: touch screens send emulated
 *  mouse events, and with a mouse alone the media query already says "keyboard". */
export function nextInputMode(
  prev: InputMode,
  ev: { kind: "pointer"; pointerType: string } | { kind: "key"; inField: boolean; key: string },
): InputMode {
  if (ev.kind === "pointer") return ev.pointerType === "touch" || ev.pointerType === "pen" ? "touch" : prev;
  if (ev.inField || ev.key === "Unidentified" || ev.key === "Process") return prev;
  return "keyboard";
}

const TOUCH_QUERY = "(pointer: coarse), (hover: none)";
let mode: InputMode | null = null;
const modeListeners = new Set<(m: InputMode) => void>();

/** Current input mode (before startInputDetection(): from the media query). */
export function inputMode(): InputMode {
  if (mode) return mode;
  try {
    return typeof matchMedia === "function" && matchMedia(TOUCH_QUERY).matches ? "touch" : "keyboard";
  } catch {
    return "keyboard";
  }
}

export function isTouch(): boolean {
  return inputMode() === "touch";
}

export function onInputModeChange(fn: (m: InputMode) => void): () => void {
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}

function setMode(m: InputMode) {
  if (m === mode) return;
  mode = m;
  document.documentElement.classList.toggle("is-touch", m === "touch");
  for (const fn of modeListeners) fn(m);
}

/** Starts the live detection once: media query (and its changes), first touch, key presses, mouse. */
export function startInputDetection() {
  if (mode || typeof document === "undefined") return;
  setMode(inputMode());
  try {
    // becoming a touch screen switches at once; back to keyboard hints only with a key press (a docked tablet
    // keeps its coarse pointer, and emulators flip the query while resizing)
    matchMedia(TOUCH_QUERY).addEventListener?.("change", (e) => e.matches && setMode("touch"));
  } catch {
    /* old browsers: the events below still switch */
  }
  const opts = { capture: true, passive: true } as const;
  addEventListener("pointerdown", (e) => setMode(nextInputMode(mode ?? "keyboard", { kind: "pointer", pointerType: e.pointerType })), opts);
  addEventListener("touchstart", () => setMode("touch"), opts);
  addEventListener(
    "keydown",
    (e) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.isContentEditable || (t.tagName === "INPUT" && !["checkbox", "radio", "range", "button"].includes((t as HTMLInputElement).type)) || t.tagName === "TEXTAREA");
      setMode(nextInputMode(mode ?? "keyboard", { kind: "key", inField, key: e.key }));
    },
    opts,
  );
}

// ---------------------------------------------------------------- wake lock

interface Sentinel {
  release(): Promise<void>;
  addEventListener?(type: "release", fn: () => void): void;
}
export interface WakeLockApi {
  request(type: "screen"): Promise<Sentinel>;
}

/** Holds a screen wake lock while wanted (setting on, engine running, page visible). The browser drops the lock
 *  when the page is hidden; the next update() after it is visible again requests a new one. */
export class ScreenWake {
  private sentinel: Sentinel | null = null;
  private pending = false;
  /** A refused request (no permission, battery saver) is not retried until the wish changes. */
  private refused = false;
  private wanted = false;

  constructor(
    private api: WakeLockApi | undefined = (globalThis.navigator as { wakeLock?: WakeLockApi } | undefined)?.wakeLock,
    private visible: () => boolean = () => typeof document === "undefined" || document.visibilityState === "visible",
  ) {}

  get held(): boolean {
    return this.sentinel !== null;
  }

  /** Per frame (cheap) and on visibilitychange. */
  update(want: boolean) {
    if (want !== this.wanted) {
      this.wanted = want;
      this.refused = false;
    }
    if (!this.api) return;
    if (want && this.visible()) {
      if (this.sentinel || this.pending || this.refused) return;
      this.pending = true;
      this.api.request("screen").then(
        (s) => {
          this.pending = false;
          if (!this.wanted) {
            void s.release().catch(() => {});
            return;
          }
          this.sentinel = s;
          s.addEventListener?.("release", () => {
            if (this.sentinel === s) this.sentinel = null;
          });
        },
        () => {
          this.pending = false;
          this.refused = true;
        },
      );
    } else if (!want) this.release();
  }

  release() {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    if (s) void s.release().catch(() => {});
  }

  /** Page became visible: the old lock is gone (released by the browser). */
  onVisible() {
    this.sentinel = null;
    this.refused = false;
  }
}

// ---------------------------------------------------------------- vibration

export type VibratePattern = number | number[];

/** Pulses for limiter cut, ABS regulation and engine destroyed; repeats are throttled so the motor is not on
 *  all the time. `vibrate` is navigator.vibrate (missing on iOS: then nothing happens). */
export class Haptics {
  static readonly LIMITER: VibratePattern = 15;
  static readonly ABS: VibratePattern = [25, 35, 25];
  static readonly DESTROYED: VibratePattern = [200, 100, 400];
  /** Seconds between pulses while the limiter or ABS stays active. */
  static readonly REPEAT_S = 0.4;

  private t = 0;
  private lastLimiter = -Infinity;
  private lastAbs = -Infinity;
  private wasDestroyed = false;

  constructor(private vibrate: ((p: VibratePattern) => unknown) | undefined = Haptics.native()) {}

  private static native(): ((p: VibratePattern) => unknown) | undefined {
    const nav = globalThis.navigator as { vibrate?: (p: VibratePattern) => boolean } | undefined;
    return typeof nav?.vibrate === "function" ? (p) => nav.vibrate!(p) : undefined;
  }

  /** Per frame. revLimitRpm: limiter of the engine; enabled: setting (and touch for "auto"). */
  update(dt: number, s: EngineState, revLimitRpm: number, pedal: number, enabled: boolean) {
    this.t += dt;
    const destroyed = s.destroyed;
    const newlyDestroyed = destroyed && !this.wasDestroyed;
    this.wasDestroyed = destroyed;
    if (!enabled || !this.vibrate) return;
    if (newlyDestroyed) {
      this.buzz(Haptics.DESTROYED);
      return;
    }
    if (!s.running) return;
    // limiter: at the cut-off speed with the gas open (the engine bounces off the limiter)
    if (pedal > 0.3 && s.rpm >= revLimitRpm * 0.985 && this.t - this.lastLimiter >= Haptics.REPEAT_S) {
      this.lastLimiter = this.t;
      this.buzz(Haptics.LIMITER);
    }
    if (s.absActive && this.t - this.lastAbs >= Haptics.REPEAT_S) {
      this.lastAbs = this.t;
      this.buzz(Haptics.ABS);
    }
  }

  private buzz(p: VibratePattern) {
    try {
      this.vibrate?.(p);
    } catch {
      /* blocked (no user gesture yet): ignore */
    }
  }
}
