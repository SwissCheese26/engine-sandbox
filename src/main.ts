// Entry point: mounts the game shell (main menu, settings, sandbox = Prüfzelle) behind a hash router (#42).
import { mountShell } from "./ui/shell.ts";

const root = document.getElementById("app");
if (root) mountShell(root);
