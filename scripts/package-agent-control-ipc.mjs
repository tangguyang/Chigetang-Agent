import packager from "@electron/packager";
import {
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const base = resolve("release/agent-control-ipc-" + Date.now()),
  stage = join(base, "app-staging");
// Unique output: preserve every previous green package. No recursive deletion.
mkdirSync(stage, { recursive: true });
for (const folder of ["dist", "resources"])
  cpSync(folder, join(stage, folder), { recursive: true });
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify({
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    main: pkg.main,
    description: pkg.description,
    author: pkg.author,
    license: pkg.license,
  }),
);
const [packed] = await packager({
  dir: stage,
  out: join(base, "packed"),
  platform: "win32",
  arch: "x64",
  name: pkg.productName,
  executableName: pkg.productName,
  electronVersion: pkg.devDependencies.electron,
  asar: false,
  prune: false,
  overwrite: false,
  icon: resolve("resources/brand.ico"),
  ...(process.env.AIVIDEO_ELECTRON_ZIP_DIR
    ? { electronZipDir: resolve(process.env.AIVIDEO_ELECTRON_ZIP_DIR) }
    : {}),
  appVersion: pkg.version,
});
const dir = join(
  base,
  "吃个糖Agent-v" + pkg.version + "-AgentControl-IPC-Windows-x64-绿色版",
);
renameSync(packed, dir);
for (const folder of ["docs", "licenses"])
  cpSync(folder, join(dir, folder), { recursive: true });
writeFileSync(
  join(dir, "chigetang.cmd"),
  '@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\nfor %%E in ("%~dp0*.exe") do set "AGENT_EXE=%%~fE"\r\n"%AGENT_EXE%" "%~dp0resources\\app\\dist\\cli\\launcher.cjs" %*\r\nexit /b %errorlevel%\r\n',
);
writeFileSync(
  join(dir, "AGENT-CONTROL-README.txt"),
  "GUI保持运行时，chigetang.cmd speech <command> --json 通过当前用户本机会话 Named Pipe 调用主进程。\r\n无需安装Node。确认付费前勿运行generate/patch-apply --confirm。详见docs/agent-control-v1/IPC-ACCEPTANCE.md。\r\n",
);
for (const file of [
  "吃个糖Agent.exe",
  "chigetang.cmd",
  "resources/app/dist/cli/launcher.cjs",
  "resources/app/dist/cli/index.mjs",
  "resources/app/dist/cli/paid.cjs",
  "resources/app/dist/agent-control/local-pipe.exe",
])
  if (!existsSync(join(dir, file)))
    throw Error("Missing portable runtime: " + file);
mkdirSync("tmp", { recursive: true });
writeFileSync(
  "tmp/agent-control-package.json",
  JSON.stringify(
    {
      directory: dir,
      version: pkg.version,
      architecture: "x64",
      installer: false,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ directory: dir, installer: false }));
