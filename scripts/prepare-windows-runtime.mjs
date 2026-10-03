import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, mkdirSync, mkdtempSync, copyFileSync, renameSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const runtimeLock = JSON.parse(readFileSync(new URL("./windows-runtime-lock.json", import.meta.url), "utf8"));
export async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export function assertX64PE(bytes, label) {
  const offset = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
  if (bytes.subarray(0, 2).toString() !== "MZ" || offset < 0 || offset + 6 > bytes.length ||
      bytes.subarray(offset, offset + 4).toString("hex") !== "50450000" || bytes.readUInt16LE(offset + 4) !== 0x8664)
    throw new Error(`Not a Windows x64 PE: ${label}`);
}
export async function verifyRuntime(root = process.cwd()) {
  for (const artifact of runtimeLock.artifacts) {
    const path = resolve(root, artifact.target);
    if (!existsSync(path)) throw new Error(`Missing ${artifact.target}; run npm run prepare:runtime`);
    if (await fileHash(path) !== artifact.binarySHA256) throw new Error(`Runtime SHA256 mismatch: ${artifact.target}; existing files are never silently replaced`);
    assertX64PE(readFileSync(path), artifact.target);
  }
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${command} extraction failed: ${result.error?.message || result.stderr || result.stdout}`);
}
async function ensureArchive(artifact, archive) {
  if (!existsSync(archive)) {
    console.log(`Downloading pinned ${artifact.id || artifact.filename}`);
    const partial = `${archive}.${process.pid}.partial`;
    run("curl.exe", ["--fail", "--location", "--silent", "--show-error", "--max-time", "600", "--output", partial, artifact.url]);
    if (await fileHash(partial) !== artifact.sha256) throw new Error(`Archive SHA256 mismatch: ${artifact.id || artifact.filename}`);
    renameSync(partial, archive);
  }
  if (await fileHash(archive) !== artifact.sha256) throw new Error(`Cached archive SHA256 mismatch: ${artifact.id || artifact.filename}`);
}
export async function verifyElectronArchive() {
  const cache = resolve(process.env.AIVIDEO_ELECTRON_ZIP_DIR || process.env.AIVIDEO_RUNTIME_CACHE || "cache/windows-runtime");
  const archive = join(cache, runtimeLock.electron.filename);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (pkg.devDependencies.electron !== runtimeLock.electron.version) throw new Error("Electron version differs from runtime lock");
  if (!existsSync(archive) || await fileHash(archive) !== runtimeLock.electron.sha256) throw new Error("Missing or corrupt pinned Electron ZIP; run npm run prepare:runtime");
  return cache;
}
export async function prepareRuntime({ check = false, only } = {}) {
  if (check) return verifyRuntime();
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Preparation requires Windows x64 with system tar.exe and curl.exe");
  const cache = resolve(process.env.AIVIDEO_RUNTIME_CACHE || "cache/windows-runtime");
  mkdirSync(cache, { recursive: true });
  for (const artifact of runtimeLock.artifacts.filter(a => !only || a.id.startsWith(only))) {
    const target = resolve(artifact.target);
    if (existsSync(target)) {
      if (await fileHash(target) !== artifact.binarySHA256) throw new Error(`Runtime SHA256 mismatch: ${artifact.target}; preserve and review this file manually`);
      assertX64PE(readFileSync(target), artifact.target);
      console.log(`Verified existing ${artifact.target}`);
      continue;
    }
    const archive = join(cache, `${artifact.id}.${artifact.format}`);
    await ensureArchive(artifact, archive);
    const stage = mkdtempSync(join(cache, "extract-"));
    run("tar.exe", ["-xf", archive, "-C", stage, artifact.entry]);
    const extracted = join(stage, artifact.entry);
    if (await fileHash(extracted) !== artifact.binarySHA256) throw new Error(`Extracted binary SHA256 mismatch: ${artifact.id}`);
    assertX64PE(readFileSync(extracted), artifact.entry);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(extracted, target, 1); // COPYFILE_EXCL: never overwrite existing runtime.
    console.log(`Prepared and verified ${artifact.target}`);
  }
  if (!only) {
    const electronCache = resolve(process.env.AIVIDEO_ELECTRON_ZIP_DIR || cache);
    mkdirSync(electronCache, { recursive: true });
    await ensureArchive(runtimeLock.electron, join(electronCache, runtimeLock.electron.filename));
    await verifyElectronArchive();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareRuntime({ check: process.argv.includes("--check") });
  console.log("Windows x64 runtime verification passed");
}
