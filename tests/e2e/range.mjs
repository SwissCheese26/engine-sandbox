// Reichweite für alle: a combustion car on the chassis dyno shows its live range (range-estimator.ts) in every cockpit
// design next to the tank, and in the Prüfzelle next to the tank content. The range is a number in km, inside the
// screen, without horizontal overflow; the control bar (.deck) does not move while the value changes. On the engine
// dyno (no vehicle) it is hidden. Screenshots: smoke-<label>-range-<design>.png. Called from smoke.mjs.
import { join } from "node:path";

const DESIGNS = ["classic", "night-orange", "italian", "oldschool", "digital", "hud", "motorrad", "race", "truck", "etacho"];

export async function rangeChecks({ browser, base, outDir, failures, errors, label, viewport }) {
  const touch = viewport.width < 700;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const fail = (m) => failures.push(`${label}: Reichweite: ${m}`);
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(`${m.text()} ${m.location()?.url ?? ""}`)) errors.push(`${label}: console.error (Reichweite): ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (Reichweite): ${e.message}`));
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
  // VW Golf VII GTI (petrol) on the flat road
  await page.evaluate(() => window.__pruefzelle.applyPendingSetup({ kind: "car", vehicleId: "car-vw-golf7-gti", engineId: "ref-vw-ea888-gen3-chhb", route: "static" }));
  await page.waitForFunction(() => window.__pruefzelle.cfg.id === "ref-vw-ea888-gen3-chhb", null, { timeout: 5000 });
  const pick = (sel, v) => page.evaluate(([sel, v]) => {
    const e = document.querySelector(sel);
    if (e && e.value !== v) {
      e.value = v;
      e.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, [sel, v]);
  await pick('select[data-control="layout"]', "cockpit");
  await page.mouse.click(2, 2);
  await page.keyboard.press("i");
  await page.keyboard.down("a");
  await page.waitForTimeout(1200);
  await page.keyboard.up("a");
  await page.evaluate(() => {
    const d = window.__pruefzelle.gearbox.drivetrain;
    for (let i = 0; i < 8 && d.state.gear < 1; i++) d.shift(1);
  });

  /** The visible range readouts of the cockpit: text, box, page overflow, control bar position. */
  const read = () => page.evaluate(() => {
    const ck = document.querySelector(".stage__view .ck");
    const els = [...(ck?.querySelectorAll('[data-ck="range-mini"], [data-ck="range-main"], [data-ck="bike-range"], [data-rd="range"]') ?? [])];
    const vis = els.filter((e) => e.checkVisibility() && e.getBoundingClientRect().width > 0);
    const deck = document.querySelector(".deck")?.getBoundingClientRect();
    return {
      design: ck?.dataset.design, drive: ck?.dataset.drive,
      shown: vis.map((e) => {
        const r = e.getBoundingClientRect();
        return { k: e.dataset.ck ?? e.dataset.rd, text: e.textContent, left: Math.round(r.left), right: Math.round(r.right) };
      }),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vw: document.documentElement.clientWidth,
      deck: deck ? `${Math.round(deck.top)}|${Math.round(deck.height)}` : "",
    };
  });

  await page.keyboard.down(" ");
  for (const id of DESIGNS) {
    await pick('select[data-control="ck-design"]', id);
    await page.waitForTimeout(250);
    const a = await read();
    await page.waitForTimeout(600);
    const b = await read();
    const bad = [];
    if (b.design !== id || b.drive !== "ice") bad.push(`Design/Antrieb ${b.design}/${b.drive}`);
    if (!b.shown.length) bad.push("keine sichtbare Reichweite");
    for (const r of b.shown) {
      if (!/^\d[\d.]* (km|mi)$/.test(r.text ?? "")) bad.push(`Reichweite „${r.text}“`);
      if (r.left < 0 || r.right > b.vw) bad.push(`Reichweite außerhalb (${r.left}…${r.right} px)`);
    }
    if (b.overflow > 0) bad.push(`horizontaler Überlauf ${b.overflow} px`);
    if (a.deck !== b.deck) bad.push(`Bedienleiste bewegt sich (${a.deck} → ${b.deck})`);
    if (bad.length) fail(`${id}: ${bad.join(", ")} (${JSON.stringify(b.shown)})`);
    await page.screenshot({ path: join(outDir, `smoke-${label}-range-${id}.png`) });
  }
  await page.keyboard.up(" ");

  // Prüfzelle: Reichweite next to the tank content
  await pick('select[data-control="layout"]', "pruefzelle");
  await page.waitForTimeout(300);
  const pz = await page.evaluate(() => {
    const e = document.querySelector('.gearbox [data-out="range"]');
    return { vis: !!e && e.checkVisibility(), text: e?.textContent ?? "" };
  });
  if (!pz.vis || !/^\d[\d.]* (km|mi)$/.test(pz.text)) fail(`Prüfzelle ohne Reichweite neben dem Tank (${JSON.stringify(pz)})`);

  // engine dyno without a vehicle: no range in the cockpit
  await pick('select[data-control="layout"]', "cockpit");
  await page.evaluate(() => {
    const d = window.__pruefzelle.gearbox.drivetrain;
    for (let i = 0; i < 12 && d.state.gear > 0; i++) d.shift(-1);
  });
  await pick('select[data-control="mode"]', "free");
  for (const id of ["classic", "digital", "race"]) {
    await pick('select[data-control="ck-design"]', id);
    await page.waitForTimeout(250);
    const r = await read();
    if (r.shown.length) fail(`Motorprüfstand zeigt Reichweite (${id}: ${JSON.stringify(r.shown)})`);
  }
  console.log(`${label}: Reichweite in ${DESIGNS.length} Designs und der Prüfzelle geprüft`);
  await page.close();
}
