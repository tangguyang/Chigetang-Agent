/** Developer acceptance only. Never launches Electron or uses a cloud adapter. */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdtempSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import {
  RealSpeechV2Service,
  type Adapter,
} from "../src/main/realSpeech/v2/service.ts";
import { runCli } from "../src/cli/run.ts";
import { sha256 } from "../src/main/realSpeech/v2/validator.ts";
const projectRoot = resolve("."),
  dataRoot = process.argv[2] || "D:/吃个糖Agent数据库-v1.3.0",
  taskId = process.argv[3] || "17c75363-aa5d-4fb4-9c97-eed84231d756";
const out = join(projectRoot, "tmp", "agent-control-gw002");
mkdirSync(out, { recursive: true });
function hashes(dir: string) {
  const result: Record<string, string> = {};
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) Object.assign(result, hashes(p));
    else result[p] = sha256(readFileSync(p));
  }
  return result;
}
const baseline = hashes(join(dataRoot, "real-speech-v2"));
const transcript: any[] = [];
async function cli(root: string, args: string[], adapter?: Adapter) {
  let stdout = "",
    stderr = "";
  const code = await runCli(
    ["speech", ...args, "--data-root", root, "--json"],
    {
      projectRoot,
      adapter,
      stdout: (s) => (stdout += s),
      stderr: (s) => (stderr += s),
    },
  );
  const result = JSON.parse(stdout);
  transcript.push({
    scope: root === dataRoot ? "production-read-only" : "isolated-offline",
    args,
    code,
    result,
  });
  assert.equal(code, 0, stderr);
  return result.data;
}
const context = await cli(dataRoot, [
  "context",
  "--task",
  taskId,
  "--window",
  "GW002",
]);
const reader = new RealSpeechV2Service(
    dataRoot,
    undefined,
    undefined,
    "readOnly",
  ),
  realTask = reader.get(taskId);
reader.close();
const text = context.window.synthesisText,
  terms = ["膳食纤维", "益生菌", "西梅"];
const nodes = terms.map((term) => {
  const offset = text.indexOf(term);
  assert(offset >= 0);
  return {
    kind: "break",
    offset: Array.from(text.slice(0, offset + term.length)).length,
    timeMs: 120,
    purpose: "SEMANTIC_PAUSE",
  };
});
function patch(t: any) {
  const w = t.windows.find((w: any) => w.windowId === "GW002"),
    v = w.versions.find((v: any) => v.versionId === w.selectedVersionId),
    c = t.plan.windows.find((w: any) => w.windowId === "GW002");
  return {
    schema: "REAL_SPEECH_EXECUTION_PATCH_V2",
    protocolVersion: t.plan.protocolVersion,
    capabilityProfileId: t.plan.capabilityProfileId,
    capabilityVersion: t.plan.capabilityVersion,
    patchId: crypto.randomUUID(),
    taskId: t.taskId,
    basePlanId: t.plan.planId,
    basePlanHash: t.planHash,
    targetWindowIds: ["GW002"],
    expectedVersions: [
      {
        windowId: "GW002",
        configRevision: w.configRevision,
        selectedVersionId: v?.versionId || null,
        selectedVersionHash: v?.fileHash || null,
      },
    ],
    changes: [
      {
        windowId: "GW002",
        set: {
          ssml: { enabled: true, nodes, speakSegments: [] },
          controlComplexity: "L1",
          naturalnessRisk: "MEDIUM",
          experimental: false,
          controlReason:
            "用户要求四种成分分开说；仅试三处短语义停顿，播音感改善未验证",
        },
        executionConfidence: [
          ...c.executionConfidence,
          {
            intentId: "I-W2-STACK",
            intent: "四种成分之间的显式语义停顿",
            capability: "break",
            level: "E0",
            implementation: "三处120ms SSML break；只证明请求结构，不保证听感",
            targetPaths: nodes.map((_, i) => `/windows/1/ssml/nodes/${i}`),
            approximation: null,
          },
        ],
      },
    ],
    lockedWindows: t.windows
      .filter((w: any) => w.locked)
      .map((w: any) => w.windowId),
    diagnosis: {
      evidenceBasis: "text_only",
      listenedVersionIds: [],
      summary: "用户反馈四种成分需独立说、当前像播音；本次未试听、不作音质诊断",
      issues: [
        {
          windowId: "GW002",
          dimension: "semanticPause",
          observation: "用户希望成分分开说；只试停顿一个变量",
          certainty: "unverified",
        },
      ],
    },
    validationFocus: [
      {
        windowId: "GW002",
        focus: "获批真实生成后人工判断短停顿是否自然、播音感是否仍存在",
      },
    ],
    changeIsolationPolicy: "ONE_PRIMARY_VARIABLE_AT_A_TIME",
  };
}
const realPatch = patch(realTask),
  patchFile = join(out, "GW002-break-candidate.json");
writeFileSync(patchFile, JSON.stringify(realPatch, null, 2));
const preview = await cli(dataRoot, [
  "patch-preview",
  "--task",
  taskId,
  "--file",
  patchFile,
]);
assert.deepEqual(preview.primaryVariables, ["break"]);
assert.deepEqual(preview.generateIds, ["GW002"]);
assert.deepEqual(hashes(join(dataRoot, "real-speech-v2")), baseline);
const root = mkdtempSync(join(tmpdir(), "ctg-gw002-offline-")),
  s = new RealSpeechV2Service(root);
let t = s.importPlan({
  name: "真实GW002隔离验收",
  voiceRef: realTask.voiceRef,
  text: JSON.stringify(realTask.plan),
  confirmed: true,
});
s.close();
const source = context.selectedVersion.path,
  sourceHash = sha256(readFileSync(source));
const copyBaseline: Adapter = async (_body, path) => {
  copyFileSync(source, path, 1);
  return { requestId: "offline-copy-existing-audio", usage: { characters: 0 } };
};
const fake: Adapter = async (_body, path) => {
  const b = Buffer.alloc(44 + 4800);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(96000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(4800, 40);
  writeFileSync(path, b, { flag: "wx" });
  return {
    requestId: "offline-silent-wav-not-synthesis",
    usage: { characters: 0 },
  };
};
t = (
  await cli(
    root,
    ["generate", "--task", t.taskId, "--window", "GW002", "--confirm"],
    copyBaseline,
  )
).task;
const v1 = t.windows[1].versions[0],
  oldHash = sha256(readFileSync(v1.path)),
  other = t.windows.filter((w: any) => w.windowId !== "GW002");
const file = join(out, "isolated-patch.json");
writeFileSync(file, JSON.stringify(patch(t), null, 2));
const p = await cli(root, [
  "patch-preview",
  "--task",
  t.taskId,
  "--file",
  file,
]);
t = (
  await cli(
    root,
    [
      "patch-apply",
      "--task",
      t.taskId,
      "--file",
      file,
      "--preview-hash",
      p.previewHash,
      "--confirm",
    ],
    fake,
  )
).task;
assert.deepEqual(
  t.windows.filter((w: any) => w.windowId !== "GW002"),
  other,
);
const versions = await cli(root, [
  "versions",
  "--task",
  t.taskId,
  "--window",
  "GW002",
]);
assert.deepEqual(
  versions.map((v: any) => v.versionNumber),
  [2, 1],
);
await cli(root, [
  "select",
  "--task",
  t.taskId,
  "--window",
  "GW002",
  "--version",
  versions[0].versionId,
]);
t = await cli(root, [
  "rollback",
  "--task",
  t.taskId,
  "--window",
  "GW002",
  "--version",
  v1.versionId,
]);
assert.equal(t.windows[1].selectedVersionId, v1.versionId);
assert.equal(sha256(readFileSync(v1.path)), oldHash);
assert.equal(sha256(readFileSync(source)), sourceHash);
assert.deepEqual(hashes(join(dataRoot, "real-speech-v2")), baseline);
const report = {
  schema: "AGENT_CONTROL_GW002_OFFLINE_ACCEPTANCE_V1",
  cloudRequests: 0,
  cost: 0,
  productionTaskId: taskId,
  productionUnchanged: true,
  realPreviewHash: preview.previewHash,
  primaryVariables: preview.primaryVariables,
  generationWindows: preview.generateIds,
  patchFile,
  isolatedRoot: root,
  versions: versions.map((v: any) => ({
    version: v.versionNumber,
    path: v.path,
    fileHash: v.fileHash,
  })),
  rolledBackTo: v1.versionId,
  oldAudioPreserved: true,
  otherWindowsUnchanged: true,
  audioQualityVerified: false,
  notes:
    "V1复制已有音频，V2为静音模拟WAV；不能评价自然度，未执行正式任务Apply。",
};
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(
  join(out, "transcript.json"),
  JSON.stringify(transcript, null, 2),
);
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
