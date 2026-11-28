// Elektroantrieb im Rollenprüfstand (#108, review of #115): drive mode, live readouts and charging. The readouts are
// rows of the Getriebe-Pult's readout list (same look as Tempo, Vmax, Tankinhalt); "Laden auf" takes the place of
// "Volltanken". Tuning lives on the Werkbank (ev-bench.ts).
import { DRIVE_MODES, DRIVE_MODE_IDS, HYBRID_MODES, hybridModes } from "../core/index.ts";
import type { EngineState, EvDriveMode, HybridConfig, HybridMode } from "../core/index.ts";
import { fmt } from "./format.ts";
import { prefs } from "./settings.ts";
import { toUnit } from "./units.ts";
import { consumptionLine, driveConsumption, rangeText, socText } from "./layouts/ev-logic.ts";

const LIVE_LIMIT: Record<string, string> = {
  none: "–", torque: "Motormoment", power: "Motorleistung", battery: "Akku", thermal: "Temperatur", traction: "Haftung", speed: "Motordrehzahl",
};

export class EvStatus {
  /** Drive mode selector (Getriebe-Pult, in place of the shift buttons). */
  readonly modeEl: HTMLElement;
  /** Readout rows for the Getriebe-Pult's list. */
  readonly rows: HTMLElement[];
  private out: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private chargeBtns: HTMLButtonElement[] = [];
  private shown = false;
  mode: EvDriveMode | HybridMode = "sport";
  /** Set by the app: drive mode (EV) or operating mode (hybrid, #157) changed. */
  onMode: (m: EvDriveMode | HybridMode) => void = () => {};
  private chargeRow!: HTMLElement;
  private hyRows: HTMLElement[] = [];
  private hybrid: Readonly<HybridConfig> | null = null;
  /** Set by the app: charge the battery to this state of charge. */
  onCharge: (soc: number) => void = () => {};

  constructor() {
    const m = document.createElement("div");
    m.className = "evmode";
    m.hidden = true;
    m.innerHTML = `<span class="evmode__label" id="evmode-l">Fahrmodus</span>
      <div class="evmode__opts" role="radiogroup" aria-labelledby="evmode-l"></div>`;
    this.modeEl = m;
    this.renderModes(DRIVE_MODE_IDS.map((id) => [id, DRIVE_MODES[id]]));
    const row = (label: string, key: string, extra = "") => {
      const d = document.createElement("div");
      d.className = "gearbox__ev";
      d.hidden = true;
      d.innerHTML = `<dt>${label}</dt><dd class="num"><span data-o="${key}">–</span>${extra}</dd>`;
      return d;
    };
    const charge = document.createElement("div");
    charge.className = "gearbox__ev gearbox__charge";
    charge.hidden = true;
    charge.innerHTML = `<dt>Laden auf</dt><dd>${[[0.9, "90 %"], [1, "100 %"], [0.1, "10 %"]].map(([soc, l]) => `<button type="button" class="btn btn--small" data-control="charge-${Math.round(Number(soc) * 100)}" data-soc="${soc}"${soc === 0.1 ? ' title="Zum Testen: Akku fast leer"' : ""}>${l}</button>`).join("")}</dd>`;
    this.chargeBtns = [...charge.querySelectorAll<HTMLButtonElement>("button")];
    this.chargeRow = charge;
    for (const b of this.chargeBtns) b.addEventListener("click", () => this.onCharge(Number(b.dataset.soc)));
    this.rows = [
      row("Ladezustand", "soc"),
      charge,
      row("Reichweite", "range"),
      row("Akkuleistung", "power"),
      row("Rekuperiert", "regen"),
      row("Ø Verbrauch", "cons"),
      row("Akku", "pack"),
      row("Akkutemperatur", "batt"),
      row("E-Motor", "motor"),
      row("Begrenzt durch", "limit"),
    ];
    // hybrid (#157): engine and fuel next to the battery rows
    this.hyRows = [row("Verbrenner", "engine"), row("Kraftstoff", "fuel"), row("Energiefluss", "flow")];
    this.rows.splice(1, 0, ...this.hyRows);
    for (const r of this.rows) r.querySelectorAll<HTMLElement>("[data-o]").forEach((n) => (this.out[n.dataset.o!] = n));
    this.setMode("sport", false);
  }

  /** Electric car loaded or not: shows or hides the rows. */
  setShown(on: boolean) {
    this.shown = on;
    this.modeEl.hidden = !on;
    for (const r of this.rows) r.hidden = !on;
    this.syncHybridRows();
  }

  private renderModes(list: [string, { label: string; hint: string }][]) {
    const box = this.modeEl.querySelector(".evmode__opts")!;
    box.innerHTML = list.map(([id, d]) => `<button type="button" class="btn btn--small" role="radio" aria-checked="false" data-mode="${id}" title="${d.hint}">${d.label}</button>`).join("");
    box.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.mode as EvDriveMode | HybridMode, true)));
  }

  /** Hybrid loaded (#157) or not: operating modes instead of the EV drive modes, engine rows, charging only for plug-ins. */
  setHybrid(hy: Readonly<HybridConfig> | null) {
    if (hy === this.hybrid) return;
    this.hybrid = hy;
    this.modeEl.querySelector(".evmode__label")!.textContent = hy ? "Betriebsart" : "Fahrmodus";
    this.renderModes(hy ? hybridModes(hy).map((id) => [id, HYBRID_MODES[id]]) : DRIVE_MODE_IDS.map((id) => [id, DRIVE_MODES[id]]));
    this.syncHybridRows();
  }

  private syncHybridRows() {
    for (const r of this.hyRows) r.hidden = !this.shown || !this.hybrid;
    this.chargeRow.hidden = !this.shown || (!!this.hybrid && !this.hybrid.plugIn);
  }

  setMode(m: EvDriveMode | HybridMode, notify: boolean) {
    this.mode = m;
    this.modeEl.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
    if (notify) this.onMode(m);
  }

  private put(k: string, v: string) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.out[k]!.textContent = v;
  }

  /** `tripL100`: trip average fuel of a hybrid, l/100 km (the trip computer, NaN while too short). */
  update(s: EngineState, speedKmh: number, tripL100 = Number.NaN) {
    const ev = s.ev;
    if (!ev || !this.shown) return;
    const u = prefs();
    const pw = (kw: number) => `${fmt(toUnit("power", kw, u.power))} ${u.power}`;
    this.put("soc", socText(ev.soc));
    this.put("range", rangeText(ev.rangeKm, u));
    this.put("power", ev.powerKw < -0.5 ? `−${pw(-ev.powerKw)}` : pw(Math.max(0, ev.powerKw)));
    this.put("regen", `${fmt(ev.regenKwh, 2)} kWh`);
    const hyCons = this.hybrid ? { tripL100, plugIn: !!this.hybrid.plugIn } : null;
    this.put("cons", consumptionLine(driveConsumption(ev, hyCons, u)));
    this.put("pack", `${fmt(ev.packV)} V · ${fmt(ev.packA)} A`);
    this.put("batt", `${fmt(toUnit("temp", ev.batteryC, u.temp))} ${u.temp}`);
    this.put("motor", `${fmt(toUnit("temp", ev.motorC, u.temp))} ${u.temp}`);
    this.put("limit", LIVE_LIMIT[ev.limitedBy] ?? "–");
    const hy = s.hybrid;
    if (hy && this.hybrid) {
      this.put("engine", hy.engineOn ? `${fmt(hy.engineRpm)} 1/min · ${pw(hy.engineKw)}` : hy.engineStarting ? "startet …" : "aus");
      this.put("fuel", `${fmt(hy.fuelLh, 1)} l/h`);
      this.put("flow", flowText(hy));
    }
    const moving = speedKmh > 0.5;
    for (const b of this.chargeBtns) b.disabled = moving;
  }
}

/** One line for the power flow (#157): engine → wheels / battery, battery ↔ motor. */
export function flowText(hy: NonNullable<EngineState["hybrid"]>): string {
  const parts: string[] = [];
  if (hy.engineOn && hy.engineToWheelKw > 0.5) parts.push("Motor → Räder");
  if (hy.engineOn && hy.batteryKw < -0.5 && hy.wheelKw >= -0.5) parts.push("Motor → Akku");
  if (hy.batteryKw > 0.5) parts.push("Akku → E-Motor");
  if (hy.batteryKw < -0.5 && hy.wheelKw < -0.5) parts.push("Räder → Akku");
  return parts.length ? parts.join(" · ") : "–";
}
