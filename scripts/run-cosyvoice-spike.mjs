import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
await build({
  entryPoints: ["src/main/realSpeech/v2/spikeEntry.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "scripts/.spike-run.cjs",
  external: ["electron", "node:sqlite"],
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(
  resolve("node_modules/electron/dist/electron.exe"),
  [resolve("scripts/.spike-run.cjs"), ...process.argv.slice(2)],
  { env, stdio: "inherit", windowsHide: true, timeout: 15 * 60 * 1000 },
);
process.exit(r.status ?? 1);
