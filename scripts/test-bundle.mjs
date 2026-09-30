import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/bundle-smoke.ts"],
  outfile: "scripts/.bundle-smoke.cjs",
  platform: "node",
  bundle: true,
  format: "cjs",
  alias: { "mediainfo.js": "./node_modules/mediainfo.js/dist/cjs/index.cjs" },
});
const result = spawnSync(process.execPath, ["scripts/.bundle-smoke.cjs"], {
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
