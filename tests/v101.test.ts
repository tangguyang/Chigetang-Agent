import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Database } from "../src/main/database/db.ts";
import { migrations } from "../src/main/database/schema.ts";
import { WanAdapter } from "../src/main/models/adapters.ts";
import {
  accountAdapter,
  testConnection,
} from "../src/main/providers/accounts.ts";
import { endpoint } from "../src/main/providers/adapters.ts";
import { HttpClient } from "../src/main/providers/http.ts";
import { Application } from "../src/main/services/application.ts";
import { AppError } from "../src/main/services/errors.ts";
import { defaults, models, providers } from "../src/shared/catalog.ts";
import { taskDeletionOptions } from "../src/shared/deletion.ts";
import {
  compilePrompt,
  insertMention,
  mentionCandidates,
  normalizeDraft,
  rebaseMentions,
} from "../src/shared/mentions.ts";
import { estimateCost } from "../src/shared/pricing.ts";
import type {
  Asset,
  Draft,
  Json,
  Price,
  Snapshot,
} from "../src/shared/types.ts";
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
  const root = mkdtempSync(join(tmpdir(), "v101-"));
  const a = new Application(
    root,
    vault,
    async () => ({ width: 720, height: 1280, duration: 5, hasAlpha: false }),
    () => {},
    () => {},
  );
  const account = a.credentials.save({
    name: "QA",
    providerId: "alibaba",
    modelPrices: {}, // This fixture deliberately uses model-level prices.
    workspaceId: " ws-test-abc\u200b ",
    region: "cn-beijing",
    key: "fixture-only-not-a-real-key",
  });
  const draft = {
    ...a.newDraft(),
    accountId: account.id,
    prompt: "测试产品展示",
    params: {
      ...defaults(models[0]),
      duration: 12,
      resolution: "720P",
      ratio: "9:16",
    },
  };
  return { a, root, account, draft };
}
function snapshot(): Snapshot {
  const { a, account, draft } = setup();
  a.close();
  return {
    draft,
    model: structuredClone(models[0]),
    provider: structuredClone(providers[0]),
    account,
    assets: [],
    price: models[0].price,
    estimatedCost: { amount: null, currency: "CNY", kind: "unknown", note: "" },
    createdAt: new Date().toISOString(),
    appVersion: "1.0.1",
  };
}
const price: Price = {
  currency: "CNY",
  unit: "second",
  rate: null,
  source: "TEST configuration, not official price",
  updatedAt: "2026-09-16",
  rules: [
    { id: "720", resolution: "720P", rate: 0.2, unit: "second" },
    { id: "1080", resolution: "1080P", rate: 0.4, unit: "second" },
    {
      id: "ref",
      resolution: "720P",
      inputType: "video",
      rate: 0.3,
      unit: "second",
      basis: "input_output",
    },
    { id: "sound", resolution: "720P", audio: true, rate: 0.5, unit: "second" },
  ],
};
function asset(id: string, kind: "image" | "video"): Asset {
  return {
    id,
    name: id + "." + (kind === "image" ? "png" : "mp4"),
    kind,
    mime: kind === "image" ? "image/png" : "video/mp4",
    size: 40,
    originalPath: "/fixture",
    managedPath: null,
    hash: id,
    createdAt: "2026-09-16",
    lastUsedAt: null,
    tags: [],
    folder: "",
    projectId: null,
    favorite: false,
    width: 720,
    height: 1280,
    duration: kind === "video" ? 5 : undefined,
  };
}
function mentionFixture() {
  const s = snapshot();
  const assets = [
    asset("v", "video"),
    asset("i", "image"),
    asset("j", "image"),
  ];
  let draft = normalizeDraft({
    ...s.draft,
    prompt: "@",
    assets: assets.map((a) => ({
      assetId: a.id,
      role: a.kind === "video" ? "reference_video" : "reference_image",
    })),
  });
  draft = insertMention(
    draft,
    0,
    1,
    mentionCandidates(draft.assets, assets)[0],
  );
  draft = { ...draft, prompt: draft.prompt + "@" };
  draft = insertMention(
    draft,
    draft.prompt.length - 1,
    draft.prompt.length,
    mentionCandidates(draft.assets, assets)[1],
  );
  return { s, assets, draft };
}

test("v1.0.0 migration preserves all legacy tables, encrypted credential, draft ratio and backups", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate101-")),
    file = join(root, "db.sqlite");
  const old = new DatabaseSync(file);
  old.exec(migrations[0].sql);
  old.exec("PRAGMA user_version=1");
  old.prepare("INSERT INTO settings VALUES(?,?)").run(
    "draft",
    JSON.stringify({
      name: "legacy",
      prompt: "long".repeat(4000),
      params: { ratio: "16:9" },
      assets: [],
    }),
  );
  old
    .prepare("INSERT INTO credentials VALUES(?,?,?)")
    .run("old", '{"workspace_id":"ws-legacy"}', Buffer.from([1, 2, 3]));
  old
    .prepare("INSERT INTO models VALUES(?,?)")
    .run("old", JSON.stringify({ price: { rate: 0.3 } }));
  old.close();
  const db = new Database(file);
  assert.equal(
    db.one<{ user_version: number }>("PRAGMA user_version")?.user_version,
    5,
  );
  const draft = db.get<Draft>("draft", {} as Draft);
  assert.equal(draft.params.ratio, "16:9");
  assert.equal(draft.draftId, "legacy-draft");
  assert.equal(draft.prompt.length, 16000);
  assert.equal(db.all("SELECT * FROM drafts").length, 1);
  assert.equal(db.all("SELECT * FROM credentials").length, 1);
  assert(readdirSync(root).some((n) => n.startsWith("pre-migration-")));
  db.close();
});
test("migration failure rolls back without erasing v1 data", () => {
  const root = mkdtempSync(join(tmpdir(), "rollback-")),
    file = join(root, "db.sqlite");
  const old = new DatabaseSync(file);
  old.exec(migrations[0].sql);
  old.exec(
    "PRAGMA user_version=1; CREATE TABLE drafts(sentinel TEXT); INSERT INTO drafts VALUES('keep');",
  );
  old.close();
  assert.throws(() => new Database(file));
  const inspect = new DatabaseSync(file);
  assert.equal(inspect.prepare("PRAGMA user_version").get()?.user_version, 1);
  assert.equal(
    inspect.prepare("SELECT sentinel FROM drafts").get()?.sentinel,
    "keep",
  );
  assert(readdirSync(root).some((n) => n.startsWith("pre-migration-")));
  inspect.close();
});
test("workspace ws- saves normalizes reads and decrypts; partial edits preserve fields", () => {
  const { a, account } = setup();
  assert.equal(account.workspaceId, "ws-test-abc");
  const changed = a.credentials.save({ id: account.id, name: "renamed" });
  assert.equal(changed.workspaceId, account.workspaceId);
  assert.equal(changed.region, "cn-beijing");
  assert.equal(a.credentials.getKey(account.id), "fixture-only-not-a-real-key");
  assert(!JSON.stringify(changed).includes("fixture-only"));
  a.close();
});
test("legacy workspace_id and workspaceID aliases read and save", () => {
  const { a, account } = setup();
  for (const field of ["workspace_id", "workspaceID"]) {
    const legacy: Record<string, unknown> = {
      ...account,
      [field]: "ws-legacy",
    };
    delete legacy.workspaceId;
    a.db.run(
      "UPDATE credentials SET data=? WHERE id=?",
      JSON.stringify(legacy),
      account.id,
    );
    assert.equal(a.credentials.list()[0].workspaceId, "ws-legacy");
    const updated = a.credentials.save({ id: account.id, [field]: "ws-next" });
    assert.equal(updated.workspaceId, "ws-next");
  }
  a.close();
});
test("WAN endpoint builds from ws- workspace and region, strips video path, rejects chat", () => {
  const s = snapshot();
  assert.equal(endpoint(s), "https://ws-test-abc.cn-beijing.maas.aliyuncs.com");
  s.account.endpoint =
    "https://old.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis";
  assert.equal(endpoint(s), "https://ws-test-abc.cn-beijing.maas.aliyuncs.com");
  s.account.endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  assert.throws(() => endpoint(s), /compatible-mode/);
});
for (const status of [400, 401, 403, 429, 500])
  test(`HTTP ${status} preserves code,message,request_id and redacts secret`, async () => {
    const http = new HttpClient(
      async () =>
        Response.json(
          {
            code: "ExplicitCode",
            message: "fixture-only-not-a-real-key invalid argument",
            request_id: "r-123",
          },
          { status },
        ),
      undefined,
      0,
    );
    await assert.rejects(
      () => http.request("https://example.com", "fixture-only-not-a-real-key"),
      (e: unknown) => {
        assert(e instanceof AppError);
        assert.equal(e.details?.httpStatus, status);
        assert.equal(e.details?.code, "ExplicitCode");
        assert.equal(e.details?.requestId, "r-123");
        assert(e.message.includes("invalid argument"));
        assert(!e.message.includes("fixture-only"));
        return true;
      },
    );
  });
test("connection test only GET, checks workspace/region/model and never generates", async () => {
  const s = snapshot();
  let url = "",
    method = "";
  const http = new HttpClient(
    async (u, o) => {
      url = String(u);
      method = o?.method || "";
      return Response.json({ data: {} });
    },
    undefined,
    0,
  );
  const r = await testConnection(
    s.account,
    s.model,
    s.provider,
    () => "fixture-key",
    http,
  );
  assert(r.ok && r.keyLoaded);
  assert.equal(r.workspaceId, "ws-test-abc");
  assert.equal(method, "GET");
  assert(url.includes("/api/v1/uploads?action=getPolicy&model=wan3.0-video"));
  assert(!JSON.stringify(r).includes("fixture-key"));
});
test("connection errors preserve HTTP diagnostic", async () => {
  const s = snapshot();
  const r = await testConnection(
    s.account,
    s.model,
    s.provider,
    () => "test",
    new HttpClient(
      async () =>
        Response.json(
          { code: "InvalidApiKey", message: "expired", request_id: "r" },
          { status: 401 },
        ),
      undefined,
      0,
    ),
  );
  assert(!r.ok);
  assert.equal(r.details?.httpStatus, 401);
  assert(r.error?.includes("expired"));
});
test("both providers report unsupported balance without fabricated value", async () => {
  for (const p of providers) {
    const b = await accountAdapter(p).balance();
    assert.equal(b.supported, false);
    assert(b.message.includes("暂不支持"));
    assert(!("amount" in b));
  }
});
test("estimated cost depends on duration and resolution", () => {
  const s = snapshot();
  s.price = price;
  assert.equal(estimateCost(s).amount, 2.4);
  s.draft.params.duration = 6;
  assert.equal(estimateCost(s).amount, 1.2);
  s.draft.params.resolution = "1080P";
  assert.equal(estimateCost(s).amount, 2.4);
});
test("model price, sound, reference input and region select independent price rules", () => {
  const s = snapshot();
  s.price = price;
  s.assets = [{ ...asset("video", "video"), role: "reference_video" }];
  assert.equal(estimateCost(s).amount, 5.1);
  s.assets = [];
  s.draft.params.audio = true;
  assert.equal(estimateCost(s).amount, 6);
  s.price = {
    ...price,
    rules: [
      { id: "region", region: "ap-southeast-1", rate: 1, unit: "second" },
    ],
  };
  assert.equal(estimateCost({ ...s, region: "cn-beijing" }).amount, null);
  assert.equal(estimateCost({ ...s, region: "ap-southeast-1" }).amount, 12);
  s.price = { ...price, rules: [], rate: 2 };
  assert.equal(estimateCost(s).amount, 24);
});
test("unconfigured price stays unknown; tokens only estimated with explicit conversion", () => {
  const s = snapshot();
  assert.equal(estimateCost(s).amount, null);
  s.price = { ...price, unit: "million_tokens", rate: 4, rules: [] };
  assert.equal(estimateCost(s).amount, null);
  s.price.rules = [
    { id: "tokens", unit: "million_tokens", rate: 4, tokensPerSecond: 100000 },
  ];
  assert.equal(estimateCost(s).amount, 4.8);
});
test("new task defaults 9:16 and leaves saved/history ratio unchanged", async () => {
  const { a, draft } = setup();
  a.saveDraft({ ...draft, params: { ...draft.params, ratio: "16:9" } });
  const t = await a.tasks.create(
    { ...draft, params: { ...draft.params, ratio: "4:3" } },
    "history",
  );
  const d = a.newDraft();
  assert.equal(d.params.ratio, "9:16");
  assert.equal(d.prompt, "");
  assert.equal(d.assets.length, 0);
  assert.equal(a.drafts.get(draft.draftId!).params.ratio, "16:9");
  assert.equal(a.tasks.get(t.id).snapshot.draft.params.ratio, "4:3");
  assert.notEqual(d.draftId, draft.draftId);
  a.close();
});
test("multiple drafts and mention metadata persist after restart", () => {
  const { a, root, draft } = setup();
  const d = a.saveDraft({ ...draft, prompt: "x".repeat(11000) });
  a.newDraft();
  a.close();
  const restarted = new Application(
    root,
    vault,
    async () => ({}),
    () => {},
    () => {},
  );
  assert.equal(restarted.drafts.get(d.draftId!).prompt.length, 11000);
  assert.equal(restarted.drafts.list().length, 2);
  restarted.close();
});
test("copy task preserves all parameters as independent unsubmitted draft without API", async () => {
  const { a, draft } = setup();
  const t = await a.tasks.create(draft, "copy");
  const copy = a.tasks.cloneDraft(t.id, true);
  a.saveDraft(copy);
  assert.equal(a.tasks.list().total, 1);
  assert.deepEqual(copy.params, draft.params);
  assert.equal(copy.prompt, draft.prompt);
  assert.equal(copy.groupId, undefined);
  assert.equal(copy.parentVersionId, undefined);
  assert.notEqual(copy.draftId, draft.draftId);
  assert.equal(a.tasks.get(t.id).apiTaskId, null);
  a.close();
});
test("deleting queued task hides record, cancels local queue, retains immutable snapshot and billing", async () => {
  const { a, draft } = setup();
  const t = await a.tasks.create(draft, "remove");
  a.tasks.removeRecord(t.id);
  assert.equal(a.tasks.list().total, 0);
  assert.equal(a.tasks.get(t.id).status, "Cancelled");
  assert.equal(a.billing.report().total, 1);
  assert.equal(a.tasks.get(t.id).snapshot.draft.prompt, draft.prompt);
  a.close();
});
test("deleting cloud processing task retains state/id for recovery and billing", async () => {
  const { a, draft } = setup();
  const t = await a.tasks.create(draft, "cloud-delete");
  t.status = "Processing";
  t.apiTaskId = "cloud-id";
  t.submittedAt = new Date().toISOString();
  a.tasks.save(t);
  a.tasks.removeRecord(t.id);
  a.tasks.recover();
  const stored = a.tasks.get(t.id);
  assert.equal(stored.status, "Processing");
  assert.equal(stored.apiTaskId, "cloud-id");
  assert(stored.deletedAt);
  assert.equal(a.tasks.list().total, 0);
  a.close();
});
test("images/videos reuse Asset ID; duplicate import no file duplication; picker filters search", async () => {
  const { a, root } = setup();
  for (const [name, data] of [
    ["product.png", "image-fixture"],
    ["template.mp4", "video-fixture"],
  ])
    writeFileSync(join(root, name), data);
  const image = (await a.assets.import(join(root, "product.png"), false)).asset;
  const video = (await a.assets.import(join(root, "template.mp4"), false))
    .asset;
  assert.equal(
    (await a.assets.import(join(root, "product.png"), true)).asset.id,
    image.id,
  );
  assert.equal((await a.assets.list({ kind: "image" })).items[0].id, image.id);
  assert.equal((await a.assets.list({ kind: "video" })).items[0].id, video.id);
  assert.equal((await a.assets.list({ search: "product" })).total, 1);
  assert(existsSync(image.originalPath));
  a.close();
});
test("mention menu searches label, filename and role", () => {
  const { assets, draft } = mentionFixture();
  assert.equal(mentionCandidates(draft.assets, assets, "Image").length, 2);
  assert.equal(
    mentionCandidates(draft.assets, assets, "v.mp4")[0].label,
    "Video1",
  );
  draft.assets[1].userRole = "包装正面";
  assert.equal(mentionCandidates(draft.assets, assets, "包装")[0].assetId, "i");
});
test("inserted mentions carry real asset_id and stable bindingId", () => {
  const { draft } = mentionFixture();
  assert.equal(draft.mentions?.length, 2);
  assert.equal(draft.mentions?.[1].assetId, "i");
  assert.equal(draft.mentions?.[1].bindingId, draft.assets[1].bindingId);
  assert(draft.prompt.includes("@Image1"));
});
test("rename and reorder assets preserve mention binding and correct final media index", () => {
  const { draft, assets } = mentionFixture();
  assets[1].name = "renamed.png";
  assert.equal(compilePrompt(draft, assets, "wan3"), "视频1 图1 ");
  draft.assets = [draft.assets[0], draft.assets[2], draft.assets[1]];
  assert.equal(compilePrompt(draft, assets, "wan3"), "视频1 图2 ");
});
test("deleting a mention removes binding only, never selected or library assets", () => {
  const { draft, assets } = mentionFixture();
  const m = draft.mentions![0];
  const after = draft.prompt.slice(0, m.start) + draft.prompt.slice(m.end);
  const retained = rebaseMentions(draft.prompt, after, draft.mentions!);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].assetId, "i");
  assert.equal(draft.assets.length, 3);
  assert.equal(assets.length, 3);
});
test("dangling and pasted unbound tokens fail before API submission", () => {
  const { draft, assets } = mentionFixture();
  assert.throws(
    () =>
      compilePrompt(
        { ...draft, assets: draft.assets.slice(1) },
        assets,
        "wan3",
      ),
    /移除/,
  );
  assert.throws(
    () => compilePrompt({ ...draft, mentions: [] }, assets, "wan3"),
    /未绑定/,
  );
});
test("WAN POST indexed references exactly match ordered media; async header and task_id parsing", async () => {
  const { s, draft, assets } = mentionFixture();
  draft.assets = [draft.assets[0], draft.assets[2], draft.assets[1]];
  s.draft = draft;
  s.assets = draft.assets.map((b) => ({
    ...assets.find((a) => a.id === b.assetId)!,
    role: b.role,
  }));
  let body: Record<string, Json> = {};
  let requested = "";
  const adapter = new WanAdapter(
    new HttpClient(async (u, o) => {
      requested = String(u);
      body = JSON.parse(String(o?.body));
      assert.equal(
        (o?.headers as Record<string, string>)["X-DashScope-Async"],
        "enable",
      );
      return Response.json({
        output: { task_id: "cloud-fixture-id" },
        request_id: "req",
      });
    }),
    async () => "",
  );
  const media = s.assets.map((a) => ({
    type: a.role,
    url: `https://example.com/${a.id}`,
  }));
  const id = await adapter.submitTask(s, "test-secret-not-id", media);
  assert.equal(id, "cloud-fixture-id");
  assert(
    requested.endsWith(
      "/api/v1/services/aigc/video-generation/video-synthesis",
    ),
  );
  const input = body.input as Record<string, Json>;
  assert.equal(input.prompt, "视频1 图2 ");
  assert.deepEqual(input.media, media);
});
test("WAN HTTP200 error without task_id includes actual provider code and request_id", async () => {
  const s = snapshot();
  const adapter = new WanAdapter(
    new HttpClient(async () =>
      Response.json({
        code: "ModelDenied",
        message: "no access",
        request_id: "r-denied",
      }),
    ),
    async () => "",
  );
  await assert.rejects(
    () => adapter.submitTask(s, "fixture", []),
    (e: unknown) => {
      assert(e instanceof AppError);
      assert.equal(e.details?.requestId, "r-denied");
      assert.equal(e.details?.code, "ModelDenied");
      return true;
    },
  );
});
test("corrected account used before submission without overwriting old immutable account snapshot", async () => {
  const { a, account, draft } = setup();
  const t = await a.tasks.create(draft, "fixaccount");
  a.credentials.save({ id: account.id, workspaceId: "ws-corrected" });
  assert.equal(a.tasks.runtimeSnapshot(t).account.workspaceId, "ws-corrected");
  assert.equal(a.tasks.get(t.id).snapshot.account.workspaceId, "ws-test-abc");
  a.close();
});
test("billing keeps estimate/actual separate, filters dates/accounts and retains deleted consumption", async () => {
  const { a, draft } = setup();
  a.updateModel("wan3", { price });
  const t = await a.tasks.create(draft, "bill");
  t.status = "Completed";
  t.submittedAt = "2026-09-16T12:00:00Z";
  t.actualCost = {
    amount: 2,
    currency: "CNY",
    kind: "actual",
    note: "TEST official bill fixture",
  };
  a.tasks.save(t);
  const failed = await a.tasks.create(draft, "billfail");
  failed.status = "Failed";
  failed.submittedAt = "2026-09-15T12:00:00Z";
  a.tasks.save(failed);
  a.tasks.removeRecord(t.id);
  const all = a.billing.report();
  assert.equal(all.total, 2);
  assert.equal(all.totals[0].estimated, 4.8);
  assert.equal(all.totals[0].actual, 2);
  assert.equal(all.totals[0].failedActual, null);
  assert.equal(a.billing.report({ from: "2026-09-16T00:00:00Z" }).total, 1);
  assert.equal(a.billing.report({ accountId: "not-an-account" }).total, 0);
  a.updateModel("wan3", { price: { ...price, rules: [], rate: 9 } });
  assert.equal(a.tasks.get(t.id).snapshot.estimatedCost.amount, 2.4);
  a.close();
});

test("delete confirmation distinguishes active WAN billing from supported Seedance cancel", async () => {
  const { a, draft } = setup();
  const t = await a.tasks.create(draft, "delete-warning");
  assert.equal(taskDeletionOptions(t).message, "确定删除这个任务吗？");
  assert(!taskDeletionOptions(t).active);
  t.status = "Processing";
  t.apiTaskId = "id";
  const wan = taskDeletionOptions(t);
  assert(wan.detail.includes("不会停止云端计费"));
  assert(!wan.canCancel);
  t.snapshot.model.adapter = "seedance";
  assert(taskDeletionOptions(t).canCancel);
  a.close();
});
test("complete v1 database migrates tasks, prompts, assets, account ciphertext and prices unchanged", async () => {
  const { a, root, account, draft } = setup();
  writeFileSync(join(root, "old.png"), "legacy-image");
  const asset = (await a.assets.import(join(root, "old.png"), false)).asset;
  const p = a.prompts.save({ name: "legacy", content: "keep me" });
  const t = await a.tasks.create(
    { ...draft, assets: [{ assetId: asset.id, role: "reference_image" }] },
    "legacytask",
  );
  const file = a.db.path;
  const original = a.db.one<{ data: string }>(
    "SELECT data FROM task_snapshots WHERE version_id=?",
    t.id,
  )!.data;
  const encrypted = a.db.one<{ encrypted: Uint8Array }>(
    "SELECT encrypted FROM credentials WHERE id=?",
    account.id,
  )!.encrypted;
  a.close();
  const old = new DatabaseSync(file);
  old.exec(
    "DROP TABLE cloud_uploads; DROP TABLE voices; DROP TABLE asset_folders; DROP INDEX idx_assets_folder_fav; DROP INDEX idx_assets_fav; DROP INDEX idx_task_kind; DROP TABLE billing_manual; DROP TABLE billing_audit; DROP TABLE drafts; DROP TABLE pricing_configs; DROP TABLE billing_records; PRAGMA user_version=1;",
  );
  old.close();
  const next = new Application(
    root,
    vault,
    async () => ({}),
    () => {},
    () => {},
  );
  assert.equal(
    next.db.one<{ data: string }>(
      "SELECT data FROM task_snapshots WHERE version_id=?",
      t.id,
    )!.data,
    original,
  );
  assert.deepEqual(
    next.db.one<{ encrypted: Uint8Array }>(
      "SELECT encrypted FROM credentials WHERE id=?",
      account.id,
    )!.encrypted,
    encrypted,
  );
  assert.equal(next.assets.get(asset.id).hash, asset.hash);
  assert.equal(
    next.prompts.list().items.find((item) => item.id === p.id)!.content,
    "keep me",
  );
  assert.equal(next.billing.report().total, 1);
  assert.equal(next.tasks.get(t.id).snapshot.draft.params.ratio, "9:16");
  next.close();
});
