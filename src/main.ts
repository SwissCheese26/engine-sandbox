// Entry point: mounts the game shell (main menu, settings, sandbox = Prüfzelle) behind a hash router (#42).
import { installErrorCapture } from "./ui/bug-dialog.ts";
import { startInputDetection } from "./ui/device.ts";
import { WIPE_FLAG, clearAllStorage } from "./ui/settings.ts";
import { mountShell } from "./ui/shell.ts";

// first, so errors during start-up reach the bug report (#55)
installErrorCapture();
// "Alles zurücksetzen" (#66) wipes again after the reload: pagehide handlers of the old page (board computer,
// tank) may have written their keys back after the first wipe
try {
  if (sessionStorage.getItem(WIPE_FLAG) === "1") {
    sessionStorage.removeItem(WIPE_FLAG);
    clearAllStorage();
  }
} catch {
  /* storage blocked: nothing stored to wipe */
}
const root = document.getElementById("app");
// touch or keyboard (#44): sets html.is-touch live, before the first screen renders its hints
startInputDetection();
if (root) mountShell(root);
