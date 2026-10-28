// Dev server: rebuilds on every request (fast with Bun) and serves dist/.
import { build } from "./build.ts";

const port = Number(process.env.PORT ?? 5173);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (path === "/index.html") {
      try {
        await build({ minify: false, outdir: "dist" });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    const file = Bun.file(`dist${path}`);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file);
  },
});

console.log(`engine-sandbox dev server: http://localhost:${port}`);
