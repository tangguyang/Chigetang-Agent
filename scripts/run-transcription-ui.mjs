import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/test-transcription-ui.tsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "scripts/.transcription-ui.mjs",
  packages: "external",
  loader: { ".css": "empty" },
});
const result = spawnSync(
  process.execPath,
  ["--import", "./scripts/ui-env.mjs", "scripts/.transcription-ui.mjs"],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
