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
  await page.click('a[href="#settings"]:visible');
  await page.waitForSelector('[data-screen="settings"]:not([hidden]) input[name="preset"]');
  await page.screenshot({ path: join(outDir, `smoke-${label}-settings.png`), fullPage: true });
  await page.click('.office__top a[href="#menu"]');
  await page.waitForSelector('[data-screen="menu"]:not([hidden])');
  await page.click('a.door[href="#sandbox"]');
  // "Wähle eine Strecke" opens first; the smoke test starts on the engine dyno
  await page.click('.routepick [data-pick="engine"]');
  await page.waitForSelector(RPM_READOUT, { state: "visible" });
  await page.waitForTimeout(300);

  await page.screenshot({ path: join(outDir, `smoke-${label}-idle.png`) });
  for (const sel of [RPM_READOUT, '[data-control="ignition"]', '[data-control="starter"]']) {
    if (!(await page.$(sel))) failures.push(`${label}: Element ${sel} fehlt`);
  }
  const rpm0 = await readRpm(page);

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

  const ignitionOn = await page.evaluate(() => document.querySelector('[data-control="ignition"]')?.checked ?? null);

  console.log(`${label}: rpm vor Start ${fmt(rpm0)}, nach Start ${fmt(rpmIdle)}, mit Gas ${fmt(rpmGas)}, Zündung ${ignitionOn}`);
  if (ignitionOn === false) failures.push(`${label}: Zündung (I) wurde nicht eingeschaltet`);
  if (!Number.isFinite(rpmGas) || !Number.isFinite(rpmIdle)) failures.push(`${label}: Drehzahlanzeige nicht lesbar`);
  else if (!(rpmGas > Math.max(rpmIdle, rpm0 || 0) + 300)) failures.push(`${label}: Drehzahl steigt nicht (Leerlauf ${fmt(rpmIdle)}, Gas ${fmt(rpmGas)})`);
  if (Number.isFinite(rpmIdle) && !(rpmIdle > 200)) failures.push(`${label}: Motor springt nicht an (rpm ${fmt(rpmIdle)})`);

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
