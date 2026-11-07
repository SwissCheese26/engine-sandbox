// Renn-Dash (#26): digital motorsport display. Shift-light LED bar (green → yellow → red, all blue flashing at the
// optimal shift point from the full-load curve), big gear number, rpm as a bar, speed, 0–100 time with delta to the
// best run of this session, oil and water temperature tiles that turn signal yellow at their limits.
import type { EngineConfig, EngineSummary } from "../../core/index.ts";
import { reducedMotion } from "../canvas.ts";
import { fmt } from "../format.ts";
import { prefs } from "../settings.ts";
import { fmtQ, toUnit } from "../units.ts";
import { ledColors, limitZoneRpm, shiftLights, tachoMax } from "./logic.ts";
import type { DriveInfo, Frame, LayoutView } from "./view.ts";

const LEDS = 12;
/** Flash rate of the blue shift light, Hz (typical motorsport dashes: 5 … 10 Hz). */
const FLASH_HZ = 8;
const SHIFT_HYST_RPM = 150;

export class RaceView implements LayoutView {
  readonly el: HTMLElement;
  private leds: HTMLElement[] = [];
  private out: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private bar: HTMLElement;
  private cfg!: EngineConfig;
  private summary!: EngineSummary;
  private info!: DriveInfo;
  private rpmMax = 8000;
  private best: number | null = null;
  private lastRun: number | null = null;
  private litKey = "";
  /** Shift flash held until the rpm drops this far below the shift point (no flicker at the threshold). */
  private flashing = false;
  /** Gear the "Schalten" hint was announced in; announced once per gear (#26 review). */
  private announcedGear = -1;

  constructor() {
    const el = document.createElement("section");
    el.className = "rd";
    el.setAttribute("aria-label", "Renn-Display");
    el.innerHTML = `
      <div class="rd__leds" aria-hidden="true">${ledColors(LEDS).map((c) => `<span class="rd-led" data-color="${c}"></span>`).join("")}</div>
      <p class="sr-only" data-rd="shift" role="status"></p>
      <div class="rd__grid">
        <div class="rd__cell rd__cell--speed"><span class="rd__lab" data-rd="speed-unit">km/h</span><b class="num rd__big" data-rd="speed">–</b></div>
        <div class="rd__gear num"><span class="sr-only">Gang </span><b data-rd="gear">N</b></div>
        <div class="rd__cell rd__cell--rpm"><span class="rd__lab">1/min</span><b class="num rd__big" data-rd="rpm">0</b></div>
      </div>
      <div class="rd__bar" aria-hidden="true"><i class="rd__fill"></i><i class="rd__zone"></i><i class="rd__mark"></i></div>
      <div class="rd__row">
        <div class="rd__cell"><span class="rd__lab" data-rd="sprint-label">0–100 km/h</span><b class="num" data-rd="sprint">–</b></div>
        <div class="rd__cell"><span class="rd__lab">Delta</span><b class="num" data-rd="delta">–</b></div>
        <div class="rd__cell"><span class="rd__lab">Leistung</span><b class="num" data-rd="power">–</b></div>
        <div class="rd__cell rd__cell--warn" data-rd="oil-tile"><span class="rd__lab">Öl</span><b class="num" data-rd="oil">–</b></div>
        <div class="rd__cell rd__cell--warn" data-rd="water-tile"><span class="rd__lab" data-rd="water-label">Wasser</span><b class="num" data-rd="water">–</b></div>
      </div>`;
    this.el = el;
    this.leds = [...el.querySelectorAll<HTMLElement>(".rd-led")];
    this.bar = el.querySelector(".rd__bar")!;
    el.querySelectorAll<HTMLElement>("[data-rd]").forEach((n) => (this.out[n.dataset.rd!] = n));
  }

  configure(cfg: EngineConfig, summary: EngineSummary, info: DriveInfo) {
    this.cfg = cfg;
    this.summary = summary;
    this.info = info;
    this.rpmMax = tachoMax(cfg.revLimitRpm);
    const zone = limitZoneRpm(cfg.revLimitRpm, summary.safeMaxRpm);
    this.bar.style.setProperty("--zone", `${(zone / this.rpmMax) * 100}%`);
    this.best = this.lastRun = null;
    const air = cfg.cooling.type === "air" || cfg.cooling.type === "oil-air";
    this.out["water-label"]!.textContent = air ? "Kopf" : "Wasser";
    this.syncUnits();
  }

  syncUnits() {
    const u = prefs();
    this.out["speed-unit"]!.textContent = u.speed;
    // the stopwatch measures 0–100 km/h; in mph that is 0–62 mph
    this.out["sprint-label"]!.textContent = u.speed === "mph" ? "0–62 mph" : "0–100 km/h";
    for (const k of Object.keys(this.last)) this.last[k] = "";
  }

  redraw() {}

  private put(k: string, v: string) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.out[k]!.textContent = v;
  }

  update(f: Frame) {
    const { s } = f;
    const u = prefs();
    const d = f.drivetrain;
    const ds = d.state;
    const vehicle = f.mode === "vehicle";
    this.put("speed", vehicle ? fmt(toUnit("speed", ds.speedKmh, u.speed)) : "–");
    this.put("rpm", fmt(Math.round(s.rpm / 10) * 10));
    this.put("gear", vehicle ? (ds.shifting && ds.type === "manual" ? "–" : d.gearLabel().replace(/^[DM](?=\d)/, "")) : "–");
    this.put("power", fmtQ("power", Math.max(0, s.powerKw)));

    // shift lights: on the chassis dyno at the gear's optimal shift point, on the engine dyno at peak power
    const shiftRpm = vehicle && ds.gear > 0 && ds.type !== "cvt" && ds.gear < ds.gearCount ? this.info.shiftRpm(ds.gear) : vehicle ? this.cfg.revLimitRpm : this.summary.peakPowerRpm;
    const sl = shiftLights(s.running ? s.rpm : 0, shiftRpm, LEDS);
    const lit = sl.lit;
    // hysteresis: once flashing, keep flashing until 150 rpm below the shift point
    this.flashing = sl.flash || (this.flashing && s.running && s.rpm > shiftRpm - SHIFT_HYST_RPM);
    const flash = this.flashing;
    const on = flash ? reducedMotion() || Math.floor(s.t * FLASH_HZ * 2) % 2 === 0 : true;
    const key = `${lit}|${flash}|${on}`;
    if (key !== this.litKey) {
      this.litKey = key;
      this.leds.forEach((l, i) => {
        l.dataset.on = String(flash ? on : i < lit);
        l.classList.toggle("is-shift", flash);
      });
    }
    // screen readers hear "Schalten" once per gear, not with every flash
    const gear = vehicle ? ds.gear : 0;
    if (flash && gear !== this.announcedGear) {
      this.announcedGear = gear;
      this.put("shift", vehicle ? `Schalten, ${fmt(shiftRpm)} 1/min` : "Spitzenleistung erreicht");
    } else if (!flash && gear !== this.announcedGear && this.last.shift) {
      this.put("shift", "");
    }
    if (!flash && gear !== this.announcedGear) this.announcedGear = -1;
    this.bar.style.setProperty("--rpm", `${Math.min(100, (s.rpm / this.rpmMax) * 100).toFixed(1)}%`);
    this.bar.style.setProperty("--mark", `${((shiftRpm / this.rpmMax) * 100).toFixed(1)}%`);

    // 0–100 with delta to the best run of this session
    const run = ds.t0to100Running;
    const done = ds.t0to100S;
    if (run === null && done !== null && done !== this.lastRun) {
      this.lastRun = done;
      const prev = this.best;
      this.best = prev === null ? done : Math.min(prev, done);
      const diff = prev === null ? 0 : done - prev;
      // a tie (rounded to 1/100 s) reads ±0,00
      this.put("delta", Math.abs(diff) < 0.005 ? "±0,00" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff), 2)}`);
    }
    this.put("sprint", run !== null ? fmt(run, 1) : done !== null ? fmt(done, 2) : "–");

    const L = this.summary.limits;
    const warn = (codes: string[]) => s.warnings.some((w) => codes.includes(w.code));
    const oilWarn = warn(["overheat-oil", "low-oil-pressure"]) || s.oilC > L.oilMaxC;
    const waterWarn = warn(["overheat-coolant"]) || s.coolantC > L.coolantMaxC;
    this.put("oil", `${fmt(toUnit("temp", s.oilC, u.temp))} ${u.temp}`);
    this.put("water", `${fmt(toUnit("temp", s.coolantC, u.temp))} ${u.temp}`);
    this.flag("oil-tile", oilWarn);
    this.flag("water-tile", waterWarn);
  }

  private flag(k: string, on: boolean) {
    const v = String(on);
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.out[k]!.classList.toggle("is-limit", on);
  }
}
