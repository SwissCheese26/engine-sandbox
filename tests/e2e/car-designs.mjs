// Car-style cockpit designs (skins, designs.ts `layout`): "Spanisch Kupfer (digital)", "Ingolstadt Rot", "München
// Orange". A combustion car on the chassis dyno with extra gauges incl. gearbox oil: each design keeps its base layout
// (data-design) and shows its skin (data-skin), with the parking-brake P lamp, the range, the tank, the extra gauges and
// the cruise control; München Orange puts the consumption gauge inside the rev counter. No horizontal overflow, the
// control bar (.deck) does not move. "Automatisch" with a car that brings its own cluster picks that design.
// Screenshots: smoke-<label>-cardesign-<id>.png. Called from smoke.mjs.
import { join } from "node:path";
import { deckOverlaps } from "./deck.mjs";

const DESIGNS = [["copper-digital", "digital"], ["ingolstadt-red", "classic"], ["munich-orange", "classic"]];

export async function carDesignChecks({ browser, base, outDir, failures, errors, label, viewport }) {
  const touch = viewport.width < 700;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const fail = (m) => failures.push(`${label}: Fahrzeug-Designs: ${m}`);
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(`${m.text()} ${m.location()?.url ?? ""}`)) errors.push(`${label}: console.error (Fahrzeug-Designs): ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (Fahrzeug-Designs): ${e.message}`));
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
  const pick = (sel, v) => page.evaluate(([sel, v]) => {
    const e = document.querySelector(sel);
    if (e && e.value !== v) {
      e.value = v;
      e.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, [sel, v]);
  await pick('select[data-control="layout"]', "cockpit");
  // extra gauges incl. gearbox oil (offered on the chassis dyno), picked like a player does
  await page.click(".ck__extras > summary");
  for (const id of ["oilT", "gearOil"]) await page.check(`.ck__extras [data-gauge="${id}"]`);
  await page.click(".ck__extras > summary");
  await page.mouse.click(2, 2);
  await page.keyboard.press("i");
  await page.keyboard.down("a");
  await page.waitForTimeout(1000);
  await page.keyboard.up("a");
  await page.evaluate(() => {
    const d = window.__pruefzelle.gearbox.drivetrain;
    for (let i = 0; i < 8 && d.state.gear < 1; i++) d.shift(1);
  });

  const read = () => page.evaluate(() => {
    const ck = document.querySelector(".stage__view .ck");
    const vis = (sel) => [...(ck?.querySelectorAll(sel) ?? [])].some((e) => e.checkVisibility() && e.getBoundingClientRect().width > 0);
    const deck = document.querySelector(".deck")?.getBoundingClientRect();
    const fuel = ck?.querySelector('.ck-mini[data-mini="fuel"]');
    return {
      design: ck?.dataset.design, skin: ck?.dataset.skin,
      park: vis('[data-lamp="park"]'),
      range: vis('[data-ck="range-mini"], [data-ck="range-main"]'),
      tank: vis('.ck-mini[data-mini="tank"], [data-field]'),
      gearOil: vis('.ck-pod[data-pod="gearOil"]'),
      cruise: vis(".ck__cruisectl > *"),
      inset: !!fuel?.closest('[data-slot="rpm"]') && fuel.checkVisibility(),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      deck: deck ? `${Math.round(deck.top)}|${Math.round(deck.height)}` : "",
    };
  });

  await page.keyboard.down(" ");
  for (const [id, layout] of DESIGNS) {
    await pick('select[data-control="ck-design"]', id);
    await page.waitForTimeout(250);
    const a = await read();
    await page.waitForTimeout(600);
    const b = await read();
    const bad = [];
    if (b.skin !== id || b.design !== layout) bad.push(`Skin/Layout ${b.skin}/${b.design}`);
    for (const k of ["park", "range", "tank", "gearOil", "cruise"]) if (!b[k]) bad.push(`${k} nicht sichtbar`);
    if (b.inset !== (id === "munich-orange")) bad.push(`Verbrauchsanzeige im Drehzahlmesser: ${b.inset}`);
    if (b.overflow > 0) bad.push(`horizontaler Überlauf ${b.overflow} px`);
    if (a.deck !== b.deck) bad.push(`Bedienleiste bewegt sich (${a.deck} → ${b.deck})`);
    bad.push(...(await deckOverlaps(page)).map((m) => `Bedienleiste: ${m}`));
    if (bad.length) fail(`${id}: ${bad.join(", ")}`);
    await page.evaluate(() => document.querySelector(".stage__view .ck")?.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(outDir, `smoke-${label}-cardesign-${id}.png`) });
  }
  await page.keyboard.up(" ");

  // back to a plain design: the consumption gauge returns to the strip
  await pick('select[data-control="ck-design"]', "classic");
  await page.waitForTimeout(200);
  if ((await read()).inset) fail("Verbrauchsanzeige bleibt im Drehzahlmesser");

  // "Automatisch": a car that brings its own cluster (id pattern of designs.ts) picks it, others keep the rules
  await pick('select[data-control="ck-design"]', "auto");
  await page.evaluate(() => (window.__pruefzelle.gearbox.vehiclePanel.loadedId = "car-audi-a1-8x-14tfsi"));
  await page.waitForTimeout(300);
  const auto = await read();
  if (auto.skin !== "ingolstadt-red") fail(`Automatisch wählt für den A1 8X ${auto.skin}`);
  await page.evaluate(() => (window.__pruefzelle.gearbox.vehiclePanel.loadedId = "car-vw-golf7-gti"));
  await page.waitForTimeout(300);
  const back = await read();
  if (back.skin !== "classic") fail(`Automatisch wählt für den Golf ${back.skin}`);
  console.log(`${label}: ${DESIGNS.length} Fahrzeug-Designs und Automatisch geprüft`);
  await page.close();
}
