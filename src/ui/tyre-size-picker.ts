// Tyre size as three selects (Breite / Querschnitt R Zoll) instead of free text: shared by the Fahrzeug-Platte
// (vehicle-panel.ts) and the own-vehicle form of the guided start (sandbox-wizard.ts).
//
// Value lists per vehicle class follow the real ETRTO steps:
// - car: width 135–335 mm in 10 mm steps (ETRTO widths end in 5), aspect 25–80 % in 5 % steps, rim 13–22 inch;
// - motorcycle: real radial REAR sizes (rims 16/17/18), because the core models the driven rear wheel only;
// - truck/bus: the common R22.5 sizes of long-haul trucks and buses.
// The core models ONE tyre size: the driven axle (motorcycles: the rear wheel, tyres.ts TyreSetup), so
// front sizes (120/70 ZR17, 120/70 R19, 90/90-21 …) are not offered for a motorcycle (review PR #98).
// Every size offered must pass the core's own check (parseTyreSize ∘ formatTyreSize); sizes the core rejects are
// filtered out (e.g. 385/65 R22.5: the core accepts widths up to 355 mm).
import { formatTyreSize, isCommercialKind, isMotorcycleKind, parseTyreSize, tyreRadii } from "../core/index.ts";
import type { TyreSize, VehicleKind } from "../core/index.ts";

export type TyreClass = "car" | "bike" | "truck";

export function tyreClassOf(kind: VehicleKind | undefined): TyreClass {
  return isMotorcycleKind(kind ?? "car") ? "bike" : isCommercialKind(kind ?? "car") ? "truck" : "car";
}

const size = (widthMm: number, aspectPct: number, rimInch: number): TyreSize => ({ widthMm, aspectPct, rimInch });
const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** Motorcycle radial rear sizes (manufacturer fitments: sport bikes, nakeds, tourers, enduros, cruisers). */
const BIKE: { s: TyreSize }[] = [
  // rear
  { s: size(180, 65, 16) },
  { s: size(150, 60, 17) },
  { s: size(150, 70, 17) },
  { s: size(160, 60, 17) },
  { s: size(170, 60, 17) },
  { s: size(180, 55, 17) },
  { s: size(190, 50, 17) },
  { s: size(190, 55, 17) },
  { s: size(200, 55, 17) },
  { s: size(140, 80, 18) },
  { s: size(150, 70, 18) },
  { s: size(180, 55, 18) },
  { s: size(240, 40, 18) },
];

/** Truck and bus sizes on 22.5-inch rims (ETRTO; 385/65 R22.5 trailer size is above the core's 355 mm limit). */
const TRUCK: TyreSize[] = [
  size(275, 70, 22.5), size(295, 60, 22.5), size(295, 80, 22.5), size(315, 60, 22.5), size(315, 70, 22.5), size(315, 80, 22.5),
  size(385, 65, 22.5),
];

const CAR: TyreSize[] = range(135, 335, 10).flatMap((w) => range(25, 80, 5).flatMap((a) => range(13, 22, 1).map((r) => size(w, a, r))));

/** Only sizes the core accepts (parseTyreSize). */
const coreOk = (s: TyreSize) => {
  const p = parseTyreSize(formatTyreSize(s));
  return !!p && sameSize(p, s);
};

export const TYRE_SIZES: Record<TyreClass, readonly TyreSize[]> = {
  car: CAR.filter(coreOk),
  bike: BIKE.map((b) => b.s).filter(coreOk),
  truck: TRUCK.filter(coreOk),
};

export function sameSize(a: TyreSize, b: TyreSize): boolean {
  return a.widthMm === b.widthMm && a.aspectPct === b.aspectPct && a.rimInch === b.rimInch;
}

export function isListed(cls: TyreClass, s: TyreSize): boolean {
  return TYRE_SIZES[cls].some((t) => sameSize(t, s));
}

/** Outer diameter (unloaded) in mm. */
export const outerDiameterMm = (s: TyreSize) => tyreRadii(s).staticM * 2000;

/**
 * Nearest listed size of the class: fewest list steps away (width 10 mm, aspect 5 %, rim 1 inch counts double), the
 * closer outer diameter breaks ties (keeps the overall gearing). Used to migrate stored sizes that are not (or no
 * longer) in the list.
 */
export function snapTyreSize(cls: TyreClass, s: TyreSize): TyreSize {
  const d = outerDiameterMm(s);
  let best = TYRE_SIZES[cls][0]!;
  let bestCost = Infinity;
  for (const t of TYRE_SIZES[cls]) {
    const cost = Math.abs(t.widthMm - s.widthMm) / 10 + Math.abs(t.aspectPct - s.aspectPct) / 5 + 2 * Math.abs(t.rimInch - s.rimInch) + Math.abs(outerDiameterMm(t) - d) / 1000;
    if (cost < bestCost - 1e-9) {
      best = t;
      bestCost = cost;
    }
  }
  return { ...best };
}

/** Allowed dynamic wheel radius (m), e.g. the own-vehicle limits of the wizard (sandbox-setup.ts CUSTOM_LIMITS). */
export interface RadiusRange {
  min: number;
  max: number;
}

/** Sizes offered: the class list, limited to a dynamic radius range when given (then no offered size fails it). */
export function offeredSizes(cls: TyreClass, radius?: RadiusRange): readonly TyreSize[] {
  if (!radius) return TYRE_SIZES[cls];
  return TYRE_SIZES[cls].filter((t) => {
    const r = tyreRadii(t).dynamicM;
    return r >= radius.min && r <= radius.max;
  });
}

/** Nearest listed size for a dynamic wheel radius (metres), e.g. from an old save that kept only the radius. */
export function sizeFromRadius(cls: TyreClass, dynamicRadiusM: number): TyreSize {
  const sizes = TYRE_SIZES[cls];
  let best = sizes[0]!;
  for (const t of sizes) if (Math.abs(tyreRadii(t).dynamicM - dynamicRadiusM) < Math.abs(tyreRadii(best).dynamicM - dynamicRadiusM)) best = t;
  return { ...best };
}

/**
 * Reads a stored tyre size in any old form and returns a listed size of the class (null when nothing usable):
 * - text "225/45 R17", "225/45ZR17", "225/45-17", "225 45 17";
 * - a size object { widthMm, aspectPct, rimInch };
 * - a dynamic radius as a number (metres, or millimetres when > 10).
 * Off-list sizes snap to the nearest listed one.
 */
export function migrateTyreSize(cls: TyreClass, raw: unknown): TyreSize | null {
  let s: TyreSize | null = null;
  if (typeof raw === "string") {
    s = parseTyreSize(raw);
    if (!s) {
      const m = /^\s*(\d{2,3})\s*[/\s]\s*(\d{2})\s*(?:-|\s|Z?R|B)\s*(\d{2}(?:[.,]5)?)\s*$/i.exec(raw);
      if (m) s = size(Number(m[1]), Number(m[2]), Number(m[3]!.replace(",", ".")));
    }
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ([o.widthMm, o.aspectPct, o.rimInch].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) s = size(o.widthMm as number, o.aspectPct as number, o.rimInch as number);
  } else if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return sizeFromRadius(cls, raw > 10 ? raw / 1000 : raw);
  }
  if (!s) return null;
  return isListed(cls, s) ? s : snapTyreSize(cls, s);
}

const rimLabel = (r: number) => r.toLocaleString("de-DE");
const de = (n: number, d: number) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

/** "225/45 R17 · Ø 634 mm · Abrollumfang 1,93 m" (rolling circumference from the dynamic radius, tyres.ts). */
export function tyreReadout(s: TyreSize): string {
  const r = tyreRadii(s);
  return `${formatTyreSize(s)} · Ø ${de(outerDiameterMm(s), 0)} mm · Abrollumfang ${de(2 * Math.PI * r.dynamicM, 2)} m`;
}

/**
 * A gentle hint for combinations that hardly exist on the market (they are still allowed and calculated).
 * Passenger cars, rough envelope of the ETRTO/tyre maker catalogues [S]: max width ≈ 185 mm on 13" + 25 mm per inch;
 * min aspect 55 % on 13" − 5 % per inch (≥ 25 %); max aspect 75 % on 17" − 5 % per inch above; min width 155 mm on 19"
 * + 20 mm per inch above (BMW i3 155/70 R19 is the narrowest big-rim size).
 */
export function tyreHint(cls: TyreClass, s: TyreSize): string {
  if (cls !== "car") return "";
  const r = s.rimInch;
  const why: string[] = [];
  if (s.widthMm > 185 + (r - 13) * 25) why.push(`zu breit für ${rimLabel(r)} Zoll`);
  if (s.widthMm < 155 + Math.max(0, r - 19) * 20 && r >= 19) why.push(`zu schmal für ${rimLabel(r)} Zoll`);
  if (s.aspectPct < Math.max(25, 55 - (r - 13) * 5)) why.push(`sehr flach für ${rimLabel(r)} Zoll`);
  if (r >= 17 && s.aspectPct > 75 - (r - 17) * 5) why.push(`sehr hohe Flanke für ${rimLabel(r)} Zoll`);
  return why.length ? `Ungewöhnliche Kombination (${why.join(", ")}): So gibt es den Reifen kaum zu kaufen. Gerechnet wird trotzdem.` : "";
}

let pickerNo = 0;

/** Three selects Breite / Querschnitt R Zoll with a live readout and hint below. */
export class TyreSizePicker {
  readonly el: HTMLElement;
  /** Called when the player picks another size (not on setValue). */
  onChange: (s: TyreSize) => void = () => {};
  private cls: TyreClass;
  private radius: RadiusRange | undefined;
  private current: TyreSize;
  private wSel: HTMLSelectElement;
  private aSel: HTMLSelectElement;
  private rSel: HTMLSelectElement;
  private out: HTMLElement;
  private hintEl: HTMLElement;

  constructor(opts: { cls?: TyreClass; value?: TyreSize; label?: string; describedBy?: string; radius?: RadiusRange } = {}) {
    const id = `tsp${++pickerNo}`;
    this.cls = opts.cls ?? "car";
    this.radius = opts.radius;
    this.current = opts.value ? { ...opts.value } : { ...TYRE_SIZES[this.cls][0]! };
    const el = document.createElement("div");
    el.className = "tyrepick";
    el.setAttribute("role", "group");
    el.setAttribute("aria-labelledby", `${id}-l`);
    el.innerHTML = `
      <span class="tyrepick__label" id="${id}-l">${opts.label ?? "Reifengröße"}</span>
      <div class="tyrepick__row">
        <label class="tyrepick__f"><span>Breite</span><select data-control="tyre-width" aria-describedby="${id}-o${opts.describedBy ? ` ${opts.describedBy}` : ""}"></select></label>
        <span class="tyrepick__sep" aria-hidden="true">/</span>
        <label class="tyrepick__f"><span>Querschnitt</span><select data-control="tyre-aspect" aria-describedby="${id}-o"></select></label>
        <span class="tyrepick__sep" aria-hidden="true">R</span>
        <label class="tyrepick__f"><span>Zoll</span><select data-control="tyre-rim" aria-describedby="${id}-o"></select></label>
      </div>
      <p class="tyrepick__out num" id="${id}-o" data-out="tyre-size" aria-live="polite"></p>
      <p class="tyrepick__hint" data-out="tyre-size-hint"></p>`;
    this.el = el;
    this.wSel = el.querySelector("[data-control=tyre-width]")!;
    this.aSel = el.querySelector("[data-control=tyre-aspect]")!;
    this.rSel = el.querySelector("[data-control=tyre-rim]")!;
    this.out = el.querySelector("[data-out=tyre-size]")!;
    this.hintEl = el.querySelector("[data-out=tyre-size-hint]")!;
    this.wSel.addEventListener("change", () => this.pick("w"));
    this.aSel.addEventListener("change", () => this.pick("a"));
    this.rSel.addEventListener("change", () => this.pick("r"));
    this.render();
  }

  get value(): TyreSize {
    return { ...this.current };
  }

  get tyreClass(): TyreClass {
    return this.cls;
  }

  /** Shows a size (an off-list size, e.g. from an old save, is shown as it is: it gets its own option). */
  setValue(s: TyreSize, cls: TyreClass = this.cls, radius: RadiusRange | undefined = this.radius) {
    this.cls = cls;
    this.radius = radius;
    this.current = { ...s };
    this.render();
  }

  set disabled(d: boolean) {
    for (const s of [this.wSel, this.aSel, this.rSel]) s.disabled = d;
  }

  /** Sizes to choose from: the class list plus the current size when it is off-list. */
  private entries(): readonly TyreSize[] {
    const list = offeredSizes(this.cls, this.radius);
    return list.some((t) => sameSize(t, this.current)) ? list : [...list, this.current];
  }

  /** The player changed one select: keep the others where that size exists, else the nearest that does. */
  private pick(which: "w" | "a" | "r") {
    const all = this.entries();
    const w = Number(this.wSel.value);
    const a = Number(this.aSel.value);
    const r = Number(this.rSel.value);
    const nearest = (vals: number[], v: number) => vals.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), vals[0]!);
    let next: TyreSize;
    if (which === "w") {
      const aOk = [...new Set(all.filter((t) => t.widthMm === w).map((t) => t.aspectPct))];
      const a2 = aOk.includes(a) ? a : nearest(aOk, a);
      const rOk = all.filter((t) => t.widthMm === w && t.aspectPct === a2).map((t) => t.rimInch);
      next = size(w, a2, rOk.includes(r) ? r : nearest(rOk, r));
    } else if (which === "a") {
      const rOk = all.filter((t) => t.widthMm === w && t.aspectPct === a).map((t) => t.rimInch);
      next = size(w, a, rOk.includes(r) ? r : nearest(rOk, r));
    } else next = size(w, a, r);
    this.current = next;
    this.render();
    this.onChange(this.value);
  }

  private render() {
    const all = this.entries();
    const c = this.current;
    const uniq = (xs: number[]) => [...new Set(xs)].sort((x, y) => x - y);
    const fill = (sel: HTMLSelectElement, vals: number[], v: number, label: (n: number) => string) => {
      sel.innerHTML = vals.map((n) => `<option value="${n}">${label(n)}</option>`).join("");
      sel.value = String(v);
    };
    fill(this.wSel, uniq(all.map((t) => t.widthMm)), c.widthMm, String);
    fill(this.aSel, uniq(all.filter((t) => t.widthMm === c.widthMm).map((t) => t.aspectPct)), c.aspectPct, String);
    fill(this.rSel, uniq(all.filter((t) => t.widthMm === c.widthMm && t.aspectPct === c.aspectPct).map((t) => t.rimInch)), c.rimInch, rimLabel);
    this.out.textContent = tyreReadout(c);
    const hint = tyreHint(this.cls, c);
    this.hintEl.textContent = hint;
    this.hintEl.hidden = !hint;
  }
}
