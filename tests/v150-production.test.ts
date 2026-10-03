import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../src/main/services/application.ts";
import {
  ProductionService,
  generatedAsset,
} from "../src/main/services/production.ts";
import { CoreAssetService } from "../src/main/services/coreAssets.ts";
import { CopyWorkflowService } from "../src/main/services/copyWorkflow.ts";
import { productionContext } from "../src/main/services/productionContext.ts";
import { defaults } from "../src/shared/catalog.ts";
import { CapabilityRegistry } from "../src/main/capabilities/registry.ts";
import { registerApplicationCapabilities } from "../src/main/capabilities/catalog.ts";
import type { Draft } from "../src/shared/types.ts";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ctg-v150-"));
  const app = new Application(
    root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    async () => ({}),
    () => {},
    () => {},
    async () => {
      throw Error("NO NETWORK");
    },
  );
  app.credentials.save({
    providerId: "alibaba",
    name: "fake",
    key: "offline-test-not-real",
    workspaceId: "test",
    enabled: true,
    isDefault: true,
  });
  const model = app.models().find((m) => m.id === "wan-safe")!;
  const draft: Draft = {
    name: "生产方案",
    modelId: model.id,
    accountId: "auto",
    projectId: null,
    prompt: "完整Prompt，不截断。",
    params: { ...defaults(model), duration: 5 },
    assets: [],
    outputDir: join(root, "outputs"),
  };
  const core = new CoreAssetService(app, join(root, "core"));
  let copy!: CopyWorkflowService;
  const index = new ProductionService(
    app,
    async (v2) =>
      v2
        ? [
            {
              taskId: "V2",
              name: "口播V2",
              createdAt: new Date().toISOString(),
              windows: [{ versions: [{ path: join(root, "v2.wav") }] }],
              finals: [],
            },
          ]
        : [],
    () => copy.list().map((w) => ({ ...w, feature: "一键复制" })),
  );
  copy = new CopyWorkflowService(app, core, (id, d, f) => index.mark(id, d, f));
  return { root, app, core, index, copy, draft };
}
test("v150 GUI/Codex indexed TaskService records, task note/favorite separate from asset, restart persistence", async () => {
  const f = fixture();
  try {
    const t = await productionContext.run({ driver: "Codex" }, () =>
      f.app.tasks.create(f.draft, "agent1", undefined, true),
    );
    const gui = await productionContext.run({ driver: "GUI" }, () =>
      f.app.tasks.create(
        { ...f.draft, name: "人工任务" },
        "gui1",
        undefined,
        true,
      ),
    );
    assert.equal((await f.index.get("task:" + t.id)).driver, "Codex");
    assert.equal((await f.index.get("task:" + gui.id)).driver, "GUI");
    await f.index.update("task:" + t.id, {
      note: "纤姿咖黄金结构",
      favorite: true,
    });
    const found = await f.index.list({ search: "黄金", favorite: true });
    assert.equal(found.total, 1);
    assert.equal(found.items[0].note, "纤姿咖黄金结构");
    assert.equal((await f.index.list({ driver: "GUI" })).total, 1);
    assert.equal((await f.index.get("speech-v2:V2")).outputs.length, 1);
    f.app.db.close();
    const reopened = new Application(
      f.root,
      {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
      async () => ({}),
      () => {},
      () => {},
      async () => {
        throw Error("NO NETWORK");
      },
    );
    try {
      const i = new ProductionService(
        reopened,
        async () => [],
        () => [],
      );
      const r = await i.get("task:" + t.id);
      assert.equal(r.favorite, true);
      assert.equal(r.note, "纤姿咖黄金结构");
      assert.equal(r.driver, "Codex");
    } finally {
      reopened.close();
    }
  } finally {
    if (f.app.db.db.isOpen) f.app.close();
  }
});
test("v150 copy creates exact variants, preview/confirm invalidation, idempotent batch and existing TaskService reuse", async () => {
  const f = fixture();
  try {
    const w = await f.copy.create(
      {
        requestId: "batch1",
        name: "复制五版",
        draft: f.draft,
        count: 5,
        variants: Array.from({ length: 5 }, (_, i) => ({
          prompt: f.draft.prompt + " " + i,
        })),
      },
      "Codex",
    );
    assert.equal(w.drafts.length, 5);
    assert.equal(w.drafts[4].prompt, f.draft.prompt + " 4");
    assert.equal(
      (
        await f.copy.create(
          { requestId: "batch1", name: "duplicate", draft: f.draft, count: 5 },
          "GUI",
        )
      ).id,
      w.id,
    );
    await assert.rejects(() => f.copy.submit(w.id), /预检/);
    const p = await f.copy.preflight(w.id);
    assert.deepEqual(p.issues, []);
    await f.copy.confirm(w.id, 1);
    let resumes = 0;
    f.app.tasks.resume = (id: string) => {
      resumes++;
      const t = f.app.tasks.get(id);
      t.status = "Completed";
      t.outputPath = join(f.root, id + ".mp4");
      writeFileSync(t.outputPath, "fake output");
      f.app.tasks.save(t);
      return t;
    };
    const done = await f.copy.submit(w.id);
    assert.equal(done.taskIds.length, 5);
    assert.equal(resumes, 5);
    assert.equal(
      done.tasks.every((t) => t.status === "Completed"),
      true,
    );
    await f.copy.submit(w.id);
    assert.equal(resumes, 5);
    const list = await f.index.list({ feature: "一键复制", driver: "Codex" });
    assert.equal(list.total, 5);
    assert.equal((await f.index.output(list.items[0].id)).kind, "video");
  } finally {
    f.app.close();
  }
});
test("v150 interrupted copy never silently resubmits, malformed params and changed configuration reject", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      () =>
        f.copy.create(
          { requestId: "bad", name: "bad", draft: f.draft, count: 101 },
          "GUI",
        ),
      /1–100/,
    );
    const w = await f.copy.create(
      { requestId: "batch2", name: "copy", draft: f.draft, count: 2 },
      "GUI",
    );
    await f.copy.preflight(w.id);
    await f.copy.confirm(w.id, 1);
    const stored = f.copy.list();
    stored[0].drafts[0].prompt += " changed";
    f.app.db.set("copy:workflows", stored);
    await assert.rejects(() => f.copy.submit(w.id), /预检/);
    stored[0].state = "submitting";
    f.app.db.set("copy:workflows", stored);
    await assert.rejects(() => f.copy.submit(w.id), /中断/);
  } finally {
    f.app.close();
  }
});
test("v150 explicitly designated core alias persists SHA256, references existing assets, resists silent overwrite/tamper", async () => {
  const f = fixture();
  try {
    f.core.initialize();
    assert.deepEqual(f.core.list(), []);
    const file = join(f.root, "person.png");
    writeFileSync(
      file,
      Buffer.from([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 2,
        208, 0, 0, 5, 0, 2, 0,
      ]),
    );
    await assert.rejects(
      () =>
        f.core.register({
          alias: "我的人物",
          type: "person",
          path: file,
          designated: false,
        }),
      /明确/,
    );
    const a = await f.core.register({
      alias: "我的人物",
      type: "person",
      path: file,
      description: "测试人物",
      designated: true,
    });
    unlinkSync(file);
    assert.equal((await f.core.resolve("我的人物")).sha256, a.sha256);
    assert.equal(
      await f.app.assets.verify(f.app.assets.get(a.assetId)),
      a.path,
    );
    await assert.rejects(
      () =>
        f.core.register({
          alias: "我的人物",
          type: "person",
          path: a.path,
          designated: true,
        }),
      /已存在/,
    );
    const w = await f.copy.create(
      {
        requestId: "core-copy",
        name: "core",
        count: 1,
        draft: f.draft,
        bindings: [{ alias: "我的人物", role: "reference_image" }],
      },
      "Codex",
    );
    assert.equal(w.drafts[0].assets[0].assetId, a.assetId);
    writeFileSync(a.path, "tampered");
    await assert.rejects(() => f.core.resolve("我的人物"), /SHA256/);
  } finally {
    f.app.close();
  }
});
test("v150 Qwen generated asset is indexed, task favorite does not mutate asset favorite; failed operation persists", async () => {
  const f = fixture();
  try {
    const path = join(f.root, "result.wav");
    const b = Buffer.alloc(44);
    b.write("RIFF");
    b.write("WAVE", 8);
    writeFileSync(path, b);
    const a = (await f.app.assets.import(path, false)).asset;
    a.metadata = { source: "generated", model: "qwen-audio-3.0-tts-plus" };
    f.app.assets.save(a);
    assert.equal(generatedAsset(a), true);
    await f.index.update("asset:" + a.id, { favorite: true, note: "音频备注" });
    assert.equal(f.app.assets.get(a.id).favorite, false);
    await assert.rejects(
      () =>
        f.index.execute(
          "Qwen",
          "Codex",
          { text: "完整长文", model: "qwen" },
          async () => {
            throw Error("fake failure");
          },
        ),
      /fake failure/,
    );
    const failures = await f.index.list({ status: "Failed" });
    assert.equal(failures.total, 1);
    assert.equal(failures.items[0].driver, "Codex");
    assert.equal((failures.items[0].params as any).text, "完整长文");
    const result = await f.index.execute(
      "Qwen",
      "GUI",
      { text: "正文", model: "qwen" },
      async () => ({ outputPath: path, assetId: a.id }),
    );
    assert.equal(
      (await f.index.get(result.productionTaskId)).outputs[0].path,
      path,
    );
    assert.equal(
      (await f.index.list()).items.filter((x) =>
        x.outputs.some((o) => o.path === path),
      ).length,
      1,
    );
  } finally {
    f.app.close();
  }
});
test("v150 Qwen failure and unknown submission survive restart without retry", async () => {
  const f = fixture();
  let calls = 0;
  for (const code of ["ProviderError", "SubmissionUnknown"]) {
    await assert.rejects(() =>
      f.index.execute(
        "Qwen",
        "Codex",
        { text: "完整文案", rate: 1.1, pitch: 0.9, volume: 70, seed: 42 },
        async () => {
          calls++;
          throw Object.assign(new Error(code), { code });
        },
      ),
    );
  }
  const unknown = (await f.index.list({ status: "unknown_result" })).items[0];
  await f.index.update(unknown.id, { note: "云端结果待核对", favorite: true });
  f.app.close();
  const reopened = new Application(
    f.root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    async () => ({}),
    () => {},
    () => {},
    async () => {
      throw Error("NO NETWORK");
    },
  );
  try {
    const index = new ProductionService(
      reopened,
      async () => [],
      () => [],
    );
    assert.equal((await index.list({ status: "Failed" })).total, 1);
    const result = await index.get(unknown.id);
    assert.equal(result.status, "unknown_result");
    assert.equal(result.favorite, true);
    assert.equal(result.note, "云端结果待核对");
    assert.equal((result.params as any).seed, 42);
    assert.equal(calls, 2);
  } finally {
    reopened.close();
  }
});
test("v150 MCP capability validation and paid gate protect batch submit before service dispatch", async () => {
  const r = new CapabilityRegistry();
  let calls = 0;
  registerApplicationCapabilities(r, async () => {
    calls++;
    return true;
  });
  for (const req of [
    { capability: "copy.submit", params: { id: "x" } },
    { capability: "copy.create", params: { requestId: "x", count: 0 } },
    {
      capability: "core-assets.register",
      params: { alias: "x", type: "person", path: "x", designated: false },
    },
    {
      capability: "production.update",
      params: { id: "x", note: "x".repeat(4001) },
    },
  ])
    assert.equal((await r.executeCapability(req)).status, "failed");
  assert.equal(calls, 0);
  assert.equal(
    (
      await r.executeCapability({
        capability: "production.update",
        params: { id: "task:x", favorite: true },
      })
    ).status,
    "succeeded",
  );
  assert.equal(calls, 1);
});
test("v150 complete copy workflow runs existing TaskService upload/submit/poll/download with fake provider, no network", async () => {
  const f = fixture();
  try {
    let submissions = 0,
      downloads = 0;
    const original = f.app.tasks.d.adapter;
    f.app.tasks.d.adapter = (model) => {
      const real = original(model);
      return {
        ...real,
        validateInput: real.validateInput,
        uploadAssets: async () => [],
        submitTask: async () => {
          submissions++;
          return "fake-" + submissions;
        },
        getTaskStatus: async () => ({
          status: "succeeded" as const,
          url: "https://offline.invalid/video",
          raw: {},
        }),
        getResult: () => "https://offline.invalid/video",
        downloadResult: async (_url, path) => {
          downloads++;
          writeFileSync(
            path,
            Buffer.from(
              "000000186674797069736f6d0000020069736f6d69736f32",
              "hex",
            ),
          );
          return path;
        },
      };
    };
    const w = await f.copy.create(
      {
        requestId: "end-to-end",
        name: "完整复制流程",
        draft: f.draft,
        count: 3,
      },
      "Codex",
    );
    const p = await f.copy.preflight(w.id);
    assert.deepEqual(p.issues, []);
    await f.copy.confirm(w.id, 1);
    const submitted = await f.copy.submit(w.id);
    for (const id of submitted.taskIds) {
      await f.app.tasks.run(f.app.tasks.get(id), new AbortController().signal);
      await f.app.tasks.run(f.app.tasks.get(id), new AbortController().signal);
    }
    assert.equal(submissions, 3);
    assert.equal(downloads, 3);
    assert(f.copy.get(w.id).tasks.every((t) => t.status === "Completed"));
    const view = await f.index.list({ feature: "一键复制" });
    assert.equal(view.total, 3);
    assert(
      view.items.every((t) => t.driver === "Codex" && t.outputs.length === 1),
    );
    assert.equal(f.index.uploads().total, 0);
    await f.copy.submit(w.id);
    assert.equal(submissions, 3);
  } finally {
    f.app.close();
  }
});
