import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const archive = process.env.AIVIDEO_WINDOWS_BASE_ZIP;
if (!archive || !existsSync(archive))
  throw new Error("AIVIDEO_WINDOWS_BASE_ZIP must point to a verified prior Windows runtime ZIP");
const project = process.cwd();
const release = resolve(project, "release");
const staging = mkdtempSync(join(tmpdir(), "chigetang-runtime-rebase-"));
const destination = join(release, "吃个糖Agent-win32-x64");
if (resolve(staging) === release || resolve(destination) === release)
  throw new Error("Unsafe runtime staging path");
rmSync(destination, { recursive: true, force: true });
execFileSync("unzip", ["-q", resolve(archive), "-d", staging], { stdio: "inherit" });
const roots = readdirSync(staging, { withFileTypes: true }).filter((item) => item.isDirectory());
if (roots.length !== 1) throw new Error("Windows base ZIP must contain exactly one root directory");
const base = join(staging, roots[0].name);
for (const required of ["吃个糖Agent.exe", "resources/app/package.json", "resources/app/dist/main.cjs"])
  if (!existsSync(join(base, required))) throw new Error(`Windows base ZIP missing ${required}`);
const baseVersion = JSON.parse(readFileSync(join(base, "resources", "app", "package.json"), "utf8")).version;
cpSync(base, destination, { recursive: true });

const source = JSON.parse(readFileSync("package.json", "utf8"));
const appRoot = join(destination, "resources", "app");
for (const folder of ["dist", "resources"]) {
  rmSync(join(appRoot, folder), { recursive: true, force: true });
  cpSync(join(project, folder), join(appRoot, folder), { recursive: true });
}
writeFileSync(
  join(appRoot, "package.json"),
  JSON.stringify({
    name: source.name,
    productName: source.productName,
    version: source.version,
    description: source.description,
    author: source.author,
    license: source.license,
    main: source.main,
  }),
);
writeFileSync(join(destination, "APP-VERSION.txt"), `${source.version}\n`, "utf8");
for (const file of [
  "AGENTS.md",
  "README.md",
  "CHANGELOG.md",
  "THIRD-PARTY-NOTICES.md",
])
  cpSync(join(project, file), join(destination, basename(file)));
for (const folder of ["docs", "licenses"]) {
  rmSync(join(destination, folder), { recursive: true, force: true });
  cpSync(join(project, folder), join(destination, folder), { recursive: true });
}
mkdirSync(join(destination, "scripts"), { recursive: true });
for (const file of ["windows-smoke.ps1", "create-shortcut.ps1"])
  cpSync(join(project, "scripts", file), join(destination, "scripts", file));

// The verified runtime already contains the current brand icon and metadata.
// Patch only equal-length version values in place so a large signed Electron PE
// is not rewritten into an ever-growing executable by the resource library.
execFileSync(process.execPath, [join(project, "scripts", "patch-pe-version.mjs"),
  join(destination, "吃个糖Agent.exe"), String(baseVersion), String(source.version)], { stdio: "inherit" });
rmSync(staging, { recursive: true, force: true });
console.log(`Rebased verified Windows runtime to ${source.productName} ${source.version}: ${destination}`);
