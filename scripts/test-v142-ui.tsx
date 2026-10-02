import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import SpeechPage from "../src/features/realSpeech/Page.tsx";
import { LibraryPage } from "../src/renderer/pages/Library.tsx";
import { useApp } from "../src/renderer/store.ts";
localStorage.setItem("real-speech-v2-plan-draft", "上次未保存的旧稿");
const rows: any[] = [
  {
    id: "a",
    category: "asset",
    name: "真实音频",
    kind: "audio",
    status: "Completed",
    createdAt: new Date().toISOString(),
    origin: "generated",
    module: "真人口播",
    ids: ["a"],
    asset: {
      id: "a",
      name: "真实音频",
      kind: "audio",
      duration: 2.3,
      tags: [],
    },
    mediaAsset: { id: "a", kind: "audio", duration: 2.3 },
  },
  {
    id: "b",
    category: "asset",
    name: "另一音频",
    kind: "audio",
    status: "Completed",
    createdAt: new Date().toISOString(),
    origin: "upload",
    ids: ["b"],
    asset: { id: "b", kind: "audio", tags: [] },
    mediaAsset: { id: "b", kind: "audio" },
  },
];
let query: any;
let hides: any[] = [];
window.aiVideo = {
  invoke: async (action: string, p: any) => {
    if (action === "realSpeech:v2:list")
      return {
        tasks: [{ taskId: "saved", name: "历史任务", windows: [] }],
        legacy: [],
        voices: [],
      };
    if (action === "library.list") {
      query = p;
      return { items: p.hidden ? [] : rows, total: p.hidden ? 0 : rows.length };
    }
    if (action === "library.hide") {
      hides.push(p);
      return p;
    }
    if (action === "folders.list") return [];
    throw Error("unexpected/offline-only UI action " + action);
  },
  onChange: () => () => {},
  onNavigate: () => () => {},
  filePath: () => "",
} as any;
const root = createRoot(document.getElementById("root")!);
await act(async () => {
  root.render(<SpeechPage />);
  await new Promise((r) => setTimeout(r, 30));
});
assert.equal(document.querySelector("textarea")?.value, "");
assert(document.body.textContent?.includes("历史任务"));
assert.equal(
  localStorage.getItem("real-speech-v2-plan-draft"),
  "上次未保存的旧稿",
);
await act(async () => root.unmount());
const libraryRoot = createRoot(document.getElementById("root")!);
useApp.setState({
  assetKind: "audio",
  boot: { projects: [{ id: "project1", name: "测试项目" }] } as any,
});
await act(async () => {
  libraryRoot.render(<LibraryPage />);
  await new Promise((r) => setTimeout(r, 250));
});
await act(async () => {
  await new Promise((r) => setTimeout(r, 250));
});
const tabs = [...document.querySelectorAll("[role=tab]")].map(
  (x) => x.textContent,
);
assert.deepEqual(tabs, ["视频", "图片", "音频", "隐藏"]);
assert.equal(document.querySelectorAll(".asset-card audio").length, 2);
assert.equal(document.querySelectorAll(".asset-card .asset-visual").length, 0);
assert.equal(
  document.querySelectorAll('[aria-label="打开保存位置"]').length,
  2,
);
const audios = [...document.querySelectorAll("audio")];
let paused = 0;
audios[0].pause = () => {
  paused++;
};
audios[1].pause = () => {};
await act(async () =>
  audios[1].dispatchEvent(new Event("play", { bubbles: true })),
);
assert.equal(paused, 1);
assert(document.body.textContent?.includes("2.3秒"));
assert.equal(query.source, "all");
await act(async () => {
  const select = document.querySelector<HTMLSelectElement>(
    '[aria-label="所属项目"]',
  )!;
  select.value = "project1";
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
await act(async () => {
  await new Promise((r) => setTimeout(r, 250));
});
assert.equal(query.project, "project1");
assert.equal(query.origin, "upload");
assert(
  [...document.querySelectorAll("button")].some(
    (b) => b.textContent === "上传",
  ),
);
assert(
  [...document.querySelectorAll("button")].some(
    (b) => b.textContent === "生成",
  ),
);
await act(async () => {
  [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => b.textContent === "隐藏" && !b.hasAttribute("role"))!
    .click();
});
assert.equal(hides[0].hidden, true);
await act(async () => libraryRoot.unmount());
console.log(
  "v1.4.2 UI: 12 assertions passed; new speech blank/history preserved; media tabs/audio exclusivity/duration/location/project origin/hide; no native GUI interaction",
);
