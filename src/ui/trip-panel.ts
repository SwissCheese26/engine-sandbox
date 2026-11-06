// Bordcomputer (#40, #41): odometer "Gesamt" (not resettable) and "Trip A" (resettable), each with distance
// and average consumption; trip A also average speed and driving time. Shown quietly under the gearbox
// readouts on the chassis dyno. Data persists per browser (localStorage, best effort).
import { TripComputer, averageKmh, averageL100 } from "../core/index.ts";
import type { EngineState, TripCounter } from "../core/index.ts";

const KEY = "pruefzelle.tripcomputer";
const SAVE_EVERY_S = 2;

const nf = (d: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const f0 = nf(0);
const f1 = nf(1);

function fmtKm(km: number): string {
  // odometer style: whole km for the total, one decimal below 1000 km for the trip
  return km < 1000 ? f1.format(km) : f0.format(km);
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

  constructor() {
    this.computer = TripPanel.load();
    const el = document.createElement("section");
    el.className = "trip";
    el.setAttribute("aria-label", "Bordcomputer");
    el.innerHTML = `
      <dl class="trip__grid">
        <div class="trip__col">
          <dt>Gesamt</dt>
          <dd class="num"><span data-trip="total-km">0</span> km</dd>
          <dd class="num trip__sub">Ø <span data-trip="total-avg">–</span> l/100 km</dd>
        </div>
        <div class="trip__col">
          <dt>Trip A</dt>
          <dd class="num"><span data-trip="a-km">0</span> km</dd>
          <dd class="num trip__sub">Ø <span data-trip="a-avg">–</span> l/100 km · Ø <span data-trip="a-speed">–</span> km/h · <span data-trip="a-time">0 min</span></dd>
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
    addEventListener("pagehide", () => this.save());
    this.render(true);
  }

  /** Per frame on the chassis dyno. */
  step(dt: number, s: EngineState, driving: boolean) {
    this.computer.step(dt, s, driving);
    this.sinceSave += dt;
    if (this.sinceSave >= SAVE_EVERY_S) {
      this.sinceSave = 0;
      this.save();
    }
    this.render(false);
  }

  private render(force: boolean) {
    const { total, tripA } = this.computer.data;
    const avg = (c: TripCounter) => {
      const v = averageL100(c);
      return Number.isFinite(v) ? f1.format(v) : "–";
    };
    const sp = averageKmh(tripA);
    const vals: Record<string, string> = {
      "total-km": f0.format(Math.floor(total.km)),
      "total-avg": avg(total),
      "a-km": fmtKm(tripA.km),
      "a-avg": avg(tripA),
      "a-speed": Number.isFinite(sp) ? f0.format(sp) : "–",
      "a-time": fmtTime(tripA.timeS),
    };
    for (const k in vals) {
      if (force || this.last[k] !== vals[k]) {
        this.out[k]!.textContent = vals[k]!;
        this.last[k] = vals[k]!;
      }
    }
  }

  save() {
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
