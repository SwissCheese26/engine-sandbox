// Energiefluss-Anzeige of a hybrid (issue #157): engine → wheels, battery ↔ motor, engine → battery (generator),
// wheels → battery (regen), with fuel, state of charge and the EV lamp. One component for every cockpit design and
// the Prüfzelle; 4 arrows as inline SVG (stroke = currentColor), states as data attributes, styled in layouts.css.
import type { HybridState } from "../../core/index.ts";
import { fmt } from "../format.ts";

/** Which arrows carry power now (threshold 0.5 kW). Pure, for tests. */
export function flowArrows(hy: HybridState): { engWheel: boolean; engBat: boolean; batMot: "fwd" | "rev" | "off"; motWheel: "fwd" | "rev" | "off" } {
  const on = 0.5;
  const charging = hy.batteryKw < -on;
  const regen = charging && hy.wheelKw < -on;
  return {
    engWheel: hy.engineOn && hy.engineToWheelKw > on,
    engBat: hy.engineOn && charging && !regen,
    batMot: hy.batteryKw > on ? "fwd" : charging ? "rev" : "off",
    motWheel: hy.motorKw > on ? "fwd" : hy.motorKw < -on && regen ? "rev" : "off",
  };
}

export class HybridFlow {
  readonly el: HTMLElement;
  private out: Record<string, HTMLElement | SVGElement> = {};
  private last: Record<string, string> = {};

  constructor() {
    const el = document.createElement("div");
    el.className = "hyflow";
    el.hidden = true;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Energiefluss");
    el.innerHTML = `
      <svg class="hyflow__svg" viewBox="0 0 220 64" aria-hidden="true">
        <text x="4" y="14" class="hyflow__node" data-n="eng">Verbrenner</text>
        <text x="216" y="14" text-anchor="end" class="hyflow__node" data-n="wheel">Räder</text>
        <text x="4" y="58" class="hyflow__node" data-n="bat">Akku</text>
        <text x="216" y="58" text-anchor="end" class="hyflow__node" data-n="mot">E-Motor</text>
        <path data-a="eng-wheel" d="M70 10 H170" />
        <path data-a="eng-bat" d="M24 20 V42" />
        <path data-a="bat-mot" d="M40 54 H160" />
        <path data-a="mot-wheel" d="M200 42 V20" />
      </svg>
      <p class="hyflow__row num">
        <span class="hyflow__ev" data-hy="ev" data-state="off">EV</span>
        <span>Tank <b data-hy="tank">–</b></span>
        <span>Akku <b data-hy="soc">–</b></span>
        <span data-hy="eng">–</span>
      </p>
      <p class="sr-only" aria-live="off" data-hy="text"></p>`;
    el.querySelectorAll<HTMLElement>("[data-hy]").forEach((n) => (this.out[n.dataset.hy!] = n));
    el.querySelectorAll<SVGElement>("[data-a]").forEach((n) => (this.out[n.dataset.a!] = n));
    this.el = el;
  }

  setShown(on: boolean) {
    this.el.hidden = !on;
  }

  private put(k: string, v: string) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.out[k]!.textContent = v;
  }

  private state(k: string, v: string) {
    if (this.last[`@${k}`] === v) return;
    this.last[`@${k}`] = v;
    this.out[k]!.dataset.state = v;
  }

  /** `tankL`: fuel left, litres (NaN: not known, the fuel flow is shown instead). */
  update(hy: HybridState, soc: number, tankL: number) {
    const a = flowArrows(hy);
    this.state("eng-wheel", a.engWheel ? "on" : "off");
    this.state("eng-bat", a.engBat ? "on" : "off");
    this.state("bat-mot", a.batMot);
    this.state("mot-wheel", a.motWheel);
    this.state("ev", hy.evDrive ? "on" : "off");
    this.el.dataset.engine = hy.engineOn ? "on" : hy.engineStarting ? "start" : "off";
    this.put("tank", Number.isFinite(tankL) ? `${fmt(tankL, 1)} l` : `${fmt(hy.fuelLh, 1)} l/h`);
    this.put("soc", `${fmt(Math.round(soc * 100))} %`);
    this.put("eng", hy.engineOn ? `Motor ${fmt(Math.round(hy.engineKw))} kW` : hy.engineStarting ? "Motor startet" : "Motor aus");
    const words = [a.engWheel && "Verbrenner treibt die Räder", a.engBat && "Verbrenner lädt den Akku", a.batMot === "fwd" && "Akku treibt den E-Motor", a.motWheel === "rev" && "Rekuperation"].filter(Boolean);
    this.put("text", words.length ? words.join(", ") : "kein Energiefluss");
  }
}
