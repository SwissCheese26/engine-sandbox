// E2E for the free drive swap and the uniform layout (#154), run from smoke.mjs.
// 1. Uniform layout: a combustion car (Golf GTI) and an electric car (Model S LR) in the Prüfzelle and every cockpit
//    design: the control-bar slots (key + starter ↔ Ready, ▲ gear ▼ ↔ P N D, P, brake, gas, the console groups) sit at
//    the same place for both drives, nothing overlaps, no horizontal overflow; the Prüfzelle dials keep their order.
// 2. Swap: the Tesla drive into the Citaro (EV instruments, Ready, lower mass), the LS3 V8 into the Model S (key and
//    starter, rev counter), stored per vehicle, "Auf Werkszustand" brings the factory drive back.
import { join } from "node:path";
import { deckOverlaps } from "./deck.mjs";

const DESIGNS = ["classic", "night-orange", "italian", "oldschool", "digital", "hud", "race", "motorrad", "truck", "etacho"];
const SLOTS = [".console__group--main", ".console__group--dyno", ".console__group--aux", ".shiftpad", ".parkbtn", ".brakepedal", ".pedal"];

/** Loads a library vehicle with its drive (as the "Laden" button does) and switches to the chassis dyno. */
async function loadCar(page, id) {
  await page.evaluate((id) => {
    const p = document.querySelector('.vehicle [data-control="car"]');
    p.value = id;
    document.querySelector('.vehicle [data-control="load-car"]').click();
    const m = document.querySelector("select[data-control=mode]");
    if (m.value !== "vehicle") {
      m.value = "vehicle";
      m.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, id);
  await page.waitForTimeout(350);
}

const slots = (page) => page.evaluate((sels) => Object.fromEntries(sels.map((s) => {
  const e = document.querySelector(`.deck ${s}`);
  if (!e || !e.checkVisibility({ visibilityProperty: true })) return [s, null];
  const r = e.getBoundingClientRect();
  return [s, [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]];
})), SLOTS);

export async function swapChecks({ browser, base, outDir, failures, errors, label, viewport }) {
  const touch = viewport.width < 700;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const fail = (m) => failures.push(`${label}: Antriebstausch: ${m}`);
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(`${m.text()} ${m.location()?.url ?? ""}`)) errors.push(`${label}: console.error (Tausch): ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (Tausch): ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`${base}#sandbox`, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__pruefzelle);

  // --- 1. uniform layout ------------------------------------------------------------------------------------------
  const views = ["pruefzelle", ...DESIGNS];
  const pos = { ice: {}, ev: {} };
  for (const [drive, car] of [["ice", "car-vw-golf7-gti"], ["ev", "ev-tesla-model-s-lr"]]) {
    await page.selectOption('select[data-control="layout"]', "pruefzelle");
    await loadCar(page, car);
    const d = await page.evaluate(() => document.querySelector(".cell")?.dataset.drive);
    if (d !== drive) fail(`${car}: Antrieb ${d} statt ${drive}`);
    if (drive === "ice") {
      // the Prüfzelle dials: speed, torque, power for both drives
      const dials = await page.$$eval(".instruments__dials:not([hidden]) [data-gauge]", (g) => g.map((x) => x.dataset.gauge));
      if (dials.slice(0, 3).join() !== "rpm,torque,power") fail(`Verbrenner-Rundinstrumente ${dials}`);
    } else {
      const dials = await page.$$eval(".instruments__dials--ev [data-gauge]", (g) => g.map((x) => x.dataset.gauge));
      if (dials.join() !== "ev-rpm,ev-torque,ev-power") fail(`E-Rundinstrumente ${dials} (Reihenfolge wie beim Verbrenner erwartet)`);
    }
    for (const v of views) {
      if (v === "pruefzelle") await page.selectOption('select[data-control="layout"]', "pruefzelle");
      else {
        await page.selectOption('select[data-control="layout"]', "cockpit");
        await page.selectOption('select[data-control="ck-design"]', v);
      }
      await page.waitForTimeout(120);
      pos[drive][v] = await slots(page);
      for (const m of await deckOverlaps(page)) fail(`${car} ${v}: Bedienleiste: ${m}`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) fail(`${car} ${v}: horizontaler Überlauf ${over} px`);
    }
    await page.selectOption('select[data-control="layout"]', "pruefzelle");
    await page.locator(".deck").screenshot({ path: join(outDir, `smoke-${label}-deck-${drive}.png`) });
  }
  for (const v of views) {
    for (const s of SLOTS) {
      const a = pos.ice[v][s], b = pos.ev[v][s];
      if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${v}: ${s} springt zwischen Verbrenner ${JSON.stringify(a)} und Elektro ${JSON.stringify(b)}`);
    }
  }
  // the same Werkbank summary rows for both drives
  const rows = await page.evaluate(() => [".ice-summary", ".evb .evb__summary"].map((s) => [...document.querySelectorAll(`${s} dt`)].slice(0, 7).map((d) => d.textContent).join("|")));
  if (rows[0] !== rows[1] || !rows[0]) fail(`Zusammenfassung unterschiedlich: ${rows[0]} / ${rows[1]}`);

  // --- 2. swap ----------------------------------------------------------------------------------------------------
  const state = () => page.evaluate(() => {
    const a = window.__pruefzelle;
    return {
      drive: document.querySelector(".cell")?.dataset.drive, kg: Math.round(a.gearbox.drivetrain.vehicle.massKg),
      ready: !!document.querySelector(".readybtn")?.checkVisibility({ visibilityProperty: true }),
      key: !!document.querySelector(".ignkey")?.checkVisibility({ visibilityProperty: true }),
      sel: document.querySelector('.vehicle [data-control="drive"]')?.value, car: a.gearbox.vehiclePanel.carId,
      note: document.querySelector('.vehicle [data-out="car-note"]')?.textContent ?? "",
    };
  });
  await loadCar(page, "bus-mercedes-citaro-o530");
  const bus0 = await state();
  await page.selectOption('.vehicle [data-control="drive"]', "ev:ev-tesla-model-s-lr");
  await page.waitForTimeout(350);
  const bus1 = await state();
  if (bus1.drive !== "ev" || !bus1.ready || bus1.key || !(bus1.kg < bus0.kg) || !/Antrieb/.test(bus1.note)) fail(`Tesla-Antrieb im Citaro (${JSON.stringify({ bus0, bus1 })})`);
  // Ready, full throttle: the bus moves
  await page.click(".readybtn");
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  await page.keyboard.up("w");
  const busKmh = await page.evaluate(() => window.__pruefzelle.gearbox.drivetrain.state.speedKmh);
  if (!(busKmh > 10)) fail(`Citaro mit Tesla-Antrieb fährt nicht (${busKmh.toFixed(1)} km/h)`);
  await page.keyboard.down("s");
  await page.waitForFunction(() => window.__pruefzelle.gearbox.drivetrain.state.speedKmh < 0.5, null, { timeout: 30000 }).catch(() => fail("Citaro bremst nicht bis zum Stand"));
  await page.keyboard.up("s");
  await page.click(".readybtn");
  await page.screenshot({ path: join(outDir, `smoke-${label}-swap-bus-ev.png`) });

  // the V8 into the Model S: combustion instruments, key and starter
  await loadCar(page, "ev-tesla-model-s-lr");
  await page.selectOption('.vehicle [data-control="drive"]', "ref-gm-ls3-62");
  await page.waitForTimeout(500);
  const ms = await state();
  const engine = await page.evaluate(() => window.__pruefzelle.bench.config.id);
  if (ms.drive !== "ice" || !ms.key || ms.ready || engine !== "ref-gm-ls3-62" || !(ms.kg > 1500 && ms.kg < 1850)) fail(`LS3 im Model S (${JSON.stringify({ ms, engine })})`);
  // stored per vehicle: back to the bus and again to the Model S
  await loadCar(page, "bus-mercedes-citaro-o530");
  const busAgain = await state();
  await loadCar(page, "ev-tesla-model-s-lr");
  const msAgain = await state();
  if (busAgain.sel !== "ev:ev-tesla-model-s-lr" || busAgain.drive !== "ev" || msAgain.sel !== "ref-gm-ls3-62" || msAgain.drive !== "ice") fail(`nicht je Fahrzeug gespeichert (${JSON.stringify({ busAgain, msAgain })})`);
  // "Auf Werkszustand": the Model S is electric again
  await page.click('.vehicle [data-control="factory-reset"]');
  await page.waitForTimeout(400);
  const back = await state();
  if (back.drive !== "ev" || back.sel !== "" || back.kg !== 2144) fail(`Werkszustand bringt den Werksantrieb nicht zurück (${JSON.stringify(back)})`);
  console.log(`${label}: Tausch Citaro ${bus0.kg} → ${bus1.kg} kg (${busKmh.toFixed(0)} km/h nach 2,5 s), Model S + LS3 ${ms.kg} kg`);
  await page.close();
}
