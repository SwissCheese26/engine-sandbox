// Fahrzeug-Platte on the chassis dyno (issue #22): body and chassis data, tyres, ready-made cars.
// Everything here can only be changed at standstill (like the gearbox). The plate edits the Drivetrain of the
// Getriebe-Pult; loading a ready-made car also asks the app to load its engine (onLoadCar).
// Own changes stay with the vehicle they were made on (vehicle-custom.ts): a library car stays that car ("angepasst")
// and gets its changes back when it is loaded again; "Auf Werkszustand zurücksetzen" forgets them.
import { DEFAULT_SPEED_LIMIT_KMH, SPEED_INDEX, TYRE_TYPES, VEHICLES, frontAxleShare, isCommercialKind, isMotorcycleKind, speedRatingKmh } from "../core/index.ts";
import type { CarSetup, Drivetrain, DriveLayout, SpeedIndex, TyreSetup, TyreType, VehicleKind, VehicleParams } from "../core/index.ts";
import { captureCustom, clearCustom, forgetDriveParts, loadVehicle, saveCustom, setupSig, vehicleKey } from "./vehicle-custom.ts";
import { carWithDrive, driveOptionsHtml, loadDriveChoice, saveDriveChoice } from "./drive-choice.ts";
import { VEHICLE_LIBRARY, type LibraryCar } from "../data/vehicle-library.ts";
import { clearEvTuning } from "./ev-tuning-store.ts";
import { prefs } from "./settings.ts";
import { TyreSizePicker, tyreClassOf } from "./tyre-size-picker.ts";
import { toUnit } from "./units.ts";

/** Speed in the globally chosen unit (#24), e.g. "250 km/h" or "155 mph". */
const spd = (kmh: number) => `${Math.round(toUnit("speed", kmh)).toLocaleString("de-DE")} ${prefs().speed}`;

const LAYOUT_LABEL: Record<DriveLayout, string> = { fwd: "Frontantrieb (FWD)", rwd: "Heckantrieb (RWD)", awd: "Allrad (AWD)" };
/** Speed indices offered in the list (passenger cars and motorcycles). */
const INDEX_CHOICES: SpeedIndex[] = ["L", "M", "Q", "R", "S", "T", "H", "V", "W", "Y", "(Y)"];

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
  { key: "mass", label: "Masse mit Fahrer", unit: "kg", min: 150, max: 44000, step: 5, digits: 0 },
  { key: "cw", label: "cW-Wert", unit: "", min: 0.15, max: 0.9, step: 0.01, digits: 2 },
  { key: "area", label: "Stirnfläche", unit: "m²", min: 0.3, max: 12, step: 0.01, digits: 2 },
  { key: "front", label: "Gewicht vorn", unit: "%", min: 25, max: 75, step: 1, digits: 0 },
  { key: "cg", label: "Schwerpunkthöhe", unit: "m", min: 0.3, max: 2.2, step: 0.01, digits: 2 },
  { key: "wb", label: "Radstand", unit: "m", min: 1.2, max: 7, step: 0.01, digits: 2 },
  { key: "tank", label: "Tankgröße", unit: "l", min: 2, max: 1200, step: 1, digits: 0 },
];

export class VehiclePanel {
  readonly el: HTMLElement;
  private carSel: HTMLSelectElement;
  private kindSel: HTMLSelectElement;
  private resetBtn: HTMLButtonElement;
  private customOut: HTMLElement;
  /** Library id of the loaded vehicle, "" for an own one (tank and own changes are saved per vehicle). */
  private loadedId = "";
  /** Drive swap (#154): the drive of the loaded library vehicle ("" = factory) and the vehicle as it drives with it. */
  private driveId = "";
  private driven: LibraryCar | null = null;
  private driveSel: HTMLSelectElement;
  /** Puts the factory state of the loaded vehicle on the drivetrain; own vehicles carry the signature of their setup. */
  private factory: () => void = () => this.presetFactory("car");
  private sig: string | undefined = "preset:car";
  /** The loaded vehicle carries own changes. */
  private custom = false;
  get carId(): string {
    return this.loadedId;
  }
  /** The loaded library vehicle with its drive (swapped setup, engine, own id for the E-Tuner store); null for own ones. */
  get currentCar(): LibraryCar | null {
    return this.driven;
  }
  /** The drive was swapped between electric and combustion (the car's own cockpit look no longer fits). */
  get driveTypeChanged(): boolean {
    const car = VEHICLE_LIBRARY.find((c) => c.id === this.loadedId);
    return !!car && !!this.driven && !!car.setup.ev !== !!this.driven.setup.ev;
  }
  /** Storage key of the loaded vehicle's own changes. */
  get vehicleKey(): string {
    return vehicleKey(this.loadedId, this.drivetrain.kind);
  }
  /** Slot for further vehicle settings of the Getriebe-Pult (Vmax governor). */
  readonly setupSlot: HTMLElement;
  private loadBtn: HTMLButtonElement;
  private layoutSel: HTMLSelectElement;
  private tyreSel: HTMLSelectElement;
  private sizePicker: TyreSizePicker;
  private indexSel: HTMLSelectElement;
  private tyreOut: HTMLElement;
  private tyreHint: HTMLElement;
  private carNote: HTMLElement;
  private inputs = new Map<NumField["key"], HTMLInputElement>();
  private loadRow: HTMLElement;
  private loadInput: HTMLInputElement;
  private loadOut: HTMLElement;
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
      <label class="gearbox__field vehicle__kind"><span>Fahrzeugtyp</span>
        <select data-control="vehicle">${(Object.keys(VEHICLES) as VehicleKind[])
          .map((k) => `<option value="${k}">${VEHICLES[k].label}</option>`).join("")}</select>
      </label>
      <div class="vehicle__car">
        <label class="gearbox__field"><span>Fertiges Fahrzeug</span>
          <select data-control="car">
            <option value="">– eigenes Fahrzeug –</option>
            ${([["Autos", "car"], ["Elektro ⚡", "ev"], ["Lkw & Busse", "commercial"], ["Motorräder", "bike"]] as const).map(([label, group]) => `<optgroup label="${label}">${VEHICLE_LIBRARY
              .filter((c) => {
                const k = c.setup.kind ?? "car";
                // electric cars (#108) in their own group
                return group === (c.setup.ev ? "ev" : isMotorcycleKind(k) ? "bike" : isCommercialKind(k) ? "commercial" : "car");
              })
              .map((c) => `<option value="${c.id}">${c.setup.ev ? "⚡ " : ""}${c.name}</option>`).join("")}</optgroup>`).join("")}
          </select>
        </label>
        <button type="button" class="btn btn--small" data-control="load-car">Laden</button>
      </div>
      <label class="gearbox__field vehicle__drive"><span>Antrieb</span>
        <select data-control="drive" aria-describedby="drive-note"></select>
      </label>
      <p class="vehicle__note" data-out="car-note" id="drive-note"></p>
      <div class="vehicle__custom">
        <span class="vehicle__hint" data-out="custom-state" role="status"></span>
        <button type="button" class="btn btn--small" data-control="factory-reset" title="Eigene Änderungen an diesem Fahrzeug verwerfen">Auf Werkszustand zurücksetzen</button>
      </div>
      <div class="vehicle__setup" data-slot="vehicle-setup"></div>
      <label class="gearbox__field vehicle__load" data-out="load-row" hidden><span>Beladung</span>
        <input type="range" min="0" max="100" step="5" data-control="load" aria-describedby="load-out" />
        <output class="num" id="load-out" data-out="load"></output>
      </label>
      <div class="vehicle__grid">
        ${FIELDS.map((f) => `
          <label class="vehicle__num"><span>${f.label}</span>
            <input type="number" inputmode="decimal" data-field="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" />
            <small>${f.unit}</small>
          </label>`).join("")}
        <label class="vehicle__num vehicle__num--wide"><span>Angetriebene Achse</span>
          <select data-control="drive-layout">${(Object.keys(LAYOUT_LABEL) as DriveLayout[])
            .map((k) => `<option value="${k}">${LAYOUT_LABEL[k]}</option>`).join("")}</select>
        </label>
      </div>
      <div class="vehicle__grid vehicle__grid--tyre">
        <label class="vehicle__num vehicle__num--wide"><span>Reifen</span>
          <select data-control="tyre">${(Object.keys(TYRE_TYPES) as TyreType[])
            .map((k) => `<option value="${k}">${TYRE_TYPES[k].label}</option>`).join("")}</select>
        </label>
        <label class="vehicle__num"><span>Index</span>
          <select data-control="speed-index">${INDEX_CHOICES
            .map((k) => `<option value="${k}">${k}</option>`).join("")}</select>
        </label>
        <div class="vehicle__size" data-out="tyre-picker"></div>
      </div>
      <p class="vehicle__tyre num" data-out="tyre" id="tyre-size-help"></p>
      <p class="vehicle__hint" data-out="tyre-hint"></p>`;
    this.el = el;
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    this.carSel = q("[data-control=car]");
    this.driveSel = q("[data-control=drive]");
    this.fillDrives();
    // own engines may have been added in the Engine Builder, an E-Tuner setup since the last look
    this.driveSel.addEventListener("focus", () => this.fillDrives());
    this.driveSel.addEventListener("change", () => this.swapDrive(this.driveSel.value));
    this.loadBtn = q("[data-control=load-car]");
    this.layoutSel = q("[data-control=drive-layout]");
    this.kindSel = q("[data-control=vehicle]");
    this.resetBtn = q("[data-control=factory-reset]");
    this.customOut = q("[data-out=custom-state]");
    this.setupSlot = q("[data-slot=vehicle-setup]");
    this.tyreSel = q("[data-control=tyre]");
    // tyre size from three lists (no free text): Breite / Querschnitt R Zoll, lists per vehicle class
    this.sizePicker = new TyreSizePicker({ cls: tyreClassOf(drivetrain.kind), value: drivetrain.tyre.size, describedBy: "tyre-size-help" });
    q("[data-out=tyre-picker]").append(this.sizePicker.el);
    this.indexSel = q("[data-control=speed-index]");
    this.tyreOut = q("[data-out=tyre]");
    this.tyreHint = q("[data-out=tyre-hint]");
    this.carNote = q("[data-out=car-note]");
    this.loadRow = q("[data-out=load-row]");
    this.loadInput = q("[data-control=load]");
    this.loadOut = q("[data-out=load]");
    // load of trucks and buses (issue #31): empty … gross mass, only at standstill
    this.loadInput.addEventListener("input", () => {
      if (this.moving) return this.sync();
      this.drivetrain.setLoad(Number(this.loadInput.value) / 100);
      this.remember();
      this.sync();
      this.onChange();
    });
    for (const f of FIELDS) this.inputs.set(f.key, q(`[data-field=${f.key}]`));

    for (const f of FIELDS) {
      const input = this.inputs.get(f.key)!;
      input.addEventListener("change", () => this.applyField(f, input));
    }
    this.layoutSel.addEventListener("change", () => this.edit({ driveLayout: this.layoutSel.value as DriveLayout }));
    this.tyreSel.addEventListener("change", () => this.editTyre({ type: this.tyreSel.value as TyreType }));
    this.indexSel.addEventListener("change", () => this.editTyre({ speedIndex: this.indexSel.value as SpeedIndex }));
    this.sizePicker.onChange = (size) => this.editTyre({ size });
    this.loadBtn.addEventListener("click", () => this.loadSelected());
    this.kindSel.addEventListener("change", () => this.selectKind(this.kindSel.value as VehicleKind));
    this.resetBtn.addEventListener("click", () => this.resetFactory());
    // the start vehicle (generic car): its own changes of the last visit come back
    this.load(() => {}, "", this.drivetrain.kind, `preset:${this.drivetrain.kind}`);
    this.factory = () => this.presetFactory("car");
    this.sync();
  }

  /** Factory state of a vehicle-kind preset (Fahrzeugtyp): the car gets the default governor back. */
  private presetFactory(kind: VehicleKind) {
    this.drivetrain.setVehicle(kind);
    if (kind === "car") this.drivetrain.setSpeedLimit(DEFAULT_SPEED_LIMIT_KMH);
  }

  /** Loads a vehicle: factory state, then its own stored changes. */
  private load(factory: () => void, id: string, kind: VehicleKind, sig?: string) {
    this.loadedId = id;
    this.factory = factory;
    this.sig = sig;
    this.carSel.value = id;
    // the key of the vehicle being loaded (the drivetrain still has the previous kind until the factory ran)
    const r = loadVehicle(this.drivetrain, factory, vehicleKey(id, kind), sig);
    this.custom = r.custom;
    this.failedNote = r.failed.length ? `Gespeicherte Änderung nicht übernommen: ${r.failed.join(", ")}.` : "";
  }
  private failedNote = "";

  /** Fahrzeugtyp: the preset of that kind ("eigenes Fahrzeug"), with its own changes of the last visit. */
  selectKind(kind: VehicleKind) {
    if (this.moving) return this.sync();
    this.driveId = "";
    this.driven = null;
    this.load(() => this.presetFactory(kind), "", kind, `preset:${kind}`);
    this.carNote.textContent = "";
    this.sync();
    this.onChange();
  }

  /** Stores the vehicle as it is now as its own changes (after any edit here, in the gearbox section or the cooler). */
  remember() {
    this.custom = true;
    saveCustom(this.vehicleKey, captureCustom(this.drivetrain, this.sig));
    this.failedNote = "";
    this.syncCustom();
  }

  /** "Auf Werkszustand zurücksetzen": forgets the own changes of the loaded vehicle and loads it as delivered. */
  resetFactory() {
    if (this.moving) return;
    const car = VEHICLE_LIBRARY.find((c) => c.id === this.loadedId);
    // a swapped drive (#154) goes back too: the factory engine onto the bench first
    if (car && this.driveId) {
      if (!this.onLoadCar(car)) return;
      saveDriveChoice(this.vehicleKey, "");
      clearEvTuning(this.driven!.id);
      return this.applyCar(car, "");
    }
    clearCustom(this.vehicleKey);
    // the E-Tuner setup of an electric car (#108) belongs to its own changes too
    clearEvTuning(this.loadedId);
    this.load(this.factory, this.loadedId, this.drivetrain.kind, this.sig);
    this.sync();
    this.onChange();
  }

  private syncCustom() {
    const car = VEHICLE_LIBRARY.find((c) => c.id === this.loadedId);
    const who = car ? car.name : "Eigenes Fahrzeug";
    this.customOut.textContent = this.failedNote || (this.custom ? `${who}: eigene Änderungen (nur für dieses Fahrzeug gespeichert).` : `${who}: Werkszustand.`);
    this.resetBtn.disabled = this.moving || !(this.custom || this.driveId);
  }

  private loadSelected() {
    const id = this.carSel.value;
    const car = VEHICLE_LIBRARY.find((c) => c.id === id);
    if (!car || this.moving) return;
    if (!this.onLoadCar(carWithDrive(car, loadDriveChoice(car.id)))) {
      this.carNote.textContent = "Erst den Motor abstellen, dann lässt sich ein fertiges Fahrzeug laden.";
      return;
    }
    this.applyCar(car);
  }

  /** Options of the Antrieb select (own engines and E-Tuner setups change while the page is open). */
  private fillDrives() {
    this.driveSel.innerHTML = driveOptionsHtml();
    this.driveSel.value = this.driveId;
    if (this.driveSel.value !== this.driveId) this.driveSel.value = "";
  }

  /**
   * Antrieb (#154): puts another drive into the loaded library vehicle at standstill; mass and transmission follow,
   * the parts of the old drive are dropped from the own changes, the choice is stored per vehicle.
   */
  swapDrive(id: string): boolean {
    const car = VEHICLE_LIBRARY.find((c) => c.id === this.loadedId);
    if (!car || this.moving || id === this.driveId) return this.sync(), false;
    const next = carWithDrive(car, id);
    if (id && next === car) return this.sync(), false;
    if (!this.onLoadCar(next)) {
      this.carNote.textContent = "Erst den Motor abstellen, dann lässt sich der Antrieb tauschen.";
      this.sync();
      return false;
    }
    saveDriveChoice(this.vehicleKey, id);
    forgetDriveParts(this.vehicleKey);
    this.applyCar(car, id);
    return true;
  }

  /**
   * A production engine was loaded on the bench: picks the car that engine came in (first match in the
   * vehicle library) and sets its gearbox, body and tyres. The engine itself is already loaded.
   */
  selectCarForEngine(engineId: string): LibraryCar | null {
    const car = VEHICLE_LIBRARY.find((c) => c.engineId === engineId);
    if (!car || this.moving) return null;
    // the engine picked on the bench is this car's factory engine: the car comes with its factory drive
    if (loadDriveChoice(car.id)) {
      saveDriveChoice(car.id, "");
      forgetDriveParts(car.id);
    }
    this.applyCar(car, "");
    return car;
  }

  /** Guided start (#93): loads a library vehicle by id (its engine is loaded by the app), optionally with a drive (#154). */
  selectCar(id: string, driveId?: string): LibraryCar | null {
    const car = VEHICLE_LIBRARY.find((c) => c.id === id);
    if (!car || this.moving) return null;
    if (driveId !== undefined && driveId !== loadDriveChoice(car.id)) {
      saveDriveChoice(car.id, driveId);
      forgetDriveParts(car.id);
    }
    this.applyCar(car);
    return car;
  }

  /** Guided start (#93): an own vehicle built in the wizard ("eigenes Fahrzeug", like any own edit). */
  applyOwn(setup: CarSetup): boolean {
    if (this.moving || !VehiclePanel.withinLimits(setup)) return false;
    this.driveId = "";
    this.driven = null;
    // own changes come back only on the same own vehicle (a newly built one starts as built)
    this.load(() => this.drivetrain.applyCar(structuredClone(setup)), "", setup.kind ?? "car", setupSig(setup));
    this.carNote.textContent = "";
    this.sync();
    this.onChange();
    return true;
  }

  /** An own vehicle must stay inside the panel's own field limits (mass, cW, area, tank). */
  static withinLimits(setup: CarSetup): boolean {
    const v = setup.vehicle;
    const values: Partial<Record<NumField["key"], number | undefined>> = { mass: v.massKg, cw: v.dragCoefficient, area: v.frontalAreaM2, tank: setup.tankL };
    return FIELDS.every((f) => {
      const n = values[f.key];
      return n === undefined || (Number.isFinite(n) && n >= f.min && n <= f.max);
    });
  }

  private applyCar(car: LibraryCar, driveId = loadDriveChoice(car.id)) {
    const driven = carWithDrive(car, driveId);
    this.driveId = driven === car ? "" : driveId;
    this.driven = driven;
    this.load(() => this.drivetrain.applyCar(structuredClone(driven.setup)), car.id, car.setup.kind ?? "car");
    const f = car.factory;
    this.carNote.textContent = f.t0to100S === null
      ? `${car.name}: Vmax ${spd(f.vmaxKmh)}${f.vmaxGoverned ? " (abgeregelt)" : ""}, leer ${fmt(f.kerbKg, 0)} kg${f.grossKg ? `, zulässig ${fmt(f.grossKg, 0)} kg` : ""}.`
      : `${car.name}: Werk ${fmt(f.t0to100S, 1)} s ${prefs().speed === "mph" ? "von 0 auf 62 mph (100 km/h, Werksangabe)" : "von 0 auf 100 km/h"}, Vmax ${spd(f.vmaxKmh)}${f.vmaxGoverned ? " (abgeregelt)" : ""}, ${f.kerbKg} kg (${f.kerbNorm === "wet" ? "fahrbereit, ohne Fahrer" : f.kerbNorm}).`;
    if (this.driveId) {
      this.fillDrives();
      const name = this.driveSel.selectedOptions[0]?.textContent ?? this.driveId;
      const sp = driven.setup.ev ? `Untersetzung ${fmt(driven.setup.ev.motors[0]!.ratio, 1)}:1` : `Achsübersetzung ${fmt(driven.setup.gearboxSpec?.finalDrive ?? 0, 2)}`;
      this.carNote.textContent = `${car.name} mit Antrieb ${name}: ${fmt(driven.setup.vehicle.massKg, 0)} kg mit Fahrer (Werk ${fmt(car.setup.vehicle.massKg, 0)} kg), ${sp}.`;
    }
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
    this.remember();
    this.sync();
    this.onChange();
  }

  private editTyre(p: Partial<TyreSetup>) {
    if (this.moving) return this.sync();
    this.drivetrain.setTyre({ ...this.drivetrain.tyre, ...p });
    this.remember();
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
    const load = this.drivetrain.load;
    this.loadRow.hidden = load === null;
    if (load) {
      this.loadInput.value = String(Math.round(load.share * 100));
      const word = load.share <= 0.001 ? "leer" : load.share >= 0.999 ? "voll" : `${Math.round(load.share * 100)} %`;
      this.loadOut.textContent = `${word} · ${fmt(v.massKg, 0)} kg`;
    }
    // motorcycles drive the rear wheel; the layout is fixed there
    const bike = isMotorcycleKind(this.drivetrain.kind);
    this.kindSel.value = this.drivetrain.kind;
    this.driveSel.value = this.driveId;
    this.layoutSel.value = v.driveLayout ?? "fwd";
    this.layoutSel.dataset.fixed = bike ? "1" : "";
    this.tyreSel.value = t.type;
    this.sizePicker.setValue(t.size, tyreClassOf(this.drivetrain.kind));
    this.indexSel.value = t.speedIndex;
    this.tyreOut.textContent = `Reifenfreigabe bis ${t.speedIndex === "(Y)" ? `über ${spd(300)}` : spd(speedRatingKmh(t.speedIndex))}.`;
    this.lastTemp = "";
    this.updateTyreHint();
    this.setLocked(this.moving);
    this.syncCustom();
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
    const bike = isMotorcycleKind(this.drivetrain.kind);
    for (const c of this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
      // the Vmax governor (slot) can be recoded while driving (issue #32); the Getriebe-Pult locks what it owns
      if (this.setupSlot.contains(c)) continue;
      c.disabled = moving || (c === this.layoutSel && bike) || (c === this.resetBtn && !(this.custom || this.driveId)) || (c === this.driveSel && !this.loadedId);
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
