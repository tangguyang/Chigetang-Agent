import { spawnSync } from "node:child_process";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const setup = spawnSync(process.execPath, ["node_modules/electron/install.js"], { stdio: "inherit" });
if (setup.status !== 0) process.exit(setup.status ?? 1);
const r = spawnSync(npm, ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (r.status !== 0) process.exit(r.status ?? 1);
const electron =
  process.platform === "win32"
    ? "node_modules/electron/dist/electron.exe"
    : "node_modules/electron/dist/electron";
const child = spawnSync(electron, ["."], { stdio: "inherit" });
process.exit(child.status ?? 1);
