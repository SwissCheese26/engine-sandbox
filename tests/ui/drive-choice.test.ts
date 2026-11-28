import { describe, expect, test } from "bun:test";
import { carWithDrive, driveOptionsHtml, forgetVehicle, loadDriveChoice, resolveDrive, saveDriveChoice } from "../../src/ui/drive-choice.ts";
import { loadCustom, saveCustom } from "../../src/ui/vehicle-custom.ts";
import { EV_TUNING_KEY, saveEvTuning } from "../../src/ui/ev-tuning-store.ts";
import { evTuningOf } from "../../src/data/ev-tuning.ts";
import { libraryCar } from "../../src/data/vehicle-library.ts";

// Antrieb choice (#154): ids, the swapped vehicle and the per-vehicle store.
describe("drive choice", () => {
  test("ids resolve to engines or electric drives; unknown ids keep the factory car", () => {
    expect(resolveDrive("ref-gm-ls3-62")!.engineId).toBe("ref-gm-ls3-62");
    expect(resolveDrive("ev:ev-tesla-model-s-lr")!.spec.ev).toBeDefined();
    expect(resolveDrive("ev:car-vw-golf7-gti")).toBeNull();
    const golf = libraryCar("car-vw-golf7-gti");
    expect(carWithDrive(golf, "")).toBe(golf);
    expect(carWithDrive(golf, "lib-gibt-es-nicht")).toBe(golf);
    const ev = carWithDrive(golf, "ev:ev-tesla-model-s-lr");
    expect(ev.id).toBe("car-vw-golf7-gti@ev:ev-tesla-model-s-lr");
    expect(ev.engineId).toBe("");
    expect(ev.setup.ev!.motors.every((m) => m.axle === "front")).toBe(true);
  });

  test("the select offers the factory drive, electric drives and every engine class", () => {
    const html = driveOptionsHtml();
    for (const s of ['value=""', "ev:ev-tesla-model-s-lr", "lib-mercedes-om471", "lib-honda-cbr1000rr-sc59", "ref-gm-ls3-62"]) expect(html).toContain(s);
    expect(driveOptionsHtml(null)).not.toContain('value=""');
  });

  test("stored per vehicle, '' forgets it", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveDriveChoice("bus-mercedes-citaro-o530", "ev:ev-tesla-model-s-lr", st);
    saveDriveChoice("car-vw-golf7-gti", "ref-gm-ls3-62", st);
    expect(loadDriveChoice("bus-mercedes-citaro-o530", st)).toBe("ev:ev-tesla-model-s-lr");
    saveDriveChoice("bus-mercedes-citaro-o530", "", st);
    expect(loadDriveChoice("bus-mercedes-citaro-o530", st)).toBe("");
    expect(loadDriveChoice("car-vw-golf7-gti", st)).toBe("ref-gm-ls3-62");
  });
});

describe("Auf Werkszustand (#154 review)", () => {
  test("forgets own changes, the drive choice and the E-Tuner setups of factory and swapped drive", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    const key = "ev-tesla-model-s-lr";
    saveCustom(key, { kind: "car", tankL: 40 }, st);
    saveCustom("car-vw-golf7-gti", { kind: "car", tankL: 45 }, st);
    saveDriveChoice(key, "ref-gm-ls3-62", st);
    const tuning = evTuningOf(libraryCar(key).setup.ev!);
    saveEvTuning(key, tuning, st);
    saveEvTuning(`${key}@ev:ev-vw-id3-pro-performance`, tuning, st);
    saveEvTuning("ev-vw-id3-pro-performance", tuning, st);
    forgetVehicle(key, [key, `${key}@ev:ev-vw-id3-pro-performance`, ""], st);
    expect(loadCustom(key, undefined, st)).toBeNull();
    expect(loadDriveChoice(key, st)).toBe("");
    const tunings = JSON.parse(m.get(EV_TUNING_KEY) ?? "{}");
    expect(Object.keys(tunings)).toEqual(["ev-vw-id3-pro-performance"]);
    // other vehicles keep theirs
    expect(loadCustom("car-vw-golf7-gti", undefined, st)?.tankL).toBe(45);
  });
});
