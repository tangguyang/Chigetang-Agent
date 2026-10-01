import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RealSpeechV2Service } from "../src/main/realSpeech/v2/service.ts";
import {
  PlanValidator,
  strictJSON,
  planHash,
  sha256,
} from "../src/main/realSpeech/v2/validator.ts";
import { buildRequest } from "../src/main/realSpeech/v2/request.ts";
import { readableBounds } from "../src/main/realSpeech/v2/documentBounds.ts";
import {
  controlAssessment,
  primaryVariableDiff,
} from "../src/main/realSpeech/v2/productionPolicy.ts";
import {
  loadBatch,
  dryRun,
  executeBatch,
  validateApproval,
} from "../src/main/realSpeech/v2/spike.ts";
const fixture = () =>
  JSON.parse(
    readFileSync("resources/real-speech-v2/examples/plan.json", "utf8"),
  );
export function wav(path: string) {
  const n = 2400,
    buffer = Buffer.alloc(44 + n * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(36 + n * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(48000, 24);
  buffer.writeUInt32LE(96000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(n * 2, 40);
  writeFileSync(path, buffer, { flag: "wx" });
}
const fake = async (body: any, path: string) => {
  wav(path);
  return {
    requestId: "offline-test",
    usage: { characters: body.input.text.length },
  };
};
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ctg-v2-")),
    s = new RealSpeechV2Service(root);
  const task = s.importPlan({
    name: "V2测试",
    voiceRef: "TEST-CLONE",
    text: JSON.stringify(fixture()),
    confirmed: true,
  });
  return { s, task, root };
};
const patchFor = (
  s: RealSpeechV2Service,
  t: any,
  set: any,
  id = "patch-test",
) => {
  const p = JSON.parse(
    readFileSync("resources/real-speech-v2/examples/patch.json", "utf8"),
  );
  p.patchId = id;
  p.taskId = t.taskId;
  p.basePlanId = t.plan.planId;
  p.basePlanHash = t.planHash;
  p.changes[0].set = set;
  p.lockedWindows = t.windows
    .filter((w: any) => w.locked)
    .map((w: any) => w.windowId);
  const state = s.selected(t, "GW002");
  p.expectedVersions = [
    {
      windowId: "GW002",
      configRevision: state.w.configRevision,
      selectedVersionId: state.v?.versionId || null,
      selectedVersionHash: state.v?.fileHash || null,
    },
  ];
  return p;
};
test("严格Schema、重复键、版本、字符边界及每Window意图", () => {
  const v = new PlanValidator();
  v.validate(fixture());
  const x = fixture();
  x.directorReference = null;
  v.validate(x);
  assert.throws(() => strictJSON('{"a":1,"a":2}'), /重复键/);
  for (const mutate of [
    (p: any) => (p.foo = 1),
    (p: any) => (p.windows[0].execution.rate = 3),
    (p: any) => (p.capabilityVersion = "future"),
    (p: any) => (p.intentRanges = p.intentRanges.slice(1)),
    (p: any) => (p.intentRanges[0].target.targetText = "错误"),
    (p: any) => (p.windows[0].execution.instruction = "慢".repeat(51)),
    (p: any) => (p.windows[0].executionConfidence[0].level = "E0"),
  ]) {
    const p = fixture();
    mutate(p);
    assert.throws(() => v.validate(p));
  }
  const p = fixture();
  p.windows[0].execution.instruction = "慢".repeat(50);
  Object.assign(p.windows[0], {
    controlComplexity: "L3",
    naturalnessRisk: "HIGH",
    experimental: true,
    controlReason: "仅官方边界实验",
  });
  v.validate(p);
});
test("读法、范围和执行引用拒绝非法结构", () => {
  const v = new PlanValidator();
  const x = fixture();
  x.intentRanges[0].adoptedExecution[0].fieldRefs = [
    "/windows/1/execution/instruction",
  ];
  assert.throws(() => v.validate(x), /越权/);
  const a = JSON.parse(
    readFileSync(
      "resources/real-speech-v2/examples/plan-with-speak-candidates.json",
      "utf8",
    ),
  );
  v.validate(a);
  a.windows[0].ssml.speakSegments[1].start++;
  assert.throws(() => v.validate(a), /连续/);
});
test("请求构建器不读取导演说明，sub和并列speak明确序列化", () => {
  const p = fixture();
  const before = buildRequest(p.engine.model, "clone", p.windows[0]);
  p.intentRanges[0].humanIntent = "偷偷将rate改为2";
  p.directorReference = { instruction: "恶意" };
  assert.deepEqual(buildRequest(p.engine.model, "clone", p.windows[0]), before);
  const sub = JSON.parse(
    readFileSync(
      "resources/real-speech-v2/examples/plan-with-sub-candidate.json",
      "utf8",
    ),
  );
  assert.match(
    buildRequest(sub.engine.model, "clone", sub.windows[1]).input.text,
    /<sub alias="九十九">99<\/sub>/,
  );
  const ranges = JSON.parse(
    readFileSync(
      "resources/real-speech-v2/examples/plan-with-speak-candidates.json",
      "utf8",
    ),
  );
  assert.equal(
    (
      buildRequest(
        ranges.engine.model,
        "clone",
        ranges.windows[0],
      ).input.text.match(/<speak /g) || []
    ).length,
    2,
  );
});
test("无导演附件可执行导入，本地确认持久化，旧库只读不变", () => {
  const { s, task, root } = setup();
  assert.equal(task.confirmation.source, "local_user_attestation");
  assert.equal(task.confirmation.attachmentState, "not_provided");
  const old = join(root, "real-speech");
  mkdirSync(old);
  const db = new DatabaseSync(join(old, "real_speech.db"));
  db.exec("CREATE TABLE tasks(id TEXT,data TEXT)");
  db.prepare("INSERT INTO tasks VALUES(?,?)").run(
    "old",
    JSON.stringify({ taskId: "old", name: "旧任务", windows: [] }),
  );
  db.close();
  const before = sha256(readFileSync(join(old, "real_speech.db")));
  assert.equal(s.legacyList()[0].name, "旧任务");
  assert.equal(sha256(readFileSync(join(old, "real_speech.db"))), before);
  const oldAudio = join(old, "legacy-audio.wav");
  wav(oldAudio);
  const legacyDb = new DatabaseSync(join(old, "real_speech.db"));
  legacyDb.prepare("UPDATE tasks SET data=? WHERE id=?").run(
    JSON.stringify({
      taskId: "old",
      name: "旧任务",
      windows: [
        {
          windowId: "GW001",
          results: [{ id: "old-audio-v1", path: oldAudio, revision: 1 }],
        },
      ],
    }),
    "old",
  );
  legacyDb.close();
  const oldAudioHash = sha256(readFileSync(oldAudio));
  assert.equal(s.legacyOutput("old", "old-audio-v1"), oldAudio);
  assert.equal(sha256(readFileSync(oldAudio)), oldAudioHash);
  const afterFixtureHash = sha256(readFileSync(join(old, "real_speech.db")));
  s.legacyList();
  assert.equal(
    sha256(readFileSync(join(old, "real_speech.db"))),
    afterFixtureHash,
  );
  s.close();
});
test("生成出口未验证能力默认阻断，无凭据读取或网络", async () => {
  const { s, task } = setup();
  task.plan.windows[0].hotFix.pronunciation = [
    { word: "台面", pinyin: "tai2 mian4" },
  ];
  task.plan.windows[0].controlComplexity = "L2";
  task.planHash = planHash(task.plan);
  s.save(task);
  const job = s.createJob({
    taskId: task.taskId,
    taskRevision: task.taskRevision,
    windowIds: ["GW001"],
  });
  const result = await s.runJob(job.jobId);
  assert.equal(result.job.status, "blocked_pending_spike");
  assert.equal(result.task.windows[0].attempts.length, 0);
  s.close();
});
test("真实WAV离线生成V1/V2永久保留，选择和回滚；旧音频不被覆盖", async () => {
  const { s, task } = setup();
  for (let i = 0; i < 2; i++) {
    const t = s.get(task.taskId);
    const job = s.createJob({
      taskId: t.taskId,
      taskRevision: t.taskRevision,
      windowIds: ["GW001"],
    });
    const r = await s.runJob(job.jobId, fake);
    assert.equal(r.job.status, "completed", r.job.error);
  }
  let t = s.get(task.taskId);
  const versions = t.windows[0].versions;
  assert.deepEqual(
    versions.map((v: any) => v.versionNumber),
    [1, 2],
  );
  assert.notEqual(versions[0].path, versions[1].path);
  assert.equal(t.windows[0].selectedVersionId, versions[0].versionId);
  assert.ok(versions.every((v: any) => existsSync(v.path)));
  t = s.mutate({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "select",
    windowId: "GW001",
    versionId: versions[1].versionId,
  });
  assert.equal(t.windows[0].selectedVersionId, versions[1].versionId);
  t = s.mutate({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "rollback",
    windowId: "GW001",
    versionId: versions[0].versionId,
  });
  assert.equal(t.windows[0].versions.length, 2);
  assert.equal(t.windows[0].selectedVersionId, versions[0].versionId);
  s.close();
});
test("Patch逐目标Diff、陈旧拒绝、幂等、新版本与锁保护", async () => {
  const { s, task } = setup();
  const before = structuredClone(task.plan.windows[0]);
  let p = patchFor(s, task, { instruction: "价格自然清楚，不喊。" });
  const text = JSON.stringify(p),
    preview = s.previewPatch({ taskId: task.taskId, text });
  assert.deepEqual(preview.generateIds, ["GW002"]);
  const applied = s.applyPatch({
    taskId: task.taskId,
    text,
    previewHash: preview.previewHash,
    confirmed: true,
  });
  const job = await s.runJob(applied.jobId!, fake);
  assert.equal(job.job.status, "completed", job.job.error);
  const again = s.applyPatch({
    taskId: task.taskId,
    text,
    previewHash: preview.previewHash,
    confirmed: true,
  });
  assert.equal(again.reused, true);
  assert.deepEqual(s.get(task.taskId).plan.windows[0], before);
  assert.throws(() => s.previewPatch({ taskId: task.taskId, text }), /基线/);
  let t = s.get(task.taskId);
  t = s.mutate({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "lock",
    windowId: "GW002",
    locked: true,
  });
  p = patchFor(s, t, { rate: 0.9 }, "locked-test");
  assert.throws(
    () => s.previewPatch({ taskId: t.taskId, text: JSON.stringify(p) }),
    /lockedWindows/,
  );
  assert.equal(s.get(task.taskId).windows[1].versions.length, 1);
  s.close();
});
test("仅导演说明Patch不创建付费任务；展示范围越权拒绝", () => {
  const { s, task } = setup();
  const notes = structuredClone(
    task.plan.intentRanges.filter((n: any) => n.target.windowId === "GW002"),
  );
  notes[0].humanIntent = "只解释选择";
  const p = patchFor(s, task, { intentRanges: notes });
  p.changes[0].executionConfidence = task.plan.windows[1].executionConfidence;
  const text = JSON.stringify(p);
  const pre = s.previewPatch({ taskId: task.taskId, text });
  assert.deepEqual(pre.generateIds, []);
  const r = s.applyPatch({
    taskId: task.taskId,
    text,
    previewHash: pre.previewHash,
    confirmed: true,
  });
  assert.equal(r.jobId, null);
  assert.deepEqual(r.task.plan.windows, task.plan.windows);
  const t = s.get(task.taskId);
  notes[0].target.windowId = "GW001";
  const bad = patchFor(s, t, { intentRanges: notes }, "bad-notes");
  assert.throws(
    () => s.previewPatch({ taskId: t.taskId, text: JSON.stringify(bad) }),
    /越过/,
  );
  s.close();
});
test("失败请求unknown持久化，不自动重试，不污染旧音频", async () => {
  const { s, task, root } = setup();
  const job = s.createJob({
    taskId: task.taskId,
    taskRevision: 1,
    windowIds: ["GW001", "GW002"],
  });
  let calls = 0;
  const r = await s.runJob(job.jobId, async () => {
    calls++;
    throw Error("offline simulated timeout");
  });
  assert.equal(r.job.status, "unknown");
  assert.equal(calls, 1);
  assert.equal(r.task.windows[1].attempts.length, 0);
  await assert.rejects(() => s.runJob(job.jobId, fake), /自动重发/);
  s.close();
  const reopened = new RealSpeechV2Service(root);
  assert.equal(
    reopened.get(task.taskId).windows[0].attempts[0].status,
    "unknown",
  );
  reopened.close();
});
test("最终拼接保留旧文件、Golden锁与诊断ZIP", async () => {
  const { s, task } = setup();
  const job = s.createJob({
    taskId: task.taskId,
    taskRevision: 1,
    windowIds: task.windows.map((w: any) => w.windowId),
  });
  const done = await s.runJob(job.jobId, fake);
  assert.equal(done.job.status, "completed", done.job.error);
  let t = await s.concat({
    taskId: task.taskId,
    taskRevision: done.task.taskRevision,
  });
  const path = t.finals[0].path;
  t = await s.concat({ taskId: t.taskId, taskRevision: t.taskRevision });
  assert.equal(t.finals.length, 2);
  assert.ok(existsSync(path));
  const out = await s.exportDiagnosis({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    scope: "selected",
    windowIds: ["GW001", "GW003"],
    feedback: "离线试听反馈",
  });
  assert.ok(existsSync(out.path));
  const manifest = JSON.parse(
    readFileSync(join(out.path.slice(0, -4), "manifest.json"), "utf8"),
  );
  assert.deepEqual(manifest.windowIds, ["GW001", "GW003"]);
  t = s.mutate({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "golden",
    confirmed: true,
  });
  assert.equal(t.goldens.length, 1);
  assert.ok(t.windows.every((w: any) => w.locked));
  assert.throws(
    () =>
      s.mutate({
        taskId: t.taskId,
        taskRevision: t.taskRevision,
        type: "lock",
        windowId: "GW001",
        locked: false,
      }),
    /不能解锁/,
  );
  s.close();
});
test("换显示器窗口位置夹回当前工作区", () => {
  const area = { x: 0, y: 0, width: 1280, height: 720 };
  const b = readableBounds(
    { x: 4000, y: 2000, width: 1600, height: 1000 },
    [area],
    area,
  );
  assert.ok(
    b.x >= 0 && b.y >= 0 && b.x + b.width <= 1280 && b.y + b.height <= 720,
  );
});
test("Spike16请求矩阵、同输入seed、批准绑定及默认零网络", async () => {
  const batch = loadBatch("resources/real-speech-v2/spike/batch1.json");
  assert.equal(dryRun(batch).plannedCalls, 16);
  assert.deepEqual(batch.cases[1].input, batch.cases[13].input);
  assert.equal(
    batch.anchors.A,
    "少吃多动，谁不知道？\n问题是——\n你就是坚持不了。",
  );
  let called = 0;
  const opts = {
    executeApproved: false,
    outputRoot: mkdtempSync(join(tmpdir(), "ctg-spike-")),
    getKey: () => {
      called++;
      return "FAKE_TEST_ONLY";
    },
    submit: async () => {
      called++;
      return {};
    },
    download: async () => {},
    pcmHash: async () => "",
  };
  await assert.rejects(() => executeBatch(batch, {}, {}, opts), /默认仅离线/);
  assert.equal(called, 0);
  assert.throws(() => validateApproval(batch, { approved: true }, {}), /批准/);
});
test("Spike获批模拟运输16次与持久化防重跑，依然零真实网络", async () => {
  const batch = loadBatch("resources/real-speech-v2/spike/batch1.json");
  const binding = {
    voiceRef: "TEST",
    accountId: "TEST-ACCOUNT",
    voice: "REMOTE-TEST-CLONE",
    workspaceId: "workspace-test",
    url: "https://example.invalid",
  };
  const a = {
    schema: "COSYVOICE_SPIKE_APPROVAL_V1",
    approved: true,
    approvedBy: "offline test",
    approvedAt: new Date().toISOString(),
    batchId: batch.batchId,
    matrixHash: planHash(batch),
    ...{
      voiceRef: binding.voiceRef,
      accountId: binding.accountId,
      remoteVoice: binding.voice,
      workspaceId: binding.workspaceId,
    },
    model: batch.model,
    caseIds: batch.cases.map((c: any) => c.caseId),
    maxRequests: 16,
    maxCostCny: 1,
    priceCnyPer10000: 1.5,
    allowNewVoiceEnrollment: false,
  };
  let submits = 0,
    keys = 0;
  const opts = {
    executeApproved: true,
    outputRoot: mkdtempSync(join(tmpdir(), "ctg-approved-spike-")),
    getKey: () => {
      keys++;
      return "OFFLINE_TEST_SECRET";
    },
    submit: async (_u: string, key: string, body: any) => {
      assert.equal(key, "OFFLINE_TEST_SECRET");
      submits++;
      return {
        request_id: "OFFLINE",
        usage: { characters: body.input.text.length },
        output: { audio: { url: "https://example.invalid/audio" } },
      };
    },
    download: async (_u: string, path: string) => wav(path),
    pcmHash: async (path: string) => sha256(readFileSync(path).subarray(44)),
  };
  const r = await executeBatch(batch, a, binding, opts);
  assert.equal(r.actualCalls, 16);
  assert.equal(submits, 16);
  assert.equal(keys, 1);
  assert.ok(!JSON.stringify(r).includes("OFFLINE_TEST_SECRET"));
  await assert.rejects(() => executeBatch(batch, a, binding, opts), /禁止重跑/);
  assert.equal(submits, 16);
  const changed = { ...a, matrixHash: "wrong" };
  await assert.rejects(
    () => executeBatch(batch, changed, binding, opts),
    /付费批准/,
  );
  assert.equal(keys, 1);
});

test("R3：L0基线、L2理由及L3风险不能虚报", () => {
  const v = new PlanValidator();
  const p = JSON.parse(
    readFileSync(
      "resources/real-speech-v2/examples/plan-l0-baseline.json",
      "utf8",
    ),
  );
  v.validate(p);
  assert.equal(
    controlAssessment(p.windows[0], v.profile.productPolicy.productionRules)
      .controlComplexity,
    "L0",
  );
  assert.deepEqual(v.pending(p.windows[0]), []);
  const x = fixture();
  x.windows[1].controlReason = "";
  assert.throws(() => v.validate(x), /明确理由/);
  const y = fixture();
  y.windows[0].execution.pitch = 1.1;
  assert.throws(() => v.validate(y), /controlComplexity/);
  Object.assign(y.windows[0], {
    controlComplexity: "L3",
    naturalnessRisk: "HIGH",
    experimental: false,
  });
  assert.throws(() => v.validate(y), /experimental/);
  y.windows[0].experimental = true;
  v.validate(y);
});

test("R3：短指令建议与官方100分离，纠音用途不可冒充销售表演", () => {
  const v = new PlanValidator(),
    p = fixture();
  p.windows[0].execution.instruction = "慢".repeat(11);
  assert.throws(() => v.validate(p), /L3/);
  Object.assign(p.windows[0], {
    controlComplexity: "L3",
    naturalnessRisk: "HIGH",
    experimental: true,
  });
  v.validate(p);
  p.windows[0].execution.instruction = "慢".repeat(51);
  assert.throws(() => v.validate(p), /100/);
  const wrong = fixture();
  wrong.windows[1].ssml.nodes[0].purpose = "SALES_CLIMAX";
  assert.throws(() => v.validate(wrong), /constant/);
});

test("R3：每个候选示例可校验，单speak默认参数不误算多speak", () => {
  const v = new PlanValidator();
  for (const file of [
    "plan.json",
    "plan-with-sub-candidate.json",
    "plan-with-speak-candidates.json",
    "plan-with-optional-audit.json",
    "plan-l0-baseline.json",
  ])
    v.validate(
      JSON.parse(
        readFileSync("resources/real-speech-v2/examples/" + file, "utf8"),
      ),
    );
  const p = fixture(),
    w = p.windows[0];
  w.execution.instruction = "";
  w.instructionIntentCount = 0;
  w.ssml.enabled = true;
  w.ssml.speakSegments = [
    {
      segmentId: "ONE",
      start: 0,
      end: [...w.synthesisText].length,
      rate: 1,
      pitch: 1,
      volume: 50,
    },
  ];
  w.controlComplexity = "L1";
  v.validate(p);
  assert.deepEqual(v.pending(w), []);
});

test("R3：实验Plan不能替代本地用户批准，批准绑定具体配置", async () => {
  const s = new RealSpeechV2Service(
    mkdtempSync(join(tmpdir(), "ctg-r3-experiment-")),
  );
  const p = JSON.parse(
    readFileSync(
      "resources/real-speech-v2/examples/plan-with-speak-candidates.json",
      "utf8",
    ),
  );
  const input = {
    name: "明确实验",
    voiceRef: "TEST-CLONE",
    text: JSON.stringify(p),
    confirmed: true,
  };
  assert.throws(() => s.importPlan(input), /用户/);
  const t = s.importPlan({ ...input, experimentalConfirmed: true });
  const id = p.windows.find((w: any) => w.experimental).windowId;
  assert.ok(t.experimentalApproval.windows.some((w: any) => w.windowId === id));
  t.experimentalApproval = null;
  s.save(t);
  const j = s.createJob({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    windowIds: [id],
  });
  let calls = 0;
  const out = await s.runJob(j.jobId, async (body, path) => {
    calls++;
    return fake(body, path);
  });
  assert.equal(calls, 0);
  assert.equal(
    out.task.windows.find((w: any) => w.windowId === id).attempts.length,
    0,
  );
  assert.match(out.job.error, /本地用户批准/);
  s.close();
});

test("R3：Patch一个主要变量，SSML嵌套两种修改同样拒绝", () => {
  const { s, task } = setup();
  const p = patchFor(s, task, { instruction: "平静确定。", seed: 1234 });
  assert.throws(
    () => s.previewPatch({ taskId: task.taskId, text: JSON.stringify(p) }),
    /ONE_PRIMARY_VARIABLE/,
  );
  const w = task.plan.windows[1],
    after = structuredClone(w);
  after.ssml.nodes.push({
    kind: "break",
    offset: 0,
    timeMs: 100,
    purpose: "SEMANTIC_PAUSE",
  });
  after.ssml.nodes[0].interpretAs = "digits";
  assert.deepEqual(primaryVariableDiff(w, after), ["break", "sayAs"]);
  const q = patchFor(s, task, { ssml: after.ssml });
  assert.throws(
    () => s.previewPatch({ taskId: task.taskId, text: JSON.stringify(q) }),
    /ONE_PRIMARY_VARIABLE/,
  );
  const legal = patchFor(s, task, { instruction: "平静确定。" });
  assert.deepEqual(
    s.previewPatch({ taskId: task.taskId, text: JSON.stringify(legal) })
      .primaryVariables,
    ["instruction"],
  );
  s.close();
});

test("R3：发音完成度仅展示，不变更请求；原2.0不可静默升级", () => {
  const v = new PlanValidator(),
    p = fixture();
  const before = buildRequest(p.engine.model, "clone", p.windows[0]);
  p.intentRanges[0].pronunciationCompletenessIntent =
    "轻读、带过，不要每字读满；偷偷改pitch也只能展示";
  v.validate(p);
  assert.deepEqual(buildRequest(p.engine.model, "clone", p.windows[0]), before);
  assert.throws(
    () =>
      v.validate(
        JSON.parse(
          readFileSync(
            "docs/real-speech-v2-design-r2/examples/plan.json",
            "utf8",
          ),
        ),
      ),
    /constant/,
  );
});

test("R3：局部rate和pitch不能藏在同一个ssml对象绕过隔离", () => {
  const p = JSON.parse(
    readFileSync(
      "resources/real-speech-v2/examples/plan-with-speak-candidates.json",
      "utf8",
    ),
  );
  const w = p.windows[0],
    next = structuredClone(w);
  next.ssml.speakSegments[0].rate = 0.8;
  next.ssml.speakSegments[0].pitch = 1.1;
  assert.deepEqual(primaryVariableDiff(w, next).sort(), [
    "localPitch",
    "localRate",
  ]);
  const s = new RealSpeechV2Service(
    mkdtempSync(join(tmpdir(), "ctg-r3-local-patch-")),
  );
  const t = s.importPlan({
    name: "实验隔离",
    voiceRef: "TEST-CLONE",
    text: JSON.stringify(p),
    confirmed: true,
    experimentalConfirmed: true,
  });
  const patch = patchFor(s, t, { ssml: next.ssml });
  patch.targetWindowIds = ["GW001"];
  patch.changes[0].windowId = "GW001";
  patch.expectedVersions = [
    {
      windowId: "GW001",
      configRevision: 1,
      selectedVersionId: null,
      selectedVersionHash: null,
    },
  ];
  patch.changes[0].executionConfidence = w.executionConfidence;
  assert.throws(
    () => s.previewPatch({ taskId: t.taskId, text: JSON.stringify(patch) }),
    /ONE_PRIMARY_VARIABLE/,
  );
  s.close();
});

test("R3：运行文档、Profile、Schema及词典镜像一致", () => {
  const source = "resources/real-speech-v2/",
    review = "docs/real-speech-v2-production-r3/";
  for (const name of [
    "COSYVOICE_CAPABILITY_PROFILE.v1.json",
    "schemas/common.schema.json",
    "schemas/REAL_SPEECH_EXECUTION_PLAN_V2.schema.json",
    "schemas/REAL_SPEECH_EXECUTION_PATCH_V2.schema.json",
    ...[
      "manual",
      "director",
      "template",
      "compiler",
      "capability",
      "diagnosis",
    ].map((n) => "docs/" + n + ".md"),
  ])
    assert.equal(
      readFileSync(source + name, "utf8"),
      readFileSync(review + name, "utf8"),
      name,
    );
  const dictionary = JSON.parse(
    readFileSync(review + "director-dictionary.json", "utf8"),
  );
  assert.equal(dictionary.entries.length, 36);
  for (const entry of dictionary.entries)
    for (const key of "ABCDEFG") assert.ok(entry[key].trim());
  const manifest = JSON.parse(
    readFileSync(review + "evidence/batch1-record-manifest.json", "utf8"),
  );
  assert.equal(manifest.cases.length, 16);
  assert.equal(
    manifest.cases.find((c: any) => c.caseId === "04").status,
    "LOCAL_BLOCKED_NOT_SENT",
  );
});

test("R3：实验Patch批准仅限目标Window，不能顺带批准其他配置", () => {
  const s = new RealSpeechV2Service(
    mkdtempSync(join(tmpdir(), "ctg-r3-scope-")),
  );
  const p = JSON.parse(
    readFileSync(
      "resources/real-speech-v2/examples/plan-with-speak-candidates.json",
      "utf8",
    ),
  );
  Object.assign(p.windows[1], {
    experimental: true,
    controlComplexity: "L3",
    naturalnessRisk: "HIGH",
    controlReason: "明确参数实验",
  });
  p.windows[1].execution.rate = 1.1;
  const t = s.importPlan({
    name: "实验范围",
    voiceRef: "TEST-CLONE",
    text: JSON.stringify(p),
    confirmed: true,
    experimentalConfirmed: true,
  });
  // A prior rollback may leave a different experimental config without valid approval.
  t.experimentalApproval.windows = t.experimentalApproval.windows.filter(
    (w: any) => w.windowId !== "GW001",
  );
  s.save(t);
  const patch = patchFor(s, t, { seed: 1234 });
  patch.changes[0].executionConfidence = t.plan.windows[1].executionConfidence;
  const text = JSON.stringify(patch),
    preview = s.previewPatch({ taskId: t.taskId, text });
  assert.throws(
    () =>
      s.applyPatch({
        taskId: t.taskId,
        text,
        previewHash: preview.previewHash,
        confirmed: true,
      }),
    /实验修复/,
  );
  const result = s.applyPatch({
    taskId: t.taskId,
    text,
    previewHash: preview.previewHash,
    confirmed: true,
    experimentalConfirmed: true,
  });
  assert.deepEqual(
    result.task.experimentalApproval.windows.map((w: any) => w.windowId),
    ["GW002"],
  );
  assert.deepEqual(result.task.plan.windows[0], t.plan.windows[0]);
  s.close();
});


test("v130 最小Plan原样导入，null hash不被补写，意图不进入请求", () => {
  const input = JSON.parse(readFileSync("resources/real-speech-v2/examples/PLAN-MINIMAL-001.json", "utf8"));
  const service = new RealSpeechV2Service(mkdtempSync(join(tmpdir(), "ctg-v130-minimal-")));
  try {
    const task = service.importPlan({ name: "最小导入验收", voiceRef: "offline-fixture", text: JSON.stringify(input), confirmed: true });
    assert.deepEqual(task.plan, input);
    assert.equal(task.planHash, planHash(input));
    assert.equal(task.windows[0].versions.length, 0);
    const altered = structuredClone(input);
    altered.intentRanges[0].humanIntent = "快十倍、升调、加停顿（仅展示测试）";
    assert.deepEqual(buildRequest(input.engine.model, "offline-fixture", input.windows[0]), buildRequest(altered.engine.model, "offline-fixture", altered.windows[0]));
    assert.equal(service.db.prepare("SELECT count(*) n FROM jobs").get()?.n, 0);
  } finally { service.db.close(); }
});
