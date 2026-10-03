import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = mkdtempSync(join(tmpdir(), "ctg-ipc-acceptance-v140-"));
writeFileSync(
  join(root, "acceptance-fixture.json"),
  JSON.stringify({
    schema: "CHIGETANG_ISOLATED_IPC_ACCEPTANCE_V1",
    taskId: "capability-runtime-test",
  }),
);
const env = {
  ...process.env,
  AIVIDEO_TEST_ROOT: root,
  CHIGETANG_AGENT_ACCEPTANCE_ROOT: root,
};
delete env.ELECTRON_RUN_AS_NODE;
const portable = process.argv[2];
const executable = portable
  ? join(resolve(portable), "吃个糖Agent.exe")
  : resolve("node_modules/electron/dist/electron.exe");
const runtime = spawn(
  executable,
  [
    ...(portable ? [] : ["."]),
    "--agent-headless",
    "--agent-control-acceptance",
  ],
  {
    env,
    cwd: portable ? resolve(portable) : process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
runtime.stderr.on("data", (s) => (logs += s));
runtime.stdout.on("data", (s) => (logs += s));
const delay = (ms) => new Promise((y) => setTimeout(y, ms));
const cli = (args) => {
  const command = portable ? executable : process.execPath;
  const entry = portable
    ? join(resolve(portable), "resources/app/dist/cli/launcher.cjs")
    : "scripts/chigetang.mjs";
  try {
    return JSON.parse(
      execFileSync(command, [entry, ...args, "--data-root", root], {
        env: portable ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env,
        encoding: "utf8",
        windowsHide: true,
      }),
    );
  } catch (e) {
    if (e.stdout) return JSON.parse(String(e.stdout));
    throw e;
  }
};
function execute(capability, params = {}, confirm = false) {
  const path = join(root, "request.json");
  writeFileSync(
    path,
    JSON.stringify({ capability, params, confirm, responseMode: "debug" }),
  );
  return cli(["capability", "execute", path]).data;
}
try {
  for (
    let i = 0;
    i < 150 && !existsSync(join(root, "config", "agent-control-runtime.json"));
    i++
  ) {
    if (runtime.exitCode !== null) throw Error(logs);
    await delay(100);
  }
  assert.ok(
    existsSync(join(root, "config", "agent-control-runtime.json")),
    logs,
  );
  const status = execute("runtime.status");
  assert.equal(status.status, "succeeded");
  assert.equal(status.result.headless, true);
  assert.equal(status.result.windowCount, 0);
  const capabilities = cli(["capability", "list"]).data;
  assert.ok(capabilities.length > 90);
  assert.equal(
    execute("tasks.create", { draft: {}, requestId: "deny-unconfirmed" })
      .status,
    "failed",
  );
  assert.equal(
    execute("tools.audio", { path: "not-a-file", format: "exe" }).status,
    "failed",
  );
  assert.equal(execute("accounts.reveal", { id: "missing" }).status, "failed");
  const project = execute("projects.create", { name: "隔离验收项目" });
  assert.equal(project.status, "succeeded");
  const mediaDir = join(root, "fixtures");
  mkdirSync(mediaDir);
  const video = join(mediaDir, "source.mp4");
  execFileSync(
    resolve("resources/ffmpeg.exe"),
    [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=128x128:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-shortest",
      video,
    ],
    { windowsHide: true },
  );
  const original = readFileSync(video);
  const imported = execute("assets.import", { paths: [video] });
  assert.equal(imported.status, "succeeded");
  const audio = execute("tools.audio", {
    path: video,
    format: "wav",
    directory: mediaDir,
  });
  assert.equal(audio.status, "succeeded");
  assert.ok(existsSync(audio.result.files[0]));
  const frames = execute("video.frames", {
    path: video,
    directory: mediaDir,
    count: 2,
    interval: 0.5,
  });
  assert.equal(frames.status, "succeeded");
  const image = execute("image.process", {
    path: join(frames.result.folder, "frame_0001.png"),
    output: join(mediaDir, "resized.jpg"),
    width: 64,
    format: "jpg",
  });
  assert.equal(image.status, "succeeded");
  assert.equal(image.result.width, 64);
  const converted = execute("audio.convert", {
    path: audio.result.files[0],
    directory: mediaDir,
    format: "mp3",
  });
  assert.equal(converted.status, "succeeded");
  assert.ok(existsSync(converted.result.output));
  const trim = execute("media.trim", {
    path: video,
    directory: mediaDir,
    start: 0,
    duration: 0.5,
    kind: "video",
    format: "mp4",
  });
  assert.equal(trim.status, "succeeded");
  const concat = execute("video.concat", {
    paths: [trim.result.output, trim.result.output],
    directory: mediaDir,
  });
  assert.equal(concat.status, "succeeded");
  const wf = execute("workflow.run", {
    steps: [
      { id: "import", capability: "assets.import", params: { paths: [video] } },
      {
        id: "lookup",
        capability: "assets.get",
        params: { id: { $ref: "import.result.0.asset.id" } },
      },
    ],
  });
  assert.equal(wf.status, "succeeded");
  const request = {
    capability: "text.process",
    params: { text: "  async  ", operation: "trim" },
  };
  const submitted = execute("jobs.submit", {
    requestId: "runtime-async-001",
    request,
  });
  assert.equal(submitted.status, "succeeded");
  const repeated = execute("jobs.submit", {
    requestId: "runtime-async-001",
    request,
  });
  assert.equal(repeated.result.jobId, submitted.result.jobId);
  assert.equal(repeated.result.reused, true);
  const job = execute("jobs.status", { jobId: submitted.result.jobId });
  assert.equal(job.result.status, "succeeded");
  assert.equal(job.result.result.result.text, "async");
  const exported = execute("files.export", {
    assetId: imported.result[0].asset.id,
    output: join(mediaDir, "export.mp4"),
  });
  assert.equal(exported.status, "succeeded");
  assert.deepEqual(readFileSync(exported.result.path), original);
  const subtitles = execute("text.subtitles", {
    segments: [{ startMs: 0, endMs: 500, text: "隔离验收" }],
    output: join(mediaDir, "captions.srt"),
  });
  assert.equal(subtitles.status, "succeeded");
  assert.ok(
    readFileSync(subtitles.result.path, "utf8").includes(
      "00:00:00,000 --> 00:00:00,500",
    ),
  );
  assert.deepEqual(readFileSync(video), original);
  // Real stdio MCP handshake and tool call, through the same live process.
  const mcpEnv = {
    ...env,
    CHIGETANG_PROJECT_ROOT: portable
      ? join(resolve(portable), "resources/app")
      : process.cwd(),
    ...(portable ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };
  const mcp = execFileSync(
    portable ? executable : process.execPath,
    [
      portable
        ? join(resolve(portable), "resources/app/dist/cli/capability.mjs")
        : "dist/cli/capability.mjs",
      "mcp",
      "--data-root",
      root,
    ],
    {
      env: mcpEnv,
      encoding: "utf8",
      windowsHide: true,
      input:
        [
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-11-25" },
          },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "capability_search",
              arguments: { params: { query: "runtime", limit: 2 } },
            },
          },
        ]
          .map((x) => JSON.stringify(x))
          .join("\n") + "\n",
    },
  )
    .trim()
    .split(/\r?\n/)
    .map(JSON.parse);
  assert.equal(mcp.length, 3);
  assert.equal(mcp[1].result.tools.length, 5);
  assert.equal(mcp[2].result.structuredContent.result.length, 2);
  const compactFile = join(root, "compact-request.json");
  writeFileSync(
    compactFile,
    JSON.stringify({
      capability: "assets.get",
      params: { id: imported.result[0].asset.id },
    }),
  );
  const compact = cli(["capability", "execute", compactFile]).data;
  assert.equal(compact.result, undefined);
  assert.ok(existsSync(compact.resultPath));
  assert.equal(
    JSON.parse(readFileSync(compact.resultPath, "utf8")).result.id,
    imported.result[0].asset.id,
  );
  const awaited = execute("jobs.wait", {
    jobId: submitted.result.jobId,
    timeout: 30000,
  });
  assert.equal(awaited.result.status, "succeeded");
  const thumb = execute("assets.thumbnail.ensure", {
    id: imported.result[0].asset.id,
  });
  assert.ok(existsSync(thumb.result.thumbnailPath));
  const fullTools = capabilities.map((e) => ({
    name: e.id.replaceAll(".", "_"),
    description: e.description,
    inputSchema: {
      type: "object",
      properties: { params: e.inputSchema, confirm: { type: "boolean" } },
      additionalProperties: false,
    },
    outputSchema: e.outputSchema,
  }));
  const metrics = {
    capabilities: capabilities.length,
    mcpTools: mcp[1].result.tools.length,
    fullToolsBytes: Buffer.byteLength(JSON.stringify(fullTools)),
    leanToolsBytes: Buffer.byteLength(JSON.stringify(mcp[1].result.tools)),
    normalAssetBytes: Buffer.byteLength(
      JSON.stringify(imported.result[0].asset),
    ),
    compactResponseBytes: Buffer.byteLength(JSON.stringify(compact)),
    normalExecutionBytes: Buffer.byteLength(JSON.stringify(JSON.parse(readFileSync(compact.resultPath,'utf8')))),
    compactIsDefault: true,
  };
  mkdirSync("tmp", { recursive: true });
  writeFileSync(
    "tmp/v142-token-metrics.json",
    JSON.stringify(metrics, null, 2),
  );
  const report = {
    schema: "V142_RUNTIME_ACCEPTANCE",
    root,
    portable: portable || null,
    capabilities: capabilities.length,
    headless: true,
    windowCount: 0,
    media: true,
    image: true,
    export: true,
    subtitles: true,
    workflow: true,
    mcp: true,
    productionDatabaseOpened: false,
    paidRequests: 0,
  };
  writeFileSync(
    portable ? "tmp/v142-portable-report.json" : "tmp/v142-runtime-report.json",
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    "tmp/v142-capabilities.json",
    JSON.stringify(capabilities, null, 2),
  );
  console.log(JSON.stringify(report));
  assert.equal(execute("runtime.stop", {}, true).status, "succeeded");
  await delay(700);
} finally {
  runtime.kill();
}
