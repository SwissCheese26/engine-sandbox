// E2E: power (PS) and torque are visible and filled for a combustion car, an EV and a hybrid, in the Prüfzelle (dials),
// the Werkbank summary and the cockpit (the digital design's switchable fields Leistung / Drehmoment; the head-up
// display's power). Run from smoke.mjs.
// Regression: the hybrid's combustion summary stayed "–" (or showed the previous car) after #163.
const CARS = [["Verbrenner", "car-vw-golf7-gti"], ["Elektro", "ev-tesla-model-s-plaid"], ["Hybrid", "hy-toyota-prius-4"]];
const filled = (t) => typeof t === "string" && /\d/.test(t) && !/^\s*–\s*$/.test(t);

async function loadCar(page, id) {
  await page.selectOption('select[data-control="layout"]', "pruefzelle");
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
  // the summary is refreshed twice a second
  await page.waitForTimeout(1200);
}

export async function powerReadoutChecks({ browser, base, failures, errors, label, viewport }) {
  const touch = viewport.width < 700;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const fail = (m) => failures.push(`${label}: PS/Drehmoment: ${m}`);
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (PS/Drehmoment): ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`${base}#sandbox`, { waitUntil: "load" });
  // PS as the power unit, Leistung and Drehmoment in the cockpit's switchable fields
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("pruefzelle.settings", JSON.stringify({ preset: "metric-ps", ckFields: ["power", "torque", "range"] }));
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__pruefzelle);

  const sums = {};
  for (const [kind, car] of CARS) {
    await loadCar(page, car);
    // Prüfzelle: a power dial in PS and a torque dial in Nm, each with a value
    const dials = await page.evaluate(() => [...document.querySelectorAll(".gauge")]
      .filter((g) => g.checkVisibility({ visibilityProperty: true }))
      .map((g) => ({ label: g.querySelector(".gauge__label")?.textContent ?? "", value: g.querySelector(".gauge__value")?.textContent ?? "", unit: g.querySelector(".gauge__unit")?.textContent ?? "" })));
    const pw = dials.find((d) => /leistung/i.test(d.label));
    const tq = dials.find((d) => /Drehmoment/.test(d.label));
    if (!pw || pw.unit !== "PS" || !filled(pw.value)) fail(`${kind}: Prüfzelle ohne Leistung in PS (${JSON.stringify(pw ?? null)})`);
    if (!tq || tq.unit !== "Nm" || !filled(tq.value)) fail(`${kind}: Prüfzelle ohne Drehmoment (${JSON.stringify(tq ?? null)})`);

    // Werkbank summary: every shown plate has PS and Nm
    const toggle = page.locator(".bench-toggle");
    const open = async (on) => {
      if ((await toggle.isVisible()) && ((await toggle.getAttribute("aria-expanded")) === "true") !== on) await toggle.click();
    };
    await open(true);
    const plates = await page.evaluate(() => [...document.querySelectorAll(".evb__summary")]
      .filter((p) => p.checkVisibility({ visibilityProperty: true }))
      .map((p) => ({ id: p.dataset.group, power: p.querySelector("[data-o=power]")?.textContent ?? "", torque: p.querySelector("[data-o=torque]")?.textContent ?? "" })));
    await open(false);
    if (!plates.length) fail(`${kind}: keine Zusammenfassung auf der Werkbank`);
    for (const p of plates) {
      if (!filled(p.power) || !/PS/.test(p.power)) fail(`${kind}: Werkbank ${p.id}: Leistung „${p.power}“`);
      if (!filled(p.torque) || !/Nm/.test(p.torque)) fail(`${kind}: Werkbank ${p.id}: Drehmoment „${p.torque}“`);
    }
    sums[kind] = plates.find((p) => p.id === "ice-summary")?.power;

    // cockpit: the digital design's fields Leistung (PS) and Drehmoment (Nm), the head-up display's Leistung
    await page.selectOption('select[data-control="layout"]', "cockpit");
    {
      const d = "digital";
      await page.selectOption('select[data-control="ck-design"]', d);
      await page.waitForTimeout(300);
      const f = await page.evaluate(() => [...document.querySelectorAll(".ck .ck-field")]
        .filter((b) => b.checkVisibility({ visibilityProperty: true }))
        .map((b) => ({ label: b.querySelector(".ck-field__lab")?.textContent ?? "", value: b.querySelector(".ck-field__val")?.textContent ?? "", unit: b.querySelector(".ck-field__unit")?.textContent ?? "" })));
      const cp = f.find((x) => x.label === "Leistung");
      const ct = f.find((x) => x.label === "Drehmoment");
      if (!cp || cp.unit !== "PS" || !filled(cp.value)) fail(`${kind}: Cockpit ${d}: Leistung ${JSON.stringify(cp ?? null)}`);
      if (!ct || ct.unit !== "Nm" || !filled(ct.value)) fail(`${kind}: Cockpit ${d}: Drehmoment ${JSON.stringify(ct ?? null)}`);
    }
    await page.selectOption('select[data-control="ck-design"]', "hud");
    await page.waitForTimeout(300);
    const hud = await page.evaluate(() => {
      const v = document.querySelector('.ck [data-ck="hud-power"]');
      return v?.checkVisibility({ visibilityProperty: true }) ? `${v.textContent} ${document.querySelector('.ck [data-ck="hud-power-unit"]')?.textContent}` : null;
    });
    if (!filled(hud) || !/PS$/.test(hud)) fail(`${kind}: Cockpit hud: Leistung „${hud}“`);
  }
  // the hybrid's engine summary is its own engine, not the previous car's
  if (sums.Hybrid && sums.Hybrid === sums.Verbrenner) fail(`Hybrid-Zusammenfassung zeigt den Motor des vorigen Autos (${sums.Hybrid})`);
  await page.close();
}
