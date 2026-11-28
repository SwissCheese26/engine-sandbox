import { describe, expect, test } from "bun:test";
import type { EngineState, HybridState } from "../../src/core/index.ts";
import { flowArrows } from "../../src/ui/layouts/hybrid-flow.ts";
import { flowText } from "../../src/ui/ev-panel.ts";

const base: HybridState = {
  mode: "hybrid", topology: "power-split", engineOn: false, engineStarting: false, engineCoupled: false, evDrive: true, engineRpm: 0, engineKw: 0,
  engineToWheelKw: 0, batteryKw: 0, motorKw: 0, wheelKw: 0, fuelLh: 0, gear: 1, engine: {} as EngineState,
};

describe("hybrid power flow (#157)", () => {
  test("electric driving: battery → motor → wheels", () => {
    const a = flowArrows({ ...base, batteryKw: 12, motorKw: 11, wheelKw: 10 });
    expect(a).toEqual({ engWheel: false, engBat: false, batMot: "fwd", motWheel: "fwd" });
  });
  test("engine drives and charges (load-point shift)", () => {
    const h = { ...base, engineOn: true, evDrive: false, engineKw: 30, engineToWheelKw: 18, batteryKw: -8, motorKw: -7, wheelKw: 18 };
    expect(flowArrows(h)).toEqual({ engWheel: true, engBat: true, batMot: "rev", motWheel: "off" });
    expect(flowText(h)).toBe("Motor → Räder · Motor → Akku");
  });
  test("regenerative braking: wheels → motor → battery, the engine does not charge", () => {
    const h = { ...base, batteryKw: -20, motorKw: -22, wheelKw: -24 };
    expect(flowArrows(h)).toEqual({ engWheel: false, engBat: false, batMot: "rev", motWheel: "rev" });
    expect(flowText(h)).toBe("Räder → Akku");
  });
});
