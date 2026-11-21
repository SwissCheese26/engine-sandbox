// Rauch/Dampf (smoke overlay): burnout with a strong rear-wheel-drive car on the chassis dyno → the core reports
// wheel spin → the overlay canvas becomes active and paints faint smoke at the bottom edge of the instruments.
// Checked in every cockpit design and in the Prüfzelle view (position inside the visible stage, at the
// instruments, faint enough to read the gauges through, no pointer events). Let go → the overlay empties and hides.
// Screenshots: smoke-<label>-burnout.png and smoke-<label>-fx-<design>.png. Called from smoke.mjs.
import { join } from "node:path";

/** Every cockpit design (src/ui/layouts/designs.ts) plus the Prüfzelle view. */
const VIEWS = [
  ["cockpit", "classic"], ["cockpit", "night-orange"], ["cockpit", "italian"], ["cockpit", "oldschool"], ["cockpit", "digital"],
  ["cockpit", "hud"], ["cockpit", "motorrad"], ["cockpit", "race"], ["cockpit", "truck"], ["pruefzelle", null],
];

export async function smokeFxChecks({ browser, base, outDir, failures, errors, label, viewport }) {
  const touch = viewport.width < 700;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const fail = (m) => failures.push(`${label}: Rauch: ${m}`);
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(`${m.text()} ${m.location()?.url ?? ""}`)) errors.push(`${label}: console.error (Rauch): ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (Rauch): ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base, { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.clear();
    // cockpit view, no cheat sheet; "Effekte (Rauch/Dampf)" stays at its default (on)
    localStorage.setItem("pruefzelle.settings", JSON.stringify({ layout: "cockpit", cockpitDesign: "classic", sandboxIntro: false }));
  });
  await page.goto(base + "#sandbox", { waitUntil: "load" });
  if (await page.isVisible('.wizard[open] [data-pick="engine"]')) {
    await page.click('.wizard [data-pick="engine"]');
    if (await page.isVisible('.wizard[open] [data-nav="next"]')) await page.click('.wizard[open] [data-nav="next"]');
  }
  await page.waitForFunction(() => !!window.__pruefzelle);
  // BMW M3 E92 (S65 V8, 309 kW, RWD, manual) on the flat road
  await page.evaluate(() => window.__pruefzelle.applyPendingSetup({ kind: "car", vehicleId: "car-bmw-m3-e92", engineId: "lib-bmw-s65b40", route: "static" }));
  await page.waitForFunction(() => window.__pruefzelle.cfg.id === "lib-bmw-s65b40", null, { timeout: 5000 });
  // ASR/ESP off on a wet road: when the clutch bites at full throttle in 1st the rear wheels break loose
  await page.evaluate(() => {
    const d = window.__pruefzelle.gearbox.drivetrain;
    d.setAssists({ asr: false, esp: false });
    d.setEnvironment({ weather: "wet" });
  });

  /** Overlay state: painted pixels (in the stage, near the smoke source), the strongest alpha, the sources. */
  const overlay = () => page.evaluate(() => {
    const c = document.querySelector("canvas.smoke-overlay");
    if (!c) return null;
    const a = window.__pruefzelle;
    const anchors = a.smokeAnchors();
    const s = a.sim.state;
    let ink = 0, maxA = 0, inClip = true, minY = Infinity, maxY = -Infinity;
    if (!c.hidden && c.width) {
      const k = c.width / c.clientWidth;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4 * 3) {
        if (d[i] < 4) continue;
        ink++;
        maxA = Math.max(maxA, d[i]);
        const p = (i - 3) / 4;
        const x = (p % c.width) / k, y = Math.floor(p / c.width) / k;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        const r = anchors.clip;
        if (!r || x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) inClip = false;
      }
    }
    const view = document.querySelector(".cell")?.dataset.layout === "pruefzelle" ? document.querySelector(".instruments") : document.querySelector(".stage__view .ck");
    const vr = view?.getBoundingClientRect();
    return {
      active: c.dataset.active, hidden: c.hidden, pe: getComputedStyle(c).pointerEvents, ink, maxA, inClip, minY, maxY,
      tyreY: anchors.tyre?.y, viewTop: vr?.top, viewBottom: vr?.bottom, clipBottom: anchors.clip?.bottom,
      design: document.querySelector(".stage__view .ck")?.dataset.design ?? "-", spin: !!s.wheelSpin, slip: s.wheelSlip ?? 0,
    };
  });
  const idle = await overlay();
  if (!idle) return fail("Overlay-Canvas fehlt");
  if (idle.active !== "false" || !idle.hidden) fail(`Overlay im Stand aktiv (${JSON.stringify(idle)})`);
  if (idle.pe !== "none") fail(`Overlay fängt Klicks ab (pointer-events ${idle.pe})`);

  // start: ignition and starter
  await page.mouse.click(2, 2);
  await page.keyboard.press("i");
  await page.keyboard.down("a");
  await page.waitForTimeout(1200);
  await page.keyboard.up("a");
  await page.waitForTimeout(600);
  /** Brake to a stop until the last smoke has faded (overlay idle and hidden again), then 1st gear. */
  const stopAndClear = async () => {
    await page.keyboard.up(" ");
    await page.keyboard.down("s");
    const ok = await page.waitForFunction(() => {
      const c = document.querySelector("canvas.smoke-overlay");
      return c.dataset.active === "false" && c.hidden && window.__pruefzelle.gearbox.drivetrain.state.speedKmh < 1;
    }, null, { timeout: 12000 }).then(() => true, () => false);
    await page.keyboard.up("s");
    await page.evaluate(() => {
      const d = window.__pruefzelle.gearbox.drivetrain;
      while (d.state.gear > 1) d.shift(-1);
      while (d.state.gear < 1) d.shift(1);
    });
    return ok;
  };
  const setView = (layout, design) => page.evaluate(([layout, design]) => {
    const pick = (sel, v) => {
      const e = document.querySelector(sel);
      if (e && e.value !== v) {
        e.value = v;
        e.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    pick('select[data-control="layout"]', layout);
    if (design) pick('select[data-control="ck-design"]', design);
  }, [layout, design]);

  await stopAndClear();
  let first = true;
  for (const [layout, design] of VIEWS) {
    const name = design ?? layout;
    await setView(layout, design);
    await page.keyboard.down(" ");
    let seen = null;
    let last = null;
    for (let i = 0; i < 70 && !seen; i++) {
      await page.waitForTimeout(100);
      last = await overlay();
      if (last.active === "true" && last.ink > 20) seen = last;
    }
    if (!seen) {
      fail(`${name}: kein Reifenqualm beim Burnout (${JSON.stringify(last)})`);
      await stopAndClear();
      continue;
    }
    if (design && seen.design !== design) fail(`${name}: Design nicht aktiv (${seen.design})`);
    if (!seen.inClip) fail(`${name}: Rauch malt außerhalb der Bühne`);
    // the source sits on the bottom edge of the instruments (or the visible edge of the stage when they reach below it)
    const want = Math.min(seen.viewBottom, seen.clipBottom);
    if (!(Math.abs(seen.tyreY - want) < 2)) fail(`${name}: Rauchquelle nicht an der Unterkante der Instrumente (${seen.tyreY} statt ${want})`);
    if (!(seen.maxY <= want + 30 && seen.maxY >= want - 80)) fail(`${name}: Rauch nicht an den Instrumenten (y ${Math.round(seen.minY)}…${Math.round(seen.maxY)}, Quelle ${Math.round(want)})`);
    // faint: the gauges stay readable through it
    if (seen.maxA > 0.6 * 255) fail(`${name}: Rauch zu dicht (Alpha ${seen.maxA})`);
    // let the cloud build up for the picture
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(outDir, `smoke-${label}-fx-${name}.png`) });
    if (first) await page.screenshot({ path: join(outDir, `smoke-${label}-burnout.png`) });
    first = false;
    console.log(`${label}: Rauch ${name}: ${seen.ink} Pixel, Alpha max ${seen.maxA}, y ${Math.round(seen.minY)}…${Math.round(seen.maxY)}`);
    // let go and brake to a stop: particles fade, the overlay hides again (zero cost while idle)
    if (!(await stopAndClear())) fail(`${name}: Overlay bleibt nach dem Burnout aktiv`);
  }
  await page.close();
}
