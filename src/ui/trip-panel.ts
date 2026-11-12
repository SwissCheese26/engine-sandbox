// Bordcomputer (#40, #41): odometer "Gesamt" (not resettable) and "Trip A" (resettable), each with distance
// and average consumption; trip A also average speed and driving time. Shown quietly under the gearbox
// readouts on the chassis dyno. Data persists per browser (localStorage, best effort).
import { TripComputer, averageKmh, averageL100 } from "../core/index.ts";
import type { EngineState, TripCounter } from "../core/index.ts";
import { getSettings, prefs } from "./settings.ts";
import { toUnit } from "./units.ts";

const KEY = "pruefzelle.tripcomputer";
const SAVE_EVERY_S = 2;

const nf = (d: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const f0 = nf(0);
const f1 = nf(1);

function fmtKm(km: number): string {
  // trip display: one decimal below 1000 km, whole km above (the total always shows whole km)
  return km < 1000 ? f1.format(km) : f0.format(km);
}

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Fuel cost (#66): € per 100 distance units (NaN below the minimum distance, like the average) and € for the
 *  counter. unitsPerKm: display distance units per km (1 for km, 0,621… for mi), so the label "je 100 mi" is true. */
export function tripCosts(c: TripCounter, priceEurL: number, unitsPerKm = 1): { per100: number; trip: number } {
  return { per100: (averageL100(c) * priceEurL) / unitsPerKm, trip: c.fuelL * priceEurL };
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

export class TripPanel {
  readonly el: HTMLElement;
  readonly computer: TripComputer;
  private out: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private sinceSave = 0;
  private dirty = false;
  private abort = new AbortController();
  /** Fuel of the engine on the dyno: picks the price from the settings. */
  private fuel: "diesel" | "petrol" = "diesel";

  constructor() {
    this.computer = TripPanel.load();
    const el = document.createElement("section");
    el.className = "trip";
    el.setAttribute("aria-label", "Bordcomputer");
    el.innerHTML = `
      <dl class="trip__grid">
        <div class="trip__col">
          <dt>Gesamt</dt>
          <dd class="num"><span data-trip="total-km">0</span> <span data-u="distance">km</span></dd>
          <dd class="num trip__sub"><abbr title="Durchschnitt">Ø</abbr> <span data-trip="total-avg">–</span> <span data-u="fuel">l/100 km</span></dd>
        </div>
        <div class="trip__col">
          <dt>Trip A</dt>
          <dd class="num"><span data-trip="a-km">0</span> <span data-u="distance">km</span></dd>
          <dd class="num trip__sub"><abbr title="Durchschnitt">Ø</abbr> <span data-trip="a-avg">–</span> <span data-u="fuel">l/100 km</span> · <abbr title="Durchschnitt">Ø</abbr> <span data-trip="a-speed">–</span> <span data-u="speed">km/h</span> · <span data-trip="a-time">0 min</span></dd>
          <dd class="num trip__sub trip__cost">Kosten <span data-trip="a-cost100">–</span> <span data-trip="cost-unit">je 100 km</span> · <span data-trip="a-cost">0,00 €</span> <span class="trip__price" data-trip="price"></span></dd>
        </div>
      </dl>
      <button type="button" class="btn btn--small trip__reset" data-control="trip-reset">Trip A zurücksetzen</button>`;
    this.el = el;
    el.querySelectorAll<HTMLElement>("[data-trip]").forEach((n) => (this.out[n.dataset.trip!] = n));
    el.querySelector('[data-control="trip-reset"]')!.addEventListener("click", () => {
      this.computer.resetTripA();
      this.save();
      this.render(true);
    });
    const signal = this.abort.signal;
    addEventListener("pagehide", () => this.save(), { signal });
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && this.save(), { signal });
    this.syncUnits();
  }

  /** Distance, consumption and speed in the globally chosen units (#24); the counters stay in km and litres. */
  syncUnits() {
    const p = prefs();
    this.el.querySelectorAll<HTMLElement>("[data-u]").forEach((n) => (n.textContent = p[n.dataset.u as "distance" | "fuel" | "speed"]));
    this.render(true);
  }

  /** Fuel of the engine on the dyno (the price differs for diesel and petrol). */
  setFuel(fuel: "diesel" | "petrol") {
    this.fuel = fuel;
    this.render(true);
  }

  /** Per frame on the chassis dyno. */
  step(dt: number, s: EngineState, driving: boolean) {
    const before = this.computer.data.total.timeS;
    this.computer.step(dt, s, driving);
    if (this.computer.data.total.timeS !== before) this.dirty = true;
    this.sinceSave += dt;
    if (this.sinceSave >= SAVE_EVERY_S) {
      this.sinceSave = 0;
      // only write when something was counted since the last save
      if (this.dirty) this.save();
    }
    this.render(false);
  }

  private render(force: boolean) {
    const { total, tripA } = this.computer.data;
    const avg = (c: TripCounter) => {
      const v = toUnit("fuel", averageL100(c));
      return Number.isFinite(v) ? f1.format(v) : "–";
    };
    const sp = toUnit("speed", averageKmh(tripA));
    const vals: Record<string, string> = {
      "total-km": f0.format(Math.floor(toUnit("distance", total.km))),
      "total-avg": avg(total),
      "a-km": fmtKm(toUnit("distance", tripA.km)),
      "a-avg": avg(tripA),
      "a-speed": Number.isFinite(sp) ? f0.format(sp) : "–",
      "a-time": fmtTime(tripA.timeS),
      ...this.costs(),
    };
    for (const k in vals) {
      if (force || this.last[k] !== vals[k]) {
        this.out[k]!.textContent = vals[k]!;
        this.last[k] = vals[k]!;
      }
    }
  }

  private costs(): Record<string, string> {
    const price = getSettings().fuelPrice[this.fuel];
    const c = tripCosts(this.computer.data.tripA, price, toUnit("distance", 1));
    return {
      "a-cost100": Number.isFinite(c.per100) ? eur.format(c.per100) : "–",
      "a-cost": eur.format(c.trip),
      "cost-unit": `je 100 ${prefs().distance}`,
      price: `(${this.fuel === "diesel" ? "Diesel" : "Benzin"} ${eur.format(price)}/l)`,
    };
  }

  /** Saves once more and removes the page listeners (App.dispose). */
  dispose() {
    this.save();
    this.abort.abort();
  }

  save() {
    this.dirty = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.computer.toJSON()));
    } catch {
      /* storage unavailable: counters last for this visit */
    }
  }

  private static load(): TripComputer {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? TripComputer.fromJSON(JSON.parse(raw)) : new TripComputer();
    } catch {
      return new TripComputer();
    }
  }
}
