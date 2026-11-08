// Fahrzeug-Platte on the chassis dyno (issue #22): body and chassis data, tyres, ready-made cars.
// Everything here can only be changed at standstill (like the gearbox). The plate edits the Drivetrain of the
// Getriebe-Pult; loading a ready-made car also asks the app to load its engine (onLoadCar).
import { SPEED_INDEX, TYRE_TYPES, formatTyreSize, frontAxleShare, parseTyreSize, speedRatingKmh, tyreRadii } from "../core/index.ts";
import type { Drivetrain, DriveLayout, SpeedIndex, TyreSetup, TyreType, VehicleParams } from "../core/index.ts";
import { VEHICLE_LIBRARY, type LibraryCar } from "../data/vehicle-library.ts";
import { prefs } from "./settings.ts";
import { toUnit } from "./units.ts";

/** Speed in the globally chosen unit (#24), e.g. "250 km/h" or "155 mph". */
const spd = (kmh: number) => `${Math.round(toUnit("speed", kmh)).toLocaleString("de-DE")} ${prefs().speed}`;

const LAYOUT_LABEL: Record<DriveLayout, string> = { fwd: "Frontantrieb (FWD)", rwd: "Heckantrieb (RWD)", awd: "Allrad (AWD)" };
/** Speed indices offered in the list (passenger cars and motorcycles). */
const INDEX_CHOICES: SpeedIndex[] = ["Q", "S", "T", "H", "V", "W", "Y", "(Y)"];

const fmt = (n: number, d: number) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

interface NumField {
  key: "mass" | "cw" | "area" | "front" | "cg" | "wb" | "tank";
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  digits: number;
}

const FIELDS: NumField[] = [
  { key: "mass", label: "Masse mit Fahrer", unit: "kg", min: 150, max: 4000, step: 5, digits: 0 },
  { key: "cw", label: "cW-Wert", unit: "", min: 0.15, max: 0.9, step: 0.01, digits: 2 },
  { key: "area", label: "Stirnfläche", unit: "m²", min: 0.3, max: 4.5, step: 0.01, digits: 2 },
  { key: "front", label: "Gewicht vorn", unit: "%", min: 25, max: 75, step: 1, digits: 0 },
  { key: "cg", label: "Schwerpunkthöhe", unit: "m", min: 0.3, max: 1.2, step: 0.01, digits: 2 },
  { key: "wb", label: "Radstand", unit: "m", min: 1.2, max: 3.6, step: 0.01, digits: 2 },
  { key: "tank", label: "Tankgröße", unit: "l", min: 2, max: 400, step: 1, digits: 0 },
];

export class VehiclePanel {
  readonly el: HTMLElement;
  private carSel: HTMLSelectElement;
  /** Library id of the loaded vehicle, "" for an own one (the tank level is saved per vehicle). */
  get carId(): string {
    return this.carSel.value;
  }
  private loadBtn: HTMLButtonElement;
  private layoutSel: HTMLSelectElement;
  private tyreSel: HTMLSelectElement;
  private sizeInput: HTMLInputElement;
  private indexSel: HTMLSelectElement;
  private tyreOut: HTMLElement;
  private tyreHint: HTMLElement;
  private carNote: HTMLElement;
  private inputs = new Map<NumField["key"], HTMLInputElement>();
  private moving = false;
  private lastTemp = "";
  /** Set by the app: load the car's engine; returns false when that is not possible right now (engine running). */
  onLoadCar: (car: LibraryCar) => boolean = () => true;
  /** Called after any change that alters the vehicle (the Getriebe-Pult recalculates Vmax). */
  onChange: () => void = () => {};

  constructor(private drivetrain: Drivetrain) {
    const el = document.createElement("div");
    el.className = "vehicle";
    el.innerHTML = `
      <h3 class="vehicle__title">Fahrzeug &amp; Reifen</h3>
      <div class="vehicle__car">
        <label class="gearbox__field"><span>Fertiges Fahrzeug</span>
          <select data-control="car">
            <option value="">– eigenes Fahrzeug –</option>
            ${([["Autos", false], ["Motorräder", true]] as const).map(([label, bike]) => `<optgroup label="${label}">${VEHICLE_LIBRARY
              .filter((c) => ((c.setup.kind ?? "car") !== "car") === bike)
              .map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</optgroup>`).join("")}
          </select>
        </label>
        <button type="button" class="btn btn--small" data-control="load-car">Laden</button>
      </div>
      <p class="vehicle__note" data-out="car-note"></p>
      <div class="vehicle__grid">
        ${FIELDS.map((f) => `
          <label class="vehicle__num"><span>${f.label}</span>
            <input type="number" inputmode="decimal" data-field="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" />
            <small>${f.unit}</small>
          </label>`).join("")}
        <label class="vehicle__num vehicle__num--wide"><span>Antrieb</span>
          <select data-control="layout">${(Object.keys(LAYOUT_LABEL) as DriveLayout[])
            .map((k) => `<option value="${k}">${LAYOUT_LABEL[k]}</option>`).join("")}</select>
        </label>
      </div>
      <div class="vehicle__grid vehicle__grid--tyre">
        <label class="vehicle__num vehicle__num--wide"><span>Reifen</span>
          <select data-control="tyre">${(Object.keys(TYRE_TYPES) as TyreType[])
            .map((k) => `<option value="${k}">${TYRE_TYPES[k].label}</option>`).join("")}</select>
        </label>
        <label class="vehicle__num"><span>Größe</span>
          <input type="text" data-control="tyre-size" spellcheck="false" autocomplete="off" placeholder="225/45 R17" aria-describedby="tyre-size-help" />
        </label>
        <label class="vehicle__num"><span>Index</span>
          <select data-control="speed-index">${INDEX_CHOICES
            .map((k) => `<option value="${k}">${k}</option>`).join("")}</select>
        </label>
      </div>
      <p class="vehicle__tyre num" data-out="tyre" id="tyre-size-help"></p>
      <p class="vehicle__hint" data-out="tyre-hint"></p>`;
    this.el = el;
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    this.carSel = q("[data-control=car]");
    this.loadBtn = q("[data-control=load-car]");
    this.layoutSel = q("[data-control=layout]");
    this.tyreSel = q("[data-control=tyre]");
    this.sizeInput = q("[data-control=tyre-size]");
    this.indexSel = q("[data-control=speed-index]");
    this.tyreOut = q("[data-out=tyre]");
    this.tyreHint = q("[data-out=tyre-hint]");
    this.carNote = q("[data-out=car-note]");
    for (const f of FIELDS) this.inputs.set(f.key, q(`[data-field=${f.key}]`));

    for (const f of FIELDS) {
      const input = this.inputs.get(f.key)!;
      input.addEventListener("change", () => this.applyField(f, input));
    }
    this.layoutSel.addEventListener("change", () => this.edit({ driveLayout: this.layoutSel.value as DriveLayout }));
    this.tyreSel.addEventListener("change", () => this.editTyre({ type: this.tyreSel.value as TyreType }));
    this.indexSel.addEventListener("change", () => this.editTyre({ speedIndex: this.indexSel.value as SpeedIndex }));
    this.sizeInput.addEventListener("change", () => {
      const size = parseTyreSize(this.sizeInput.value);
      if (!size) {
        this.sizeInput.setAttribute("aria-invalid", "true");
        this.tyreOut.textContent = "Größe als Breite/Querschnitt R Zoll eingeben, z. B. 225/45 R17.";
        return;
      }
      this.sizeInput.removeAttribute("aria-invalid");
      this.editTyre({ size });
    });
    this.loadBtn.addEventListener("click", () => this.loadSelected());
    this.sync();
  }

  private loadSelected() {
    const id = this.carSel.value;
    const car = VEHICLE_LIBRARY.find((c) => c.id === id);
    if (!car || this.moving) return;
    if (!this.onLoadCar(car)) {
      this.carNote.textContent = "Erst den Motor abstellen, dann lässt sich ein fertiges Fahrzeug laden.";
      return;
    }
    this.applyCar(car);
  }

  /**
   * A production engine was loaded on the bench: picks the car that engine came in (first match in the
   * vehicle library) and sets its gearbox, body and tyres. The engine itself is already loaded.
   */
  selectCarForEngine(engineId: string): LibraryCar | null {
    const car = VEHICLE_LIBRARY.find((c) => c.engineId === engineId);
    if (!car || this.moving) return null;
    this.carSel.value = car.id;
    this.applyCar(car);
    return car;
  }

  private applyCar(car: LibraryCar) {
    this.drivetrain.applyCar(structuredClone(car.setup));
    const f = car.factory;
    this.carNote.textContent = `${car.name}: Werk ${fmt(f.t0to100S, 1)} s ${prefs().speed === "mph" ? "von 0 auf 62 mph (100 km/h, Werksangabe)" : "von 0 auf 100 km/h"}, Vmax ${spd(f.vmaxKmh)}${f.vmaxGoverned ? " (abgeregelt)" : ""}, ${f.kerbKg} kg (${f.kerbNorm === "wet" ? "fahrbereit, ohne Fahrer" : f.kerbNorm}).`;
    this.sync();
    this.onChange();
  }

  private applyField(f: NumField, input: HTMLInputElement) {
    const raw = Number(input.value.replace(",", "."));
    if (!Number.isFinite(raw)) return this.sync();
    const n = Math.min(f.max, Math.max(f.min, raw));
    const v = this.drivetrain.vehicle;
    const wb = v.wheelbaseM ?? 2.6;
    const share = frontAxleShare(v);
    switch (f.key) {
      case "mass": return this.edit({ massKg: n });
      case "cw": return this.edit({ dragCoefficient: n });
      case "area": return this.edit({ frontalAreaM2: n });
      case "front": return this.edit({ cgToRearAxleM: (n / 100) * wb, wheelbaseM: wb });
      case "cg": return this.edit({ cgHeightM: n });
      case "wb": return this.edit({ wheelbaseM: n, cgToRearAxleM: share * n });
      case "tank": {
        // another tank: the litres in it stay (up to the new size); an own vehicle from now on
        if (this.moving) return this.sync();
        const t = this.drivetrain.tank;
        const litres = t.levelL;
        t.setCapacity(n, false);
        t.setLevel(litres);
        return this.edit({});
      }
    }
  }

  private edit(p: Partial<VehicleParams>) {
    if (this.moving) return this.sync();
    this.drivetrain.setVehicleParams(p);
    this.carSel.value = "";
    this.carNote.textContent = "";
    this.sync();
    this.onChange();
  }

  private editTyre(p: Partial<TyreSetup>) {
    if (this.moving) return this.sync();
    this.drivetrain.setTyre({ ...this.drivetrain.tyre, ...p });
    this.sync();
    this.onChange();
  }

  /** Fills all controls from the drivetrain (after a load, a vehicle-kind change or an edit). */
  /** Speed-index labels in the chosen unit (#24); called by the gearbox panel on a settings change. */
  syncUnits() {
    for (const o of this.indexSel.options) {
      const k = o.value as SpeedIndex;
      o.textContent = `${k} (${k === "(Y)" ? `> ${spd(300)}` : spd(SPEED_INDEX[k as keyof typeof SPEED_INDEX])})`;
    }
    this.sync();
  }

  sync() {
    const v = this.drivetrain.vehicle;
    const t = this.drivetrain.tyre;
    const values: Record<NumField["key"], number> = {
      mass: v.massKg, cw: v.dragCoefficient, area: v.frontalAreaM2, front: frontAxleShare(v) * 100,
      cg: v.cgHeightM ?? 0.55, wb: v.wheelbaseM ?? 2.6, tank: this.drivetrain.tank.capacityL,
    };
    for (const f of FIELDS) this.inputs.get(f.key)!.value = values[f.key].toFixed(f.digits);
    // motorcycles drive the rear wheel; the layout is fixed there
    const bike = this.drivetrain.kind !== "car";
    this.layoutSel.value = v.driveLayout ?? "fwd";
    this.layoutSel.dataset.fixed = bike ? "1" : "";
    this.tyreSel.value = t.type;
    this.sizeInput.value = formatTyreSize(t.size);
    this.sizeInput.removeAttribute("aria-invalid");
    this.indexSel.value = t.speedIndex;
    const r = tyreRadii(t.size);
    this.tyreOut.textContent = `Dynamischer Radius ${fmt(r.dynamicM * 1000, 0)} mm, Abrollumfang ${fmt(2 * Math.PI * r.dynamicM, 2)} m, Freigabe bis ${t.speedIndex === "(Y)" ? `über ${spd(300)}` : spd(speedRatingKmh(t.speedIndex))}.`;
    this.lastTemp = "";
    this.updateTyreHint();
    this.setLocked(this.moving);
  }

  private updateTyreHint() {
    const s = this.drivetrain.state;
    const t = TYRE_TYPES[this.drivetrain.tyre.type];
    const temp = `${Math.round(s.tyreTempC)}|${s.grip.toFixed(2)}`;
    if (temp === this.lastTemp) return;
    this.lastTemp = temp;
    const cold = t.coldFactor < 0.9 && s.tyreTempC < t.warmC - 5 ? ` Noch kalt: ${fmt(toUnit("temp", s.tyreTempC), 0)} ${prefs().temp}, warmfahren (Burnout) bringt Grip.` : "";
    this.tyreHint.textContent = `${t.hint} Jetzt μ ${fmt(s.grip, 2)}, Lauffläche ${fmt(toUnit("temp", s.tyreTempC), 0)} ${prefs().temp}.${cold}`;
  }

  private setLocked(moving: boolean) {
    const bike = this.drivetrain.kind !== "car";
    for (const c of this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
      c.disabled = moving || (c === this.layoutSel && bike);
    }
  }

  /** Per frame: lock while moving, live tyre temperature / μ. */
  update() {
    const moving = this.drivetrain.state.speedKmh > 0.5;
    if (moving !== this.moving) {
      this.moving = moving;
      this.setLocked(moving);
    }
    this.updateTyreHint();
  }
}
