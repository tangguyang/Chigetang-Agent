import type { Draft } from "../src/shared/types.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { Application } from "../src/main/services/application.ts";
import { DownloadManager } from "../src/main/services/downloads.ts";
import { Logger } from "../src/main/services/logger.ts";
import { WanAdapter } from "../src/main/models/adapters.ts";
import { HttpClient } from "../src/main/providers/http.ts";
import { videoStem, AUTO_VIDEO_NAME } from "../src/shared/filenames.ts";
import { durationOptions } from "../src/shared/duration.ts";
import { models } from "../src/shared/catalog.ts";
import {
  accountPrice,
  costBreakdown,
  estimateCost,
} from "../src/shared/pricing.ts";
import {
  assignImportedAssets,
  migrateDraftToModel,
} from "../src/shared/draftCompatibility.ts";
import {
  insertMention,
  mentionCandidates,
  compilePrompt,
} from "../src/shared/mentions.ts";
const key = randomBytes(32);
const vault = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([iv, c.update(s), c.final(), c.getAuthTag()]);
  },
  decryptString: (b: Buffer) => {
    const c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    c.setAuthTag(b.subarray(-16));
    return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
  },
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), "v104-"));
  const app = new Application(
    root,
    vault,
    async () => ({ width: 720, height: 1280, duration: 11.125, fps: 30 }),
    () => {},
    () => {},
  );
  const account = app.credentials.save({
    name: "test account",
    providerId: "alibaba",
    workspaceId: "ws-fixture",
    key: "not-a-real-key",
  });
  return {
    app,
    root,
    account,
    draft: {
      ...app.newDraft(),
      prompt: "test",
      params: { ...app.newDraft().params, duration: 12 },
    },
  };
}
test("v104 new workspace and replacement duration zero; backend never submits zero", async () => {
  const { app, account } = setup();
  const d = app.newDraft();
  assert.equal(d.params.duration, 0);
  assert.equal(d.projectId, null);
  assert.equal(d.accountId, account.id);
  assert.equal(app.projects().length, 0);
  await assert.rejects(
    () => app.tasks.create({ ...d, prompt: "test" }, "zero"),
    /请选择/,
  );
  assert.equal(app.tasks.list().total, 0);
  app.close();
});
test("v104 model switching revalidates duration without falling back to model default", () => {
  const { app, draft } = setup();
  const next = models.find((m) => m.id === "seedance15")!;
  const out = migrateDraftToModel(
    { ...draft, params: { ...draft.params, duration: 30 } },
    models[0],
    next,
    [],
  );
  assert.equal(out.draft.params.duration, 0);
  assert(!durationOptions(next).includes(0));
  assert(!durationOptions(next).includes(2));
  app.close();
});
test("v104 account price fractional real video duration and breakdown; unknown duration stays unknown", async () => {
  const { app, root, account, draft } = setup();
  writeFileSync(join(root, "ref.mp4"), "mock media");
  const a = (await app.assets.import(join(root, "ref.mp4"), false)).asset;
  draft.assets = [
    { assetId: a.id, role: "reference_video" },
  ] as typeof draft.assets;
  let q = app.tasks.estimate(draft);
  assert.equal(q.breakdown.referenceSeconds, 11.125);
  assert.equal(q.breakdown.referenceAmount, 6.675);
  assert.equal(q.cost.amount, 13.875);
  a.duration = 11;
  app.assets.save(a);
  q = app.tasks.estimate(draft);
  assert.equal(q.cost.amount, 13.8);
  assert.equal(q.breakdown.outputAmount, 7.199999999999999);
  assert.equal(app.tasks.estimate({ ...draft, assets: [] }).cost.amount, 7.2);
  a.duration = undefined;
  app.assets.save(a);
  assert.equal(app.tasks.estimate(draft).cost.amount, null);
  assert.equal(accountPrice(app.models()[0], account).rate, 0.6);
  assert.equal(app.models()[0].price.rate, null);
  app.close();
});
test("v104 account price changes affect only new tasks and preserve account ciphertext", async () => {
  const { app, account, draft } = setup();
  const t = await app.tasks.create(draft, "p1");
  const encrypted = app.db.one<{ encrypted: Uint8Array }>(
    "SELECT encrypted FROM credentials WHERE id=?",
    account.id,
  )!.encrypted;
  app.credentials.save({
    id: account.id,
    modelPrices: { wan3: { ...account.modelPrices!.wan3, rate: 0.9 } },
  });
  const n = await app.tasks.create(draft, "p2");
  assert.equal(n.cost.amount, 10.8);
  assert.equal(app.tasks.get(t.id).snapshot.estimatedCost.amount, 7.2);
  assert.deepEqual(
    app.db.one<{ encrypted: Uint8Array }>(
      "SELECT encrypted FROM credentials WHERE id=?",
      account.id,
    )!.encrypted,
    encrypted,
  );
  app.close();
});
test("v104 manual accounting priority, zero, audit, undo, provider updates, no double counting", async () => {
  const { app, draft } = setup();
  const t = await app.tasks.create(draft, "bill");
  t.submittedAt = new Date().toISOString();
  t.status = "Completed";
  t.actualCost = {
    amount: 6,
    currency: "CNY",
    kind: "actual",
    note: "mock provider",
  };
  app.tasks.save(t);
  assert.equal(app.billing.report().totals[0].effective, 6);
  app.billing.correct(t.id, 8, "invoice");
  app.tasks.save(t);
  assert.equal(app.billing.report().totals[0].effective, 8);
  assert.equal(app.billing.report().tasks[0].actual, 6);
  assert.equal(app.billing.report().tasks[0].estimated, 7.2);
  app.billing.correct(t.id, 0, "refund");
  assert.equal(app.billing.report().totals[0].effective, 0);
  app.billing.correct(t.id, null, "");
  assert.equal(app.billing.report().totals[0].effective, 6);
  assert.equal(app.billing.history(t.id).length, 3);
  assert.equal(JSON.parse(app.billing.history(t.id)[0].before_data).amount, 0);
  assert.throws(() => app.billing.correct(t.id, -1, ""));
  assert.throws(() => app.billing.correct(t.id, NaN, ""));
  const raw = app.tasks.get(t.id).snapshot;
  assert.equal(raw.estimatedCost.amount, 7.2);
  app.close();
});
test("v104 billing estimate fallback counts each task once and excludes unsubmitted budgets", async () => {
  const { app, draft } = setup();
  const t = await app.tasks.create(draft, "e1");
  assert.equal(app.billing.report().totals[0].effective, null);
  t.submittedAt = new Date().toISOString();
  app.tasks.save(t);
  assert.equal(app.billing.report().totals[0].effective, 7.2);
  app.billing.correct(t.id, 4, "confirmed");
  const second = await app.tasks.create(draft, "e2");
  second.submittedAt = new Date().toISOString();
  app.tasks.save(second);
  assert.equal(app.billing.report().totals[0].effective, 11.2);
  app.close();
});
test("v104 usage follows asset ID, new binding inherits, existing drafts and snapshots frozen", async () => {
  const { app, root, draft } = setup();
  writeFileSync(join(root, "product.png"), "fixture");
  const a = (await app.assets.import(join(root, "product.png"), false)).asset;
  a.metadata = { detectedFormat: "png" };
  a.defaultUsage = "包装正面";
  app.assets.save(a);
  const bindings = assignImportedAssets(
    [],
    [app.assets.get(a.id)],
    ["reference_image"],
    false,
  );
  let d: Draft = { ...draft, assets: bindings };
  assert.equal(bindings[0].userRole, "包装正面");
  d = insertMention(d, 0, 0, mentionCandidates(bindings, [a])[0]);
  assert(compilePrompt(d, [a], "wan3").includes("用途：包装正面"));
  app.saveDraft(d);
  const t = await app.tasks.create(d, "tag");
  a.defaultUsage = "人物";
  app.assets.save(a);
  assert.equal(app.drafts.get(d.draftId!).assets[0].userRole, "包装正面");
  assert.equal(
    app.tasks.get(t.id).snapshot.draft.assets[0].userRole,
    "包装正面",
  );
  assert.equal(
    assignImportedAssets(
      [],
      [app.assets.get(a.id)],
      ["reference_image"],
      false,
    )[0].userRole,
    "人物",
  );
  app.close();
});
test("v104 frame supplement never silently omitted by backend", async () => {
  const { app, root, draft } = setup();
  writeFileSync(join(root, "first.png"), "first");
  writeFileSync(join(root, "ref.png"), "second");
  const a = (await app.assets.import(join(root, "first.png"), false)).asset,
    b = (await app.assets.import(join(root, "ref.png"), false)).asset;
  a.metadata = { detectedFormat: "png" };
  b.metadata = { detectedFormat: "png" };
  app.assets.save(a);
  app.assets.save(b);
  await assert.rejects(
    () =>
      app.tasks.create(
        {
          ...draft,
          assets: [
            { assetId: a.id, role: "first_frame" },
            { assetId: b.id, role: "reference_image" },
          ],
        },
        "mixed",
      ),
    /不支持首尾帧/,
  );
  assert.equal(app.tasks.list().total, 0);
  app.close();
});
test("v104 rename survives reopen and submission name matches without changing inactive draft", async () => {
  const { app, draft } = setup();
  app.saveDraft(draft);
  const other = app.newDraft();
  app.drafts.rename(draft.draftId!, "新名称");
  assert.equal(app.bootstrap().draft!.draftId, other.draftId);
  const renamed = app.drafts.get(draft.draftId!);
  const t = await app.tasks.create(renamed, "rename");
  assert.equal(t.name, "新名称");
  assert.equal(t.snapshot.draft.name, "新名称");
  const root = app.root;
  app.close();
  const reopened = new Application(
    root,
    vault,
    async () => ({}),
    () => {},
    () => {},
  );
  assert.equal(reopened.drafts.get(draft.draftId!).name, "新名称");
  reopened.close();
});
test("v104 polling default migration preserves custom interval and explicit old default going forward", () => {
  const { app } = setup();
  assert.equal(app.settings().pollSeconds, 5);
  app.db.set("settings", { ...app.settings(), pollSeconds: 15 });
  assert.equal(app.settings().pollSeconds, 5);
  app.db.set("settings", { ...app.settings(), pollSeconds: 27 });
  assert.equal(app.settings().pollSeconds, 27);
  app.saveSettings({ pollSeconds: 15 });
  assert.equal(app.settings().pollSeconds, 15);
  app.close();
});
test("v104 first poll after five seconds; repeated polling and download never submit twice", async () => {
  const { app, draft } = setup();
  let submits = 0,
    queries = 0;
  app.tasks.d.adapter = () =>
    new (class extends WanAdapter {
      constructor() {
        super(new HttpClient(), async (_u, d) => d);
      }
      override async uploadAssets() {
        return [];
      }
      override async submitTask() {
        submits++;
        return "mock-cloud";
      }
      override async getTaskStatus() {
        queries++;
        return {
          status:
            queries < 2 ? ("processing" as const) : ("succeeded" as const),
          url: "https://example.com/mock.mp4",
          raw: {},
        };
      }
    })();
  const t = await app.tasks.create(draft, "poll");
  const begin = Date.now();
  await app.tasks.run(t, new AbortController().signal);
  assert.equal(submits, 1);
  assert.equal(queries, 0);
  assert(t.nextPollAt >= begin + 5000);
  await app.tasks.tick();
  assert.equal(queries, 0);
  await app.tasks.run(t, new AbortController().signal);
  assert.equal(queries, 1);
  await app.tasks.run(t, new AbortController().signal);
  assert.equal(submits, 1);
  assert.equal(app.tasks.get(t.id).status, "Completed");
  app.close();
});
test("v104 Windows names: illegal chars, reserved devices, Unicode, timestamp seconds", () => {
  assert.equal(videoStem(" A:B/C*?<>|. "), "A_B_C_____");
  assert.equal(videoStem("CON"), "_CON");
  assert.equal(videoStem("lPt1.txt"), "_lPt1.txt");
  assert.equal(
    videoStem("", new Date(2026, 8, 16, 23, 8, 45)),
    "2026-09-16_23-08-45",
  );
  assert.equal(videoStem("包装正面"), "包装正面");
  assert(!videoStem("test...").endsWith("."));
});
test("v104 concurrent download case collisions append sequence; unnamed timestamp is commit time", async () => {
  const root = mkdtempSync(join(tmpdir(), "v104-files-"));
  const data = Buffer.alloc(40);
  data.write("ftyp", 4);
  const dm = new DownloadManager(
    new Logger(join(root, "logs")),
    5000,
    async () => new Response(data),
  );
  writeFileSync(join(root, "DEMO.mp4"), "original");
  const paths = await Promise.all([
    dm.download("https://example.com/mock", join(root, "demo.mp4")),
    dm.download("https://example.com/mock", join(root, "Demo.mp4")),
  ]);
  assert.notEqual(paths[0].toLowerCase(), paths[1].toLowerCase());
  assert.equal(readFileSync(join(root, "DEMO.mp4"), "utf8"), "original");
  assert(paths.every((p) => / \(\d+\)\.mp4$/.test(p)));
  const path = await dm.download(
    "https://example.com/mock",
    join(root, AUTO_VIDEO_NAME),
  );
  assert.match(basename(path), /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.mp4$/);
  assert(!readdirSync(root).some((n) => n.endsWith(".part")));
});
