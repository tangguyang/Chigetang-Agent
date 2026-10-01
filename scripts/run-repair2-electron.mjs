import {spawnSync} from "node:child_process";
for(const script of ["scripts/run-real-speech-ui.mjs","scripts/run-v2-documents-native.mjs"]){const r=spawnSync(process.execPath,[script],{stdio:"inherit"});if(r.status!==0)process.exit(r.status??1);}
