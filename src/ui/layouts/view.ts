// Shared contract of the sandbox views (#26). The app runs one simulation and hands every frame the same data to the
// active view; views only display. DriveInfo caches what several views derive from the configuration (full-load
// curve, shift points, top speed), so nothing is computed twice.
import { dynoSweep, theoreticalVmax } from "../../core/index.ts";
import type { Drivetrain, EngineConfig, EngineState, EngineSummary, GearboxSpec, SimInputs } from "../../core/index.ts";
import type { TripComputerData } from "../../core/index.ts";
import { shiftPoints, torqueAt, type CurvePoint } from "./logic.ts";

export interface Frame {
  s: EngineState;
  dt: number;
  mode: SimInputs["dynoMode"];
  ignition: boolean;
  /** Seconds since the ignition was switched on (0 while off). */
  sinceIgnitionS: number;
  pedal: number;
  braking: boolean;
  drivetrain: Drivetrain;
  trip: Readonly<TripComputerData>;
}

export interface LayoutView {
  readonly el: HTMLElement;
  configure(cfg: EngineConfig, summary: EngineSummary, info: DriveInfo): void;
  update(f: Frame): void;
  /** Global units changed (#24). */
  syncUnits(): void;
  /** Canvas size may have changed (resize, view shown). */
  redraw(): void;
}

/** Full-load curve of the configured engine and what follows from it with the current gearbox. */
export class DriveInfo {
  private curve: CurvePoint[] = [];
  private key: { spec: GearboxSpec | null; fd: number; mass: number } = { spec: null, fd: 0, mass: 0 };
  private points: number[] = [];
  private vmax = 0;

  constructor(
    private cfg: EngineConfig,
    private drivetrain: Drivetrain,
  ) {
    this.setEngine(cfg);
  }

  setEngine(cfg: EngineConfig) {
    this.cfg = cfg;
    try {
      this.curve = dynoSweep(cfg, { stepRpm: 100 }).map((p) => ({ rpm: p.rpm, torqueNm: p.torqueNm }));
    } catch {
      this.curve = [];
    }
    this.key.spec = null;
  }

  /** Recomputed only when the gearbox, final drive or vehicle changed. */
  private refresh() {
    const d = this.drivetrain;
    const spec = d.gearbox;
    const fd = d.state.finalDrive;
    const mass = d.vehicle.massKg;
    if (this.key.spec === spec && this.key.fd === fd && this.key.mass === mass) return;
    this.key = { spec, fd, mass };
    this.points = d.state.type === "cvt" ? [] : shiftPoints(this.curve, spec.ratios, this.cfg.revLimitRpm);
    try {
      this.vmax = theoreticalVmax((rpm) => torqueAt(this.curve, rpm), this.cfg.revLimitRpm, d.state.type, fd, d.vehicle, spec).vmaxKmh;
    } catch {
      this.vmax = 250;
    }
  }

  /** Optimal upshift rpm in this gear (limiter for the top gear, CVT and neutral). */
  shiftRpm(gear: number): number {
    this.refresh();
    return this.points[gear - 1] ?? this.cfg.revLimitRpm;
  }

  /** Theoretical top speed without governor, km/h. */
  get vmaxKmh(): number {
    this.refresh();
    const lim = this.drivetrain.state.speedLimitKmh;
    return lim !== null ? Math.min(this.vmax, lim) : this.vmax;
  }

  get fullLoad(): readonly CurvePoint[] {
    return this.curve;
  }
}
