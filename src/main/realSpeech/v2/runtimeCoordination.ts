import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  watch,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { WINDOWS_DATA_ROOT } from "../../services/storage.ts";

const marker = (root: string) =>
  join(root, "config", "agent-control-runtime.json");
export function registerControlRuntime(root: string, exe: string) {
  writeFileSync(
    marker(root),
    JSON.stringify({
      schema: "CHIGETANG_CONTROL_RUNTIME_V1",
      protocol: "1",
      pid: process.pid,
      exe,
    }),
  );
  return () => {
    try {
      if (JSON.parse(readFileSync(marker(root), "utf8")).pid === process.pid)
        unlinkSync(marker(root));
    } catch {}
  };
}
export function watchSpeechChanges(root: string, changed: () => void) {
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(join(root, "real-speech-v2"), (_event, name) => {
    if (name && /^real_speech_v2\.db(?:-wal)?$/.test(String(name))) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(changed, 120);
    }
  });
  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
type DesktopProcess = {
  ProcessId: number;
  ParentProcessId: number;
  ExecutablePath: string;
};
export function assertCoordinatedDesktop(
  root: string,
  processes?: DesktopProcess[],
) {
  if (
    process.platform !== "win32" ||
    resolve(root).toLowerCase() !== resolve(WINDOWS_DATA_ROOT).toLowerCase()
  )
    return;
  if (!processes) {
    const script =
      "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $p=Get-CimInstance Win32_Process -Filter \"Name='吃个糖Agent.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath; ConvertTo-Json -InputObject @($p) -Compress";
    processes = JSON.parse(
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", windowsHide: true, timeout: 15000 },
      ).trim() || "[]",
    );
  }
  let registered: any;
  try {
    registered = JSON.parse(readFileSync(marker(root), "utf8"));
  } catch {}
  // A portable CLI uses the bundled Electron exe as Node; it is not a GUI writer.
  const allowed = new Set<number>([process.pid]);
  if (Number(process.env.CHIGETANG_CLI_LAUNCHER_PID) === process.ppid)
    allowed.add(process.ppid);
  if (registered?.protocol === "1" && registered?.pid) {
    try {
      process.kill(registered.pid, 0);
      allowed.add(registered.pid);
    } catch {}
  }
  for (let i = 0; i < processes!.length; i++)
    for (const p of processes!)
      if (allowed.has(p.ParentProcessId)) allowed.add(p.ProcessId);
  for (const p of processes!) {
    if (allowed.has(p.ProcessId)) continue;
    if (!p.ExecutablePath)
      throw Error("无法确认当前软件运行路径；CLI写操作已拒绝，请先退出旧程序");
    const manifest = join(
      dirname(p.ExecutablePath),
      "resources",
      "app",
      "package.json",
    );
    if (existsSync(manifest)) {
      const version = String(
        JSON.parse(readFileSync(manifest, "utf8")).version,
      );
      if (/^1\.[0-2]\./.test(version)) continue; // These releases use the separate old data root.
    }
    throw Error(
      "当前运行的绿色版不支持共享任务锁。CLI写操作已拒绝；先退出旧程序，或使用更新后的源码启动UI。只读命令仍可用。",
    );
  }
}
