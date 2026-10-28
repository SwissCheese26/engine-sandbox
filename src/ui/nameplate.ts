// Typenschild: engraved aluminium plate with the static figures from summarize().
// The only place in the UI where capitals are used, because that is real nameplate vocabulary.
import type { EngineConfig, EngineSummary } from "../core/index.ts";
import { fmt } from "./format.ts";
import { FALLBACK_LIMITS } from "./limits-fallback.ts";
import { layoutCode } from "./names.ts";
import { setText } from "./dom.ts";

export class Nameplate {
  readonly el: HTMLElement;
  private cells = new Map<string, HTMLElement>();
  private title: HTMLElement;
  private type: HTMLElement;

  constructor() {
    this.el = document.createElement("section");
    this.el.className = "nameplate";
    this.el.setAttribute("aria-label", "Typenschild");
    this.el.innerHTML = `
      <span class="screw screw--tl" aria-hidden="true"></span><span class="screw screw--tr" aria-hidden="true"></span>
      <span class="screw screw--bl" aria-hidden="true"></span><span class="screw screw--br" aria-hidden="true"></span>
      <p class="nameplate__maker">MOTOR-SANDBOX PRÜFZELLE</p>
      <p class="nameplate__title"></p>
      <p class="nameplate__type num"></p>
      <dl class="nameplate__grid"></dl>`;
    this.title = this.el.querySelector(".nameplate__title")!;
    this.type = this.el.querySelector(".nameplate__type")!;
    const grid = this.el.querySelector(".nameplate__grid")!;
    const rows: [string, string][] = [
      ["disp", "HUBRAUM"],
      ["bxs", "BOHRUNG × HUB"],
      ["cr", "VERDICHTUNG"],
      ["tq", "MAX. DREHMOMENT"],
      ["pw", "NENNLEISTUNG"],
      ["rpm", "DREHZAHLGRENZE"],
      ["cm", "KOLBENGESCHW."],
      ["mass", "MASSE TROCKEN"],
      ["rel", "ZUVERLÄSSIGKEIT"],
    ];
    for (const [id, label] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.className = "num";
      dd.dataset.cell = id;
      grid.append(dt, dd);
      this.cells.set(id, dd);
    }
  }

  update(cfg: EngineConfig, s: EngineSummary) {
    const set = (id: string, v: string, limit = false) => {
      const c = this.cells.get(id)!;
      setText(c, v);
      c.classList.toggle("is-limit", limit);
    };
    setText(this.title, cfg.name.toUpperCase());
    const fuel = cfg.fuel === "diesel" ? "DIESEL" : "OTTO";
    const asp = cfg.induction.aspiration === "naturally-aspirated" ? "SAUGER" : cfg.induction.aspiration.startsWith("super") ? "KOMPRESSOR" : "TURBO";
    setText(this.type, `TYP ${layoutCode(cfg).toUpperCase()} ${fmt(s.displacementL, 1)} ${fuel} ${asp}`);
    set("disp", `${fmt(s.displacementL * 1000)} cm³`);
    set("bxs", `${fmt(cfg.block.boreMm, 1)} × ${fmt(cfg.block.strokeMm, 1)} mm`);
    set("cr", `${fmt(cfg.block.compressionRatio, 1)} : 1`);
    set("tq", `${fmt(s.peakTorqueNm)} Nm / ${fmt(s.peakTorqueRpm)}`);
    set("pw", `${fmt(s.peakPowerKw)} kW / ${fmt(s.peakPowerRpm)}`);
    const overRev = cfg.revLimitRpm > s.safeMaxRpm;
    set("rpm", `${fmt(Math.min(cfg.revLimitRpm, s.safeMaxRpm))} 1/min`, overRev);
    set("cm", `${fmt(s.maxMeanPistonSpeedMs, 1)} m/s`, s.maxMeanPistonSpeedMs > FALLBACK_LIMITS.meanPistonSpeedMaxMs);
    set("mass", `${fmt(s.massKg)} kg`);
    set("rel", `${fmt(s.reliability * 100)} %`, s.reliability < FALLBACK_LIMITS.reliabilityMin);
  }
}
