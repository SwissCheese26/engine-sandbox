// E2E for the Engine Builder (#72), run from smoke.mjs. One full build of a 4-cylinder petrol turbo through all
// nine steps (with a blocked "Weiter" on a critical value), save, rev it on the builder's engine dyno, drive it in the
// Sandbox through the guided start, find it in the Sandbox's engine choice, survive a reload, rename and delete.
// Checks on the way: heading focus per step, live summary, no horizontal overflow, 44 px touch targets (phones).
import { join } from "node:path";

const NAME = "E2E Turbo-Vierer";

/** Reads a German integer readout ("6.702" → 6702). */
const int = (t) => Number(String(t ?? "").replace(/\./g, "").replace(/[^\d-]/g, "")) || 0;

export async function builderChecks({ browser, base, outDir, failures, errors, label, viewport }) {
  const touch = viewport.width < 700;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const fail = (m) => failures.push(`${label}: Engine Builder: ${m}`);
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)\.com/.test(`${m.text()} ${m.location()?.url ?? ""}`)) errors.push(`${label}: console.error (Builder): ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror (Builder): ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());

  const next = () => page.click(".eb__foot [data-nav=next]");
  const stepState = () => page.evaluate(() => ({
    focus: document.activeElement?.id ?? "",
    title: document.querySelector("#eb-step-h")?.textContent ?? "",
    current: document.querySelector(".eb__stepbtn[aria-current=step]")?.dataset.goto,
  }));
  /** Visible controls of the current view: no overflow, 44 px on phones. */
  const fit = async (where) => {
    const r = await page.evaluate(() => {
      const root = document.querySelector('[data-screen="builder"]');
      const sel = "button, select, input[type=text], input[type=range], .seg__opt span, .eb__card, .field--toggle .field__label";
      const t = [...root.querySelectorAll(sel)].filter((e) => e.getClientRects().length && !e.closest("[hidden], dialog"));
      const small = t.filter((e) => e.getBoundingClientRect().height < 44).map((e) => `${e.tagName.toLowerCase()}.${e.className}:${e.textContent?.trim().slice(0, 20)}`);
      return { overflow: document.documentElement.scrollWidth - window.innerWidth, small: small.slice(0, 5), n: t.length };
    });
    if (r.overflow > 0) fail(`${where} läuft horizontal über (${r.overflow} px)`);
    if (touch && r.small.length) fail(`${where}: Bedienelemente unter 44 px: ${r.small.join(", ")}`);
  };

  // the door in the main menu
  await page.click('a.door[href="#builder"]');
  await page.waitForSelector('[data-screen="builder"]:not([hidden]) [data-action=new]');
  const entered = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.classList.contains("office__title"), title: document.title }));
  if (entered.hash !== "#builder" || !entered.focus || !/Engine Builder/.test(entered.title)) fail(`Tor öffnet nicht richtig (${JSON.stringify(entered)})`);
  await fit("Übersicht");

  // 1 Grundlage
  await page.click("[data-action=new]");
  await page.waitForSelector(".eb__build:not([hidden])");
  let s = await stepState();
  if (s.focus !== "eb-step-h" || s.title !== "Grundlage" || s.current !== "0") fail(`Schritt 1: Fokus/Anzeige (${JSON.stringify(s)})`);
  await page.fill("#eb-name", NAME);
  await page.check('input[name="eb-fuel"][value="petrol"]');
  await fit("Schritt Grundlage");
  await page.screenshot({ path: join(outDir, `smoke-${label}-builder-basis.png`), fullPage: true });
  await page.press("#eb-name", "Enter"); // Enter in the form = Weiter

  // 2 Block: 4 cylinders, forged pistons; a critical compression blocks Weiter
  s = await stepState();
  if (s.focus !== "eb-step-h" || s.title !== "Block") fail(`Schritt 2: Fokus/Anzeige (${JSON.stringify(s)})`);
  await page.click('[data-path="block.cylinders"] .seg__opt:has(input[value="4"])');
  await page.selectOption('[data-path="block.pistons"] select', "forged-aluminium");
  const info = await page.textContent('[data-path="block.pistons"] .field__info');
  if (!/geschmiedet/i.test(info ?? "")) fail(`keine Erklärung zum Kolben („${info}“)`);
  const cr = '[data-path="block.compressionRatio"] .field__num';
  await page.fill(cr, "13,5");
  await page.press(cr, "Enter");
  await page.waitForTimeout(50);
  await next();
  const blocked = await page.evaluate(() => ({
    title: document.querySelector("#eb-step-h").textContent, box: !document.querySelector("[data-out=blockers]").hidden,
    focus: document.activeElement?.dataset.out, text: document.querySelector("[data-out=blockers]").textContent,
  }));
  if (blocked.title !== "Block" || !blocked.box || blocked.focus !== "blockers" || !/klopft/.test(blocked.text)) fail(`kritische Verdichtung hält Weiter nicht auf (${JSON.stringify(blocked)})`);
  await page.fill(cr, "9,5");
  await page.press(cr, "Enter");
  await fit("Schritt Block");
  await page.screenshot({ path: join(outDir, `smoke-${label}-builder-block.png`), fullPage: true });
  await next();

  // 3 Zylinderkopf, 4 Gemischbildung
  for (const title of ["Zylinderkopf", "Gemischbildung"]) {
    s = await stepState();
    if (s.title !== title || s.focus !== "eb-step-h") fail(`Schritt ${title}: (${JSON.stringify(s)})`);
    await fit(`Schritt ${title}`);
    await next();
  }
  // 5 Aufladung: turbo with 1,2 bar
  s = await stepState();
  if (s.title !== "Aufladung") fail(`Schritt Aufladung fehlt (${s.title})`);
  await page.selectOption('[data-path="induction.aspiration"] select', "naturally-aspirated");
  await page.waitForTimeout(50);
  const kwNa = int(await page.textContent("[data-out=kw]"));
  await page.selectOption('[data-path="induction.aspiration"] select', "turbo");
  const boost = '[data-path="induction.boostTargetBar"] .field__num';
  await page.fill(boost, "1,2");
  await page.press(boost, "Enter");
  await page.waitForTimeout(50);
  const kwTurbo = int(await page.textContent("[data-out=kw]"));
  if (!(kwTurbo > kwNa * 1.2)) fail(`Live-Leistung reagiert nicht auf den Turbo (Sauger ${kwNa}, Turbo ${kwTurbo})`);
  const sum = await page.evaluate(() => ["disp", "nm", "bs", "cm", "cr", "kg"].map((k) => document.querySelector(`[data-out=${k}]`)?.textContent ?? ""));
  if (sum.some((t) => !/\d/.test(t))) fail(`Zusammenfassung unvollständig (${sum.join(" | ")})`);
  await fit("Schritt Aufladung");
  await next();
  // 6 Abgas, 7 Kühlung, 8 Grenzen
  for (const title of ["Abgas", "Kühlung", "Grenzen und Steuergerät"]) {
    s = await stepState();
    if (s.title !== title) fail(`Schritt ${title} fehlt (${s.title})`);
    await next();
  }
  // 9 Fertig: curve, nameplate, report; going back keeps everything
  s = await stepState();
  if (s.title !== "Fertig") fail(`Schritt Fertig fehlt (${s.title})`);
  await page.click(".eb__foot [data-nav=back]");
  await page.click('.eb__stepbtn[data-goto="8"]');
  const fin = await page.evaluate(() => ({
    curve: !!document.querySelector("[data-out=curve] svg path.eb__torque"), plate: document.querySelector(".eb .nameplate__title")?.textContent ?? "",
    report: document.querySelectorAll("[data-out=findings] li").length, save: document.querySelector(".eb__foot [data-nav=next]").textContent,
  }));
  if (!fin.curve || !fin.plate.includes(NAME.toUpperCase()) || fin.report < 1 || fin.save !== "Speichern") fail(`Fertig-Seite unvollständig (${JSON.stringify(fin)})`);
  await fit("Schritt Fertig");
  await page.screenshot({ path: join(outDir, `smoke-${label}-builder-finish.png`), fullPage: true });
  await next();
  await page.waitForSelector("[data-out=saved]:not([hidden])");
  const saved = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("pruefzelle.myEngines") ?? "null");
    const e = raw?.engines?.[0];
    return { focus: document.activeElement?.dataset.out, n: raw?.engines?.length, id: e?.id, name: e?.name, cyl: e?.config.block.cylinders, asp: e?.config.induction.aspiration, boost: e?.config.induction.boostTargetBar, pistons: e?.config.block.pistons, draft: localStorage.getItem("pruefzelle.builderDraft") };
  });
  if (saved.focus !== "saved" || saved.n !== 1 || saved.name !== NAME || saved.cyl !== 4 || saved.asp !== "turbo" || saved.boost !== 1.2 || saved.pistons !== "forged-aluminium" || saved.draft !== null)
    fail(`Speichern (${JSON.stringify(saved)})`);
  await fit("Gespeichert");

  // rev it at standstill, by keyboard: ignition, hold the starter, lever to full
  await page.click("[data-action=rev]");
  await page.waitForSelector(".revstand:visible");
  if ((await page.evaluate(() => document.activeElement?.id)) !== "rev-h") fail("Hochdrehen: Fokus nicht auf der Überschrift");
  await page.click("[data-control=ign]");
  await page.focus("[data-control=starter]");
  await page.keyboard.down(" ");
  await page.waitForTimeout(1500);
  await page.keyboard.up(" ");
  await page.waitForTimeout(500);
  const idle = int(await page.textContent(".revstand [data-out=rpm]"));
  await page.focus("[data-control=lever]");
  await page.keyboard.press("End");
  await page.waitForTimeout(1800);
  const revved = int(await page.textContent(".revstand [data-out=rpm]"));
  console.log(`${label}: Builder-Prüfstand Leerlauf ${idle}, Handgas voll ${revved} 1/min`);
  if (!(idle > 400)) fail(`Motor springt im Stand nicht an (${idle} 1/min)`);
  if (!(revved > idle + 1500)) fail(`Motor dreht im Stand nicht hoch (Leerlauf ${idle}, Gas ${revved})`);
  await fit("Hochdrehen");
  await page.screenshot({ path: join(outDir, `smoke-${label}-builder-rev.png`), fullPage: true });
  await page.click("[data-control=close]");
  if ((await page.evaluate(() => document.activeElement?.dataset.action)) !== "rev") fail("Zurück vom Prüfstand: Fokus nicht auf „Am Stand hochdrehen“");

  // drive it: guided start with the engine preselected → Golf 7 GTI, flat route
  await page.click("[data-action=drive]");
  await page.waitForSelector(".wizard[open]");
  const note = await page.textContent(".wizard [data-out=engine-note]");
  if (!note?.includes(NAME)) fail(`Sandbox-Start nennt den Motor nicht („${note}“)`);
  // Esc closes only the dialog, the builder stays
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const stay = await page.evaluate(() => ({ hash: location.hash, open: !!document.querySelector(".wizard[open]") }));
  if (stay.hash !== "#builder" || stay.open) fail(`Esc im Sandbox-Start (${JSON.stringify(stay)})`);
  await page.click("[data-action=drive]");
  await page.waitForSelector(".wizard[open]");
  await page.click('.wizard [data-kind="car"]');
  await page.click('.wizard__vehicle:has(input[value="car-vw-golf7-gti"])');
  for (let i = 0; i < 4 && (await page.isVisible(".wizard[open]")); i++) await page.click('.wizard [data-nav="next"]');
  await page.waitForFunction(() => location.hash === "#sandbox");
  await page.waitForTimeout(600);
  const inSandbox = await page.evaluate(() => document.querySelector('[data-screen="sandbox"] .nameplate__title')?.textContent ?? "");
  if (!inSandbox.includes(NAME.toUpperCase())) fail(`Sandbox fährt nicht mit dem gebauten Motor (Typenschild „${inSandbox}“)`);

  // the Sandbox's own engine choice (Eigenes Fahrzeug) and the workbench list it
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.click('a.door[href="#sandbox"]');
  await page.click('.wizard [data-kind="custom"]');
  const choice = await page.evaluate((id) => {
    const sel = document.querySelector('.wizard [data-c="engineId"]');
    const g = [...sel.querySelectorAll("optgroup")].find((o) => o.label === "Eigene Motoren");
    return { listed: !!g?.querySelector(`option[value="${id}"]`), name: g?.querySelector(`option[value="${id}"]`)?.textContent };
  }, saved.id);
  if (!choice.listed || choice.name !== NAME) fail(`eigener Motor fehlt in der Motorwahl der Sandbox (${JSON.stringify(choice)})`);
  await page.screenshot({ path: join(outDir, `smoke-${label}-builder-sandbox-choice.png`) });
  await page.keyboard.press("Escape");
  const bench = await page.evaluate((id) => !!document.querySelector(`#werkbank optgroup[label="Eigene Motoren"] option[value="${id}"]`), saved.id);
  if (!bench) fail("eigener Motor fehlt in der Motorwahl der Werkbank");

  // reload: still there; rename by keyboard (Esc cancels without leaving), delete with confirmation
  await page.goto(base + "#builder", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".eb__engine");
  const row = `.eb__engine[data-id="${saved.id}"]`;
  if ((await page.textContent(`${row} .eb__etitle`)) !== NAME) fail("nach Neuladen nicht mehr in „Meine Motoren“");
  await fit("Meine Motoren");
  await page.screenshot({ path: join(outDir, `smoke-${label}-builder-garage.png`), fullPage: true });
  await page.click(`${row} [data-row=rename]`);
  await page.keyboard.press("Escape");
  const esc = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.dataset.row }));
  if (esc.hash !== "#builder" || esc.focus !== "rename") fail(`Esc beim Umbenennen (${JSON.stringify(esc)})`);
  await page.click(`${row} [data-row=rename]`);
  await page.fill(`${row} input[data-control=rename]`, "Umbenannt");
  await page.keyboard.press("Enter");
  const renamed = await page.evaluate(() => JSON.parse(localStorage.getItem("pruefzelle.myEngines")).engines[0].name);
  if (renamed !== "Umbenannt" || (await page.textContent(`${row} .eb__etitle`)) !== "Umbenannt") fail(`Umbenennen (${renamed})`);
  await page.click(`${row} [data-row=delete]`);
  if ((await page.evaluate(() => document.activeElement?.dataset.row)) !== "delete-cancel") fail("Löschen fragt nicht nach (Fokus auf „Behalten“)");
  await page.click(`${row} [data-row=delete-ok]`);
  const gone = await page.evaluate(() => ({ n: JSON.parse(localStorage.getItem("pruefzelle.myEngines")).engines.length, empty: !document.querySelector("[data-out=empty]").hidden }));
  if (gone.n !== 0 || !gone.empty) fail(`Löschen (${JSON.stringify(gone)})`);
  await page.close();
}
