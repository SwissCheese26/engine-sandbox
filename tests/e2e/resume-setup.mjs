// #156: drive car A, leave for the Hauptmenü while rolling, pick car B in the wizard, Losfahren: car B and its engine
// are loaded (the running App takes the pending setup on resume). Called from smoke.mjs.
export async function resumeSetupChecks({ browser, base, failures, errors, label, viewport }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const fail = (m) => failures.push(`${label}: Fahrzeugwechsel (#156): ${m}`);
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (Fahrzeugwechsel): ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base, { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("pruefzelle.settings", JSON.stringify({ layout: "cockpit", cockpitDesign: "classic", sandboxIntro: false }));
  });
  await page.goto(base + "#sandbox", { waitUntil: "load" });
  if (await page.isVisible('.wizard[open] [data-pick="engine"]')) {
    await page.click('.wizard [data-pick="engine"]');
    if (await page.isVisible('.wizard[open] [data-nav="next"]')) await page.click('.wizard[open] [data-nav="next"]');
  }
  await page.waitForFunction(() => !!window.__pruefzelle);
  await page.evaluate(() => window.__pruefzelle.applyPendingSetup({ kind: "car", vehicleId: "car-vw-golf7-gti", engineId: "ref-vw-ea888-gen3-chhb", route: "static" }));
  await page.waitForFunction(() => window.__pruefzelle.cfg.id === "ref-vw-ea888-gen3-chhb", null, { timeout: 5000 });
  // roll: speed > 0 when the menu is opened
  await page.mouse.click(2, 2);
  await page.keyboard.press("i");
  await page.keyboard.down("a");
  await page.waitForTimeout(1200);
  await page.keyboard.up("a");
  await page.evaluate(() => {
    const d = window.__pruefzelle.gearbox.drivetrain;
    for (let i = 0; i < 8 && d.state.gear < 1; i++) d.shift(1);
  });
  await page.keyboard.down("w");
  await page.waitForFunction(() => window.__pruefzelle.gearbox.drivetrain.state.speedKmh > 5, null, { timeout: 8000 }).catch(() => {});
  await page.keyboard.up("w");
  const speed = await page.evaluate(() => window.__pruefzelle.gearbox.drivetrain.state.speedKmh);
  if (!(speed > 0.5)) fail(`Auto A rollt nicht (${speed}, ${await page.evaluate(() => JSON.stringify({ g: window.__pruefzelle.gearbox.drivetrain.state.gear, run: window.__pruefzelle.sim.state.running, rpm: Math.round(window.__pruefzelle.sim.state.rpm), th: window.__pruefzelle.sim.state.throttle }))})`);
  await page.goto(base + "#menu");
  await page.click('a.door[data-mode="sandbox"]');
  await page.click('.wizard[open] [data-kind="car"]');
  await page.click('.wizard[open] input[name="vehicle"][value="car-vw-golf6-tdi"]', { force: true });
  await page.click('.wizard[open] [data-nav="next"]');
  await page.click('.wizard[open] input[name="route"][value="static"]', { force: true });
  await page.click('.wizard[open] [data-nav="next"]');
  await page.click('.wizard[open] [data-nav="next"]'); // Losfahren
  await page.waitForFunction(() => location.hash === "#sandbox" && !window.__pruefzelle.isPaused, null, { timeout: 5000 });
  const r = await page.waitForFunction(() => window.__pruefzelle.cfg.id === "lib-vw-ea189-20tdi-103kw", null, { timeout: 5000 }).then(() => true, () => false);
  if (!r) fail(`Motor von Auto B nicht geladen (${await page.evaluate(() => window.__pruefzelle.cfg.id)})`);
  const car = await page.evaluate(() => window.__pruefzelle.gearbox.vehiclePanel.el.textContent);
  if (!/Golf 6/.test(car)) fail("Fahrzeug B nicht geladen");
  await page.close();
}
