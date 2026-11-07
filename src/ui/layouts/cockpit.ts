// Cockpit / Kombiinstrument (#26): speedometer and rev counter as round dials with needles, a centre display (gear,
// digital speed, outside temperature, board computer, cruise control), five small instruments and the warning-lamp
// strip. Built for the chassis dyno; on the engine dyno the speedometer rests and reads "–".
import type { EngineConfig, EngineSummary } from "../../core/index.ts";
import { fmt } from "../format.ts";
import { prefs } from "../settings.ts";
import { toUnit } from "../units.ts";
import { Dial, type DialScale } from "./dial.ts";
import { BASE_ICON, ICON2 } from "./icons.ts";
import { avgL100, clusterLamps, limitZoneRpm, speedoMax, speedoTicks, tachoMax, type Lamp, type LampSet } from "./logic.ts";
import type { DriveInfo, Frame, LayoutView } from "./view.ts";

type LampKey = keyof LampSet;
const LAMPS: { k: LampKey; color: "red" | "amber" | "ice"; icon: string; on: string; text?: string }[] = [
  { k: "battery", color: "red", icon: ICON2.battery, on: "Ladekontrolle: Lichtmaschine lädt nicht" },
  { k: "oil", color: "red", icon: ICON2.oil, on: "Öldruck zu niedrig" },
  { k: "coolant", color: "red", icon: ICON2.coolant, on: "Kühlmittel zu heiß" },
  { k: "engine", color: "amber", icon: ICON2.engine, on: "Motorkontrollleuchte" },
  { k: "glow", color: "amber", icon: ICON2.glow, on: "Vorglühen: Starter erst nach dem Erlöschen" },
  { k: "abs", color: "amber", icon: BASE_ICON.abs, on: "ABS" },
  { k: "esp", color: "amber", icon: BASE_ICON.esp, on: "ESP/ASR greift ein" },
  { k: "espOff", color: "amber", icon: BASE_ICON.esp, on: "ESP OFF", text: "OFF" },
  { k: "ice", color: "ice", icon: BASE_ICON.ice, on: "Glättegefahr" },
];

const airCooled = (c: EngineConfig) => c.cooling.type === "air" || c.cooling.type === "oil-air";

interface Mini {
  id: string;
  dial: Dial;
  out: HTMLElement;
  unit: HTMLElement;
  cap: HTMLElement;
  wrap: HTMLElement;
  last: string;
}

export class CockpitView implements LayoutView {
  readonly el: HTMLElement;
  private speedo: Dial;
  private tacho: Dial;
  private minis: Record<"coolant" | "oilT" | "oilP" | "boost" | "fuel", Mini>;
  private lampEls = new Map<LampKey, HTMLElement>();
  private lastLamps = "";
  private out: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private cfg!: EngineConfig;
  private summary!: EngineSummary;
  private info!: DriveInfo;
  private speedMax = 0;
  /** Set by the app: switches the console to the chassis dyno. */
  onWantVehicle: () => void = () => {};

  constructor() {
    const el = document.createElement("section");
    el.className = "ck";
    el.setAttribute("aria-label", "Kombiinstrument");
    el.innerHTML = `
      <div class="ck__lamps" role="group" aria-label="Kontrollleuchten">
        ${LAMPS.map((l) => `<span class="ck-lamp ck-lamp--${l.color}" data-lamp="${l.k}" data-state="off" role="img" aria-label="${l.on}: aus">${l.icon}${l.text ? `<b>${l.text}</b>` : ""}</span>`).join("")}
      </div>
      <div class="ck__main">
        <div class="ck__dial ck__dial--speed" data-slot="speed">
          <p class="ck__read num" aria-live="off"><span data-ck="speed">–</span> <small data-ck="speed-unit">km/h</small></p>
        </div>
        <div class="ck__mfd" role="group" aria-label="Mitteldisplay">
          <p class="ck__gear num"><span class="sr-only">Gang </span><span data-ck="gear">N</span></p>
          <p class="ck__speed num"><span data-ck="speed-big">–</span><small data-ck="speed-unit2">km/h</small></p>
          <p class="ck__dyno" data-ck="dyno" hidden>Motorprüfstand: kein Tempo.
            <button type="button" class="ck__btn" data-ck="to-vehicle">Auf die Rolle</button></p>
          <p class="ck__cruise num" data-ck="cruise" data-state="off" hidden>${ICON2.cruise}<span data-ck="cruise-text"></span></p>
          <dl class="ck__trip num">
            <div><dt>Außen</dt><dd><span data-ck="ambient">–</span></dd></div>
            <div><dt>Gesamt</dt><dd><span data-ck="total">0</span></dd></div>
            <div><dt>Trip A</dt><dd><span data-ck="trip">0</span></dd></div>
            <div><dt><abbr title="Durchschnittsverbrauch Trip A">Ø</abbr></dt><dd><span data-ck="avg">–</span></dd></div>
          </dl>
        </div>
        <div class="ck__dial ck__dial--rpm" data-slot="rpm">
          <p class="ck__read num" aria-live="off"><span data-ck="rpm">0</span> <small>1/min</small></p>
        </div>
      </div>
      <div class="ck__minis"></div>`;
    this.el = el;
    el.querySelectorAll<HTMLElement>("[data-ck]").forEach((n) => (this.out[n.dataset.ck!] = n));
    el.querySelectorAll<HTMLElement>("[data-lamp]").forEach((n) => this.lampEls.set(n.dataset.lamp as LampKey, n));
    this.out["to-vehicle"]!.addEventListener("click", () => this.onWantVehicle());

    const blank: DialScale = { min: 0, max: 100, major: 20, minor: 10, caption: "" };
    this.speedo = new Dial(blank, { label: "Tacho" });
    this.tacho = new Dial(blank, { label: "Drehzahlmesser" });
    el.querySelector("[data-slot=speed]")!.prepend(this.speedo.canvas);
    el.querySelector("[data-slot=rpm]")!.prepend(this.tacho.canvas);

    const host = el.querySelector(".ck__minis")!;
    const mk = (id: string): Mini => {
      const wrap = document.createElement("figure");
      wrap.className = "ck-mini";
      wrap.dataset.mini = id;
      const dial = new Dial(blank, { small: true, label: id });
      wrap.innerHTML = `<figcaption><span class="ck-mini__cap"></span> <b class="num ck-mini__val">–</b> <small class="ck-mini__unit"></small></figcaption>`;
      wrap.prepend(dial.canvas);
      host.append(wrap);
      return { id, dial, wrap, out: wrap.querySelector(".ck-mini__val")!, unit: wrap.querySelector(".ck-mini__unit")!, cap: wrap.querySelector(".ck-mini__cap")!, last: "" };
    };
    this.minis = { coolant: mk("coolant"), oilT: mk("oil-temp"), oilP: mk("oil-pressure"), boost: mk("boost"), fuel: mk("fuel") };
  }

  configure(cfg: EngineConfig, summary: EngineSummary, info: DriveInfo) {
    this.cfg = cfg;
    this.summary = summary;
    this.info = info;
    const rmax = tachoMax(cfg.revLimitRpm);
    this.tacho.setScale({
      min: 0, max: rmax, major: 1000, minor: rmax > 9000 ? 500 : 250, labelDiv: 1000,
      zone: { from: limitZoneRpm(cfg.revLimitRpm, summary.safeMaxRpm), to: rmax }, caption: "1/min × 1000",
    });
    this.speedMax = 0;
    this.syncUnits();
  }

  syncUnits() {
    if (!this.cfg) return;
    const u = prefs();
    const T = (c: number) => toUnit("temp", c, u.temp);
    const P = (b: number) => toUnit("pressure", b, u.pressure);
    const L = this.summary.limits;
    const air = airCooled(this.cfg);
    const hot = air ? 300 : 130;
    const tScale = (lo: number, hi: number, zone: number): DialScale => {
      const a = T(lo);
      const b = T(hi);
      const step = (b - a) / 4;
      return { min: a, max: b, major: step, minor: step / 2, zone: { from: T(zone), to: b }, caption: u.temp };
    };
    this.setMini("coolant", air ? "Zyl.-Kopf" : "Kühlmittel", u.temp, tScale(air ? 60 : 50, hot, Math.min(hot, air ? 220 : L.coolantMaxC)));
    this.setMini("oilT", "Öl", u.temp, tScale(50, 150, Math.min(150, L.oilMaxC)));
    const pMax = P(6);
    this.setMini("oilP", "Öldruck", u.pressure, { min: 0, max: pMax, major: pMax / 3, minor: pMax / 6, zone: { from: 0, to: P(L.oilPressureMinBar) }, caption: u.pressure });
    const turbo = L.boostMaxBar > 0;
    this.minis.boost.wrap.hidden = !turbo;
    if (turbo) {
      const bMax = P(Math.max(1, Math.ceil(L.boostMaxBar * 1.25 * 2) / 2));
      this.setMini("boost", "Ladedruck", u.pressure, { min: 0, max: bMax, major: bMax / 2, minor: bMax / 4, zone: { from: P(L.boostMaxBar), to: bMax }, caption: u.pressure });
    }
    // momentary consumption: l/100 km (or mpg) while driving, l/h at standstill like a real board computer
    this.setMini("fuel", "Verbrauch", u.fuel, { min: 0, max: 30, major: 10, minor: 5, caption: "l/100 km" });
    this.out["speed-unit"]!.textContent = this.out["speed-unit2"]!.textContent = u.speed;
    this.speedMax = 0;
    for (const k of Object.keys(this.last)) this.last[k] = "";
    for (const m of Object.values(this.minis)) m.last = "";
    this.lastLamps = "";
  }

  private setMini(k: keyof CockpitView["minis"], cap: string, unit: string, scale: DialScale) {
    const m = this.minis[k];
    m.cap.textContent = cap;
    m.unit.textContent = unit;
    m.dial.setScale(scale);
  }

  redraw() {
    for (const d of [this.speedo, this.tacho, ...Object.values(this.minis).map((m) => m.dial)]) {
      d.invalidate();
      d.draw(true);
    }
  }

  private put(k: string, v: string) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.out[k]!.textContent = v;
  }

  private mini(k: keyof CockpitView["minis"], shown: number, text: string, dt: number) {
    const m = this.minis[k];
    m.dial.set(shown, dt);
    if (m.last !== text) m.out.textContent = m.last = text;
  }

  update(f: Frame) {
    const { s, dt } = f;
    const u = prefs();
    const d = f.drivetrain;
    const ds = d.state;
    const vehicle = f.mode === "vehicle";
    // speed scale follows the car's top speed (a 300 km/h car gets a 320 dial, a city car 200)
    const vmaxShown = toUnit("speed", this.info.vmaxKmh, u.speed);
    const smax = speedoMax(vmaxShown, u.speed);
    if (smax !== this.speedMax) {
      this.speedMax = smax;
      const t = speedoTicks(smax, u.speed);
      this.speedo.setScale({ min: 0, max: smax, major: t.major, minor: t.minor, caption: u.speed });
    }
    const speed = vehicle ? toUnit("speed", ds.speedKmh, u.speed) : 0;
    this.speedo.dimmed = !vehicle;
    this.speedo.set(speed, dt);
    this.tacho.set(s.rpm, dt);
    const speedText = vehicle ? fmt(speed) : "–";
    this.put("speed", speedText);
    this.put("speed-big", speedText);
    this.put("rpm", fmt(Math.round(s.rpm / 10) * 10));
    this.put("gear", vehicle ? (ds.shifting && ds.type === "manual" ? "–" : d.gearLabel()) : "–");
    if (this.last.dyno !== String(vehicle)) {
      this.last.dyno = String(vehicle);
      this.out.dyno!.hidden = vehicle;
      this.el.classList.toggle("is-engine-dyno", !vehicle);
    }
    // board computer: odometer whole km, trip one decimal, average of trip A
    const { total, tripA } = f.trip;
    this.put("ambient", `${fmt(toUnit("temp", d.environment.ambientC, u.temp))} ${u.temp}`);
    this.put("total", `${fmt(Math.floor(toUnit("distance", total.km, u.distance)))} ${u.distance}`);
    this.put("trip", `${fmt(toUnit("distance", tripA.km, u.distance), 1)} ${u.distance}`);
    const avg = toUnit("fuel", avgL100(tripA.km, tripA.fuelL), u.fuel);
    this.put("avg", `${Number.isFinite(avg) ? fmt(avg, 1) : "–"} ${u.fuel}`);
    this.updateCruise(d);

    // small instruments
    const T = (c: number) => toUnit("temp", c, u.temp);
    const P = (b: number) => toUnit("pressure", b, u.pressure);
    const pd = u.pressure === "bar" ? 1 : 0;
    this.mini("coolant", T(s.coolantC), fmt(T(s.coolantC)), dt);
    this.mini("oilT", T(s.oilC), fmt(T(s.oilC)), dt);
    this.mini("oilP", P(s.oilPressureBar), fmt(P(s.oilPressureBar), pd), dt);
    if (!this.minis.boost.wrap.hidden) this.mini("boost", P(Math.max(0, s.boostBar)), fmt(P(Math.max(0, s.boostBar)), pd), dt);
    const kmh = vehicle ? ds.speedKmh : 0;
    const l100 = kmh > 5 && s.running ? (s.fuelFlowLh / kmh) * 100 : Number.NaN;
    const fuelUnit = kmh > 5 ? u.fuel : u.fuel === "mpg" ? "gal/h" : "l/h";
    if (this.minis.fuel.unit.textContent !== fuelUnit) this.minis.fuel.unit.textContent = fuelUnit;
    const fuelText = kmh > 5
      ? (Number.isFinite(toUnit("fuel", l100, u.fuel)) ? fmt(toUnit("fuel", l100, u.fuel), 1) : "–")
      : fmt(u.fuel === "mpg" ? s.fuelFlowLh / 3.785411784 : s.fuelFlowLh, 1);
    // needle: l/100 km while driving (clamped), l/h at standstill (same 0 … 30 scale, like many clusters)
    this.mini("fuel", Number.isFinite(l100) ? l100 : s.fuelFlowLh, fuelText, dt);

    this.updateLamps(f);
  }

  /** Tempomat and limiter (#30): set speed and state in the centre display, like the cruise line of a real MFD. */
  private updateCruise(d: Frame["drivetrain"]) {
    const c = d.state.cruise;
    const sp = (kmh: number) => `${fmt(toUnit("speed", kmh))} ${prefs().speed}`;
    let text = "";
    let state = "off";
    if (c?.limiterOn) {
      text = `Limiter ${sp(c.limitKmh)}${c.kickdown ? " · Kickdown" : c.limiting ? " · begrenzt" : ""}`;
      state = c.limiting ? "active" : "ready";
    } else if (c && c.setKmh !== null) {
      text = `Tempomat ${sp(c.setKmh)} · ${c.mode === "active" ? "aktiv" : c.mode === "override" ? "übersteuert" : "bereit"}`;
      state = c.mode === "off" ? "ready" : "active";
    }
    if (text === this.last.cruise && state === this.last.cruiseState) return;
    this.last.cruise = text;
    this.last.cruiseState = state;
    this.out["cruise-text"]!.textContent = text;
    this.out.cruise!.hidden = !text;
    this.out.cruise!.dataset.state = state;
  }

  private updateLamps(f: Frame) {
    const s = f.s;
    const d = f.drivetrain;
    const ds = d.state;
    const vehicle = f.mode === "vehicle";
    const a = ds.assists ?? d.assists;
    const set = clusterLamps({
      ignition: f.ignition,
      running: s.running,
      sinceIgnitionS: f.sinceIgnitionS,
      diesel: this.cfg.fuel === "diesel",
      coolantC: s.coolantC,
      coolantMaxC: airCooled(this.cfg) ? 220 : this.summary.limits.coolantMaxC,
      oilPressureBar: s.oilPressureBar,
      damaged: s.destroyed || s.damage.length > 0,
      warnings: s.warnings.map((w) => w.code),
      abs: vehicle ? { enabled: a.abs, active: !!ds.absActive } : undefined,
      esp: vehicle ? { esp: a.esp, asr: a.asr, active: !!(ds.asrActive || ds.espActive) } : undefined,
      ice: !!ds.iceWarning,
    });
    const key = Object.values(set).join("|");
    if (key === this.lastLamps) return;
    this.lastLamps = key;
    for (const l of LAMPS) {
      const st: Lamp = set[l.k];
      const n = this.lampEls.get(l.k)!;
      if (n.dataset.state === st) continue;
      n.dataset.state = st;
      n.setAttribute("aria-label", `${l.on}: ${st === "off" ? "aus" : st === "blink" ? "blinkt" : "an"}`);
    }
  }
}
