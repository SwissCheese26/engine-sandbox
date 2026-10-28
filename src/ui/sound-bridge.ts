// Thin seam between the UI and the procedural engine sound (team Sound, src/audio/engine-sound.ts).
// The UI only talks to `SoundOutput`, so the panel works before the audio module lands.
import type { EngineConfig, EngineState, EngineSummary } from "../core/index.ts";

/** Mirrors the planned `EngineSound` class in src/audio/engine-sound.ts. */
export interface SoundOutput {
  start(): Promise<void>;
  setConfig(cfg: EngineConfig, summary: EngineSummary): void;
  update(state: EngineState, pedal: number): void;
  setVolume(v: number): void;
  stop(): void;
}

/** Silent stand-in until the real engine sound is wired in. */
class NoopSound implements SoundOutput {
  async start(): Promise<void> {}
  setConfig(_cfg: EngineConfig, _summary: EngineSummary): void {}
  update(_state: EngineState, _pedal: number): void {}
  setVolume(_v: number): void {}
  stop(): void {}
}

/** True once a real sound engine is wired in; the panel shows a hint otherwise. */
export const SOUND_AVAILABLE = false;

export function createSound(): SoundOutput {
  // SOUND-INTEGRATION: once src/audio/engine-sound.ts exists, replace this with
  //   import { EngineSound } from "../audio/engine-sound.ts";   (static import at the top)
  //   return new EngineSound();
  // and set SOUND_AVAILABLE = true. The AudioContext must be created/resumed inside start(),
  // which the UI calls from a user gesture (switching the ignition on or unmuting).
  return new NoopSound();
}
