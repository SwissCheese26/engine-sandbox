/**
 * Procedural engine sound for the test cell (issue #6). No samples: everything is synthesised by
 * EngineDsp (dsp.ts), normally inside an AudioWorklet (engine-worklet.ts → dist/engine-worklet.js).
 * Fallback when AudioWorklet is missing or the module fails to load: the same DSP in a
 * ScriptProcessorNode. Without any Web Audio support every method is a silent no-op.
 */
import type { EngineConfig, EngineState, EngineSummary } from "../core/index.ts";
import { EngineDsp } from "./dsp.ts";
import { type ControlFrame, ControlTracker, type Voice, deriveVoice } from "./model.ts";

type Ctor = new () => AudioContext;

export class EngineSound {
  private ctx: AudioContext | null;
  private ownsCtx: boolean;
  private node: AudioWorkletNode | null = null;
  private fallback: { proc: ScriptProcessorNode; dsp: EngineDsp } | null = null;
  private out: GainNode | null = null;
  private voice: Voice | null = null;
  private tracker: ControlTracker | null = null;
  private volume = 0.8;
  private starting: Promise<void> | null = null;
  /** Incremented by stop(); a start() that awaits across a stop() sees a new generation and aborts. */
  private gen = 0;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? null;
    this.ownsCtx = !ctx;
  }

  /** Call from a user gesture. Creates/resumes the AudioContext and loads the worklet. */
  start(): Promise<void> {
    if (!this.starting) this.starting = this.doStart().catch((e) => {
      this.starting = null;
      throw e;
    });
    return this.starting;
  }

  private async doStart() {
    const gen = this.gen;
    if (!this.ctx) {
      const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
      const C = g.AudioContext ?? g.webkitAudioContext;
      if (!C) return; // no Web Audio: stay silent
      this.ctx = new C();
      this.ownsCtx = true;
    }
    const ctx = this.ctx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    if (gen !== this.gen) return; // stopped meanwhile
    if (this.node || this.fallback) return;

    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(ctx.destination);
    this.out = out;

    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        const base = typeof document !== "undefined" ? document.baseURI : globalThis.location?.href;
        await ctx.audioWorklet.addModule(new URL("./engine-worklet.js", base));
        if (gen !== this.gen) {
          // stop() ran during addModule: do not create a node, release what we built.
          safeDisconnect(out);
          return;
        }
        this.node = new AudioWorkletNode(ctx, "engine-sound", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        this.node.connect(out);
      } catch (e) {
        if (gen !== this.gen) return;
        console.warn("AudioWorklet nicht verfügbar, nutze Fallback", e);
        this.node = null;
      }
    }
    if (!this.node && typeof ctx.createScriptProcessor === "function") {
      const dsp = new EngineDsp(ctx.sampleRate);
      const proc = ctx.createScriptProcessor(1024, 0, 2);
      proc.onaudioprocess = (ev) => {
        const b = ev.outputBuffer;
        dsp.process(b.getChannelData(0), b.getChannelData(1), b.length);
      };
      proc.connect(out);
      this.fallback = { proc, dsp };
    }
    this.post({ type: "volume", value: this.volume });
    if (this.voice) this.post({ type: "voice", voice: this.voice });
  }

  setConfig(cfg: EngineConfig, summary: EngineSummary): void {
    this.voice = deriveVoice(cfg, summary);
    if (this.tracker) this.tracker.setVoice(this.voice);
    else this.tracker = new ControlTracker(this.voice);
    this.post({ type: "voice", voice: this.voice });
  }

  /** Call every frame with the simulator state and the raw pedal position. */
  update(s: EngineState, pedal: number): void {
    if (!this.tracker) return;
    const frame = this.tracker.next(s, pedal);
    this.post({ type: "control", frame });
  }

  /** 0 … 1 (smoothed inside the DSP, so no clicks). */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.post({ type: "volume", value: this.volume });
  }

  /**
   * Fades out over ≈ 60 ms (output gain, time constant 20 ms), then disconnects and closes an owned
   * context. Safe to call during a pending start(): that start() aborts and leaves no nodes behind.
   */
  stop(): void {
    this.gen++;
    const ctx = this.ctx;
    const node = this.node;
    const fb = this.fallback;
    const out = this.out;
    const owns = this.ownsCtx;
    this.node = null;
    this.fallback = null;
    this.out = null;
    this.starting = null;
    if (owns) this.ctx = null;

    const teardown = () => {
      try {
        node?.port.postMessage({ type: "stop" });
      } catch {
        /* port closed */
      }
      safeDisconnect(node);
      if (fb) {
        fb.proc.onaudioprocess = null;
        safeDisconnect(fb.proc);
      }
      safeDisconnect(out);
      if (ctx && owns) void ctx.close().catch(() => {});
    };
    if (ctx && out && ctx.state === "running") {
      try {
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      } catch {
        /* ignore */
      }
      setTimeout(teardown, STOP_FADE_MS + 40);
    } else teardown();
  }

  private post(m: { type: "voice"; voice: Voice } | { type: "control"; frame: ControlFrame } | { type: "volume"; value: number }) {
    if (this.node) this.node.port.postMessage(m);
    else if (this.fallback) {
      const d = this.fallback.dsp;
      if (m.type === "voice") d.setVoice(m.voice);
      else if (m.type === "control") d.setControl(m.frame);
      else d.setVolume(m.value);
    }
  }
}

/** Fade-out length of stop() (≈ 3 time constants of 20 ms). */
const STOP_FADE_MS = 60;

function safeDisconnect(n: AudioNode | null | undefined) {
  try {
    n?.disconnect();
  } catch {
    /* already disconnected */
  }
}
