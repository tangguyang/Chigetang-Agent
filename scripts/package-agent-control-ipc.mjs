import packager from "@electron/packager";
import { verifyRuntime, verifyElectronArchive } from "./prepare-windows-runtime.mjs";
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
await verifyRuntime();
const electronZipDir = await verifyElectronArchive();
const base = resolve("release/capability-platform-" + Date.now()),
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
  electronZipDir,
  appVersion: pkg.version,
});
const dir = join(
  base,
  "吃个糖Agent-v" + pkg.version + "-LocalAI-Windows-x64-绿色版",
);
renameSync(packed, dir);
writeFileSync(join(dir,'APP-VERSION.txt'),pkg.version+'\n');
for (const folder of ["docs", "licenses"])
  cpSync(folder, join(dir, folder), {
    recursive: true,
    // Preserve internal development history in Git, outside the user package.
    filter: (source) => resolve(source) !== resolve("docs/maintenance/development-scripts"),
  });
writeFileSync(
  join(dir, "chigetang.cmd"),
  '@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\nfor %%E in ("%~dp0*.exe") do set "AGENT_EXE=%%~fE"\r\n"%AGENT_EXE%" "%~dp0resources\\app\\dist\\cli\\launcher.cjs" %*\r\nexit /b %errorlevel%\r\n',
);
writeFileSync(
  join(dir, "AGENT-CONTROL-README.txt"),
  "v" + pkg.version + " 本地AI执行平台：双击 agent-start.cmd 无窗口启动，或运行GUI。\r\nchigetang.cmd capability execute request.json，优先 capability.search / describe 按需发现。\r\nchigetang.cmd mcp 提供低Token stdio MCP，默认compact。无需安装Node，不模拟鼠标键盘。\r\n付费/删除动作必须确认。详见docs/current/CAPABILITY_RUNTIME.md。\r\n",
);
writeFileSync(join(dir,'agent-start.ps1'),"$ErrorActionPreference = 'Stop'\r\nStart-Process -FilePath (Join-Path $PSScriptRoot '吃个糖Agent.exe') -ArgumentList '--agent-headless' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden\r\n");
writeFileSync(join(dir,'agent-start.cmd'),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-start.ps1"\r\n');
writeFileSync(join(dir,'agent-stop-request.json'),JSON.stringify({capability:'runtime.stop',params:{},confirm:true},null,2));
writeFileSync(join(dir,'agent-stop.cmd'),'@echo off\r\ncall "%~dp0chigetang.cmd" capability execute "%~dp0agent-stop-request.json"\r\n');
const mcpConfig={mcpServers:{chigetang:{command:join(dir,'吃个糖Agent.exe'),args:[join(dir,'resources/app/dist/cli/launcher.cjs'),'mcp'],env:{ELECTRON_RUN_AS_NODE:'1'}}}};
writeFileSync(join(dir,'mcp-config.example.json'),JSON.stringify(mcpConfig,null,2));
const tomlPath=p=>JSON.stringify(p.replaceAll('\\','/'));
writeFileSync(join(dir,'codex-mcp.example.toml'),`[mcp_servers.chigetang]\ncommand = ${tomlPath(join(dir,'吃个糖Agent.exe'))}\nargs = [${tomlPath(join(dir,'resources/app/dist/cli/launcher.cjs'))}, "mcp"]\ntool_timeout_sec = 300\n[mcp_servers.chigetang.env]\nELECTRON_RUN_AS_NODE = "1"\n`);
writeFileSync(join(dir,'make-mcp-config.ps1'),`$ErrorActionPreference = 'Stop'
$taskExe = (Join-Path $PSScriptRoot '吃个糖Agent.exe').Replace('\\','/')
$taskEntry = (Join-Path $PSScriptRoot 'resources/app/dist/cli/launcher.cjs').Replace('\\','/')
$taskConfig = @{ mcpServers = @{ chigetang = @{ command = $taskExe; args = @($taskEntry, 'mcp'); env = @{ ELECTRON_RUN_AS_NODE = '1' } } } }
$taskConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'mcp-config.example.json') -Encoding UTF8
$taskExeJson = ConvertTo-Json -InputObject $taskExe -Compress
$taskEntryJson = ConvertTo-Json -InputObject $taskEntry -Compress
$taskToml = "[mcp_servers.chigetang]" + [Environment]::NewLine + "command = " + $taskExeJson + [Environment]::NewLine + "args = [" + $taskEntryJson + ', "mcp"]' + [Environment]::NewLine + "tool_timeout_sec = 300" + [Environment]::NewLine + "[mcp_servers.chigetang.env]" + [Environment]::NewLine + 'ELECTRON_RUN_AS_NODE = "1"'
$taskToml | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'codex-mcp.example.toml') -Encoding UTF8
Write-Output 'MCP configuration generated for this extracted directory.'
`);
writeFileSync(join(dir,'make-mcp-config.cmd'),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-mcp-config.ps1"\r\n');
for (const file of [
  "吃个糖Agent.exe",
  "chigetang.cmd",
  "resources/app/dist/cli/launcher.cjs",
  "resources/app/dist/cli/index.mjs",
  "resources/app/dist/cli/paid.cjs",
  "resources/app/dist/cli/capability.mjs",
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
