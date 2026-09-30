import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["tests/transcription.test.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "scripts/.transcription-test.cjs",
  alias: { "mediainfo.js": "./node_modules/mediainfo.js/dist/cjs/index.cjs" },
});
const result = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", "scripts/.transcription-test.cjs"],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
