import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import Page from "../src/features/realSpeech/Page.tsx";
import { LibraryPage } from "../src/renderer/pages/Library.tsx";
import { ReplicaPage } from "../src/renderer/pages/Replica.tsx";
import { useApp } from "../src/renderer/store.ts";
Object.defineProperty(globalThis, "sessionStorage", {
  value: window.sessionStorage,
  configurable: true,
});
let calls: Array<{ action: string; p: any }> = [],
  task: any = null;
const invoke = async (action: string, p: any = {}) => {
  calls.push({ action, p });
  switch (action) {
    case "realSpeech:list":
      return {
        tasks: task ? [task] : [],
        voices: [{ id: "voice", name: "参考音色", status: "ready" }],
      };
    case "realSpeech:create":
      task = {
        taskId: "RS-UI-REPAIR",
        taskRevision: 1,
        ...p,
        description: "",
        units: [{ id: "U001", text: p.originalText }],
        windows: [
          {
            windowId: "GW001",
            unitIds: ["U001"],
            instruction: "自然",
            synthesisText: "",
            pronunciation: [],
            rhythmData: [],
            transitionPauseMs: 0,
            rate: 1,
            pitch: 1,
            volume: 50,
            seed: 0,
            status: "pending",
            results: [],
          },
        ],
        history: [],
        qc: [],
      };
      return task;
    case "realSpeech:update":
      task = { ...task, ...p, taskRevision: task.taskRevision + 1 };
      return task;
    case "realSpeech:export":
      return task;
    case "folders.list":
      return [];
    case "library.list":
      return {
        items: [
          {
            id: "T1",
            category: "task",
            name: "测试任务",
            kind: "video",
            status: "Queued",
            createdAt: "",
            module: "历史任务",
            ids: ["T1"],
            children: [
              { id: "T1", name: "测试任务", status: "Queued", outputs: [] },
            ],
          },
        ],
        total: 1,
      };
    case "replica.list":
      return [];
    case "replica.manual":
      return "# 使用手册\n## 操作步骤\n先导入任务包";
    case "tasks.list":
      return { items: [], total: 0 };
    default:
      throw Error("unexpected " + action);
  }
};
Object.assign(window, {
  aiVideo: { invoke, onChange: () => () => {}, onNavigate: () => () => {} },
});
const root = createRoot(document.getElementById("root")!);
const click = async (text: string) => {
  const b = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  assert.ok(b, text);
  await act(async () => b.click());
};
const change = async (
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) => {
  const proto =
    el instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};
useApp.setState({ assetKind: "video" });
await act(async () => root.render(<LibraryPage />));
await act(async () => {
  await new Promise((r) => setTimeout(r, 250));
});
assert.ok(document.body.textContent?.includes("测试任务"));
assert.ok(document.querySelector('[aria-label="来源"]'));
assert.equal(
  (document.querySelector('[aria-label="来源"]') as HTMLSelectElement).value,
  "tasks",
);
await act(async () => root.render(<ReplicaPage />));
const icons = [...document.querySelectorAll(".workbench-heading button")];
assert.equal(icons[0].getAttribute("aria-label"), "一键复刻使用手册");
await act(async () => (icons[0] as HTMLButtonElement).click());
assert.ok(document.querySelector("dialog[open]"));
assert.ok(document.body.textContent?.includes("操作步骤"));
await act(async () => root.unmount());
console.log(
  "PASS 非口播修复版UI回归：统一资产入口、复刻标题手册（旧口播交互由V2测试替代）",
);
