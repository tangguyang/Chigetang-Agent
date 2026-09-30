import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const target = resolve("resources/sherpa-onnx-offline.exe");
const url =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-non-streaming-asr-x64-v1.13.8.exe";
const expected =
  "b8b540b59cc7951e4a5b6866f5f0260ea3850c6d24c1c6f5d4877e1e42bff528";

if (existsSync(target)) {
  console.log(`sherpa-onnx runtime already exists: ${target}`);
  process.exit(0);
}

console.log("Downloading official sherpa-onnx Windows x64 runtime...");
const response = await fetch(url, { redirect: "follow" });
if (!response.ok)
  throw new Error(`Failed to download sherpa-onnx runtime: HTTP ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
const actual = createHash("sha256").update(data).digest("hex");
if (actual !== expected)
  throw new Error(
    `sherpa-onnx runtime SHA-256 mismatch. Expected ${expected}, got ${actual}`,
  );
await mkdir(dirname(target), { recursive: true });
await writeFile(target, data);
console.log(`Downloaded and verified sherpa-onnx runtime: ${target}`);
