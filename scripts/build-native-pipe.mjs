import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
if (process.platform === "win32") {
  mkdirSync("dist/agent-control", { recursive: true });
  const compiler = resolve(
    process.env.WINDIR || "C:/Windows",
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  );
  if (!existsSync(compiler))
    throw Error("Windows .NET Framework compiler unavailable");
  const result = spawnSync(
    compiler,
    [
      "/nologo",
      "/target:exe",
      "/platform:x64",
      "/out:" + resolve("dist/agent-control/local-pipe.exe"),
      resolve("src/main/realSpeech/v2/nativePipe.cs"),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) throw Error(result.stdout + result.stderr);
}
