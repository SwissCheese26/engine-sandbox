// Getriebe-Pult for the chassis dyno (issue #14 base): gearbox type, final drive, gear indicator,
// speed, top speed and 0–100 stopwatch, shift buttons (keys Q = down, E = up).
import { Drivetrain, theoreticalVmax, dynoSweep, SPEED_LIMIT_OPTIONS, TYRE_RATING_W_KMH } from "../core/index.ts";
import type { EngineConfig, EngineSummary, GearboxType } from "../core/index.ts";

const TYPE_LABEL: Record<GearboxType, string> = {
  manual: "Handschalter, 6 Gänge",
  dsg: "Doppelkupplung (DSG), 7 Gänge",
  cvt: "Stufenlos (CVT)",
};

const fmt1 = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = (n: number) => Math.round(n).toLocaleString("de-DE");

export class GearboxPanel {
  readonly el: HTMLElement;
  readonly drivetrain: Drivetrain;
  private typeSel: HTMLSelectElement;
  private fdInput: HTMLInputElement;
  private fdOut: HTMLOutputElement;
  private gearEl: HTMLElement;
  private speedEl: HTMLElement;
  private vmaxEl: HTMLElement;
  private t100El: HTMLElement;
  private calcEl: HTMLElement;
  private limitSel: HTMLSelectElement;
  private vmaxNoteEl: HTMLElement;
  private govNoteEl: HTMLElement;
  private tyreNoteEl: HTMLElement;
  private downBtn: HTMLButtonElement;
  private upBtn: HTMLButtonElement;
  private autoBtn: HTMLButtonElement;
  private cfg: EngineConfig;
  private summary: EngineSummary;
  private last = { gear: "", speed: "", vmax: "", t100: "", vmaxNote: false, gov: false, tyre: false };
  private moving = false;
  /** Set by the app: puts the vehicle in the simulator back to standstill. */
  onResetVehicle: () => void = () => {};

  constructor(cfg: EngineConfig, summary: EngineSummary) {
    this.cfg = cfg;
    this.summary = summary;
    this.drivetrain = new Drivetrain(cfg, summary, "manual");
    const el = document.createElement("section");
    el.className = "gearbox";
    el.setAttribute("aria-label", "Getriebe und Fahrzeug");
    el.hidden = true;
    el.innerHTML = `
      <div class="gearbox__setup">
        <h2 class="gearbox__title">Rollenprüfstand</h2>
        <label class="gearbox__field"><span>Getriebe</span>
          <select data-control="gearbox">${(Object.keys(TYPE_LABEL) as GearboxType[])
            .map((t) => `<option value="${t}">${TYPE_LABEL[t]}</option>`).join("")}</select>
        </label>
        <label class="gearbox__field"><span>Achsübersetzung</span>
          <input type="range" min="2.5" max="5.5" step="0.05" data-control="final-drive" />
          <output class="num"></output>
        </label>
        <label class="gearbox__field"><span>Vmax-Begrenzer</span>
          <select data-control="speed-limit">${SPEED_LIMIT_OPTIONS
            .map((v) => `<option value="${v ?? "off"}">${v === null ? "aus (aufgehoben)" : `${v} km/h`}</option>`).join("")}</select>
        </label>
        <p class="gearbox__hint">Kürzer übersetzt zieht stärker und dreht früher in den Begrenzer, länger übersetzt bringt mehr Vmax, wenn die Leistung reicht. Fahrzeug: 1450 kg, cW 0,30.</p>
        <p class="gearbox__calc num"></p>
      </div>
      <div class="gearbox__drive">
        <div class="gearbox__gear num" aria-live="off" title="Gang">N</div>
        <div class="gearbox__shift">
          <button type="button" class="btn" data-control="shift-down" aria-keyshortcuts="Q">Runter <kbd>Q</kbd></button>
          <button type="button" class="btn" data-control="shift-up" aria-keyshortcuts="E">Hoch <kbd>E</kbd></button>
          <button type="button" class="btn btn--small" data-control="shift-auto" hidden>Automatik (D)</button>
        </div>
        <p class="gearbox__keys">Gas <kbd>W</kbd>, Bremse <kbd>S</kbd></p>
      </div>
      <div class="gearbox__out">
      <dl class="gearbox__readouts">
        <div><dt>Tempo</dt><dd class="num"><span data-out="speed">0</span> km/h</dd></div>
        <div><dt>Vmax gemessen</dt><dd class="num"><span data-out="vmax">0</span> km/h<small class="gearbox__vmax-note" hidden> (abgeregelt)</small></dd></div>
        <div><dt>0–100 km/h</dt><dd class="num"><span data-out="t100">–</span> s</dd></div>
      </dl>
      <div class="gearbox__notes" aria-live="polite">
        <p class="note note--info" data-out="governor" hidden>Abgeregelt: Der Vmax-Begrenzer nimmt das Gas zurück.</p>
        <p class="note note--warning" data-out="tyre" hidden>Reifenfreigabe W = ${TYRE_RATING_W_KMH} km/h überschritten</p>
      </div>
      </div>`;
    this.el = el;
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    this.typeSel = q("[data-control=gearbox]");
    this.fdInput = q("[data-control=final-drive]");
    this.fdOut = q(".gearbox__field output");
    this.gearEl = q(".gearbox__gear");
    this.speedEl = q("[data-out=speed]");
    this.vmaxEl = q("[data-out=vmax]");
    this.t100El = q("[data-out=t100]");
    this.calcEl = q(".gearbox__calc");
    this.limitSel = q("[data-control=speed-limit]");
    this.vmaxNoteEl = q(".gearbox__vmax-note");
    this.govNoteEl = q("[data-out=governor]");
    this.tyreNoteEl = q("[data-out=tyre]");
    this.downBtn = q("[data-control=shift-down]");
    this.upBtn = q("[data-control=shift-up]");
    this.autoBtn = q("[data-control=shift-auto]");

    this.typeSel.addEventListener("change", () => {
      this.drivetrain.setType(this.typeSel.value as GearboxType);
      this.syncSetup();
    });
    this.fdInput.addEventListener("input", () => {
      this.drivetrain.setFinalDrive(Number(this.fdInput.value));
      this.syncSetup();
    });
    // the governor can be recoded at any time, also while driving (issue #32)
    this.limitSel.addEventListener("change", () => {
      this.drivetrain.setSpeedLimit(this.limitSel.value === "off" ? null : Number(this.limitSel.value));
      this.syncSetup();
    });
    this.downBtn.addEventListener("click", () => this.drivetrain.shift(-1));
    this.upBtn.addEventListener("click", () => this.drivetrain.shift(1));
    this.autoBtn.addEventListener("click", () => this.drivetrain.setAutomatic());
    this.syncSetup();
  }

  setVisible(on: boolean) {
    this.el.hidden = !on;
    if (on) this.reset();
  }

  configure(cfg: EngineConfig, summary: EngineSummary) {
    this.cfg = cfg;
    this.summary = summary;
    // the simulator was reset by setConfig() (engine and vehicle at rest), so the gearbox follows
    this.drivetrain.setEngine(cfg, summary);
    this.drivetrain.reset();
    this.syncSetup();
  }

  /** Vehicle back to standstill (engine reset). */
  reset() {
    this.drivetrain.reset();
    this.onResetVehicle();
  }

  /** Q / E shift keys. Returns true when handled. */
  handleKey(e: KeyboardEvent, down: boolean): boolean {
    if (this.el.hidden || e.ctrlKey || e.metaKey || e.altKey) return false;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "SELECT" || tag === "TEXTAREA" || (tag === "INPUT" && (e.target as HTMLInputElement).type === "text")) return false;
    const key = e.key.toLowerCase();
    if (key !== "q" && key !== "e") return false;
    if (down && !e.repeat) this.drivetrain.shift(key === "e" ? 1 : -1);
    return true;
  }

  private syncSetup() {
    const s = this.drivetrain.state;
    this.typeSel.value = s.type;
    this.fdInput.value = String(s.finalDrive);
    this.limitSel.value = s.speedLimitKmh === null ? "off" : String(s.speedLimitKmh);
    this.fdOut.textContent = fmt1(s.finalDrive).replace(",0", ",00").replace(/,(\d)$/, ",$10");
    const cvt = s.type === "cvt";
    this.downBtn.hidden = cvt;
    this.upBtn.hidden = cvt;
    // theoretical top speed from the steady full-load curve
    try {
      const sweep = dynoSweep(this.cfg, { stepRpm: 100 });
      const torqueAt = (rpm: number) => {
        let best = sweep[0]!;
        for (const p of sweep) if (Math.abs(p.rpm - rpm) < Math.abs(best.rpm - rpm)) best = p;
        return best.torqueNm;
      };
      const r = theoreticalVmax(torqueAt, this.cfg.revLimitRpm, s.type, s.finalDrive);
      // physical top speed without the governor; the governor note follows when it caps below that
      const lim = s.speedLimitKmh;
      const capped = lim !== null && r.vmaxKmh > lim
        ? ` Der Vmax-Begrenzer regelt bei ${fmt0(lim)} km/h ab.`
        : "";
      this.calcEl.textContent = (r.limitedBy === "limiter"
        ? `Berechnete Vmax ohne Begrenzer ${fmt0(r.vmaxKmh)} km/h, begrenzt durch den Drehzahlbegrenzer im ${r.gear}. Gang: länger übersetzen bringt mehr.`
        : `Berechnete Vmax ohne Begrenzer ${fmt0(r.vmaxKmh)} km/h, begrenzt durch den Luftwiderstand.`) + capped;
    } catch {
      this.calcEl.textContent = "";
    }
  }

  /** Per frame: returns the pedal the engine should get (manual shifts lift off). */
  update(braking = false): void {
    const d = this.drivetrain;
    const s = d.state;
    const gear = s.shifting && s.type === "manual" ? "–" : d.gearLabel();
    const speed = fmt0(s.speedKmh);
    const vmax = fmt0(s.maxSpeedKmh);
    const t100 = s.t0to100Running !== null ? fmt1(s.t0to100Running) : s.t0to100S !== null ? fmt1(s.t0to100S) : "–";
    if (gear !== this.last.gear) this.gearEl.textContent = this.last.gear = gear;
    if (speed !== this.last.speed) this.speedEl.textContent = this.last.speed = speed;
    if (vmax !== this.last.vmax) this.vmaxEl.textContent = this.last.vmax = vmax;
    if (t100 !== this.last.t100) this.t100El.textContent = this.last.t100 = t100;
    this.autoBtn.hidden = !(s.type === "dsg" && s.manualMode);
    const vmaxNote = s.maxSpeedLimited && s.maxSpeedKmh > 0.5;
    if (vmaxNote !== this.last.vmaxNote) this.vmaxNoteEl.hidden = !(this.last.vmaxNote = vmaxNote);
    if (s.limiting !== this.last.gov) this.govNoteEl.hidden = !(this.last.gov = s.limiting);
    const tyre = s.speedKmh > TYRE_RATING_W_KMH;
    if (tyre !== this.last.tyre) this.tyreNoteEl.hidden = !(this.last.tyre = tyre);
    this.gearEl.classList.toggle("is-braking", braking);
    // gearbox and final drive can only be changed at standstill (review #19)
    const moving = s.speedKmh > 0.5;
    if (moving !== this.moving) {
      this.moving = moving;
      this.typeSel.disabled = moving;
      this.fdInput.disabled = moving;
    }
  }
}
