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

// Behaviour checks from the review of PR #8.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(`checks: ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base);
  await page.waitForSelector(".cell");
  const expect = (ok, msg) => {
    if (!ok) errors.push(`check failed: ${msg}`);
  };
  const bore = '[data-path="block.boreMm"] .field__num';
  // decimal input: dot and comma
  for (const typed of ["81.5", "83,5"]) {
    await page.fill(bore, typed);
    await page.press(bore, "Enter");
    await page.waitForTimeout(50);
    const want = typed.replace(".", ",");
    expect((await page.inputValue(bore)) === want, `bore "${typed}" → ${await page.inputValue(bore)}`);
  }
  // automatic name follows the config, an own name is kept
  await page.selectOption('[data-path="block.layout"] select', "v");
  await page.waitForTimeout(80);
  const auto = await page.inputValue('[data-path="name"] input');
  expect(auto.startsWith("V4 Diesel"), `auto name "${auto}"`);
  expect((await page.textContent(".nameplate__title")) === auto.toUpperCase(), "nameplate title follows auto name");
  await page.fill('[data-path="name"] input', "Mein Prüfling");
  await page.press('[data-path="name"] input', "Tab");
  await page.selectOption('[data-path="block.layout"] select', "inline");
  await page.waitForTimeout(80);
  expect((await page.inputValue('[data-path="name"] input')) === "Mein Prüfling", "own name kept");
  // lock while running, unlock after ignition off and standstill
  await page.mouse.click(700, 20);
  await page.keyboard.press("i");
  await page.keyboard.down("s");
  await page.waitForTimeout(700);
  await page.keyboard.up("s");
  await page.waitForTimeout(300);
  expect(await page.isVisible(".bench__lock"), "lock hint visible while running");
  expect(await page.isDisabled(bore), "bench inputs disabled while running");
  const rpmRunning = Number((await page.textContent('[data-gauge="rpm"] .gauge__value')).replace(/\./g, ""));
  expect(rpmRunning > 300, `engine keeps running (rpm ${rpmRunning})`);
  await page.keyboard.press("i");
  await page.waitForFunction(() => !document.querySelector(".bench")?.classList.contains("is-locked"), null, { timeout: 15000 }).catch(() => {});
  expect(!(await page.isDisabled(bore)), "bench unlocked after engine stopped");
  expect(!(await page.isVisible(".bench__lock")), "lock hint hidden when stopped");
  // focus ring is not yellow
  await page.focus(bore);
  const ring = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).boxShadow, bore);
  expect(!/246, 168, 0/.test(ring), `focus ring not yellow (${ring})`);
  // dispose stops the loop and removes the UI
  const disposed = await page.evaluate(() => {
    const app = window.__pruefzelle;
    app.dispose();
    return document.getElementById("app").childElementCount === 0 && !window.__pruefzelle;
  });
  expect(disposed, "dispose() clears the app");
  await page.close();
}

// Engine sound: unmute with a real click (user gesture), run the engine, measure the output.
// The init script only taps the signal for the test: every connection to ctx.destination is mirrored
// into an AnalyserNode stored on window.__soundProbe. Production code is unchanged.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const tag = "sound";
  page.on("console", (m) => {
    const src = m.location()?.url ?? "";
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text() + src)) errors.push(`${tag}: ${m.text()}`);
    if (m.type() === "warning" && /Worklet|Sound/.test(m.text())) errors.push(`${tag}: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript(() => {
    const add = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (url, ...rest) {
      const p = add.call(this, url, ...rest);
      window.__workletUrl = String(url);
      p.then(() => (window.__workletOk = true), (e) => (window.__workletErr = String(e)));
      return p;
    };
    const orig = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (dest instanceof AudioDestinationNode) {
        const ctx = this.context;
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        orig.call(this, an);
        window.__soundProbe = { ctx, an };
      }
      return orig.call(this, dest, ...rest);
    };
  });
  const expect = (ok, msg) => {
    if (!ok) errors.push(`check failed: ${msg}`);
  };
  await page.goto(base);
  await page.waitForSelector(".cell");
  expect(!(await page.isVisible("text=Motorklang folgt")), "placeholder hint removed");
  await page.click('[data-control="mute"]');
  await page.waitForFunction(() => window.__soundProbe?.ctx.state === "running", null, { timeout: 5000 }).catch(() => {});
  const state = await page.evaluate(() => window.__soundProbe?.ctx.state ?? "none");
  expect(state === "running", `AudioContext state after click: ${state}`);
  await page.waitForFunction(() => window.__workletOk || window.__workletErr, null, { timeout: 5000 }).catch(() => {});
  const w = await page.evaluate(() => ({ url: window.__workletUrl, ok: !!window.__workletOk, err: window.__workletErr }));
  const workletLoaded = w.ok && w.url === new URL("engine-worklet.js", base).href;
  expect(workletLoaded, `engine-worklet.js loaded relative to the page (${JSON.stringify(w)})`);
  await startAndRev(page, 1500);
  const peak = await page.evaluate(async () => {
    const { an } = window.__soundProbe;
    const buf = new Float32Array(an.fftSize);
    let p = 0;
    for (let i = 0; i < 20; i++) {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) p = Math.max(p, Math.abs(v));
      await new Promise((r) => setTimeout(r, 25));
    }
    return p;
  });
  expect(peak > 0.01, `engine sound peak ${peak.toFixed(3)} at full throttle`);
  console.log(`sound: context ${state}, worklet ${workletLoaded}, peak ${peak.toFixed(3)}`);
  await page.close();
}

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
