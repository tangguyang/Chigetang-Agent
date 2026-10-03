import { ProductionService } from '../src/main/services/production.ts';
import {libraryView} from "../src/main/services/libraryView.ts";
import { HttpClient } from "../src/main/providers/http.ts";
import { testConnection } from "../src/main/providers/accounts.ts";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { JSDOM } from "jsdom";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/main/services/application.ts";
import { brand } from "../src/shared/brand.ts";
import type {
  Draft,
  ListQuery,
  Prompt,
  Settings,
} from "../src/shared/types.ts";
import assert from "node:assert/strict";
const app = new Application(
  mkdtempSync(join(tmpdir(), "aivideo-ui-")),
  {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error("No secrets in UI tests");
    },
    decryptString: () => {
      throw new Error("No secrets in UI tests");
    },
  },
  async () => ({
    width: 720,
    height: 1280,
    duration: 5,
    sampleRate: 24000,
    channels: 1,
    fps: 30,
    hasAlpha: false,
  }),
  () => {},
  () => {},
);
const productionIndex=new ProductionService(app,async()=>[],()=>[]);
Object.assign(window, {
  aiVideo: {
    invoke: async (action: string, p: Record<string, unknown>) => {
      switch (action) {
        case "replica.list": return [];
        case "production.list": return productionIndex.list(p);
        case "uploads.list": return productionIndex.uploads(p);
        case "core-assets.list": return [];
        case "copy.list": return [];
        case "transcription.progress":
          return { stage: "idle", busy: false };
        case "folders.list":
          return app.folders.list();
        case "folders.save":
          return app.folders.save(p);
        case "voices.list":
          return app.audio.voices();
        case "voices.save":
          return app.audio.updateVoice(String(p.id), p);
        case "voices.remove":
          return app.audio.removeVoice(String(p.id));
        case "audio.batches":
          return app.audio.batches();
        case "audio.presets":
          return app.audio.presets();
        case "audio.history":
          return app.audio.history();
        case "audio.reclone.draft":
          return app.audio.recloneDraft();
        case "audio.reclone.clear":
          return app.audio.clearRecloneDraft();
        case "audio.capabilities":
          return { ffmpeg: false };
        case "library.list": return libraryView(app,undefined,p);
        case "bootstrap":
          return app.bootstrap();
        case "draft.new":
          return app.newDraft();
        case "draft.list":
          return app.drafts.list();
        case "draft.load":
          return app.drafts.get(String(p.id));
        case "tasks.create":
          return app.tasks.create(p.draft as Draft, String(p.requestId));
        case "draft.finishSubmitted":
          app.drafts.remove(String(p.id));
          return true;
        case "draft.remove":
          app.drafts.remove(String(p.id));
          return true;
        case "tasks.estimate":
          return app.tasks.estimate(p as unknown as Draft);
        case "tasks.get":
          return app.tasks.get(String(p.id));
        case "tasks.versions":
          return app.tasks.versions(String(p.id));
        case "tasks.clone":
          return app.tasks.cloneDraft(String(p.id), Boolean(p.independent));
        case "tasks.remove":
          app.tasks.removeRecord(String(p.id));
          return true;
        case "assets.get":
          return app.assets.get(String(p.id));
        case "billing.correct":
          app.billing.correct(
            String(p.id),
            p.amount as number | null,
            String(p.note || ""),
          );
          return true;
        case "billing.history":
          return app.billing.history(String(p.id));
        case "draft.rename":
          return app.drafts.rename(String(p.id), String(p.name));
        case "assets.save": {
          const a = app.assets.get(String(p.id));
          app.assets.save({ ...a, ...p });
          return app.assets.get(a.id);
        }
        case "billing.report":
          return app.billing.report(p ?? {});
        case "accounts.balance":
          return app.balance(String(p.id));
        case "accounts.test": {
          const account = app.credentials.list().find((a) => a.id === p.id)!;
          return testConnection(
            account,
            app.models()[0],
            app.providers()[0],
            () => app.credentials.getKey(account.id),
            new HttpClient(
              async () => Response.json({ data: {} }),
              undefined,
              0,
            ),
          );
        }
        case "draft.save":
          return app.saveDraft(p as unknown as Draft);
        case "settings.save":
          return app.saveSettings(p as Partial<Settings>);
        case "tasks.list":
          return app.tasks.list(p as ListQuery);
        case "assets.list":
          return app.assets.list(p as ListQuery);
        case "prompts.list":
          return app.prompts.list(p as ListQuery);
        case "prompts.save":
          return app.prompts.save(p as unknown as Prompt);
        case "statistics":
          return app.statistics(p ?? {});
        case "dialog.confirm":
          return true;
        default:
          throw new Error("Unexpected test operation " + action);
      }
    },
    onChange: () => () => {},
    onNavigate: () => () => {},
  },
});
const { act } = await import("react");
await act(async () => {
  await import("../src/renderer/main.tsx");
});
const { useApp } = await import("../src/renderer/store.ts");
const checks: string[] = [];
function check(name: string, fn: () => void) {
  fn();
  checks.push(name);
  console.log("PASS " + name);
}
check("app opens on replica production by default", () => {
  assert.equal(useApp.getState().page, "一键复刻");
  assert.equal(document.querySelector("h1")?.textContent?.includes("复刻"), true);
});
await act(async()=>useApp.getState().setPage("一键生成"));
check("旧一键生成只保留 v124 导入入口",()=>{
 const labels=[...document.querySelectorAll<HTMLButtonElement>('.oneclick-import-bar button')].map(b=>b.textContent?.trim());assert.deepEqual(labels,['导入 ZIP']);
});
await act(async () => useApp.getState().setPage("生成视频"));
check("app switches to video generation after explicit navigation", () => {
  assert.equal(useApp.getState().page, "生成视频");
  assert(document.body.textContent?.includes("视频"));
  assert.equal(app.tasks.list().total, 0);
});
await act(async () => useApp.getState().setPage("生成视频"));
check("generation page remains unchanged and starts empty", () => {
  assert(document.body.textContent?.includes("生成工作台"));
  assert(document.querySelector<HTMLButtonElement>(".generate-button")?.disabled);
});
await act(async () => {
  const state = useApp.getState();
  state.setDraft({ ...state.draft!, prompt: "镜头锁定。".repeat(2200) });
});
await act(async () => {
  await new Promise((r) => setTimeout(r, 450));
});
check("11k editor draft autosaves through application to SQLite", () => {
  assert.equal(app.db.get<Draft | null>("draft", null)?.prompt.length, 11000);
  assert.equal(
    document.querySelector<HTMLTextAreaElement>("[data-prompt]")?.value.length,
    11000,
  );
});
for (const page of ["生成任务", "上传素材", "Prompt", "模型与 API", "设置"]) {
  await act(async () => useApp.getState().setPage(page));
  check(page + " page renders", () =>
    assert.equal(document.querySelector("h1")?.textContent, page === "Prompt" ? "资产库 · 脚本／Prompt" : page),
  );
}
await act(async () => useApp.getState().setPage("统计"));
check("旧统计路由在模型与 API 中打开统计 tab", () => {
  assert.equal(document.querySelector("h1")?.textContent, "模型与 API");
  assert.equal(document.querySelector(".tabs button.active")?.textContent, "统计");
});
await act(async () => {
  useApp.getState().setPage("生成视频");
});
check("no invalid nested buttons", () =>
  assert.equal(document.querySelectorAll("button button").length, 0),
);
await act(async () => {
  const m = app.models().find((m) => m.id === "seedance15")!;
  const state = useApp.getState();
  state.setDraft({
    ...state.draft!,
    modelId: m.id,
    params: Object.fromEntries(
      m.capabilities.parameters.map((p) => [p.key, p.default]),
    ),
    assets: [],
  });
});
check("生成工作台保留 Seedance 并显示引擎模型账户选择", () => {
  assert.equal(useApp.getState().draft?.modelId, "seedance15");
  assert.equal(document.querySelectorAll('[aria-label="视频引擎"], [aria-label="模型"], [aria-label="API 账户"]').length, 3);
});
await act(async () => {
  await app.saveSettings({ theme: "dark" });
  await useApp.getState().refresh();
});
check("theme applies globally", () =>
  assert.equal(document.documentElement.dataset.theme, "dark"),
);
await act(async () => {
  useApp.getState().setPage("Prompt");
});
await act(async () => {
  const b = [...document.querySelectorAll("button")].find((e) =>
    e.textContent?.includes("新建模板"),
  );
  b?.click();
});
check("template dialog opens", () =>
  assert(document.querySelector<HTMLDialogElement>("dialog")?.open),
);
await act(async () => {
  document.querySelector<HTMLButtonElement>("dialog header button")?.click();
});
// Exercise v1.0.4 UI through real React events and a real SQLite Application.
const secret = randomBytes(32);
app.credentials.vault = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", secret, iv);
    return Buffer.concat([iv, c.update(text), c.final(), c.getAuthTag()]);
  },
  decryptString: (b: Buffer) => {
    const d = createDecipheriv("aes-256-gcm", secret, b.subarray(0, 12));
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString();
  },
};
const account = app.credentials.save({
  name: "UI fixture account",
  providerId: "alibaba",
  modelPrices: {},
  workspaceId: "ws-ui-test",
  region: "cn-beijing",
  key: "ui-fixture-not-a-real-secret",
});
app.updateModel("wan-safe", {
  price: {
    ...app.models()[0].price,
    rate: null,
    source: "UI TEST only",
    rules: [{ id: "test-720", resolution: "720P", rate: 0.2, unit: "second" }],
  },
});
await act(async()=>{const state=useApp.getState();const m=app.models().find(m=>m.id==='wan-safe')!;state.setDraft({...state.draft!,modelId:m.id,params:Object.fromEntries(m.capabilities.parameters.map(p=>[p.key,p.default])),assets:[]});});
writeFileSync(join(app.root, "product.png"), Buffer.from("image-ui-fixture"));
const image = (await app.assets.import(join(app.root, "product.png"), false))
  .asset;
image.metadata = { ...(image.metadata ?? {}), detectedFormat: "png" };
app.assets.save(image);
const video = (await app.assets.import("tests/fixtures/sample.mp4", false))
  .asset;
await act(async () => {
  await useApp.getState().refresh();
  await useApp.getState().newDraft();
});
async function clickText(text: string, selector = "button") {
  const b = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (e) => e.textContent?.trim() === text,
  );
  assert(b, "Missing UI control: " + text);
  await act(async () => b.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}
async function select(selector: string, value: string) {
  const el = document.querySelector<HTMLSelectElement>(selector);
  assert(el, selector);
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}
check("current version and New Task navigation", () => {
  assert.equal(app.bootstrap().version, "1.5.0");
  assert(document.querySelector(".workspace-tab-new"));
  assert(!document.querySelector(".new-task"));
  assert.equal(useApp.getState().draft?.params.ratio, "9:16");
});
const oldId = useApp.getState().draft!.draftId!;
await act(async () =>
  useApp
    .getState()
    .setDraft({ ...useApp.getState().draft!, prompt: "Preserve workspace" }),
);
await act(async () =>
  document.querySelector<HTMLButtonElement>(".workspace-tab-new")!.click(),
);
check(
  "new task saves prior workspace and opens blank independent draft",
  () => {
    assert.notEqual(useApp.getState().draft?.draftId, oldId);
    assert.equal(useApp.getState().draft?.prompt, "");
    assert.equal(app.drafts.get(oldId).prompt, "Preserve workspace");
  },
);
await clickText("从资产库选择");
check("visual asset picker shows image/video metadata", () => {
  assert.equal(document.querySelectorAll(".asset-pick").length, 2);
  assert(document.querySelector("dialog")?.textContent?.includes("720 × 1280"));
  assert(document.querySelector("dialog")?.textContent?.includes("5.0 秒"));
});
await select('[aria-label="选择器素材类型"]', "image");
check("image filter", () => {
  assert.equal(document.querySelectorAll(".asset-pick").length, 1);
  assert(
    document.querySelector(".asset-pick")?.textContent?.includes("product.png"),
  );
});
await act(async () =>
  document.querySelector<HTMLButtonElement>(".asset-pick")!.click(),
);
await select('[aria-label="选择器素材类型"]', "video");
check("video filter", () =>
  assert.equal(document.querySelectorAll(".asset-pick").length, 1),
);
await act(async () =>
  document.querySelector<HTMLButtonElement>(".asset-pick")!.click(),
);
await clickText("添加选中素材");
check("multiselect reuses image/video IDs without importing again", () => {
  assert.deepEqual(
    new Set(useApp.getState().draft?.assets.map((a) => a.assetId)),
    new Set([image.id, video.id]),
  );
  assert.equal(
    app.db.one<{ n: number }>("SELECT count(*) n FROM assets")?.n,
    2,
  );
});
async function openMention(text: string) {
  await act(async () =>
    useApp.getState().setDraft({ ...useApp.getState().draft!, prompt: text }),
  );
  const el = document.querySelector<HTMLTextAreaElement>("[data-prompt]")!;
  await act(async () => {
    el.setSelectionRange(text.length, text.length);
    el.click();
  });
  return el;
}
let editor = await openMention("@");
check("@ opens bound material menu", () =>
  assert.equal(
    document.querySelectorAll('.mention-menu [role="option"]').length,
    2,
  ),
);
await act(async () => {
  editor.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
});
await act(async () => {
  editor.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
});
check("keyboard selects Video1 and inserts bound highlighted token", () => {
  assert.equal(useApp.getState().draft?.mentions?.[0].assetId, video.id);
  assert(document.querySelector(".mention-overlay mark"));
  assert(useApp.getState().draft?.prompt.includes("@Video1"));
});
editor = await openMention(useApp.getState().draft!.prompt + "@Image");
check("@ search filters selected assets", () =>
  assert.equal(
    document.querySelectorAll('.mention-menu [role="option"]').length,
    1,
  ),
);
await act(async () =>
  document.querySelector<HTMLButtonElement>(".mention-menu button")!.click(),
);
check("mouse selects Image1 with stable ID", () =>
  assert.equal(useApp.getState().draft?.mentions?.[1].assetId, image.id),
);
await act(async () =>
  useApp.getState().setDraft({
    ...useApp.getState().draft!,
    accountId: account.id,
    params: {
      ...useApp.getState().draft!.params,
      duration: 12,
      resolution: "720P",
      ratio: "9:16",
      audio: false,
    },
  }),
);
check("WAN estimate remains visible in compact footer", () => {
  assert(
    document
      .querySelector("[data-estimated-cost]")
      ?.textContent?.includes("¥3.40"),
  );
  assert(!document.querySelector(".generation-footer .model-bar"));
  assert(!document.body.textContent?.includes("声音：关闭"));
});
await act(async () =>
  document.querySelector<HTMLButtonElement>('[aria-label="画面比例"]')!.click(),
);
check("all ratio diagrams use actual width/height relationships", () => {
  for (const el of document.querySelectorAll<HTMLElement>(
    ".ratio-menu [data-ratio]",
  )) {
    const ratio = el.dataset.ratio!;
    if (!ratio.includes(":")) continue;
    const [w, h] = ratio.split(":").map(Number);
    assert(
      Math.abs(
        parseFloat(el.style.width) / parseFloat(el.style.height) - w / h,
      ) < 0.001,
    );
  }
  assert(document.querySelector('[role="option"][aria-selected="true"]'));
});
await act(async () =>
  document
    .querySelector<HTMLButtonElement>('[aria-label="关闭比例菜单"]')!
    .click(),
);
const task = await app.tasks.create(
  useApp.getState().draft!,
  "ui-task-no-network",
);
await act(async () => useApp.getState().setPage("任务"));
await act(async () => {
  useApp.getState().setDraft(app.tasks.cloneDraft(task.id, true));
  useApp.getState().setPage("生成视频");
  await useApp.getState().flushDraft();
});
const copiedId = useApp.getState().draft!.draftId;
check("内部兼容克隆仍可打开独立未提交草稿", () => {
  assert.equal(app.tasks.list().total, 1);
  assert.equal(useApp.getState().draft?.groupId, undefined);
  assert.equal(useApp.getState().draft?.mentions?.length, 2);
});
await act(async () => useApp.getState().setPage("任务"));
check(
  "v105 task center excludes drafts and preserves them in workspace storage",
  () => {
    assert.equal(document.querySelectorAll(".saved-draft-row").length, 0);
    assert(app.drafts.list().some((d) => d.id === copiedId));
    assert.equal(app.tasks.list().total, 1);
  },
);
await act(async () => {
  useApp.getState().setPage("生成视频");
});
check("current queue exposes delete control", () =>
  assert(document.querySelector(".queue-delete")),
);
await act(async () =>
  document.querySelector<HTMLButtonElement>(".queue-item")?.click(),
);
check("queue click opens the selected task without bypassing the button", () =>
  assert.equal(useApp.getState().taskId, task.id),
);
check("current task detail contains delete operation", () =>
  assert(
    [...document.querySelectorAll("dialog button")].some((e) =>
      e.textContent?.includes("删除任务记录"),
    ),
  ),
);
await act(async () => {
  const b = [
    ...document.querySelectorAll<HTMLButtonElement>("dialog button"),
  ].find((e) => e.textContent?.includes("删除任务记录"));
  assert(b);
  b.click();
});
check(
  "current task deletion hides task, preserves materials and billing",
  () => {
    assert.equal(app.tasks.list().total, 0);
    assert.equal(app.billing.report().total, 1);
    assert.equal(
      app.db.one<{ n: number }>("SELECT count(*) n FROM assets")?.n,
      2,
    );
  },
);
await act(async () => useApp.getState().setPage("统计"));
check(
  "billing center shows today yesterday month estimates and actual split",
  () => {
    for (const text of [
      "今日账目合计",
      "昨日账目合计",
      "本月账目合计",
      "实际扣费",
      "暂不支持API余额实时查询",
    ])
      assert(document.body.textContent?.includes(text));
  },
);
await act(async () => useApp.getState().setPage("模型与 API"));
await clickText("测试连接");
check(
  "account connection diagnostics show correct ws workspace/region, no secret",
  () => {
    assert(
      document.querySelector("dialog")?.textContent?.includes("ws-ui-test"),
    );
    assert(
      document.querySelector("dialog")?.textContent?.includes("cn-beijing"),
    );
    assert(
      !document.body.textContent?.includes("ui-fixture-not-a-real-secret"),
    );
  },
);
await act(async () =>
  document.querySelector<HTMLButtonElement>("dialog header button")?.click(),
);
await act(async () => {
  await useApp.getState().newDraft();
  useApp.getState().setDraft({
    ...useApp.getState().draft!,
    accountId: account.id,
    prompt: "提交回归测试",
    params: {
      ...useApp.getState().draft!.params,
      duration: 5,
      resolution: "720P",
      ratio: "9:16",
    },
  });
});
const submittedDraftId = useApp.getState().draft!.draftId;
await act(async () => {
  document.querySelector<HTMLButtonElement>(".generate-button")!.click();
  await new Promise((resolve) => setTimeout(resolve, 50));
});
check(
  "generate button enqueues once and resets submitted workspace without cloud charges",
  () => {
    assert.equal(app.tasks.list().total, 1);
    assert.equal(app.tasks.list().items[0].status, "Queued");
    assert.equal(
      app.tasks.list().items[0].snapshot.draft.prompt,
      "提交回归测试",
    );
    assert.notEqual(useApp.getState().draft!.draftId, submittedDraftId);
    assert.equal(useApp.getState().draft!.prompt, "");
    assert(!app.drafts.list().some((d) => d.id === submittedDraftId));
  },
);
check(
  "reset requires duration selection and generation page hides model controls",
  () => {
    assert.equal(useApp.getState().draft!.params.duration, 0);
    assert(
      document.querySelector<HTMLButtonElement>(".generate-button")!.disabled,
    );
    assert(!document.querySelector(".generation-footer .model-bar"));
    assert(!document.querySelector(".generation-scroll .model-bar"));
    assert(!document.querySelector('[placeholder="任务名称（可选）"]'));
  },
);
const rowsBefore = app.tasks.list().total;
await act(async () => {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
    }),
  );
});
check("v104 Ctrl Enter cannot submit duration zero", () =>
  assert.equal(app.tasks.list().total, rowsBefore),
);
function inputText(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
await act(async () => {
  document
    .querySelector(".workspace-tab.active .workspace-tab-main")!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
});
await act(async () => {
  inputText(
    document.querySelector<HTMLInputElement>('[aria-label="工作区名称"]')!,
    "包装演示",
  );
});
await act(async () => {
  document
    .querySelector('[aria-label="工作区名称"]')!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
});
check("v104 tab rename Enter saves to SQLite", () =>
  assert.equal(
    app.drafts.get(useApp.getState().draft!.draftId!).name,
    "包装演示",
  ),
);
await act(async () => {
  document
    .querySelector(".workspace-tab.active .workspace-tab-main")!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
});
await act(async () => {
  inputText(
    document.querySelector<HTMLInputElement>('[aria-label="工作区名称"]')!,
    "取消的名字",
  );
});
await act(async () => {
  document
    .querySelector('[aria-label="工作区名称"]')!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
});
check("v104 tab rename Escape preserves original", () =>
  assert.equal(
    app.drafts.get(useApp.getState().draft!.draftId!).name,
    "包装演示",
  ),
);
await act(async () => {
  document
    .querySelector(".workspace-tab.active .workspace-tab-main")!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
});
await act(async () => {
  inputText(
    document.querySelector<HTMLInputElement>('[aria-label="工作区名称"]')!,
    "失焦保存",
  );
});
await act(async () => {
  document.querySelector<HTMLInputElement>('[aria-label="工作区名称"]')!.blur();
});
check("v104 tab rename blur saves", () =>
  assert.equal(
    app.drafts.get(useApp.getState().draft!.draftId!).name,
    "失焦保存",
  ),
);
await act(async () => {
  useApp.getState().setDraft({
    ...useApp.getState().draft!,
    assets: [
      {
        assetId: image.id,
        bindingId: "usage-image",
        role: "reference_image",
      },
    ],
  });
});
await select(".asset-role", "包装正面");
check("v104 usage selection persists asset default by ID", () =>
  assert.equal(app.assets.get(image.id).defaultUsage, "包装正面"),
);
await act(async () => {
  document.querySelector<HTMLButtonElement>(".mini-thumb")!.click();
});
check("v104 thumbnail opens internal preview", () =>
  assert(document.querySelector("dialog[open] .large-preview")),
);
await act(async () => {
  document.querySelector<HTMLElement>(".click-close-preview")!.click();
});
check("v104 second preview click closes", () =>
  assert(!document.querySelector("dialog[open]")),
);
await act(async () => {
  useApp.getState().setPage("统计");
});
await clickText("修正费用");
await act(async () => {
  inputText(
    document.querySelector<HTMLInputElement>('[aria-label="人工确认金额"]')!,
    "8.25",
  );
});
await act(async () => {
  inputText(
    document.querySelector<HTMLTextAreaElement>('[aria-label="费用备注"]')!,
    "测试账单备注",
  );
});
await clickText("保存费用");
check("v104 accounting modal persists confirmed cost and audit", () => {
  assert.equal(app.billing.report().tasks[0].manual, 8.25);
  assert.equal(
    app.billing.history(app.billing.report().tasks[0].version_id).length,
    1,
  );
});
await clickText("修正费用");
await clickText("撤销人工修正");
check("v104 accounting modal undo preserves audit", () => {
  assert.equal(app.billing.report().tasks[0].manual, null);
  assert.equal(
    app.billing.history(app.billing.report().tasks[0].version_id).length,
    2,
  );
});
await act(async () => {
  await useApp.getState().flushDraft();
});
await act(async () => {
  useApp.getState().setPage("生成音频");
});
check("v109 audio workspace is fixed to one model and opens one config", () => {
  assert.equal(document.querySelector("h1")?.textContent, "专业音频工作台");
  assert(document.body.textContent?.includes("CosyVoice 3.5 Plus"));
  assert.equal(document.querySelectorAll(".config-card").length, 1);
  assert(!document.querySelector('[aria-label="音频生成模型"]'));
});
await act(async () => {
  useApp.getState().setPage("任务");
});
check("v105 unified tasks default to all and contain no drafts", () => {
  assert.equal(
    (document.querySelector('[aria-label="来源"]') as HTMLSelectElement)?.value,
    "tasks",
  );
  assert.equal(document.querySelectorAll(".saved-draft-row").length, 0);
});
await act(async () => {
  useApp.getState().setAssetKind("audio");
});
check("v105 asset sidebar quick filters select one shared asset page", () =>
  assert.equal(document.querySelector("h1")?.textContent, "上传素材"),
);
await act(async () => useApp.getState().setPage("任务"));
assert.equal(document.querySelectorAll(".asset-shortcuts button").length, 0);
await clickText("上传素材", ".sidebar nav > button");
check("修复版资产库统一入口，不再增加侧栏重复类型入口", () => {
  assert.equal(document.querySelectorAll(".asset-shortcuts button").length,0);
  assert.equal(useApp.getState().assetKind,"audio");
});
await clickText("视频", ".asset-kind-tabs button");
check("v106 sidebar and visible asset tabs stay synchronized", () => {
  assert.equal(useApp.getState().assetKind, "video");
  assert.equal(
    document.querySelector('.asset-kind-tabs [aria-selected="true"]')
      ?.textContent,
    "视频",
  );
});
await clickText("音频", ".asset-kind-tabs button");
check("v106 asset page tab updates the sidebar selection", () => {
  assert.equal(useApp.getState().assetKind, "audio");
  assert.equal(
    document.querySelector('.asset-kind-tabs [aria-selected="true"]')?.textContent,
    "音频",
  );
});
await clickText("上传素材", ".sidebar nav > button");
assert.equal(document.querySelectorAll(".asset-shortcuts button").length, 0);
await act(async () => {
  useApp.getState().setPage("设置");
});
check("v105 settings exposes independent paths and tray preference", () => {
  assert(document.body.textContent?.includes("文件与存储"));
  assert(document.body.textContent?.includes("最小化到系统托盘"));
  assert(!document.body.textContent?.includes("数据保存在程序目录"));
});
// v1.2.3 removes the long-video page; retired UI checks are replaced below.
// v1.0.9: exercise the fixed-model workbench and real clone workflow.
check("v109 sidebar keeps the existing logo asset at its original size", () => {
  const logo = document.querySelector<HTMLImageElement>('.brand-symbol img');
  assert(logo && logo.src.includes("brand.svg"));
  assert.equal(logo.width, 35); assert.equal(logo.height, 35);
});
const uiReference = await app.assets.import("tests/fixtures/sample.wav", false);
const originalInvoke = window.aiVideo.invoke;
let clonedPayload: any;
window.aiVideo.invoke = async (action: string, p: any) => {
  if (action === "assets.import") return [uiReference];
  if (action === "voices.clone") {
    clonedPayload = structuredClone(p);
    return app.audio.saveVoice({ id: "ui-cosy", name: p.name, providerId: "alibaba", region: "cn-beijing", model: "cosyvoice-v3.5-plus", accountId: p.accountId, voiceId: "mock-ui-cosy", kind: "clone", referenceAssetId: p.assetId, referencePath: "", referenceName: uiReference.asset.name, referenceDuration: 5, createdAt: new Date().toISOString(), notes: p.notes || "", favorite: false, pinned: false, pinOrder: null, isDefault: true, status: "ready", createParams: { languageHints: ["zh"], maxPromptAudioLength: 20, enablePreprocess: false, enableVolumeNormalization: false } });
  }
  return originalInvoke(action, p);
};
const secondAccount = app.credentials.save({name:"Second Beijing",providerId:"alibaba",region:"cn-beijing",workspaceId:"ws-second",key:"mock-second",enabled:true});
await act(async () => { await useApp.getState().refresh(); useApp.getState().setPage("复刻音色"); });
check("v109 clone home fixes the model and exposes three-stage workflow", () => {
  assert(document.body.textContent?.includes("CosyVoice 3.5 Plus"));
  assert(!document.body.textContent?.includes("CosyVoice 3.5 Flash"));
});
await clickText("＋ 创建新音色");
check("v109 clone modal shows all three explicit stages", () => {
  assert(document.body.textContent?.includes("01 上传参考音频"));
  assert(document.body.textContent?.includes("02 配置复刻参数"));
  assert(document.body.textContent?.includes("03 创建并管理音色"));
});
await act(async () => inputText(document.querySelector<HTMLInputElement>('dialog input')!, "UI V2"));
await clickText("选择参考音频");
await clickText("确认创建音色");
check("v109 creation submits official defaults and preserves API/reference", () => {
  assert(clonedPayload.accountId);
  assert.equal(clonedPayload.name,"UI V2");
  assert(clonedPayload.assetId);
  assert.deepEqual(clonedPayload.languageHints,["zh"]);
  assert.equal(clonedPayload.maxPromptAudioLength,20);
  assert.equal(clonedPayload.enablePreprocess,false);
  assert.equal(app.audio.voices().find(v=>v.id==="ui-cosy")!.voiceId,"mock-ui-cosy");
  assert(document.body.textContent?.includes("mock-ui-cosy"));
  assert(!document.querySelector('dialog[open]'));
});
await act(async () => useApp.getState().setPage("生成音频"));
check("v109 generation is fixed to CosyVoice and starts with one complete config", () => {
  assert(document.body.textContent?.includes("CosyVoice 3.5 Plus"));
  assert(!document.body.textContent?.includes("模型选择"));
  assert(document.body.textContent?.includes("历史"));
  assert(document.body.textContent?.includes("预设"));
  assert(document.body.textContent?.includes("收藏"));
  assert.equal(document.querySelector<HTMLInputElement>('[aria-label="Seed"]')?.value, '12345');
  assert.equal(document.querySelector(".voice-choice.active"), null);
});
await clickText("＋ 新增配置 · 1/10");
check("v109 can add an independent second config with a different seed", () => {
  const seeds = [...document.querySelectorAll<HTMLInputElement>('[aria-label="Seed"]')].map((item) => item.value);
  assert.equal(seeds.length,2);
  assert.notEqual(seeds[0],seeds[1]);
});
window.aiVideo.invoke = originalInvoke;
check("v123 navigation removes long video and keeps other menu ordering", () => {
  const names = [...document.querySelectorAll('.sidebar nav > button')].map(b=>b.textContent);
  assert.deepEqual(names, ['一键复刻','一键复制','视频生成','真人口播','音频生成','复刻音色','转文字','小工具','生成任务','上传素材','设置']);
  assert.equal(document.querySelector('.studio-results h2')?.textContent, '任务列表');
});
await act(async () => useApp.getState().setPage("转文字"));
check("transcription page renders the requested title and three header actions", () => {
  assert.equal(document.querySelector(".transcription-title")?.firstChild?.textContent?.trim(), "音视频转文字");
  assert.equal(document.querySelectorAll(".transcription-title-actions button").length, 3);
});
const uiCalls: Array<{action:string;payload:unknown}> = [];
const durationRows = [
  {...task,id:'duration-real',name:'漂亮和气质哪个更重要体重管理复刻任务20260923'.repeat(3),type:'video',status:'Completed',downloadStatus:'completed',outputPath:'/qa/real.mp4',createdAt:'2026-09-01T10:00:00Z',submittedAt:'2026-09-20T10:00:00Z'},
  {...task,id:'duration-missing',type:'video',status:'Completed',downloadStatus:'completed',outputPath:'/qa/missing.mp4'},
  {...task,id:'duration-pending',type:'video',status:'Processing',downloadStatus:'none',outputPath:null},
  {...task,id:'duration-audio',type:'audio',status:'Completed',downloadStatus:'completed',outputPath:'/qa/audio.wav'},
];
window.aiVideo.invoke = async (action:string,p:any) => {
  uiCalls.push({action,payload:p});
  if(action==='tasks.list')return {items:durationRows,total:4,page:1,pageSize:30};
  if(action==='open')return true;
  return originalInvoke(action,p);
};
await act(async()=>useApp.getState().setPage('一键生成'));
check("v123 oneclick list shows actual creation date and explicit pending states",()=>{
 assert(document.querySelector('.workbench-task-sidebar header')?.textContent?.includes('任务列表'));
 assert(document.querySelector('.workbench-task-row')?.textContent?.includes('2026/9/1'));
 assert.equal(document.querySelectorAll('.workbench-task-row video').length,2);
 assert(document.body.textContent?.includes('视频时长：待生成'));
 assert(document.body.textContent?.includes('非视频任务'));
});
await act(async()=>{
 const videos=document.querySelectorAll<HTMLVideoElement>('.workbench-task-row video');
 Object.defineProperty(videos[0],'duration',{value:26.42,configurable:true});
 videos[0].dispatchEvent(new Event('loadedmetadata'));
 videos[1].dispatchEvent(new Event('error'));
});
check("v123 reads metadata instead of request params and handles missing output",()=>{
 assert(document.body.textContent?.includes('视频时长：26.42秒'));
 assert(document.body.textContent?.includes('视频时长：无法读取'));
 assert.equal(document.querySelectorAll('.workbench-task-row video').length,0);
});
await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="打开生成视频保存目录"]')!.click());
check("v123 folder entry only uses existing open API",()=>{
 assert.deepEqual(uiCalls.find(c=>c.action==='open'),{action:'open',payload:{kind:'output'}});
 assert(uiCalls.every(c=>['tasks.list','open'].includes(c.action)));
});
const pane=document.querySelector<HTMLElement>('.workbench-task-sidebar')!;
Object.defineProperty(pane.parentElement,'clientWidth',{value:1300,configurable:true});
Object.defineProperty(window,'innerWidth',{value:1500,configurable:true});
await act(async()=>window.dispatchEvent(new Event('resize')));
await act(async()=>document.querySelector('[aria-label="调整任务列表宽度"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})));
check("v123 resizing is constrained and saved independently of drafts",()=>{
 assert.equal(pane.style.width,'420px');
 assert.equal(localStorage.getItem('chigetang-oneclick-task-width'),'420');
});
await act(async()=>useApp.getState().setPage('生成视频'));
check("v123 video task heading is unified",()=>assert(document.querySelector('.queue h3')?.textContent?.includes('任务列表')));
window.aiVideo.invoke = originalInvoke;
await act(async()=>useApp.getState().setDraft({...useApp.getState().draft!,modelId:'missing-model',prompt:'保留我的提示词'}));
check('v128 无效模型提供修复入口且保留草稿',()=>{assert(document.body.textContent?.includes('草稿模型不存在'));assert.equal(useApp.getState().draft?.prompt,'保留我的提示词');});
await select('[aria-label="视频引擎"]','volcengine');
check('v128 引擎选择修复无效模型',()=>assert.equal(useApp.getState().draft?.modelId,'seedance15'));
const savedAssets=structuredClone(useApp.getState().draft!.assets);
await select('[aria-label="视频引擎"]','kling');
check('v128 切换可灵保留Prompt和素材并使用模型参数',()=>{assert.equal(useApp.getState().draft?.prompt,'保留我的提示词');assert.deepEqual(useApp.getState().draft?.assets,savedAssets);assert.equal(useApp.getState().draft?.params.resolution,'1080P');assert(!Object.hasOwn(useApp.getState().draft!.params,'seed'));});
await act(async()=>useApp.getState().setPage('小工具'));
check('v128 小工具两张卡片，初始待处理，无文件不可开始',()=>{assert.equal(document.querySelectorAll('.local-tool').length,2);assert.equal([...document.querySelectorAll('.local-tool [role="status"]')].every(e=>e.textContent==='待处理'),true);assert([...document.querySelectorAll<HTMLButtonElement>('.local-tool .primary')].every(e=>e.disabled));});
window.aiVideo.invoke=async(action,p)=>action==='replica.list'?[]:originalInvoke(action,p);
await act(async()=>useApp.getState().setPage('一键复刻'));
check('v128 复刻使用独立页面，编译入口移至新页面',()=>{assert(document.querySelector('.replica-work'));assert(document.body.textContent?.includes('本地任务编译'));assert(!document.querySelector('.oneclick-workbench'));});
window.aiVideo.invoke=originalInvoke;
app.close();
console.log(
  `UI unit checks: ${checks.length} passed. jsdom DOM tests, not visual or Windows tests.`,
);
process.exit(0);
