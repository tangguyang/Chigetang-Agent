import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  RealSpeechV2Service,
  type Adapter,
} from "../src/main/realSpeech/v2/service.ts";
import { SpeechAgentControl } from "../src/main/realSpeech/v2/agentControl.ts";
import { runCli } from "../src/cli/run.ts";
import { parseArgs } from "../src/cli/args.ts";
import { SecretFilter, resultOutput } from "../src/cli/output.ts";
import { buildRequest } from "../src/main/realSpeech/v2/request.ts";
import { sha256 } from "../src/main/realSpeech/v2/validator.ts";
import { TaskLocks } from "../src/main/realSpeech/v2/taskLock.ts";
import { assertCoordinatedDesktop } from "../src/main/realSpeech/v2/runtimeCoordination.ts";
import { WINDOWS_DATA_ROOT } from "../src/main/services/storage.ts";
const projectRoot = resolve(".");
export const fakeWav: Adapter = async (body, path) => {
  const n = 2400,
    b = Buffer.alloc(44 + n * 2);
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
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE((i % 20) * Number(body.input.seed || 1), 44 + i * 2);
  writeFileSync(path, b, { flag: "wx" });
  return {
    requestId: "offline-test-only",
    usage: { characters: body.input.text.length },
  };
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), "ctg-agent-test-")),
    service = new RealSpeechV2Service(root);
  const plan = JSON.parse(
    readFileSync(
      "resources/real-speech-v2/examples/plan-l0-baseline.json",
      "utf8",
    ),
  );
  const task = service.importPlan({
    name: "GW002测试",
    voiceRef: "offline-voice",
    text: JSON.stringify(plan),
    confirmed: true,
  });
  service.close();
  return { root, task };
}
function patchFor(task: any, set: any = { seed: 1235 }) {
  const w = task.windows.find((w: any) => w.windowId === "GW002"),
    v = w.versions.find((v: any) => v.versionId === w.selectedVersionId);
  return {
    schema: "REAL_SPEECH_EXECUTION_PATCH_V2",
    protocolVersion: task.plan.protocolVersion,
    capabilityProfileId: task.plan.capabilityProfileId,
    capabilityVersion: task.plan.capabilityVersion,
    patchId: crypto.randomUUID(),
    taskId: task.taskId,
    basePlanId: task.plan.planId,
    basePlanHash: task.planHash,
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
        set,
        executionConfidence: task.plan.windows.find(
          (c: any) => c.windowId === "GW002",
        ).executionConfidence,
      },
    ],
    lockedWindows: task.windows
      .filter((w: any) => w.locked)
      .map((w: any) => w.windowId),
    diagnosis: {
      evidenceBasis: "text_only",
      listenedVersionIds: [],
      summary: "离线结构测试，未听音频",
      issues: [
        {
          windowId: "GW002",
          dimension: "semanticPause",
          observation: "仅离线结构测试",
          certainty: "unverified",
        },
      ],
    },
    validationFocus: [
      { windowId: "GW002", focus: "只验证版本保护，不评价音质" },
    ],
    changeIsolationPolicy: "ONE_PRIMARY_VARIABLE_AT_A_TIME",
  };
}
function filePatch(root: string, task: any, set?: any) {
  const file = join(root, crypto.randomUUID() + ".json");
  writeFileSync(file, JSON.stringify(patchFor(task, set)));
  return file;
}
async function cli(root: string, argv: string[], adapter?: Adapter) {
  let stdout = "",
    stderr = "";
  const code = await runCli(
    ["speech", ...argv, "--data-root", root, "--json"],
    {
      projectRoot,
      adapter,
      stdout: (s) => (stdout += s),
      stderr: (s) => (stderr += s),
    },
  );
  return { code, stdout, stderr, result: JSON.parse(stdout) };
}
function snapshot(root: string) {
  const files: Record<string, string> = {};
  function walk(dir: string) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else files[p] = sha256(readFileSync(p));
    }
  }
  walk(root);
  return files;
}

test("Agent READ命令与预览不修改DB/业务文件，不恢复submitting或创建job", async () => {
  const { root, task } = setup();
  const s = new RealSpeechV2Service(
    root,
    undefined,
    undefined,
    "existingWrite",
  );
  task.windows[1].attempts.push({ status: "submitting", attemptId: "pending" });
  s.save(task);
  s.close();
  const before = snapshot(root);
  for (const cmd of [
    "tasks",
    "show",
    "window",
    "context",
    "diagnose",
    "versions",
  ]) {
    const args = [cmd];
    if (cmd !== "tasks") args.push("--task", task.taskId);
    if (!["tasks", "show"].includes(cmd)) args.push("--window", "GW002");
    const r = await cli(root, args);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(snapshot(root), before);
    assert.equal(r.stderr, "");
  }
  const file = filePatch(root, task),
    baseline = snapshot(root);
  const preview = await cli(root, [
    "patch-preview",
    "--task",
    task.taskId,
    "--file",
    file,
  ]);
  assert.equal(preview.code, 0, preview.stderr);
  assert.deepEqual(snapshot(root), baseline);
  const check = new RealSpeechV2Service(root, undefined, undefined, "readOnly");
  assert.equal(
    check.get(task.taskId).windows[1].attempts[0].status,
    "submitting",
  );
  assert.equal(check.db.prepare("SELECT count(*) n FROM jobs").get()?.n, 0);
  check.close();
});
test("Agent context机器结构、安全过滤和诊断不推导执行参数", async () => {
  const { root, task } = setup(),
    key = "sk-testsecret012345678901234567890";
  const s = new RealSpeechV2Service(
    root,
    undefined,
    undefined,
    "existingWrite",
  );
  task.plan.intentRanges.find(
    (r: any) => r.target.windowId === "GW002",
  ).humanIntent = "快十倍 " + key;
  task.plan.intentRanges.find(
    (r: any) => r.target.windowId === "GW002",
  ).apiKey = key;
  s.save(task);
  s.close();
  const r = await cli(root, [
    "context",
    "--task",
    task.taskId,
    "--window",
    "GW002",
  ]);
  assert.equal(r.code, 0);
  assert.equal(r.result.data.schema, "REAL_SPEECH_AGENT_CONTEXT_V1");
  assert(!r.stdout.includes(key));
  assert(!r.stdout.includes('"apiKey"'));
  assert.deepEqual(
    r.result.data.window.execution,
    task.plan.windows[1].execution,
  );
  const filter = new SecretFilter();
  filter.remember("arbitrary-secret");
  const out = resultOutput(
    "test",
    {
      Authorization: "Bearer secret",
      encrypted: "blob",
      text: "arbitrary-secret Bearer abc sk-testsecret0123456789",
    },
    filter,
  );
  assert(!out.includes("arbitrary-secret"));
  assert(!out.includes('"Authorization"'));
  assert(!out.includes('"encrypted"'));
  const changed = structuredClone(task.plan.windows[1]);
  changed.intentRanges = [{ humanIntent: "提高pitch到2" }];
  assert.deepEqual(
    buildRequest(task.plan.engine.model, task.voiceRef, changed),
    buildRequest(task.plan.engine.model, task.voiceRef, task.plan.windows[1]),
  );
});
test("Agent generate/patch-apply/concat缺confirm在打开Service之前拒绝", async () => {
  const root = join(tmpdir(), crypto.randomUUID());
  for (const command of ["generate", "patch-apply", "concat"]) {
    const args = [command, "--task", "missing"];
    if (command === "generate") args.push("--window", "GW002");
    if (command === "patch-apply") args.push("--file", "missing.json");
    const r = await cli(root, args);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /confirm/);
    assert.equal(existsSync(root), false);
  }
});
test("Agent GW002离线Patch Preview→Apply→V1/V2→select→rollback不覆盖", async () => {
  const { root, task } = setup();
  const generated = await cli(
    root,
    ["generate", "--task", task.taskId, "--window", "GW002", "--confirm"],
    fakeWav,
  );
  assert.equal(generated.code, 0, generated.stderr);
  const before = generated.result.data.task;
  const first = before.windows[1].versions[0],
    bytes = readFileSync(first.path),
    file = filePatch(root, before);
  const preview = await cli(root, [
    "patch-preview",
    "--task",
    task.taskId,
    "--file",
    file,
  ]);
  assert.deepEqual(preview.result.data.primaryVariables, ["seed"]);
  assert.equal(preview.result.data.generateIds.length, 1);
  const applied = await cli(
    root,
    [
      "patch-apply",
      "--task",
      task.taskId,
      "--file",
      file,
      "--preview-hash",
      preview.result.data.previewHash,
      "--confirm",
    ],
    fakeWav,
  );
  assert.equal(applied.code, 0, applied.stderr);
  const after = applied.result.data.task;
  assert.equal(after.windows[1].versions.length, 2);
  assert.deepEqual(after.windows[0], before.windows[0]);
  assert.deepEqual(after.windows[2], before.windows[2]);
  assert.deepEqual(readFileSync(first.path), bytes);
  const versions = await cli(root, [
    "versions",
    "--task",
    task.taskId,
    "--window",
    "GW002",
  ]);
  assert.deepEqual(
    versions.result.data.map((v: any) => v.versionNumber),
    [2, 1],
  );
  assert(versions.result.data.every((v: any) => v.configRevision !== null));
  const second = versions.result.data[0];
  assert.notEqual(second.path, first.path);
  assert.equal(
    (
      await cli(root, [
        "select",
        "--task",
        task.taskId,
        "--window",
        "GW002",
        "--version",
        second.versionId,
      ])
    ).code,
    0,
  );
  assert.equal(
    (
      await cli(root, [
        "rollback",
        "--task",
        task.taskId,
        "--window",
        "GW002",
        "--version",
        first.versionId,
      ])
    ).code,
    0,
  );
  assert(existsSync(second.path));
  assert.deepEqual(readFileSync(first.path), bytes);
  const reader = new RealSpeechV2Service(
    root,
    undefined,
    undefined,
    "readOnly",
  );
  assert.equal(
    reader.get(task.taskId).windows[1].selectedVersionId,
    first.versionId,
  );
  reader.close();
});
test("Agent实验Patch未额外确认拒绝且不创建job", async () => {
  const { root, task } = setup();
  const file = filePatch(root, task, {
    rate: 1.05,
    controlComplexity: "L3",
    naturalnessRisk: "HIGH",
    experimental: true,
    controlReason: "仅实验，明确全局rate偏离默认值",
  });
  const p = await cli(root, [
    "patch-preview",
    "--task",
    task.taskId,
    "--file",
    file,
  ]);
  assert.equal(p.code, 0, p.stderr);
  assert.equal(p.result.data.experimentalRequired, true);
  const denied = await cli(
    root,
    [
      "patch-apply",
      "--task",
      task.taskId,
      "--file",
      file,
      "--preview-hash",
      p.result.data.previewHash,
      "--confirm",
    ],
    fakeWav,
  );
  assert.notEqual(denied.code, 0);
  const s = new RealSpeechV2Service(root, undefined, undefined, "readOnly");
  assert.equal(s.db.prepare("SELECT count(*) n FROM jobs").get()?.n, 0);
  assert.deepEqual(s.get(task.taskId), task);
  s.close();
  const ok = await cli(
    root,
    [
      "patch-apply",
      "--task",
      task.taskId,
      "--file",
      file,
      "--preview-hash",
      p.result.data.previewHash,
      "--confirm",
      "--experimental-confirm",
    ],
    fakeWav,
  );
  assert.equal(ok.code, 0, ok.stderr);
  const deniedGeneration = await cli(
    root,
    ["generate", "--task", task.taskId, "--window", "GW002", "--confirm"],
    fakeWav,
  );
  assert.notEqual(deniedGeneration.code, 0);
  assert.match(deniedGeneration.stderr, /experimental-confirm/);
});
test("Agent locked与Golden保护、ONE_PRIMARY_VARIABLE拒绝，预览hash失效拒绝", async () => {
  const { root, task } = setup();
  const multiple = filePatch(root, task, {
    seed: 1235,
    instruction: "平静说。",
    instructionIntentCount: 1,
    controlComplexity: "L1",
    naturalnessRisk: "MEDIUM",
    controlReason: "双变量应拒绝",
  });
  assert.notEqual(
    (
      await cli(root, [
        "patch-preview",
        "--task",
        task.taskId,
        "--file",
        multiple,
      ])
    ).code,
    0,
  );
  const valid = filePatch(root, task),
    preview = await cli(root, [
      "patch-preview",
      "--task",
      task.taskId,
      "--file",
      valid,
    ]);
  const s = new RealSpeechV2Service(
    root,
    undefined,
    undefined,
    "existingWrite",
  );
  s.mutate({
    taskId: task.taskId,
    taskRevision: task.taskRevision,
    windowId: "GW002",
    type: "lock",
    locked: true,
  });
  s.close();
  assert.notEqual(
    (
      await cli(
        root,
        [
          "patch-apply",
          "--task",
          task.taskId,
          "--file",
          valid,
          "--preview-hash",
          preview.result.data.previewHash,
          "--confirm",
        ],
        fakeWav,
      )
    ).code,
    0,
  );
  assert.notEqual(
    (
      await cli(
        root,
        ["generate", "--task", task.taskId, "--window", "GW002", "--confirm"],
        fakeWav,
      )
    ).code,
    0,
  );
  const ui = new RealSpeechV2Service(root);
  let t = ui.get(task.taskId);
  t = ui.mutate({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    windowId: "GW002",
    type: "lock",
    locked: false,
  });
  for (const id of ["GW001", "GW002", "GW003"])
    await ui.runJob(
      ui.createJob({
        taskId: t.taskId,
        taskRevision: ui.get(t.taskId).taskRevision,
        windowIds: [id],
      }).jobId,
      fakeWav,
    );
  t = await ui.concat({
    taskId: t.taskId,
    taskRevision: ui.get(t.taskId).taskRevision,
  });
  ui.mutate({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "golden",
    confirmed: true,
  });
  ui.close();
  const version = (
    await cli(root, ["versions", "--task", task.taskId, "--window", "GW002"])
  ).result.data[0].versionId;
  assert.notEqual(
    (
      await cli(root, [
        "rollback",
        "--task",
        task.taskId,
        "--window",
        "GW002",
        "--version",
        version,
      ])
    ).code,
    0,
  );
});
test("Agent只读Service主动拒绝所有写入口；invalid task/window为非0 JSON", async () => {
  const { root, task } = setup(),
    s = new RealSpeechV2Service(root, undefined, undefined, "readOnly");
  assert.throws(() => s.save(task), /只读/);
  assert.throws(
    () =>
      s.createJob({
        taskId: task.taskId,
        taskRevision: task.taskRevision,
        windowIds: ["GW002"],
      }),
    /只读/,
  );
  s.close();
  for (const args of [
    ["show", "--task", "missing"],
    ["window", "--task", task.taskId, "--window", "GW999"],
  ]) {
    const r = await cli(root, args);
    assert.notEqual(r.code, 0);
    assert.equal(r.result.ok, false);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert(r.stderr.length > 0);
  }
  assert.throws(() => parseArgs(["speech", "tasks", "--confirm"]), /未知/);
  assert.throws(
    () => parseArgs(["speech", "show", "--task", "one", "--task", "two"]),
    /重复/,
  );
});
test("Agent UI/CLI两个Service实例共享结果与任务锁，读取不停更正在执行的job", async () => {
  const { root, task } = setup(),
    ui = new RealSpeechV2Service(root),
    job = ui.createJob({
      taskId: task.taskId,
      taskRevision: task.taskRevision,
      windowIds: ["GW002"],
    });
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  const pending = ui.runJob(job.jobId, async (body, path) => {
    entered();
    await new Promise<void>((r) => (release = r));
    return fakeWav(body, path);
  });
  await ready;
  const read = new RealSpeechV2Service(root, undefined, undefined, "readOnly");
  assert.equal(read.job(job.jobId).status, "running");
  read.close();
  const newUi = new RealSpeechV2Service(root);
  assert.equal(newUi.job(job.jobId).status,"running","UI启动不得中断CLI持锁任务");
  assert.equal(newUi.get(task.taskId).windows[1].attempts[0].status,"submitting");
  newUi.close();
  const other = new RealSpeechV2Service(
    root,
    undefined,
    undefined,
    "existingWrite",
  );
  assert.throws(
    () =>
      other.createJob({
        taskId: task.taskId,
        taskRevision: other.get(task.taskId).taskRevision,
        windowIds: ["GW002"],
      }),
    /正在运行/,
  );
  other.close();
  release();
  await pending;
  const r = await cli(root, [
    "context",
    "--task",
    task.taskId,
    "--window",
    "GW002",
  ]);
  assert.deepEqual(
    r.result.data.selectedVersion.fileHash,
    ui.get(task.taskId).windows[1].versions[0].fileHash,
  );
  ui.close();
});
test("Agent跨进程锁排他：其他进程不能争用，死进程锁不被自动删除", () => {
  const root = mkdtempSync(join(tmpdir(), "ctg-lock-")),
    locks = new TaskLocks(root);
  locks.run("task", () => {
    const code = `import{TaskLocks}from${JSON.stringify(pathToFileURL(resolve("src/main/realSpeech/v2/taskLock.ts")).href)};try{new TaskLocks(${JSON.stringify(root)}).run('task',()=>{});process.exitCode=1;}catch{process.stdout.write('BLOCKED');}`;
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", code],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "BLOCKED");
  });
  const path = join(root, "locks", sha256("dead") + ".lock");
  writeFileSync(path, JSON.stringify({ pid: 99999999, token: "dead" }));
  assert.throws(() => locks.run("dead", () => {}), /正在运行/);
  assert(existsSync(path));
});
test("Agent Windows实际CLI stdout只有JSON、stderr独立、成功/失败exit code", () => {
  const { root, task } = setup();
  for (const [argv, expected] of [
    [["tasks"], 0],
    [["context", "--task", task.taskId, "--window", "GW002"], 0],
    [["window", "--task", task.taskId, "--window", "GW999"], 1],
    [["generate", "--task", task.taskId, "--window", "GW002"], 1],
  ] as const) {
    const r = spawnSync(
      process.execPath,
      [
        "scripts/chigetang.mjs",
        "speech",
        ...argv,
        "--data-root",
        root,
        "--json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, expected, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, expected === 0);
    assert.equal(r.stdout.trim().split("\n").length, 1);
  }
});

test("Agent重复Patch不重发，过期previewHash拒绝且不创建job", async () => {
  const { root, task } = setup(),
    file = filePatch(root, task),
    p = await cli(root, [
      "patch-preview",
      "--task",
      task.taskId,
      "--file",
      file,
    ]);
  let calls = 0;
  const adapter: Adapter = async (body, path) => {
    calls++;
    return fakeWav(body, path);
  };
  const args = [
    "patch-apply",
    "--task",
    task.taskId,
    "--file",
    file,
    "--preview-hash",
    p.result.data.previewHash,
    "--confirm",
  ];
  assert.equal((await cli(root, args, adapter)).code, 0);
  const again = await cli(root, args, adapter);
  assert.equal(again.code, 0);
  assert.equal(again.result.data.reused, true);
  assert.equal(calls, 1);
  const other = setup(),
    f = filePatch(other.root, other.task),
    preview = await cli(other.root, [
      "patch-preview",
      "--task",
      other.task.taskId,
      "--file",
      f,
    ]);
  const ui = new RealSpeechV2Service(other.root);
  ui.mutate({
    taskId: other.task.taskId,
    taskRevision: other.task.taskRevision,
    type: "feedback",
    windowIds: ["GW002"],
    feedback: "预览后新增反馈",
  });
  ui.close();
  const stale = await cli(
    other.root,
    [
      "patch-apply",
      "--task",
      other.task.taskId,
      "--file",
      f,
      "--preview-hash",
      preview.result.data.previewHash,
      "--confirm",
    ],
    adapter,
  );
  assert.notEqual(stale.code, 0);
  assert.equal(calls, 1);
  const ro = new RealSpeechV2Service(
    other.root,
    undefined,
    undefined,
    "readOnly",
  );
  assert.equal(ro.db.prepare("SELECT count(*) n FROM jobs").get()?.n, 0);
  ro.close();
});
test("Agent只读快照包含尚未checkpoint的WAL；导出沿用UI诊断格式", async () => {
  const { root, task } = setup(),
    ui = new RealSpeechV2Service(root);
  ui.db.exec("PRAGMA wal_autocheckpoint=0");
  const t = ui.mutate({
      taskId: task.taskId,
      taskRevision: task.taskRevision,
      type: "feedback",
      windowIds: ["GW002"],
      feedback: "WAL新提交",
    }),
    before = snapshot(root);
  const read = await cli(root, [
    "context",
    "--task",
    task.taskId,
    "--window",
    "GW002",
  ]);
  assert.equal(read.result.data.taskRevision, t.taskRevision);
  assert.equal(read.result.data.feedback.at(-1).description, "WAL新提交");
  assert.deepEqual(snapshot(root), before);
  await ui.runJob(
    ui.createJob({
      taskId: task.taskId,
      taskRevision: t.taskRevision,
      windowIds: ["GW002"],
    }).jobId,
    fakeWav,
  );
  ui.close();
  const exported = await cli(root, [
    "export-diagnosis",
    "--task",
    task.taskId,
    "--window",
    "GW002",
    "--feedback",
    "只打包未诊断",
  ]);
  assert.equal(exported.code, 0, exported.stderr);
  const zip = readFileSync(exported.result.data.path);
  assert.equal(zip.subarray(0, 2).toString(), "PK");
  for (const name of [
    "plan.json",
    "current-versions.json",
    "production-policy.json",
    "intent-ranges.json",
    "manifest.json",
    "audio/GW002.wav",
  ])
    assert(zip.includes(Buffer.from(name)));
});
test("Agent当前未更新绿色版写操作拒绝，只读和隔离测试不受影响", () => {
  if (process.platform !== "win32") return;
  assert.throws(
    () =>
      assertCoordinatedDesktop(WINDOWS_DATA_ROOT, [
        {
          ProcessId: 99999999,
          ParentProcessId: 0,
          ExecutablePath: "Z:/uncoordinated/吃个糖Agent.exe",
        },
      ]),
    /共享任务锁/,
  );
  assert.doesNotThrow(() => assertCoordinatedDesktop(WINDOWS_DATA_ROOT, []));
});
