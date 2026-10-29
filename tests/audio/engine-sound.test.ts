// EngineSound lifecycle against a minimal fake Web Audio API (no browser in bun:test).
import { afterEach, describe, expect, test } from "bun:test";
import { summarize } from "../../src/core/index.ts";
import { defaultConfig } from "../../src/data/presets.ts";
import { EngineSound } from "../../src/audio/engine-sound.ts";
import { state } from "./helpers.ts";

class FakeParam {
  value = 1;
  events: string[] = [];
  cancelScheduledValues() { this.events.push("cancel"); }
  setValueAtTime(v: number) { this.events.push(`set:${v}`); }
  setTargetAtTime(v: number, _t: number, tau: number) { this.events.push(`target:${v}:${tau}`); }
}
class FakeNode {
  connected = 0;
  disconnected = 0;
  connect(_d: unknown) { this.connected++; }
  disconnect() { this.disconnected++; }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
const nodes: FakeNode[] = [];
let workletNodes: FakeWorkletNode[] = [];
class FakeWorkletNode extends FakeNode {
  messages: unknown[] = [];
  port = { postMessage: (m: unknown) => this.messages.push(m) };
  constructor() {
    super();
    workletNodes.push(this);
  }
}

function fakeCtx(addModuleDelayMs = 0) {
  return {
    state: "running",
    currentTime: 0,
    sampleRate: 48000,
    destination: new FakeNode(),
    closed: false,
    resume: async () => {},
    close: async function (this: { closed: boolean }) { this.closed = true; },
    createGain() { const g = new FakeGain(); nodes.push(g); return g; },
    audioWorklet: { addModule: () => new Promise<void>((r) => setTimeout(r, addModuleDelayMs)) },
  };
}

const g = globalThis as unknown as { AudioWorkletNode?: unknown; document?: unknown };
g.AudioWorkletNode = FakeWorkletNode;
g.document = { baseURI: "http://localhost/" };

afterEach(() => {
  nodes.length = 0;
  workletNodes = [];
});

describe("EngineSound lifecycle", () => {
  test("start → setConfig → update posts voice and control frames to the worklet", async () => {
    const ctx = fakeCtx();
    const s = new EngineSound(ctx as unknown as AudioContext);
    await s.start();
    const cfg = defaultConfig("petrol");
    s.setConfig(cfg, summarize(cfg));
    s.update(state({ t: 0, rpm: 2000, load: 0.3 }), 0.3);
    const types = workletNodes[0]!.messages.map((m) => (m as { type: string }).type);
    expect(types).toContain("voice");
    expect(types).toContain("control");
  });
  test("stop() fades out (setTargetAtTime 0) and disconnects only after ≈ 60 ms", async () => {
    const ctx = fakeCtx();
    const s = new EngineSound(ctx as unknown as AudioContext);
    await s.start();
    const out = nodes[0] as FakeGain;
    const node = workletNodes[0]!;
    s.stop();
    expect(out.gain.events.some((e) => e.startsWith("target:0"))).toBe(true);
    expect(node.disconnected).toBe(0);
    await new Promise((r) => setTimeout(r, 140));
    expect(node.disconnected).toBe(1);
    expect(out.disconnected).toBeGreaterThan(0);
    expect(ctx.closed).toBe(false); // foreign context is not closed
  });
  test("stop() during a pending start() leaves no orphaned worklet node", async () => {
    const ctx = fakeCtx(30);
    const s = new EngineSound(ctx as unknown as AudioContext);
    const p = s.start();
    s.stop();
    await p; // resolves without throwing
    expect(workletNodes.length).toBe(0);
    for (const n of nodes) expect(n.disconnected).toBeGreaterThan(0);
    // and it can be started again afterwards
    await s.start();
    expect(workletNodes.length).toBe(1);
  });
  test("without Web Audio everything is a silent no-op", async () => {
    const saved = (globalThis as { AudioContext?: unknown }).AudioContext;
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const s = new EngineSound();
    await s.start();
    const cfg = defaultConfig("diesel");
    s.setConfig(cfg, summarize(cfg));
    s.update(state({ rpm: 800 }), 0);
    s.setVolume(0.5);
    s.stop();
    (globalThis as { AudioContext?: unknown }).AudioContext = saved;
  });
});
