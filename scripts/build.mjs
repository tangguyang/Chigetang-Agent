import { build } from "esbuild";
await build({
  entryPoints: ["src/main/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "dist/main.cjs",
  external: ["electron", "node:sqlite"],
  alias: { "mediainfo.js": "./node_modules/mediainfo.js/dist/cjs/index.cjs" },
});
await build({
  entryPoints: ["src/main/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/preload.cjs",
  external: ["electron"],
});

import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync("resources", { recursive: true });
copyFileSync(
  "node_modules/mediainfo.js/dist/MediaInfoModule.wasm",
  "resources/MediaInfoModule.wasm",
);

import { cpSync } from "node:fs";
for (const folder of ["cmaps","standard_fonts","wasm"]) cpSync("node_modules/pdfjs-dist/"+folder,"dist/renderer/pdf/"+folder,{recursive:true});
await build({ entryPoints: ["src/main/realSpeech/v2/documentPreload.ts"], bundle:true, platform:"node", format:"cjs", outfile:"dist/speech-document-preload.cjs", external:["electron"] });
