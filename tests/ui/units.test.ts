import { expect, test } from "bun:test";
import { UNITS } from "../../src/ui/units.ts";

test("unit conversions", () => {
  expect(UNITS.power[1]!.conv(100)).toBeCloseTo(135.96, 1); // kW → PS
  expect(UNITS.torque[1]!.conv(100)).toBeCloseTo(73.76, 1); // Nm → lb·ft
  expect(UNITS.temp[1]!.conv(100)).toBeCloseTo(212, 5); // °C → °F
  expect(UNITS.pressure(2)[1]!.conv(1)).toBeCloseTo(14.5, 1); // bar → psi
  const s = { vehicleSpeedMs: 100 / 3.6 } as never;
  expect(UNITS.fuelFlow[1]!.conv(6, s)).toBeCloseTo(6, 5); // 6 l/h at 100 km/h = 6 l/100 km
  expect(UNITS.fuelFlow[2]!.conv(5, s)).toBeCloseTo(20, 5); // 5 l/h at 100 km/h = 20 km/l
  expect(Number.isNaN(UNITS.fuelFlow[1]!.conv(1, { vehicleSpeedMs: 0 } as never))).toBe(true);
});
