// E2E for electric cars (#108), run from smoke.mjs. Guided start: Auto → ⚡ Tesla Model S Plaid → eben → Losfahren;
// the Prüfzelle shows the EV instruments (no cutaway, no ignition key / starter, Ready instead); Ready, full throttle:
// the power meter shows hundreds of kW and the state of charge drops. Then every cockpit design with the EV loaded
// (Arthur's rule: each design has an EV variant): power meter in kW instead of the rev counter, SoC instead of the
// tank, range in the centre display, the Ready lamp lit, no oil / coolant lamps. "Automatisch" picks the E-Tacho.
import { join } from "node:path";

const DESIGNS = ["classic", "night-orange", "italian", "oldschool", "digital", "hud", "race", "motorrad", "truck", "etacho"];
/** German number readout ("1.020" → 1020, "−45" → -45). */
const num = (t) => Number(String(t ?? "").replace(/\./g, "").replace(",", ".").replace("−", "-").replace(/[^\d.-]/g, ""));

export async function evChecks({ browser, base, outDir, failures, errors, label, viewport }) {
  const touch = viewport.width < 700;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const fail = (m) => failures.push(`${label}: Elektro: ${m}`);
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(`${m.text()} ${m.location()?.url ?? ""}`)) errors.push(`${label}: console.error (Elektro): ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (Elektro): ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });

  // guided start: the Plaid is in the Auto list with its ⚡ badge, battery instead of a tank
  await page.click('a.door[href="#sandbox"]');
  await page.waitForSelector(".wizard[open] [data-step='1']:not([hidden])");
  await page.click('.wizard [data-kind="car"]');
  if (await page.isVisible('.wizard[open] [data-step="1"]:not([hidden])')) await page.click('.wizard [data-nav="next"]');
  await page.waitForSelector('.wizard__vehicle:has(input[value="ev-tesla-model-s-plaid"])');
  const card = await page.textContent('.wizard__vehicle:has(input[value="ev-tesla-model-s-plaid"])');
  if (!/⚡/.test(card ?? "") || !/Akku 100 kWh/.test(card ?? "") || !/1\.020 PS/.test(card ?? "")) fail(`Assistent: Plaid ohne ⚡/Akku/PS („${card?.replace(/\s+/g, " ").trim()}“)`);
  await page.click('.wizard__vehicle:has(input[value="ev-tesla-model-s-plaid"])');
  await page.screenshot({ path: join(outDir, `smoke-${label}-ev-wizard.png`) });
  await page.click('.wizard [data-nav="next"]');
  await page.click('.routepick__card:has(input[value="static"])');
  await page.click('.wizard [data-nav="next"]');
  await page.click('.wizard [data-nav="next"]');
  await page.waitForSelector(".cell[data-drive='ev']", { timeout: 5000 }).catch(() => fail("Sandbox schaltet nicht auf Elektro"));
  await page.waitForTimeout(300);

  // Prüfzelle: Ready instead of key and starter, no cutaway engine, EV instruments
  const pz = await page.evaluate(() => ({
    ready: !!document.querySelector(".readybtn")?.getClientRects().length,
    key: !!document.querySelector(".ignkey")?.getClientRects().length,
    starter: !!document.querySelector(".starter")?.getClientRects().length,
    cutaway: !!document.querySelector(".stage__engine")?.getClientRects().length,
    evGauges: !!document.querySelector('[data-gauge="ev-power"]')?.getClientRects().length,
    iceRpm: !!document.querySelector('[data-gauge="rpm"]')?.getClientRects().length,
    panel: !!document.querySelector(".evp")?.getClientRects().length,
    car: window.__pruefzelle?.gearbox.vehiclePanel.carId,
  }));
  if (!pz.ready || pz.key || pz.starter) fail(`Bedienpult: Ready statt Zündung/Starter erwartet (${JSON.stringify(pz)})`);
  if (pz.cutaway || !pz.evGauges || pz.iceRpm || !pz.panel) fail(`Prüfzelle zeigt nicht die E-Instrumente (${JSON.stringify(pz)})`);
  if (pz.car !== "ev-tesla-model-s-plaid") fail(`falsches Auto geladen (${pz.car})`);
  const soc0 = num(await page.textContent('[data-meter="ev-soc"] .meter__value'));

  // Ready, full throttle
  await page.click(".readybtn");
  await page.waitForTimeout(200);
  await page.mouse.click(2, 2);
  await page.keyboard.down("w");
  let peak = 0;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    peak = Math.max(peak, num(await page.textContent('[data-gauge="ev-power"] .gauge__value')));
  }
  await page.screenshot({ path: join(outDir, `smoke-${label}-ev-pruefzelle.png`) });
  await page.keyboard.up("w");
  const soc1 = num(await page.textContent('[data-meter="ev-soc"] .meter__value'));
  const kmh = await page.evaluate(() => window.__pruefzelle?.gearbox.drivetrain.state.speedKmh ?? 0);
  if (!(peak > 300)) fail(`Leistungsanzeige zeigt keine Volllast (${peak} kW)`);
  if (!(soc1 < soc0)) fail(`Ladezustand fällt nicht (${soc0} → ${soc1} %)`);
  if (!(kmh > 80)) fail(`Plaid beschleunigt nicht (${Math.round(kmh)} km/h)`);
  console.log(`${label}: Elektro Prüfzelle ${peak} kW, SoC ${soc0} → ${soc1} %, ${Math.round(kmh)} km/h`);

  // the cockpit, every design, with the car rolling (regen) and then under power
  await page.selectOption('select[data-control="layout"]', "cockpit");
  await page.waitForSelector(".ck");
  for (const id of DESIGNS) {
    await page.selectOption('select[data-control="ck-design"]', id);
    await page.keyboard.down("w");
    await page.waitForTimeout(450);
    const r = await page.evaluate(() => {
      const ck = document.querySelector(".ck");
      const vis = (sel) => !!ck.querySelector(sel)?.getClientRects().length;
      return {
        design: ck.dataset.design, drive: ck.dataset.drive,
        ready: ck.querySelector("[data-ev-lamp=ready]")?.dataset.state, readyVis: vis("[data-ev-lamp=ready]"),
        oilLamp: vis('[data-lamp="oil"]'), coolantLamp: vis('[data-lamp="coolant"]'),
        // the Renn-Dash shows charge and range in its own tiles
        ev: vis(".ck__ev") || vis('[data-rd="range-tile"]'),
        soc: (ck.dataset.design === "race" ? ck.querySelector('[data-rd="tank"]') : ck.querySelector('[data-ck="ev-soc"]'))?.textContent ?? "",
        range: (ck.dataset.design === "race" ? ck.querySelector('[data-rd="range"]') : ck.querySelector('[data-ck="ev-range"]'))?.textContent ?? "",
        rpmUnit: ck.querySelector('[data-ck="rpm-unit"]')?.textContent, tank: ck.querySelector('[data-mini="tank"] .ck-mini__cap')?.textContent,
        hudLabel: ck.querySelector('[data-ck="hud-rpm-label"]')?.textContent, raceLabel: ck.querySelector('[data-rd="rpm-label"]')?.textContent,
        bikeTank: ck.querySelector('[data-ck="bike-tank-label"]')?.textContent,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    const bad = [];
    if (r.design !== id || r.drive !== "ev") bad.push("Design/Antrieb");
    if (r.ready !== "on" || !r.readyVis) bad.push("Ready-Leuchte");
    if (r.oilLamp || r.coolantLamp) bad.push("Öl-/Kühlmittelleuchte sichtbar");
    if (!r.ev || !/%/.test(r.soc) || !/km/.test(r.range)) bad.push("Ladezustand/Reichweite fehlt");
    if (r.rpmUnit !== "kW") bad.push("Drehzahlmesser statt Leistungsanzeige");
    if (r.tank !== "Akku") bad.push("Tankanzeige statt Ladezustand");
    if (id === "hud" && r.hudLabel !== "Akku") bad.push("Head-up ohne Akku");
    if (id === "race" && r.raceLabel !== "kW") bad.push("Renn-Dash ohne kW");
    if (id === "motorrad" && r.bikeTank !== "Akku") bad.push("Motorrad-TFT ohne Akku");
    if (r.overflow > 0) bad.push(`horizontaler Überlauf ${r.overflow} px`);
    if (bad.length) fail(`Cockpit-Design ${id}: ${bad.join(", ")} (${JSON.stringify(r)})`);
    await page.screenshot({ path: join(outDir, `smoke-${label}-ev-cockpit-${id}.png`) });
    await page.keyboard.up("w");
  }
  // "Automatisch" = E-Tacho in an electric car
  await page.selectOption('select[data-control="ck-design"]', "auto");
  await page.waitForTimeout(150);
  const auto = await page.evaluate(() => document.querySelector(".ck")?.dataset.design);
  if (auto !== "etacho") fail(`„Automatisch“ wählt nicht den E-Tacho (${auto})`);
  // drive mode button of the E-Tacho steps Sport → Plaid
  const before = await page.textContent('[data-ck="ev-mode"]');
  await page.click('[data-ck="ev-mode"]');
  await page.waitForTimeout(150);
  const after = await page.textContent('[data-ck="ev-mode"]');
  if (before === after) fail(`Fahrmodus-Knopf wechselt nicht (${before})`);

  // back to a combustion car: key and starter return, the rev counter too
  await page.selectOption('select[data-control="layout"]', "pruefzelle");
  await page.mouse.click(2, 2);
  await page.keyboard.down("s");
  await page.waitForFunction(() => (window.__pruefzelle?.gearbox.drivetrain.state.speedKmh ?? 99) < 0.5, null, { timeout: 30000 }).catch(() => fail("bremst nicht bis zum Stand"));
  await page.keyboard.up("s");
  await page.click(".readybtn");
  await page.selectOption('.vehicle [data-control="car"]', "car-vw-golf7-gti");
  await page.click('.vehicle [data-control="load-car"]');
  await page.waitForTimeout(400);
  const ice = await page.evaluate(() => ({
    note: document.querySelector('.vehicle [data-out="car-note"]')?.textContent, kmh: window.__pruefzelle?.gearbox.drivetrain.state.speedKmh,
    sel: document.querySelector('.vehicle [data-control="car"]')?.value, ready: window.__pruefzelle?.inputs.ignition,
    drive: document.querySelector(".cell")?.dataset.drive,
    key: !!document.querySelector(".ignkey")?.getClientRects().length,
    rpm: !!document.querySelector('[data-gauge="rpm"]')?.getClientRects().length,
  }));
  if (ice.drive !== "ice" || !ice.key || !ice.rpm) fail(`zurück zum Verbrenner klappt nicht (${JSON.stringify(ice)})`);
  await page.close();
}
