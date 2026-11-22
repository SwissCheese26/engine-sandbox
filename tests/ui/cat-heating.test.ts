// Catalyst heating in the UI (#135): calm toast "Kat heizt", field and gauge "Kat-Temp"; sound: rougher idle.
import { describe, expect, test } from "bun:test";
import { EngineSimulator, defaultInputs, summarize } from "../../src/core/index.ts";
import type { EngineState } from "../../src/core/index.ts";
import { libraryConfig } from "../../src/data/engine-library.ts";
import { ControlTracker, deriveVoice } from "../../src/audio/model.ts";
import { ToastQueue } from "../../src/ui/toast-queue.ts";
import { toastInputs } from "../../src/ui/toasts.ts";
import { fieldAvailable, formatField, type FieldInputs } from "../../src/ui/layouts/fields-logic.ts";
import { gaugeAvailable, gaugeValue } from "../../src/ui/layouts/extras-logic.ts";
import { FIELD_IDS, GAUGE_IDS } from "../../src/ui/layouts/designs.ts";
import { BULB_CHECK_S, clusterLamps } from "../../src/ui/layouts/logic.ts";
import { evLamps } from "../../src/ui/layouts/ev-logic.ts";

const U = { temp: "°C", pressure: "bar", speed: "km/h", fuel: "l/100km", distance: "km", power: "kW", torque: "Nm" } as never;

function coldGolf(seconds: number): EngineState {
  const sim = new EngineSimulator(libraryConfig("ref-vw-ea888-gen3-chhb"));
  let s = sim.state;
  for (let t = 0; t < seconds; t += 0.05) s = sim.step(0.05, { ...defaultInputs(), ignition: true, starter: t < 1 });
  return s;
}

describe("catalyst heating in the cockpit (#135)", () => {
  const s = coldGolf(10);

  test("the toast is a calm info note, shown only with the toast setting", () => {
    const inp = toastInputs({ state: s, outOfFuel: false }).find((t) => t.key === "cat-heating");
    expect(inp?.severity).toBe("info");
    expect(inp?.always).toBeFalsy();
    expect(new ToastQueue().sync([inp!], 0, false).added).toHaveLength(0);
    expect(new ToastQueue().sync([inp!], 0, true).added).toHaveLength(1);
  });

  test("Kat-Temp is a field and a gauge, only with a catalyst; signal colour while heating", () => {
    expect(FIELD_IDS).toContain("cat");
    expect(GAUGE_IDS).toContain("cat");
    expect(fieldAvailable("cat", { turbo: true, vehicle: false })).toBe(false);
    expect(fieldAvailable("cat", { turbo: true, vehicle: false, cat: true })).toBe(true);
    expect(gaugeAvailable("cat", { turbo: true, cat: true })).toBe(true);
    const f = formatField("cat", { catalystC: s.catalystC, catHeating: s.coldStart === "cat-heating" } as FieldInputs, U);
    expect(f.label).toBe("Kat-Temp");
    expect(Number(f.value.replace(/\./g, ""))).toBeCloseTo(Math.round(s.catalystC!), -1);
    expect(f.warn).toBe(true);
    expect(gaugeValue("cat", { catalystC: 412 } as never, U)).toBe(412);
  });

  test("sound: the catalyst-heating idle is rough, a warm idle is not", () => {
    const cfg = libraryConfig("ref-vw-ea888-gen3-chhb");
    const tr = new ControlTracker(deriveVoice(cfg, summarize(cfg)));
    expect(tr.next(s, 0).rough).toBe(1);
    expect(tr.next({ ...s, coldStart: undefined }, 0).rough).toBe(0);
  });

  test("lamp \"Kat heizt\" lights while the catalyst is heated, off otherwise and in an EV", () => {
    const base = { ignition: true, running: true, sinceIgnitionS: BULB_CHECK_S + 5, diesel: false, coolantC: 20, coolantMaxC: 115, oilPressureBar: 2, damaged: false, warnings: [] };
    expect(clusterLamps({ ...base, catHeating: s.coldStart === "cat-heating" }).cat).toBe("on");
    expect(clusterLamps({ ...base, catHeating: false }).cat).toBe("off");
    expect(clusterLamps({ ...base, running: false, catHeating: true }).cat).toBe("off");
    expect(clusterLamps({ ...base, ignition: false, catHeating: true }).cat).toBe("off");
    const on = clusterLamps({ ...base, catHeating: true });
    expect(evLamps(on, { ready: true, ignition: true, soc: 0.8, warnings: [] }).cat).toBe("off");
  });
});
