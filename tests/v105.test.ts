import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/main/services/application.ts";
import { Database } from "../src/main/database/db.ts";
import { migrations } from "../src/main/database/schema.ts";
import {
  migrateLegacyRoot,
  assertOutsideProgram,
} from "../src/main/services/storage.ts";
import { DownloadManager } from "../src/main/services/downloads.ts";
import { Logger } from "../src/main/services/logger.ts";
import { probeMedia } from "../src/main/services/media.ts";
import { convertAudio } from "../src/main/services/transcode.ts";
import type { AudioRequest } from "../src/shared/types.ts";
import { WanAdapter } from "../src/main/models/adapters.ts";
import { HttpClient } from "../src/main/providers/http.ts";
// Fake vault and transport are test-only; no live API key is loaded or used.
const vault = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from("fixture:" + s),
  decryptString: (b: Buffer) => b.toString().slice(8),
};
const probe = async () => ({
  duration: 5,
  sampleRate: 24000,
  channels: 1,
  bitDepth: 16,
});
function setup(
  fetcher: typeof fetch = async () => {
    throw Error("unexpected network");
  },
  root = mkdtempSync(join(tmpdir(), "agent105-")),
) {
  const app = new Application(
    root,
    vault,
    probe,
    () => {},
    () => {},
    fetcher,
  );
  const account = app.credentials.save({
    name: "fixture",
    providerId: "alibaba",
    workspaceId: "ws-test",
    region: "cn-beijing",
    key: "fake-test-key",
    maxConcurrent: 2,
    enabled: true,
  });
  return { app, root, account };
}
async function waitTask(app: Application, id: string) {
  for (let i = 0; i < 200; i++) {
    const t = app.tasks.get(id);
    if (["Completed", "Failed", "Paused"].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("task timeout");
}
const wav = readFileSync(new URL("./fixtures/sample.wav", import.meta.url));
test("v105: v104 root migration preserves ciphertext, prompts, drafts, assets, project and task; restart is idempotent", async () => {
  const { app, root, account } = setup();
  const asset = (
    await app.assets.import(resolve("tests/fixtures/sample.wav"), true)
  ).asset;
  const prompt = app.prompts.save({ name: "保留", content: "不可丢失" });
  const project = app.createProject("旧项目");
  const draft = {
    ...app.newDraft(),
    name: "旧工作区",
    prompt: "保留原镜头",
    projectId: project.id,
    params: { ...app.newDraft().params, duration: 5 },
  };
  app.saveDraft(draft);
  const task = await app.tasks.create(draft, "old-task");
  const ciphertext = Buffer.from(
    app.db.one<{ encrypted: Uint8Array }>(
      "SELECT encrypted FROM credentials WHERE id=?",
      account.id,
    )!.encrypted,
  );
  const legacyDb = app.db.path;
  app.close();
  // Remove ONLY v105 schema additions to represent the uploaded v104 (schema v3).
  const old = new DatabaseSync(legacyDb);
  old.exec(
    "DROP TABLE cloud_uploads; DROP TABLE voices; DROP TABLE asset_folders; DROP INDEX idx_assets_folder_fav; DROP INDEX idx_assets_fav; DROP INDEX idx_task_kind; PRAGMA user_version=3;",
  );
  old.close();
  const target = join(mkdtempSync(join(tmpdir(), "agent105-new-")), "UserData");
  migrateLegacyRoot(target, [root]);
  assert(existsSync(legacyDb));
  const next = new Application(
    target,
    vault,
    probe,
    () => {},
    () => {},
  );
  assert.equal(
    next.db.one<{ user_version: number }>("PRAGMA user_version")!.user_version,
    5,
  );
  assert.deepEqual(
    Buffer.from(
      next.db.one<{ encrypted: Uint8Array }>(
        "SELECT encrypted FROM credentials WHERE id=?",
        account.id,
      )!.encrypted,
    ),
    ciphertext,
  );
  assert.equal(next.credentials.getKey(account.id), "fake-test-key");
  assert.equal(
    next.prompts.list().items.find((p) => p.id === prompt.id)!.content,
    "不可丢失",
  );
  assert.equal(next.drafts.get(draft.draftId!).name, "旧工作区");
  assert.equal(next.projects()[0].id, project.id);
  assert.equal(next.tasks.get(task.id).type, "video");
  assert(next.assets.get(asset.id).managedPath!.startsWith(target));
  assert(existsSync(next.assets.get(asset.id).managedPath!));
  assert(
    readdirSync(join(target, "database")).some((f) =>
      f.startsWith("pre-migration-v3-"),
    ),
  );
  next.close();
  migrateLegacyRoot(target, [root]);
  const restart = new Application(
    target,
    vault,
    probe,
    () => {},
    () => {},
  );
  assert.equal(restart.tasks.list().total, 1);
  restart.close();
});
test("v105: migration failure rolls back schema version, preserves original rows and backup", () => {
  const root = mkdtempSync(join(tmpdir(), "agent105-rollback-")),
    path = join(root, "old.sqlite");
  const old = new DatabaseSync(path);
  for (const m of migrations.slice(0, 3)) {
    old.exec(m.sql);
    old.exec(`PRAGMA user_version=${m.version}`);
  }
  old.prepare("INSERT INTO settings VALUES(?,?)").run("sentinel", '"keep"');
  old.exec("CREATE TABLE voices(sentinel TEXT)");
  old.close();
  assert.throws(() => new Database(path), /迁移失败/);
  const db = new DatabaseSync(path);
  assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 3);
  assert.equal(
    db.prepare("SELECT data FROM settings WHERE key='sentinel'").get()!.data,
    '"keep"',
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM sqlite_master WHERE name='asset_folders'",
      )
      .get()!.n,
    0,
  );
  db.close();
  assert(readdirSync(root).some((n) => n.startsWith("pre-migration")));
});
test("v105: ambiguous roots and program data paths stop safely", () => {
  const a = setup(),
    b = setup();
  a.app.close();
  b.app.close();
  const target = join(mkdtempSync(join(tmpdir(), "agent105-target-")), "user");
  assert.throws(() => migrateLegacyRoot(target, [a.root, b.root]), /多个/);
  assert(!existsSync(target));
  assert.throws(
    () => assertOutsideProgram("/program/data", "/program"),
    /不能/,
  );
});
test("v105: cloned voice survives restart; TTS uses voice_id; generated asset binds to saved Wan draft and submits", async () => {
  let calls: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).includes("result.wav")) return new Response(wav);
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    if (String(url).endsWith("customization"))
      return Response.json({ output: { voice: "cloned-fixture" } });
    return Response.json({
      request_id: "request-fixture",
      output: { audio: { url: "https://example.com/result.wav" } },
    });
  };
  const { app, root, account } = setup(fetcher);
  const a = (
    await app.assets.import(resolve("tests/fixtures/sample.wav"), true)
  ).asset;
  const voice = await app.audio.clone({
    modelId: "qwen-tts-clone",
    accountId: account.id,
    assetId: a.id,
    name: "我的声音",
  });
  const preferredName = (
    calls[0].input as Record<string, string>
  ).preferred_name;
  assert.match(preferredName, /^[a-z0-9]+$/i);
  assert(preferredName.length <= 10);
  assert.equal("prefix" in (calls[0].input as Record<string, string>), false);
  app.close();
  const next = new Application(
    root,
    vault,
    probe,
    () => {},
    () => {},
    fetcher,
  );
  assert.equal(next.audio.voices()[0].voiceId, "cloned-fixture");
  const input: AudioRequest = {
    name: "口播",
    modelId: "qwen-tts-clone",
    accountId: account.id,
    voiceId: voice.id,
    text: "这是配音测试。",
    instruction: "",
    format: "wav",
    params: {},
  };
  const t = await next.audio.create(input, "audio-once");
  const duplicate = await next.audio.create(input, "audio-once");
  assert.equal(t.id, duplicate.id);
  const completed = await waitTask(next, t.id);
  assert.equal(completed.status, "Completed");
  assert.equal(completed.downloadStatus, "completed");
  assert.equal(calls.length, 2);
  assert.equal(
    (calls[1].input as Record<string, string>).voice,
    "cloned-fixture",
  );
  const artifact = completed.outputs![0];
  assert.equal(artifact.kind, "audio");
  assert.equal(artifact.extension, "wav");
  assert(existsSync(artifact.localPath));
  const d = next.newDraft();
  d.prompt = "人物讲解";
  d.params.duration = 5;
  next.saveDraft(d);
  const bound = await next.audio.bind(artifact.metadata.assetId, d.draftId!);
  assert.equal(bound.assets[0].role, "reference_audio");
  assert.equal(bound.prompt, "人物讲解");
  assert.equal(
    next.drafts.get(d.draftId!).assets[0].assetId,
    artifact.metadata.assetId,
  );
  const video = await next.tasks.create(bound, "video-with-audio");
  assert.equal(video.snapshot.assets[0].role, "reference_audio");
  let sent: any;
  const adapter = new WanAdapter(
    new HttpClient(
      async (url, init) => {
        if (String(url).includes("getPolicy"))
          return Response.json({
            data: {
              upload_host: "https://fixture.oss-cn-beijing.aliyuncs.com",
              max_file_size_mb: 100,
              upload_dir: "fixture",
              oss_access_key_id: "fake",
              policy: "fake",
              signature: "fake",
              x_oss_object_acl: "private",
              x_oss_forbid_overwrite: "true",
            },
          });
        if (init?.body instanceof FormData) {
          assert.equal((init.body.get("file") as Blob).type, "audio/wav");
          return new Response("", { status: 200 });
        }
        sent = JSON.parse(String(init?.body));
        return Response.json({ output: { task_id: "wan-audio-ok" } });
      },
      undefined,
      0,
    ),
    async (_u, p) => p,
  );
  const uploaded = await adapter.uploadAssets(video.snapshot, "fake-key");
  assert.equal(
    await adapter.submitTask(video.snapshot, "fake-key", uploaded),
    "wan-audio-ok",
  );
  assert.equal(sent.input.media[0].type, "reference_audio");
  assert(sent.input.media[0].url.startsWith("oss://fixture/"));
  assert.equal(next.tasks.list({ kind: "audio" }).total, 1);
  assert.equal(next.tasks.list({ kind: "video" }).total, 1);
  assert.equal(next.tasks.list().total, 2);
  next.close();
});
test("v105: unsupported instruction and mismatched voice reject before paid request", async () => {
  let calls = 0;
  const { app, account } = setup(async () => {
    calls++;
    return Response.json({});
  });
  const input: AudioRequest = {
    name: "",
    text: "hello",
    instruction: "激动",
    voiceId: "Cherry",
    accountId: account.id,
    modelId: "qwen-tts-clone",
    format: "wav",
    params: {},
  };
  await assert.rejects(() => app.audio.create(input, "bad"), /不支持情绪/);
  await assert.rejects(
    () =>
      app.audio.create({ ...input, instruction: "", voiceId: "wrong" }, "bad2"),
    /支持的音色/,
  );
  assert.equal(calls, 0);
  assert.equal(app.tasks.list().total, 0);
  app.close();
});
test("v105: file download retry never resubmits paid TTS; interrupted submission pauses on restart", async () => {
  let submits = 0,
    downloads = 0;
  const { app, account } = setup(async (url) => {
    if (String(url).includes("result.wav"))
      return ++downloads === 1
        ? new Response("no", { status: 503 })
        : new Response(wav);
    submits++;
    return Response.json({
      output: { audio: { url: "https://example.com/result.wav" } },
    });
  });
  const t = await app.audio.create(
    {
      name: "retry",
      text: "测试",
      instruction: "轻松",
      modelId: "qwen-tts-instruct",
      accountId: account.id,
      voiceId: "Cherry",
      format: "wav",
      params: {},
    },
    "retry",
  );
  const first = await waitTask(app, t.id);
  assert.equal(first.downloadStatus, "failed");
  app.audio.redownload(t.id);
  await waitTask(app, t.id);
  assert.equal(app.tasks.get(t.id).downloadStatus, "completed");
  assert.equal(submits, 1);
  assert.equal(downloads, 2);
  const root = app.root;
  const interrupted = app.tasks.get(t.id);
  interrupted.status = "Submitting";
  interrupted.resultUrl = null;
  interrupted.apiTaskId = null;
  app.tasks.save(interrupted);
  app.close();
  const next = new Application(
    root,
    vault,
    probe,
    () => {},
    () => {},
  );
  next.audio.start();
  assert.equal(next.tasks.get(t.id).status, "Paused");
  next.close();
});
test("v105: logical folders, combined filtering and favorite order survive restart without file movement", async () => {
  const { app, root } = setup();
  const a = (
    await app.assets.import(resolve("tests/fixtures/sample.wav"), true)
  ).asset;
  const b = (
    await app.assets.import(resolve("tests/fixtures/sample.mp4"), true)
  ).asset;
  const parent = app.folders.save({ name: "人物" }),
    child = app.folders.save({ name: "创始人", parentId: parent.id });
  a.folder = child.id;
  a.favorite = true;
  app.assets.save(a);
  b.folder = child.id;
  app.assets.save(b);
  assert.throws(
    () => app.folders.save({ ...parent, parentId: child.id }),
    /自身/,
  );
  assert.equal(
    (
      await app.assets.list({
        folder: child.id,
        kind: "audio",
        search: "sample",
      })
    ).total,
    1,
  );
  assert.equal((await app.assets.list({ folder: child.id })).items[0].id, a.id);
  const path = a.managedPath;
  app.close();
  const next = new Application(
    root,
    vault,
    probe,
    () => {},
    () => {},
  );
  assert.equal(next.assets.get(a.id).managedPath, path);
  assert.equal(next.assets.get(a.id).favorite, true);
  next.folders.remove(child.id);
  assert.equal(next.assets.get(a.id).folder, "");
  assert(existsSync(path!));
  next.close();
});
test("v107: permanent business directories stay fixed under the data root", async () => {
  const { app, root } = setup();
  const external = mkdtempSync(join(tmpdir(), "agent105-dirs-"));
  await assert.rejects(
    () => app.saveSettings({ outputDir: join(external, "video") }),
    /固定在数据根目录/,
  );
  await app.saveSettings({ closeBehavior: "tray" });
  const a = (
    await app.assets.import(resolve("tests/fixtures/sample.wav"), true)
  ).asset;
  assert(a.managedPath!.startsWith(join(root, "cache", "managed-assets")));
  assert.equal(app.newDraft().outputDir, join(root, "outputs", "video"));
  await app.db.backupTo(join(app.settings().backupDir!, "test.sqlite"));
  assert.equal(app.settings().audioDir, join(root, "outputs", "audio"));
  app.close();
  const next = new Application(
    root,
    vault,
    probe,
    () => {},
    () => {},
  );
  assert.equal(next.settings().closeBehavior, "tray");
  assert.equal(next.settings().audioDir, join(root, "outputs", "audio"));
  next.close();
});
test("v105: generic downloader preserves WAV/MP3/PNG extensions and does not overwrite", async () => {
  const root = mkdtempSync(join(tmpdir(), "agent105-download-"));
  let bytes = wav;
  const dm = new DownloadManager(
    new Logger(root),
    1000,
    async () => new Response(bytes),
  );
  const a = await dm.download("https://example.com/a", join(root, "配音.wav"));
  const b = await dm.download("https://example.com/a", join(root, "配音.wav"));
  assert.notEqual(a, b);
  assert(b.endsWith(".wav"));
  bytes = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(60)]);
  assert(
    (
      await dm.download("https://example.com/a", join(root, "test.mp3"))
    ).endsWith(".mp3"),
  );
  bytes = readFileSync(resolve("resources/brand.png"));
  assert(
    (
      await dm.download("https://example.com/a", join(root, "test.png"))
    ).endsWith(".png"),
  );
  bytes = Buffer.from("<html>not audio</html>");
  await assert.rejects(
    () => dm.download("https://example.com/a", join(root, "invalid.wav")),
    /WAV/,
  );
});
test("v105: real media probe and FFmpeg conversion produce playable 24k mono WAV and MP3", async () => {
  const root = mkdtempSync(join(tmpdir(), "agent105-media-"));
  const out = join(root, "converted.wav");
  await convertAudio(resolve("tests/fixtures/sample.wav"), out);
  const info = await probeMedia(out, resolve("resources/MediaInfoModule.wasm"));
  assert.equal(info.sampleRate, 24000);
  assert.equal(info.channels, 1);
  assert.equal(info.bitDepth, 16);
  assert(info.duration! > 0);
  const mp3 = join(root, "converted.mp3");
  await convertAudio(out, mp3);
  const mp3info = await probeMedia(
    mp3,
    resolve("resources/MediaInfoModule.wasm"),
  );
  assert(mp3info.duration! > 0);
});

test("v105: imported video cover is generated asynchronously at 15 percent and reused from cache", async () => {
  const { app } = setup();
  const asset = (
    await app.assets.import(resolve("tests/fixtures/sample.mp4"), true)
  ).asset;
  await app.thumbnails.pending;
  const cached = app.assets.get(asset.id);
  assert(cached.thumbnailPath);
  assert(existsSync(cached.thumbnailPath!));
  const before = readFileSync(cached.thumbnailPath!);
  app.thumbnails.enqueue(cached);
  await app.thumbnails.pending;
  assert.deepEqual(
    readFileSync(app.assets.get(asset.id).thumbnailPath!),
    before,
  );
  app.close();
});
