import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
await build({entryPoints:['scripts/test-repair-ui.tsx'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:'scripts/.repair-ui-tests.mjs',packages:'external',loader:{'.css':'empty'}});
const r=spawnSync(process.execPath,['--import','./scripts/ui-env.mjs','scripts/.repair-ui-tests.mjs'],{stdio:'inherit'});process.exit(r.status??1);
