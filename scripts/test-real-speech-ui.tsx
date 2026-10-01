import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Page from "../src/features/realSpeech/Page.tsx";
const plan = JSON.parse(
  readFileSync("resources/real-speech-v2/examples/plan.json", "utf8"),
);
plan.intentRanges[0].pronunciationCompletenessIntent =
  "轻读与自然带过，不改变正确读法";
let previewPlan = plan;
let task: any = {
  taskId: "ui-task",
  name: "V2界面任务",
  voiceRef: "VOICE",
  taskRevision: 1,
  plan,
  planHash: "hash",
  windows: plan.windows.map((w: any) => ({
    windowId: w.windowId,
    configRevision: 1,
    locked: false,
    versions: [],
    attempts: [],
    selectedVersionId: null,
  })),
  anchorReviews: [],
  finals: [],
  goldens: [],
  feedback: [],
};
task.windows[0].versions = [
  { versionId: "ui-v1", versionNumber: 1, at: "2026-10-01T00:00:00Z" },
  { versionId: "ui-v2", versionNumber: 2, at: "2026-10-01T00:01:00Z" },
];
task.windows[0].selectedVersionId = "ui-v1";
let calls: any[] = [];
let fail = false;
Object.assign(window, {
  aiVideo: {
    invoke: async (action: string, p: any) => {
      calls.push({ action, p });
      if (fail) throw Error("V2数据库测试错误");
      switch (action.replace("realSpeech:v2:", "")) {
        case "list":
          return {
            tasks: [task],
            voices: [{ id: "VOICE", name: "测试复刻音色" }],
            legacy: [
              {
                taskId: "OLD",
                name: "旧任务只读",
                originalText: "保留原稿",
                windows: [],
              },
            ],
          };
        case "get":
          return structuredClone(task);
        case "document":
          return true;
        case "preview":
          return {
            plan: previewPlan,
            planHash: "hash",
            pending: plan.windows.map((w: any) => ({
              windowId: w.windowId,
              capabilities: ["instruction"],
            })),
          };
        case "import":
          assert.equal(p.confirmed, true);
          if (previewPlan.windows.some((w: any) => w.experimental))
            assert.equal(p.experimentalConfirmed, true);
          return structuredClone(task);
        case "mutate": {
          const w = task.windows.find((w: any) => w.windowId === p.windowId);
          if (p.type === "select" || p.type === "rollback")
            w.selectedVersionId = p.versionId;
          task.taskRevision++;
          return structuredClone(task);
        }
        case "generate":
          return {
            task,
            job: {
              status: "blocked_pending_spike",
              error: "等待Capability Spike验证",
            },
          };
        case "patchPreview":
          return {
            patch: { targetWindowIds: ["GW002"] },
            diff: [{ field: "instruction", before: "旧", after: "新" }],
            generateIds: ["GW002"],
            previewHash: "preview",
            primaryVariables: ["instruction"],
            experimentalRequired: true,
          };
        case "patchApply":
          assert.equal(p.confirmed, true);
          assert.equal(p.experimentalConfirmed, true);
          return {
            task,
            job: {
              status: "blocked_pending_spike",
              error: "等待Capability Spike验证",
            },
          };
        case "export":
          return { path: "offline.zip" };
        default:
          throw Error("unexpected " + action);
      }
    },
    onChange: () => () => {},
  },
});
const root = createRoot(document.getElementById("root")!);
const click = async (text: string, scope: ParentNode = document) => {
  const b = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;
  assert.ok(b, text);
  assert.equal(b.disabled, false, text);
  await act(async () => b.click());
};
const change = async (
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) => {
  const proto =
    el.tagName === "SELECT"
      ? window.HTMLSelectElement.prototype
      : el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(
      new window.Event(el.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
};
await act(async () => root.render(<Page />));
assert.ok(!document.body.textContent?.includes("阶段一"));
assert.ok(!document.querySelector("[role=dialog]"));
await click("使用手册");
assert.equal(
  calls.find((c) => c.action === "realSpeech:v2:document")?.action,
  "realSpeech:v2:document",
);
assert.ok(!document.querySelector("[role=dialog]"));
await change(
  document.querySelector(".rs-v2-import textarea")!,
  JSON.stringify(plan),
);
await click("导入并校验方案");
assert.ok(document.body.textContent?.includes("无需另上传"));
const save = [...document.querySelectorAll("button")].find(
  (b) => b.textContent === "保存执行方案",
)!;
assert.equal(save.disabled, true);
await change(document.querySelector(".rs-v2-import select")!, "VOICE");
const confirm = document.querySelector(
  ".rs-v2-import input[type=checkbox]",
) as HTMLInputElement;
await act(async () => confirm.click());
await click("保存执行方案");
assert.equal(document.querySelectorAll(".rs-v2-window").length, 3);
assert.ok(document.body.textContent?.includes("导演意图（只读）"));
assert.ok(
  document.body.textContent?.includes("发音完成度 / 口语粗糙度（E2，仅展示）"),
);
await click("生成新音频版本", document.querySelector(".rs-v2-window")!);
assert.ok(document.body.textContent?.includes("等待Capability Spike验证"));
assert.deepEqual(
  calls.find((c) => c.action.endsWith(":generate")).p.windowIds,
  ["GW001"],
);
const card = document.querySelectorAll(".rs-v2-window")[1];
await change(
  card.querySelector("textarea")!,
  '{"schema":"REAL_SPEECH_EXECUTION_PATCH_V2"}',
);
await click("导入修复并查看Diff", card);
assert.ok(card.textContent?.includes("instruction"));
const apply = [...card.querySelectorAll("button")].find(
  (b) => b.textContent === "应用并生成新版本",
)!;
assert.equal(apply.disabled, true);
await act(async () =>
  (
    card.querySelectorAll("input[type=checkbox]")[1] as HTMLInputElement
  ).click(),
);
assert.equal(apply.disabled, true, "普通Diff确认不能替代实验确认");
await act(async () =>
  (
    card.querySelectorAll("input[type=checkbox]")[2] as HTMLInputElement
  ).click(),
);
await click("应用并生成新版本", card);
assert.equal(
  calls.find((c) => c.action.endsWith(":patchApply")).p.windowId,
  "GW002",
);
assert.ok(
  document.querySelector(".rs-v2-version")?.textContent?.startsWith("V2"),
);
await click("选择当前版本", document.querySelector(".rs-v2-version")!);
assert.equal(task.windows[0].selectedVersionId, "ui-v2");
await click(
  "回滚配置与音频至V1",
  document.querySelectorAll(".rs-v2-version")[1],
);
assert.equal(task.windows[0].selectedVersionId, "ui-v1");
await click("导出单Window诊断", document.querySelector(".rs-v2-window")!);
assert.deepEqual(calls.find((c) => c.action.endsWith(":export")).p.windowIds, [
  "GW001",
]);
await click("选择全篇");
await click("生成所选Window（3）");
assert.deepEqual(
  calls.filter((c) => c.action.endsWith(":generate")).at(-1).p.windowIds,
  ["GW001", "GW002", "GW003"],
);
await click("旧v1.2.9任务（只读）");
await click("旧任务只读");
assert.ok(document.body.textContent?.includes("旧数据库和原始音频保留"));
previewPlan = JSON.parse(
  readFileSync(
    "resources/real-speech-v2/examples/plan-with-speak-candidates.json",
    "utf8",
  ),
);
await change(
  document.querySelector(".rs-v2-import textarea")!,
  JSON.stringify(previewPlan),
);
await click("导入并校验方案");
const experimentSave = [...document.querySelectorAll("button")].find(
  (b) => b.textContent === "保存执行方案",
)!;
const importChecks = document.querySelectorAll<HTMLInputElement>(
  ".rs-v2-import input[type=checkbox]",
);
assert.equal(importChecks.length, 2);
await act(async () => importChecks[0].click());
assert.equal(experimentSave.disabled, true, "普通导演确认不等于实验开启");
await act(async () => importChecks[1].click());
assert.equal(experimentSave.disabled, false);
await click("保存执行方案");
await act(async () => root.unmount());
fail = true;
const second = createRoot(document.getElementById("root")!);
await act(async () => second.render(<Page />));
assert.ok(
  document
    .querySelector("[role=alert]")
    ?.textContent?.includes("V2数据库测试错误"),
);
await act(async () => second.unmount());
console.log(
  "PASS V2 UI：首页导入确认、只读意图、多Window、单段/多段框架、Patch Diff确认、诊断、独立文档调用、旧任务只读、错误隔离",
);
