// Elektroantrieb im Rollenprüfstand (#108, review of #115): drive mode, live readouts and charging. The readouts are
// rows of the Getriebe-Pult's readout list (same look as Tempo, Vmax, Tankinhalt); "Laden auf" takes the place of
// "Volltanken". Tuning lives on the Werkbank (ev-bench.ts).
import { DRIVE_MODES, DRIVE_MODE_IDS } from "../core/index.ts";
import type { EngineState, EvDriveMode } from "../core/index.ts";
import { evConsumption } from "./ev-fields.ts";
import { fmt } from "./format.ts";
import { prefs } from "./settings.ts";
import { toUnit } from "./units.ts";
import { consumptionText, rangeText, socText } from "./layouts/ev-logic.ts";

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
  mode: EvDriveMode = "sport";
  /** Set by the app: drive mode changed. */
  onMode: (m: EvDriveMode) => void = () => {};
  /** Set by the app: charge the battery to this state of charge. */
  onCharge: (soc: number) => void = () => {};

  constructor() {
    const m = document.createElement("div");
    m.className = "evmode";
    m.hidden = true;
    m.innerHTML = `<span class="evmode__label" id="evmode-l">Fahrmodus</span>
      <div class="evmode__opts" role="radiogroup" aria-labelledby="evmode-l">${DRIVE_MODE_IDS.map((id) => `<button type="button" class="btn btn--small" role="radio" aria-checked="false" data-mode="${id}" title="${DRIVE_MODES[id].hint}">${DRIVE_MODES[id].label}</button>`).join("")}</div>`;
    this.modeEl = m;
    m.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.mode as EvDriveMode, true)));
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
    for (const r of this.rows) r.querySelectorAll<HTMLElement>("[data-o]").forEach((n) => (this.out[n.dataset.o!] = n));
    this.setMode("sport", false);
  }

  /** Electric car loaded or not: shows or hides the rows. */
  setShown(on: boolean) {
    this.shown = on;
    this.modeEl.hidden = !on;
    for (const r of this.rows) r.hidden = !on;
  }

  setMode(m: EvDriveMode, notify: boolean) {
    this.mode = m;
    this.modeEl.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
    if (notify) this.onMode(m);
  }

  private put(k: string, v: string) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.out[k]!.textContent = v;
  }

  update(s: EngineState, speedKmh: number) {
    const ev = s.ev;
    if (!ev || !this.shown) return;
    const u = prefs();
    const pw = (kw: number) => `${fmt(toUnit("power", kw, u.power))} ${u.power}`;
    this.put("soc", socText(ev.soc));
    this.put("range", rangeText(ev.rangeKm, u));
    this.put("power", ev.powerKw < -0.5 ? `−${pw(-ev.powerKw)}` : pw(Math.max(0, ev.powerKw)));
    this.put("regen", `${fmt(ev.regenKwh, 2)} kWh`);
    const c = consumptionText(evConsumption(ev), u);
    this.put("cons", `${c.value} ${c.unit}`);
    this.put("pack", `${fmt(ev.packV)} V · ${fmt(ev.packA)} A`);
    this.put("batt", `${fmt(toUnit("temp", ev.batteryC, u.temp))} ${u.temp}`);
    this.put("motor", `${fmt(toUnit("temp", ev.motorC, u.temp))} ${u.temp}`);
    this.put("limit", LIVE_LIMIT[ev.limitedBy] ?? "–");
    const moving = speedKmh > 0.5;
    for (const b of this.chargeBtns) b.disabled = moving;
  }
}
