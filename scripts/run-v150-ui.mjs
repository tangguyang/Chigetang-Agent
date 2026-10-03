import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/test-v150-ui.tsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "scripts/.v150-ui-tests.mjs",
  packages: "external",
  loader: { ".css": "empty" },
});
const result = spawnSync(
  process.execPath,
  ["--import", "./scripts/ui-env.mjs", "scripts/.v150-ui-tests.mjs"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
