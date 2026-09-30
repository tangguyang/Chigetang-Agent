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
      if (action === "realSpeech:document") return "使用手册 V5.0";
      if (action === "realSpeech:export") return task;
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
assert.ok(
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("生成本段／完整口播"),
  )?.disabled,
);
await click("一键导出给ChatGPT");
assert.ok(calls.includes("realSpeech:export"));
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
  "PASS 真人口播UI：创建页、任务选择、10题、试演Gate、导出、文档、DB错误隔离",
);
