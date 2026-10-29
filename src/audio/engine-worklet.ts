/**
 * AudioWorklet entry (built by scripts/build.ts to dist/engine-worklet.js). Self-contained: Bun bundles
 * dsp.ts and model.ts into it; model.ts only has type imports from the core.
 *
 * Messages (main → worklet):
 *   { type: "voice", voice: Voice } · { type: "control", frame: ControlFrame } · { type: "volume", value }
 */
import { EngineDsp } from "./dsp.ts";
import type { ControlFrame, Voice } from "./model.ts";

// Worklet globals are not in lib.dom; declare the minimum we use.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

type Msg = { type: "voice"; voice: Voice } | { type: "control"; frame: ControlFrame } | { type: "volume"; value: number };

class EngineProcessor extends AudioWorkletProcessor {
  private dsp = new EngineDsp(sampleRate);
  private alive = true;
  /** Scratch right channel for a mono output (allocated once, grown only if the block size changes). */
  private scratch = new Float32Array(128);
  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent<Msg | { type: "stop" }>) => {
      const m = ev.data;
      if (m.type === "voice") this.dsp.setVoice(m.voice);
      else if (m.type === "control") this.dsp.setControl(m.frame);
      else if (m.type === "volume") this.dsp.setVolume(m.value);
      else if (m.type === "stop") this.alive = false;
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const l = out?.[0];
    if (!l) return this.alive;
    let r = out[1];
    if (!r) {
      if (this.scratch.length < l.length) this.scratch = new Float32Array(l.length);
      r = this.scratch;
    }
    this.dsp.process(l, r, l.length);
    return this.alive;
  }
}

registerProcessor("engine-sound", EngineProcessor);
