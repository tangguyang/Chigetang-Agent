import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import { ProductionPage } from "../src/renderer/pages/Production.tsx";
import { CopyWorkflowPage } from "../src/renderer/pages/CopyWorkflow.tsx";
import { useApp } from "../src/renderer/store.ts";
const rows: any[] = [
  {
    id: "task:a",
    recordId: "a",
    system: "task",
    name: "Codex视频",
    feature: "一键复制",
    driver: "Codex",
    createdAt: new Date().toISOString(),
    status: "Completed",
    model: "Wan",
    note: "黄金结构",
    favorite: false,
    outputs: [{ path: "D:/fake/video.mp4", kind: "video", taskId: "a" }],
    deleted: false,
    params: { prompt: "完整Prompt" },
  },
  {
    id: "asset:b",
    recordId: "b",
    system: "asset",
    name: "GUI音频",
    feature: "Qwen",
    driver: "GUI",
    createdAt: new Date().toISOString(),
    status: "Completed",
    model: "Qwen",
    note: "音频备注",
    favorite: false,
    outputs: [{ path: "D:/fake/audio.wav", kind: "audio", assetId: "b" }],
    deleted: false,
  },
];
const calls: any[] = [];
let workflow: any = null;
window.aiVideo = {
  invoke: async (action: string, p: any) => {
    calls.push({ action, p });
    switch (action) {
      case "production.list": {
        const items = rows.filter(
          (r) =>
            (!p.favorite || r.favorite) &&
            (!p.search || [r.name, r.note].some((x) => x.includes(p.search))),
        );
        return { items, total: items.length };
      }
      case "production.update": {
        const row = rows.find((r) => r.id === p.id);
        Object.assign(row, p);
        return row;
      }
      case "production.open":
        return true;
      case "copy.list":
        return workflow ? [workflow] : [];
      case "core-assets.list":
        return [];
      case "copy.create":
        workflow = {
          id: "batch",
          name: p.name,
          driver: "GUI",
          createdAt: new Date().toISOString(),
          drafts: Array.from({ length: p.count }, () => p.draft),
          state: "prepared",
          revision: 1,
          taskIds: [],
        };
        return workflow;
      case "copy.preflight":
        workflow = { ...workflow, fingerprint: "checked", issues: [] };
        return workflow;
      case "copy.confirm":
        workflow = { ...workflow, confirmed: true };
        return workflow;
      case "copy.submit":
        workflow = {
          ...workflow,
          state: "submitted",
          taskIds: ["generated"],
          tasks: [
            {
              id: "generated",
              name: "生成视频",
              status: "Completed",
              outputPath: "D:/fake/video.mp4",
            },
          ],
        };
        return workflow;
      case "copy.get":
        return workflow;
      default:
        throw Error("Unexpected " + action);
    }
  },
  onChange: () => () => {},
  onNavigate: () => () => {},
  filePath: () => "",
} as any;
useApp.setState({
  draft: {
    name: "方案",
    modelId: "wan-safe",
    accountId: "auto",
    projectId: null,
    prompt: "不截断原Prompt",
    params: { duration: 5 },
    assets: [],
    outputDir: "D:/fake",
  },
  boot: { projects: [] } as any,
});
const tick = () => new Promise((r) => setTimeout(r, 200));
const click = async (text: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (x) => x.textContent === text,
  );
  assert(b, "button " + text);
  await act(async () => {
    b.click();
    await tick();
  });
};
let root = createRoot(document.getElementById("root")!);
await act(async () => {
  root.render(<ProductionPage />);
});
await act(tick);
assert.equal(document.querySelectorAll(".production-card").length, 2);
assert(document.body.textContent?.includes("黄金结构"));
assert.equal(document.querySelectorAll("video").length, 1);
assert.equal(document.querySelectorAll("audio").length, 1);
const star = document.querySelector<HTMLButtonElement>(
  '[aria-label="收藏Codex视频"]',
)!;
await act(async () => {
  star.click();
  await tick();
});
assert.equal(rows[0].favorite, true);
await click("★ 收藏任务");
await act(tick);
assert.equal(document.querySelectorAll(".production-card").length, 1);
await click("详情 / 参数 / 备注");
const textarea = document.querySelector<HTMLTextAreaElement>(
  '[aria-label="任务备注"]',
)!;
await act(async () => {
  Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!.call(textarea, "外显备注修改");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
});
await click("保存备注");
assert.equal(rows[0].note, "外显备注修改");
assert(document.body.textContent?.includes("外显备注修改"));
await click("打开");
await click("所在文件夹");
assert(calls.some((x) => x.action === "production.open" && x.p.folder));
await act(async () => root.unmount());
root = createRoot(document.getElementById("root")!);
await act(async () => root.render(<CopyWorkflowPage />));
await act(tick);
await click("建立批次");
assert.equal(workflow.drafts.length, 5);
await click("1. 预检");
await click("2. 确认方案");
assert.equal(workflow.confirmed, true);
await click("3. 正式生成（收费）");
assert.equal(workflow.state, "submitted");
await click("接管任务");
assert.equal(useApp.getState().taskId, "generated");
await act(async () => root.unmount());
console.log(
  "v1.5.0 UI: automatic driver records, external notes/edit/save, task favorite filter, video/audio preview, open/folder, copy prepare/preflight/confirm/submit and GUI takeover PASS (jsdom fake-only).",
);
