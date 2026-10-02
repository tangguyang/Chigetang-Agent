import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
const source=process.argv[2];
if(!source) throw Error("Usage: node scripts/restore-repair2-runtime.mjs <existing-installed-resources-directory>");
const entries=JSON.parse(readFileSync("docs/archive/acceptance/v129-repair2/RUNTIME-RESOURCES.json","utf8").replace(/^\uFEFF/,""));
for(const item of entries) {
  const relative=item.file.replace(/^resources\//,"");
  const input=resolve(source,relative), output=resolve(item.file);
  const bytes=readFileSync(input);
  if(createHash("sha256").update(bytes).digest("hex")!==item.sha256)throw Error("Runtime hash mismatch: "+relative);
  mkdirSync(dirname(output),{recursive:true});copyFileSync(input,output);
  console.log("Verified runtime restored: "+relative);
}
