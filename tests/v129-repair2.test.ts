import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealSpeechService } from "../src/main/realSpeech/service.ts";
import { checkInstruction, instructionCount } from "../src/features/realSpeech/domain.ts";

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "repair2-"));
  const s = new RealSpeechService(root);
  const t = s.newTask({
    originalText: "第一句。第二句。第三句。",
    voiceRef: "voice-ref",
  });
  return { s, t };
};

const fake = (label: string) => async (_snapshot: any, path: string) => {
  writeFileSync(path, label);
  return { duration: 6.5 };
};

test("修复2：首轮试演不再是正式窗口生成的全局Gate", async () => {
  const { s, t } = fixture();
  assert.equal(t.rehearsalPassed, false);
  const next = await s.generate(
    { taskId: t.taskId, taskRevision: t.taskRevision, windowId: "GW001" },
    fake("first"),
  );
  assert.equal(next.windows[0].status, "generated");
  assert.equal(next.windows[0].results.length, 1);
  s.close();
});

test("修复2：本段修改保存后可直接重生成且旧音频不覆盖", async () => {
  const { s, t } = fixture();
  let next = await s.generate(
    { taskId: t.taskId, taskRevision: t.taskRevision, windowId: "GW001" },
    fake("rev1"),
  );
  const old = next.windows[0].results[0].path;
  next = s.update({
    taskId: next.taskId,
    taskRevision: next.taskRevision,
    window: {
      windowId: "GW001",
      instruction: "更像真人面对镜头，直接一点，句尾收住。",
      rate: 1.1,
    },
  });
  assert.equal(next.windows[0].status, "dirty");
  next = await s.generate(
    { taskId: next.taskId, taskRevision: next.taskRevision, windowId: "GW001" },
    fake("rev2"),
  );
  assert.equal(next.windows[0].results.length, 2);
  assert.equal(next.windows[0].results[1].revision, 2);
  assert.notEqual(next.windows[0].results[1].path, old);
  assert.equal(readFileSync(old, "utf8"), "rev1");
  s.close();
});

test("修复2：修改一个窗口不会把人工生产流程锁死", async () => {
  const { s, t } = fixture();
  let next = s.update({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    manualGroups: [["U001"], ["U002"], ["U003"]],
  });
  next = await s.generate(
    { taskId: next.taskId, taskRevision: next.taskRevision, windowId: "GW001" },
    fake("one"),
  );
  next = s.update({
    taskId: next.taskId,
    taskRevision: next.taskRevision,
    window: { windowId: "GW002", pitch: 1.05 },
  });
  next = await s.generate(
    { taskId: next.taskId, taskRevision: next.taskRevision, windowId: "GW002" },
    fake("two"),
  );
  assert.equal(next.windows[0].results.length, 1);
  assert.equal(next.windows[1].results.length, 1);
  assert.equal(next.windows[2].results.length, 0);
  s.close();
});

test("修复2：Instruction双门槛继续严格执行", () => {
  assert.deepEqual(instructionCount("汉".repeat(40) + "，。"), {
    hanCount: 40,
    weightedCount: 82,
    valid: true,
  });
  assert.throws(() => checkInstruction("汉".repeat(41)), /超限/);
  assert.throws(() => checkInstruction("汉".repeat(40) + "a".repeat(21)), /超限/);
});


test("修复2：原稿局部修改保留未变化Unit与未受影响窗口结果", async () => {
  const { s, t } = fixture();
  let next = s.update({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    manualGroups: [["U001"], ["U002"], ["U003"]],
  });
  next = await s.generate(
    { taskId: next.taskId, taskRevision: next.taskRevision, windowId: "GW001" },
    fake("first-window"),
  );
  const firstPath = next.windows[0].results[0].path;
  next = await s.generate(
    { taskId: next.taskId, taskRevision: next.taskRevision, windowId: "GW003" },
    fake("third-window"),
  );
  const thirdPath = next.windows[2].results[0].path;
  next = s.update({
    taskId: next.taskId,
    taskRevision: next.taskRevision,
    originalText: "第一句。第二句改了。第三句。",
  });
  assert.deepEqual(next.units.map((u: any) => u.id), ["U001", "U004", "U003"]);
  assert.equal(next.windows[0].windowId, "GW001");
  assert.equal(next.windows[0].results[0].path, firstPath);
  assert.equal(next.windows[1].windowId, "GW002");
  assert.equal(next.windows[1].status, "dirty");
  assert.equal(next.windows[1].results.length, 0);
  assert.equal(next.windows[2].windowId, "GW003");
  assert.equal(next.windows[2].results[0].path, thirdPath);
  assert.equal(readFileSync(firstPath, "utf8"), "first-window");
  assert.equal(readFileSync(thirdPath, "utf8"), "third-window");
  s.close();
});