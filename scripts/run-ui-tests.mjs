import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/test-ui.tsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "scripts/.ui-tests.mjs",
  packages: "external",
  loader: { ".css": "empty" },
});
const r = spawnSync(
  process.execPath,
  ["--import", "./scripts/ui-env.mjs", "scripts/.ui-tests.mjs"],
  {
    stdio: "inherit",
  },
);
if (r.signal || r.error) console.error({ signal: r.signal, error: r.error });
process.exit(r.status ?? 1);
