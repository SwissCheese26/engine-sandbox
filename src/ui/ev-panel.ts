// Elektro-Platte (#108): drive mode, battery and motor readouts, charging and a small tuning form for the loaded
// electric car. Shown on the chassis dyno instead of the gearbox controls (the app puts it into the Getriebe-Pult).
// Tuning applies only at standstill; the extended tuning UI is a follow-up of #108.
import { DRIVE_MODES, DRIVE_MODE_IDS } from "../core/index.ts";
import type { EngineState, EvConfig, EvDriveMode } from "../core/index.ts";
import { TYRE_TYPES } from "../core/index.ts";
import type { EvChemistry, TyreType } from "../core/index.ts";
import type { LibraryCar } from "../data/vehicle-library.ts";
import { CELLS, COOLING, LIMIT_LABEL as TUNE_LIMIT, PS_PER_KW, TUNING_LIMITS, estimateEv, evTuningOf, maxTuning, tuneEv, validTuning, type EvCooling, type EvTuning, type TunedEv } from "../data/ev-tuning.ts";
import { fmt } from "./format.ts";
import { prefs } from "./settings.ts";
import { toUnit } from "./units.ts";
import { consumptionText, rangeText, socText } from "./layouts/ev-logic.ts";

const LIVE_LIMIT: Record<string, string> = {
  none: "–", torque: "Motormoment", power: "Motorleistung", battery: "Akku", thermal: "Temperatur", traction: "Haftung", speed: "Motordrehzahl",
};

export class EvPanel {
  readonly el: HTMLElement;
  private out: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private base: EvConfig | null = null;
  private car: LibraryCar | null = null;
  private preview: TunedEv | null = null;
  private estTimer = 0;
  mode: EvDriveMode = "sport";
  /** Set by the app: drive mode changed. */
  onMode: (m: EvDriveMode) => void = () => {};
  /** Set by the app: charge the battery to this state of charge. */
  onCharge: (soc: number) => void = () => {};
  /** Set by the app: apply a tuned configuration (mass, tyre, stored per vehicle); false while the car moves. */
  onTune: (t: TunedEv, massKg: number) => boolean = () => false;
  /** Set by the app: "Auf Werkszustand zurücksetzen" (forget the tuning of this vehicle). */
  onFactory: () => boolean = () => false;

  constructor() {
    const el = document.createElement("section");
    el.className = "evp";
    el.setAttribute("aria-label", "Elektroantrieb");
    el.hidden = true;
    const num = (k: keyof typeof TUNING_LIMITS, label: string, step: number, unit = "") =>
      `<label class="evp__num"><span>${label}</span><input type="number" data-tune="${k}" min="${TUNING_LIMITS[k].min}" max="${TUNING_LIMITS[k].max}" step="${step}" inputmode="decimal" /><small>${unit}</small></label>`;
    el.innerHTML = `
      <h3 class="evp__title">Elektroantrieb <span class="evp__badge" aria-hidden="true">⚡</span></h3>
      <div class="evp__modes" role="radiogroup" aria-label="Fahrmodus">
        ${DRIVE_MODE_IDS.map((m) => `<button type="button" class="btn btn--small" role="radio" aria-checked="false" data-mode="${m}" title="${DRIVE_MODES[m].hint}">${DRIVE_MODES[m].label}</button>`).join("")}
      </div>
      <dl class="evp__readouts num">
        <div><dt>Ladezustand</dt><dd data-o="soc">–</dd></div>
        <div><dt>Reichweite</dt><dd data-o="range">–</dd></div>
        <div><dt>Akku</dt><dd data-o="pack">–</dd></div>
        <div><dt>Leistung</dt><dd data-o="power">–</dd></div>
        <div><dt>Verbrauch</dt><dd data-o="cons">–</dd></div>
        <div><dt>Akkutemperatur</dt><dd data-o="batt">–</dd></div>
        <div><dt>E-Motor</dt><dd data-o="motor">–</dd></div>
        <div><dt>Begrenzt durch</dt><dd data-o="limit">–</dd></div>
      </dl>
      <p class="evp__charge">
        <button type="button" class="btn btn--small" data-control="charge-90">Laden auf 90 %</button>
        <button type="button" class="btn btn--small" data-control="charge-100">100 %</button>
        <button type="button" class="btn btn--small" data-control="charge-10">10 % (Test)</button>
      </p>
      <details class="evp__tune" open>
        <summary>E-Tuner: Motoren, Akku, Kühlung, Reifen</summary>
        <div class="evp__tune-grid">
          <label class="evp__num"><span>Motoren vorn</span><select data-tune="frontMotors">${[0, 1, 2, 3, 4].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></label>
          <label class="evp__num"><span>Motoren hinten</span><select data-tune="rearMotors">${[0, 1, 2, 3, 4].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></label>
          ${num("motorScale", "Motorgröße", 0.1, "×")}
          ${num("currentScale", "Wechselrichterstrom", 0.05, "×")}
          ${num("packKwh", "Akku", 5, "kWh")}
          <label class="evp__num"><span>Zelltyp</span><select data-tune="chemistry">${(Object.keys(CELLS) as EvChemistry[]).map((c) => `<option value="${c}">${CELLS[c].label}</option>`).join("")}</select></label>
          ${num("cRate", "Entladerate", 0.5, "C")}
          <label class="evp__num"><span>Spannung</span><select data-tune="highVoltage"><option value="0">400 V</option><option value="1">800 V</option></select></label>
          <label class="evp__num"><span>Kühlung</span><select data-tune="cooling">${(Object.keys(COOLING) as EvCooling[]).map((c) => `<option value="${c}">${COOLING[c].label}</option>`).join("")}</select></label>
          <label class="evp__num"><span>Reifen</span><select data-tune="tyre">${(["standard", "uhp", "semi-slick", "slick", "winter"] as TyreType[]).map((t) => `<option value="${t}">${TYRE_TYPES[t].label}</option>`).join("")}</select></label>
        </div>
        <dl class="evp__live num" aria-live="polite">
          <div><dt>Spitzenleistung</dt><dd data-o="t-power">–</dd></div>
          <div><dt>Je Motor</dt><dd data-o="t-motor">–</dd></div>
          <div><dt>Begrenzt durch</dt><dd data-o="t-limit">–</dd></div>
          <div><dt>0–100 km/h (Schätzung)</dt><dd data-o="t-t100">–</dd></div>
          <div><dt>Reichweite (Schätzung)</dt><dd data-o="t-range">–</dd></div>
          <div><dt>Masse</dt><dd data-o="t-mass">–</dd></div>
        </dl>
        <p class="evp__preview" data-o="preview"></p>
        <p class="evp__tune-btns">
          <button type="button" class="btn btn--small" data-control="tune-apply">Anwenden</button>
          <button type="button" class="btn btn--small" data-control="tune-max">Maximum</button>
          <button type="button" class="btn btn--small" data-control="tune-reset">Auf Werkszustand zurücksetzen</button>
        </p>
      </details>`;
    this.el = el;
    el.querySelectorAll<HTMLElement>("[data-o]").forEach((n) => (this.out[n.dataset.o!] = n));
    el.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.mode as EvDriveMode, true)));
    const charge = (k: string, soc: number) => el.querySelector(`[data-control=${k}]`)!.addEventListener("click", () => this.onCharge(soc));
    charge("charge-90", 0.9);
    charge("charge-100", 1);
    charge("charge-10", 0.1);
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-tune]").forEach((i) => {
      i.addEventListener("input", () => this.updatePreview());
      i.addEventListener("change", () => this.updatePreview());
    });
    el.querySelector("[data-control=tune-apply]")!.addEventListener("click", () => this.apply());
    el.querySelector("[data-control=tune-max]")!.addEventListener("click", () => {
      this.fill(maxTuning());
      this.updatePreview();
    });
    el.querySelector("[data-control=tune-reset]")!.addEventListener("click", () => {
      if (!this.onFactory()) this.out.preview!.textContent = "Erst anhalten, dann lässt sich das Auto zurücksetzen.";
    });
    this.setMode("sport", false);
  }

  /** An electric car was loaded (library car and the tuning it carries now) or null for a combustion car. */
  setCar(car: LibraryCar | null, tuning?: EvTuning) {
    this.el.hidden = !car?.setup.ev;
    this.car = car?.setup.ev ? car : null;
    this.base = this.car ? structuredClone(this.car.setup.ev!) : null;
    if (this.base && this.car) {
      this.fill(tuning ?? evTuningOf(this.base, this.car.setup.tyre.type));
      this.updatePreview();
    }
  }

  setMode(m: EvDriveMode, notify: boolean) {
    this.mode = m;
    this.el.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
    if (notify) this.onMode(m);
  }

  private fill(t: EvTuning) {
    for (const i of this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-tune]")) {
      const k = i.dataset.tune as keyof EvTuning;
      const v = t[k];
      i.value = typeof v === "boolean" ? (v ? "1" : "0") : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v);
    }
  }

  /** The form as tuning values (validated: 1 … 4 motors, limits). */
  read(): EvTuning {
    const v = (k: string) => this.el.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-tune=${k}]`)!.value;
    const n = (k: string) => Number(v(k).replace(",", "."));
    const raw = {
      frontMotors: n("frontMotors"), rearMotors: n("rearMotors"), motorScale: n("motorScale"), currentScale: n("currentScale"), packKwh: n("packKwh"),
      chemistry: v("chemistry"), cRate: n("cRate"), highVoltage: v("highVoltage") === "1", cooling: v("cooling"), tyre: v("tyre"),
    };
    return validTuning(raw, evTuningOf(this.base!, this.car!.setup.tyre.type));
  }

  private updatePreview() {
    if (!this.base || !this.car) return;
    const p = tuneEv(this.base, this.read());
    this.preview = p;
    const u = prefs();
    this.put("t-power", `${fmt(p.systemPs)} PS · ${fmt(p.systemKw)} kW`);
    this.put("t-motor", `${p.ev.motors.length} × ${fmt(p.motorKw)} kW / ${fmt(p.motorNm)} Nm, ${fmt(p.inverterA)} A`);
    this.put("t-mass", `${fmt(this.car.setup.vehicle.massKg + p.deltaKg)} kg (${p.deltaKg >= 0 ? "+" : "−"}${fmt(Math.abs(p.deltaKg))})`);
    this.put("preview", p.notes.join(" "));
    this.put("t-limit", TUNE_LIMIT[p.limit]);
    this.put("t-t100", "…");
    // the drive estimate takes a few ms of simulation: once the input settles
    clearTimeout(this.estTimer);
    this.estTimer = window.setTimeout(() => {
      if (this.preview !== p || !this.car) return;
      const e = estimateEv(this.car.setup, p);
      this.put("t-limit", `${TUNE_LIMIT[p.limit]}${e.tractionLimited ? `, beim Anfahren ${TUNE_LIMIT.traction}` : ""}`);
      this.put("t-t100", e.t100 === null ? "über 20 s" : `${fmt(e.t100, 1)} s`);
      this.put("t-range", rangeText(e.rangeKm, u));
    }, 120);
  }

  private apply() {
    if (!this.base || !this.preview || !this.car) return;
    if (!this.onTune(this.preview, this.car.setup.vehicle.massKg + this.preview.deltaKg)) this.put("preview", "Erst anhalten, dann lässt sich das Auto umbauen.");
    else this.put("preview", `Umgebaut: ${fmt(this.preview.systemKw * PS_PER_KW)} PS.`);
  }

  private put(k: string, v: string) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.out[k]!.textContent = v;
  }

  update(s: EngineState) {
    const ev = s.ev;
    if (!ev || this.el.hidden) return;
    const u = prefs();
    this.put("soc", socText(ev.soc));
    this.put("range", rangeText(ev.rangeKm, u));
    this.put("pack", `${fmt(ev.packV)} V · ${fmt(ev.packA)} A`);
    this.put("power", `${fmt(toUnit("power", ev.powerKw, u.power))} ${u.power}${ev.regenKw > 1 ? " (Rekuperation)" : ""}`);
    const c = consumptionText(ev.kwhPer100, u);
    this.put("cons", `${c.value} ${c.unit}`);
    this.put("batt", `${fmt(toUnit("temp", ev.batteryC, u.temp))} ${u.temp}`);
    this.put("motor", `${fmt(toUnit("temp", ev.motorC, u.temp))} ${u.temp}`);
    this.put("limit", LIVE_LIMIT[ev.limitedBy] ?? "–");
  }
}
