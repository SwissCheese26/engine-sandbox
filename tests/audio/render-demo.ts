// Offline render of demo runs as WAV + numeric analysis (peak, DC, pitch, half-order share).
// Usage: bun tests/audio/render-demo.ts [outDir]
import { mkdir } from "node:fs/promises";
import { firingFrequencyHz } from "../../src/audio/model.ts";
import { ENGINES, type Key, autocorrPitchHz, dcOffset, halfOrderShare, rumbleShare, dominantOrder, mono, peakDbfs, renderRun, renderSteady, rmsDbfs, writeWav } from "./helpers.ts";

const out = process.argv[2] ?? "/tmp/claude-0/-home-claude/57b784e3-b2c1-5766-be08-8305ce6cc96d/scratchpad/sound";
await mkdir(out, { recursive: true });

/** Starter 0–0.8 s, idle until 2.5 s, full throttle up to near the limiter, bounce, lift off. */
function run(idle: number, limit: number, cold = false): Key[] {
  const c = cold ? 25 : 90;
  return [
    { t: 0, rpm: 0, pedal: 0, running: false, starter: true, coolantC: c },
    { t: 0.8, rpm: 220, pedal: 0, running: false, starter: true, coolantC: c },
    { t: 1.0, rpm: idle, pedal: 0, running: true, coolantC: c },
    { t: 2.5, rpm: idle, pedal: 0, coolantC: c },
    { t: 2.6, rpm: idle * 1.1, pedal: 1, coolantC: c },
    { t: 5.6, rpm: limit - 40, pedal: 1, coolantC: c },
    { t: 6.6, rpm: limit - 40, pedal: 1, coolantC: c },
    { t: 6.7, rpm: limit - 300, pedal: 0, coolantC: c },
    { t: 8.5, rpm: idle, pedal: 0, coolantC: c },
    { t: 9.5, rpm: idle, pedal: 0, coolantC: c },
  ];
}

const rows: string[] = [];
rows.push("| Motor | Peak dBFS | DC | RMS Leerlauf dBFS | RMS Volllast dBFS | f_Zünd Leerlauf (soll) | f Autokorr. | dominante Ordnung Leerlauf (soll z/2) | Halbordnungen @3000 | Grollen (0,5./1./1,5. O.) @3000 |");
rows.push("|---|---|---|---|---|---|---|---|---|---|");
for (const [name, cfg] of Object.entries(ENGINES)) {
  const cold = name.includes("cold");
  const r = renderRun(cfg, run(cfg.idleRpm, cfg.revLimitRpm, cold));
  await writeWav(`${out}/${name}.wav`, r);
  const all = mono(r);
  const idle = mono(r, 1.6, 2.5);
  const wot = mono(r, 4.5, 5.5);
  const fFire = firingFrequencyHz(cfg.idleRpm, cfg.block.cylinders);
  const f = autocorrPitchHz(idle, r.fs);
  const dom = dominantOrder(idle, r.fs, cfg.idleRpm, cfg.block.cylinders);
  const steady = renderSteady(cfg, 3000, 0.6, 1.5);
  const sm = mono(steady, 0.5);
  const half = halfOrderShare(sm, steady.fs, 3000, cfg.block.cylinders);
  const rumble = rumbleShare(sm, steady.fs, 3000, cfg.block.cylinders);
  rows.push(
    `| ${name} | ${peakDbfs(r).toFixed(1)} | ${dcOffset(all).toExponential(1)} | ${rmsDbfs(idle).toFixed(1)} | ${rmsDbfs(wot).toFixed(1)} | ${fFire.toFixed(1)} Hz | ${f.toFixed(1)} Hz (×${(fFire / f).toFixed(2)}) | ${dom} (${cfg.block.cylinders / 2}) | ${(half * 100).toFixed(0)} % | ${(rumble * 100).toFixed(1)} % |`,
  );
}
console.log(rows.join("\n"));
console.log(`\nWAVs: ${out}`);
