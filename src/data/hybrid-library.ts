/**
 * Hybrid cars (issue #157): body, tyres, engine (engine library), motors, battery and the hybrid topology of real
 * cars. Listed in VEHICLE_LIBRARY (vehicle-library.ts) with `setup.ev` + `setup.hybrid` and their library engine.
 * Sources per car in `source`, physics and derivations in docs/research/hybrid.md §4–§5. Values marked [S] are
 * estimates (frontal area, CG, gear ratios, per-motor split, cell data); published are system power, 0–100, Vmax,
 * mass, battery energy and voltage, motor power and torque.
 *
 * Simulation mass = kerb weight incl. 75 kg driver (EU), as in vehicle-library.ts. Battery masses are the published
 * pack masses where known (hybrid packs carry far more housing and cooling per kWh than an EV pack).
 */
import { withTyre } from "../core/index.ts";
import type { CarSetup, EvBatteryConfig, EvConfig, EvMotorConfig, GearboxType, HybridConfig, TyreSetup, VehicleParams } from "../core/index.ts";
import { DRIVER_KG, body, motor, pack, tyre } from "./ev-library.ts";
import type { LibraryCar } from "./vehicle-library.ts";

function ev(motors: EvMotorConfig[], battery: EvBatteryConfig, massKg: number, liftOffRegenG = 0.06): EvConfig {
  return { motors, battery: { ...battery, massKg }, gearEfficiency: 0.95, liftOffRegenG, ratedKwhPer100: 16, auxKw: 0.4 };
}

/** The gearbox fields describe the engine side (p2 / mild); the drivetrain runs the electric path (CarSetup.hybrid). */
function setup(vehicle: VehicleParams, t: TyreSetup, e: EvConfig, hy: HybridConfig, gearbox: GearboxType, tankL: number, speedLimitKmh: number | null): CarSetup {
  const ratios = hy.ratios ?? [1];
  return {
    kind: "car", vehicle: withTyre(vehicle, t), tyre: t, gearbox, tankL, speedLimitKmh, ev: e, hybrid: hy,
    gearboxSpec: { ratios, finalDrive: hy.finalDrive ?? e.motors[0]!.ratio, efficiency: e.gearEfficiency, shiftTimeS: 0.15 },
  };
}

export const HYBRID_LIBRARY: LibraryCar[] = [
  {
    id: "hy-toyota-prius-4", name: "Toyota Prius 1.8 Hybrid (4. Gen.)", maker: "Toyota", years: "2016–2022", engineId: "lib-toyota-2zr-fxe",
    setup: setup(
      // kerb 1375 kg (DIN, Toyota); cW 0.24 (Toyota); A ≈ 2.24 m² [S]; wheelbase 2.700 m
      body(1375 + DRIVER_KG, 0.24, 2.24, "fwd", 0.6, 0.52, 2.7),
      tyre("standard", 195, 65, 15, "H"),
      // MG2 53 kW / 163 Nm, 17 000 1/min, reduction 2.636 × final 3.218 [S]; Li-ion 207 V, 0.75 kWh, 24.5 kg (Toyota)
      ev([motor("pmsm", "front", 53, 163, 17000, 8.48, 250)], pack("nmc", 56, 1, 3.6, 4.5, 40, 25), 24.5),
      // THS: ring share 78/108 = 0.72, ring → wheel 3.218 [S]; SoC window 40–80 % [S, hybrid.md §3.6]
      { topology: "power-split", evMaxKmh: 70, socMin: 0.4, socMax: 0.8, ringShare: 0.72, ringRatio: 3.218 },
      "cvt", 43, 180,
    ),
    factory: { kerbKg: 1375, kerbNorm: "DIN", t0to100S: 10.6, vmaxKmh: 180, vmaxGoverned: true, cw: 0.24, powerKw: 90, packKwh: 0.75, fuelL100: 4.4 },
    source: "Toyota Pressemappe Prius 2016 (Systemleistung 90 kW/122 PS, MG2 53 kW/163 Nm, 0–100 km/h 10,6 s, 180 km/h, 1375 kg, cW 0,24, Li-Ion 207,2 V, 43 l); WLTP 4,4 l/100 km (ADAC-Autokatalog)",
  },
  {
    id: "hy-toyota-prius-5-phev", name: "Toyota Prius 2.0 Plug-in Hybrid (5. Gen.)", maker: "Toyota", years: "seit 2023", engineId: "lib-toyota-m20a-fxs",
    setup: setup(
      // kerb 1570 kg (EU incl. driver, Toyota); cW 0.27 [S]; A ≈ 2.25 m² [S]; wheelbase 2.750 m
      body(1570, 0.27, 2.25, "fwd", 0.6, 0.52, 2.75),
      tyre("standard", 195, 50, 19, "H"),
      // MG2 120 kW / 208 Nm (Toyota) [S: ratio], Li-ion 13.6 kWh, 351.5 V (95 s), 140 kg [S]
      ev([motor("pmsm", "front", 120, 208, 17000, 10.5, 450)], pack("nmc", 95, 1, 38.6, 1.0, 4.5, 1.2), 140, 0.08),
      { topology: "power-split", evMaxKmh: 135, socMin: 0.12, socMax: 0.95, plugIn: true, ringShare: 0.72, ringRatio: 3.3 },
      "cvt", 40, 177,
    ),
    factory: { kerbKg: 1570, kerbNorm: "EU", t0to100S: 6.8, vmaxKmh: 177, vmaxGoverned: true, cw: 0.27, powerKw: 164, packKwh: 13.6, fuelL100: 0.5 },
    source: "Toyota Pressemappe Prius Plug-in Hybrid 2023 (Systemleistung 164 kW/223 PS, 0–100 km/h 6,8 s, 177 km/h, 1570 kg, 13,6 kWh, 351,5 V, elektrisch bis 135 km/h, 40 l)",
  },
  {
    id: "hy-toyota-yaris-hybrid", name: "Toyota Yaris 1.5 Hybrid", maker: "Toyota", years: "seit 2020", engineId: "lib-toyota-m15a-fxe",
    setup: setup(
      // kerb 1105 kg (DIN, Toyota); cW 0.29, A ≈ 2.10 m² [S]; wheelbase 2.560 m
      body(1105 + DRIVER_KG, 0.29, 2.1, "fwd", 0.62, 0.52, 2.56),
      tyre("standard", 185, 65, 15, "H"),
      // MG2 59 kW / 141 Nm (Toyota) [S: ratio]; Li-ion 177.6 V (48 s), 0.76 kWh, 25 kg [S]
      ev([motor("pmsm", "front", 59, 141, 17000, 10, 280)], pack("nmc", 48, 1, 4.3, 4.5, 40, 25), 25),
      { topology: "power-split", evMaxKmh: 60, socMin: 0.4, socMax: 0.8, ringShare: 0.72, ringRatio: 3.6 },
      "cvt", 36, 175,
    ),
    factory: { kerbKg: 1105, kerbNorm: "DIN", t0to100S: 9.7, vmaxKmh: 175, vmaxGoverned: true, cw: 0.29, powerKw: 85, packKwh: 0.76, fuelL100: 3.8 },
    source: "Toyota Pressemappe Yaris 2020 (Systemleistung 85 kW/116 PS, MG2 59 kW/141 Nm, 0–100 km/h 9,7 s, 175 km/h, 1105 kg, Li-Ion 177,6 V, 36 l); WLTP 3,8 l/100 km",
  },
  {
    id: "hy-bmw-330e-g20", name: "BMW 330e Limousine (G20)", maker: "BMW", years: "seit 2019", engineId: "lib-bmw-b48b20-330e",
    setup: setup(
      // kerb 1815 kg (DIN, BMW); cW 0.26, A ≈ 2.22 m² [S]; wheelbase 2.851 m
      body(1815 + DRIVER_KG, 0.26, 2.22, "rwd", 0.48, 0.52, 2.851),
      tyre("standard", 225, 45, 18, "Y"),
      // P2 motor in the 8HP: 80 kW (XtraBoost) / 265 Nm, 7 000 1/min (BMW) [S: speed]; 12 kWh, 352 V (96 s), 135 kg [S]
      ev([motor("pmsm", "rear", 80, 265, 7000, 14, 400)], pack("nmc", 96, 1, 34, 1.4, 7, 1.0), 135),
      // ZF 8HP ratios and final drive [S]
      { topology: "p2", evMaxKmh: 140, socMin: 0.12, socMax: 0.95, plugIn: true, ratios: [5.0, 3.2, 2.143, 1.72, 1.314, 1.0, 0.822, 0.64], finalDrive: 2.81 },
      "automatic", 40, 230,
    ),
    factory: { kerbKg: 1815, kerbNorm: "DIN", t0to100S: 5.9, vmaxKmh: 230, vmaxGoverned: false, cw: 0.26, powerKw: 215, packKwh: 12, fuelL100: 1.7 },
    source: "BMW Pressemappe 330e Limousine (G20, 2019): Systemleistung 215 kW/292 PS mit XtraBoost, 420 Nm, E-Motor 80 kW/265 Nm, 0–100 km/h 5,9 s, 230 km/h, elektrisch 140 km/h, 1815 kg, 12 kWh, 40 l",
  },
  {
    id: "hy-vw-golf-8-gte", name: "VW Golf GTE (8)", maker: "VW", years: "seit 2020", engineId: "lib-vw-ea211-14tsi-gte",
    setup: setup(
      // kerb 1624 kg (DIN, VW); cW 0.28, A ≈ 2.20 m² [S]; wheelbase 2.631 m
      body(1624 + DRIVER_KG, 0.28, 2.2, "fwd", 0.6, 0.54, 2.631),
      tyre("standard", 225, 40, 18, "Y"),
      // P2 motor in the DQ400E: 85 kW / 330 Nm (VW) [S: speed]; 13 kWh, 352 V (96 s), 120 kg [S]
      ev([motor("pmsm", "front", 85, 330, 7000, 16.5, 450)], pack("nmc", 96, 1, 37, 1.4, 6.5, 1.0), 120),
      // DQ400E (6-speed DSG) ratios and final drive [S]
      { topology: "p2", evMaxKmh: 130, socMin: 0.12, socMax: 0.95, plugIn: true, ratios: [3.46, 2.05, 1.3, 0.92, 0.76, 0.62], finalDrive: 4.77 },
      "dsg", 40, 225,
    ),
    factory: { kerbKg: 1624, kerbNorm: "DIN", t0to100S: 6.7, vmaxKmh: 225, vmaxGoverned: true, cw: 0.28, powerKw: 180, packKwh: 13, fuelL100: 1.5 },
    source: "VW Pressemappe Golf GTE 2020: Systemleistung 180 kW/245 PS, 400 Nm, E-Motor 85 kW/330 Nm, 0–100 km/h 6,7 s, 225 km/h, elektrisch 130 km/h, 1624 kg, 13 kWh, 40 l",
  },
  {
    id: "hy-porsche-918-spyder", name: "Porsche 918 Spyder", maker: "Porsche", years: "2013–2015", engineId: "lib-porsche-918-v8",
    setup: setup(
      // kerb 1674 kg (DIN, Porsche); cW 0.33 (Hochabtrieb) [S]; A ≈ 1.95 m² [S]; wheelbase 2.730 m; low CG [S]
      body(1674 + DRIVER_KG, 0.35, 2.0, "awd", 0.43, 0.42, 2.73),
      tyre("uhp", 325, 30, 21, "(Y)"),
      // rear P2 motor 115 kW, front axle motor 95 kW (Porsche) [S: torques, speeds, ratios]; 6.8 kWh, ≈ 540 V, 135 kg [S]
      ev([motor("pmsm", "rear", 115, 210, 9500, 13, 500), motor("pmsm", "front", 95, 210, 16000, 6.3, 450)], pack("nmc", 146, 1, 13, 1.0, 34, 12), 135, 0.08),
      // 7-speed PDK ratios and final drive [S]
      { topology: "p2", evMaxKmh: 150, socMin: 0.15, socMax: 0.95, plugIn: true, ratios: [3.91, 2.4, 1.77, 1.39, 1.14, 0.98, 0.89], finalDrive: 3.8 },
      "dsg", 70, null,
    ),
    factory: { kerbKg: 1674, kerbNorm: "DIN", t0to100S: 2.6, vmaxKmh: 345, vmaxGoverned: false, powerKw: 652, packKwh: 6.8 },
    source: "Porsche Pressemappe 918 Spyder (2013): Systemleistung 652 kW/887 PS, 1280 Nm, V8 447 kW, E-Motor hinten 115 kW, vorn 95 kW, 0–100 km/h 2,6 s, 345 km/h, elektrisch 150 km/h, 1674 kg, 6,8 kWh, 70 l",
  },
  {
    id: "hy-ferrari-sf90", name: "Ferrari SF90 Stradale", maker: "Ferrari", years: "seit 2019", engineId: "lib-ferrari-f154fa",
    setup: setup(
      // dry 1570 kg (Ferrari) + fluids ≈ 100 kg [S] + driver; cW ≈ 0.33, A ≈ 1.95 m² [S]; wheelbase 2.650 m
      body(1670 + DRIVER_KG, 0.36, 2.0, "awd", 0.45, 0.42, 2.65),
      tyre("uhp", 315, 30, 20, "(Y)"),
      // MGU-K between engine and 8-speed DCT, two front motors (RAC-e), together 162 kW (Ferrari) [S: split]; 7.9 kWh [S]
      ev([motor("pmsm", "rear", 72, 210, 9000, 15, 500), motor("pmsm", "front", 45, 135, 25000, 9.5, 300), motor("pmsm", "front", 45, 135, 25000, 9.5, 300)], pack("nmc", 200, 1, 11, 1.0, 30, 12), 130, 0.08),
      // 8-speed DCT ratios and final drive [S]
      { topology: "p2", evMaxKmh: 135, socMin: 0.15, socMax: 0.95, plugIn: true, ratios: [3.2, 2.2, 1.68, 1.34, 1.1, 0.92, 0.77, 0.64], finalDrive: 4.7 },
      "dsg", 68, null,
    ),
    factory: { kerbKg: 1570, kerbNorm: "empty", t0to100S: 2.5, vmaxKmh: 340, vmaxGoverned: false, powerKw: 735, packKwh: 7.9 },
    source: "Ferrari Pressemappe SF90 Stradale (2019): Systemleistung 735 kW/1000 PS, V8 574 kW, drei E-Motoren 162 kW, 0–100 km/h 2,5 s, 0–200 km/h 6,7 s, 340 km/h, elektrisch 135 km/h, Trockengewicht 1570 kg, 7,9 kWh, 68 l",
  },
];
