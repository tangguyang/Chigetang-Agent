import { probeMedia } from "../src/main/services/media.ts";
import { resolve } from "node:path";
import assert from "node:assert/strict";
async function main() {
  const metadata = await probeMedia(
    resolve("tests/fixtures/sample.mp4"),
    resolve("resources/MediaInfoModule.wasm"),
  );
  assert.equal(metadata.width, 640);
  assert.equal(metadata.fps, 30);
  console.log("Bundled MediaInfo reads real MP4 successfully.");
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
