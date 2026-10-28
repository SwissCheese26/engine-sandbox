// Entry point. Team UI replaces this with the full test-cell app (src/ui/app.ts).
import { EngineSimulator, defaultInputs, summarize } from "./core/index.ts";
import { defaultConfig } from "./data/presets.ts";

const cfg = defaultConfig("diesel");
const sim = new EngineSimulator(cfg);
const sum = summarize(cfg);
const app = document.getElementById("app")!;
app.textContent = `${cfg.name}: ${sum.displacementL.toFixed(2)} l, ${Math.round(sum.peakTorqueNm)} Nm`;
void sim;
void defaultInputs;
