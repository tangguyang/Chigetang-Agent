import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeLock, verifyRuntime, assertX64PE } from "../scripts/prepare-windows-runtime.mjs";

test("Runtime gate rejects missing files and corrupt existing executables", async () => {
  const root = mkdtempSync(join(tmpdir(), "ctg-runtime-gate-"));
  await assert.rejects(verifyRuntime(root), /Missing resources\/ffmpeg.exe/);
  mkdirSync(join(root, "resources"));
  writeFileSync(join(root, "resources/ffmpeg.exe"), "corrupt-existing-runtime");
  await assert.rejects(verifyRuntime(root), /SHA256 mismatch/);
});
test("Runtime gate rejects x86, malformed and truncated PE files", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("MZ"), Buffer.alloc(100)])
    assert.throws(() => assertX64PE(bytes, "fixture"), /Windows x64 PE/);
  const bytes = Buffer.alloc(128);
  bytes.write("MZ"); bytes.writeUInt32LE(64, 60); bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(0x14c, 68);
  assert.throws(() => assertX64PE(bytes, "x86"), /Windows x64 PE/);
  bytes.writeUInt16LE(0x8664, 68);
  assert.doesNotThrow(() => assertX64PE(bytes, "x64"));
});
test("Pinned sources preserve accepted binaries and service runtime paths", () => {
  assert.deepEqual(runtimeLock.artifacts.map(a => a.target), ["resources/ffmpeg.exe", "resources/ffprobe.exe", "resources/sherpa-onnx/sherpa-onnx-offline.exe"]);
  for (const a of runtimeLock.artifacts) {
    assert.match(a.url, /^https:\/\/github.com\//);
    assert(!a.url.includes("/download/latest/"));
    assert.match(a.sha256, /^[a-f0-9]{64}$/);
    assert.match(a.binarySHA256, /^[a-f0-9]{64}$/);
  }
});
