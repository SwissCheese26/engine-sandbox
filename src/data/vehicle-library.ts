import type { CarSetup, GearboxSpec, TyreSetup, VehicleParams } from "../core/index.ts";

/**
 * Ready-made cars (issue #22): engine from the engine library (#15) + gearbox with the car's own ratios + body,
 * chassis, tyres and top-speed governor. "Fertiges Auto laden" in the Fahrzeug plate loads all of it.
 *
 * Manual gearboxes of the sports cars shift in 0.25 s (test-driver shift, as in magazine 0–100 runs) [S].
 * Simulation mass = kerb weight incl. 75 kg driver (EU definition; DIN kerb weight + 75 kg where only DIN is known).
 * Factory data (`factory`) are the test targets (tests/core/vehicle-library.test.ts: simulated 0–100 and Vmax within
 * ±12 %). Sources per car in `source`; values marked [S] are estimates from typical data of the class (cW, frontal
 * area, CG height, gear ratios where not published).
 * Automatic gearboxes with torque converter (ZF 6HP, 9G-Tronic, Aisin A343F) are modelled as "dsg" (automatic shift
 * schedule, lock-up clutch closed) with lower efficiency; their converter multiplication at launch is not modelled.
 */
export interface LibraryCar {
  id: string;
  name: string;
  maker: string;
  years: string;
  /** Engine library id (src/data/engine-library.ts). */
  engineId: string;
  setup: CarSetup;
  factory: {
    /** Kerb weight as published (kg) and its norm. */
    kerbKg: number;
    kerbNorm: "EU" | "DIN";
    t0to100S: number;
    vmaxKmh: number;
    /** True when the published Vmax is the governor. */
    vmaxGoverned: boolean;
    cw?: number;
  };
  source: string;
}

const DRIVER_KG = 75;
const mass = (kerb: number, norm: "EU" | "DIN") => (norm === "EU" ? kerb : kerb + DRIVER_KG);

/** Body helper: cgToRearAxleM from the static front axle share. */
function body(m: number, cw: number, area: number, layout: VehicleParams["driveLayout"], front: number, cgH: number, wb: number): VehicleParams {
  return {
    massKg: m, dragCoefficient: cw, frontalAreaM2: area, rollingResistance: 0.011, wheelRadiusM: 0.31,
    driveLayout: layout, cgHeightM: cgH, cgToRearAxleM: front * wb, wheelbaseM: wb,
  };
}
const tyre = (type: TyreSetup["type"], w: number, a: number, rim: number, idx: TyreSetup["speedIndex"]): TyreSetup => ({
  type, size: { widthMm: w, aspectPct: a, rimInch: rim }, speedIndex: idx,
});
const box = (ratios: number[], finalDrive: number, efficiency: number, shiftTimeS: number): GearboxSpec => ({ ratios, finalDrive, efficiency, shiftTimeS });

export const VEHICLE_LIBRARY: LibraryCar[] = [
  {
    id: "car-vw-golf7-gti", name: "VW Golf 7 GTI (DSG)", maker: "VW", years: "2013–2017", engineId: "ref-vw-ea888-gen3-chhb",
    setup: {
      vehicle: body(1382, 0.31, 2.19, "fwd", 0.62, 0.55, 2.631),
      tyre: tyre("uhp", 225, 45, 17, "W"),
      gearbox: "dsg",
      // DQ250 6-speed DSG: 3.462/2.050/1.300/0.902/0.914/0.756, final 4.118 (1–4) and 3.043 (5–6); 5th/6th
      // converted to the single final drive 4.118 [VW Selbststudienprogramm 308 / ETKA]
      gearboxSpec: box([3.462, 2.05, 1.3, 0.902, 0.675, 0.559], 4.118, 0.92, 0.1),
      speedLimitKmh: 250,
    },
    factory: { kerbKg: 1382, kerbNorm: "EU", t0to100S: 6.5, vmaxKmh: 246, vmaxGoverned: false, cw: 0.31 },
    source: "VW Pressemappe Golf GTI 2013 (162 kW, DSG: 6,5 s, 246 km/h, 1382 kg)",
  },
  {
    id: "car-vw-golf6-tdi", name: "VW Golf 6 2.0 TDI (Handschalter)", maker: "VW", years: "2008–2012", engineId: "lib-vw-ea189-20tdi-103kw",
    setup: {
      vehicle: body(mass(1320, "DIN"), 0.32, 2.22, "fwd", 0.63, 0.55, 2.578),
      tyre: tyre("standard", 205, 55, 16, "V"),
      gearbox: "manual",
      // 02Q 6-speed: 3.769/2.087/1.324/0.977/0.975/0.814, finals 3.450 / 2.760 → 5th/6th converted [S]
      gearboxSpec: box([3.769, 2.087, 1.324, 0.977, 0.78, 0.651], 3.45, 0.93, 0.35),
      speedLimitKmh: null,
    },
    factory: { kerbKg: 1320, kerbNorm: "DIN", t0to100S: 9.3, vmaxKmh: 210, vmaxGoverned: false, cw: 0.32 },
    source: "VW Preisliste/Technische Daten Golf VI 2.0 TDI 103 kW (9,3 s, 210 km/h)",
  },
  {
    id: "car-bmw-530d-e60", name: "BMW 530d E60 (Steptronic)", maker: "BMW", years: "2005–2007", engineId: "lib-bmw-m57d30tu2",
    setup: {
      vehicle: body(mass(1590, "DIN"), 0.28, 2.26, "rwd", 0.51, 0.53, 2.888),
      tyre: tyre("standard", 245, 45, 17, "W"),
      gearbox: "dsg",
      // ZF 6HP26: 4.171/2.340/1.521/1.143/0.867/0.691, final 2.56 [S]
      gearboxSpec: { ...box([4.171, 2.34, 1.521, 1.143, 0.867, 0.691], 2.56, 0.9, 0.2), converterLockRpm: 2400 },
      speedLimitKmh: 250,
    },
    factory: { kerbKg: 1590, kerbNorm: "DIN", t0to100S: 6.8, vmaxKmh: 248, vmaxGoverned: false, cw: 0.28 },
    source: "auto-data.net, BMW 5 Series E60 530d 231 hp Automatic (1590 kg, 6,8 s, 248 km/h, cW 0,28)",
  },
  {
    id: "car-bmw-m3-e46", name: "BMW M3 E46", maker: "BMW", years: "2000–2006", engineId: "ref-bmw-s54b32",
    setup: {
      vehicle: body(mass(1570, "DIN"), 0.32, 2.07, "rwd", 0.51, 0.5, 2.731),
      tyre: tyre("uhp", 255, 40, 18, "Y"),
      gearbox: "manual",
      // Getrag 420G 6-speed: 4.23/2.53/1.67/1.23/1.00/0.83, final 3.62 [BMW M3 E46 Technische Daten]
      gearboxSpec: box([4.23, 2.53, 1.67, 1.23, 1.0, 0.83], 3.62, 0.92, 0.25),
      speedLimitKmh: 250,
    },
    factory: { kerbKg: 1570, kerbNorm: "DIN", t0to100S: 5.2, vmaxKmh: 250, vmaxGoverned: true, cw: 0.32 },
    source: "BMW M GmbH Pressemappe M3 E46 (252 kW, 5,2 s, 250 km/h abgeregelt, 1570 kg DIN)",
  },
  {
    id: "car-bmw-m3-e92", name: "BMW M3 E92 (Handschalter)", maker: "BMW", years: "2007–2013", engineId: "lib-bmw-s65b40",
    setup: {
      vehicle: body(1655, 0.31, 2.17, "rwd", 0.52, 0.5, 2.761),
      tyre: tyre("uhp", 265, 40, 18, "Y"),
      gearbox: "manual",
      // Getrag 6-speed: 4.055/2.396/1.582/1.192/1.000/0.872, final 3.846 [BMW Technische Daten M3 Coupé]
      gearboxSpec: box([4.055, 2.396, 1.582, 1.192, 1.0, 0.872], 3.846, 0.92, 0.25),
      speedLimitKmh: 250,
    },
    factory: { kerbKg: 1655, kerbNorm: "EU", t0to100S: 4.8, vmaxKmh: 250, vmaxGoverned: true, cw: 0.31 },
    source: "BMW Pressemappe M3 Coupé 2007 (309 kW, 4,8 s, 250 km/h abgeregelt, 1655 kg EU)",
  },
  {
    id: "car-toyota-supra-mk4", name: "Toyota Supra Mk4 Turbo (JZA80)", maker: "Toyota", years: "1993–2002", engineId: "lib-toyota-2jz-gte",
    setup: {
      vehicle: body(mass(1570, "DIN"), 0.32, 1.98, "rwd", 0.53, 0.48, 2.55),
      tyre: tyre("uhp", 255, 40, 17, "W"),
      gearbox: "manual",
      // Getrag V160 6-speed: 3.827/2.360/1.685/1.312/1.000/0.793, final 3.133 [Toyota Supra Turbo 6MT, US-Spec]
      gearboxSpec: box([3.827, 2.36, 1.685, 1.312, 1.0, 0.793], 3.133, 0.92, 0.25),
      speedLimitKmh: 250,
    },
    factory: { kerbKg: 1570, kerbNorm: "DIN", t0to100S: 5.1, vmaxKmh: 250, vmaxGoverned: true, cw: 0.32 },
    source: "Toyota Supra Turbo (EU/US, 239 kW): 5,1 s, 250 km/h abgeregelt, 1570 kg [S: Herstellerangaben, nicht neu verifiziert]",
  },
  {
    id: "car-nissan-skyline-r34", name: "Nissan Skyline GT-R R34", maker: "Nissan", years: "1999–2002", engineId: "lib-nissan-rb26dett",
    setup: {
      vehicle: body(mass(1560, "DIN"), 0.35, 1.95, "awd", 0.555, 0.5, 2.665),
      tyre: tyre("uhp", 245, 40, 18, "Y"),
      gearbox: "manual",
      // Getrag V160: 3.827/2.360/1.685/1.312/1.000/0.793, final 3.545; ATTESA E-TS modelled as permanent AWD
      gearboxSpec: box([3.827, 2.36, 1.685, 1.312, 1.0, 0.793], 3.545, 0.88, 0.25),
      // Japanese market: 180 km/h governor (JAMA agreement)
      speedLimitKmh: 180,
    },
    factory: { kerbKg: 1560, kerbNorm: "DIN", t0to100S: 5.0, vmaxKmh: 180, vmaxGoverned: true },
    source: "j-garage.com BNR34 Spezifikation (1560 kg, Übersetzungen, 245/40 ZR18); 0–100 kein Werkswert, ≈ 5,0 s Fachpresse; JDM 180 km/h abgeregelt",
  },
  {
    id: "car-subaru-impreza-sti", name: "Subaru Impreza WRX STI (GR)", maker: "Subaru", years: "2008–2014", engineId: "lib-subaru-ej257",
    setup: {
      vehicle: body(1505, 0.36, 2.15, "awd", 0.6, 0.52, 2.625),
      tyre: tyre("uhp", 245, 40, 18, "W"),
      gearbox: "manual",
      // TY85 6-speed: 3.636/2.375/1.761/1.346/0.971/0.756, final 3.900, DCCD AWD
      gearboxSpec: box([3.636, 2.375, 1.761, 1.346, 0.971, 0.756], 3.9, 0.88, 0.25),
      speedLimitKmh: null,
    },
    factory: { kerbKg: 1505, kerbNorm: "EU", t0to100S: 5.2, vmaxKmh: 255, vmaxGoverned: false },
    source: "Subaru Deutschland Impreza WRX STI 2008 (221 kW, 5,2 s, 255 km/h, 1505 kg) [S: aus Herstellerangaben, nicht neu verifiziert]",
  },
  {
    id: "car-honda-integra-dc5", name: "Honda Integra Type R (DC5)", maker: "Honda", years: "2001–2006", engineId: "ref-honda-k20a-type-r",
    setup: {
      vehicle: body(mass(1170, "DIN"), 0.32, 1.95, "fwd", 0.62, 0.5, 2.57),
      tyre: tyre("uhp", 215, 45, 17, "W"),
      gearbox: "manual",
      // 6-speed close ratio: 3.267/2.130/1.517/1.147/0.921/0.738, final 4.764 (JDM Type R) [S]
      gearboxSpec: box([3.267, 2.13, 1.517, 1.147, 0.921, 0.738], 4.764, 0.93, 0.25),
      speedLimitKmh: null,
    },
    factory: { kerbKg: 1170, kerbNorm: "DIN", t0to100S: 6.2, vmaxKmh: 240, vmaxGoverned: false },
    source: "autodata1.com Integra DC5 Type R 220 PS (1170 kg, 240 km/h, 215/45 ZR17); 0–100 kein Werkswert, ≈ 6,2 s Fachpresse",
  },
  {
    id: "car-chevrolet-corvette-c6", name: "Chevrolet Corvette C6 (LS3)", maker: "Chevrolet", years: "2008–2013", engineId: "ref-gm-ls3-62",
    setup: {
      vehicle: body(mass(1461, "DIN"), 0.28, 2.0, "rwd", 0.51, 0.46, 2.685),
      tyre: tyre("uhp", 285, 35, 19, "(Y)"),
      gearbox: "manual",
      // Tremec TR6060: 2.66/1.78/1.30/1.00/0.74/0.50, final 3.42 [GM Corvette 2008 specifications]
      gearboxSpec: box([2.66, 1.78, 1.3, 1.0, 0.74, 0.5], 3.42, 0.92, 0.25),
      speedLimitKmh: null,
    },
    factory: { kerbKg: 1461, kerbNorm: "DIN", t0to100S: 4.4, vmaxKmh: 306, vmaxGoverned: false, cw: 0.28 },
    source: "auto-data.net Corvette Coupé C6 6.2 V8 437 PS, 6-Gang (1461 kg, 4,4 s, 306 km/h, 285/35 ZR19 hinten)",
  },
  {
    id: "car-ferrari-458", name: "Ferrari 458 Italia (F1-DCT)", maker: "Ferrari", years: "2009–2015", engineId: "ref-ferrari-f136fb-458",
    setup: {
      vehicle: body(mass(1485, "DIN"), 0.33, 2.0, "rwd", 0.42, 0.45, 2.65),
      tyre: tyre("uhp", 295, 35, 20, "(Y)"),
      gearbox: "dsg",
      // Getrag 7DCL750: 3.08/2.19/1.63/1.29/1.03/0.84/0.69, final 4.44 [S]
      gearboxSpec: box([3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], 4.44, 0.93, 0.06),
      speedLimitKmh: null,
    },
    factory: { kerbKg: 1485, kerbNorm: "DIN", t0to100S: 3.4, vmaxKmh: 325, vmaxGoverned: false, cw: 0.33 },
    source: "Ferrari 458 Italia Pressemappe 2009 (419 kW, < 3,4 s, > 325 km/h, 1485 kg fahrfertig) [S: nicht neu verifiziert]",
  },
  {
    id: "car-mercedes-e220d", name: "Mercedes-Benz E 220 d (W213)", maker: "Mercedes-Benz", years: "2016–2020", engineId: "ref-mercedes-om654-220d",
    setup: {
      vehicle: body(1680, 0.23, 2.33, "rwd", 0.53, 0.53, 2.939),
      tyre: tyre("standard", 225, 55, 17, "W"),
      gearbox: "dsg",
      // 9G-Tronic: 5.35/3.24/2.25/1.64/1.21/1.00/0.86/0.72/0.60, final 2.65 [S]
      gearboxSpec: { ...box([5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.86, 0.72, 0.6], 2.65, 0.9, 0.15), converterLockRpm: 2400 },
      speedLimitKmh: null,
    },
    factory: { kerbKg: 1680, kerbNorm: "EU", t0to100S: 7.3, vmaxKmh: 240, vmaxGoverned: false, cw: 0.23 },
    source: "Mercedes-Benz Pressemappe E-Klasse W213 2016 (143 kW, 7,3 s, 240 km/h, 1680 kg EU, cW 0,23) [S: nicht neu verifiziert]",
  },
  {
    id: "car-toyota-land-cruiser-120", name: "Toyota Land Cruiser Prado 120 3.0 D-4D", maker: "Toyota", years: "2003–2009", engineId: "lib-toyota-1kd-ftv",
    setup: {
      vehicle: body(mass(1940, "DIN"), 0.4, 2.95, "awd", 0.52, 0.72, 2.79),
      tyre: tyre("offroad", 265, 65, 17, "S"),
      gearbox: "dsg",
      // Aisin A343F 4-speed automatic: 2.804/1.531/1.000/0.705, final 3.909, permanent 4WD [S]
      gearboxSpec: { ...box([2.804, 1.531, 1.0, 0.705], 3.909, 0.86, 0.25), converterLockRpm: 1600 },
      speedLimitKmh: null,
    },
    factory: { kerbKg: 1940, kerbNorm: "DIN", t0to100S: 12.8, vmaxKmh: 170, vmaxGoverned: false },
    source: "autodata1.com Land Cruiser 120 Prado 3.0 D-4D 163 PS Automatik (1940 kg, 12,8 s, 170 km/h, Radstand 2790 mm)",
  },
];

export function libraryCar(id: string): LibraryCar {
  const c = VEHICLE_LIBRARY.find((x) => x.id === id);
  if (!c) throw new Error(`unknown library car: ${id}`);
  return structuredClone(c);
}
