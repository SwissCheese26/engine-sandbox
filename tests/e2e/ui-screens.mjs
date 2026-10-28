// UI screenshots of the Prüfzelle at desktop and phone width, idle and with the engine running at
// full throttle. Usage: bun scripts/build.ts && node tests/e2e/ui-screens.mjs [outDir]
// Serves dist/ itself (no extra server needed). Fails on console errors / page errors.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require("/opt/node22/lib/node_modules/playwright");
}

const root = resolve("dist");
const outDir = resolve(process.argv[2] ?? "tests/e2e/screenshots");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(outDir, { recursive: true });

const browser = await playwright.chromium.launch();
const errors = [];
const shots = [];

async function run(name, viewport, steps) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    const src = m.location()?.url ?? "";
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text() + src))
      errors.push(`${name}: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  // Google Fonts may be unreachable offline; abort quickly instead of waiting for timeouts.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base);
  await page.waitForSelector(".cell");
  await page.waitForTimeout(300);
  const scrollTo = await steps(page);
  // Phone shots are viewport shots (full-page captures misplace the sticky header and console).
  if (scrollTo) await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "start" }), scrollTo);
  if (scrollTo) await page.evaluate(() => window.scrollBy(0, -64));
  await page.waitForTimeout(120);
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  await page.close();
}

async function startAndRev(page, ms = 2500) {
  await page.mouse.click(5, 5);
  await page.keyboard.press("i");
  await page.keyboard.down("s");
  await page.waitForTimeout(900);
  await page.keyboard.up("s");
  await page.waitForTimeout(400);
  await page.keyboard.down(" ");
  await page.waitForTimeout(ms);
}

for (const [label, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  await run(`${label}-idle-diesel`, viewport, async () => {});
  await run(`${label}-running-diesel`, viewport, async (page) => {
    await page.click("text=Volllastkurve messen");
    await startAndRev(page);
    return viewport.width < 800 ? ".instruments" : null;
  });
  await run(`${label}-running-petrol`, viewport, async (page) => {
    if (viewport.width < 1100) await page.click(".bench-toggle");
    await page.click(".fuel-switch label:nth-child(3)");
    if (viewport.width < 1100) await page.click(".bench-toggle");
    await page.click("text=Volllastkurve messen");
    await startAndRev(page, 3000);
    return viewport.width < 800 ? ".recorder" : null;
  });
}
await run("mobile-bench-open", { width: 390, height: 844 }, async (page) => {
  await page.click(".bench-toggle");
  await page.waitForTimeout(100);
});
await run("desktop-v8-petrol", { width: 1440, height: 900 }, async (page) => {
  await page.click(".fuel-switch label:nth-child(3)");
  await page.selectOption('[data-path="block.layout"] select', "v");
  await page.click('[data-path="block.cylinders"] label:has-text("8")');
  await page.selectOption('[data-path="induction.aspiration"] select', "twin-turbo-parallel");
  await page.click("text=Volllastkurve messen");
  await startAndRev(page, 2000);
});

// Keyboard reachability: every interactive control must be focusable by Tab.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base);
  await page.waitForSelector(".cell");
  const unreachable = await page.evaluate(() => {
    const sel = "button, input, select, [role=slider]";
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null && !el.disabled)
      .filter((el) => el.tabIndex < 0 && !(el.type === "radio"))
      .map((el) => el.outerHTML.slice(0, 80));
  });
  if (unreachable.length) errors.push(`not focusable: ${unreachable.join(", ")}`);
  await page.close();
}

await browser.close();
server.close();
console.log(shots.join("\n"));
if (errors.length) {
  console.error("Console errors:\n" + errors.join("\n"));
  process.exit(1);
}
