// E2E for hybrid drives (#157), run from smoke.mjs: the Prius in the Prüfzelle and every cockpit design (power flow,
// tank, SoC, EV lamp visible; no overflow; the control bar at the same place as for an electric car), Ready, electric
// start with a light pedal (engine off, EV lamp on, battery → motor), full throttle starts the engine (engine → wheels
// in the power flow), the operating modes in the drive-mode slot.
import { join } from "node:path";
import { deckOverlaps } from "./deck.mjs";

const DESIGNS = ["classic", "night-orange", "italian", "oldschool", "digital", "hud", "race", "motorrad", "truck", "etacho"];
const SLOTS = [".console__group--main", ".console__group--dyno", ".console__group--aux", ".shiftpad", ".parkbtn", ".brakepedal", ".pedal"];

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
  await page.waitForTimeout(400);
}

const slots = (page) => page.evaluate((sels) => Object.fromEntries(sels.map((s) => {
  const e = document.querySelector(`.deck ${s}`);
  if (!e || !e.checkVisibility({ visibilityProperty: true })) return [s, null];
  const r = e.getBoundingClientRect();
  return [s, [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]];
})), SLOTS);

async function view(page, v) {
  if (v === "pruefzelle") await page.selectOption('select[data-control="layout"]', "pruefzelle");
  else {
    await page.selectOption('select[data-control="layout"]', "cockpit");
    await page.selectOption('select[data-control="ck-design"]', v);
  }
  await page.waitForTimeout(150);
}

const hy = (page) => page.evaluate(() => {
  const a = window.__pruefzelle;
  const h = a.evSim?.state?.hybrid;
  const f = [...document.querySelectorAll(".hyflow")].find((e) => e.checkVisibility({ visibilityProperty: true }));
  const st = (k) => f?.querySelector(`[data-a="${k}"]`)?.dataset.state ?? null;
  return {
    on: !!h?.engineOn, ev: !!h?.evDrive, kmh: a.gearbox.drivetrain.state.speedKmh, mode: h?.mode,
    flow: !!f, lamp: f?.querySelector("[data-hy=ev]")?.dataset.state ?? null, engWheel: st("eng-wheel"), batMot: st("bat-mot"),
    soc: f?.querySelector("[data-hy=soc]")?.textContent ?? "", tank: f?.querySelector("[data-hy=tank]")?.textContent ?? "",
  };
});

export async function hybridChecks({ browser, base, outDir, failures, errors, label, viewport }) {
  const touch = viewport.width < 700;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const fail = (m) => failures.push(`${label}: Hybrid: ${m}`);
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(`${m.text()} ${m.location()?.url ?? ""}`)) errors.push(`${label}: console.error (Hybrid): ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (Hybrid): ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`${base}#sandbox`, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__pruefzelle);

  // --- layout: every view, the control bar where it is for an electric car -------------------------------------
  const views = ["pruefzelle", ...DESIGNS];
  const pos = { ev: {}, hy: {} };
  for (const [kind, car] of [["ev", "ev-tesla-model-s-lr"], ["hy", "hy-toyota-prius-4"]]) {
    await view(page, "pruefzelle");
    await loadCar(page, car);
    for (const v of views) {
      await view(page, v);
      pos[kind][v] = await slots(page);
      if (kind !== "hy") continue;
      for (const m of await deckOverlaps(page)) fail(`${v}: Bedienleiste: ${m}`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) fail(`${v}: horizontaler Überlauf ${over} px`);
      const h = await hy(page);
      if (!h.flow) fail(`${v}: keine Energiefluss-Anzeige`);
    }
  }
  for (const v of views) for (const s of SLOTS) {
    if (JSON.stringify(pos.ev[v][s]) !== JSON.stringify(pos.hy[v][s])) fail(`${v}: ${s} springt zwischen Elektro ${JSON.stringify(pos.ev[v][s])} und Hybrid ${JSON.stringify(pos.hy[v][s])}`);
  }
  const modes = await page.$$eval(".evmode [data-mode]", (b) => b.map((x) => x.textContent).join(","));
  if (modes !== "Hybrid,EV,Sport,Laden") fail(`Betriebsarten ${modes}`);
  const bench = await page.evaluate(() => ({ id: window.__pruefzelle.bench.config.id, evb: !document.querySelector(".evb")?.hidden }));
  if (bench.id !== "lib-toyota-2zr-fxe" || !bench.evb) fail(`Werkbank zeigt nicht Motor und E-Teile (${JSON.stringify(bench)})`);

  // --- drive: electric start, engine on full throttle, power flow follows ---------------------------------------
  await view(page, "classic");
  await page.click(".readybtn");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = window.__pruefzelle.console;
    c.lever = 0.35;
    c.renderPedal?.();
  });
  await page.waitForTimeout(2500);
  const evStart = await hy(page);
  if (!(evStart.kmh > 3) || evStart.on || evStart.lamp !== "on" || evStart.batMot !== "fwd") fail(`elektrisch anfahren (${JSON.stringify(evStart)})`);
  await page.screenshot({ path: join(outDir, `smoke-${label}-hybrid-ev.png`) });
  await page.evaluate(() => (window.__pruefzelle.console.lever = 0));
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  const full = await hy(page);
  await page.keyboard.up("w");
  if (!full.on || full.engWheel !== "on" || full.lamp !== "off" || !(full.kmh > evStart.kmh + 15)) fail(`Vollgas startet den Motor nicht / Energiefluss steht (${JSON.stringify(full)})`);
  if (!/%/.test(full.soc) || !/l/.test(full.tank)) fail(`Tank / Akku fehlen (${full.tank}, ${full.soc})`);
  await page.screenshot({ path: join(outDir, `smoke-${label}-hybrid-full.png`) });
  // operating mode in the drive-mode slot
  await page.click('.evmode [data-mode="sport"]');
  await page.waitForTimeout(200);
  const sport = await hy(page);
  if (sport.mode !== "sport") fail(`Betriebsart Sport nicht übernommen (${sport.mode})`);
  await page.keyboard.down("s");
  await page.waitForFunction(() => window.__pruefzelle.gearbox.drivetrain.state.speedKmh < 0.5, null, { timeout: 30000 }).catch(() => fail("bremst nicht bis zum Stand"));
  await page.keyboard.up("s");
  console.log(`${label}: Hybrid Prius EV ${evStart.kmh.toFixed(0)} km/h (Motor aus), Vollgas ${full.kmh.toFixed(0)} km/h (Motor an)`);
  await page.close();
}
