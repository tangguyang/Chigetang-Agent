import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({entryPoints:["scripts/test-repair2-workflow-ui.tsx"],bundle:true,platform:"node",format:"esm",target:"node24",outfile:"scripts/.repair2-workflow-tests.mjs",packages:"external",loader:{".css":"empty"}});
const r=spawnSync(process.execPath,["--import","./scripts/ui-env.mjs","scripts/.repair2-workflow-tests.mjs"],{stdio:"inherit"});
process.exit(r.status??1);
