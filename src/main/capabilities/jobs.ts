import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  CapabilityRegistry,
  objectSchema,
  stringSchema as s,
  type CapabilityRequest,
} from "./registry.ts";
export function registerJobs(registry: CapabilityRegistry, root: string) {
  const directory = join(root, "config", "capability-jobs");
  mkdirSync(directory, { recursive: true });
  const records = new Map<string, any>();
  const save = (record: any) => {
    const file = join(directory, record.jobId + ".json"),
      temp = file + ".tmp";
    writeFileSync(temp, JSON.stringify(record), { flag: "w" });
    renameSync(temp, file);
  };
  for (const file of readdirSync(directory).filter((x) =>
    /^[a-f0-9-]{36}\.json$/.test(x),
  )) {
    const record = JSON.parse(readFileSync(join(directory, file), "utf8"));
    if (
      record.jobId + ".json" !== file ||
      typeof record.requestId !== "string" ||
      typeof record.status !== "string"
    )
      throw Error("后台台账无效；先检查备份，禁止自动重置");
    if (["queued", "running"].includes(record.status)) {
      record.status = "unknown";
      record.detail = "进程已中断；先核对服务任务、产物和费用，禁止自动重发";
      save(record);
    }
    records.set(record.jobId, record);
  }
  registry.register(
    {
      id: "jobs.wait",
      description: "本地等待job结束，超时返回当前状态；不会重发或取消",
      service: "CapabilityJobs",
      effect: "read",
      inputSchema: objectSchema(
        { jobId: s, timeout: { type: "integer", minimum: 0, maximum: 240000 } },
        ["jobId"],
      ),
      outputSchema: {},
    },
    async (p) => {
      const deadline = Date.now() + (p.timeout ?? 30000);
      let record = records.get(p.jobId);
      if (!record) throw Error("后台任务不存在");
      while (
        ["queued", "running"].includes(record.status) &&
        Date.now() < deadline
      ) {
        await new Promise((r) =>
          setTimeout(r, Math.min(200, deadline - Date.now())),
        );
        record = records.get(p.jobId)!;
      }
      return {
        ...record,
        timedOut: ["queued", "running"].includes(record.status),
      };
    },
  );
  registry.register(
    {
      id: "jobs.status",
      description: "读取后台执行状态；unknown 表示结果未知，禁止自动重发",
      service: "CapabilityJobs",
      effect: "read",
      inputSchema: objectSchema({ jobId: s }, ["jobId"]),
      outputSchema: {},
    },
    (p) => {
      const record = records.get(p.jobId);
      if (!record) throw Error("后台任务不存在");
      return record;
    },
  );
  registry.register(
    {
      id: "jobs.submit",
      description:
        "异步提交一个能力或工作流；必须使用唯一requestId；重复相同请求返回原job。用 jobs.status 查询结果。",
      service: "CapabilityJobs",
      effect: "write",
      inputSchema: objectSchema(
        {
          requestId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
          request: objectSchema(
            {
              capability: s,
              params: { type: "object" },
              confirm: { type: "boolean" },
            },
            ["capability"],
          ),
        },
        ["requestId", "request"],
      ),
      outputSchema: {},
    },
    (p) => {
      const request = p.request as CapabilityRequest;
      if (
        request.capability.startsWith("jobs.") ||
        request.capability === "runtime.stop"
      )
        throw Error("禁止嵌套调度或异步关闭进程");
      registry.validate(request);
      const hash = createHash("sha256")
        .update(JSON.stringify(request))
        .digest("hex");
      const previous = [...records.values()].find(
        (r) => r.requestId === p.requestId,
      );
      if (previous) {
        if (previous.requestHash !== hash)
          throw Error("requestId已用于不同请求");
        return { jobId: previous.jobId, status: previous.status, reused: true };
      }
      const record = {
        jobId: randomUUID(),
        requestId: p.requestId,
        requestHash: hash,
        capability: request.capability,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      records.set(record.jobId, record);
      save(record);
      void registry
        .executeCapability(request)
        .then((result) => {
          Object.assign(record, {
            status: result.status,
            result,
            finishedAt: new Date().toISOString(),
          });
          save(record);
        })
        .catch(() => {
          Object.assign(record, {
            status: "unknown",
            detail: "无法保存结果，先核对任务与产物，禁止自动重发",
          });
          try {
            save(record);
          } catch {}
        });
      return { jobId: record.jobId, status: "queued", reused: false };
    },
  );
}
