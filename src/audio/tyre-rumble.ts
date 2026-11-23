/**
 * Tyre rumble (issue #144): a damaged tyre (local tread separation, out of round) thumps once per wheel turn, a blown
 * one flaps and grinds on the rim. Procedural: low-passed noise, amplitude-modulated at the wheel rotation frequency
 * f = v / (2π·r) (≈ 10 Hz at 100 km/h on a 0.3 m wheel) [S: order-1 tyre non-uniformity, Gent & Walter, The
 * Pneumatic Tire, ch. 9; docs/research/vehicle.md §11]. Quiet on purpose: a hint below the engine sound.
 */
export interface TyreRumbleInput {
  vibration: boolean;
  failed: boolean;
  speedMs: number;
  wheelRadiusM: number;
}

export interface TyreRumbleVoice {
  /** Wheel rotation frequency, Hz (modulation). */
  wheelHz: number;
  gain: number;
  /** Low-pass corner of the noise, Hz: brighter when the tyre is blown (rim grinding). */
  cutoffHz: number;
}

export function tyreRumbleVoice(x: TyreRumbleInput): TyreRumbleVoice {
  const v = Math.max(0, Number.isFinite(x.speedMs) ? x.speedMs : 0);
  const wheelHz = v / (2 * Math.PI * Math.max(0.15, x.wheelRadiusM || 0.3));
  if (!(x.vibration || x.failed) || v < 1) return { wheelHz, gain: 0, cutoffHz: 150 };
  const speed = Math.min(1, v / 50);
  return { wheelHz, gain: (x.failed ? 0.12 : 0.05) * (0.4 + 0.6 * speed), cutoffHz: x.failed ? 600 : 160 };
}

type Ctor = new () => AudioContext;

export class TyreRumble {
  private ctx: AudioContext | null = null;
  private nodes: { lp: BiquadFilterNode; lfo: OscillatorNode; level: GainNode; src: AudioBufferSourceNode } | null = null;
  private master: GainNode | null = null;
  private volume = 0.8;

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
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;
    // amplitude modulation 0 … 1 at the wheel frequency: gain 0.5 + 0.5·sin
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(am.gain);
    const level = ctx.createGain();
    level.gain.value = 0;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    src.connect(lp).connect(am).connect(level).connect(master).connect(ctx.destination);
    src.start();
    lfo.start();
    this.nodes = { lp, lfo, level, src };
    this.master = master;
  }

  update(x: TyreRumbleInput): void {
    const ctx = this.ctx;
    const n = this.nodes;
    if (!ctx || !n) return;
    const v = tyreRumbleVoice(x);
    const t = ctx.currentTime;
    n.level.gain.setTargetAtTime(v.gain, t, 0.08);
    n.lfo.frequency.setTargetAtTime(Math.max(0.5, Math.min(80, v.wheelHz)), t, 0.05);
    n.lp.frequency.setTargetAtTime(v.cutoffHz, t, 0.1);
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
      this.nodes?.src.stop();
      this.nodes?.lfo.stop();
      void this.ctx?.close().catch(() => {});
    } catch {
      /* already stopped */
    }
    this.ctx = null;
    this.nodes = null;
    this.master = null;
  }
}
