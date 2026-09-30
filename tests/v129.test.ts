import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  instructionCount,
  checkInstruction,
  parsePlan,
  validateContext,
  units,
  canonical,
  type Obj,
} from "../src/features/realSpeech/domain.ts";
import { RealSpeechService, hash } from "../src/main/realSpeech/service.ts";
const root = () => mkdtempSync(join(tmpdir(), "口播测试-"));
const examples = [
  ...readFileSync("docs/ChatGPT_真人口播返回协议_V1.2.md", "utf8").matchAll(
    /```json\s*([\s\S]*?)```/g,
  ),
]
  .filter((m) => m[1].trim().startsWith("{"))
  .map((m) => JSON.parse(m[1]));
const director = (t: Obj) => ({
  ...structuredClone(examples[1]),
  taskId: t.taskId,
  taskRevision: t.taskRevision,
  exportId: t.exportId,
  contextHash: t.contextHash,
  generationWindows: [
    {
      ...examples[1].generationWindows[0],
      unitIds: t.units.map((u: Obj) => u.id),
    },
  ],
});
function fixture() {
  const s = new RealSpeechService(root());
  const t = s.newTask({
    originalText: "第一句。第二句。",
    voiceRef: "voice-ref",
  });
  t.exportId = "EXP-001";
  t.contextHash = hash(t);
  s.save(t);
  return { s, t };
}
function execution(t: Obj, action = "NO_CHANGE") {
  return {
    ...structuredClone(examples[2]),
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    exportId: t.exportId,
    contextHash: t.contextHash,
    action,
    targets: { windowIds: [], unitIds: [] },
    changes: [],
    repair: { mode: "NONE", windowIds: [], unitIds: [] },
    regenerate: false,
    reconcat: false,
  };
}
for (const [name, value, han, weighted, valid] of [
  ["40汉字", "汉".repeat(40), 40, 80, true],
  ["41汉字", "汉".repeat(41), 41, 82, false],
  ["50汉字", "汉".repeat(50), 50, 100, false],
  ["39汉字标点", "汉".repeat(39) + "，。", 39, 80, true],
  ["40汉字非汉超限", "汉".repeat(40) + "a".repeat(21), 40, 101, false],
  ["英文数字空格", "a1 ", 0, 3, true],
  ["emoji", "😀", 0, 1, true],
  ["Han扩展", "𠀀", 1, 2, true],
] as const)
  test("Instruction " + name, () => {
    assert.deepEqual(instructionCount(value), {
      hanCount: han,
      weightedCount: weighted,
      valid,
    });
    if (!valid) assert.throws(() => checkInstruction(value));
  });
test("严格Director与Execution示例", () => {
  const { s, t } = fixture();
  validateContext(director(t), t);
  validateContext(execution(t), t);
  assert.equal(
    parsePlan("说明\n```json\n" + JSON.stringify(director(t)) + "\n```").planId,
    "director-case1-r1",
  );
  s.close();
});
for (const [key, value] of [
  ["taskId", "other"],
  ["taskRevision", 0],
  ["exportId", "old"],
  ["contextHash", "bad"],
  ["apiKey", "secret"],
] as const)
  test("拒绝旧/危险字段 " + key, () => {
    const { s, t } = fixture();
    assert.throws(() => validateContext({ ...director(t), [key]: value }, t));
    s.close();
  });
test("拒绝多协议、语法错、未知schema、嵌套未知字段、过长指令、未知Unit/Beat", () => {
  const { s, t } = fixture();
  const p = director(t),
    j = JSON.stringify(p);
  assert.throws(() =>
    parsePlan("```json\n" + j + "\n```\n```json\n" + j + "\n```"),
  );
  assert.throws(() => parsePlan(j.slice(0, -1)));
  assert.throws(() => parsePlan("{}"));
  for (const mutate of [
    (p: Obj) => (p.speakerProfile.sql = "DELETE"),
    (p: Obj) => (p.generationWindows[0].instruction = "汉".repeat(41)),
    (p: Obj) => (p.generationWindows[0].unitIds = ["U999"]),
    (p: Obj) => (p.generationWindows[0].beatIds = ["B999"]),
  ]) {
    const q = structuredClone(p);
    mutate(q);
    assert.throws(() => validateContext(q, t));
  }
  s.close();
});
test("重复planId/planHash，事务不改变原稿", () => {
  const { s, t } = fixture();
  const p = director(t);
  s.apply({ taskId: t.taskId, text: JSON.stringify(p) });
  const latest = s.get(t.taskId);
  assert.equal(latest.originalText, t.originalText);
  latest.taskRevision = t.taskRevision;
  s.save(latest);
  assert.throws(
    () => s.apply({ taskId: t.taskId, text: JSON.stringify(p) }),
    /已应用/,
  );
  s.db.prepare("UPDATE plans SET id=?").run("another");
  assert.throws(
    () => s.apply({ taskId: t.taskId, text: JSON.stringify(p) }),
    /已应用/,
  );
  s.close();
});
test("未知Window、越权、参数类型、NO_CHANGE和RECONCAT_ONLY", () => {
  const { s, t } = fixture();
  let p = execution(t);
  validateContext(p, t);
  p = execution(t, "RECONCAT_ONLY");
  p.reconcat = true;
  validateContext(p, t);
  p.targets.windowIds = ["GW999"];
  assert.throws(() => validateContext(p, t));
  p = execution(t, "UPDATE_ONLY");
  p.changes = [
    { scope: "WINDOW", targetId: "GW001", field: "voiceId", value: "remote" },
  ];
  assert.throws(() => validateContext(p, t));
  p.changes = [
    { scope: "WINDOW", targetId: "GW001", field: "rate", value: "1" },
  ];
  assert.throws(() => validateContext(p, t));
  s.close();
});
test("双击只请求一次，confirmed不可覆盖，快照与新revision", async () => {
  const { s, t } = fixture();
  t.rehearsalPassed = true;
  s.save(t);
  let calls = 0;
  let finish!: () => void;
  const gate = new Promise<void>((r) => (finish = r));
  const first = s.generate(
    { taskId: t.taskId, taskRevision: 1, windowId: "GW001" },
    async (_snap, path) => {
      calls++;
      await gate;
      writeFileSync(path, "first");
      return { duration: 10 };
    },
  );
  await assert.rejects(
    s.generate(
      {
        taskId: t.taskId,
        taskRevision: s.get(t.taskId).taskRevision,
        windowId: "GW001",
      },
      async () => {
        calls++;
        return {};
      },
    ),
  );
  finish();
  let next = await first;
  assert.equal(calls, 1);
  next = s.feedback({
    taskId: t.taskId,
    taskRevision: next.taskRevision,
    type: "confirm",
    windowId: "GW001",
  });
  const old = next.windows[0].results[0].path;
  next = await s.generate(
    { taskId: t.taskId, taskRevision: next.taskRevision, windowId: "GW001" },
    async (_snap, path) => {
      writeFileSync(path, "second");
      return { duration: 10 };
    },
  );
  assert.equal(readFileSync(old, "utf8"), "first");
  assert.notEqual(next.windows[0].results[1].path, old);
  assert.equal(next.windows[0].results[1].revision, 2);
  s.close();
});
test("ambiguous timeout不重试且unknown_result不可自动再发", async () => {
  const { s, t } = fixture();
  t.rehearsalPassed = true;
  s.save(t);
  let calls = 0;
  await assert.rejects(
    s.generate(
      { taskId: t.taskId, taskRevision: 1, windowId: "GW001" },
      async () => {
        calls++;
        throw Object.assign(Error("timeout"), { code: "SubmissionUnknown" });
      },
    ),
  );
  const next = s.get(t.taskId);
  assert.equal(next.windows[0].status, "unknown_result");
  await assert.rejects(
    s.generate(
      { taskId: t.taskId, taskRevision: next.taskRevision, windowId: "GW001" },
      async () => {
        calls++;
        return {};
      },
    ),
  );
  assert.equal(calls, 1);
  s.close();
});
test("崩溃恢复generating→interrupted，unknown_result保留", () => {
  const base = root();
  let s = new RealSpeechService(base);
  const t = s.newTask({ originalText: "第一句。第二句。" });
  t.windows[0].status = "generating";
  t.rehearsal = { status: "unknown_result" };
  s.save(t);
  s.close();
  s = new RealSpeechService(base);
  const next = s.get(t.taskId);
  assert.equal(next.windows[0].status, "interrupted");
  assert.equal(next.rehearsal.status, "unknown_result");
  s.close();
});
test("独立DB损坏不会修改旧库", () => {
  const base = root(),
    old = join(base, "old.db");
  writeFileSync(old, "original");
  mkdirSync(join(base, "real-speech"));
  writeFileSync(join(base, "real-speech", "real_speech.db"), "broken");
  assert.throws(() => new RealSpeechService(base));
  assert.equal(readFileSync(old, "utf8"), "original");
});
test("数据库事务rollback", () => {
  const { s, t } = fixture();
  assert.throws(() =>
    s.tx(() => {
      s.db.prepare("DELETE FROM tasks").run();
      throw Error("fail");
    }),
  );
  assert.equal(s.get(t.taskId).originalText, t.originalText);
  s.close();
});
test("Unit稳定、纯文本长度和dangerous XML拦截", () => {
  assert.deepEqual(units("一句。二句！"), units("一句。二句！"));
  const { s, t } = fixture();
  const p = execution(t, "UPDATE_ONLY");
  p.changes = [
    {
      scope: "WINDOW",
      targetId: "GW001",
      field: "synthesisText",
      value: "<script>bad</script>",
    },
  ];
  assert.throws(() => validateContext(p, t));
  s.close();
});
test("三篇真实台词协议E2E（模拟TTS；不代表真人听感）", async () => {
  const source = readFileSync("docs/新版三段置顶短视频.txt", "utf8");
  const cases = source
    .split(/置顶[一二三]｜[^\r\n]+/)
    .slice(1)
    .map((s) => s.trim());
  assert.equal(cases.length, 3);
  for (const text of cases) {
    const s = new RealSpeechService(root()),
      t = s.newTask({ originalText: text });
    t.exportId = "EXP-001";
    t.contextHash = hash(t);
    s.save(t);
    const p = director(t);
    p.performanceArc[0].unitIds = t.units.slice(0, 2).map((u: Obj) => u.id);
    p.performanceBeats[0].unitIds = t.units.map((u: Obj) => u.id);
    p.rehearsal.unitIds = t.units.slice(0, 2).map((u: Obj) => u.id);
    let next = s.apply({ taskId: t.taskId, text: JSON.stringify(p) });
    next = await s.generate(
      { taskId: t.taskId, taskRevision: next.taskRevision, rehearsal: true },
      async (_s, path) => {
        writeFileSync(path, "simulation");
        return { duration: 10 };
      },
    );
    next = s.feedback({
      taskId: t.taskId,
      taskRevision: next.taskRevision,
      type: "rehearsal",
      data: true,
    });
    next = await s.generate(
      { taskId: t.taskId, taskRevision: next.taskRevision, windowId: "GW001" },
      async (snapshot, path) => {
        assert.equal(snapshot.text, text);
        checkInstruction(snapshot.instruction);
        writeFileSync(path, "simulation");
        return { duration: 60 };
      },
    );
    assert.equal(next.windows[0].status, "generated");
    s.close();
  }
});

test("JOINT_REPAIR必须相邻，合并后方案事务执行，三轮停止", () => {
  const { s, t } = fixture();
  t.windows = [s.window("GW001", ["U001"]), s.window("GW002", ["U002"])];
  s.save(t);
  let p = execution(t, "JOINT_REPAIR");
  p.regenerate = true;
  p.reconcat = true;
  p.targets = { windowIds: ["GW001", "GW002"], unitIds: ["U001", "U002"] };
  p.repair = {
    mode: "BOUNDARY_JOINT",
    windowIds: ["GW001", "GW002"],
    unitIds: ["U001", "U002"],
  };
  validateContext(p, t);
  const next = s.apply({ taskId: t.taskId, text: JSON.stringify(p) });
  assert.equal(next.windows.length, 1);
  assert.deepEqual(next.windows[0].unitIds, ["U001", "U002"]);
  assert.equal(next.archives.at(-1).windows.length, 2);
  next.exportId = "EXP-next";
  next.contextHash = hash(next);
  next.qc = [{ problem: "像念稿" }];
  next.history = Array.from({ length: 3 }, () => ({
    issue: "像念稿",
    windowIds: ["GW001"],
  }));
  s.save(next);
  p = execution(next, "REGENERATE_WINDOW");
  p.planId = "stop-round-four";
  p.regenerate = true;
  p.targets.windowIds = ["GW001"];
  assert.throws(
    () => s.apply({ taskId: t.taskId, text: JSON.stringify(p) }),
    /三轮/,
  );
  assert.equal(s.get(t.taskId).taskRevision, next.taskRevision);
  s.close();
});
test("手动超限在提交前拦截，原稿更新使旧方案失效，试演未知不补发", async () => {
  const { s, t } = fixture();
  assert.throws(() =>
    s.update({
      taskId: t.taskId,
      taskRevision: 1,
      window: { windowId: "GW001", instruction: "汉".repeat(41) },
    }),
  );
  const p = director(t);
  let next = s.update({
    taskId: t.taskId,
    taskRevision: 1,
    originalText: "新原稿。",
  });
  assert.throws(() => s.preview({ taskId: t.taskId, text: JSON.stringify(p) }));
  next.rehearsal = { status: "unknown_result", results: [] };
  s.save(next);
  let calls = 0;
  await assert.rejects(
    s.generate(
      { taskId: t.taskId, taskRevision: next.taskRevision, rehearsal: true },
      async () => {
        calls++;
        return {};
      },
    ),
  );
  assert.equal(calls, 0);
  s.close();
});

test('已应用修复只执行一次，成功后消耗pendingAction并记录After',async()=>{const {s,t}=fixture();t.rehearsalPassed=true;s.save(t);const p=execution(t,'REGENERATE_WINDOW');p.planId='repair-once';p.regenerate=true;p.targets.windowIds=['GW001'];let next=s.apply({taskId:t.taskId,text:JSON.stringify(p)});next=await s.generate({taskId:t.taskId,taskRevision:next.taskRevision,windowId:'GW001'},async(_snap,path)=>{writeFileSync(path,'mock');return{duration:10};});assert.equal(next.pendingAction,null);assert.ok(next.history.at(-1).afterResults.GW001.id);s.close();});
