import { brand } from "../shared/brand.ts";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { requestBridge } from "../main/realSpeech/v2/controlPipe.ts";
import { WINDOWS_DATA_ROOT } from "../main/services/storage.ts";
import { SecretFilter, resultOutput } from "./output.ts";
const argv = process.argv.slice(2),
  filter = new SecretFilter();
const rootIndex = argv.indexOf("--data-root");
const root = resolve(
  rootIndex >= 0
    ? argv[rootIndex + 1]
    : process.env.AIVIDEO_TEST_ROOT || WINDOWS_DATA_ROOT,
);
if (rootIndex >= 0) argv.splice(rootIndex, 2);
const project = process.env.CHIGETANG_PROJECT_ROOT || process.cwd();
async function call(args: string[]) {
  const response = await requestBridge(root, args, project);
  if (!response)
    throw Error(
      "后台执行进程未启动；请运行 agent-start.cmd 或启动 GUI。不会另开数据库或自动重发。",
    );
  if (!response.ok) throw Error(response.error?.message || "后台调用失败");
  return response.data;
}
async function rpc(message: any) {
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string")
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: -32600, message: "Invalid Request" },
    };
  if (message.id === undefined) return;
  try {
    let result: any;
    switch (message.method) {
      case "initialize":
        result = {
          protocolVersion: ["2025-03-26", "2025-06-18", "2025-11-25"].includes(
            message.params?.protocolVersion,
          )
            ? message.params.protocolVersion
            : "2025-11-25",
          serverInfo: { name: "chigetang-agent", version: brand.version },
          capabilities: { tools: { listChanged: false } },
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list": {
        const entries = await call(["capability", "list"]);
        result = {
          tools: entries
            .filter((e: any) =>
              [
                "capability.search",
                "capability.describe",
                "jobs.submit",
                "jobs.wait",
                "jobs.status",
              ].includes(e.id),
            )
            .map((e: any) => ({
              name: e.id.replaceAll(".", "_"),
              description:
                e.description +
                (e.effect === "paid"
                  ? "（可能产生云端费用，须 confirm:true）"
                  : ""),
              inputSchema: {
                type: "object",
                properties: {
                  params: e.inputSchema,
                  confirm: { type: "boolean" },
                  responseMode: {
                    enum: ["compact", "normal", "debug"],
                    default: "compact",
                  },
                },
                additionalProperties: false,
              },
              outputSchema: e.outputSchema,
              annotations: {
                readOnlyHint: e.effect === "read",
                destructiveHint: e.effect === "destructive",
                idempotentHint: false,
                openWorldHint: e.effect === "paid",
              },
            })),
        };
        break;
      }
      case "tools/call": {
        const entries = await call(["capability", "list"]);
        const entry = entries.find(
          (e: any) => e.id.replaceAll(".", "_") === message.params?.name,
        );
        if (!entry) throw Error("Unknown tool");
        const args = message.params.arguments ?? {};
        if (
          Object.keys(args).some(
            (k) => !["params", "confirm", "responseMode"].includes(k),
          )
        )
          throw Error("Unknown tool argument");
        const output = await call([
          "capability",
          "execute",
          JSON.stringify({
            capability: entry.id,
            params: args.params ?? {},
            confirm: args.confirm ?? false,
            responseMode: args.responseMode ?? "compact",
          }),
        ]);
        result = {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
          isError: output.status === "failed",
        };
        break;
      }
      default:
        return {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        };
    }
    return { jsonrpc: "2.0", id: message.id, result };
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32603,
        message: filter.text(e instanceof Error ? e.message : "执行失败"),
      },
    };
  }
}
if (argv[0] === "mcp") {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Serial requests preserve execution order; no stdout logs or notifications.
  for await (const line of lines) {
    try {
      if (Buffer.byteLength(line) > 2_000_000) throw Error();
      const response = await rpc(JSON.parse(line));
      if (response) process.stdout.write(JSON.stringify(response) + "\n");
    } catch {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n",
      );
    }
  }
} else {
  try {
    let output: any;
    if (argv.join(" ") === "capability list")
      output = await call(["capability", "list"]);
    else if (
      argv.length === 3 &&
      argv[0] === "capability" &&
      argv[1] === "execute"
    ) {
      const request = JSON.parse(
        readFileSync(resolve(argv[2]), "utf8").replace(/^\uFEFF/, ""),
      );
      output = await call(["capability", "execute", JSON.stringify(request)]);
      if (output.status === "failed") process.exitCode = 1;
    } else
      throw Error(
        "用法：capability list | capability execute <request.json> | mcp [--data-root <目录>]",
      );
    process.stdout.write(resultOutput(argv[0], output, filter));
  } catch (e) {
    process.stdout.write(
      resultOutput(
        argv[0],
        e instanceof Error ? e.message : "执行失败",
        filter,
        true,
      ),
    );
    process.exitCode = 1;
  }
}
