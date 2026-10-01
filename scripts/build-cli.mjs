import { build } from "esbuild";
await build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/cli/index.mjs",
  external: ["node:sqlite"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  alias: { "mediainfo.js": "./node_modules/mediainfo.js/dist/cjs/index.cjs" },
});
await build({
  entryPoints: ["src/cli/paidEntry.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "dist/cli/paid.cjs",
  external: ["electron", "node:sqlite"],
  alias: { "mediainfo.js": "./node_modules/mediainfo.js/dist/cjs/index.cjs" },
});
