// Car-style cockpit designs: three skins named descriptively (no marks), each on a base layout, and "Automatisch"
// picking the cluster a library car brings (declared hint or id pattern), else the rules by vehicle kind.
import { describe, expect, test } from "bun:test";
import { VEHICLE_LIBRARY } from "../../src/data/vehicle-library.ts";
import {
  CAR_DESIGN_HINTS, COCKPIT_DESIGNS, DESIGN_CHOICES, carDesign, dialTheme, gaugeKind, isCockpitDesign, layoutOf, resolveDesign,
} from "../../src/ui/layouts/designs.ts";
import { validateSettings } from "../../src/ui/settings.ts";

const NEW = { "copper-digital": "Spanisch Kupfer (digital)", "ingolstadt-red": "Ingolstadt Rot", "munich-orange": "München Orange" } as const;

describe("design list: car-style clusters", () => {
  test("the three designs are offered with their descriptive names, after Automatisch", () => {
    for (const [id, label] of Object.entries(NEW)) {
      const d = COCKPIT_DESIGNS.find((x) => x.id === id);
      expect(d?.label).toBe(label);
      expect(DESIGN_CHOICES.some((c) => c.id === id && c.label === label)).toBe(true);
      expect(validateSettings({ cockpitDesign: id }).cockpitDesign).toBe(id);
    }
    expect(DESIGN_CHOICES[0]!.id).toBe("auto");
  });
  test("no maker names or marks in labels and hints", () => {
    for (const id of Object.keys(NEW)) {
      const d = COCKPIT_DESIGNS.find((x) => x.id === id)!;
      expect(`${d.label} ${d.hint}`).not.toMatch(/cupra|seat|audi|bmw|vw|volkswagen/i);
    }
  });
  test("skins keep their base layout: digital screen for copper, the classic two dials for red and orange", () => {
    expect(layoutOf("copper-digital")).toBe("digital");
    expect(gaugeKind("copper-digital")).toBe("screen");
    expect(layoutOf("ingolstadt-red")).toBe("classic");
    expect(layoutOf("munich-orange")).toBe("classic");
    expect(gaugeKind("munich-orange")).toBe("dial");
    expect(layoutOf("classic")).toBe("classic");
    expect(layoutOf("truck")).toBe("truck");
    // every layout a skin refers to is a real design without a layout of its own
    for (const d of COCKPIT_DESIGNS) if (d.layout) expect(layoutOf(d.layout)).toBe(d.layout);
  });
  test("own dial look: red needles on a thin bezel, deep orange-lit tubes with the eco gauge inside the rev counter", () => {
    expect(dialTheme("ingolstadt-red")).toMatchObject({ needle: "taper", ring: "alu" });
    expect(dialTheme("munich-orange").ring).toBe("tunnel");
    expect(COCKPIT_DESIGNS.find((d) => d.id === "munich-orange")!.inset).toBe("fuel");
    expect(COCKPIT_DESIGNS.filter((d) => d.inset).map((d) => d.id)).toEqual(["munich-orange"]);
  });
});

describe("auto picks the car's own cluster", () => {
  test("id patterns for the Leon, the A1 8X and the 1 Series F20/F21", () => {
    expect(carDesign("car-cupra-leon-vz-st")).toBe("copper-digital");
    expect(carDesign("car-cupra-leon")).toBe("copper-digital");
    expect(carDesign("car-audi-a1-8x-14tfsi")).toBe("ingolstadt-red");
    expect(carDesign("car-audi-a1")).toBe("ingolstadt-red");
    expect(carDesign("car-audi-a1-gb-30tfsi")).toBeUndefined();
    expect(carDesign("car-bmw-f20-120d")).toBe("munich-orange");
    expect(carDesign("car-bmw-118i-f20")).toBe("munich-orange");
    expect(carDesign("car-bmw-m3-e92")).toBeUndefined();
    expect(carDesign("car-cupra-leonardo")).toBeUndefined();
    expect(carDesign("")).toBeUndefined();
    for (const [, id] of CAR_DESIGN_HINTS) expect(isCockpitDesign(id)).toBe(true);
  });
  test("a declared hint wins over the patterns; unknown hints are ignored", () => {
    expect(carDesign("car-vw-golf7-gti", "digital")).toBe("digital");
    expect(carDesign("car-bmw-f20-120d", "ingolstadt-red")).toBe("ingolstadt-red");
    expect(carDesign("car-bmw-f20-120d", "nope")).toBe("munich-orange");
  });
  test("auto: the car's design first, else the rules by kind; a fixed choice always wins", () => {
    expect(resolveDesign("auto", "car", false, carDesign("car-cupra-leon-vz-st"))).toBe("copper-digital");
    expect(resolveDesign("auto", "car", false, carDesign("car-audi-a1-8x"))).toBe("ingolstadt-red");
    expect(resolveDesign("auto", "car", false, carDesign("car-bmw-f20-118i"))).toBe("munich-orange");
    expect(resolveDesign("auto", "car", false, carDesign("car-vw-golf7-gti"))).toBe("classic");
    expect(resolveDesign("auto", "truck", false, undefined)).toBe("truck");
    expect(resolveDesign("classic", "car", false, "munich-orange")).toBe("classic");
  });
  test("library: declared hints are valid designs; today's cars keep the rules", () => {
    for (const c of VEHICLE_LIBRARY) if (c.cockpitDesign !== undefined) expect(isCockpitDesign(c.cockpitDesign)).toBe(true);
    expect(carDesign("car-bmw-530d-e60")).toBeUndefined();
  });
});
