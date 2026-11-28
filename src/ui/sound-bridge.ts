// Thin seam between the UI and the procedural engine sound (team Sound, src/audio/engine-sound.ts).
// The UI only talks to `SoundOutput`; EngineSound satisfies it structurally.
import { EngineSound } from "../audio/engine-sound.ts";
import { EvSound } from "../audio/ev-sound.ts";
import { TyreRumble, type TyreRumbleInput } from "../audio/tyre-rumble.ts";
import type { EngineConfig, EngineState, EngineSummary } from "../core/index.ts";

export interface SoundOutput {
  /** Must be called from a user gesture (creates/resumes the AudioContext, loads the worklet). */
  start(): Promise<void>;
  setConfig(cfg: EngineConfig, summary: EngineSummary): void;
  /** Every frame, also while the engine is off (starter and crash need it). */
  update(state: EngineState, pedal: number): void;
  setVolume(v: number): void;
  /** Tyre rumble at the vibration stage / after a blowout (issue #144); every frame on the chassis dyno. */
  setTyre?(t: TyreRumbleInput): void;
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
  return new DriveSound();
}

/**
 * Engine sound plus the electric whine (#108): a frame with `state.ev` drives the EV voice and keeps the combustion
 * voice silent (engine off), any other frame the reverse.
 */
class DriveSound implements SoundOutput {
  private engine = new EngineSound();
  private ev = new EvSound();
  private tyre = new TyreRumble();

  get running(): boolean {
    return this.engine.running;
  }
  async start() {
    await Promise.all([this.engine.start(), this.ev.start(), this.tyre.start()]);
  }
  setConfig(cfg: EngineConfig, summary: EngineSummary) {
    this.engine.setConfig(cfg, summary);
  }
  update(state: EngineState, pedal: number) {
    if (state.hybrid) {
      // hybrid (#157): both voices – the engine with its own state (start, idle, load), the motor whine
      this.ev.update(state);
      this.engine.update({ ...state.hybrid.engine, vehicleSpeedMs: state.vehicleSpeedMs }, state.hybrid.engineOn ? pedal : 0);
    } else if (state.ev) {
      this.engine.update({ ...state, running: false, rpm: 0, starterEngaged: false, afterfire: 0, load: 0, torqueNm: 0, powerKw: 0 }, 0);
      this.ev.update(state);
    } else {
      this.ev.update(state);
      this.engine.update(state, pedal);
    }
  }
  setVolume(v: number) {
    this.engine.setVolume(v);
    this.ev.setVolume(v);
    this.tyre.setVolume(v);
  }
  setTyre(t: TyreRumbleInput) {
    this.tyre.update(t);
  }
  async suspend() {
    await Promise.all([this.engine.suspend(), this.ev.suspend(), this.tyre.suspend()]);
  }
  async resume() {
    await Promise.all([this.engine.resume(), this.ev.resume(), this.tyre.resume()]);
  }
  stop() {
    this.engine.stop();
    this.ev.stop();
    this.tyre.stop();
  }
}
