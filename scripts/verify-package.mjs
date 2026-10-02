import assert from "node:assert/strict";
import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import * as pe from "resedit";
const root = process.env.AIVIDEO_PACKAGE_ROOT || JSON.parse(readFileSync('tmp/agent-control-package.json','utf8')).directory,
  app = join(root, "resources/app");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const manifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
assert.equal(manifest.version, version);
assert.equal(readFileSync(join(root, "APP-VERSION.txt"), "utf8").trim(), version);
const bytes = readFileSync(join(root, "吃个糖Agent.exe"));
assert.equal(bytes.subarray(0, 2).toString(), "MZ");
const peOffset = bytes.readUInt32LE(60);
assert.equal(bytes.readUInt16LE(peOffset + 4), 0x8664);
const resource = pe.NtExecutableResource.from(pe.NtExecutable.from(bytes));
const info = pe.Resource.VersionInfo.fromEntries(resource.entries)[0];
const strings = info.getStringValues(info.getAllLanguagesForStringValues()[0]);
const peVersionMatches = (value) => value === version || value === `${version}.0`;
assert(peVersionMatches(strings.ProductVersion), `Unexpected ProductVersion: ${strings.ProductVersion}`);
assert(peVersionMatches(strings.FileVersion), `Unexpected FileVersion: ${strings.FileVersion}`);
const hash = (b) => createHash("sha256").update(b).digest("hex");
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
function verifyWindowsNames(dir) {
  const seen = new Map();
  for (const name of readdirSync(dir)) {
    const key = name.toLowerCase().replace(/[. ]+$/, "");
    assert(!seen.has(key), `Windows filename collision: ${dir}/${seen.get(key)} and ${name}`);
    seen.set(key, name);
    const path = join(dir, name);
    if (statSync(path).isDirectory()) verifyWindowsNames(path);
  }
}
verifyWindowsNames(root);
for (const f of walk("dist"))
  assert.equal(hash(readFileSync(join(app, f))), hash(readFileSync(f)), f);
for (const f of [
  "dist/main.cjs",
  "dist/preload.cjs",
  "dist/renderer/index.html",
  "resources/MediaInfoModule.wasm",
  "resources/ffmpeg.exe",
])
  assert(existsSync(join(app, f)), f);
for (const f of walk("resources/workflow"))
  assert.equal(hash(readFileSync(join(app, f))), hash(readFileSync(f)), f);
for (const dir of ["data", "assets", "projects", "outputs", "logs", "backups"])
  assert(!existsSync(join(root, dir)), dir + " must not be inside the program package");
assert(!existsSync(join(app, "node_modules")));
assert(!existsSync(join(app, "src")));
const ffmpeg = readFileSync(join(app, "resources/ffmpeg.exe"));
assert.equal(ffmpeg.subarray(0, 2).toString(), "MZ");
assert.equal(ffmpeg.readUInt16LE(ffmpeg.readUInt32LE(60) + 4), 0x8664);
assert.equal(hash(ffmpeg), hash(readFileSync("resources/ffmpeg.exe")));
assert(existsSync(join(root, "licenses/FFmpeg-GPL-3.0.txt")));
const iconGroups = pe.Resource.IconGroupEntry.fromEntries(resource.entries);
const iconItems = iconGroups.flatMap(g=>g.getIconItemsFromEntries(resource.entries));
const expectedSizes=[16,20,24,32,40,48,64,128,256];
for(const size of expectedSizes){
  const icon=iconItems.find(i=>(i.width || 256)===size && (i.height || 256)===size);
  assert(icon && icon.isRaw(), `Missing PNG icon size ${size}`);
  assert.equal(hash(Buffer.from(icon.bin)),hash(readFileSync(`resources/brand-${size}.png`)), `EXE icon mismatch ${size}`);
}
assert.equal(readFileSync("scripts/create-shortcut.ps1").subarray(0,3).toString("hex"),"efbbbf");
const report = {
  verified_icon_sizes: expectedSizes,
  version,
  platform: "win32",
  architecture: "x64",
  pe_strings: strings,
  exe_sha256: hash(bytes),
  runtime_structure_verified: true,
  bundled_application_matches_current_build: true,
  user_data_directories_absent_from_program: true,
  ffmpeg_x64_verified: true,
  ffmpeg_sha256: hash(ffmpeg),
  windows_case_insensitive_names_verified: true,
  windows_native_launch: "静态检查不声明GUI人工验收；最终包后台验证见v142-portable-report.json",
  paid_api_tested: false,
};
writeFileSync(
  "docs/acceptance/v142-package-verification.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `PASS Windows x64 PE / EXE version ${version} / bundled file hashes / FFmpeg x64 / user data outside program`,
);
