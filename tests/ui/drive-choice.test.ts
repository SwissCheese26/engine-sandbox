import { describe, expect, test } from "bun:test";
import { carWithDrive, driveOptionsHtml, loadDriveChoice, resolveDrive, saveDriveChoice } from "../../src/ui/drive-choice.ts";
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
