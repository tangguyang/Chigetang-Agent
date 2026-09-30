import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../src/main/services/application.ts";
import { calibrateAudioDuration } from "../src/main/services/transcode.ts";
import { probeMedia } from "../src/main/services/media.ts";

const vault = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from("fixture:" + s),
  decryptString: (b: Buffer) => b.toString().slice(8),
};
const probe = async () => ({ duration: 5, sampleRate: 24000, channels: 1 });
const digest = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function setup(fetcher: typeof fetch = async () => {
  throw new Error("unexpected network");
}) {
  const root = mkdtempSync(join(tmpdir(), "agent107-data-"));
  const app = new Application(root, vault, probe, () => {}, () => {}, fetcher);
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

test("v107: Qwen-Audio clone sends a distinct alphanumeric prefix of at most 10 characters", async () => {
  let cloneBody: Record<string, any> | undefined;
  const fetcher: typeof fetch = async (url, init) => {
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
    if (init?.body instanceof FormData) return new Response("", { status: 200 });
    cloneBody = JSON.parse(String(init?.body));
    return Response.json({ output: { voice: "qwen-audio-fixture" } });
  };
  const { app, account } = setup(fetcher);
  const source = join(mkdtempSync(join(tmpdir(), "agent107-voice-")), "voice.wav");
  writeFileSync(source, readFileSync(resolve("tests/fixtures/sample.wav")));
  const asset = (await app.assets.import(source, false)).asset;
  const voice = await app.audio.clone({
    modelId: "qwen-audio-tts-plus",
    accountId: account.id,
    assetId: asset.id,
    name: "音色版本一",
  });
  const input = cloneBody?.input as Record<string, string>;
  assert.match(input.prefix, /^[a-z0-9]+$/i);
  assert(input.prefix.length <= 10);
  assert.equal("preferred_name" in input, false);
  assert.equal(voice.voiceId, "qwen-audio-fixture");
  app.close();
});

test("v107: pitch-preserving duration calibration produces the requested decimal duration without trimming", async () => {
  const output = join(mkdtempSync(join(tmpdir(), "agent107-duration-")), "calibrated.wav");
  await calibrateAudioDuration(
    resolve("tests/fixtures/sample.wav"),
    output,
    1,
    0.8,
  );
  const info = await probeMedia(output, resolve("resources/MediaInfoModule.wasm"));
  assert(existsSync(output));
  assert(Math.abs((info.duration ?? 0) - 0.8) < 0.04);
});

test("v107: reference-only assets survive refresh, batch removal and folder relocation byte-for-byte", async () => {
  const { app } = setup();
  const parent = mkdtempSync(join(tmpdir(), "agent107-sources-"));
  const oldFolder = join(parent, "before");
  const newFolder = join(parent, "after");
  mkdirSync(oldFolder);
  const firstPath = join(oldFolder, "first.wav");
  const secondPath = join(oldFolder, "second.wav");
  writeFileSync(firstPath, readFileSync(resolve("tests/fixtures/sample.wav")));
  writeFileSync(
    secondPath,
    Buffer.concat([readFileSync(resolve("tests/fixtures/sample.wav")), Buffer.from([1])]),
  );
  const before = new Map([
    ["first.wav", digest(firstPath)],
    ["second.wav", digest(secondPath)],
  ]);
  const first = (await app.assets.import(firstPath, false)).asset;
  const second = (await app.assets.import(secondPath, false)).asset;
  assert.equal(first.managedPath, null);
  assert.equal(second.managedPath, null);
  const draft = app.newDraft();
  draft.prompt = "使用已保存的参考音频";
  draft.params.duration = 5;
  draft.assets = [
    { assetId: first.id, role: "reference_audio", bindingId: "restore-ref" },
  ];
  const historicalTask = await app.tasks.create(draft, "path-restore-task");

  renameSync(oldFolder, newFolder);
  assert.deepEqual(await app.assets.refresh(), { available: 0, missing: 2 });
  const repaired = await app.assets.relocateFolder(first.id, newFolder);
  assert.equal(repaired.repaired, 2);
  assert.deepEqual(await app.assets.refresh(), { available: 2, missing: 0 });
  assert.equal(await app.assets.verify(app.assets.get(first.id)), join(newFolder, "first.wav"));
  assert.equal(historicalTask.snapshot.assets[0].id, first.id);
  assert.equal(
    await app.assets.verify(app.assets.get(historicalTask.snapshot.assets[0].id)),
    join(newFolder, "first.wav"),
  );

  assert.equal(app.assets.removeRecords([first.id, second.id]), 2);
  assert.equal((await app.assets.list()).total, 0);
  assert.equal(await app.assets.verify(app.assets.get(second.id)), join(newFolder, "second.wav"));
  for (const [name, hash] of before) {
    const path = join(newFolder, name);
    assert(existsSync(path));
    assert.equal(digest(path), hash);
  }
  app.close();
});

test("v107: default reset preserves business data; factory reset preserves sources and outputs by default", async () => {
  const { app, root } = setup();
  const source = join(mkdtempSync(join(tmpdir(), "agent107-original-")), "original.wav");
  writeFileSync(source, readFileSync(resolve("tests/fixtures/sample.wav")));
  const sourceHash = digest(source);
  const asset = (await app.assets.import(source, false)).asset;
  const prompt = app.prompts.save({ name: "保留", content: "保留业务数据" });
  await app.saveSettings({ closeBehavior: "tray" });

  app.resetDefaults();
  assert.equal(app.settings().closeBehavior, "exit");
  assert.equal(app.assets.get(asset.id).hash, sourceHash);
  assert.equal(
    app.prompts.list().items.find((item) => item.id === prompt.id)?.content,
    "保留业务数据",
  );
  assert.equal(app.credentials.list().length, 1);

  const output = join(root, "outputs", "video", "kept.mp4");
  mkdirSync(join(root, "outputs", "video"), { recursive: true });
  writeFileSync(output, "generated-result");
  const task = await app.tasks.create(
    { ...app.newDraft(), name: "成品", prompt: "测试", params: { ...app.newDraft().params, duration: 5 } },
    "factory-keep",
  );
  task.status = "Completed";
  task.outputPath = output;
  task.outputs = [{ kind: "video", mimeType: "video/mp4", extension: "mp4", localPath: output, metadata: {} }];
  app.tasks.save(task);

  const reset = await app.factoryReset(false);
  assert(existsSync(reset.backup));
  assert(existsSync(output));
  assert(existsSync(source));
  assert.equal(digest(source), sourceHash);
  assert.equal(app.credentials.list().length, 0);
  assert.equal((await app.assets.list()).total, 0);
  assert.equal(app.tasks.list().total, 0);
  app.close();
});

test("v107: delete-output reset quarantines only a tracked managed output and never original media", async () => {
  const { app, root } = setup();
  const source = join(mkdtempSync(join(tmpdir(), "agent107-original-")), "original.wav");
  writeFileSync(source, readFileSync(resolve("tests/fixtures/sample.wav")));
  const sourceHash = digest(source);
  await app.assets.import(source, false);
  const output = join(root, "outputs", "audio", "tracked.wav");
  mkdirSync(join(root, "outputs", "audio"), { recursive: true });
  writeFileSync(output, "managed-output");
  const task = await app.tasks.create(
    { ...app.newDraft(), name: "配音", prompt: "测试", params: { ...app.newDraft().params, duration: 5 } },
    "factory-delete-output",
  );
  task.status = "Completed";
  task.outputPath = output;
  task.outputs = [{ kind: "audio", mimeType: "audio/wav", extension: "wav", localPath: output, metadata: {} }];
  app.tasks.save(task);

  const reset = await app.factoryReset(true);
  assert.equal(reset.moved, 1);
  assert.equal(existsSync(output), false);
  assert(reset.quarantine && existsSync(reset.quarantine));
  assert(existsSync(source));
  assert.equal(digest(source), sourceHash);
  app.close();
});
