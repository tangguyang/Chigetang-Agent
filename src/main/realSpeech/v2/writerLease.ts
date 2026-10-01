import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
/** Global V2 writer lease, acquired before a GUI or standalone CLI opens DB. */
export function acquireWriter(root: string) {
  mkdirSync(join(root, "config"), { recursive: true });
  const path = join(root, "config", "agent-control-writer.lock"),
    token = randomUUID();
  try {
    writeFileSync(path, JSON.stringify({ pid: process.pid, token }), {
      flag: "wx",
    });
  } catch {
    throw Error(
      "真人口播已有写入者或残留写入租约；禁止另开写库。请使用正在运行的GUI控制桥；异常中断先核账，不能自动抢占。",
    );
  }
  return () => {
    if (JSON.parse(readFileSync(path, "utf8")).token === token)
      unlinkSync(path);
  };
}
