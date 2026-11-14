// E2E smoke test (issue #7). Does NOT build: run `bun scripts/build.ts` first.
// Since #42 the page opens with the main menu: the test shoots the menu and the settings, enters the
// sandbox through its door, and at the end checks Esc (back to the menu) and reload (#sandbox stays).
// Serves dist/ with a tiny built-in node:http server, loads the app, fails on console/page errors,
// starts the engine with the keyboard (I = ignition, hold S = starter, hold Space = throttle),
// checks that the rpm readout rises, and writes screenshots (1440×900, 390×844) to
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
  const touch = label === "mobile";
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
  await page.click('dialog.bugreport [data-action="cancel"]');
  await whatsNew(page, label);
  await page.click('a[href="#settings"]:visible');
  await page.waitForSelector('[data-screen="settings"]:not([hidden]) input[name="preset"]');
  await page.screenshot({ path: join(outDir, `smoke-${label}-settings.png`), fullPage: true });
  await settingsChecks(page, label);
  await page.click('.office__top a[href="#menu"]');
  await page.waitForSelector('[data-screen="menu"]:not([hidden])');
  await page.click('a.door[href="#sandbox"]');
  // "Wähle eine Strecke" opens first; the smoke test starts on the engine dyno
  await page.click('.routepick [data-pick="engine"]');
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
  if (label === "mobile" && sel.w < 110) failures.push(`${label}: Ansichtsauswahl zu schmal (${sel.w} px)`);
  // a wider page makes phones zoom out (innerWidth grows with it), so compare with the device width
  const pageW = await page.evaluate(() => document.documentElement.scrollWidth);
  if (label === "mobile" && pageW > 390) failures.push(`${label}: Seite breiter als das Handy (${pageW} px)`);
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
 * chassis dyno with the cockpit's own button, drive and check that the speedometer rises; shoot race dash and compact
 * view; no horizontal scrolling; back to the Prüfzelle at the end so later runs start from the default.
 */
async function layouts(page, label) {
  if (label === "desktop") {
    await page.click('.cell__top a[href="#menu"]');
    await page.click('a[href="#settings"]:visible');
    await page.click('.layout-tile:has(input[value="cockpit"])');
    await page.click('.office__top a[href="#menu"]');
    await page.click('a.door[href="#sandbox"]');
    // "Wähle eine Strecke" opens first; the smoke test starts on the engine dyno
    await page.click('.routepick [data-pick="engine"]');
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
  const touch = label === "mobile";
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
  for (const id of ["race", "compact"]) {
    await page.selectOption('select[data-control="layout"]', id);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `smoke-${label}-${id}.png`) });
  }
  await page.keyboard.up("w");
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sw > 0) failures.push(`${label}: Kompakt-Ansicht scrollt horizontal (${sw} px)`);
  await page.selectOption('select[data-control="layout"]', "pruefzelle");
  await page.waitForTimeout(200);
  if (!(await page.isVisible(RPM_READOUT))) failures.push(`${label}: zurück zur Prüfzelle fehlen die Instrumente`);
}

const DESIGNS = ["classic", "night-orange", "italian", "oldschool", "digital", "hud", "motorrad"];

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
    if (!(await page.isVisible('[data-ck="speed-big"]'))) failures.push(`${label}: Cockpit-Design ${id} zeigt kein Tempo`);
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
  await page.selectOption('select[data-control="ck-design"]', "classic");
  console.log(`${label}: ${DESIGNS.length} Cockpit-Designs geschaltet`);
}

// "Fehler melden" in the sandbox header (#55): dialog opens, the link targets the issue form with the diagnosis,
// typing in it does not drive the engine, Esc closes only the dialog. GitHub itself is never opened.
// "Was ist neu" (#50): badge before the first visit, dialog opens, no horizontal scroll, opening marks it seen
async function whatsNew(page, label) {
  const btn = '.hall [data-action="whats-new"]';
  if (!(await page.isVisible(`${btn} .whatsnew__badge`))) failures.push(`${label}: Was-ist-neu ohne Neu-Hinweis beim ersten Besuch`);
  // desktop by keyboard; the phone by touch (a key press would switch it to keyboard hints)
  const touch = label === "mobile";
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
