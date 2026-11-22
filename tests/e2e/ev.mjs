// E2E for electric cars (#108), run from smoke.mjs. Guided start: Auto → ⚡ Tesla Model S Plaid → eben → Losfahren;
// the Prüfzelle shows the EV instruments (no cutaway, no ignition key / starter, Ready instead); Ready, full throttle:
// the power meter shows hundreds of kW and the state of charge drops. Then every cockpit design with the EV loaded
// (Arthur's rule: each design has an EV variant): power meter in kW instead of the rev counter, SoC instead of the
// tank, range in the centre display, the Ready lamp lit, no oil / coolant lamps. "Automatisch" picks the E-Tacho.
import { join } from "node:path";
import { deckOverlaps } from "./deck.mjs";

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
    panel: !!document.querySelector('.gearbox__ev [data-o="soc"]')?.getClientRects().length,
    selector: !!document.querySelector(".shiftpad.is-ev .shiftpad__sel")?.getClientRects().length,
    car: window.__pruefzelle?.gearbox.vehiclePanel.carId,
  }));
  if (!pz.ready || pz.key || pz.starter) fail(`Bedienpult: Ready statt Zündung/Starter erwartet (${JSON.stringify(pz)})`);
  if (pz.cutaway || !pz.evGauges || pz.iceRpm || !pz.panel || !pz.selector) fail(`Prüfzelle zeigt nicht die E-Instrumente (${JSON.stringify(pz)})`);
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
  // review #115: live readouts in the Getriebe-Pult's list, consumption never negative, P N D selector
  const ro = await page.evaluate(() => ({
    cons: document.querySelector('.gearbox__ev [data-o="cons"]')?.textContent ?? "",
    range: document.querySelector('.gearbox__ev [data-o="range"]')?.textContent ?? "",
    charge: !!document.querySelector('.gearbox__charge [data-control="charge-90"]')?.getClientRects().length,
    refuel: !!document.querySelector('[data-control="refuel"]')?.getClientRects().length,
    sel: document.querySelector('.shiftpad__sel[aria-checked="true"]')?.textContent,
  }));
  if (/[−-]\s*\d/.test(ro.cons) || !/km/.test(ro.range) || !ro.charge || ro.refuel || ro.sel !== "D") fail(`Anzeigen im Getriebe-Pult (${JSON.stringify(ro)})`);
  // P N D (review #125): no dead R; "Halten" releasing the parking brake moves the selector from P to N
  const sels = await page.$$eval(".shiftpad__sel", (b) => b.map((x) => x.textContent).join(""));
  if (sels !== "PND") fail(`Fahrstufen ${sels} statt PND`);
  await page.keyboard.down("s");
  await page.waitForFunction(() => (window.__pruefzelle?.gearbox.drivetrain.state.speedKmh ?? 99) < 0.5, null, { timeout: 30000 }).catch(() => fail("bremst nicht bis zum Stand (P)"));
  await page.keyboard.up("s");
  await page.click('.shiftpad__sel[data-sel="P"]');
  await page.waitForTimeout(100);
  const pHeld = await page.evaluate(() => !!window.__pruefzelle?.gearbox.drivetrain.state.parkingBrake);
  await page.click(".parkbtn");
  await page.waitForTimeout(150);
  const afterRelease = await page.evaluate(() => ({ brake: !!window.__pruefzelle?.gearbox.drivetrain.state.parkingBrake, sel: document.querySelector('.shiftpad__sel[aria-checked="true"]')?.textContent }));
  if (!pHeld || afterRelease.brake || afterRelease.sel !== "N") fail(`P/Halten passen nicht zusammen (P hält ${pHeld}, danach ${JSON.stringify(afterRelease)})`);
  await page.click('.shiftpad__sel[data-sel="D"]');
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
    if (id === "etacho") {
      // review #115: the speed fits its box, the power meter sits on top (no empty speedometer box beside it)
      const geo = await page.evaluate(() => {
        const ck = document.querySelector(".ck");
        const sp = ck.querySelector(".ck__speed");
        const lamps = ck.querySelector(".ck__lamps").getBoundingClientRect();
        const dial = ck.querySelector(".ck__dial--rpm canvas").getBoundingClientRect();
        const mfd = ck.querySelector(".ck__mfd").getBoundingClientRect();
        const spr = sp.getBoundingClientRect();
        return { dialH: Math.round(dial.height), clipped: sp.scrollWidth > sp.clientWidth + 1 || spr.right > mfd.right + 1, sw: sp.scrollWidth, cw: sp.clientWidth, r: Math.round(spr.right), mr: Math.round(mfd.right), gap: Math.round(dial.top - lamps.bottom), dialAboveMfd: dial.bottom <= mfd.top + 1 };
      });
      if (geo.clipped) bad.push(`Tempo abgeschnitten (${JSON.stringify(geo)})`);
      if (touch && geo.gap > 24) bad.push(`Leistungsanzeige ${geo.gap} px unter den Leuchten`);
      // #120: the power meter must not fill the phone screen
      if (touch && geo.dialH > 230) bad.push(`Leistungsanzeige zu groß (${geo.dialH} px)`);
    }
    if (bad.length) fail(`Cockpit-Design ${id}: ${bad.join(", ")} (${JSON.stringify(r)})`);
    for (const m of await deckOverlaps(page)) fail(`${id}: Bedienleiste: ${m}`);
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

  // E-Tuner: Plaid beyond 2000 PS, live figures, apply, drive; stored per vehicle; back to the factory state
  await page.selectOption('.vehicle [data-control="car"]', "ev-tesla-model-s-plaid");
  await page.click('.vehicle [data-control="load-car"]');
  // the E-Tuner lives on the Werkbank (review #115): Elektroantrieb plates instead of the combustion plates
  if (touch) await page.click(".bench-toggle");
  await page.waitForSelector("#werkbank.bench--ev .evb:not([hidden]) [data-tune=frontMotors]");
  const benchOk = await page.evaluate(() => ({
    ice: !!document.querySelector('#werkbank .bench__plates:not(.evb) .plate')?.getClientRects().length,
    fuel: !!document.querySelector("#werkbank .fuel-switch")?.getClientRects().length,
    plates: [...document.querySelectorAll("#werkbank .evb .plate__title")].map((h) => h.textContent),
  }));
  if (benchOk.ice || benchOk.fuel || benchOk.plates.length !== 5) fail(`Werkbank zeigt nicht die Elektroantrieb-Platten (${JSON.stringify(benchOk)})`);
  const set = async (k, v) => {
    const row = `.evb [data-tune="${k}"]`;
    const kind = await page.evaluate((s) => document.querySelector(s).className, row);
    if (kind.includes("field--select")) await page.selectOption(`${row} select`, String(v));
    else if (kind.includes("field--choice-number")) await page.click(`${row} .seg__opt:has(input[value="${v}"])`);
    else {
      await page.fill(`${row} .field__num`, String(v));
      await page.press(`${row} .field__num`, "Enter");
    }
  };
  // Arthur: "4 Motoren kann man nicht auswählen": the count just picked stays, the other axle gives way
  const counts = () => page.evaluate(() => ({
    f: document.querySelector('.evb [data-tune="frontMotors"] input:checked')?.value,
    r: document.querySelector('.evb [data-tune="rearMotors"] input:checked')?.value,
    motor: document.querySelector('.evb [data-o="motor"]')?.textContent ?? "",
  }));
  // later: up to 4 per axle, 8 in all (#136): the other axle stays
  for (const [k, v, want] of [["rearMotors", 4, "1+4"], ["frontMotors", 4, "4+4"], ["rearMotors", 1, "4+1"], ["frontMotors", 2, "2+1"]]) {
    await set(k, v);
    const c = await counts();
    const n = want.split("+").reduce((a, x) => a + Number(x), 0);
    if (`${c.f}+${c.r}` !== want || !c.motor.startsWith(`${n} ×`)) fail(`E-Tuner: ${k} = ${v} ergibt ${c.f}+${c.r} statt ${want} (${c.motor})`);
  }
  for (const [k, v] of [["frontMotors", 2], ["rearMotors", 2], ["motorScale", 200], ["currentScale", 150], ["packKwh", 150], ["chemistry", "nca"], ["cRate", 12], ["highVoltage", 1], ["cooling", "track"], ["tyre", "semi-slick"], ["gears", 2], ["firstRatio", 15], ["secondRatio", 8], ["shiftKmh", 120], ["vmaxKmh", 450]]) await set(k, v);
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(200);
  await page.waitForFunction(() => /\d/.test(document.querySelector('.evb [data-o="t100"]')?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  const live = await page.evaluate(() => Object.fromEntries(["power", "limit", "t100", "range", "mass", "vmax"].map((k) => [k, document.querySelector(`.evb [data-o="${k}"]`)?.textContent ?? ""])));
  const ps = num(live.power.split("PS")[0]);
  if (!/Motordrehzahl/.test(live.vmax)) fail(`Vmax-Begrenzer am Anschlag zeigt nicht „begrenzt durch Motordrehzahl“ (${live.vmax})`);
  if (!(ps > 2000) || !/s$/.test(live.t100) || !/km/.test(live.range) || !/Akku|Wechselrichter|Motoren/.test(live.limit)) fail(`Werkbank-Zusammenfassung zeigt keine Live-Werte über 2000 PS (${JSON.stringify(live)})`);
  // 360/390 px: nothing sticks out of the Werkbank, no stray "×", touch targets ≥ 44 px
  const geo = await page.evaluate(() => {
    const bench = document.querySelector("#werkbank").getBoundingClientRect();
    const wide = [...document.querySelectorAll("#werkbank .evb *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > Math.min(bench.right, innerWidth) + 1).map((e) => e.className || e.tagName);
    const small = [...document.querySelectorAll("#werkbank .evb :is(select, .field__num, .seg__opt span, .btn)")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 43.5).map((e) => e.className || e.tagName);
    return { wide: wide.slice(0, 5), small: matchMedia("(max-width: 700px)").matches ? small.slice(0, 5) : [], stray: /×\s*(Wechselrichter|Spannung)/.test(document.querySelector("#werkbank .evb").innerText), overflow: document.documentElement.scrollWidth - innerWidth };
  });
  if (geo.wide.length || geo.small.length || geo.stray || geo.overflow > 0) fail(`Werkbank Elektroantrieb: Überlauf/Touch-Ziele (${JSON.stringify(geo)})`);
  await page.screenshot({ path: join(outDir, `smoke-${label}-ev-werkbank.png`) });
  await page.locator(".evb__summary").scrollIntoViewIfNeeded();
  await page.locator(".evb__summary").screenshot({ path: join(outDir, `smoke-${label}-ev-summary.png`) });
  await page.waitForTimeout(500); // changes apply on their own (no "Anwenden")
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pruefzelle.evTuning") ?? "{}")["ev-tesla-model-s-plaid"]);
  if (!stored || stored.frontMotors !== 2 || !stored.highVoltage || stored.gears !== 2 || stored.vmaxKmh !== null) fail(`E-Tuner speichert nicht je Fahrzeug (${JSON.stringify(stored)}; ${await page.textContent(".evb [data-o=note]")}; ${await page.evaluate(() => window.__pruefzelle?.gearbox.drivetrain.state.speedKmh)})`);
  const builtMotors = await page.evaluate(() => window.__pruefzelle?.gearbox.drivetrain.ev?.motors.map((m) => m.axle).join(","));
  if (builtMotors !== "front,front,rear,rear") fail(`E-Tuner 2+2 nicht angewendet (${builtMotors})`);
  if (touch) await page.click(".bench-toggle");
  await page.click(".readybtn");
  await page.mouse.click(2, 2);
  await page.keyboard.down("w");
  let tunedPeak = 0;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(250);
    tunedPeak = Math.max(tunedPeak, num(await page.textContent('[data-gauge="ev-power"] .gauge__value')));
  }
  await page.keyboard.up("w");
  const tunedKmh = await page.evaluate(() => window.__pruefzelle?.gearbox.drivetrain.state.speedKmh ?? 0);
  if (!(tunedPeak > 1100) || !(tunedKmh > 120)) fail(`getunter Plaid fährt nicht mit mehr Leistung (${tunedPeak} kW, ${Math.round(tunedKmh)} km/h)`);
  console.log(`${label}: E-Tuner ${ps} PS (${live.limit}, 0–100 ${live.t100}), gefahren ${tunedPeak} kW, ${Math.round(tunedKmh)} km/h`);
  await page.keyboard.down("s");
  await page.waitForFunction(() => (window.__pruefzelle?.gearbox.drivetrain.state.speedKmh ?? 99) < 0.5, null, { timeout: 30000 }).catch(() => fail("bremst nicht bis zum Stand (getunt)"));
  await page.keyboard.up("s");
  // the Fahrzeug-Platte's "Auf Werkszustand zurücksetzen" forgets the E-Tuner setup too (review #115)
  await page.click('.vehicle [data-control="factory-reset"]');
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({
    power: document.querySelector('.evb [data-o="power"]')?.textContent ?? "",
    stored: JSON.parse(localStorage.getItem("pruefzelle.evTuning") ?? "{}")["ev-tesla-model-s-plaid"] ?? null,
    motors: window.__pruefzelle?.gearbox.drivetrain.ev?.motors.length,
  }));
  if (!/^1\.0\d\d PS/.test(back.power) || back.stored || back.motors !== 3) fail(`„Auf Werkszustand zurücksetzen“ (Fahrzeug-Platte) klappt nicht (${JSON.stringify(back)})`);
  // the E-Tuner's own reset button does the same
  if (touch) await page.click(".bench-toggle");
  await set("frontMotors", 2);
  await page.waitForTimeout(500); // changes apply on their own (no "Anwenden")
  await page.click('.evb [data-control="tune-reset"]');
  await page.waitForTimeout(300);
  const back2 = await page.evaluate(() => ({ stored: JSON.parse(localStorage.getItem("pruefzelle.evTuning") ?? "{}")["ev-tesla-model-s-plaid"] ?? null, motors: window.__pruefzelle?.gearbox.drivetrain.ev?.motors.length }));
  if (back2.stored || back2.motors !== 3) fail(`„Auf Werkszustand zurücksetzen“ (E-Tuner) klappt nicht (${JSON.stringify(back2)})`);
  await page.close();
}
