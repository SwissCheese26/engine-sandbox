// Elektro-Platte (#108): drive mode, battery and motor readouts, charging and a small tuning form for the loaded
// electric car. Shown on the chassis dyno instead of the gearbox controls (the app puts it into the Getriebe-Pult).
// Tuning applies only at standstill; the extended tuning UI is a follow-up of #108.
import { DRIVE_MODES, DRIVE_MODE_IDS, evSystemPowerKw } from "../core/index.ts";
import type { EngineState, EvConfig, EvDriveMode } from "../core/index.ts";
import { TUNING_LIMITS, evTuningOf, tuneEv, type EvTuning, type TunedEv } from "../data/ev-tuning.ts";
import { fmt } from "./format.ts";
import { prefs } from "./settings.ts";
import { toUnit } from "./units.ts";
import { consumptionText, rangeText, socText } from "./layouts/ev-logic.ts";

const LIMIT_LABEL: Record<string, string> = {
  none: "–", torque: "Motormoment", power: "Motorleistung", battery: "Akku", thermal: "Temperatur", traction: "Haftung", speed: "Motordrehzahl",
};

export class EvPanel {
  readonly el: HTMLElement;
  private out: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private base: EvConfig | null = null;
  private baseMassKg = 0;
  private preview: TunedEv | null = null;
  mode: EvDriveMode = "sport";
  /** Set by the app: drive mode changed. */
  onMode: (m: EvDriveMode) => void = () => {};
  /** Set by the app: charge the battery to this state of charge. */
  onCharge: (soc: number) => void = () => {};
  /** Set by the app: apply a tuned configuration (+ mass change); returns false while the car moves. */
  onTune: (t: TunedEv, massKg: number) => boolean = () => false;

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
      <details class="evp__tune">
        <summary>Tuning: Motoren und Akku</summary>
        <div class="evp__tune-grid">
          ${num("frontMotors", "Motoren vorn", 1)}
          ${num("rearMotors", "Motoren hinten", 1)}
          ${num("motorScale", "Motorgröße", 0.1, "×")}
          ${num("currentScale", "Wechselrichterstrom", 0.1, "×")}
          ${num("packKwh", "Akku", 5, "kWh")}
          ${num("cRate", "Entladerate", 0.5, "C")}
          <label class="evp__chk"><input type="checkbox" data-tune="highVoltage" /> <span>800-V-Akku</span></label>
        </div>
        <p class="evp__preview num" data-o="preview" aria-live="polite"></p>
        <p class="evp__tune-btns">
          <button type="button" class="btn btn--small" data-control="tune-apply">Anwenden</button>
          <button type="button" class="btn btn--small" data-control="tune-max">Maximum</button>
          <button type="button" class="btn btn--small" data-control="tune-reset">Serie</button>
        </p>
      </details>`;
    this.el = el;
    el.querySelectorAll<HTMLElement>("[data-o]").forEach((n) => (this.out[n.dataset.o!] = n));
    el.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.mode as EvDriveMode, true)));
    const charge = (k: string, soc: number) => el.querySelector(`[data-control=${k}]`)!.addEventListener("click", () => this.onCharge(soc));
    charge("charge-90", 0.9);
    charge("charge-100", 1);
    charge("charge-10", 0.1);
    el.querySelectorAll<HTMLInputElement>("[data-tune]").forEach((i) => i.addEventListener("input", () => this.updatePreview()));
    el.querySelector("[data-control=tune-apply]")!.addEventListener("click", () => this.apply());
    el.querySelector("[data-control=tune-max]")!.addEventListener("click", () => {
      this.fill({ frontMotors: 2, rearMotors: 3, motorScale: 3, currentScale: 2, packKwh: 200, cRate: 15, highVoltage: true });
      this.updatePreview();
    });
    el.querySelector("[data-control=tune-reset]")!.addEventListener("click", () => {
      if (!this.base) return;
      this.fill(evTuningOf(this.base));
      this.updatePreview();
      this.apply();
    });
    this.setMode("sport", false);
  }

  /** A new electric car was loaded (factory configuration and mass) or null for a combustion car. */
  setCar(ev: EvConfig | null, massKg: number) {
    this.el.hidden = !ev;
    this.base = ev ? structuredClone(ev) : null;
    this.baseMassKg = massKg;
    if (ev) {
      this.fill(evTuningOf(ev));
      this.updatePreview();
    }
  }

  setMode(m: EvDriveMode, notify: boolean) {
    this.mode = m;
    this.el.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
    if (notify) this.onMode(m);
  }

  private fill(t: EvTuning) {
    for (const i of this.el.querySelectorAll<HTMLInputElement>("[data-tune]")) {
      const k = i.dataset.tune as keyof EvTuning;
      if (k === "highVoltage") i.checked = t.highVoltage;
      else i.value = String(Math.round((t[k] as number) * 100) / 100);
    }
  }

  private read(): EvTuning {
    const v = (k: string) => Number(this.el.querySelector<HTMLInputElement>(`[data-tune=${k}]`)!.value.replace(",", "."));
    return {
      frontMotors: v("frontMotors"), rearMotors: v("rearMotors"), motorScale: v("motorScale"), currentScale: v("currentScale"),
      packKwh: v("packKwh"), cRate: v("cRate"), highVoltage: this.el.querySelector<HTMLInputElement>("[data-tune=highVoltage]")!.checked,
    };
  }

  private updatePreview() {
    if (!this.base) return;
    this.preview = tuneEv(this.base, this.read());
    const p = this.preview;
    const base = evSystemPowerKw(this.base);
    const u = prefs();
    this.out.preview!.textContent = `${fmt(toUnit("power", p.systemKw, u.power))} ${u.power} (Serie ${fmt(toUnit("power", base, u.power))}), ${p.deltaKg >= 0 ? "+" : "−"}${fmt(Math.abs(p.deltaKg))} kg. ${p.notes.join(" ")}`;
  }

  private apply() {
    if (!this.base || !this.preview) return;
    if (!this.onTune(this.preview, this.baseMassKg + this.preview.deltaKg)) this.out.preview!.textContent = "Erst anhalten, dann lässt sich das Auto umbauen.";
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
    this.put("limit", LIMIT_LABEL[ev.limitedBy] ?? "–");
  }
}
