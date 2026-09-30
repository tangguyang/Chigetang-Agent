import { readFileSync, writeFileSync } from "node:fs";

const [exePath, fromVersion, toVersion] = process.argv.slice(2);
if (!exePath || !/^\d+\.\d+\.\d+$/.test(fromVersion ?? "") || !/^\d+\.\d+\.\d+$/.test(toVersion ?? ""))
  throw new Error("Usage: node scripts/patch-pe-version.mjs <exe> <from x.y.z> <to x.y.z>");
if (fromVersion.length !== toVersion.length)
  throw new Error("In-place PE patch requires equal-length version strings");

const bytes = readFileSync(exePath);
const fromText = Buffer.from(`${fromVersion}\0`, "utf16le");
const toText = Buffer.from(`${toVersion}\0`, "utf16le");
let textCount = 0;
for (let offset = 0; (offset = bytes.indexOf(fromText, offset)) >= 0; offset += toText.length) {
  toText.copy(bytes, offset);
  textCount++;
}
if (textCount !== 2) throw new Error(`Expected 2 PE version strings, found ${textCount}`);

const [major, minor, patch] = toVersion.split(".").map(Number);
const signature = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
let fixedCount = 0;
for (let offset = 0; (offset = bytes.indexOf(signature, offset)) >= 0; offset += 4) {
  if (bytes.readUInt32LE(offset + 4) !== 0x00010000) continue;
  const from = fromVersion.split(".").map(Number);
  const expectedMs = (from[0] << 16) | from[1];
  const expectedLs = from[2] << 16;
  if (bytes.readUInt32LE(offset + 8) !== expectedMs || bytes.readUInt32LE(offset + 12) !== expectedLs ||
      bytes.readUInt32LE(offset + 16) !== expectedMs || bytes.readUInt32LE(offset + 20) !== expectedLs) continue;
  bytes.writeUInt32LE((major << 16) | minor, offset + 8);
  bytes.writeUInt32LE(patch << 16, offset + 12);
  bytes.writeUInt32LE((major << 16) | minor, offset + 16);
  bytes.writeUInt32LE(patch << 16, offset + 20);
  fixedCount++;
}
if (fixedCount !== 1) throw new Error(`Expected 1 VS_FIXEDFILEINFO record, found ${fixedCount}`);
writeFileSync(exePath, bytes);
console.log(`Patched PE version ${fromVersion} → ${toVersion} (${textCount} strings, ${fixedCount} fixed record)`);
