import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Page from "../src/features/realSpeech/Page.tsx";
import { RealSpeechV2Service } from "../src/main/realSpeech/v2/service.ts";
const service = new RealSpeechV2Service(
  mkdtempSync(join(tmpdir(), "ctg-v2-ui-workflow-")),
);
const plan = JSON.parse(
  readFileSync("docs/real-speech-v2-design-r2/examples/plan.json", "utf8"),
);
const fake = async (_body: any, path: string) => {
  const n = 2400,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(96000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  writeFileSync(path, b, { flag: "wx" });
  return { requestId: "offline-ui-test" };
};
let exported = "";
Object.assign(window, {
  aiVideo: {
    invoke: async (action: string, p: any) => {
      switch (action.replace("realSpeech:v2:", "")) {
        case "list":
          return {
            tasks: service.list(),
            legacy: [],
            voices: [{ id: "TEST-VOICE", name: "离线测试音色" }],
          };
        case "preview":
          return service.preview(p.text);
        case "import":
          return service.importPlan(p);
        case "get":
          return service.get(p.taskId);
        case "generate":
          return service.runJob(service.createJob(p).jobId, fake);
        case "mutate":
          return service.mutate(p);
        case "patchPreview":
          return service.previewPatch(p);
        case "patchApply": {
          const out = service.applyPatch(p);
          return out.jobId ? service.runJob(String(out.jobId), fake) : out;
        }
        case "concat":
          return service.concat(p);
        case "export": {
          const out = await service.exportDiagnosis(p);
          exported = out.path;
          return out;
        }
        case "document":
          return true;
        default:
          throw Error("unexpected " + action);
      }
    },
  },
});
const root = createRoot(document.getElementById("root")!);
const click = async (text: string, scope: ParentNode = document) => {
  const b = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
  assert.ok(b, text);
  assert.equal(b.disabled, false, text);
  await act(async () => b.click());
  for (
    let i = 0;
    document.querySelector('.rs-v2[aria-busy="true"]') && i < 300;
    i++
  )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  assert.ok(!document.querySelector('.rs-v2[aria-busy="true"]'), "UI操作超时");
  assert.ok(
    !document.querySelector("[role=alert]"),
    document.querySelector("[role=alert]")?.textContent || "错误",
  );
};
const change = async (
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) => {
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
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
const card = (i: number) => document.querySelectorAll(".rs-v2-window")[i];
await act(async () => root.render(<Page />));
await change(
  document.querySelector(".rs-v2-import textarea")!,
  JSON.stringify(plan),
);
await change(document.querySelector(".rs-v2-import select")!, "TEST-VOICE");
await click("导入并校验方案");
await act(async () =>
  (
    document.querySelector(
      ".rs-v2-import input[type=checkbox]",
    ) as HTMLInputElement
  ).click(),
);
await click("保存执行方案");
assert.equal(service.list().length, 1);
await click("选择全篇");
await click("生成所选Window（3）");
let t = service.list()[0];
assert.ok(t.windows.every((w: any) => w.versions.length === 1));
assert.equal(document.querySelectorAll(".rs-v2-version").length, 3);
const before = structuredClone(t.plan.windows[0]);
await click("锁定Window", card(0));
t = service.get(t.taskId);
const patch = JSON.parse(
  readFileSync("docs/real-speech-v2-design-r2/examples/patch.json", "utf8"),
);
patch.taskId = t.taskId;
patch.basePlanId = t.plan.planId;
patch.basePlanHash = t.planHash;
patch.lockedWindows = ["GW001"];
patch.expectedVersions = [
  {
    windowId: "GW002",
    configRevision: t.windows[1].configRevision,
    selectedVersionId: t.windows[1].selectedVersionId,
    selectedVersionHash: t.windows[1].versions[0].fileHash,
  },
];
await change(card(1).querySelector("textarea")!, JSON.stringify(patch));
await click("导入修复并查看Diff", card(1));
assert.ok(card(1).textContent?.includes("GW002"));
await act(async () =>
  (
    card(1).querySelectorAll("input[type=checkbox]")[1] as HTMLInputElement
  ).click(),
);
await click("应用并生成新版本", card(1));
t = service.get(t.taskId);
assert.equal(t.windows[1].versions.length, 2);
assert.deepEqual(t.plan.windows[0], before);
assert.equal(t.windows[0].versions.length, 1);
await click("选择当前版本", card(1).querySelector(".rs-v2-version")!);
t = service.get(t.taskId);
assert.equal(
  t.windows[1].selectedVersionId,
  t.windows[1].versions[1].versionId,
);
await click(
  "回滚配置与音频至V1",
  card(1).querySelectorAll(".rs-v2-version")[1],
);
t = service.get(t.taskId);
assert.equal(
  t.windows[1].selectedVersionId,
  t.windows[1].versions[0].versionId,
);
await click("最终拼接当前版本");
t = service.get(t.taskId);
assert.ok(existsSync(t.finals[0].path));
await click("导出全篇诊断ZIP");
assert.ok(existsSync(exported));
const golden = [...document.querySelectorAll("label")]
  .find((l) => l.textContent?.includes("我已完整试听当前拼接"))!
  .querySelector("input")!;
await act(async () => golden.click());
await click("保存Golden");
assert.ok(service.get(t.taskId).windows.every((w: any) => w.locked));
assert.equal(service.get(t.taskId).goldens.length, 1);
await act(async () => root.unmount());
service.close();
console.log(
  "PASS V2 UI+SQLite+模拟WAV集成：导入→多段生成→锁保护Patch→V1/V2选择与回滚→真实FFmpeg拼接→诊断ZIP→Golden；零付费网络",
);
