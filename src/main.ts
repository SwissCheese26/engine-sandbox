// Entry point: mounts the game shell (main menu, settings, sandbox = Prüfzelle) behind a hash router (#42).
import { startInputDetection } from "./ui/device.ts";
import { mountShell } from "./ui/shell.ts";

const root = document.getElementById("app");
// touch or keyboard (#44): sets html.is-touch live, before the first screen renders its hints
startInputDetection();
if (root) mountShell(root);
