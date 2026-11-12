// Entry point: mounts the game shell (main menu, settings, sandbox = Prüfzelle) behind a hash router (#42).
import { installErrorCapture } from "./ui/bug-dialog.ts";
import { mountShell } from "./ui/shell.ts";

// first, so errors during start-up reach the bug report (#55)
installErrorCapture();
const root = document.getElementById("app");
if (root) mountShell(root);
