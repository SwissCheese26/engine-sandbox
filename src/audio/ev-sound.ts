/**
 * Electric drive sound (issue #108): procedural, no samples, small. Two tones and nothing else:
 *  - Motor/inverter whine: the stator current ripple excites the stator at multiples of the electrical frequency
 *    f_e = n/60 · p (pole pairs p ≈ 3 … 4); the dominant audible order of traction PMSMs lies around 6 … 12 × the
 *    shaft frequency, rising with torque (current) [S, NVH measurements of EV drive units, e.g. Fang et al.,
 *    "Electromagnetic noise of PMSM drives", IEEE Trans. Ind. Electron. 2016].
 *  - Gear whine of the reduction: tooth meshing frequency of the input stage, shaft frequency × teeth (≈ 23) [S],
 *    loudest under load and in regen.
 * Pitch ∝ motor speed (EngineState.rpm is the reference motor). Volume follows |torque| and speed.
 */
import type { EngineState } from "../core/index.ts";

/** Whine order (× shaft frequency) and gear-mesh order (pinion teeth). */
export const WHINE_ORDER = 8;
export const GEAR_ORDER = 23;

export interface EvVoice {
  whineHz: number;
  whineGain: number;
  gearHz: number;
  gearGain: number;
}

/** Tones for one frame; silent without an EV state or when not Ready and standing. */
export function evVoice(s: EngineState): EvVoice {
  const ev = s.ev;
  const shaft = Math.max(0, s.rpm) / 60;
  if (!ev || (!ev.ready && shaft < 1)) return { whineHz: 0, whineGain: 0, gearHz: 0, gearGain: 0 };
  const load = Math.min(1, Math.abs(ev.powerKw) / Math.max(50, ev.maxDischargeKw));
  const speed = Math.min(1, shaft / 250);
  const fade = Math.min(1, shaft / 15);
  return {
    whineHz: shaft * WHINE_ORDER,
    whineGain: fade * (0.04 + 0.22 * Math.sqrt(load)) * (0.6 + 0.4 * speed),
    gearHz: shaft * GEAR_ORDER,
    gearGain: fade * (0.015 + 0.06 * load) * speed,
  };
}

type Ctor = new () => AudioContext;

export class EvSound {
  private ctx: AudioContext | null = null;
  private whine: { osc: OscillatorNode; gain: GainNode } | null = null;
  private gear: { osc: OscillatorNode; gain: GainNode } | null = null;
  private master: GainNode | null = null;
  private volume = 0.8;

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  async start(): Promise<void> {
    if (!this.ctx) {
      const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
      const C = g.AudioContext ?? g.webkitAudioContext;
      if (!C) return;
      this.ctx = new C();
    }
    const ctx = this.ctx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    if (this.master) return;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    // the cabin damps the highest orders
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 6500;
    lp.connect(master);
    master.connect(ctx.destination);
    const tone = (type: OscillatorType) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 100;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(lp);
      osc.start();
      return { osc, gain };
    };
    this.whine = tone("triangle");
    this.gear = tone("sine");
    this.master = master;
  }

  update(s: EngineState): void {
    const ctx = this.ctx;
    if (!ctx || !this.whine || !this.gear) return;
    const v = evVoice(s);
    const t = ctx.currentTime;
    const set = (p: AudioParam, x: number) => p.setTargetAtTime(Number.isFinite(x) ? x : 0, t, 0.03);
    set(this.whine.osc.frequency, Math.max(20, Math.min(12000, v.whineHz)));
    set(this.whine.gain.gain, v.whineGain);
    set(this.gear.osc.frequency, Math.max(20, Math.min(12000, v.gearHz)));
    set(this.gear.gain.gain, v.gearGain);
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  suspend(): Promise<void> {
    return this.ctx && this.ctx.state === "running" ? this.ctx.suspend().catch(() => {}) : Promise.resolve();
  }

  resume(): Promise<void> {
    return this.ctx && this.ctx.state === "suspended" ? this.ctx.resume().catch(() => {}) : Promise.resolve();
  }

  stop(): void {
    try {
      this.whine?.osc.stop();
      this.gear?.osc.stop();
      void this.ctx?.close().catch(() => {});
    } catch {
      /* already stopped */
    }
    this.ctx = null;
    this.whine = this.gear = null;
    this.master = null;
  }
}
