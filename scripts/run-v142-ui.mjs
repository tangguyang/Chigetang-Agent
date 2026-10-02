import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
await build({entryPoints:['scripts/test-v142-ui.tsx'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:'scripts/.v142-ui-tests.mjs',packages:'external',loader:{'.css':'empty'}});
const r=spawnSync(process.execPath,['--import','./scripts/ui-env.mjs','scripts/.v142-ui-tests.mjs'],{stdio:'inherit'});process.exit(r.status??1);
