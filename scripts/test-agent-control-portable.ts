import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  existsSync,
  copyFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { RealSpeechV2Service } from "../src/main/realSpeech/v2/service.ts";
import { ensureDataLayout } from "../src/main/services/storage.ts";
import { sha256 } from "../src/main/realSpeech/v2/validator.ts";
const pkg = JSON.parse(readFileSync("tmp/agent-control-package.json", "utf8")),
  dir = pkg.directory;
const production = "D:/吃个糖Agent数据库-v1.3.0";
function hashes(path: string) {
  const out: Record<string, string> = {};
  for (const n of readdirSync(path)) {
    const p = join(path, n);
    if (statSync(p).isDirectory()) Object.assign(out, hashes(p));
    else out[p] = sha256(readFileSync(p));
  }
  return out;
}
const before = hashes(join(production, "real-speech-v2"));
const source = new RealSpeechV2Service(
    production,
    undefined,
    undefined,
    "readOnly",
  ),
  original = source.get("17c75363-aa5d-4fb4-9c97-eed84231d756"),
  v = source.selected(original, "GW002").v!;
const sourceAudio = source.output(original.taskId, v.versionId);
source.close();
const root = realpathSync(mkdtempSync(join(tmpdir(), "ctg-ipc-acceptance-")));
ensureDataLayout(root);
const s = new RealSpeechV2Service(root),
  t = s.importPlan({
    name: "GW002 IPC隔离验收",
    voiceRef: original.voiceRef,
    text: JSON.stringify(original.plan),
    confirmed: true,
  });
await s.runJob(
  s.createJob({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    windowIds: ["GW002"],
  }).jobId,
  async (_body, path) => {
    copyFileSync(sourceAudio, path, 1);
    return { requestId: "offline-copy-existing", usage: { characters: 0 } };
  },
);
s.close();
writeFileSync(
  join(root, "acceptance-fixture.json"),
  JSON.stringify({
    schema: "CHIGETANG_ISOLATED_IPC_ACCEPTANCE_V1",
    taskId: t.taskId,
  }),
);
const reportDir = resolve("tmp/agent-control-ipc-acceptance");
mkdirSync(reportDir, { recursive: true });
const env: NodeJS.ProcessEnv = {
  ...process.env,
  CHIGETANG_AGENT_ACCEPTANCE_ROOT: root,
};
delete env.ELECTRON_RUN_AS_NODE;
const gui = spawn(
  join(dir, "吃个糖Agent.exe"),
  ["--agent-control-acceptance"],
  { cwd: dir, env, windowsHide: false, stdio: "ignore" },
);
const wait = async (fn: () => boolean, description: string) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    if (gui.exitCode !== null)
      throw Error("包内GUI退出：" + gui.exitCode + " " + description);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("等待超时：" + description);
};
const transcript: any[] = [];
function cli(args: string[], expected = 0) {
  const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const command =
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); & " +
    quote(join(dir, "chigetang.cmd")) +
    " " +
    ["speech", ...args, "--data-root", root, "--json"].map(quote).join(" ");
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  assert.equal(r.status, expected, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.ok, expected === 0);
  transcript.push({ args, exit: r.status, result: data });
  return data.data;
}
function snapshot() {
  try {
    return JSON.parse(readFileSync(join(root, "acceptance-ui.json"), "utf8"));
  } catch {
    return null;
  }
}
async function assertUI(numbers: number[], selected: number, label: string) {
  await wait(() => {
    const w = snapshot()?.windows?.find((w: any) => w.windowId === "GW002");
    return (
      JSON.stringify(w?.versions.map((v: any) => v.number)) ===
        JSON.stringify(numbers) &&
      w?.versions.find((v: any) => v.selected)?.number === selected
    );
  }, label);
  await new Promise((r) => setTimeout(r, 350));
  if (existsSync(join(root, "acceptance-ui.png")))
    copyFileSync(
      join(root, "acceptance-ui.png"),
      join(reportDir, label + ".png"),
    );
  assert(gui.exitCode === null);
}
try {
  await wait(
    () => existsSync(join(root, "config/agent-control-runtime.json")),
    "包内控制桥启动",
  );
  const marker = JSON.parse(
    readFileSync(join(root, "config/agent-control-runtime.json"), "utf8"),
  );
  assert.equal(marker.protocol, "2");
  assert.equal(cli(["tasks"]).length, 1);
  const context = cli(["context", "--task", t.taskId, "--window", "GW002"]);
  assert.equal(context.schema, "REAL_SPEECH_AGENT_CONTEXT_V1");
  assert.equal(
    cli(["versions", "--task", t.taskId, "--window", "GW002"]).length,
    1,
  );
  await assertUI([1], 1, "01-baseline-v1");
  cli(["generate", "--task", t.taskId, "--window", "GW002"], 1);
  const c = context.window,
    text = c.synthesisText,
    nodes = ["膳食纤维", "益生菌", "西梅"].map((term) => ({
      kind: "break",
      offset: Array.from(text.slice(0, text.indexOf(term) + term.length))
        .length,
      timeMs: 120,
      purpose: "SEMANTIC_PAUSE",
    }));
  const patch = {
    schema: "REAL_SPEECH_EXECUTION_PATCH_V2",
    protocolVersion: context.protocolVersion,
    capabilityProfileId: context.capabilityProfileId,
    capabilityVersion: context.capabilityVersion,
    patchId: crypto.randomUUID(),
    taskId: t.taskId,
    basePlanId: context.planId,
    basePlanHash: context.planHash,
    targetWindowIds: ["GW002"],
    expectedVersions: [
      {
        windowId: "GW002",
        configRevision: c.configRevision,
        selectedVersionId: context.selectedVersion.versionId,
        selectedVersionHash: context.selectedVersion.fileHash,
      },
    ],
    changes: [
      {
        windowId: "GW002",
        set: {
          ssml: { enabled: true, nodes, speakSegments: [] },
          controlComplexity: "L1",
          naturalnessRisk: "MEDIUM",
          controlReason: "隔离fake验收只增加三处语义停顿，不评价音质",
        },
        executionConfidence: c.executionConfidence,
      },
    ],
    lockedWindows: [],
    diagnosis: {
      evidenceBasis: "text_only",
      listenedVersionIds: [],
      summary: "Windows绿色包IPC隔离验收",
      issues: [
        {
          windowId: "GW002",
          dimension: "semanticPause",
          observation: "单变量技术测试，不是声音诊断",
          certainty: "unverified",
        },
      ],
    },
    validationFocus: [
      { windowId: "GW002", focus: "主进程执行与UI/CLI版本一致" },
    ],
    changeIsolationPolicy: "ONE_PRIMARY_VARIABLE_AT_A_TIME",
  };
  const file = join(root, "candidate.json");
  writeFileSync(file, JSON.stringify(patch));
  const preview = cli(["patch-preview", "--task", t.taskId, "--file", file]);
  assert.deepEqual(preview.primaryVariables, ["break"]);
  cli(
    [
      "patch-apply",
      "--task",
      t.taskId,
      "--file",
      file,
      "--preview-hash",
      preview.previewHash,
    ],
    1,
  );
  cli([
    "patch-apply",
    "--task",
    t.taskId,
    "--file",
    file,
    "--preview-hash",
    preview.previewHash,
    "--confirm",
  ]);
  await assertUI([2, 1], 1, "02-patch-v2");
  const versions = cli(["versions", "--task", t.taskId, "--window", "GW002"]);
  assert.deepEqual(
    versions.map((v: any) => v.versionNumber),
    [2, 1],
  );
  cli([
    "select",
    "--task",
    t.taskId,
    "--window",
    "GW002",
    "--version",
    versions[0].versionId,
  ]);
  await assertUI([2, 1], 2, "03-select-v2");
  cli([
    "select",
    "--task",
    t.taskId,
    "--window",
    "GW002",
    "--version",
    versions[1].versionId,
  ]);
  await assertUI([2, 1], 1, "04-select-v1");
  cli([
    "rollback",
    "--task",
    t.taskId,
    "--window",
    "GW002",
    "--version",
    versions[1].versionId,
  ]);
  await assertUI([2, 1], 1, "05-rollback-v1");
  cli(["generate", "--task", t.taskId, "--window", "GW002", "--confirm"]);
  await assertUI([3, 2, 1], 1, "06-generate-v3");
  const final = cli(["show", "--task", t.taskId]);
  assert.equal(
    final.windows.find((w: any) => w.windowId === "GW002").configRevision,
    context.window.configRevision + 2,
  );
  assert.equal(sha256(readFileSync(versions[1].path)), versions[1].fileHash);
  assert(existsSync(versions[0].path));
  assert.deepEqual(hashes(join(production, "real-speech-v2")), before);
  const report = {
    schema: "CHIGETANG_PACKAGED_IPC_ACCEPTANCE_V1",
    package: dir,
    guiPid: marker.pid,
    pipeHostPid: marker.pipeHostPid,
    guiKeptRunning: true,
    transport: "Windows Named Pipe",
    singleWriter: true,
    root,
    isolatedTaskId: t.taskId,
    cloudRequests: 0,
    cost: 0,
    originalFilesUnchanged: true,
    sourceFileCount: Object.keys(before).length,
    versions: [3, 2, 1],
    selected: 1,
    uiAndCliConsistent: true,
    audioQualityVerified: false,
    checked: [
      "tasks",
      "context",
      "versions",
      "patch-preview",
      "patch-apply→V2",
      "select V2",
      "select V1",
      "rollback V1",
      "generate→V3",
      "missing confirm rejected",
    ],
    screenshots: reportDir,
  };
  writeFileSync(
    join(reportDir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    join(reportDir, "transcript.json"),
    JSON.stringify(transcript, null, 2),
  );
} finally {
  writeFileSync(join(root, "acceptance-stop"), "stop");
  for (let i = 0; i < 100 && gui.exitCode === null; i++)
    await new Promise((r) => setTimeout(r, 100));
  if (gui.exitCode === null)
    throw Error("验收GUI未正常退出，请人工处理；未强杀");
}
assert.equal(
  existsSync(join(root, "config/agent-control-runtime.json")),
  false,
  "正常退出清理控制桥",
);
assert.equal(
  existsSync(join(root, "config/agent-control-writer.lock")),
  false,
  "正常退出释放唯一writer",
);
const offline = cli(["versions", "--task", t.taskId, "--window", "GW002"]);
assert.deepEqual(
  offline.map((v: any) => v.versionNumber),
  [3, 2, 1],
);
cli([
  "select",
  "--task",
  t.taskId,
  "--window",
  "GW002",
  "--version",
  offline[2].versionId,
]);
assert.equal(
  existsSync(join(root, "config/agent-control-writer.lock")),
  false,
  "独立CLI退出释放writer",
);
const report = JSON.parse(readFileSync(join(reportDir, "report.json"), "utf8"));
Object.assign(report, {
  guiExitedNormally: true,
  writerLeaseReleased: true,
  offlineModeChecked: true,
});
writeFileSync(join(reportDir, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(
  join(reportDir, "transcript.json"),
  JSON.stringify(transcript, null, 2),
);
console.log(JSON.stringify(report, null, 2));
