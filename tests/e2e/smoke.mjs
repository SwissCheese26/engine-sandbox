// E2E smoke test (issue #7). Does NOT build: run `bun scripts/build.ts` first.
// Since #42 the page opens with the main menu: the test shoots the menu and the settings, enters the
// sandbox through its door, and at the end checks Esc (back to the menu) and reload (#sandbox stays).
// Serves dist/ with a tiny built-in node:http server, loads the app, fails on console/page errors,
// starts the engine with the keyboard (I = ignition, hold S = starter, hold Space = throttle),
// checks that the rpm readout rises, and writes screenshots (1440×900, 390×844, 360×740) to
// tests/e2e/screenshots/.
//
// The rpm is read from the visible readout ([data-gauge="rpm"] .gauge__value), not from a debug hook.
// Skip ("UI noch nicht vorhanden – übersprungen", exit 0) only when the UI root is missing (#app has
// no rendered element); any other missing part is a real failure (exit 1).
//
// Usage: node tests/e2e/smoke.mjs [outDir]
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve } from "node:path";
import { builderChecks } from "./builder.mjs";
import { evChecks } from "./ev.mjs";
import { smokeFxChecks } from "./smoke-fx.mjs";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require("/opt/node22/lib/node_modules/playwright");
}

const root = resolve("dist");
const outDir = resolve(process.argv[2] ?? "tests/e2e/screenshots");

if (!existsSync(join(root, "index.html"))) {
  console.error("dist/index.html fehlt – bitte zuerst `bun scripts/build.ts` ausführen.");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const rel = normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)).replace(/^([/\\])+/, "");
  const file = join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(outDir, { recursive: true });

const browser = await playwright.chromium.launch();
const errors = [];
const failures = [];
let skipped = false;

/** Ignore only failures of the optional Google Fonts hosts (offline in CI/sandbox). */
const external = (text) => /fonts\.(googleapis|gstatic)\.com/.test(text);

const RPM_READOUT = '[data-gauge="rpm"] .gauge__value';

/** Reads the visible rpm readout (German format "4.750" → 4750). NaN if missing or unreadable. */
async function readRpm(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const text = (el?.textContent ?? "").trim();
    if (!/\d/.test(text)) return NaN;
    return Number(text.replace(/[\s.  ]/g, "").replace(",", "."));
  }, RPM_READOUT);
}

async function run(label, viewport) {
  // the phone run is a touch device, so the brake pedal (shown on touch screens only) is tested there
  const touch = label !== "desktop";
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = `${m.text()} ${m.location()?.url ?? ""}`;
    if (!external(text)) errors.push(`${label}: console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror: ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  await page.goto(base, { waitUntil: "load" });
  await page.waitForTimeout(500);

  // Skip only when the UI root is missing (#app has no rendered element). Missing gauges or
  // controls inside a rendered UI are real failures (exit 1).
  const hasUiRoot = await page.evaluate(() => (document.getElementById("app")?.childElementCount ?? 0) > 0);
  if (!hasUiRoot) {
    skipped = true;
    await page.screenshot({ path: join(outDir, `smoke-${label}-placeholder.png`) });
    await page.close();
    return;
  }

  // main menu (#42) and settings (#24), then into the sandbox through Tor 1
  if (!(await page.$(".hall"))) failures.push(`${label}: Hauptmenü fehlt`);
  await page.screenshot({ path: join(outDir, `smoke-${label}-menu.png`) });
  // "Fehler melden" (#55) in the hall: opens the dialog, Abbrechen closes it
  await page.click('.hall [data-action="bug-report"]');
  if (!(await page.isVisible("dialog.bugreport[open]"))) failures.push(`${label}: Fehler-melden-Dialog öffnet im Menü nicht`);
  // the menu dialogs share the .routepick base (review PR #95): box in the hall colours, dimmed backdrop
  const look = await page.evaluate(() => {
    const d = document.querySelector("dialog.bugreport[open]");
    const cs = getComputedStyle(d);
    return { cls: d.classList.contains("routepick"), bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, backdrop: getComputedStyle(d, "::backdrop").backgroundColor, width: d.getBoundingClientRect().width };
  });
  if (!look.cls || look.bg !== "rgb(46, 58, 53)" || look.radius !== "8px" || !/rgba\(10, 14, 12, 0\.72\)/.test(look.backdrop) || look.width > 720)
    failures.push(`${label}: Fehler-melden-Dialog ungestylt (${JSON.stringify(look)})`);
  await page.click('dialog.bugreport [data-action="cancel"]');
  await whatsNew(page, label);
  await credits(page, label);
  await page.click('a[href="#settings"]:visible');
  await page.waitForSelector('[data-screen="settings"]:not([hidden]) input[name="preset"]');
  await page.screenshot({ path: join(outDir, `smoke-${label}-settings.png`), fullPage: true });
  await settingsChecks(page, label);
  await page.click('.office__top a[href="#menu"]');
  await page.waitForSelector('[data-screen="menu"]:not([hidden])');
  await page.click('a.door[href="#sandbox"]');
  // the guided start (#93) opens first; the smoke test starts on the engine dyno
  await wizardEngine(page);
  await page.waitForSelector(RPM_READOUT, { state: "visible" });
  await page.waitForTimeout(300);

  await page.screenshot({ path: join(outDir, `smoke-${label}-idle.png`) });
  if (touch) await touchChecks(page, label);
  for (const sel of [RPM_READOUT, '[data-control="ignition"]', '[data-control="starter"]']) {
    if (!(await page.$(sel))) failures.push(`${label}: Element ${sel} fehlt`);
  }
  const rpm0 = await readRpm(page);
  const deckH0 = await deckHeight(page);

  // focus the document (not a button) so the global key handler receives the keys
  await page.mouse.click(2, 2);
  await page.keyboard.press("i");
  await page.keyboard.down("a");
  await page.waitForTimeout(1200);
  await page.keyboard.up("a");
  await page.waitForTimeout(800);
  const rpmIdle = await readRpm(page);

  await page.keyboard.down(" ");
  await page.waitForTimeout(2000);
  const rpmGas = await readRpm(page);
  await page.screenshot({ path: join(outDir, `smoke-${label}-full-throttle.png`) });
  await page.keyboard.up(" ");
  await deckStaysStill(page, label, deckH0);

  // a key press on a touch device (tablet with keyboard) switches the hints back live (#44)
  if (touch && (await page.evaluate(() => document.documentElement.classList.contains("is-touch")))) failures.push(`${label}: Tastendruck schaltet nicht auf Tastatur-Hinweise um`);
  const ignitionOn = await page.evaluate(() => {
    const v = document.querySelector('[data-control="ignition"]')?.getAttribute("aria-checked");
    return v == null ? null : v === "true";
  });

  console.log(`${label}: rpm vor Start ${fmt(rpm0)}, nach Start ${fmt(rpmIdle)}, mit Gas ${fmt(rpmGas)}, Zündung ${ignitionOn}`);
  if (ignitionOn === false) failures.push(`${label}: Zündung (I) wurde nicht eingeschaltet`);
  if (!Number.isFinite(rpmGas) || !Number.isFinite(rpmIdle)) failures.push(`${label}: Drehzahlanzeige nicht lesbar`);
  else if (!(rpmGas > Math.max(rpmIdle, rpm0 || 0) + 300)) failures.push(`${label}: Drehzahl steigt nicht (Leerlauf ${fmt(rpmIdle)}, Gas ${fmt(rpmGas)})`);
  if (Number.isFinite(rpmIdle) && !(rpmIdle > 200)) failures.push(`${label}: Motor springt nicht an (rpm ${fmt(rpmIdle)})`);

  await gearsChecks(page, label);
  await bugReport(page, label);

  // Esc leads back to the menu, the sandbox pauses; reload keeps the mode in the URL
  await page.mouse.click(2, 2);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const back = await page.evaluate(() => ({ hash: location.hash, menu: !document.querySelector('[data-screen="menu"]')?.hidden, paused: window.__pruefzelle?.isPaused }));
  if (back.hash !== "#menu" || !back.menu || back.paused !== true) failures.push(`${label}: Esc führt nicht ins Menü (${JSON.stringify(back)})`);
  await page.goto(base + "#sandbox", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(300);
  if (!(await page.isVisible(RPM_READOUT))) failures.push(`${label}: Neuladen mit #sandbox öffnet die Sandbox nicht`);

  await layouts(page, label);

  await page.close();
  await wizard(label, viewport, touch);
}

/**
 * Step 2 of a library list: "Weitere folgen …" at the end, "+ Neues erstellen" opens the own-vehicle form with the
 * list's base type (Auto), Zurück returns to the list. Tyre picker in the form: one row, no overflow, 44 px.
 */
async function createOwnChecks(page, label) {
  const more = await page.isVisible('.wizard .wizard__more');
  if (!more) failures.push(`${label}: „Weitere folgen …“ fehlt in der Fahrzeugliste`);
  await page.click('.wizard [data-action="create-own"]');
  const st = await page.evaluate(() => ({
    form: !document.querySelector('.wizard [data-out="custom"]').hidden,
    base: document.querySelector('.wizard [data-c="base"]').value,
    title: document.querySelector("#wiz-h2").textContent,
    step: document.querySelector('.wizard [aria-current="step"]')?.dataset.stepMark,
  }));
  if (!st.form || st.base !== "car" || st.step !== "2") failures.push(`${label}: „Neues erstellen“ öffnet das Formular nicht mit Fahrzeugtyp Auto (${JSON.stringify(st)})`);
  const pick = await page.evaluate(() => {
    const sel = [...document.querySelectorAll(".wizard .tyrepick select")];
    const tops = new Set(sel.map((s) => Math.round(s.getBoundingClientRect().top)));
    const d = document.querySelector(".wizard[open]");
    return { n: sel.length, oneRow: tops.size === 1, minH: Math.min(...sel.map((s) => s.getBoundingClientRect().height)), overflow: d.scrollWidth - d.clientWidth };
  });
  if (pick.n !== 3 || !pick.oneRow || pick.minH < 44 || pick.overflow > 0) failures.push(`${label}: Reifenwahl im Formular nicht in einer Zeile / zu klein / scrollt (${JSON.stringify(pick)})`);
  await page.screenshot({ path: join(outDir, `smoke-${label}-wizard-create-own.png`) });
  await page.click('.wizard [data-nav="back"]');
  const back = await page.evaluate(() => ({
    list: !document.querySelector('.wizard [data-out="vehicles"]').hidden,
    golf: !!document.querySelector('.wizard__vehicle input[value="car-vw-golf7-gti"]'),
    step: document.querySelector('.wizard [aria-current="step"]')?.dataset.stepMark,
  }));
  if (!back.list || !back.golf || back.step !== "2") failures.push(`${label}: Zurück aus „Neues erstellen“ führt nicht zur Liste (${JSON.stringify(back)})`);
}

/**
 * Tyre size picker in the Fahrzeug-Platte: another width changes the readout (size, diameter, circumference) and the
 * fitted tyre; three selects in one row, no horizontal scroll, 44 px on touch layouts.
 */
async function tyreChecks(page, label) {
  const read = () => page.evaluate(() => ({
    text: document.querySelector('.vehicle [data-out="tyre-size"]')?.textContent ?? "",
    width: window.__pruefzelle?.gearbox.drivetrain.tyre.size.widthMm,
  }));
  const before = await read();
  const cur = await page.evaluate(() => document.querySelector('.vehicle [data-control="tyre-width"]')?.value);
  const next = cur === "235" ? "245" : "235";
  await page.evaluate((v) => {
    const sel = document.querySelector('.vehicle [data-control="tyre-width"]');
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, next);
  await page.waitForTimeout(100);
  const after = await read();
  if (!/^\d{3}\/\d{2} R\d+ · Ø \d+ mm · Abrollumfang \d,\d\d m$/.test(after.text) || after.text === before.text || !after.text.startsWith(`${next}/`) || after.width !== Number(next))
    failures.push(`${label}: Reifenbreite ändert die Anzeige nicht („${before.text}“ → „${after.text}“, Breite ${after.width})`);
  const vis = await page.isVisible(".vehicle .tyrepick");
  if (vis) {
    await page.locator(".vehicle .tyrepick").scrollIntoViewIfNeeded();
    const sz = await page.evaluate(() => {
      const sel = [...document.querySelectorAll(".vehicle .tyrepick select")];
      return {
        oneRow: new Set(sel.map((s) => Math.round(s.getBoundingClientRect().top))).size === 1,
        minH: Math.min(...sel.map((s) => s.getBoundingClientRect().height)),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    if (!sz.oneRow || sz.minH < 44 || sz.overflow > 0) failures.push(`${label}: Reifenwahl in der Fahrzeug-Platte ungünstig (${JSON.stringify(sz)})`);
    await page.locator(".vehicle .tyrepick").screenshot({ path: join(outDir, `smoke-${label}-tyre-picker.png`) });
  }
  console.log(`${label}: Reifen ${before.text} → ${after.text}`);
  // back to the car's own size for the later steps
  await page.evaluate((v) => {
    const sel = document.querySelector('.vehicle [data-control="tyre-width"]');
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, cur);
}

/** Guided start (#93), step 1 "Nur Motorprüfstand": straight to "Kurz erklärt", then "Losfahren". */
async function wizardEngine(page) {
  await page.click('.wizard [data-pick="engine"]');
  if (await page.isVisible('.wizard[open] [data-nav="next"]')) await page.click('.wizard[open] [data-nav="next"]');
}

/**
 * #93 Guided start on a fresh page: step indicator and heading focus, Esc cancels, 44 px targets and no horizontal
 * overflow, own-vehicle validation, and one full run Auto → Golf 7 GTI → Alpen → Losfahren that loads car, engine
 * and route in the sandbox.
 */
async function wizard(label, viewport, touch) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (Assistent): ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base, { waitUntil: "load" });
  await page.click('a.door[href="#sandbox"]');
  await page.waitForSelector(".wizard[open] [data-step='1']:not([hidden])");
  await page.waitForTimeout(150);
  const fit = () => page.evaluate(() => {
    const d = document.querySelector(".wizard[open]");
    const step = d.querySelector(".wizard__step:not([hidden])");
    const targets = [...step.querySelectorAll("button, .wizard__vehicle, .routepick__card, input:not([type=radio]):not([type=checkbox]), select, .wizard__hide"), ...d.querySelectorAll(".wizard__foot .btn:not([hidden])")]
      .filter((e) => e.getClientRects().length && !e.closest("[hidden]"));
    return {
      focus: document.activeElement?.id ?? "",
      minH: Math.min(...targets.map((e) => e.getBoundingClientRect().height)),
      overflow: Math.max(d.scrollWidth - d.clientWidth, document.documentElement.scrollWidth - window.innerWidth),
      current: d.querySelector('[aria-current="step"]')?.dataset.stepMark,
    };
  });
  const checkStep = async (n) => {
    const f = await fit();
    if (f.focus !== `wiz-h${n}` || f.current !== String(n)) failures.push(`${label}: Assistent Schritt ${n}: Fokus/Anzeige falsch (${JSON.stringify(f)})`);
    if (f.overflow > 0) failures.push(`${label}: Assistent Schritt ${n} läuft horizontal über (${f.overflow} px)`);
    if (touch && f.minH < 44) failures.push(`${label}: Assistent Schritt ${n}: Bedienelement unter 44 px (${f.minH})`);
  };
  await checkStep(1);
  await page.screenshot({ path: join(outDir, `smoke-${label}-wizard-step1.png`) });
  // Esc cancels: dialog closed, still in the menu
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const esc = await page.evaluate(() => ({ open: !!document.querySelector(".wizard[open]"), hash: location.hash }));
  if (esc.open || esc.hash === "#sandbox") failures.push(`${label}: Esc bricht den Assistenten nicht ab (${JSON.stringify(esc)})`);

  // own vehicle: a bad weight is refused with a message at the field
  await page.click('a.door[href="#sandbox"]');
  await page.click('.wizard [data-kind="custom"]');
  await checkStep(2);
  await page.fill('.wizard [data-c="massKg"]', "abc");
  await page.click('.wizard [data-nav="next"]');
  const bad = await page.evaluate(() => ({
    invalid: document.querySelector('.wizard [data-c="massKg"]').getAttribute("aria-invalid"),
    msg: document.querySelector("#wiz-err-massKg").textContent,
    step: document.querySelector('.wizard [aria-current="step"]').dataset.stepMark,
  }));
  if (bad.invalid !== "true" || !bad.msg || bad.step !== "2") failures.push(`${label}: eigenes Fahrzeug ohne Prüfung (${JSON.stringify(bad)})`);
  await page.screenshot({ path: join(outDir, `smoke-${label}-wizard-custom.png`) });
  await page.click('.wizard [data-nav="back"]');

  // full run: Auto → Golf 7 GTI → Alpen → Losfahren
  await page.click('.wizard [data-kind="car"]');
  await createOwnChecks(page, label);
  await page.click('.wizard__vehicle:has(input[value="car-vw-golf7-gti"])');
  await page.screenshot({ path: join(outDir, `smoke-${label}-wizard-step2.png`) });
  await page.click('.wizard [data-nav="next"]');
  await checkStep(3);
  await page.click('.routepick__card:has(input[value="alps"])');
  await page.click('.wizard [data-nav="next"]');
  await checkStep(4);
  await page.screenshot({ path: join(outDir, `smoke-${label}-wizard-step4.png`) });
  // sticky footer (review PR #95): "Losfahren" in view without scrolling the cheat sheet
  const foot = await page.evaluate(() => {
    const r = document.querySelector('.wizard [data-nav="next"]').getBoundingClientRect();
    const d = document.querySelector(".wizard[open]");
    return { bottom: Math.round(r.bottom), top: Math.round(r.top), vh: window.innerHeight, scrolls: d.scrollHeight > d.clientHeight };
  });
  if (foot.bottom > foot.vh || foot.top < 0) failures.push(`${label}: „Losfahren“ außerhalb des Bildschirms (${JSON.stringify(foot)})`);
  const go = (await page.textContent('.wizard [data-nav="next"]'))?.trim();
  if (go !== "Losfahren") failures.push(`${label}: Schritt 4 ohne „Losfahren“ („${go}“)`);
  await page.click('.wizard [data-nav="next"]');
  await page.waitForSelector(RPM_READOUT, { state: "visible" });
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => {
    const a = window.__pruefzelle;
    return {
      hash: location.hash, car: a?.gearbox.vehiclePanel.carId, terrain: a?.gearbox.drivetrain.environment.terrain,
      engine: a?.cfg.id, mode: document.querySelector('select[data-control="mode"]')?.value,
    };
  });
  const want = { hash: "#sandbox", car: "car-vw-golf7-gti", terrain: "alps", engine: "ref-vw-ea888-gen3-chhb", mode: "vehicle" };
  if (JSON.stringify(st) !== JSON.stringify(want)) failures.push(`${label}: Assistent übernimmt Fahrzeug/Strecke nicht (${JSON.stringify(st)})`);
  console.log(`${label}: Assistent ${JSON.stringify(st)}`);

  // own vehicle survives a reload (review PR #95): build one, reload, it is back; the form is prefilled
  await page.mouse.click(2, 2);
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-screen="menu"]:not([hidden])');
  await page.click('a.door[href="#sandbox"]');
  await page.click('.wizard [data-kind="custom"]');
  await page.fill('.wizard [data-c="massKg"]', "1.300");
  await page.fill('.wizard [data-c="cw"]', "0,28");
  // tyre size from three lists (no free text)
  await page.selectOption('.wizard [data-control="tyre-width"]', "205");
  await page.selectOption('.wizard [data-control="tyre-aspect"]', "55");
  await page.selectOption('.wizard [data-control="tyre-rim"]', "16");
  await page.selectOption('.wizard [data-c="drive"]', "rwd");
  await page.click('.wizard [data-nav="next"]');
  await page.click('.routepick__card:has(input[value="flat"])');
  await page.click('.wizard [data-nav="next"]');
  await page.click('.wizard [data-nav="next"]');
  await page.waitForSelector(RPM_READOUT, { state: "visible" });
  await page.waitForTimeout(400);
  const ownState = () => page.evaluate(() => {
    const a = window.__pruefzelle;
    const v = a?.gearbox.drivetrain.vehicle;
    return {
      car: a?.gearbox.vehiclePanel.carId, mass: v?.massKg, cw: v?.dragCoefficient, drive: v?.driveLayout, engine: a?.cfg.id,
      terrain: a?.gearbox.drivetrain.environment.terrain, mode: document.querySelector('select[data-control="mode"]')?.value,
    };
  });
  const wantOwn = { car: "", mass: 1300, cw: 0.28, drive: "rwd", engine: "lib-vw-ea189-20tdi-103kw", terrain: "flat", mode: "vehicle" };
  const before = await ownState();
  if (JSON.stringify(before) !== JSON.stringify(wantOwn)) failures.push(`${label}: eigenes Fahrzeug nicht übernommen (${JSON.stringify(before)})`);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(RPM_READOUT, { state: "visible" });
  await page.waitForTimeout(400);
  const after = await ownState();
  if (JSON.stringify(after) !== JSON.stringify(wantOwn)) failures.push(`${label}: eigenes Fahrzeug nach Neuladen weg (${JSON.stringify(after)})`);
  await page.mouse.click(2, 2);
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-screen="menu"]:not([hidden])');
  await page.click('a.door[href="#sandbox"]');
  await page.click('.wizard [data-kind="custom"]');
  const pre = await page.evaluate(() => ({ mass: document.querySelector('.wizard [data-c="massKg"]').value, tyre: [...document.querySelectorAll('.wizard .tyrepick select')].map((s) => s.value).join(" ") }));
  if (pre.mass !== "1300" || pre.tyre !== "205 55 16") failures.push(`${label}: Formular nicht mit dem eigenen Fahrzeug vorbelegt (${JSON.stringify(pre)})`);
  console.log(`${label}: eigenes Fahrzeug nach Neuladen ${JSON.stringify(after)}`);
  await page.close();
}

/**
 * #14: chassis dyno, Gänge & Zugkraft plate. The traction diagram is drawn (verdict text, ink on the canvas), the
 * gear count can be changed at standstill (own ratios → "eigenes Fahrzeug"), the converter automatic is offered.
 * Back to the free-revving bench at the end.
 */
async function gearsChecks(page, label) {
  // the bench select sits in a collapsed console section on phones: set it like the cockpit's own button does
  const mode = (m) => page.evaluate((m) => {
    const sel = document.querySelector('select[data-control="mode"]');
    sel.value = m;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, m);
  await mode("vehicle");
  await page.waitForSelector(".gears canvas", { state: "visible" });
  await tyreChecks(page, label);
  await page.locator(".gears").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const verdict = (await page.locator('[data-out="traction-verdict"]').textContent()) ?? "";
  if (!/Vmax .* übersetzt|ausgelegt/.test(verdict)) failures.push(`${label}: Zugkraftdiagramm ohne Vmax-Bewertung („${verdict}“)`);
  const ink = await page.evaluate(() => {
    const c = document.querySelector(".gears canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[i + 2]) > 60) n++;
    return n;
  });
  if (ink < 200) failures.push(`${label}: Zugkraftdiagramm leer (${ink} farbige Pixel)`);
  await parkChecks(page, label);
  const hasAuto = await page.evaluate(() => [...document.querySelectorAll('select[data-control="gearbox"] option')].some((o) => o.value === "automatic" && !o.hidden));
  if (!hasAuto) failures.push(`${label}: Wandlerautomatik fehlt in der Getriebeauswahl`);
  await page.selectOption('select[data-control="gear-count"]', "8");
  await page.waitForTimeout(150);
  const n = await page.locator('[data-out="gear-inputs"] input').count();
  if (n !== 8) failures.push(`${label}: Gangzahl 8 nicht übernommen (${n} Felder)`);
  // touch: 44 px targets; the plate fits the phone width
  const sizes = await page.evaluate(() => ({
    minH: Math.min(...[...document.querySelectorAll(".gears input, .gears select, .gears button")].map((e) => e.getBoundingClientRect().height)),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  if (label !== "desktop" && sizes.minH < 44) failures.push(`${label}: Gänge-Bedienelemente unter 44 px (${sizes.minH})`);
  if (sizes.overflow > 0) failures.push(`${label}: Gänge-Platte scrollt horizontal (${sizes.overflow} px)`);
  await page.locator(".gears").screenshot({ path: join(outDir, `smoke-${label}-traction.png`) });
  console.log(`${label}: Zugkraftdiagramm ${ink} Pixel, ${verdict}`);
  await perCarChecks(page, label);
  // back to the free-revving bench and the factory gearbox for the later steps
  await page.locator('[data-control="factory-reset"]').scrollIntoViewIfNeeded();
  await page.click('[data-control="factory-reset"]');
  await page.waitForTimeout(150);
  const after = await page.locator('[data-out="gear-inputs"] input').count();
  if (after !== 6) failures.push(`${label}: Werkszustand stellt die Gänge nicht zurück (${after} statt 6)`);
  await mode("free");
  await page.waitForTimeout(150);
}

/**
 * Settings count per vehicle ("Dubletten"): 9 own gears on car A stay with A. Vehicle B shows its factory gears,
 * back on A the 9 gears are there again; nothing global is left behind. One "Getriebe" section, one vehicle select.
 */
async function perCarChecks(page, label) {
  const count = () => page.locator('[data-out="gear-inputs"] input').count();
  const kind = async (k) => {
    await page.locator('select[data-control="vehicle"]').scrollIntoViewIfNeeded();
    await page.selectOption('select[data-control="vehicle"]', k);
    await page.waitForTimeout(150);
  };
  const dup = await page.evaluate(() => ({
    vehicle: document.querySelectorAll('select[data-control="vehicle"]').length,
    gearbox: document.querySelectorAll('select[data-control="gearbox"]').length,
    inGears: !!document.querySelector('.gears select[data-control="gearbox"]') && !!document.querySelector(".gears canvas"),
    heads: [...document.querySelectorAll(".gearbox h3")].map((h) => h.textContent.trim()),
  }));
  if (dup.vehicle !== 1 || dup.gearbox !== 1 || !dup.inGears) failures.push(`${label}: Getriebe/Fahrzeug doppelt oder verstreut (${JSON.stringify(dup)})`);
  if (dup.heads.filter((h) => /Getriebe|Gänge/.test(h)).length !== 1) failures.push(`${label}: mehr als ein Getriebe-Abschnitt (${dup.heads.join(", ")})`);
  await kind("car");
  await page.locator('select[data-control="gear-count"]').scrollIntoViewIfNeeded();
  await page.selectOption('select[data-control="gear-count"]', "9");
  await page.waitForTimeout(150);
  const a9 = await count();
  await kind("truck");
  const b = await count();
  const bFactory = await page.evaluate(() => window.__pruefzelle?.gearbox.drivetrain.gearbox.ratios.length);
  await kind("car");
  const a = await count();
  const global = await page.evaluate(() => localStorage.getItem("pruefzelle.gearRatios"));
  const resetOn = await page.evaluate(() => !document.querySelector('[data-control="factory-reset"]').disabled);
  if (a9 !== 9 || b === 9 || b !== bFactory || a !== 9 || global !== null || !resetOn) {
    failures.push(`${label}: Gänge nicht pro Fahrzeug (A ${a9} → B ${b}/${bFactory} → A ${a}, global ${global}, Reset ${resetOn})`);
  }
  console.log(`${label}: pro Fahrzeug A 9 Gänge → B ${b} (Werk) → A ${a}`);
}

/**
 * #91 Auto-Hold: the car stands on the chassis dyno with the engine running → the parking brake holds, the red (P)
 * lamp lights in the Getriebe-Pult and on the P button, the gear plate says so and a ratio can be changed. The P button
 * (≥ 44 px, as tall as the gas lever) releases and applies it; the control bar keeps its height.
 */
async function parkChecks(page, label) {
  const deck0 = await deckHeight(page);
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({
    lamp: document.querySelector('.lamps [data-lamp="park"]')?.dataset.state,
    btn: document.querySelector(".parkbtn")?.getAttribute("aria-pressed"),
    hint: document.querySelector('[data-out="gear-lock"]')?.textContent ?? "",
  }));
  if (st.lamp !== "on") failures.push(`${label}: Feststellbremsen-Leuchte im Stand aus (${st.lamp})`);
  if (st.btn !== "true") failures.push(`${label}: P-Taste zeigt die Feststellbremse nicht (${st.btn})`);
  if (!/Handbremse aktiv/.test(st.hint)) failures.push(`${label}: Gänge-Platte ohne Handbremsen-Hinweis („${st.hint}“)`);
  if (!(await page.isVisible('.lamps [data-lamp="park"]'))) failures.push(`${label}: Feststellbremsen-Leuchte nicht sichtbar`);
  // a single ratio typed in (decimal comma) is taken while held
  const first = page.locator('[data-out="gear-inputs"] input').first();
  await first.scrollIntoViewIfNeeded();
  await first.fill("3.9");
  await first.dispatchEvent("change");
  await page.waitForTimeout(150);
  const applied = await page.evaluate(() => window.__pruefzelle?.gearbox?.drivetrain?.gearbox?.ratios?.[0]);
  if (applied !== undefined && Math.abs(applied - 3.9) > 1e-6) failures.push(`${label}: Übersetzung bei Handbremse nicht übernommen (${applied})`);
  const msg = (await page.locator('[data-out="gear-msg"]').textContent()) ?? "";
  if (/Nicht übernommen/.test(msg)) failures.push(`${label}: Gänge-Platte lehnt ab: ${msg}`);
  // P button: size, release, apply
  const bb = await page.locator(".parkbtn__plate").boundingBox();
  const lever = await page.locator(".pedal__track").boundingBox();
  if (!bb || bb.width < 44 || bb.height < 44) failures.push(`${label}: P-Taste unter 44 px (${JSON.stringify(bb)})`);
  if (bb && lever && Math.abs(bb.height - lever.height) > 1) failures.push(`${label}: P-Taste nicht so hoch wie der Gashebel (${bb.height} / ${lever.height})`);
  await page.locator(".parkbtn").scrollIntoViewIfNeeded();
  await page.locator(".parkbtn").click();
  await page.waitForTimeout(100);
  const off = await page.locator(".parkbtn").getAttribute("aria-pressed");
  await page.locator(".parkbtn").click();
  await page.waitForTimeout(100);
  const on = await page.locator(".parkbtn").getAttribute("aria-pressed");
  if (off !== "false" || on !== "true") failures.push(`${label}: P-Taste schaltet nicht (${off} → ${on})`);
  const deck1 = await deckHeight(page);
  if (deck1 !== deck0) failures.push(`${label}: Bedienleiste ändert die Höhe mit der Feststellbremse (${deck0} → ${deck1} px)`);
  await page.locator(".gears").screenshot({ path: join(outDir, `smoke-${label}-park-gears.png`) });
  await page.locator(".deck").screenshot({ path: join(outDir, `smoke-${label}-park-deck.png`) });
  console.log(`${label}: Feststellbremse ${st.lamp}, P-Taste ${Math.round(bb?.width ?? 0)}×${Math.round(bb?.height ?? 0)} px, Übersetzung 1. Gang ${applied}`);
}

/** Height of the bottom control bar in px. */
async function deckHeight(page) {
  return page.evaluate(() => Math.round(document.querySelector(".deck")?.getBoundingClientRect().height ?? -1));
}

/**
 * Arthur's phone feedback: warnings must not move gas, brake and shift buttons. Forces a stack of long warnings into
 * the state the console renders (as at the limiter), checks the deck height, then the toasts: off by default,
 * shown below the header with "Kurz oben einblenden", at most two, a destroyed engine always.
 */
async function deckStaysStill(page, label, h0) {
  const warn = (on, extra = {}) => page.evaluate(([on, extra]) => {
    const app = window.__pruefzelle;
    const st = app.sim.state;
    st.warnings = on ? [
      { code: "piston-speed", severity: "warning", message: "Mittlere Kolbengeschwindigkeit 14,4 m/s (Grenze 14,7 m/s)" },
      { code: "over-rev", severity: "critical", message: "Drehzahl 5.200 1/min über dem Begrenzer, bitte sofort Gas wegnehmen" },
      { code: "egt-high", severity: "warning", message: "Abgastemperatur 780 °C (Grenze 800 °C)" },
    ] : [];
    Object.assign(st, extra);
    app.console.update(st);
    app.toasts.update({ state: st, outOfFuel: false }, performance.now(), JSON.parse(localStorage.getItem("pruefzelle.settings") ?? "{}").limitHints === "toast");
    return Math.round(document.querySelector(".deck").getBoundingClientRect().height);
  }, [on, extra]);
  // the loop would overwrite the state at once: pause it for the check
  await page.evaluate(() => window.__pruefzelle.pause());
  const hWarn = await warn(true);
  // with the setting off only the critical warning (over-rev) may appear, never the limit approach
  const toastsOff = await page.locator(".toast--warning").count();
  await page.screenshot({ path: join(outDir, `smoke-${label}-deck-warnings.png`) });
  if (hWarn !== h0) failures.push(`${label}: Bedienleiste ändert die Höhe bei Warnungen (${h0} → ${hWarn} px)`);
  if (toastsOff !== 0) failures.push(`${label}: Hinweise erscheinen, obwohl die Einstellung aus ist (${toastsOff})`);
  await warn(false);
  // setting on: toasts below the header, at most two
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("pruefzelle.settings") ?? "{}");
    localStorage.setItem("pruefzelle.settings", JSON.stringify({ ...s, limitHints: "toast" }));
  });
  await page.evaluate(() => window.__pruefzelle.toasts.clear());
  const hOn = await warn(true);
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => {
    const top = document.querySelector(".cell__top").getBoundingClientRect().bottom;
    const els = [...document.querySelectorAll(".toast:not(.is-leaving)")];
    return { n: els.length, top: Math.min(...els.map((e) => e.getBoundingClientRect().top)), header: top, h: Math.max(...els.map((e) => e.getBoundingClientRect().height)) };
  });
  await page.screenshot({ path: join(outDir, `smoke-${label}-toasts.png`) });
  if (hOn !== h0) failures.push(`${label}: Bedienleiste ändert die Höhe mit Hinweisen (${h0} → ${hOn} px)`);
  if (t.n < 1 || t.n > 2) failures.push(`${label}: ${t.n} Hinweise sichtbar (erwartet 1–2)`);
  if (!(t.top >= t.header)) failures.push(`${label}: Hinweis liegt nicht unter der Kopfleiste (${t.top} < ${t.header})`);
  if (t.h > 40) failures.push(`${label}: Hinweis zu hoch (${t.h} px)`);
  await warn(false);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("pruefzelle.settings") ?? "{}");
    localStorage.setItem("pruefzelle.settings", JSON.stringify({ ...s, limitHints: "off" }));
    window.__pruefzelle.toasts.clear();
  });
  // critical event: shown even with the setting off
  await warn(false, { destroyed: true });
  const crit = await page.locator(".toast--critical:not(.is-leaving)", { hasText: "Motor zerstört" }).count();
  // one live region per message: on phones the toasts speak, on wide screens the console list does
  const live = await page.evaluate(() => ({ toasts: document.querySelector(".toasts").getAttribute("aria-live"), phone: matchMedia("(max-width: 700px)").matches }));
  if ((live.toasts === "polite") !== live.phone) failures.push(`${label}: Live-Region doppelt oder fehlt (${JSON.stringify(live)})`);
  const sel = await page.evaluate(() => { const s = document.querySelector('select[data-control="layout"]'); return { w: s.clientWidth, need: s.scrollWidth }; });
  if (label !== "desktop" && sel.w < 110) failures.push(`${label}: Ansichtsauswahl zu schmal (${sel.w} px)`);
  // a wider page makes phones zoom out (innerWidth grows with it), so compare with the device width
  const pageW = await page.evaluate(() => document.documentElement.scrollWidth);
  const devW = await page.evaluate(() => window.screen.width || 390);
  if (label !== "desktop" && pageW > Math.max(devW, 360)) failures.push(`${label}: Seite breiter als das Handy (${pageW} px)`);
  if (crit !== 1) failures.push(`${label}: Motorschaden erscheint nicht als Hinweis (${crit})`);
  await page.evaluate(() => {
    const app = window.__pruefzelle;
    app.sim.state.destroyed = false;
    app.toasts.clear();
    app.resume();
  });
  console.log(`${label}: Bedienleiste ${h0} px, mit Warnungen ${hWarn} px, Hinweise ${t.n}`);
}

/** #44 on the phone: touch mode, no keyboard hints visible, touch wording in the status line. */
async function touchChecks(page, label) {
  const r = await page.evaluate(() => {
    const visible = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    return {
      touch: document.documentElement.classList.contains("is-touch"),
      kbd: [...document.querySelectorAll("kbd, .kbd-only")].filter(visible).map((e) => e.textContent?.trim()),
      status: document.querySelector(".console__status")?.textContent ?? "",
    };
  });
  if (!r.touch) failures.push(`${label}: Touch-Gerät nicht erkannt (html.is-touch fehlt)`);
  if (r.kbd.length) failures.push(`${label}: Tastatur-Hinweise auf Touch sichtbar: ${r.kbd.join(", ")}`);
  if (/\b[WSAIEQ]\b|Leertaste/.test(r.status)) failures.push(`${label}: Statuszeile nennt Tasten: ${r.status}`);
}

/** #66: the new settings exist, a change reaches the Bedienpult storage, no horizontal scroll, in-page confirm. */
async function settingsChecks(page, label) {
  for (const sel of ['input[name="gasramp"]', 'input[name="realism"]', 'input[name="pedalside"]', 'input[data-set="wakeLock"]', 'input[data-price="diesel"]', '[data-control="reset-all"]']) {
    if (!(await page.$(sel))) failures.push(`${label}: Einstellung ${sel} fehlt`);
  }
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sw > 0) failures.push(`${label}: Einstellungen scrollen horizontal (${sw} px)`);
  await page.click('[data-control="reset-all"]');
  if (!(await page.isVisible('[data-control="reset-all-yes"]'))) failures.push(`${label}: „Alles zurücksetzen“ fragt nicht nach`);
  await page.click('[data-control="reset-all-no"]');
  if (await page.isVisible('[data-control="reset-all-yes"]')) failures.push(`${label}: Abbrechen schließt die Rückfrage nicht`);
}

/** Reads a German formatted number from a readout ("1.234" → 1234, "–" → NaN). */
async function readNum(page, sel) {
  return page.evaluate((sel) => {
    const text = (document.querySelector(sel)?.textContent ?? "").trim();
    return /\d/.test(text) ? Number(text.replace(/[\s.  ]/g, "").replace(",", ".")) : NaN;
  }, sel);
}

/**
 * Layouts (#26): choose the cockpit (desktop: tile in the settings, mobile: switch in the header), put the car on the
 * chassis dyno with the cockpit's own button, drive and check that the speedometer rises; only two views (#94);
 * no horizontal scrolling; back to the Prüfzelle at the end so later runs start from the default.
 */
async function layouts(page, label) {
  if (label === "desktop") {
    await page.click('.cell__top a[href="#menu"]');
    await page.click('a[href="#settings"]:visible');
    // #94: the design list is a sub-option of the Cockpit, hidden while the Prüfzelle is chosen
    const before = await page.isVisible('input[name="ckdesign"][value="race"]');
    await page.click('.layout-tile:has(input[value="cockpit"])');
    const after = await page.isVisible('input[name="ckdesign"][value="race"]');
    if (before || !after) failures.push(`${label}: Design-Liste nicht als Unteroption des Cockpits (vorher ${before}, nachher ${after})`);
    await page.click('.office__top a[href="#menu"]');
    await page.click('a.door[href="#sandbox"]');
    // the guided start (#93) opens first; the smoke test starts on the engine dyno
    await wizardEngine(page);
  } else {
    await page.selectOption('select[data-control="layout"]', "cockpit");
  }
  await page.waitForSelector(".ck", { state: "visible" });
  // the recorder (full-load curve) stays in every view (Arthur's report after #47)
  if (!(await page.isVisible(".recorder"))) failures.push(`${label}: Cockpit zeigt den Linienschreiber nicht`);
  await page.click('[data-ck="to-vehicle"]');
  await page.mouse.click(2, 300);
  await page.keyboard.press("i");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `smoke-${label}-cockpit-ignition.png`) });
  await page.keyboard.down("a");
  await page.waitForTimeout(1200);
  await page.keyboard.up("a");
  const v0 = await readNum(page, '[data-ck="speed-big"]');
  await page.keyboard.press("e");
  await page.keyboard.down("w");
  await page.waitForTimeout(3000);
  const v1 = await readNum(page, '[data-ck="speed-big"]');
  await page.screenshot({ path: join(outDir, `smoke-${label}-cockpit.png`) });
  console.log(`${label}: Cockpit-Tacho ${fmt(v0)} → ${fmt(v1)}`);
  if (!(v1 > (Number.isFinite(v0) ? v0 : 0) + 5)) failures.push(`${label}: Cockpit-Tacho steigt nicht (${v0} → ${v1})`);
  // brake: S on the keyboard, the brake pedal on touch screens
  await page.keyboard.up("w");
  const brakeShown = await page.isVisible(".brakepedal");
  const touch = label !== "desktop";
  if (touch !== brakeShown) failures.push(`${label}: Bremspedal ${brakeShown ? "sichtbar ohne" : "fehlt bei"} Touch`);
  const b0 = await readNum(page, '[data-ck="speed-big"]');
  if (brakeShown) {
    const bb = await page.locator(".brakepedal__plate").boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
  } else await page.keyboard.down("s");
  await page.waitForTimeout(1500);
  const b1 = await readNum(page, '[data-ck="speed-big"]');
  if (brakeShown) await page.mouse.up();
  else await page.keyboard.up("s");
  console.log(`${label}: Bremse ${fmt(b0)} → ${fmt(b1)}`);
  // #91: braked to a stop → Auto-Hold holds, the red (P) lamp lights in the cockpit's lamp strip
  await page.waitForTimeout(300);
  const ckPark = await page.evaluate(() => document.querySelector('.ck [data-lamp="park"]')?.dataset.state);
  if (ckPark !== "on") failures.push(`${label}: Cockpit-Leuchte Feststellbremse im Stand nicht an (${ckPark})`);
  if (!(await page.isVisible('.ck [data-lamp="park"]'))) failures.push(`${label}: Cockpit-Leuchte Feststellbremse nicht sichtbar`);
  if (!(b0 > 5 && Number.isFinite(b1) && b1 < b0 - 3)) failures.push(`${label}: Bremse bremst nicht (${b0} → ${b1})`);
  // on the chassis dyno the gas lever springs back when it is let go (else the car drives on by itself)
  const tr = await page.locator(".pedal__track").boundingBox();
  await page.mouse.move(tr.x + tr.width / 2, tr.y + tr.height * 0.9);
  await page.mouse.down();
  await page.mouse.move(tr.x + tr.width / 2, tr.y + tr.height * 0.4, { steps: 4 });
  const held = await page.locator(".pedal__value").textContent();
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after = (await page.locator(".pedal__value").textContent())?.trim();
  if (!(parseInt(held ?? "0", 10) >= 30)) failures.push(`${label}: Gashebel lässt sich nicht ziehen (${held})`);
  if (after !== "0 %") failures.push(`${label}: Gashebel federt auf der Rolle nicht zurück (${held} → ${after})`);
  await page.keyboard.down("w");
  await cockpitDesigns(page, label);
  await page.keyboard.up("w");
  // #94: the view switch offers only Prüfzelle and Cockpit (Renn-Dash and Kompakt are cockpit designs now)
  const views = await page.$$eval('.cell__top select[data-control="layout"] option', (o) => o.map((e) => e.value));
  if (views.join("|") !== "pruefzelle|cockpit") failures.push(`${label}: Ansichtsauswahl bietet ${views.join(", ")}`);
  await page.selectOption('select[data-control="layout"]', "pruefzelle");
  await page.waitForTimeout(200);
  if (!(await page.isVisible(RPM_READOUT))) failures.push(`${label}: zurück zur Prüfzelle fehlen die Instrumente`);
}

const DESIGNS = ["classic", "night-orange", "italian", "oldschool", "digital", "hud", "race", "motorrad", "truck"];

/**
 * Cockpit designs (#83): switch through every design with the select in the cockpit while driving, one screenshot of
 * the cluster each, no horizontal scroll; the digital fields cycle on click and arrow keys, the presets apply;
 * "Automatisch nach Fahrzeug" shows the classic cluster for a car. Ends on "classic".
 */
async function cockpitDesigns(page, label) {
  for (const id of DESIGNS) {
    await page.selectOption('select[data-control="ck-design"]', id);
    await page.waitForTimeout(450);
    const st = await page.evaluate(() => ({ design: document.querySelector(".ck")?.dataset.design, sw: document.documentElement.scrollWidth - window.innerWidth }));
    if (st.design !== id) failures.push(`${label}: Cockpit-Design ${id} nicht angewendet (${st.design})`);
    if (st.sw > 0) failures.push(`${label}: Cockpit-Design ${id} scrollt horizontal (${st.sw} px)`);
    // the Renn-Dash (#94) shows its own speed tile; every other design the centre display's speed
    const speedSel = id === "race" ? '.ck .rd [data-rd="speed"]' : '[data-ck="speed-big"]';
    if (!(await page.isVisible(speedSel))) failures.push(`${label}: Cockpit-Design ${id} zeigt kein Tempo`);
    if (id === "race") {
      // what the old Renn-Dash view did stays: shift LEDs, big gear, lamp strip with (P), tank
      for (const sel of [".ck .rd__leds", '.ck .rd [data-rd="gear"]', '.ck [data-lamp="park"]', '.ck .rd [data-rd="tank"]']) {
        if (!(await page.isVisible(sel))) failures.push(`${label}: Renn-Dash-Design ohne ${sel}`);
      }
    }
    if (id === "hud" && !(await page.isVisible('.ck [data-ck="hud-rpm"]'))) failures.push(`${label}: Head-up zeigt die Drehzahl nicht groß (Kompakt-Ersatz)`);
    if (id === "truck") {
      // #83 truck/bus design: engine brake and limiter in the centre display, (P) lamp, tank, both dials, no scale choice
      for (const sel of ['.ck [data-ck="eb"]', '.ck [data-ck="gov"]', '.ck [data-lamp="park"]', '.ck .ck-mini[data-mini="tank"]', ".ck__dial--rpm canvas"]) {
        if (!(await page.isVisible(sel))) failures.push(`${label}: Nutzfahrzeug-Design ohne ${sel}`);
      }
      if (await page.isVisible('.ck [data-ck-skala]')) failures.push(`${label}: Nutzfahrzeug-Design bietet die Tachoskala an (fest 125 km/h)`);
    }
    await page.locator(".ck").screenshot({ path: join(outDir, `smoke-${label}-design-${id}.png`) });
    if (id === "digital") {
      const field = page.locator('.ck-field[data-field="0"]');
      const before = await field.getAttribute("aria-label");
      await field.click();
      await page.waitForTimeout(120);
      const after = await field.getAttribute("aria-label");
      if (!/^Feld 1: [^\d]+ – antippen zum Wechseln$/.test(after ?? "") || after === before) failures.push(`${label}: Feld 1 wechselt nicht (${before} → ${after})`);
      await field.focus();
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(120);
      if ((await field.getAttribute("aria-label"))?.split(" ")[2] !== before?.split(" ")[2]) failures.push(`${label}: Pfeil links führt nicht zum vorigen Wert zurück`);
      await page.click('[data-preset="track"]');
      await page.waitForTimeout(120);
      const labs = await page.$$eval(".ck-field .ck-field__lab", (n) => n.map((e) => e.textContent));
      if (labs.join("|") !== "Öltemperatur|Kühlmittel|Ladedruck") failures.push(`${label}: Preset Rennstrecke falsch (${labs.join(", ")})`);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pruefzelle.settings") ?? "{}").ckFields);
      if (JSON.stringify(stored) !== JSON.stringify(["oilT", "coolant", "boost"])) failures.push(`${label}: Feldbelegung nicht gespeichert (${JSON.stringify(stored)})`);
      await page.click('[data-preset="daily"]');
      await page.waitForTimeout(150);
      await page.locator(".ck").screenshot({ path: join(outDir, `smoke-${label}-design-digital-daily.png`) });
    }
  }
  await page.selectOption('select[data-control="ck-design"]', "auto");
  await page.waitForTimeout(200);
  const auto = await page.evaluate(() => document.querySelector(".ck")?.dataset.design);
  if (auto !== "classic") failures.push(`${label}: Automatisch nach Fahrzeug zeigt beim Pkw ${auto}`);
  await cockpitExtras(page, label);
  await autoTruck(page, label);
  await page.selectOption('select[data-control="ck-design"]', "classic");
  console.log(`${label}: ${DESIGNS.length} Cockpit-Designs geschaltet`);
}

/**
 * #83 additional gauges and tuning bar: picked in "Zusatzanzeigen" under the cluster, round and as bars, stored;
 * 44 px targets on touch layouts, no horizontal scroll, the control bar keeps its height.
 */
async function cockpitExtras(page, label) {
  const deckH0 = await deckHeight(page);
  await page.click(".ck__extras > summary");
  // gearbox oil (#53) is offered on the chassis dyno, where the cockpit drives here
  // intake air (#105) and battery (#83) are offered with every engine
  for (const id of ["oilP", "oilT", "gearOil", "lambda", "egt", "intake", "battery"]) await page.check(`.ck__extras [data-gauge="${id}"]`);
  await page.check('.ck__extras [data-control="ck-tune"]');
  await page.waitForTimeout(250);
  const pods = await page.$$eval(".ck-pod:not([hidden])", (n) => n.map((e) => e.dataset.pod));
  if (pods.join("|") !== "oilP|oilT|gearOil|lambda|egt|intake|battery") failures.push(`${label}: Zusatzinstrumente falsch (${pods.join(", ")})`);
  if (!(await page.isVisible('.ck__tune [data-tune="limit"]'))) failures.push(`${label}: Tuning-Leiste ohne Leistungsgrenze`);
  if (label !== "desktop") {
    const minH = await page.$$eval(".ck__extras > summary, .ck__extras .ck-chk", (n) => Math.min(...n.map((e) => e.getBoundingClientRect().height)));
    if (minH < 44) failures.push(`${label}: Zusatzanzeigen: Bedienelement unter 44 px (${minH})`);
  }
  await page.locator(".ck").screenshot({ path: join(outDir, `smoke-${label}-design-extras-round.png`) });
  await page.click(".ck__extras > summary");
  await extrasPerDesign(page, label, "round");
  await page.click(".ck__extras > summary");
  await page.check('.ck__extras input[name="ck-gstyle"][value="bar"]');
  await page.click(".ck__extras > summary");
  await extrasPerDesign(page, label, "bar");
  await page.selectOption('select[data-control="ck-design"]', "digital");
  await page.waitForTimeout(300);
  const bar = await page.evaluate(() => ({
    style: document.querySelector(".ck__console")?.dataset.gstyle,
    bars: [...document.querySelectorAll(".ck-pod:not([hidden]) .ck-pod__bar")].filter((b) => b.getBoundingClientRect().width > 40).length,
    sw: document.documentElement.scrollWidth - window.innerWidth,
    stored: JSON.parse(localStorage.getItem("pruefzelle.settings") ?? "{}"),
  }));
  // the digital design shows "Balken" as its own segment bars
  if (bar.style !== "segment" || bar.bars !== 7) failures.push(`${label}: Balkenanzeigen fehlen (${JSON.stringify({ style: bar.style, bars: bar.bars })})`);
  if (bar.sw > 0) failures.push(`${label}: Zusatzanzeigen scrollen horizontal (${bar.sw} px)`);
  if (JSON.stringify(bar.stored.ckGauges) !== JSON.stringify(["oilP", "oilT", "gearOil", "lambda", "egt", "intake", "battery"]) || bar.stored.ckGaugeStyle !== "bar" || bar.stored.ckTuneBar !== true) {
    failures.push(`${label}: Zusatzanzeigen nicht gespeichert (${JSON.stringify([bar.stored.ckGauges, bar.stored.ckGaugeStyle, bar.stored.ckTuneBar])})`);
  }
  await page.locator(".ck").screenshot({ path: join(outDir, `smoke-${label}-design-extras-bar.png`) });
  await deckStaysStill(page, label, deckH0);
  await page.selectOption('select[data-control="ck-design"]', "auto");
}

const SCREEN_DESIGNS = ["digital", "hud", "race", "motorrad"];

/**
 * #83 the extra gauges take on each design: round pods (canvas) in the dial designs, tiles ("Rund") or segment bars
 * ("Balken") without any canvas in the screen designs, with the hint in the picker. One screenshot of the console per
 * design, no horizontal scroll.
 */
async function extrasPerDesign(page, label, style) {
  for (const id of DESIGNS) {
    await page.selectOption('select[data-control="ck-design"]', id);
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const c = document.querySelector(".ck__console");
      const pods = [...c.querySelectorAll(".ck-pod:not([hidden])")];
      return {
        shown: c.dataset.gstyle,
        canvases: pods.filter((p) => p.querySelector("canvas").getBoundingClientRect().width > 0).length,
        pods: pods.length,
        hint: c.querySelector("[data-ck=gstyle-hint]").hidden ? "" : c.querySelector("[data-ck=gstyle-hint]").textContent,
        sw: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    const screen = SCREEN_DESIGNS.includes(id);
    const want = screen ? (style === "round" ? "tile" : "segment") : style;
    if (r.shown !== want) failures.push(`${label}: Zusatzinstrumente im Design ${id} als ${r.shown} statt ${want}`);
    if (screen && r.canvases > 0) failures.push(`${label}: Design ${id} zeigt runde Zusatzinstrumente`);
    if (!screen && style === "round" && r.canvases !== r.pods) failures.push(`${label}: Design ${id} ohne runde Zusatzinstrumente (${r.canvases}/${r.pods})`);
    if (screen !== /keine Rundinstrumente/.test(r.hint)) failures.push(`${label}: Hinweis zur Darstellung im Design ${id} falsch („${r.hint}“)`);
    if (r.sw > 0) failures.push(`${label}: Zusatzinstrumente im Design ${id} scrollen horizontal (${r.sw} px)`);
    await page.locator(".ck__console").screenshot({ path: join(outDir, `smoke-${label}-extras-${style}-${id}.png`) });
  }
}

/** #83: "Automatisch nach Fahrzeug" shows the truck design after loading the truck (engine off, car stopped). */
async function autoTruck(page, label) {
  await page.keyboard.up("w");
  await page.mouse.click(2, 300);
  await page.keyboard.down("s");
  await page.waitForTimeout(2500);
  await page.keyboard.up("s");
  await page.keyboard.press("i");
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const sel = document.querySelector('select[data-control="car"]');
    sel.value = "truck-mercedes-actros-1845";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector('[data-control="load-car"]').click();
  });
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({ design: document.querySelector(".ck")?.dataset.design, sw: document.documentElement.scrollWidth - window.innerWidth }));
  if (st.design !== "truck") failures.push(`${label}: Automatisch nach Fahrzeug zeigt beim Lkw ${st.design}`);
  if (st.sw > 0) failures.push(`${label}: Nutzfahrzeug-Design scrollt horizontal (${st.sw} px)`);
  // drive a little so the dials, the limiter mark and the engine brake show something
  await page.keyboard.press("i");
  await page.keyboard.down("a");
  await page.waitForTimeout(1500);
  await page.keyboard.up("a");
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  await page.keyboard.up("w");
  await page.waitForTimeout(400);
  // the Actros (OM 471) has a decompression brake: the indicator reads "bereit" or the braking power, not "nicht verbaut"
  const eb = await page.evaluate(() => ({ v: document.querySelector('.ck [data-ck="eb"]')?.textContent, st: document.querySelector('.ck [data-ck="eb-row"]')?.dataset.state }));
  if (eb.st === "none" || !eb.v) failures.push(`${label}: Motorbremsen-Anzeige beim Lkw fehlt (${JSON.stringify(eb)})`);
  await page.locator(".ck").screenshot({ path: join(outDir, `smoke-${label}-design-truck-auto.png`) });
  // #91 in the truck design: braked to a stop, Auto-Hold applies the parking brake and the red (P) lamp lights
  await page.keyboard.down("s");
  await page.waitForTimeout(3000);
  await page.keyboard.up("s");
  await page.waitForTimeout(400);
  const park = await page.evaluate(() => ({ design: document.querySelector(".ck")?.dataset.design, lamp: document.querySelector('.ck [data-lamp="park"]')?.dataset.state }));
  if (park.design !== "truck" || park.lamp !== "on") failures.push(`${label}: Nutzfahrzeug-Design ohne (P)-Leuchte bei Feststellbremse (${JSON.stringify(park)})`);
  if (!(await page.isVisible('.ck [data-lamp="park"]'))) failures.push(`${label}: (P)-Leuchte im Nutzfahrzeug-Design nicht sichtbar`);
  await truckSystems(page, label);
}

/**
 * #83 air brake, retarder, AdBlue, battery: the truck design shows them (retarder − / +), and with the air and
 * retarder gauges chosen every design shows them in its own style; no horizontal scroll, the control bar stays still.
 */
async function truckSystems(page, label) {
  const deckH0 = await deckHeight(page);
  await page.click('.ck [data-ck="ret-up"]');
  await page.click('.ck [data-ck="ret-up"]');
  await page.waitForTimeout(200);
  const t = await page.evaluate(() => {
    const q = (k) => document.querySelector(`.ck [data-ck="${k}"]`);
    const dl = document.querySelector(".ck__truck");
    return { air: q("air")?.textContent, ret: q("ret")?.textContent, ad: q("adblue")?.textContent, bat: q("bat")?.textContent, airLamp: document.querySelector('.ck [data-lamp="air"]')?.dataset.state, over: [...dl.querySelectorAll("div")].some((d) => d.scrollWidth > d.clientWidth + 1) };
  });
  if (!/^\d+,\d bar$/.test(t.air ?? "")) failures.push(`${label}: Druckluft im Nutzfahrzeug-Design fehlt (${t.air})`);
  if (!/^2\b/.test(t.ret ?? "")) failures.push(`${label}: Retarderstufe nicht 2 nach zweimal + (${t.ret})`);
  if (!/%|kein SCR/.test(t.ad ?? "")) failures.push(`${label}: AdBlue-Anzeige fehlt (${t.ad})`);
  if (!/^\d+,\d V$/.test(t.bat ?? "")) failures.push(`${label}: Batteriespannung fehlt (${t.bat})`);
  if (t.airLamp !== "off") failures.push(`${label}: Bremsdruck-Leuchte bei vollem Vorrat an`);
  if (t.over) failures.push(`${label}: Nutzfahrzeug-Anzeigen laufen über`);
  await page.locator(".ck").screenshot({ path: join(outDir, `smoke-${label}-design-truck-systems.png`) });
  await page.click(".ck__extras > summary");
  for (const id of ["air", "retarder", "adblue"]) await page.check(`.ck__extras [data-gauge="${id}"]`);
  await page.click(".ck__extras > summary");
  for (const id of DESIGNS) {
    await page.selectOption('select[data-control="ck-design"]', id);
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({
      pods: [...document.querySelectorAll(".ck-pod:not([hidden])")].map((p) => p.dataset.pod),
      sw: document.documentElement.scrollWidth - window.innerWidth,
    }));
    if (!r.pods.includes("air") || !r.pods.includes("retarder")) failures.push(`${label}: Design ${id} ohne Druckluft/Retarder beim Lkw (${r.pods.join(", ")})`);
    if (r.sw > 0) failures.push(`${label}: Design ${id} scrollt beim Lkw horizontal (${r.sw} px)`);
    await page.locator(".ck__console").screenshot({ path: join(outDir, `smoke-${label}-truck-extras-${id}.png`) });
  }
  await page.selectOption('select[data-control="ck-design"]', "auto");
  await deckStaysStill(page, label, deckH0);
}

// "Fehler melden" in the sandbox header (#55): dialog opens, the link targets the issue form with the diagnosis,
// typing in it does not drive the engine, Esc closes only the dialog. GitHub itself is never opened.
// "Was ist neu" (#50): badge before the first visit, dialog opens, no horizontal scroll, opening marks it seen
async function whatsNew(page, label) {
  const btn = '.hall [data-action="whats-new"]';
  if (!(await page.isVisible(`${btn} .whatsnew__badge`))) failures.push(`${label}: Was-ist-neu ohne Neu-Hinweis beim ersten Besuch`);
  // desktop by keyboard; the phone by touch (a key press would switch it to keyboard hints)
  const touch = label !== "desktop";
  if (touch) await page.tap(btn);
  else {
    await page.focus(btn);
    await page.keyboard.press("Enter");
  }
  await page.waitForSelector("dialog.whatsnew[open]");
  const r = await page.evaluate(() => {
    const d = document.querySelector("dialog.whatsnew");
    return {
      days: d.querySelectorAll(".whatsnew__day").length,
      open: d.querySelectorAll(".whatsnew__day[open]").length,
      overflow: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth,
      seen: localStorage.getItem("pruefzelle.changelogSeen"),
    };
  });
  await page.screenshot({ path: join(outDir, `smoke-${label}-whats-new.png`) });
  if (!r.days || !r.open || r.open === r.days) failures.push(`${label}: Was-ist-neu ohne offene/eingeklappte Tage (${JSON.stringify(r)})`);
  if (r.overflow) failures.push(`${label}: Was-ist-neu scrollt seitlich`);
  if (!r.seen) failures.push(`${label}: Was-ist-neu merkt sich den Besuch nicht`);
  if (touch) await page.tap('dialog.whatsnew [data-action="close"]');
  else await page.keyboard.press("Escape");
  if (await page.isVisible("dialog.whatsnew[open]")) failures.push(`${label}: Was-ist-neu schließt nicht`);
  if (await page.isVisible(`${btn} .whatsnew__badge`)) failures.push(`${label}: Neu-Hinweis bleibt nach dem Öffnen`);
}

// Credits (#94): button in the hall footer opens the dialog with both names and links, no e-mail; Esc (desktop) or
// "Schließen" (phone) closes it and the focus returns to the button
async function credits(page, label) {
  const btn = '.hall [data-action="credits"]';
  const touch = label !== "desktop";
  if (touch) await page.tap(btn);
  else {
    await page.focus(btn);
    await page.keyboard.press("Enter");
  }
  await page.waitForSelector("dialog.credits[open]");
  const r = await page.evaluate(() => {
    const d = document.querySelector("dialog.credits");
    return {
      text: d.textContent ?? "",
      links: [...d.querySelectorAll("a")].map((a) => a.href),
      overflow: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth,
      focusInside: d.contains(document.activeElement),
    };
  });
  await page.screenshot({ path: join(outDir, `smoke-${label}-credits.png`) });
  if (!/Arthur Reznikov/.test(r.text) || !/Claude/.test(r.text)) failures.push(`${label}: Credits ohne Namen`);
  for (const href of ["https://github.com/SwissCheese26", "https://claude.com/claude-code", "https://github.com/SwissCheese26/engine-sandbox"]) {
    if (!r.links.includes(href)) failures.push(`${label}: Credits ohne Link ${href}`);
  }
  if (r.links.some((h) => h.startsWith("mailto:")) || /\S+@\S+\.\w+/.test(r.text)) failures.push(`${label}: Credits enthalten eine E-Mail-Adresse`);
  if (r.overflow) failures.push(`${label}: Credits scrollen seitlich`);
  if (!r.focusInside) failures.push(`${label}: Fokus nicht im Credits-Fenster`);
  if (touch) await page.tap('dialog.credits [data-action="close"]');
  else await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  if (await page.isVisible("dialog.credits[open]")) failures.push(`${label}: Credits schließen nicht`);
  if (!touch && !(await page.evaluate(() => document.activeElement?.dataset.action === "credits"))) failures.push(`${label}: Fokus kehrt nicht zum Credits-Knopf zurück`);
}

async function bugReport(page, label) {
  await page.click('.cell__top [data-action="bug-report"]');
  await page.waitForSelector("dialog.bugreport[open]");
  await page.fill('dialog.bugreport [name="description"]', "Testmeldung aus dem E2E-Smoke");
  await page.screenshot({ path: join(outDir, `smoke-${label}-bug-report.png`) });
  const r = await page.evaluate(() => {
    const u = new URL(document.querySelector('dialog.bugreport [data-action="send"]').href);
    return { template: u.searchParams.get("template"), label: u.searchParams.get("labels"), desc: u.searchParams.get("beschreibung"), diag: u.searchParams.get("diagnose") ?? "", len: u.href.length };
  });
  if (r.template !== "bug.yml" || r.label !== "bug-meldung") failures.push(`${label}: Melde-Link ohne Vorlage bug.yml (${JSON.stringify(r)})`);
  if (r.desc !== "Testmeldung aus dem E2E-Smoke") failures.push(`${label}: Beschreibung fehlt im Melde-Link`);
  for (const part of ["App-Version", "Motor", "Werte der letzten 5 s", "rpm"]) if (!r.diag.includes(part)) failures.push(`${label}: Diagnose ohne „${part}“`);
  if (r.len > 7000) failures.push(`${label}: Melde-Link zu lang (${r.len})`);
  // unticking a section removes it from the text and the link
  await page.uncheck('dialog.bugreport [data-section="values"]');
  const after = await page.inputValue('dialog.bugreport [name="diagnosis"]');
  if (after.includes("Werte der letzten 5 s")) failures.push(`${label}: abgewählte Werte stehen noch in der Diagnose`);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sw > 0) failures.push(`${label}: Sandbox scrollt mit Fehler-melden-Knopf horizontal (${sw} px)`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => ({ open: !!document.querySelector("dialog.bugreport[open]"), hash: location.hash }));
  if (st.open || st.hash !== "#sandbox") failures.push(`${label}: Esc im Fehler-melden-Dialog (${JSON.stringify(st)})`);
  console.log(`${label}: Melde-Link ${r.len} Zeichen`);
}

const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toString() : String(n));

try {
  await run("desktop", { width: 1440, height: 900 });
  if (!skipped) await run("mobile", { width: 390, height: 844 });
  // smallest common phone width (review PR #90)
  if (!skipped) await run("small", { width: 360, height: 740 });
  // Engine Builder (#72): full build, save, rev, drive (tests/e2e/builder.mjs)
  for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["small", { width: 360, height: 740 }]]) if (!skipped) await builderChecks({ browser, base, outDir, failures, errors, label, viewport });
  // electric cars (#108): Plaid via the guided start, Ready, full throttle, every cockpit design (tests/e2e/ev.mjs)
  for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }], ["small", { width: 360, height: 740 }]]) if (!skipped) await evChecks({ browser, base, outDir, failures, errors, label, viewport });
  // Rauch/Dampf: burnout smoke in every cockpit design and the Prüfzelle (tests/e2e/smoke-fx.mjs)
  for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["small", { width: 360, height: 740 }]]) if (!skipped) await smokeFxChecks({ browser, base, outDir, failures, errors, label, viewport });
} catch (e) {
  failures.push(`Ausnahme: ${e?.stack ?? e}`);
} finally {
  await browser.close();
  server.close();
}

if (skipped && errors.length === 0 && failures.length === 0) {
  console.log("UI noch nicht vorhanden – übersprungen");
  process.exit(0);
}
for (const e of errors) console.error(e);
for (const f of failures) console.error(f);
if (errors.length || failures.length) {
  console.error(`E2E-Smoke fehlgeschlagen (${errors.length} Konsolenfehler, ${failures.length} Prüfungen).`);
  process.exit(1);
}
console.log(`E2E-Smoke ok, Screenshots in ${outDir}`);
