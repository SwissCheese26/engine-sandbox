// Entry point: mounts the test cell (Prüfzelle).
import { mountApp } from "./ui/app.ts";

const root = document.getElementById("app");
if (root) mountApp(root);
