import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
await build({
  entryPoints: ["scripts/test-v2-documents-native.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "scripts/.v2-doc-tests.cjs",
  external: ["electron"],
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(
  resolve("node_modules/electron/dist/electron.exe"),
  [resolve("scripts/.v2-doc-tests.cjs")],
  { stdio: "inherit", env, windowsHide: true, timeout: 60000 },
);
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
