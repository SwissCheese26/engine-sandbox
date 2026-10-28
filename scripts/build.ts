// Production build: bundles all entrypoints with Bun and copies static files to dist/.
import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const ENTRYPOINTS = ["src/main.ts", "src/audio/engine-worklet.ts"].filter((p) => existsSync(p));

export async function build(opts: { minify?: boolean; outdir?: string } = {}) {
  const outdir = opts.outdir ?? "dist";
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const result = await Bun.build({
    entrypoints: ENTRYPOINTS,
    outdir,
    target: "browser",
    format: "esm",
    minify: opts.minify ?? true,
    sourcemap: "linked",
    naming: "[name].js",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Build failed");
  }

  await cp("index.html", `${outdir}/index.html`);
  if (existsSync("src/ui/styles")) await cp("src/ui/styles", `${outdir}/styles`, { recursive: true });
  if (existsSync("public")) {
    for (const f of await readdir("public")) await cp(`public/${f}`, `${outdir}/${f}`, { recursive: true });
  }
  return result;
}

if (import.meta.main) {
  const r = await build();
  console.log(`Built ${r.outputs.length} files to dist/`);
}
