import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "./validator.ts";

function alive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code !== "ESRCH";
  }
}
export class TaskLocks {
  held = new Set<string>();
  root: string;
  constructor(root: string) {
    this.root = root;
  }
  private file(id: string) {
    return join(this.root, "locks", sha256(id) + ".lock");
  }
  busy(id: string) {
    const file = this.file(id);
    if (!existsSync(file)) return false;
    try {
      return alive(JSON.parse(readFileSync(file, "utf8")).pid);
    } catch {
      return true;
    } // An incomplete/live lease is never guessed stale.
  }
  run<T>(id: string, fn: () => T): T {
    if (this.held.has(id)) throw Object.assign(Error("任务正在运行（共享任务锁）"), {code:"TASK_LOCK_BUSY"});
    mkdirSync(join(this.root, "locks"), { recursive: true });
    const file = this.file(id),
      token = randomUUID();
    // Never race another process to reclaim a stale paid-action lease.
    // A crash requires operator inspection; automatic retries are prohibited.
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, token }), {
        flag: "wx",
      });
    } catch {
      throw Object.assign(Error("任务正在运行（UI/CLI共享任务锁）"), {code:"TASK_LOCK_BUSY"});
    }
    this.held.add(id);
    const release = () => {
      try {
        if (JSON.parse(readFileSync(file, "utf8")).token === token)
          unlinkSync(file);
      } finally {
        this.held.delete(id);
      }
    };
    let asynchronous = false;
    try {
      const result = fn();
      if (result && typeof (result as any).then === "function") {
        asynchronous = true;
        return Promise.resolve(result).finally(release) as unknown as T;
      }
      return result;
    } finally {
      if (!asynchronous) release();
    }
  }
}
