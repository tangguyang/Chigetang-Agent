import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brand } from "../src/shared/brand.ts";
import { Application } from "../src/main/services/application.ts";
import { WanAdapter } from "../src/main/models/adapters.ts";
import { HttpClient } from "../src/main/providers/http.ts";
import { defaults, models } from "../src/shared/catalog.ts";
import {
  assignImportedAssets,
  mergeImportedAssets,
  retainDraftAssets,
  migrateDraftToModel,
  replacePromptFromTemplate,
} from "../src/shared/draftCompatibility.ts";
import type { Asset, Draft } from "../src/shared/types.ts";
import { completeSubmittedWorkspace } from "../src/renderer/workspaceLifecycle.ts";

const key = randomBytes(32);
const vault = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([iv, c.update(s), c.final(), c.getAuthTag()]);
  },
  decryptString: (b: Buffer) => {
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString();
  },
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), "v102-"));
  const app = new Application(
    root,
    vault,
    async () => ({ width: 720, height: 1280, duration: 5 }),
    () => {},
    () => {},
  );
  const account = app.credentials.save({
    name: "QA",
    providerId: "alibaba",
    workspaceId: "ws-test",
    region: "cn-beijing",
    key: "fixture-key",
  });
  const draft = {
    ...app.newDraft(),
    accountId: account.id,
    prompt: "测试",
    params: {
      ...defaults(models[0]),
      duration: 5,
      resolution: "720P",
      ratio: "9:16",
    },
  };
  return { app, draft };
}

test("bootstrap and task snapshot report the current app version", async () => {
  const { app, draft } = setup();
  assert.equal(app.bootstrap().version, "1.3.0");
  const task = await app.tasks.create(draft, "req-version");
  assert.equal(task.snapshot.appVersion, brand.version);
  app.close();
});

test("manual status refresh only queries cloud and never re-submits", async () => {
  const { app, draft } = setup();
  let submits = 0,
    queries = 0;
  app.tasks.d.adapter = () =>
    new (class extends WanAdapter {
      constructor() {
        super(new HttpClient(), async () => "/unused");
      }
      override async uploadAssets() {
        return [];
      }
      override async submitTask() {
        submits++;
        return "cloud-1";
      }
      override async getTaskStatus() {
        queries++;
        return {
          status: "processing" as const,
          raw: { output: { task_status: "RUNNING" } },
        };
      }
    })();
  const task = await app.tasks.create(draft, "req-refresh");
  await app.tasks.run(task, new AbortController().signal);
  assert.equal(submits, 1);
  const before = queries;
  await app.tasks.refreshStatus(task.id);
  assert.equal(submits, 1);
  assert.equal(queries, before + 1);
  app.close();
});

test("draft close semantics can preserve draft record while submitted draft removal is explicit", () => {
  const { app } = setup();
  const d1 = app.newDraft(),
    d2 = app.newDraft();
  assert(app.drafts.list().some((d) => d.id === d1.draftId));
  assert(app.drafts.list().some((d) => d.id === d2.draftId));
  app.drafts.remove(d1.draftId!);
  assert(!app.drafts.list().some((d) => d.id === d1.draftId));
  assert(app.drafts.list().some((d) => d.id === d2.draftId));
  app.close();
});

test("batch frame import assigns first and last frame exactly once", () => {
  const image = (id: string): Asset => ({
    id,
    name: `${id}.png`,
    kind: "image",
    originalPath: `/${id}.png`,
    managedPath: null,
    size: 1024,
    mime: "image/png",
    hash: id,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    tags: [],
    folder: "",
    projectId: null,
    favorite: false,
    width: 720,
    height: 1280,
  });
  const additions = assignImportedAssets(
    [],
    [image("one"), image("two"), image("three")],
    ["first_frame", "last_frame"],
    true,
  );
  assert.deepEqual(
    additions.map((item) => item.role),
    ["first_frame", "last_frame"],
  );
  assert.equal(new Set(additions.map((item) => item.assetId)).size, 2);
});

test("model switch preserves compatible bindings and removes only stale mention tokens", () => {
  const wan = models.find((model) => model.id === "wan3")!;
  const seedance = models.find((model) => model.id === "seedance25")!;
  const image: Asset = {
    id: "image",
    name: "front.png",
    kind: "image",
    originalPath: "/front.png",
    managedPath: null,
    size: 1024,
    mime: "image/png",
    hash: "image",
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    tags: [],
    folder: "",
    projectId: null,
    favorite: false,
    width: 720,
    height: 1280,
  };
  const video: Asset = {
    ...image,
    id: "video",
    name: "reference.mp4",
    kind: "video",
    mime: "video/mp4",
    hash: "video",
    originalPath: "/reference.mp4",
    duration: 5,
    fps: 30,
  };
  const prompt = "保留 @Image1，只替换 @Video1。";
  const imageStart = prompt.indexOf("@Image1");
  const videoStart = prompt.indexOf("@Video1");
  const draft: Draft = {
    name: "switch",
    modelId: wan.id,
    accountId: "wan-account",
    projectId: null,
    prompt,
    params: defaults(wan),
    outputDir: "/output",
    assets: [
      {
        assetId: image.id,
        role: "reference_image",
        bindingId: "binding-image",
      },
      {
        assetId: video.id,
        role: "reference_video",
        bindingId: "binding-video",
      },
    ],
    mentions: [
      {
        id: "mention-image",
        assetId: image.id,
        bindingId: "binding-image",
        start: imageStart,
        end: imageStart + "@Image1".length,
        label: "Image1",
      },
      {
        id: "mention-video",
        assetId: video.id,
        bindingId: "binding-video",
        start: videoStart,
        end: videoStart + "@Video1".length,
        label: "Video1",
      },
    ],
  };
  const migrated = migrateDraftToModel(draft, wan, seedance, [image, video]);
  assert.equal(migrated.kept, 2);
  assert.equal(migrated.removed, 0);
  assert.equal(migrated.draft.accountId, "auto");
  assert.equal(migrated.draft.assets[0]?.assetId, image.id);
  assert.equal(migrated.draft.mentions?.length, 2);
  assert(migrated.draft.prompt.includes("@Image1"));
  assert(migrated.draft.prompt.includes("@Video1"));
});

test("Application routes account diagnostics through injected desktop fetcher", async () => {
  const root = mkdtempSync(join(tmpdir(), "v102-fetcher-"));
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.method ?? "GET", "GET");
    return Response.json({
      data: { upload_host: "https://example.aliyuncs.com" },
    });
  };
  const app = new Application(
    root,
    vault,
    async () => ({ width: 720, height: 1280, duration: 5 }),
    () => {},
    () => {},
    fetcher,
  );
  const account = app.credentials.save({
    name: "QA",
    providerId: "alibaba",
    workspaceId: "ws-test",
    region: "cn-beijing",
    key: "fixture-key",
  });
  const result = await app.testAccount(account.id, "wan3");
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  app.close();
});

test("Application routes WAN paid submission through injected desktop fetcher", async () => {
  const root = mkdtempSync(join(tmpdir(), "v102-submit-fetcher-"));
  const calls: { url: string; method: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/video-generation/video-synthesis"))
      return Response.json({
        output: { task_id: "cloud-through-electron-net" },
      });
    if (url.includes("/api/v1/tasks/cloud-through-electron-net"))
      return Response.json({ output: { task_status: "RUNNING" } });
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  const app = new Application(
    root,
    vault,
    async () => ({ width: 720, height: 1280, duration: 5 }),
    () => {},
    () => {},
    fetcher,
  );
  const account = app.credentials.save({
    name: "QA",
    providerId: "alibaba",
    workspaceId: "ws-test",
    region: "cn-beijing",
    key: "fixture-key",
  });
  const wan = models.find((model) => model.id === "wan3")!;
  const task = await app.tasks.create(
    {
      ...app.newDraft(),
      modelId: wan.id,
      accountId: account.id,
      prompt: "测试",
      params: {
        ...defaults(wan),
        duration: 5,
        resolution: "720P",
        ratio: "9:16",
      },
      outputDir: join(root, "outputs"),
    },
    "req-electron-net-submit",
  );
  await app.tasks.run(task, new AbortController().signal);
  assert.equal(task.apiTaskId, "cloud-through-electron-net");
  assert.equal(task.status, "Processing");
  assert.equal(calls[0]?.method, "POST");
  assert(calls[0]?.url.includes("ws-test.cn-beijing.maas.aliyuncs.com"));
  assert.equal(calls.length, 1); // First poll waits until nextPollAt.
  await app.tasks.run(task, new AbortController().signal);
  assert(
    calls.some((call) =>
      call.url.includes("/api/v1/tasks/cloud-through-electron-net"),
    ),
  );
  app.close();
});

test("refresh all is not capped at the newest 100 tasks and reports successes accurately", async () => {
  const { app, draft } = setup();
  let queries = 0;
  app.tasks.d.adapter = () =>
    new (class extends WanAdapter {
      constructor() {
        super(new HttpClient(), async () => "/unused");
      }
      override async uploadAssets() {
        return [];
      }
      override async submitTask() {
        return "unused";
      }
      override async getTaskStatus() {
        queries++;
        return {
          status: "processing" as const,
          raw: { output: { task_status: "RUNNING" } },
        };
      }
    })();
  for (let index = 0; index < 105; index++) {
    const task = await app.tasks.create(
      { ...draft, name: `refresh-${index}` },
      `refresh-all-${index}`,
    );
    task.apiTaskId = `cloud-${index}`;
    task.status = "Processing";
    app.tasks.save(task);
  }
  const result = await app.tasks.refreshAll();
  assert.equal(result.attempted, 105);
  assert.equal(result.succeeded, 105);
  assert.equal(result.failed, 0);
  assert.equal(result.count, 105);
  assert.equal(queries, 105);
  app.close();
});

test("applying a Prompt template clears stale mention metadata but preserves selected assets", () => {
  const wan = models.find((model) => model.id === "wan3")!;
  const draft: Draft = {
    name: "template",
    modelId: wan.id,
    accountId: "auto",
    projectId: null,
    prompt: "旧提示 @Image1",
    params: defaults(wan),
    outputDir: "/output",
    assets: [
      { assetId: "image", role: "reference_image", bindingId: "binding-image" },
    ],
    mentions: [
      {
        id: "mention-image",
        assetId: "image",
        bindingId: "binding-image",
        start: 4,
        end: 11,
        label: "Image1",
      },
    ],
  };
  const next = replacePromptFromTemplate(draft, "新的模板提示词");
  assert.equal(next.prompt, "新的模板提示词");
  assert.deepEqual(next.mentions, []);
  assert.deepEqual(next.assets, draft.assets);
});

test("paid submission timeout is configurable and never auto-resubmits", async () => {
  let calls = 0;
  const http = new HttpClient(async (_input, init) => {
    calls++;
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error("missing signal"));
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });
  // AbortSignal.timeout uses an unref'ed timer in Node, so keep this test alive
  // long enough to observe the abort without changing production behavior.
  const keepAlive = setTimeout(() => undefined, 100);
  try {
    await assert.rejects(
      () =>
        http.request("https://example.com", "fixture", {
          method: "POST",
          paidSubmit: true,
          timeoutMs: 10,
        }),
      /1 秒内未返回任务 ID/,
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(calls, 1);
});

test("submitted workspace cleanup never replaces a newer workspace selected mid-flight", async () => {
  let current = "A";
  let releaseFinish!: () => void;
  const finishGate = new Promise<void>((resolve) => {
    releaseFinish = resolve;
  });
  let cancelled = 0;
  let replacements = 0;
  let activated = 0;
  const running = completeSubmittedWorkspace("A", {
    currentDraftId: () => current,
    cancelPendingSave: () => {
      cancelled++;
    },
    finishSubmitted: () => finishGate,
    afterFinish: () => undefined,
    createReplacement: async () => {
      replacements++;
      return "NEW";
    },
    activateReplacement: () => {
      activated++;
    },
    onFinishError: () => undefined,
    refreshDrafts: async () => undefined,
  });
  current = "B";
  releaseFinish();
  await running;
  assert.equal(current, "B");
  assert.equal(cancelled, 1);
  assert.equal(replacements, 0);
  assert.equal(activated, 0);
});

test("submitted workspace cleanup re-checks ownership after replacement creation", async () => {
  let current = "A";
  let releaseReplacement!: () => void;
  const replacementGate = new Promise<void>((resolve) => {
    releaseReplacement = resolve;
  });
  let creating = false;
  let activated = 0;
  const running = completeSubmittedWorkspace("A", {
    currentDraftId: () => current,
    cancelPendingSave: () => undefined,
    finishSubmitted: async () => undefined,
    afterFinish: () => undefined,
    createReplacement: async () => {
      creating = true;
      await replacementGate;
      return "NEW";
    },
    activateReplacement: () => {
      activated++;
    },
    onFinishError: () => undefined,
    refreshDrafts: async () => undefined,
  });
  while (!creating) await new Promise((resolve) => setImmediate(resolve));
  current = "B";
  releaseReplacement();
  await running;
  assert.equal(current, "B");
  assert.equal(activated, 0);
});

test("v103 import completion preserves newer edits and rejects switched workspaces/models", () => {
  const { app, draft } = setup();
  const asset = { id: "new-image", kind: "image" } as Asset;
  const latest = {
    ...draft,
    prompt: "Edited while importing",
    params: { ...draft.params, duration: 8 },
  };
  const merged = mergeImportedAssets(
    draft,
    latest,
    [asset],
    ["reference_image"],
    false,
  )!;
  assert.equal(merged.prompt, latest.prompt);
  assert.equal(merged.params.duration, 8);
  assert.equal(merged.assets.length, 1);
  assert.equal(
    mergeImportedAssets(
      draft,
      { ...latest, draftId: "another" },
      [asset],
      ["reference_image"],
      false,
    ),
    null,
  );
  assert.equal(
    mergeImportedAssets(
      draft,
      { ...latest, modelId: "another" },
      [asset],
      ["reference_image"],
      false,
    ),
    null,
  );
  app.close();
});

test("v103 material removal deletes matching tokens and rebases remaining mentions", () => {
  const { app, draft } = setup();
  const a = { assetId: "a", bindingId: "ba", role: "reference_image" as const };
  const b = { assetId: "b", bindingId: "bb", role: "reference_image" as const };
  const source = {
    ...draft,
    assets: [a, b],
    prompt: "@Image1 and @Image2",
    mentions: [
      {
        id: "ma",
        assetId: "a",
        bindingId: "ba",
        start: 0,
        end: 7,
        label: "Image1",
      },
      {
        id: "mb",
        assetId: "b",
        bindingId: "bb",
        start: 12,
        end: 19,
        label: "Image2",
      },
    ],
  };
  const kept = retainDraftAssets(source, [b]);
  assert.equal(kept.prompt, " and @Image1");
  assert.equal(kept.mentions![0].start, 5);
  assert.equal(kept.mentions![0].end, 12);
  const empty = retainDraftAssets(source, []);
  assert.equal(empty.prompt, " and ");
  assert.deepEqual(empty.mentions, []);
  assert.equal(source.mentions.length, 2);
  app.close();
});
