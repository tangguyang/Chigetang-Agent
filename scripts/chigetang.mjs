#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
const portable = existsSync(
  resolve(dirname(process.execPath), "resources/app/dist/cli/index.mjs"),
);
const project = portable
    ? resolve(dirname(process.execPath), "resources/app")
    : resolve(dirname(process.argv[1]), ".."),
  args = process.argv.slice(2);
const paid =
  args[0] === "speech" &&
  ["generate", "patch-apply"].includes(args[1]) &&
  args.includes("--confirm");
const entry = resolve(project, "dist/cli/index.mjs");
const failure = (message) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      schema: "CHIGETANG_AGENT_CLI_RESULT_V1",
      command: args[1] || "unknown",
      error: { code: "CLI_RUNNER_FAILED", message },
    }) + "\n",
  );
  process.exitCode = 1;
};
if (!existsSync(entry))
  failure("请先执行 npm run build:cli；只读命令不会自动构建或写文件");
else {
  const env = {
    ...process.env,
    CHIGETANG_PROJECT_ROOT: project,
    CHIGETANG_CLI_LAUNCHER_PID: String(process.pid),
  };
  if (portable) env.ELECTRON_RUN_AS_NODE = "1";
  else delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_ENABLE_LOGGING;
  let r = spawnSync(process.execPath, [entry, ...args], {
    env,
    cwd: project,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  // Bootstrap the vault only if no GUI bridge exists. No command/job/TTS has run.
  let initial;
  try {
    initial = JSON.parse(r.stdout);
  } catch {}
  if (paid && initial?.error?.code === "PAID_RUNTIME_REQUIRED") {
    delete env.ELECTRON_RUN_AS_NODE;
    const executable = portable
      ? process.execPath
      : resolve(
          project,
          process.platform === "win32"
            ? "node_modules/electron/dist/electron.exe"
            : "node_modules/electron/dist/electron",
        );
    r = spawnSync(
      executable,
      ["--disable-logging", resolve(project, "dist/cli/paid.cjs"), ...args],
      {
        env,
        cwd: project,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  }
  const lines = (r.stdout || "").trim().split(/\r?\n/),
    results = lines.flatMap((s) => {
      try {
        const v = JSON.parse(s);
        return v.schema === "CHIGETANG_AGENT_CLI_RESULT_V1" ? [v] : [];
      } catch {
        return [];
      }
    });
  if (results.length !== 1)
    failure("CLI未返回唯一合法JSON；未自动重试，请检查状态");
  else {
    process.stdout.write(JSON.stringify(results[0]) + "\n");
    process.exitCode = r.status ?? 1;
  }
  // Diagnostic output never shares stdout. No command-line/key dumps.
  if (r.stderr)
    process.stderr.write(
      r.stderr
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
        .replace(/\bBearer\s+[^\s"<>]+/gi, "Bearer [REDACTED]"),
    );
}
