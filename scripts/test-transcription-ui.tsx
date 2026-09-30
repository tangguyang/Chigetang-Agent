import { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TranscriptionPage } from "../src/renderer/pages/Transcription.tsx";
import { TranscriptionService } from "../src/main/services/transcription.ts";
import type { Settings } from "../src/shared/types.ts";
const fixtures = process.env.TRANSCRIPTION_FIXTURES;
if (!fixtures || !process.env.AIVIDEO_SHERPA_ONNX_PATH)
  throw Error(
    "Set real SenseVoice fixtures and runtime; this test never mocks ASR.",
  );
const data = mkdtempSync(join(tmpdir(), "transcription-ui-"));
mkdirSync(join(data, "models/sensevoice"), { recursive: true });
for (const name of ["model.int8.onnx", "tokens.txt"])
  copyFileSync(join(fixtures, name), join(data, "models/sensevoice", name));
const service = new TranscriptionService(
  data,
  process.cwd(),
  () =>
    ({ ffmpegPath: process.env.AIVIDEO_FFMPEG_PATH || "ffmpeg" }) as Settings,
);
const file = resolve(fixtures, "zh.wav");
let selected: string | null = file,
  clipboard = "",
  starts = 0;
const calls: string[] = [];
Object.assign(window, {
  aiVideo: {
    filePath: () => file,
    invoke: async (action: string, p: any = {}) => {
      calls.push(action);
      if (action === "transcription.select")
        return selected ? service.inspect(selected) : null;
      if (action === "transcription.inspect") return service.inspect(p.path);
      if (action === "transcription.progress") return service.progress();
      if (action === "transcription.start") {
        starts++;
        return service.start(p.path);
      }
      if (action === "transcription.cancel") return service.cancel();
      if (action === "transcription.openResult")
        return service.resultPath(p.taskId, p.kind);
      if (action === "transcription.copy") {
        clipboard = readFileSync(
          service.resultPath(p.taskId, p.kind),
          "utf8",
        ).replace(/^\uFEFF/, "");
        return true;
      }
      if (
        [
          "transcription.openOutputFolder",
          "transcription.openModelFolder",
          "transcription.openGuide",
        ].includes(action)
      )
        return true;
      throw Error("Unexpected IPC " + action);
    },
  },
});
let root = createRoot(document.getElementById("root")!);
const buttons = () => [
  ...document.querySelectorAll<HTMLButtonElement>("button"),
];
const button = (text: string) => {
  const found = buttons().find((b) => b.textContent === text);
  assert(found, `Missing button ${text}`);
  return found;
};
async function click(text: string) {
  await act(async () => button(text).click());
}
async function until(condition: () => boolean) {
  const until = Date.now() + 30_000;
  while (!condition()) {
    assert(Date.now() < until, "UI timeout");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
  }
}
try {
  await act(async () => root.render(<TranscriptionPage />));
  await until(() => !button("选择文件").disabled);
  assert.equal(button("开始转文字").disabled, true);
  assert.equal(
    document.querySelectorAll(".transcription-title-actions button").length,
    3,
  );
  for (const b of document.querySelectorAll<HTMLButtonElement>(
    ".transcription-title-actions button",
  ))
    await act(async () => b.click());
  assert(calls.includes("transcription.openGuide"));
  console.log("PASS original header actions and empty-state disabled start");
  selected = null;
  await click("选择文件");
  assert(button("开始转文字").disabled);
  selected = file;
  await click("选择文件");
  await until(() => document.body.textContent!.includes("zh.wav"));
  assert(document.body.textContent!.includes("WAV"));
  assert(document.body.textContent!.includes("MB"));
  await act(async () => {
    button("开始转文字").click();
    button("开始转文字").click();
  });
  assert.equal(starts, 1);
  assert(button("开始转文字").disabled);
  // Leave and return while the actual ASR task is active.
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<TranscriptionPage />));
  await until(() => document.body.textContent!.includes("转写结果"));
  assert.equal(
    service.progress().stage,
    "completed",
    service.progress().detail,
  );
  await click("复制完整逐字稿");
  assert(clipboard.includes("早上"));
  assert(!clipboard.includes("-->"));
  await click("复制时间帧逐字稿");
  assert(clipboard.includes("-->"));
  await click("查看完整逐字稿");
  await click("查看时间帧逐字稿");
  await click(" 打开本次任务文件夹");
  console.log(
    "PASS actual UI → local service → SenseVoice → two TXT → result operations; survives remount",
  );
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="移除文件"]')!
      .click(),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700));
  });
  assert(button("开始转文字").disabled);
  assert(button("选择文件"));
  console.log("PASS removal stays removed after polling");
  const drop = new Event("drop", { bubbles: true });
  Object.defineProperty(drop, "dataTransfer", { value: { files: [{}] } });
  await act(async () =>
    document.querySelector(".transcription-import")!.dispatchEvent(drop),
  );
  await until(() => !button("开始转文字").disabled);
  await click("开始转文字");
  await click("取消任务");
  await until(() => service.progress().stage === "cancelled");
  await until(() => !button("开始转文字").disabled);
  console.log("PASS drag import, actual cancellation and immediate reuse");
  console.log("TRANSCRIPTION_UI_PASS");
} finally {
  await service.cancel();
  await act(async () => root.unmount());
}
