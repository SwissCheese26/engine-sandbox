// Kompakt / Mobil (#26): four big values (rpm, speed, gear, power) and a thin rpm bar; the pedal stays in the deck
// below. Preparation for the touch overlay of #44 (no touch controls here).
import type { EngineConfig, EngineSummary } from "../../core/index.ts";
import { fmt } from "../format.ts";
import { prefs } from "../settings.ts";
import { toUnit } from "../units.ts";
import { limitZoneRpm, tachoMax } from "./logic.ts";
import type { DriveInfo, Frame, LayoutView } from "./view.ts";

export class CompactView implements LayoutView {
  readonly el: HTMLElement;
  private out: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private bar: HTMLElement;
  private rpmMax = 8000;
  private zone = 0;

  constructor() {
    const el = document.createElement("section");
    el.className = "kp";
    el.setAttribute("aria-label", "Kompaktanzeige");
    el.innerHTML = `
      <div class="kp__val kp__val--rpm"><span>Drehzahl</span><b class="num" data-kp="rpm">0</b><small>1/min</small></div>
      <div class="kp__bar" aria-hidden="true"><i></i></div>
      <div class="kp__val"><span>Tempo</span><b class="num" data-kp="speed">–</b><small data-kp="speed-unit">km/h</small></div>
      <div class="kp__val"><span>Gang</span><b class="num" data-kp="gear">–</b></div>
      <div class="kp__val"><span>Leistung</span><b class="num" data-kp="power">0</b><small data-kp="power-unit">kW</small></div>`;
    this.el = el;
    this.bar = el.querySelector(".kp__bar")!;
    el.querySelectorAll<HTMLElement>("[data-kp]").forEach((n) => (this.out[n.dataset.kp!] = n));
  }

  configure(cfg: EngineConfig, summary: EngineSummary, _info: DriveInfo) {
    this.rpmMax = tachoMax(cfg.revLimitRpm);
    this.zone = limitZoneRpm(cfg.revLimitRpm, summary.safeMaxRpm);
    this.bar.style.setProperty("--zone", `${(this.zone / this.rpmMax) * 100}%`);
    this.syncUnits();
  }

  syncUnits() {
    const u = prefs();
    this.out["speed-unit"]!.textContent = u.speed;
    this.out["power-unit"]!.textContent = u.power;
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
    const ds = f.drivetrain.state;
    const vehicle = f.mode === "vehicle";
    this.put("rpm", fmt(Math.round(s.rpm / 10) * 10));
    this.put("speed", vehicle ? fmt(toUnit("speed", ds.speedKmh)) : "–");
    this.put("gear", vehicle ? f.drivetrain.gearLabel() : "–");
    this.put("power", fmt(toUnit("power", Math.max(0, s.powerKw))));
    this.bar.style.setProperty("--rpm", `${Math.min(100, (s.rpm / this.rpmMax) * 100).toFixed(1)}%`);
    const limit = String(s.rpm >= this.zone);
    if (this.last.limit !== limit) {
      this.last.limit = limit;
      this.el.classList.toggle("is-limit", limit === "true");
    }
  }
}
