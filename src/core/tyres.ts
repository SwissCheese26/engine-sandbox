/**
 * Tyres and traction (issue #22). Pure TypeScript, no DOM.
 *
 * - Tyre types with peak friction coefficient μ per surface, rolling resistance and temperature window.
 * - Tyre size (ETRTO "225/45 R17") → static and dynamic rolling radius.
 * - Speed index (ECE-R 30 / ETRTO) → rated speed.
 * Axle loads with load transfer: vehicle.ts drivenAxleLoadN.
 *
 * API for issue #23 (Umwelt & Assistenten): `tyreGrip(type, surface, tempC)` gives μ for wet/snow/ice; the
 * Drivetrain feeds it as VehicleCoupling.grip each frame (Drivetrain.setSurface / setGripFactor). The simulator
 * reports wheel spin / slip / locked wheels in EngineState (wheelSpeedMs, wheelSlip, wheelSpin, wheelsLocked), so
 * ASR can trim the pedal (Drivetrain.effectivePedal) and ABS can modulate the brake input.
 *
 * μ values [S]: typical peak longitudinal friction of passenger-car tyres on dry asphalt ≈ 0.9–1.1, UHP ≈ 1.1,
 * semi-slick (R-compound) ≈ 1.2–1.3, racing slicks warm ≈ 1.4–1.6; wet asphalt ≈ 0.5–0.8, packed snow ≈ 0.2
 * (summer) / 0.4 (winter), ice ≈ 0.05–0.15 (Bosch Kraftfahrtechnisches Taschenbuch, "Kraftschlussbeiwerte";
 * Pacejka, Tire and Vehicle Dynamics, ch. 1). Sliding friction ≈ 0.9 × peak (locked wheel / burnout).
 */

export type TyreType = "standard" | "winter" | "uhp" | "semi-slick" | "slick" | "offroad" | "motorcycle";
export type RoadSurface = "dry" | "wet" | "snow" | "ice" | "gravel";

/** Speed index letters (ECE-R 30 Annex 6) → km/h. "(Y)": ZR tyre above 300 km/h, limit set by the car maker. */
export const SPEED_INDEX = {
  L: 120, M: 130, N: 140, P: 150, Q: 160, R: 170, S: 180, T: 190, U: 200, H: 210, V: 240, W: 270, Y: 300, "(Y)": 350,
} as const;
export type SpeedIndex = keyof typeof SPEED_INDEX;

export interface TyreTypeSpec {
  label: string;
  /** Peak μ per surface (warm tyre). */
  mu: Record<RoadSurface, number>;
  /** Rolling resistance coefficient f_R on asphalt. */
  rollingResistance: number;
  /** Grip factor of the cold tyre (20 °C) and the temperature from which it reaches full grip, °C. */
  coldFactor: number;
  warmC: number;
  hint: string;
}

/**
 * Tyre types [S] (see header). Rolling resistance: EU tyre label class B–C ≈ 0.008–0.010; soft compounds and
 * wide sport tyres higher, AT/MT tread blocks ≈ 0.015–0.02 (Bosch KTB, "Rollwiderstand"). The values include a
 * small share of wheel-bearing and brake drag, as the former fixed 0.012 did.
 */
export const TYRE_TYPES: Record<TyreType, TyreTypeSpec> = {
  standard: {
    label: "Standard (Sommer)", mu: { dry: 1.0, wet: 0.7, snow: 0.2, ice: 0.08, gravel: 0.6 },
    rollingResistance: 0.011, coldFactor: 1, warmC: 20, hint: "Alltagsreifen, μ ≈ 1,0.",
  },
  winter: {
    label: "Winter", mu: { dry: 0.9, wet: 0.65, snow: 0.4, ice: 0.15, gravel: 0.6 },
    rollingResistance: 0.012, coldFactor: 1, warmC: 20, hint: "Weiche Mischung, auf Schnee deutlich besser, μ ≈ 0,9 trocken.",
  },
  uhp: {
    // dry μ 1.15: sport summer tyres reach ≈ 1.1–1.2 g in braking tests (100–0 km/h in 33–35 m, e.g. ADAC/AutoBild
    // summer tyre tests of UHP sizes) [S] (review PR #37)
    label: "Sport (UHP)", mu: { dry: 1.15, wet: 0.75, snow: 0.15, ice: 0.07, gravel: 0.55 },
    rollingResistance: 0.012, coldFactor: 0.95, warmC: 30, hint: "Ultra-High-Performance, μ ≈ 1,15.",
  },
  "semi-slick": {
    label: "Semi-Slick", mu: { dry: 1.25, wet: 0.6, snow: 0.12, ice: 0.06, gravel: 0.5 },
    rollingResistance: 0.013, coldFactor: 0.85, warmC: 50, hint: "Straßenzugelassener Rennreifen, μ ≈ 1,25 warm.",
  },
  slick: {
    label: "Slicks", mu: { dry: 1.45, wet: 0.35, snow: 0.08, ice: 0.05, gravel: 0.45 },
    rollingResistance: 0.014, coldFactor: 0.7, warmC: 80, hint: "μ ≈ 1,45 nur warm (ab 80 °C), kalt deutlich weniger. Im Regen gefährlich.",
  },
  offroad: {
    label: "Offroad (AT)", mu: { dry: 0.8, wet: 0.6, snow: 0.3, ice: 0.1, gravel: 0.7 },
    rollingResistance: 0.016, coldFactor: 1, warmC: 20, hint: "All-Terrain, μ ≈ 0,8 auf Asphalt, mehr Rollwiderstand.",
  },
  // motorcycle sport tyre (issue #25 vehicles): soft compound, longitudinal μ ≈ 1.2–1.4 (sport bikes are wheelie-
  // limited rather than traction-limited when accelerating on dry asphalt; Cossalter ch. 2), f_R ≈ 0.015 [S].
  // 1.3 so that at the wheelie limit (≈ 1.17 g) the rear tyre works below its peak slip (review PR #37)
  motorcycle: {
    label: "Motorrad (Sport)", mu: { dry: 1.3, wet: 0.8, snow: 0.15, ice: 0.06, gravel: 0.5 },
    rollingResistance: 0.015, coldFactor: 1, warmC: 20, hint: "Motorrad-Sportreifen, μ ≈ 1,3 längs.",
  },
};

/** Sliding friction as share of the peak (locked wheel, spinning wheel) [S]. */
export const SLIDE_FACTOR = 0.9;
/** Longitudinal slip at the μ peak [S] (passenger-car tyres ≈ 0.08–0.15 on dry asphalt, sport tyres at the low end; Pacejka ch. 1). */
export const PEAK_SLIP = 0.08;

/**
 * Normalised force–slip curve (review PR #37), a simplified Magic-Formula shape: rises from 0 with slope 2/PEAK_SLIP,
 * reaches 1 (= μ) at PEAK_SLIP, then falls exponentially towards SLIDE_FACTOR at large slip (spinning or locked
 * wheel). Odd in the slip (braking = negative). F_x = μ·N·tyreForceFactor(s).
 */
export function tyreForceFactor(slip: number): number {
  const s = Math.abs(slip);
  let f: number;
  if (s <= PEAK_SLIP) {
    const x = s / PEAK_SLIP;
    f = (2 * x) / (1 + x * x);
  } else f = SLIDE_FACTOR + (1 - SLIDE_FACTOR) * Math.exp(-(s - PEAK_SLIP) / 0.25);
  return slip < 0 ? -f : f;
}

/** Tyre size in ETRTO notation: width mm / aspect ratio % R rim inch. */
export interface TyreSize {
  widthMm: number;
  aspectPct: number;
  rimInch: number;
}

/** One tyre fitted to the vehicle (both axles the same; staggered sizes use the driven axle). */
export interface TyreSetup {
  type: TyreType;
  size: TyreSize;
  speedIndex: SpeedIndex;
}

export const DEFAULT_TYRE: TyreSetup = { type: "standard", size: { widthMm: 225, aspectPct: 45, rimInch: 17 }, speedIndex: "W" };

/**
 * Static (unloaded) radius r = rim/2 + width·aspect, dynamic rolling radius ≈ 0.97 × r (ETRTO: rolling
 * circumference ≈ 3.05 × outer diameter, i.e. 0.97·π·D) [S].
 */
export function tyreRadii(size: TyreSize): { staticM: number; dynamicM: number } {
  const staticM = (size.rimInch * 25.4) / 2000 + (size.widthMm * size.aspectPct) / 100 / 1000;
  return { staticM, dynamicM: 0.97 * staticM };
}

export function formatTyreSize(s: TyreSize): string {
  return `${s.widthMm}/${s.aspectPct} R${s.rimInch}`;
}

/** Parses "225/45 R17" / "225/45R17" / "225/45 ZR17"; null if not valid. */
export function parseTyreSize(text: string): TyreSize | null {
  const m = /^\s*(\d{3})\s*\/\s*(\d{2})\s*Z?R\s*(\d{2})\s*$/i.exec(text);
  if (!m) return null;
  const size = { widthMm: Number(m[1]), aspectPct: Number(m[2]), rimInch: Number(m[3]) };
  if (size.widthMm < 115 || size.widthMm > 355 || size.aspectPct < 25 || size.aspectPct > 85 || size.rimInch < 12 || size.rimInch > 23) return null;
  return size;
}

export function speedRatingKmh(index: SpeedIndex): number {
  return SPEED_INDEX[index];
}

/** Tyre grip factor from temperature: cold factor at ≤ 20 °C rising linearly to 1 at warmC; slight fade > 120 °C [S]. */
export function tyreTempFactor(type: TyreType, tempC: number): number {
  const t = TYRE_TYPES[type];
  let f = 1;
  if (t.warmC > 20 && tempC < t.warmC) f = t.coldFactor + (1 - t.coldFactor) * Math.max(0, (tempC - 20) / (t.warmC - 20));
  if (tempC > 120) f *= Math.max(0.75, 1 - 0.004 * (tempC - 120));
  return f;
}

/**
 * Compound window over the outside temperature (issue #23) [S]: summer compounds harden below ≈ +7 °C (the
 * 7 °C rule of thumb for winter tyres; ADAC/Continental tyre guidance, summer tyres brake ≈ 10 % longer near 0 °C):
 * −0.6 %/K down to 0.88. Winter compounds get soft and smear on hot roads above ≈ 20 °C: −0.4 %/K down to 0.9
 * (ADAC: winter tyres in summer brake ≈ 10–15 % longer). Road surfaces snow/ice: no effect (already in μ).
 */
export function compoundFactor(type: TyreType, ambientC: number, surface: RoadSurface = "dry"): number {
  if (surface === "snow" || surface === "ice" || !Number.isFinite(ambientC)) return 1;
  if (SUMMER_COMPOUND[type] && ambientC < 7) return Math.max(0.88, 1 - 0.006 * (7 - ambientC));
  if (type === "winter" && ambientC > 20) return Math.max(0.9, 1 - 0.004 * (ambientC - 20));
  return 1;
}

const SUMMER_COMPOUND: Record<TyreType, boolean> = {
  standard: true, winter: false, uhp: true, "semi-slick": true, slick: true, offroad: false, motorcycle: true,
};

/**
 * Speed at which a tyre starts to aquaplane on a water film of a few mm (heavy rain), km/h [S]. Passenger-car tyres
 * with new tread aquaplane from ≈ 80–100 km/h in deep water (ADAC aquaplaning tests; Horne's hydroplaning speed
 * v ≈ 6.36·√p[kPa] ≈ 95 km/h at 2.3 bar is the upper bound for a smooth tyre in deep water, NASA TN D-2056).
 * Wide UHP tyres float earlier than narrow ones, slicks (no grooves) very early, the round motorcycle tyre late.
 */
export const AQUAPLANING_KMH: Record<TyreType, number> = {
  standard: 85, winter: 85, uhp: 78, "semi-slick": 65, slick: 45, offroad: 80, motorcycle: 100,
};

/**
 * Grip factor from the water film (issue #23): 1 below the aquaplaning speed, then the contact patch floats up and μ
 * falls as 1/(1 + (Δv/30)²) to a floor of 0.1 (rolling on water) [S, see AQUAPLANING_KMH]. widthMm: wider tyres
 * float earlier (≈ −0.15 km/h per mm above 205 mm).
 */
export function aquaplaningFactor(type: TyreType, speedKmh: number, widthMm = 205): number {
  const vOn = AQUAPLANING_KMH[type] - 0.15 * Math.max(0, widthMm - 205);
  const dv = Math.max(0, speedKmh - vOn);
  if (!(dv > 0)) return 1;
  const x = dv / 30;
  return Math.max(0.1, 1 / (1 + x * x));
}

/**
 * Peak friction coefficient μ of a tyre on a surface (issue #22). This is the hook for issue #23 (nässe, schnee,
 * eis). tempC: tread temperature (default warm).
 */
export function tyreGrip(type: TyreType, surface: RoadSurface = "dry", tempC = 90): number {
  return TYRE_TYPES[type].mu[surface] * tyreTempFactor(type, tempC);
}

/**
 * Simple tread temperature model [S] (lumped, first order): heating by transmitted force and by slip,
 * cooling towards ambient with speed-dependent convection. Tuned so that a road tyre stays near ambient + 10 K in
 * cruising, slicks reach ≈ 80 °C after a few hard runs or a 3–5 s burnout (racing practice: warm-up laps /
 * burnout before the start).
 *  dT/dt = |F|/(μ·m·g) · (2 + 0.15·v) + 4·v_slip − (T − T_amb) · (0.01 + 0.0006·v)
 */
export function stepTyreTemp(tempC: number, dt: number, forceRatio: number, speedMs: number, slipMs: number, ambientC = 20): number {
  const heat = Math.min(1.5, Math.abs(forceRatio)) * (2 + 0.15 * speedMs) + 4 * Math.min(30, Math.abs(slipMs));
  const cool = (tempC - ambientC) * (0.01 + 0.0006 * speedMs);
  return Math.min(160, Math.max(ambientC - 30, tempC + (heat - cool) * dt));
}

function clamp(x: number, lo: number, hi: number) {
  return x < lo ? lo : x > hi ? hi : x;
}
