import { describe, expect, test } from "bun:test";
import { EvSimulator, defaultInputs } from "../../src/core/index.ts";
import { GEAR_ORDER, WHINE_ORDER, evVoice } from "../../src/audio/ev-sound.ts";
import { libraryCar } from "../../src/data/vehicle-library.ts";

// Electric whine (#108): pitch ∝ motor speed, louder under load, silent when off and standing.
describe("EV voice", () => {
  const sim = new EvSimulator(libraryCar("ev-vw-id3-pro-performance").setup.ev!);
  test("silent when not Ready and standing", () => {
    const v = evVoice(sim.state);
    expect(v.whineGain).toBe(0);
    expect(v.gearGain).toBe(0);
  });
  test("pitch follows the motor speed, gain follows the load", () => {
    const inp = { ...defaultInputs(), ignition: true, pedal: 1 };
    for (let i = 0; i < 20; i++) sim.step(1 / 60, inp);
    const a = evVoice(sim.state);
    for (let i = 0; i < 40; i++) sim.step(1 / 60, inp);
    const b = evVoice(sim.state);
    expect(b.whineHz).toBeGreaterThan(a.whineHz);
    expect(b.whineHz).toBeCloseTo((sim.state.rpm / 60) * WHINE_ORDER, 3);
    expect(b.gearHz).toBeCloseTo((sim.state.rpm / 60) * GEAR_ORDER, 3);
    const loaded = b.whineGain;
    for (let i = 0; i < 30; i++) sim.step(1 / 60, { ...inp, pedal: 0.1 });
    expect(evVoice(sim.state).whineGain).toBeLessThan(loaded);
  });
  test("a combustion state has no EV voice", () => {
    expect(evVoice({ ...sim.state, ev: undefined }).whineGain).toBe(0);
  });
});
