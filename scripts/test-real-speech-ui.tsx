import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import Page from "../src/features/realSpeech/Page.tsx";
let fail = false,
  calls: string[] = [];
const task = {
  taskId: "RS-UI",
  taskRevision: 1,
  name: "UI口播",
  voiceRef: "V1",
  originalText: "第一句。",
  units: [{ id: "U001", text: "第一句。" }],
  description: "",
  history: [],
  qc: [],
  windows: [
    {
      windowId: "GW001",
      unitIds: ["U001"],
      instruction: "自然聊天",
      synthesisText: "",
      rhythmData: [],
      pronunciation: [],
      transitionPauseMs: 0,
      rate: 1,
      pitch: 1,
      volume: 50,
      seed: 0,
      status: "pending",
      results: [],
    },
  ],
};
Object.assign(window, {
  aiVideo: {
    invoke: async (action: string, p: any) => {
      calls.push(action);
      if (fail) throw Error("真人口播DB损坏");
      if (action === "realSpeech:list")
        return {
          tasks: [task],
          voices: [{ id: "V1", name: "参考音色", status: "ready" }],
        };
      if (action === "realSpeech:preview") throw Error("旧方案不匹配");
      if (action === "realSpeech:document") return "阶段一导演协议 / 使用手册";
      if (action === "realSpeech:export") return task;
      if (action === "realSpeech:copy") return true;
      throw Error("unexpected " + action);
    },
  },
});
const root = createRoot(document.getElementById("root")!);
await act(async () => {
  root.render(<Page />);
});
assert.ok(document.body.textContent?.includes("真人口播表演生产系统"));
const click = async (text: string) => {
  const button = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  assert.ok(button, text);
  await act(async () => button.click());
};
await click("UI口播");
assert.equal(document.querySelectorAll(".rs-question").length, 10);
const generateButton = [...document.querySelectorAll("button")].find((b) =>
  b.textContent?.includes("生成本段"),
);
assert.ok(generateButton, "应显示单段生成按钮");
assert.equal(generateButton.disabled, false, "首次生成不应被试演Gate锁死");
assert.ok(
  [...document.querySelectorAll("button")].some((b) =>
    b.textContent?.includes("保存并复制优化请求给 ChatGPT"),
  ),
  "诊断区应有就地复制给ChatGPT入口",
);

assert.ok(
  [...document.querySelectorAll("button")].some((b) =>
    b.textContent?.includes("问 ChatGPT 优化本段"),
  ),
  "每个生成窗口应有就地问ChatGPT入口",
);
await click("① 复制阶段一任务给 ChatGPT");
assert.ok(calls.includes("realSpeech:copy"), "阶段一应能一键复制原稿+导演协议");
const batchButton = [...document.querySelectorAll("button")].find((b) =>
  b.textContent?.includes("生成所有未生成（1）"),
);
assert.ok(batchButton, "应提供批量生成未生成片段");
assert.equal(batchButton.disabled, false, "有音色且无未保存修改时批量生成应可用");
const concatButton = [...document.querySelectorAll("button")].find((b) =>
  b.textContent?.includes("拼接 / 更新完整WAV"),
);
assert.ok(concatButton?.disabled, "未生成完不应允许拼接");
assert.ok(document.body.textContent?.includes("暂不能拼接：还有 1 段尚未生成到当前参数"));
await click("📄 使用手册");
assert.ok(document.querySelector("[role=dialog]"));
await click("关闭文档");
await act(async () => root.unmount());
fail = true;
const second = createRoot(document.getElementById("root")!);
await act(async () => second.render(<Page />));
assert.ok(
  document.querySelector("[role=alert]")?.textContent?.includes("DB损坏"),
);
await act(async () => second.unmount());
console.log(
  "PASS 真人口播UI：创建页、任务选择、阶段一复制、批量生成入口、单段生成无试演死锁、拼接禁用原因、诊断就地ChatGPT入口、文档、DB错误隔离",
);