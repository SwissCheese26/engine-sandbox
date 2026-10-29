// E2E smoke test (issue #7). Does NOT build: run `bun scripts/build.ts` first.
// Serves dist/ with a tiny built-in node:http server, loads the app, fails on console/page errors,
// starts the engine with the keyboard (I = ignition, hold S = starter, hold Space = throttle),
// checks that the rpm readout rises, and writes screenshots (1440×900, 390×844) to
// tests/e2e/screenshots/.
//
// If the test cell UI is not present (no window.__pruefzelle and no [data-control] elements),
// it prints "UI noch nicht vorhanden – übersprungen" and exits 0.
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

/** Ignore failures of optional external resources (Google Fonts offline in CI/sandbox). */
const external = (text) => /fonts\.(googleapis|gstatic)\.com|ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|BLOCKED|FAILED)/.test(text);

async function readRpm(page) {
  return page.evaluate(() => {
    const w = window;
    const st = w.__pruefzelle?.sim?.state;
    if (st && typeof st.rpm === "number") return st.rpm;
    const el = document.querySelector('[data-gauge="rpm"] .gauge__value, [data-gauge="rpm"] output');
    if (!el) return NaN;
    // German number formatting: "1.234" or "1 234" → 1234
    const n = Number((el.textContent ?? "").replace(/[\s.  ]/g, "").replace(",", "."));
    return n;
  });
}

async function run(label, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = `${m.text()} ${m.location()?.url ?? ""}`;
    if (!external(text)) errors.push(`${label}: console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror: ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  await page.goto(base, { waitUntil: "load" });
  await page.waitForTimeout(500);

  const hasUi = await page.evaluate(() => Boolean(window.__pruefzelle) || document.querySelector("[data-control]") !== null);
  if (!hasUi) {
    skipped = true;
    await page.screenshot({ path: join(outDir, `smoke-${label}-placeholder.png`) });
    await page.close();
    return;
  }

  await page.screenshot({ path: join(outDir, `smoke-${label}-idle.png`) });
  const rpm0 = await readRpm(page);

  // focus the document (not a button) so the global key handler receives the keys
  await page.mouse.click(2, 2);
  await page.keyboard.press("i");
  await page.keyboard.down("s");
  await page.waitForTimeout(1200);
  await page.keyboard.up("s");
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
  if (!Number.isFinite(rpmGas)) failures.push(`${label}: Drehzahlanzeige nicht lesbar`);
  else if (!(rpmGas > Math.max(rpmIdle, rpm0 || 0) + 300)) failures.push(`${label}: Drehzahl steigt nicht (Leerlauf ${fmt(rpmIdle)}, Gas ${fmt(rpmGas)})`);
  if (Number.isFinite(rpmIdle) && !(rpmIdle > 200)) failures.push(`${label}: Motor springt nicht an (rpm ${fmt(rpmIdle)})`);

  await page.close();
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

if (skipped && errors.length === 0) {
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
