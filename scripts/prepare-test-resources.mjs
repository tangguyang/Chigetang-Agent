import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("resources", { recursive: true });
copyFileSync("node_modules/mediainfo.js/dist/MediaInfoModule.wasm", "resources/MediaInfoModule.wasm");
