import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "./validator.ts";
import { parseArgs } from "../../../cli/args.ts";
import { SecretFilter, resultOutput } from "../../../cli/output.ts";
import type { SpeechAgentControl } from "./agentControl.ts";
const marker = (root: string) =>
  join(root, "config", "agent-control-runtime.json");
const normalize = (root: string) => resolve(root).toLowerCase();
export function bridgeMetadata(root: string) {
  let m: any;
  try {
    m = JSON.parse(readFileSync(marker(root), "utf8"));
  } catch {
    return null;
  }
  if (m.protocol !== "2") return null;
  try {
    process.kill(m.pid, 0);
  } catch (e) {
    if ((e as any)?.code === "ESRCH") return null;
    throw Error("无法核实GUI身份；禁止降级写数据库");
  }
  if (
    !/^chigetang-agent-control-v1-[a-f0-9]{24}$/.test(m.pipeName) ||
    !Number.isSafeInteger(m.pipeHostPid) ||
    normalize(m.root) !== normalize(root)
  )
    throw Error("本地控制桥元数据无效；禁止降级写数据库");
  return m;
}
export async function requestBridge(
  root: string,
  argv: string[],
  projectRoot: string,
): Promise<any | null> {
  const m = bridgeMetadata(root);
  if (!m) return null;
  const id = randomUUID(),
    helper = join(projectRoot, "dist/agent-control/local-pipe.exe");
  return new Promise((yes, no) => {
    const child = spawn(
      helper,
      ["--client", m.pipeName, String(m.pipeHostPid)],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      bytes = 0,
      diagnostic = "";
    const timer = setTimeout(() => {
      child.kill();
      no(Error("IPC等待超时；结果可能未知，禁止自动重发或降级直接写库"));
    }, 300_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (b) => {
      bytes += Buffer.byteLength(b);
      if (bytes > 33_000_000) {
        child.kill();
        return;
      }
      output += b;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (s) => {
      diagnostic = (diagnostic + s).slice(-512);
    });
    child.on("error", () => {
      clearTimeout(timer);
      no(Error("本地控制桥不可连接；禁止降级直接写库"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw Error();
        const response = JSON.parse(output);
        if (
          response.id !== id ||
          response.result?.schema !== "CHIGETANG_AGENT_CLI_RESULT_V1"
        )
          throw Error();
        yes(response.result);
      } catch {
        no(
          Error(
            "本地控制桥返回失败或结果未知；禁止自动重试及降级写库 " +
              diagnostic,
          ),
        );
      }
    });
    child.stdin.end(
      JSON.stringify({
        schema: "CHIGETANG_AGENT_CONTROL_REQUEST_V1",
        id,
        argv,
        root,
      }) + "\n",
    );
  });
}
export async function startControlBridge(
  root: string,
  projectRoot: string,
  getControl: () => SpeechAgentControl,
  changed: () => void,
  filter: SecretFilter,
  onFailure: () => void,
) {
  const pipeName =
    "chigetang-agent-control-v1-" +
    sha256(normalize(root) + ":" + process.pid).slice(0, 24);
  const child = spawn(
    join(projectRoot, "dist/agent-control/local-pipe.exe"),
    ["--server", pipeName, String(process.pid)],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stderr.resume();
  let stopping = false;
  const lines = createInterface({ input: child.stdout });
  await new Promise<void>((yes, no) => {
    const timer = setTimeout(() => no(Error("本地控制桥启动超时")), 15000);
    child.once("error", () => {
      clearTimeout(timer);
      no(Error("本地控制桥不可启动"));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      no(Error("本地控制桥已退出"));
    });
    lines.once("line", (line) => {
      clearTimeout(timer);
      try {
        const m = JSON.parse(line);
        if (m.kind !== "ready" || m.pipeHostPid !== child.pid) throw Error();
        writeFileSync(
          marker(root),
          JSON.stringify({
            schema: "CHIGETANG_CONTROL_RUNTIME_V1",
            protocol: "2",
            pid: process.pid,
            pipeHostPid: child.pid,
            pipeName,
            root: resolve(root),
          }),
        );
        yes();
      } catch {
        no(Error("控制桥身份校验失败"));
      }
    });
  }).catch((e) => {
    stopping = true;
    child.kill();
    throw e;
  });
  lines.on("line", async (line) => {
    let id = "",
      command = "unknown",
      result: any;
    try {
      const request = JSON.parse(line);
      id = request.id;
      if (
        request.schema !== "CHIGETANG_AGENT_CONTROL_REQUEST_V1" ||
        !/^[-a-zA-Z0-9]{1,64}$/.test(id) ||
        normalize(request.root) !== normalize(root) ||
        !Array.isArray(request.argv) ||
        request.argv.length > 40 ||
        request.argv.some(
          (s: any) => typeof s !== "string" || s.length > 2_000_000,
        )
      )
        throw Error("IPC请求不合法");
      const args = parseArgs(request.argv);
      command = args.command;
      if (command === "help") throw Error("help由CLI本地处理");
      if (
        args.values["data-root"] &&
        normalize(args.values["data-root"]) !== normalize(root)
      )
        throw Error("IPC数据目录不匹配");
      const data = await getControl().execute(args);
      result = JSON.parse(resultOutput(command, data, filter));
      changed();
    } catch (e) {
      result = JSON.parse(
        resultOutput(
          command,
          e instanceof Error ? e.message : "IPC命令失败",
          filter,
          true,
        ),
      );
    }
    if (!stopping) child.stdin.write(JSON.stringify({ id, result }) + "\n");
  });
  child.on("exit", () => {
    if (!stopping) onFailure();
  });
  return () => {
    stopping = true;
    try {
      if (JSON.parse(readFileSync(marker(root), "utf8")).pid === process.pid)
        unlinkSync(marker(root));
    } catch {}
    child.kill();
    lines.close();
  };
}
