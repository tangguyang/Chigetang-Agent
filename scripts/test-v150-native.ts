import { Application } from "../src/main/services/application.ts";
import { productionContext } from "../src/main/services/productionContext.ts";
import { defaults } from "../src/shared/catalog.ts";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = mkdtempSync(join(tmpdir(), "ctg-ipc-acceptance-v150-"));
writeFileSync(
  join(root, "acceptance-fixture.json"),
  JSON.stringify({
    schema: "CHIGETANG_ISOLATED_IPC_ACCEPTANCE_V1",
    taskId: "v150-production",
  }),
);
const fixture = new Application(
  root,
  {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  },
  async () => ({ width: 320, height: 240, duration: 1 }),
  () => {},
  () => {},
  async () => {
    throw Error("network forbidden");
  },
);
fixture.credentials.save({
  providerId: "alibaba",
  name: "offline fixture",
  workspaceId: "test",
  key: "offline-dummy-only",
  enabled: true,
  isDefault: true,
});
const outputs = join(root, "outputs");
mkdirSync(outputs, { recursive: true });
const video = join(outputs, "fixture-video.mp4"),
  image = join(root, "fixture-person.png");
execFileSync(
  resolve("resources/ffmpeg.exe"),
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x240:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ],
  { windowsHide: true },
);
execFileSync(
  resolve("resources/ffmpeg.exe"),
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x320",
    "-frames:v",
    "1",
    image,
  ],
  { windowsHide: true },
);
const model = fixture.models().find((m) => m.id === "wan-safe")!;
const draft = {
  name: "GUI隔离验收视频",
  modelId: model.id,
  accountId: "auto",
  projectId: null,
  prompt: "完整生产Prompt：隔离验收，不调用真实网络。",
  params: { ...defaults(model), duration: 5 },
  assets: [],
  outputDir: outputs,
};
const t = await productionContext.run({ driver: "GUI" }, () =>
  fixture.tasks.create(draft, "native-gui-fixture", undefined, true),
);
t.status = "Completed";
t.outputPath = video;
fixture.tasks.save(t);
const generated = (await fixture.assets.import(video, false)).asset;
generated.metadata = { source: "generated", taskId: t.id };
fixture.assets.save(generated);
await fixture.assets.import(image, false);
fixture.close();
const portable = process.argv[2],
  exe = portable
    ? join(resolve(portable), "吃个糖Agent.exe")
    : resolve("node_modules/electron/dist/electron.exe");
const env = {
  ...process.env,
  AIVIDEO_TEST_ROOT: root,
  CHIGETANG_AGENT_ACCEPTANCE_ROOT: root,
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  exe,
  [
    ...(portable ? [] : ["."]),
    "--agent-control-acceptance",
    "--agent-control-manual-observation",
  ],
  {
    env,
    cwd: portable ? resolve(portable) : process.cwd(),
    windowsHide: false,
    detached: true,
    stdio: "ignore",
  },
);
let logs = "Native acceptance startup failed";
child.unref();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (
  let i = 0;
  i < 100 && !existsSync(join(root, "config/agent-control-runtime.json"));
  i++
) {
  if (child.exitCode !== null) throw Error(logs);
  await delay(100);
}
assert(existsSync(join(root, "config/agent-control-runtime.json")), logs);
const cli = (args: string[]) => {
  const command = portable ? exe : process.execPath,
    entry = portable
      ? join(resolve(portable), "resources/app/dist/cli/launcher.cjs")
      : "scripts/chigetang.mjs";
  return JSON.parse(
    execFileSync(command, [entry, ...args, "--data-root", root], {
      env: { ...env, ...(portable ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      windowsHide: true,
      encoding: "utf8",
    }),
  );
};
const execute = (capability: string, params: any = {}, confirm = false) => {
  const file = join(root, "request.json");
  writeFileSync(
    file,
    JSON.stringify({ capability, params, confirm, responseMode: "debug" }),
  );
  const r = cli(["capability", "execute", file]).data;
  assert.equal(r.status, "succeeded", JSON.stringify(r.error));
  return r.result;
};
const created = execute("speech.legacy.create", {
  name: "Codex正式控制链任务",
  originalText: "这是隔离环境中的真实服务记录，不发生收费生成。",
});
const id = "speech:" + created.taskId;
const direct = execute("production.get", { id });
assert.equal(direct.driver, "Codex");
assert.equal(execute("production.get", { id: "task:" + t.id }).driver, "GUI");
const core = execute("core-assets.register", {
  alias: "验收人物",
  type: "person",
  path: image,
  description: "隔离fixture，非用户核心素材",
  designated: true,
});
assert.equal(
  execute("core-assets.resolve", { alias: "验收人物" }).sha256,
  core.sha256,
);
const workflow = execute("copy.create", {
  requestId: "native-copy",
  name: "Codex复制批次",
  count: 3,
  sourceTaskId: t.id,
  bindings: [{ alias: "验收人物", role: "reference_image" }],
});
assert.equal(workflow.drafts.length, 3);
assert.equal(workflow.driver, "Codex");
const checked = execute("copy.preflight", { id: workflow.id });
assert.deepEqual(checked.issues, []);
execute("copy.confirm", { id: workflow.id, revision: checked.revision });
const messages = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "v150-nonpaid-check", version: "1" },
    },
  },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "jobs_submit",
      arguments: {
        params: {
          requestId: "mcp-note",
          request: {
            capability: "production.update",
            params: { id, note: "MCP写入的外显备注", favorite: true },
          },
        },
        responseMode: "debug",
      },
    },
  },
];
const entry = portable
  ? join(resolve(portable), "resources/app/dist/cli/launcher.cjs")
  : "scripts/chigetang.mjs";
const response = spawnSync(
  portable ? exe : process.execPath,
  [entry, "mcp", "--data-root", root],
  {
    env: { ...env, ...(portable ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
    windowsHide: true,
    input: messages.map((x) => JSON.stringify(x)).join("\n") + "\n",
    encoding: "utf8",
    timeout: 30000,
  },
);
assert.equal(response.status, 0, response.stderr);
const mcp = response.stdout
  .trim()
  .split(/\r?\n/)
  .map((x) => JSON.parse(x));
assert.equal(mcp[0].result.serverInfo.version, "1.5.0");
assert.equal(mcp[1].result.tools.length, 5);
assert(!mcp[2].result.isError);
const job = mcp[2].result.structuredContent.result;
assert(job.jobId);
const done = execute("jobs.wait", { jobId: job.jobId, timeout: 10000 });
assert.equal(done.status, "succeeded");
assert.equal(execute("production.get", { id }).note, "MCP写入的外显备注");
assert.equal(execute("uploads.list", {}).total, 1);
const status = execute("runtime.status");
assert.equal(status.dataRoot, root);
mkdirSync("tmp/v150", { recursive: true });
writeFileSync(
  "tmp/v150/native-session.json",
  JSON.stringify(
    {
      root,
      pid: child.pid,
      exe,
      portable: portable || null,
      guiTaskId: t.id,
      codexTaskId: created.taskId,
      workflowId: workflow.id,
      mcp: true,
      paidRequests: 0,
      status,
    },
    null,
    2,
  ),
);
writeFileSync("tmp/v150/native-mcp.json", JSON.stringify(mcp, null, 2));
console.log(
  JSON.stringify({
    root,
    pid: child.pid,
    guiTask: t.id,
    codexTask: created.taskId,
    workflow: workflow.id,
    MCP: "PASS",
    paidRequests: 0,
  }),
);
