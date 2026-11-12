// Thin seam between the UI and the procedural engine sound (team Sound, src/audio/engine-sound.ts).
// The UI only talks to `SoundOutput`; EngineSound satisfies it structurally.
import { EngineSound } from "../audio/engine-sound.ts";
import type { EngineConfig, EngineState, EngineSummary } from "../core/index.ts";

export interface SoundOutput {
  /** Must be called from a user gesture (creates/resumes the AudioContext, loads the worklet). */
  start(): Promise<void>;
  setConfig(cfg: EngineConfig, summary: EngineSummary): void;
  /** Every frame, also while the engine is off (starter and crash need it). */
  update(state: EngineState, pedal: number): void;
  setVolume(v: number): void;
  /** Pauses / continues the audio clock (menu open, #42). */
  suspend(): Promise<void>;
  resume(): Promise<void>;
  stop(): void;
  /** AudioContext is running (a user gesture unlocked it). */
  readonly running: boolean;
}

/** True when the browser can play the engine sound (Web Audio present). */
export const SOUND_AVAILABLE =
  typeof globalThis !== "undefined" &&
  ("AudioContext" in globalThis || "webkitAudioContext" in globalThis);

export function createSound(): SoundOutput {
  // SOUND-INTEGRATION: real procedural sound from PR #11. The worklet is loaded from
  // ./engine-worklet.js relative to document.baseURI, so it also works under /engine-sandbox/ on Pages.
  return new EngineSound();
}
