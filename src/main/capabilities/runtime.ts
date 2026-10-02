import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityResult, CapabilityRequest } from "./registry.ts";
import { CapabilityRegistry, objectSchema, stringSchema } from "./registry.ts";
export function registerDiscovery(registry: CapabilityRegistry, root?: string) {
  registry.register(
    {
      id: "capability.search",
      description: "按关键词发现少量能力，不返回完整schema",
      service: "CapabilityRegistry",
      effect: "read",
      inputSchema: objectSchema(
        {
          query: { type: "string", maxLength: 200 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        ["query"],
      ),
      outputSchema: {},
    },
    (p) => {
      const terms = String(p.query).toLowerCase().split(/\s+/).filter(Boolean);
      return registry
        .list()
        .filter((d) =>
          terms.every((t) =>
            (d.id + " " + d.description + " " + d.service)
              .toLowerCase()
              .includes(t),
          ),
        )
        .slice(0, p.limit || 5)
        .map(({ id, description, effect }) => ({ id, description, effect }));
    },
  );
  registry.register(
    {
      id: "capability.describe",
      description: "读取单个能力的完整输入输出schema与副作用",
      service: "CapabilityRegistry",
      effect: "read",
      inputSchema: objectSchema({ id: stringSchema }, ["id"]),
      outputSchema: {},
    },
    (p) => {
      const d = registry.list().find((d) => d.id === p.id);
      if (!d) throw Error("未知能力");
      return d;
    },
  );
  if (root)
    registry.register(
      {
        id: "logs.read",
        description: "按executionId读取本地控制结果日志，默认50行，最多200行",
        service: "CapabilityRegistry",
        effect: "read",
        inputSchema: objectSchema(
          {
            executionId: { type: "string", pattern: "^[a-f0-9-]{36}$" },
            lines: { type: "integer", minimum: 1, maximum: 200 },
          },
          ["executionId"],
        ),
        outputSchema: {},
      },
      (p) => ({
        lines: readFileSync(
          join(root, "config", "capability-results", p.executionId + ".json"),
          "utf8",
        )
          .split("\n")
          .slice(0, p.lines || 50),
      }),
    );
}
// Applies only after execution. Input and workflow reference values remain untouched.
export function controlResponse(
  root: string,
  request: CapabilityRequest,
  result: CapabilityResult,
) {
  const mode = request.responseMode || "compact";
  const sanitize = (v: any): any =>
    typeof v === "string" && /^data:[^,]*;base64,/i.test(v)
      ? "[media omitted; use local asset path]"
      : Array.isArray(v)
        ? v.map(sanitize)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v).map(([k, x]) => [k, sanitize(x)]),
            )
          : v;
  const full = sanitize(result);
  if (mode === "debug") return full;
  const directory = join(root, "config", "capability-results");
  mkdirSync(directory, { recursive: true });
  const resultPath = join(directory, result.executionId + ".json");
  writeFileSync(resultPath, JSON.stringify(full, null, 2), { flag: "wx" });
  if (mode === "normal") return { ...full, logs: undefined, resultPath };
  const data: any = result.result;
  const small = [
    "capability.search",
    "capability.describe",
    "jobs.submit",
    "runtime.status",
    "logs.read",
  ].includes(request.capability)
    ? sanitize(data)
    : undefined;
  const task = data?.task || data?.result?.result || data;
  return {
    schema: result.schema,
    executionId: result.executionId,
    capability: result.capability,
    status: result.status,
    error: result.error,
    taskId: task?.taskId || (task?.snapshot ? task.id : undefined),
    assetId: request.capability.startsWith("assets.") ? data?.id : undefined,
    sessionId: data?.sessionId,
    jobId: data?.jobId,
    jobStatus: data?.jobId ? data.status : undefined,
    timedOut: data?.timedOut,
    taskStatus: task?.status,
    summary:
      result.status === "failed" ? result.error?.message : "本地执行完成",
    outputPath:
      task?.outputPath || task?.output || task?.path || task?.final?.path,
    resultPath,
    logPath: resultPath,
    ...(small !== undefined ? { result: small } : {}),
  };
}
