import packager from "@electron/packager";
import {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  cpSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
const source = JSON.parse(readFileSync("package.json", "utf8"));
const stage = resolve("release/app-staging");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const folder of ["dist", "resources"])
  cpSync(folder, join(stage, folder), { recursive: true });
writeFileSync(
  join(stage, "package.json"),
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
const dirs = await packager({
  dir: stage,
  out: "release",
  platform: "win32",
  arch: "x64",
  name: source.productName,
  executableName: source.productName,
  electronVersion: source.devDependencies.electron,
  ...(process.env.AIVIDEO_ELECTRON_ZIP_DIR
    ? { electronZipDir: resolve(process.env.AIVIDEO_ELECTRON_ZIP_DIR) }
    : {}),
  overwrite: true,
  asar: false,
  prune: false,
  icon: "resources/brand.ico",
  win32metadata: {
    CompanyName: source.productName,
    FileDescription: source.description,
    ProductName: source.productName,
  },
  appVersion: source.version,
});
for (const dir of dirs) {
  for (const f of [
    "HANDOFF.md",
    "README.md",
    "README-USER.md",
    "README-v1.2.9.md",
    `v${source.version}-Release-Notes.md`,
    `v${source.version}-Upgrade-Guide.md`,
    "CHANGELOG.md",
    "VERSION",
    "THIRD-PARTY-NOTICES.md",
  ])
    copyFileSync(f, join(dir, f === "VERSION" ? "APP-VERSION.txt" : f));
  for (const folder of ["docs", "licenses"])
    cpSync(folder, join(dir, folder), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  copyFileSync(
    "scripts/windows-smoke.ps1",
    join(dir, "scripts/windows-smoke.ps1"),
  );
  copyFileSync(
    "scripts/create-shortcut.ps1",
    join(dir, "scripts/create-shortcut.ps1"),
  );
  const app = join(dir, "resources", "app");
  const manifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  for (const f of [
    manifest.main,
    "dist/preload.cjs",
    "dist/renderer/index.html",
    "resources/MediaInfoModule.wasm",
    "resources/ffprobe.exe",
    "resources/docs/真人口播表演生产系统_使用手册_V5.0.md",
    "resources/docs/ChatGPT_真人口播返回协议_V1.2.md",
    "resources/sherpa-onnx/sherpa-onnx-offline.exe",
    "resources/sherpa-onnx/model-checksums.json",
    "resources/docs/音视频转文字_模型安装指南.txt",
  ])
    if (!existsSync(join(app, f))) throw new Error(`Missing runtime: ${f}`);
  if (
    readFileSync(join(dir, `${source.productName}.exe`))
      .subarray(0, 2)
      .toString() !== "MZ"
  )
    throw new Error("Invalid Windows executable");
  console.log(`Verified Windows package structure: ${dir}`);
}
rmSync(stage, { recursive: true, force: true });
