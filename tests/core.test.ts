import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Database } from "../src/main/database/db.ts";
import { SeedanceAdapter, WanAdapter } from "../src/main/models/adapters.ts";
import { validateInput } from "../src/main/models/validation.ts";
import { HttpClient } from "../src/main/providers/http.ts";
import { Application } from "../src/main/services/application.ts";
import { finalCost } from "../src/main/services/cost.ts";
import type { Vault } from "../src/main/services/credentials.ts";
import { DownloadManager } from "../src/main/services/downloads.ts";
import { AppError, httpError } from "../src/main/services/errors.ts";
import { Logger } from "../src/main/services/logger.ts";
import { defaults, models, providers } from "../src/shared/catalog.ts";
import type {
  Account,
  Asset,
  Draft,
  Json,
  Snapshot,
  Task,
} from "../src/shared/types.ts";
// Test-only vault. Production always uses Electron safeStorage/Windows DPAPI.
const secret = randomBytes(32);
const vault: Vault = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", secret, iv);
    return Buffer.concat([iv, c.update(s), c.final(), c.getAuthTag()]);
  },
  decryptString: (b) => {
    const d = createDecipheriv("aes-256-gcm", secret, b.subarray(0, 12));
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString();
  },
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), "aivideo-"));
  const a = new Application(
    root,
    vault,
    async () => ({
      width: 600,
      height: 600,
      hasAlpha: false,
      duration: 5,
      fps: 30,
    }),
    () => {},
    () => {},
  );
  const account = a.credentials.save({
    name: "test-account",
    providerId: "alibaba",
    modelPrices: {}, // This fixture deliberately uses model-level prices.
    workspaceId: "workspace-test",
    key: "test-fixture-secret",
    enabled: true,
    maxConcurrent: 2,
  });
  const draft: Draft = {
    name: "test-task",
    modelId: "wan3",
    accountId: account.id,
    projectId: null,
    prompt: "保留原镜头，只修改产品。",
    params: defaults(models[0]),
    assets: [],
    outputDir: join(root, "outputs"),
  };
  return { a, root, account, draft };
}
function fixture(): Snapshot {
  const account: Account = {
    id: "a",
    name: "a",
    providerId: "alibaba",
    modelPrices: {}, // This fixture deliberately uses model-level prices.
    workspaceId: "workspace",
    region: "cn-beijing",
    endpoint: "",
    notes: "",
    manualBalance: "",
    enabled: true,
    isDefault: true,
    maxConcurrent: 2,
    createdAt: "2026-09-15",
    maskedKey: "••••",
  };
  const draft: Draft = {
    name: "t",
    modelId: "wan3",
    accountId: "a",
    projectId: null,
    prompt: "测试",
    params: defaults(models[0]),
    assets: [],
    outputDir: "/tmp",
  };
  return {
    draft,
    model: structuredClone(models[0]),
    provider: structuredClone(providers[0]),
    account,
    assets: [],
    price: structuredClone(models[0].price),
    estimatedCost: { amount: null, currency: "CNY", kind: "unknown", note: "" },
    createdAt: "2026-09-15",
    appVersion: "1.0.0",
  };
}
function fakeCloud(
  a: Application,
  options: {
    downloadFail?: boolean;
    submitFail?: boolean;
    pending?: boolean;
  } = {},
) {
  let submits = 0,
    downloads = 0,
    queries = 0;
  a.tasks.d.adapter = () =>
    new (class extends WanAdapter {
      constructor() {
        super(new HttpClient(), async (_u, d) => {
          downloads++;
          if (options.downloadFail)
            throw new AppError("DownloadError", "disk-full fixture");
          writeFileSync(d, Buffer.from("downloaded fixture"));
          return d;
        });
      }
      override async uploadAssets() {
        return [];
      }
      override async submitTask() {
        submits++;
        if (options.submitFail)
          throw new AppError("SubmissionUnknown", "timeout fixture");
        return "cloud-" + submits;
      }
      override async getTaskStatus() {
        queries++;
        return {
          status: options.pending
            ? ("processing" as const)
            : ("succeeded" as const),
          url: "https://example.com/result.mp4",
          raw: { output: { task_status: "SUCCEEDED" }, usage: { duration: 5 } },
        };
      }
    })();
  return { counts: () => ({ submits, downloads, queries }) };
}
async function execute(a: Application, t: Task) {
  await a.tasks.run(t, new AbortController().signal);
  if(t.status === "Processing") await a.tasks.run(t, new AbortController().signal);
  return a.tasks.get(t.id);
}

test("SQLite migration, restart, integrity and non-destructive backup", async () => {
  const { a, root } = setup();
  a.db.set("sentinel", { hello: "世界" });
  const backup = await a.db.backupTo(join(root, "backups", "test.sqlite"));
  assert(existsSync(backup));
  const file = a.db.path;
  a.close();
  const db = new Database(file);
  assert.deepEqual(db.get("sentinel", {}), { hello: "世界" });
  assert.equal(
    db.one<{ integrity_check: string }>("PRAGMA integrity_check")
      ?.integrity_check,
    "ok",
  );
  assert.equal(
    db.one<{ user_version: number }>("PRAGMA user_version")?.user_version,
    5,
  );
  db.close();
});
test("empty API key blocked; ciphertext does not contain key; foreign machine error is readable", () => {
  const { a } = setup();
  assert.throws(
    () => a.credentials.save({ name: "empty", providerId: "alibaba", key: "" }),
    /API Key/,
  );
  const row = a.db.one<{ encrypted: Uint8Array; data: string }>(
    "SELECT encrypted,data FROM credentials",
  )!;
  assert(
    !Buffer.from(row.encrypted).includes(Buffer.from("test-fixture-secret")),
  );
  assert(!row.data.includes("test-fixture-secret"));
  a.credentials.vault = {
    ...vault,
    decryptString: () => {
      throw new Error("foreign machine");
    },
  };
  assert.throws(
    () => a.credentials.getKey(a.credentials.list()[0].id),
    /另一台电脑/,
  );
  a.close();
});
test("10k Prompt draft persists after restart", () => {
  const { a, draft } = setup();
  draft.prompt = "长提示词".repeat(3000);
  a.saveDraft(draft);
  const path = a.db.path;
  a.close();
  const db = new Database(path);
  assert.equal(db.get<Draft | null>("draft", null)?.prompt, draft.prompt);
  db.close();
});
test("Prompt versions preserve V1 when V2 is edited", () => {
  const { a } = setup();
  const p = a.prompts.save({ name: "模板", content: "V1" });
  a.prompts.save({ ...p, content: "V2" });
  assert.deepEqual(
    a.prompts.versions(p.id).map((v) => v.content),
    ["V2", "V1"],
  );
  a.close();
});
test("asset SHA-256 deduplication, moved source, relocate validation and mutation detection", async () => {
  const { a, root } = setup();
  const p = join(root, "source.png");
  await writeFile(p, "fixture-image");
  const first = await a.assets.import(p, false);
  assert((await a.assets.import(p, false)).duplicate);
  const moved = join(root, "moved.png");
  await rename(p, moved);
  await assert.rejects(() => a.assets.verify(first.asset), /不可用/);
  await a.assets.relocate(first.asset.id, moved);
  assert.equal(await a.assets.verify(a.assets.get(first.asset.id)), moved);
  await writeFile(moved, "changed");
  await assert.rejects(
    () => a.assets.verify(a.assets.get(first.asset.id)),
    /改变/,
  );
  a.close();
});
test("copy import survives deletion of original file", async () => {
  const { a, root } = setup();
  const p = join(root, "source.png");
  await writeFile(p, "copy-source");
  const { asset } = await a.assets.import(p, true);
  await unlink(p);
  assert(existsSync(await a.assets.verify(asset)));
  a.close();
});
test("immutable task snapshot and branching versions; copy forms independent group", async () => {
  const { a, draft } = setup();
  const t1 = await a.tasks.create(draft, "request-1");
  assert.equal((await a.tasks.create(draft, "request-1")).id, t1.id);
  draft.prompt = "changed";
  const t2 = await a.tasks.create(
    { ...a.tasks.cloneDraft(t1.id), prompt: "V2" },
    "request-2",
  );
  const t3 = await a.tasks.create(
    { ...a.tasks.cloneDraft(t1.id), prompt: "branch" },
    "request-3",
  );
  const independent = await a.tasks.create(
    a.tasks.cloneDraft(t2.id, true),
    "request-4",
  );
  assert.equal(t1.version, 1);
  assert.equal(t2.version, 2);
  assert.equal(t3.parentVersionId, t1.id);
  assert.notEqual(independent.groupId, t1.groupId);
  assert.equal(independent.version, 1);
  assert.equal(
    a.tasks.get(t1.id).snapshot.draft.prompt,
    "保留原镜头，只修改产品。",
  );
  assert.throws(
    () =>
      a.db.run(
        "UPDATE task_snapshots SET data=? WHERE version_id=?",
        "{}",
        t1.id,
      ),
    /immutable/,
  );
  a.close();
});
test("concurrent duplicate requests create exactly one paid reservation", async () => {
  const { a, draft } = setup();
  const [one, two] = await Promise.all([
    a.tasks.create(draft, "same"),
    a.tasks.create(draft, "same"),
  ]);
  assert.equal(one.id, two.id);
  assert.equal(a.tasks.list().total, 1);
  a.close();
});
test("Wan payload matches official media/input/parameters shape", async () => {
  let body: Record<string, unknown> = {};
  const s = fixture();
  const http = new HttpClient(async (_url, init) => {
    body = JSON.parse(String(init?.body));
    assert.equal(
      (init?.headers as Record<string, string>)["X-DashScope-Async"],
      "enable",
    );
    return Response.json({ output: { task_id: "wan-task-id" } });
  });
  const adapter = new WanAdapter(http, async () => "/output");
  assert.equal(await adapter.submitTask(s, "test", []), "wan-task-id");
  assert.equal(body.model, "wan3.0-video");
  assert.deepEqual(body.input, { prompt: "测试" });
  assert.equal(
    (body.parameters as { prompt_extend: boolean }).prompt_extend,
    false,
  );
});
test("Seedance submit, status and result use official SDK protocol", async () => {
  const s = fixture();
  s.model = { ...structuredClone(models[1]), enabled: true };
  s.provider = providers[1];
  s.account.providerId = "volcengine";
  s.draft.params = defaults(s.model);
  let path = "";
  const adapter = new SeedanceAdapter(
    new HttpClient(async (u, init) => {
      path = String(u);
      if (init?.method === "POST") {
        const b = JSON.parse(String(init.body));
        assert(Array.isArray(b.content));
        assert.equal(b.generate_audio, false);
        return Response.json({ id: "seed-task-id" });
      }
      return Response.json({
        status: "succeeded",
        content: { video_url: "https://example.com/a.mp4" },
      });
    }),
    async () => "/output",
  );
  assert.equal(await adapter.submitTask(s, "test", []), "seed-task-id");
  assert(path.endsWith("/contents/generations/tasks"));
  assert.equal(
    (await adapter.getTaskStatus(s, "test", "seed-task-id")).url,
    "https://example.com/a.mp4",
  );
});
test("invalid credentials and request errors have actionable categories", () => {
  for (const code of [401, 403])
    assert.equal(httpError(code).code, "AuthenticationError");
  assert.equal(httpError(429).retryable, true);
  assert.equal(httpError(400).retryable, false);
  assert.equal(httpError(500).retryable, true);
});
test("429 retries, paid 500 and network timeout never repeat submission", async () => {
  let calls = 0;
  const h = new HttpClient(
    async () => {
      calls++;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "0.001" } })
        : Response.json({ ok: true });
    },
    undefined,
    2,
  );
  await h.request("https://example.com", "x", {
    paidSubmit: true,
    method: "POST",
  });
  assert.equal(calls, 2);
  calls = 0;
  const fail = new HttpClient(
    async () => {
      calls++;
      return new Response("", { status: 500 });
    },
    undefined,
    4,
  );
  await assert.rejects(
    () =>
      fail.request("https://example.com", "x", {
        method: "POST",
        paidSubmit: true,
      }),
    /暂停/,
  );
  assert.equal(calls, 1);
  calls = 0;
  const timeout = new HttpClient(async () => {
    calls++;
    throw new Error("timeout");
  });
  await assert.rejects(
    () =>
      timeout.request("https://example.com", "x", {
        paidSubmit: true,
        method: "POST",
      }),
    /重复扣费/,
  );
  assert.equal(calls, 1);
});
test("safe polling retries on temporary disconnection", async () => {
  let n = 0;
  const h = new HttpClient(
    async () => {
      n++;
      if (n === 1) throw new Error("offline");
      return Response.json({ ok: true });
    },
    undefined,
    1,
  );
  assert.deepEqual(await h.request("https://example.com", "test"), {
    ok: true,
  });
  assert.equal(n, 2);
});
test("unsupported params, long Prompt, invalid duration rejected before cloud submit", () => {
  const s = fixture();
  s.draft.params.fps = 60;
  assert.throws(() => validateInput(s), /不支持参数/);
  delete s.draft.params.fps;
  s.draft.prompt = "字".repeat(20001);
  assert.throws(() => validateInput(s), /不会自动截断/);
  s.draft.prompt = "ok";
  s.draft.params.duration = 1;
  assert.throws(() => validateInput(s), /至少 2 秒/);
});
test("model asset size, format, dimensions, duration, fps and mixed modes preflight", () => {
  const s = fixture();
  const a: Asset & { role: "reference_video" } = {
    id: "a",
    name: "test.mp4",
    kind: "video",
    originalPath: "a",
    managedPath: null,
    size: 1,
    mime: "video/mp4",
    hash: "x",
    createdAt: "",
    lastUsedAt: null,
    tags: [],
    folder: "",
    projectId: null,
    favorite: false,
    width: 720,
    height: 1280,
    fps: 30,
    duration: 5,
    role: "reference_video",
  };
  s.assets = [a];
  validateInput(s);
  a.size = 101 * 1024 * 1024;
  assert.throws(() => validateInput(s), /超过/);
  a.size = 1;
  a.name = "a.avi";
  assert.throws(() => validateInput(s), /格式/);
  a.name = "a.mp4";
  a.duration = 16;
  assert.throws(() => validateInput(s), /时长/);
  a.duration = 5;
  a.fps = 10;
  assert.throws(() => validateInput(s), /帧率/);
  a.fps = 30;
  a.width = 100;
  assert.throws(() => validateInput(s), /分辨率/);
  a.width = 720;
  s.assets.push({ ...a, role: "first_frame", kind: "image", name: "a.png" });
  assert.throws(() => validateInput(s), /不支持首尾帧/);
});
test("unknown prices remain unknown; price snapshot never recalculates history", async () => {
  const { a, draft } = setup();
  const t = await a.tasks.create(draft, "price1");
  assert.equal(t.cost.amount, null);
  a.updateModel("wan3", {
    price: {
      currency: "CNY",
      unit: "second",
      rate: 2,
      source: "test manual",
      updatedAt: "now",
      basis: "output",
    },
  });
  assert.equal(a.tasks.get(t.id).snapshot.price.rate, null);
  const second = await a.tasks.create(draft, "price2");
  assert.equal(second.cost.amount, 10);
  const cost = finalCost(second.snapshot, {
    usage: { output_video_duration: 6 },
  });
  assert.equal(cost.amount, 12);
  assert.equal(cost.kind, "estimate");
  a.close();
});
test("successful generation + failed download retains cloud success; redownload never resubmits", async () => {
  const { a, draft } = setup();
  const options = { downloadFail: true };
  const cloud = fakeCloud(a, options);
  const t = await a.tasks.create(draft, "dl1");
  const result = await execute(a, t);
  assert.equal(result.status, "Completed");
  assert.equal(result.downloadStatus, "failed");
  assert.equal(result.apiTaskId, "cloud-1");
  options.downloadFail = false;
  await a.tasks.redownload(t.id);
  const done = await execute(a, a.tasks.get(t.id));
  assert.equal(done.status, "Completed");
  assert.equal(done.downloadStatus, "completed");
  assert.equal(cloud.counts().submits, 1);
  assert.equal(cloud.counts().downloads, 2);
  a.close();
});
test("processing restart recovers task ID without duplicate submit; interrupted submit pauses", async () => {
  const { a, draft } = setup();
  const cloud = fakeCloud(a, { pending: true });
  const t = await a.tasks.create(draft, "restore");
  await execute(a, t);
  a.tasks.recover();
  assert.equal(a.tasks.get(t.id).apiTaskId, "cloud-1");
  assert.equal(a.tasks.get(t.id).status, "Processing");
  await execute(a, a.tasks.get(t.id));
  assert.equal(cloud.counts().submits, 1);
  const other = await a.tasks.create(draft, "interrupt");
  other.status = "Submitting";
  a.tasks.save(other);
  a.tasks.recover();
  assert.equal(a.tasks.get(other.id).status, "Paused");
  assert.throws(() => a.tasks.resume(other.id), /任务 ID/);
  a.close();
});
test("ambiguous paid submission pauses and preserves all inputs", async () => {
  const { a, draft } = setup();
  const c = fakeCloud(a, { submitFail: true });
  const t = await a.tasks.create(draft, "unknown");
  const result = await execute(a, t);
  assert.equal(result.status, "Paused");
  assert.equal(result.errorCode, "SubmissionUnknown");
  assert.equal(result.snapshot.draft.prompt, draft.prompt);
  assert.equal(c.counts().submits, 1);
  a.close();
});
test("output verification rejects HTML; valid MP4 never overwrites old output", async () => {
  const root = await mkdtemp(join(tmpdir(), "aivideo-dl-"));
  const dm = new DownloadManager(
    new Logger(join(root, "logs")),
    5000,
    async () => new Response("<html>failure</html>"),
  );
  const path = join(root, "result.mp4");
  await assert.rejects(() => dm.download("https://example.com/x", path), /MP4/);
  assert(!existsSync(path));
  const header = Buffer.alloc(40);
  header.write("ftyp", 4);
  dm.fetcher = async () => new Response(header);
  await dm.download("https://example.com/x", path);
  const original = await readFile(path);
  const duplicate = await dm.download("https://example.com/x", path);
  assert.equal(duplicate, join(root, "result (1).mp4"));
  assert.deepEqual(await readFile(path), original);
});
test("deleting task record never deletes output or source", async () => {
  const { a, draft } = setup();
  const t = await a.tasks.create(draft, "delete");
  fakeCloud(a);
  const done = await execute(a, t);
  a.tasks.removeRecord(t.id);
  assert.equal(a.tasks.list().total, 0);
  assert(existsSync(done.outputPath!));
  assert(a.tasks.get(t.id).snapshot);
  a.close();
});
test("account/provider mismatch prevents submission", async () => {
  const { a, draft } = setup();
  const other = a.credentials.save({
    name: "seed",
    providerId: "volcengine",
    key: "test-key",
  });
  await assert.rejects(
    () => a.tasks.create({ ...draft, accountId: other.id }, "mismatch"),
    /账户/,
  );
  assert.equal(a.tasks.list().total, 0);
  a.close();
});

test("global concurrency includes processing cloud jobs between polls", async () => {
  const { a, draft } = setup();
  a.saveSettings({ globalConcurrency: 2, providerConcurrency: { alibaba: 2 } });
  const cloud = fakeCloud(a, { pending: true });
  for (let i = 0; i < 5; i++) await a.tasks.create(draft, "parallel-" + i);
  await a.tasks.tick();
  await new Promise((r) => setTimeout(r, 20));
  await a.tasks.tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(cloud.counts().submits, 2);
  assert.equal(a.tasks.list({ status: "Processing" }).total, 2);
  assert.equal(a.tasks.list({ status: "Queued" }).total, 3);
  a.close();
});
test("per-account limit permits another account while first is saturated", async () => {
  const { a, draft, account } = setup();
  a.credentials.save({ ...account, maxConcurrent: 1 });
  const second = a.credentials.save({
    name: "second",
    providerId: "alibaba",
    modelPrices: {}, // This fixture deliberately uses model-level prices.
    workspaceId: "workspace",
    key: "test-second",
    maxConcurrent: 1,
  });
  a.saveSettings({ globalConcurrency: 3, providerConcurrency: { alibaba: 3 } });
  const cloud = fakeCloud(a, { pending: true });
  await a.tasks.create(draft, "a-1");
  await a.tasks.create(draft, "a-2");
  await a.tasks.create({ ...draft, accountId: second.id }, "b-1");
  await a.tasks.tick();
  await new Promise((r) => setTimeout(r, 30));
  await a.tasks.tick();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(cloud.counts().submits, 2);
  assert.equal(
    a.tasks.list({ accountId: account.id, status: "Processing" }).total,
    1,
  );
  assert.equal(
    a.tasks.list({ accountId: second.id, status: "Processing" }).total,
    1,
  );
  a.close();
});
test("re-generate preserves exact official model after registry change", async () => {
  const { a, draft } = setup();
  const first = await a.tasks.create(draft, "exact1");
  a.updateModel("wan3", { officialId: "wan-future" });
  const second = await a.tasks.again(first.id, "exact2");
  assert.equal(second.snapshot.model.officialId, "wan3.0-video");
  assert.equal(second.parentVersionId, first.id);
  a.close();
});
test("logs redact keys and omit prompts", () => {
  const dir = mkdtempSync(join(tmpdir(), "aivideo-log-"));
  const logger = new Logger(dir);
  logger.write("api", "error", {
    apiKey: "sk-complete-secret",
    prompt: "private long prompt",
    message: "Bearer sk-complete-secret",
  });
  const text = readFileSync(join(dir, "api.log"), "utf8");
  assert(!text.includes("complete-secret"));
  assert(!text.includes("private long prompt"));
  assert(text.includes("REDACTED"));
});

test("portable directory move rebases managed files without rewriting immutable snapshots", async () => {
  const { a, root, draft } = setup();
  const source = join(root, "original.png");
  await writeFile(source, "source");
  const imported = await a.assets.import(source, true);
  const t = await a.tasks.create(
    {
      ...draft,
      assets: [{ assetId: imported.asset.id, role: "reference_image" }],
    },
    "portable",
  );
  const originalSnapshot = JSON.stringify(t.snapshot);
  a.saveDraft(draft);
  a.close();
  const destination = root + "-moved";
  await rename(root, destination);
  const moved = new Application(
    destination,
    vault,
    async () => ({}),
    () => {},
    () => {},
  );
  const asset = moved.assets.get(imported.asset.id);
  assert(asset.managedPath?.startsWith(destination));
  assert(existsSync(await moved.assets.verify(asset)));
  assert.equal(
    JSON.stringify(moved.tasks.get(t.id).snapshot),
    originalSnapshot,
  );
  assert(moved.tasks.cloneDraft(t.id).outputDir.startsWith(destination));
  moved.close();
});
test("Seedance 2.5 rejects unsupported seed and enforces editing constraints", () => {
  const s = fixture();
  s.model = structuredClone(models.find((m) => m.id === "seedance25")!);
  s.provider = providers[1];
  s.account.providerId = "volcengine";
  s.draft.params = defaults(s.model);
  s.draft.params.seed = 1;
  assert.throws(() => validateInput(s), /不支持参数/);
  delete s.draft.params.seed;
  s.draft.params.omni_reference_task_type = "edit";
  assert.throws(() => validateInput(s), /参考视频/);
  s.assets = [
    {
      id: "v",
      name: "v.mp4",
      kind: "video",
      originalPath: "v",
      managedPath: null,
      size: 100,
      mime: "video/mp4",
      hash: "h",
      createdAt: "",
      lastUsedAt: null,
      tags: [],
      folder: "",
      projectId: null,
      favorite: false,
      width: 1280,
      height: 720,
      duration: 5,
      fps: 30,
      remoteUrl: "https://example.com/video.mp4",
      role: "reference_video",
    },
  ];
  assert.throws(() => validateInput(s), /duration=-1/);
  s.draft.params.duration = -1;
  validateInput(s);
  s.draft.params.ratio = "16:9";
  assert.throws(() => validateInput(s), /adaptive/);
});
test("new output directory is created; file-as-directory fails before cloud calls", async () => {
  const { a, root, draft } = setup();
  const out = join(root, "new", "outputs");
  const t = await a.tasks.create({ ...draft, outputDir: out }, "new-dir");
  assert(existsSync(out));
  assert.equal(t.snapshot.draft.outputDir, out);
  const bad = join(root, "not-dir");
  await writeFile(bad, "x");
  await assert.rejects(() =>
    a.tasks.create({ ...draft, outputDir: bad }, "bad-dir"),
  );
  a.close();
});

test("malformed successful submission is ambiguous and never marked safe to repeat", async () => {
  const s = fixture();
  const wan = new WanAdapter(
    new HttpClient(async () => Response.json({ unexpected: true })),
    async () => "/unused",
  );
  await assert.rejects(
    () => wan.submitTask(s, "fixture", []),
    (e: unknown) => e instanceof AppError && e.code === "SubmissionUnknown",
  );
  s.model = structuredClone(models[1]);
  s.provider = providers[1];
  s.account.providerId = "volcengine";
  const seed = new SeedanceAdapter(
    new HttpClient(async () => Response.json(null)),
    async () => "/unused",
  );
  await assert.rejects(
    () => seed.submitTask(s, "fixture", []),
    (e: unknown) => e instanceof AppError && e.code === "SubmissionUnknown",
  );
});
test("Wan upload obtains official policy, sends multipart file last, and resolves OSS in submission", async () => {
  const root = mkdtempSync(join(tmpdir(), "wan-upload-"));
  const path = join(root, "v.mp4");
  writeFileSync(path, "fixture");
  const s = fixture();
  s.account.region = "ap-southeast-1";
  s.assets = [
    {
      id: "v",
      name: "v.mp4",
      kind: "video",
      originalPath: path,
      managedPath: null,
      size: 7,
      mime: "video/mp4",
      hash: "h",
      createdAt: "",
      lastUsedAt: null,
      tags: [],
      folder: "",
      projectId: null,
      favorite: false,
      role: "reference_video",
    },
  ];
  let step = 0;
  const http = new HttpClient(async (u, init) => {
    step++;
    if (step === 1) {
      assert(
        String(u).includes(".ap-southeast-1.maas.aliyuncs.com/api/v1/uploads?"),
      );
      return Response.json({
        data: {
          upload_host: "https://fixture.oss-cn-beijing.aliyuncs.com",
          upload_dir: "fixture",
          max_file_size_mb: 100,
          policy: "p",
          signature: "s",
          oss_access_key_id: "a",
          x_oss_object_acl: "private",
          x_oss_forbid_overwrite: "true",
        },
      });
    }
    if (step === 2) {
      assert(init?.body instanceof FormData);
      assert.equal([...init.body.keys()].at(-1), "file");
      return new Response("", { status: 200 });
    }
    assert.equal(
      (init?.headers as Record<string, string>)[
        "X-DashScope-OssResourceResolve"
      ],
      "enable",
    );
    return Response.json({ output: { task_id: "uploaded-task" } });
  });
  const adapter = new WanAdapter(http, async () => "/unused");
  const media = await adapter.uploadAssets(s, "fixture-api-secret");
  assert(
    String((media[0] as Record<string, Json>).url).startsWith("oss://fixture/"),
  );
  await adapter.submitTask(s, "fixture-api-secret", media);
  assert.equal(step, 3);
});
test("existing API account cannot change Provider and invalidate historical tasks", () => {
  const { a, account } = setup();
  assert.throws(
    () => a.credentials.save({ ...account, providerId: "volcengine" }),
    /不能更换服务商/,
  );
  a.close();
});

test("packaged MediaInfo WASM reads actual MP4 dimensions/fps and WAV duration", async () => {
  const { probeMedia } = await import("../src/main/services/media.ts");
  const wasm = join(
    process.cwd(),
    "node_modules/mediainfo.js/dist/MediaInfoModule.wasm",
  );
  const video = await probeMedia(
    join(process.cwd(), "tests/fixtures/sample.mp4"),
    wasm,
  );
  assert.equal(video.width, 640);
  assert.equal(video.height, 480);
  assert.equal(video.fps, 30);
  assert(Math.abs((video.duration ?? 0) - 1) < 0.1);
  const audio = await probeMedia(
    join(process.cwd(), "tests/fixtures/sample.wav"),
    wasm,
  );
  assert(Math.abs((audio.duration ?? 0) - 1) < 0.1);
});
