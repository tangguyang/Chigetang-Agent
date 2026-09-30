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

test("修复2：阶段二 REAL_SPEECH_PERFORMANCE_PLAN_V1 可直接导入无需旧导出上下文", () => {
  const { s, t } = fixture();
  const plan = {
    schema: "REAL_SPEECH_PERFORMANCE_PLAN_V1",
    protocolVersion: "1.0",
    targetModel: "cosyvoice-v3.5-plus",
    planId: "repair2-import-001",
    sourceText: t.originalText,
    globalDirection: "真人面对镜头，先自然说清，再逐步推动成交。",
    phrases: [
      { phraseId: "P001", text: "第一句。", salesAction: "强钩子", direction: "直接开场，短促有力", pace: "FAST", energy: "HIGH", emphasis: ["第一句"], pauseAfter: "SHORT" },
      { phraseId: "P002", text: "第二句。", salesAction: "解释", direction: "回落到自然聊天", pace: "NORMAL", energy: "MEDIUM", emphasis: [], pauseAfter: "SHORT" },
      { phraseId: "P003", text: "第三句。", salesAction: "收口", direction: "肯定落点，不喊", pace: "NORMAL", energy: "MEDIUM", emphasis: ["第三句"], pauseAfter: "NONE" },
    ],
    windows: [
      { windowId: "GW001", phraseIds: ["P001", "P002"], instruction: "真人对镜头，开头有力，随后自然聊天。", rate: 1.08, pitch: 1, volume: 50, seed: 0, transitionPauseMs: 120, pronunciation: [], rhythmBreaks: [{ afterPhraseId: "P001", pauseMs: 180 }] },
      { windowId: "GW002", phraseIds: ["P003"], instruction: "自然肯定收口，不喊卖，重点清楚。", rate: 1, pitch: 1, volume: 50, seed: 0, transitionPauseMs: 0, pronunciation: [], rhythmBreaks: [] },
    ],
    missingInputs: [],
  };
  const preview = s.preview({ taskId: t.taskId, text: JSON.stringify(plan) });
  assert.equal(preview.plan.schema, "REAL_SPEECH_PERFORMANCE_PLAN_V1");
  const next = s.apply({ taskId: t.taskId, text: JSON.stringify(plan) });
  assert.deepEqual(next.units.map((u: any) => u.phraseId), ["P001", "P002", "P003"]);
  assert.deepEqual(next.windows.map((w: any) => w.unitIds), [["U001", "U002"], ["U003"]]);
  assert.equal(next.windows[0].directorMeta.phrases[0].salesAction, "强钩子");
  assert.equal(next.windows[0].rhythmData[0].unitId, "U001");
  s.close();
});

test("修复2：阶段二导入必须逐字覆盖当前原稿且严格锁定模型能力", () => {
  const { s, t } = fixture();
  const base: any = {
    schema: "REAL_SPEECH_PERFORMANCE_PLAN_V1",
    protocolVersion: "1.0",
    targetModel: "cosyvoice-v3.5-plus",
    planId: "repair2-import-bad",
    sourceText: t.originalText,
    globalDirection: "自然表达",
    phrases: [
      { phraseId: "P001", text: t.originalText, salesAction: "解释", direction: "自然", pace: "NORMAL", energy: "MEDIUM", emphasis: [], pauseAfter: "NONE" },
    ],
    windows: [
      { windowId: "GW001", phraseIds: ["P001"], instruction: "自然面对镜头聊天。", rate: 1, pitch: 1, volume: 50, seed: 0, transitionPauseMs: 0, pronunciation: [], rhythmBreaks: [] },
    ],
    missingInputs: [],
  };
  const wrongText = structuredClone(base);
  wrongText.sourceText = "另一份原稿。";
  wrongText.phrases[0].text = "另一份原稿。";
  assert.throws(() => s.preview({ taskId: t.taskId, text: JSON.stringify(wrongText) }), /原稿/);
  const tooLong = structuredClone(base);
  tooLong.windows[0].instruction = "汉".repeat(41);
  assert.throws(() => s.preview({ taskId: t.taskId, text: JSON.stringify(tooLong) }), /超限/);
  const wrongModel = structuredClone(base);
  wrongModel.targetModel = "other-model";
  assert.throws(() => s.preview({ taskId: t.taskId, text: JSON.stringify(wrongModel) }), /CosyVoice/);
  s.close();
});


test("修复2：Phrase导演标注可人工修改保存且不强制重生成", () => {
  const { s, t } = fixture();
  const plan: any = {
    schema: "REAL_SPEECH_PERFORMANCE_PLAN_V1",
    protocolVersion: "1.0",
    targetModel: "cosyvoice-v3.5-plus",
    planId: "repair2-phrase-edit",
    sourceText: t.originalText,
    globalDirection: "真人面对镜头自然表达",
    phrases: [
      { phraseId: "P001", text: "第一句。", salesAction: "钩子", direction: "直接说", pace: "FAST", energy: "HIGH", emphasis: ["第一句"], pauseAfter: "SHORT" },
      { phraseId: "P002", text: "第二句。第三句。", salesAction: "解释", direction: "自然聊", pace: "NORMAL", energy: "MEDIUM", emphasis: [], pauseAfter: "NONE" },
    ],
    windows: [
      { windowId: "GW001", phraseIds: ["P001", "P002"], instruction: "真人对镜头自然说，开头有力但不喊。", rate: 1, pitch: 1, volume: 50, seed: 0, transitionPauseMs: 0, pronunciation: [], rhythmBreaks: [] },
    ],
    missingInputs: [],
  };
  let next = s.apply({ taskId: t.taskId, text: JSON.stringify(plan) });
  const beforeStatus = next.windows[0].status;
  next = s.update({
    taskId: next.taskId,
    taskRevision: next.taskRevision,
    unit: {
      unitId: next.units[0].id,
      salesAction: "强反问钩子",
      direction: "像熟人一样反问，带一点调侃",
      pace: "FAST",
      energy: "HIGH",
      emphasis: ["第一句"],
      pauseAfter: "MEDIUM",
    },
  });
  assert.equal(next.units[0].salesAction, "强反问钩子");
  assert.equal(next.units[0].direction, "像熟人一样反问，带一点调侃");
  assert.equal(next.windows[0].directorMeta.phrases[0].pauseAfter, "MEDIUM");
  assert.equal(next.windows[0].status, beforeStatus, "只改导演标注不应误判为模型参数已变化");
  assert.throws(() => s.update({ taskId: next.taskId, taskRevision: next.taskRevision, unit: { unitId: next.units[0].id, pace: "SUPER_FAST" } }), /速度/);
  s.close();
});