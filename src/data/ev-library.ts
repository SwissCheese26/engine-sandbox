/**
 * Electric cars (issue #108): body, tyres, motors, inverter current, battery and reduction of real cars. Listed in
 * VEHICLE_LIBRARY (vehicle-library.ts) with `setup.ev`; no library engine (engineId ""). Sources per car in `source`,
 * the physics and the derivations in docs/research/electric.md §5. Values marked [S] are estimates (frontal area,
 * CG, per-motor torque, cell data): the published figures are the system power, the 0–100 time, Vmax, mass, pack
 * energy and voltage, motor type and ratio.
 *
 * Calibration rule (electric.md §5.1): the manufacturers' "Systemleistung" is the battery-limited shaft power at a
 * full pack. The cell count follows the nominal voltage and the pack energy; the discharge C-rate is set so the pack
 * delivers the system power at 90 % SoC (evSystemPowerKw), the per-motor torque from the launch force.
 *
 * Simulation mass = kerb weight incl. 75 kg driver (EU), as in vehicle-library.ts.
 */
import { withTyre } from "../core/index.ts";
import type { CarSetup, EvBatteryConfig, EvConfig, EvMotorConfig, TyreSetup, VehicleParams } from "../core/index.ts";
import type { LibraryCar } from "./vehicle-library.ts";

export const DRIVER_KG = 75;

export function body(m: number, cw: number, area: number, layout: VehicleParams["driveLayout"], front: number, cgH: number, wb: number): VehicleParams {
  return {
    massKg: m, dragCoefficient: cw, frontalAreaM2: area, rollingResistance: 0.011, wheelRadiusM: 0.33,
    driveLayout: layout, cgHeightM: cgH, cgToRearAxleM: front * wb, wheelbaseM: wb,
  };
}
export const tyre = (type: TyreSetup["type"], w: number, a: number, rim: number, idx: TyreSetup["speedIndex"]): TyreSetup => ({
  type, size: { widthMm: w, aspectPct: a, rimInch: rim }, speedIndex: idx,
});
export const motor = (kind: EvMotorConfig["kind"], axle: EvMotorConfig["axle"], peakPowerKw: number, peakTorqueNm: number, maxRpm: number, ratio: number, inverterA: number): EvMotorConfig => ({
  kind, axle, peakPowerKw, peakTorqueNm, maxRpm, ratio, inverterA,
});
export const pack = (chemistry: EvBatteryConfig["chemistry"], seriesCells: number, parallelCells: number, cellAh: number, cellResistanceMOhm: number, maxDischargeC: number, maxChargeC: number): EvBatteryConfig => ({
  chemistry, seriesCells, parallelCells, cellAh, cellResistanceMOhm, maxDischargeC, maxChargeC,
});

/** Tesla Model S/X (2021+): 18650 NCA pack, 407 V nominal (owner's manual) → 110 s; 100 kWh → 79 p × 3.1 Ah [S]. */
const TESLA_SX_PACK = (dischargeC: number, rMOhm: number) => pack("nca", 110, 79, 3.1, rMOhm, dischargeC, 1.6);
/** Plaid motors: carbon-sleeved PMSM, 7.56:1 (owner's manual), ≈ 260 kW / 450 Nm each, 20 000 1/min [S]. */
const PLAID_MOTORS = (): EvMotorConfig[] => [
  motor("pmsm", "front", 260, 450, 20000, 7.56, 900),
  motor("pmsm", "rear", 260, 450, 20000, 7.56, 900),
  motor("pmsm", "rear", 260, 450, 20000, 7.56, 900),
];

function ev(motors: EvMotorConfig[], battery: EvBatteryConfig, liftOffRegenG: number, ratedKwhPer100: number): EvConfig {
  return { motors, battery, gearEfficiency: 0.97, liftOffRegenG, ratedKwhPer100, auxKw: 0.4 };
}

/** Setup helper: the gearbox fields are required by CarSetup but ignored for electric cars. */
function setup(vehicle: VehicleParams, t: TyreSetup, e: EvConfig, speedLimitKmh: number | null): CarSetup {
  return { kind: "car", vehicle: withTyre(vehicle, t), tyre: t, gearbox: "dsg", gearboxSpec: { ratios: [1], finalDrive: e.motors[0]!.ratio, efficiency: e.gearEfficiency, shiftTimeS: 0 }, speedLimitKmh, ev: e };
}

export const EV_LIBRARY: LibraryCar[] = [
  {
    id: "ev-tesla-model-s-lr", name: "Tesla Model S Long Range", maker: "Tesla", years: "2021–2024", engineId: "",
    setup: setup(
      // kerb 2069 kg (Tesla EU data, without driver [S]); cW 0.208 (Tesla); A ≈ 2.34 m² [S]; wheelbase 2.960 m
      body(2069 + DRIVER_KG, 0.208, 2.34, "awd", 0.47, 0.46, 2.96),
      tyre("uhp", 245, 45, 19, "Y"),
      ev(
        // two PMSM, front 7.56:1, rear 9.04:1 (owner's manual); 252 kW each (343 PS, auto-data), 370 Nm [S]
        [motor("pmsm", "front", 252, 370, 18500, 7.56, 800), motor("pmsm", "rear", 252, 370, 18500, 9.04, 800)],
        TESLA_SX_PACK(5.6, 25),
        0.18, 17.4,
      ),
      250,
    ),
    factory: { kerbKg: 2069, kerbNorm: "DIN", t0to100S: 3.2, vmaxKmh: 250, vmaxGoverned: true, cw: 0.208, powerKw: 493, packKwh: 100, rollout: true },
    source: "auto-data.net Model S (2021) Long Range 670 PS AWD: 3,2 s, 250 km/h, 2069 kg, cW 0,208, 100 kWh; Tesla Owner's Manual Model S (Motoren PMSM, Übersetzung 7,56/9,04, 407 V)",
  },
  {
    id: "ev-tesla-model-s-plaid", name: "Tesla Model S Plaid", maker: "Tesla", years: "2021–2025", engineId: "",
    setup: setup(
      body(2265, 0.208, 2.34, "awd", 0.47, 0.46, 2.96),
      tyre("uhp", 245, 45, 19, "(Y)"),
      ev(PLAID_MOTORS(), TESLA_SX_PACK(8.6, 20), 0.18, 18.7),
      300,
    ),
    factory: { kerbKg: 2265, kerbNorm: "EU", t0to100S: 2.1, vmaxKmh: 300, vmaxGoverned: true, cw: 0.208, powerKw: 750, packKwh: 100, rollout: true },
    source: "ADAC-Autokatalog Tesla Model S Plaid (12/22–07/25): 750 kW (1020 PS), 2,1 s, 300 km/h, 2265 kg EU, 100 kWh, 245/45 R19; Tesla Owner's Manual (3 PMSM mit Karbonhülse, 7,56:1, 407 V)",
  },
  {
    id: "ev-tesla-model-x-plaid", name: "Tesla Model X Plaid", maker: "Tesla", years: "2021–2025", engineId: "",
    setup: setup(
      // cW 0.24 (Tesla); A ≈ 2.85 m² (1999 × 1684 mm) [S]; wheelbase 2.965 m; higher CG [S]
      body(2470, 0.24, 2.85, "awd", 0.48, 0.58, 2.965),
      tyre("uhp", 275, 45, 20, "Y"),
      ev(PLAID_MOTORS(), TESLA_SX_PACK(8.6, 20), 0.18, 19.3),
      262,
    ),
    factory: { kerbKg: 2470, kerbNorm: "EU", t0to100S: 2.6, vmaxKmh: 262, vmaxGoverned: true, cw: 0.24, powerKw: 750, packKwh: 100, rollout: true },
    source: "ADAC-Autokatalog Tesla Model X Plaid (10/25–04/26): 750 kW, 2,6 s, 262 km/h, 2470 kg EU, 100/95 kWh, 255/45 R20 + 275/45 R20; Tesla Owner's Manual Model X (7,56:1, 407 V)",
  },
  {
    id: "ev-tesla-model-y-performance", name: "Tesla Model Y Performance", maker: "Tesla", years: "2021–2025", engineId: "",
    setup: setup(
      // cW 0.23 (Tesla); A ≈ 2.53 m² [S]; wheelbase 2.890 m
      body(2072, 0.23, 2.53, "awd", 0.47, 0.53, 2.89),
      tyre("uhp", 275, 35, 21, "Y"),
      ev(
        // rear PMSM, front induction motor, 9:1 (owner's manual); 220 kW / 440 Nm rear, 160 kW / 250 Nm front [S]
        [motor("induction", "front", 160, 250, 17900, 9.0, 600), motor("pmsm", "rear", 220, 440, 17900, 9.0, 900)],
        // 2170 NMC cells, 345 V nominal (owner's manual) → 96 s; ≈ 82 kWh → 46 p × 5.0 Ah [S]
        pack("nmc", 96, 46, 5.0, 15, 4.2, 1.6),
        0.18, 17.3,
      ),
      250,
    ),
    factory: { kerbKg: 2072, kerbNorm: "EU", t0to100S: 3.7, vmaxKmh: 250, vmaxGoverned: true, cw: 0.23, powerKw: 338, packKwh: 79, rollout: true },
    source: "ADAC-Autokatalog Tesla Model Y Performance AWD (09/21–02/25): 338 kW, 660 Nm, 3,7 s, 250 km/h, 2072 kg EU, 79 kWh netto, 255/35 R21 + 275/35 R21; Tesla Owner's Manual Model Y (PMSM hinten, ASM vorn, 9:1, 345 V)",
  },
  {
    id: "ev-lucid-air-sapphire", name: "Lucid Air Sapphire", maker: "Lucid", years: "seit 2023", engineId: "",
    setup: setup(
      // curb 5336 lb = 2420 kg (US, without driver); cW ≈ 0.21 (Air 0.197, Sapphire with downforce) [S]; A ≈ 2.25 m² [S];
      // wheelbase 116.5 in = 2.959 m
      body(2420 + DRIVER_KG, 0.21, 2.25, "awd", 0.47, 0.46, 2.959),
      tyre("uhp", 295, 30, 21, "(Y)"),
      ev(
        // three PMSM: single front unit 7:1, twin rear unit 6.8:1 (Lucid spec sheet); ≈ 450 kW / 650 Nm each, 20 000 1/min [S]
        [motor("pmsm", "front", 450, 650, 20000, 7.0, 1000), motor("pmsm", "rear", 450, 650, 20000, 6.8, 1000), motor("pmsm", "rear", 450, 650, 20000, 6.8, 1000)],
        // 900 V class, 118 kWh, 2170 NMC: 246 s × 27 p × 4.8 Ah [S]
        pack("nmc", 246, 27, 4.8, 15, 8.6, 2),
        0.15, 17.2,
      ),
      330,
    ),
    factory: { kerbKg: 2420, kerbNorm: "DIN", t0to100S: 2.0, vmaxKmh: 330, vmaxGoverned: true, cw: 0.21, powerKw: 920, packKwh: 118, rollout: true },
    source: "Lucid Air Sapphire Technical Specs 2024 (1234 hp, 1430 lb-ft, 0–60 mph 1,89 s, 205 mph, 5336 lb, 118 kWh, 7:1 / 6,8:1, 265/35 R20 + 295/30 R21); 0–100 km/h 2,0 s laut ultimatespecs.com",
  },
  {
    id: "ev-vw-id3-pro-performance", name: "VW ID.3 Pro Performance", maker: "VW", years: "2020–2023", engineId: "",
    setup: setup(
      // cW 0.267 (VW); A ≈ 2.36 m² [S]; wheelbase 2.770 m; rear-wheel drive
      body(1805, 0.267, 2.36, "rwd", 0.44, 0.55, 2.77),
      tyre("standard", 215, 55, 18, "V"),
      ev(
        // APP 310 PMSM: 150 kW, 310 Nm, 16 000 1/min, single-speed 11.5:1 [VW Pressemappe ID.3, S for the ratio]
        [motor("pmsm", "rear", 150, 310, 16000, 11.5, 450)],
        // MEB 62 kWh: NMC pouch, 108 s × 2 p × 78 Ah [S]
        pack("nmc", 108, 2, 78, 1.2, 2.6, 1.5),
        0.13, 15.4,
      ),
      160,
    ),
    factory: { kerbKg: 1805, kerbNorm: "EU", t0to100S: 7.3, vmaxKmh: 160, vmaxGoverned: true, cw: 0.267, powerKw: 150, packKwh: 58 },
    source: "ADAC-Autokatalog VW ID.3 Pro Performance (09/20–05/21): 150 kW, 310 Nm, 7,3 s, 160 km/h, 1805 kg EU, 62/58 kWh, 215/55 R18",
  },
  {
    id: "ev-vw-id4-gtx", name: "VW ID.4 GTX", maker: "VW", years: "2021–2023", engineId: "",
    setup: setup(
      // cW ≈ 0.29 [S] (ID.4 0.28); A ≈ 2.56 m² [S]; wheelbase 2.769 m
      body(2239, 0.29, 2.56, "awd", 0.47, 0.6, 2.769),
      tyre("standard", 255, 45, 20, "V"),
      ev(
        // rear PMSM 150 kW / 310 Nm (APP 310), front induction motor 80 kW / 162 Nm (ADAC); ratios 11.5 / 10.6 [S]
        [motor("induction", "front", 80, 162, 15000, 10.6, 300), motor("pmsm", "rear", 150, 310, 16000, 11.5, 450)],
        // MEB 82 kWh: 96 s × 3 p × 78 Ah [S]
        pack("nmc", 96, 3, 78, 1.2, 2.65, 1.5),
        0.13, 17.6,
      ),
      180,
    ),
    factory: { kerbKg: 2239, kerbNorm: "EU", t0to100S: 6.3, vmaxKmh: 180, vmaxGoverned: true, powerKw: 220, packKwh: 77 },
    source: "ADAC-Autokatalog VW ID.4 GTX 4MOTION (07/21–10/23): 220 kW (hinten 150 kW/310 Nm PSM, vorn 80 kW/162 Nm ASM), 460 Nm, 6,3 s, 180 km/h, 2239 kg EU, 82/77 kWh, 235/50 R20 + 255/45 R20",
  },
];
