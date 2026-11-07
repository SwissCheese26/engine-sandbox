// Pure helpers of the sandbox views (#26): dial scales, shift point from the full-load curve, shift lights and the
// warning-lamp logic of the cockpit. No DOM, so everything here is unit-tested (tests/ui/layouts.test.ts).

/** Round-dial geometry: the needle sweeps SWEEP_DEG clockwise, starting at START_DEG (canvas angle, 0 = 3 o'clock). */
export const START_DEG = 135;
export const SWEEP_DEG = 270;

/** Full scale of the speedometer for a car that reaches `vmaxShown` (in the display unit). */
export function speedoMax(vmaxShown: number, unit: string): number {
  // real clusters leave head room: scale ≈ 1,2 × Vmax, never below 200 km/h (120 mph) for a car
  const steps = unit === "mph" ? [120, 140, 160, 180, 200, 220] : [200, 220, 240, 260, 280, 300, 320, 360, 400];
  const want = Number.isFinite(vmaxShown) ? vmaxShown * 1.2 : 0;
  return steps.find((s) => s >= want) ?? steps[steps.length - 1]!;
}

/** Labelled and minor tick spacing of the speedometer: 20/10 km/h, 20/10 mph (40/10 for very wide scales). */
export function speedoTicks(max: number, unit: string): { major: number; minor: number } {
  if (unit === "mph") return { major: 20, minor: 10 };
  return { major: max > 300 ? 40 : 20, minor: max > 300 ? 20 : 10 };
}

/** Full scale of the rev counter: the limiter plus at least 500 rpm head room, rounded up to 1000. */
export function tachoMax(revLimitRpm: number): number {
  return Math.max(4000, Math.ceil((revLimitRpm + 500) / 1000) * 1000);
}

/** Start of the limit zone on the rev counter: the lower of limiter and mechanically safe rpm, down to 250. */
export function limitZoneRpm(revLimitRpm: number, safeMaxRpm: number): number {
  const r = Math.min(revLimitRpm, Number.isFinite(safeMaxRpm) && safeMaxRpm > 0 ? safeMaxRpm : revLimitRpm);
  return Math.floor(r / 250) * 250;
}

/** Canvas angle (rad) of value v on a dial 0 … max; clamped to the scale. */
export function dialAngle(v: number, max: number, start = START_DEG, sweep = SWEEP_DEG): number {
  const f = max > 0 && Number.isFinite(v) ? Math.min(1, Math.max(0, v / max)) : 0;
  return ((start + f * sweep) * Math.PI) / 180;
}

export interface CurvePoint {
  rpm: number;
  torqueNm: number;
}

/** Linear interpolation of the full-load torque, held at the end values outside the measured range (0 without curve). */
export function torqueAt(curve: readonly CurvePoint[], rpm: number): number {
  if (curve.length === 0) return 0;
  if (rpm <= curve[0]!.rpm) return curve[0]!.torqueNm;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (rpm <= b.rpm) return a.torqueNm + ((b.torqueNm - a.torqueNm) * (rpm - a.rpm)) / Math.max(1e-9, b.rpm - a.rpm);
  }
  return curve[curve.length - 1]!.torqueNm;
}

/**
 * Optimal upshift rpm per gear from the full-load curve: tractive force F = T·i·i_A·η / r (Bosch Kraftfahrtechnisches
 * Taschenbuch, "Fahrwiderstände/Zugkraftdiagramm"; same relation as theoreticalVmax() in src/core/drivetrain.ts).
 * Shift from gear n to n+1 at the lowest rpm where the wheel force in gear n drops below the wheel force in n+1 at the
 * rpm after the shift (rpm · i_{n+1}/i_n). If gear n always pulls harder, shift at the limiter. Final drive, efficiency
 * and wheel radius are the same on both sides and cancel. Returns one value per gear (the last gear: limiter).
 */
export function shiftPoints(curve: readonly CurvePoint[], ratios: readonly number[], revLimitRpm: number, stepRpm = 25): number[] {
  const out: number[] = [];
  const lo = curve[0]?.rpm ?? 1000;
  for (let g = 0; g < ratios.length; g++) {
    const i1 = ratios[g]!;
    const i2 = ratios[g + 1];
    if (i2 === undefined) {
      out.push(revLimitRpm);
      continue;
    }
    let best = revLimitRpm;
    for (let rpm = lo; rpm <= revLimitRpm; rpm += stepRpm) {
      const after = (rpm * i2) / i1;
      if (after < lo) continue;
      if (torqueAt(curve, rpm) * i1 < torqueAt(curve, after) * i2) {
        best = rpm;
        break;
      }
    }
    out.push(Math.round(best / 50) * 50);
  }
  return out;
}

export type LedColor = "green" | "yellow" | "red" | "blue";

/** LED colours of a shift-light bar with `count` LEDs: green → yellow → red, all blue at the shift point. */
export function ledColors(count: number): LedColor[] {
  return Array.from({ length: count }, (_, i) => {
    const f = (i + 1) / count;
    return f <= 0.4 ? "green" : f <= 0.7 ? "yellow" : "red";
  });
}

/**
 * Shift lights: LEDs light up from `shiftRpm − window` to the shift point; at the shift point all LEDs flash blue.
 * window = 25 % of the shift rpm (typical for road-racing dashes). Returns the number of lit LEDs and the flash flag.
 */
export function shiftLights(rpm: number, shiftRpm: number, count: number): { lit: number; flash: boolean } {
  if (!(shiftRpm > 0) || !Number.isFinite(rpm)) return { lit: 0, flash: false };
  if (rpm >= shiftRpm) return { lit: count, flash: true };
  const from = shiftRpm * 0.75;
  const f = (rpm - from) / (shiftRpm - from);
  return { lit: f <= 0 ? 0 : Math.min(count, Math.ceil(f * count)), flash: false };
}

export type Lamp = "off" | "on" | "blink";

export interface LampInput {
  ignition: boolean;
  running: boolean;
  /** Seconds since the ignition was switched on (bulb check). */
  sinceIgnitionS: number;
  diesel: boolean;
  coolantC: number;
  coolantMaxC: number;
  oilPressureBar: number;
  /** Damage happened (MIL lights permanently) or engine destroyed. */
  damaged: boolean;
  /** Active warnings that turn on a lamp (codes from EngineState.warnings). */
  warnings: readonly string[];
  /** Chassis dyno only; undefined on the engine dyno. */
  abs?: { enabled: boolean; active: boolean };
  esp?: { esp: boolean; asr: boolean; active: boolean };
  ice?: boolean;
}

export interface LampSet {
  abs: Lamp;
  esp: Lamp;
  espOff: Lamp;
  ice: Lamp;
  oil: Lamp;
  battery: Lamp;
  engine: Lamp;
  coolant: Lamp;
  glow: Lamp;
}

/** Bulb check after ignition on, s (typical cluster: 2 … 4 s). */
export const BULB_CHECK_S = 2;
/** Oil-pressure switch: lamp below about 0,3 bar (typical switch 0,15 … 0,5 bar, Bosch Kraftfahrtechnisches Taschenbuch). */
export const OIL_SWITCH_BAR = 0.3;

/** Pre-glow time of a diesel, s: longer when cold (modern quick-glow systems: ~1 s warm, up to ~5 s at −20 °C). */
export function glowTimeS(coolantC: number): number {
  if (coolantC >= 60) return 0;
  return Math.min(5, Math.max(1, 2 - coolantC / 12));
}

/**
 * Warning lamps of the cluster, realistic rules:
 * - ignition on, engine off: battery (charge lamp, alternator not turning), oil pressure and MIL are lit;
 * - first BULB_CHECK_S after ignition on: every lamp lights (bulb check);
 * - ABS on when switched off, blinking while it regulates; ESP blinks while ASR/ESP intervene; ESP OFF when off;
 * - MIL on after damage, coolant lamp above the coolant limit, oil lamp below the switch pressure or on the warning;
 * - diesel: glow lamp during pre-glow.
 */
export function clusterLamps(x: LampInput): LampSet {
  const off: LampSet = { abs: "off", esp: "off", espOff: "off", ice: "off", oil: "off", battery: "off", engine: "off", coolant: "off", glow: "off" };
  if (!x.ignition) return off;
  if (x.sinceIgnitionS < BULB_CHECK_S && !x.running) {
    return { abs: "on", esp: "on", espOff: "off", ice: x.ice ? "on" : "off", oil: "on", battery: "on", engine: "on", coolant: "on", glow: x.diesel ? "on" : "off" };
  }
  const l = { ...off };
  l.battery = x.running ? "off" : "on";
  l.oil = !x.running || x.oilPressureBar < OIL_SWITCH_BAR || x.warnings.includes("low-oil-pressure") ? "on" : "off";
  l.engine = !x.running || x.damaged ? "on" : "off";
  l.coolant = x.coolantC > x.coolantMaxC || x.warnings.includes("overheat-coolant") ? "on" : "off";
  l.glow = x.diesel && !x.running && x.sinceIgnitionS < glowTimeS(x.coolantC) ? "on" : "off";
  if (x.abs) l.abs = !x.abs.enabled ? "on" : x.abs.active ? "blink" : "off";
  if (x.esp) {
    l.esp = (x.esp.esp || x.esp.asr) && x.esp.active ? "blink" : "off";
    l.espOff = !x.esp.esp || !x.esp.asr ? "on" : "off";
  }
  l.ice = x.ice ? "on" : "off";
  return l;
}

/** Average consumption in l/100 km, NaN below 0,1 km (not meaningful). */
export function avgL100(km: number, fuelL: number): number {
  return km >= 0.1 && fuelL >= 0 ? (fuelL / km) * 100 : Number.NaN;
}
