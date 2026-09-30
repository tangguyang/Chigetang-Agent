import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/main/services/application.ts";
import { estimateSpeechDuration } from "../src/shared/audioDuration.ts";
import { models } from "../src/shared/catalog.ts";
import { wanPreflight } from "../src/shared/wanPreflight.ts";
import { probeMedia } from "../src/main/services/media.ts";
import type { Asset, AudioBatchRecord, Draft, Voice } from "../src/shared/types.ts";

const key = randomBytes(32);
const vault = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
  },
  decryptString: (value: Buffer) => {
    const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
    cipher.setAuthTag(value.subarray(-16));
    return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString();
  },
};

function setup(realProbe = false) {
  const root = mkdtempSync(join(tmpdir(), "v111-"));
  const wasm = join(process.cwd(), "resources", "MediaInfoModule.wasm");
  const app = new Application(
    root,
    vault,
    realProbe
      ? (path) => probeMedia(path, wasm)
      : async (_path, kind) => kind === "audio"
        ? { duration: 5, sampleRate: 24000, channels: 1 }
        : { width: 720, height: 1280, fps: 30 },
    () => {},
    () => {},
  );
  return { app, root };
}

function voice(accountId: string): Voice {
  return {
    id: randomUUID(), name: "voice", providerId: "alibaba", region: "cn-beijing",
    model: "cosyvoice-v3.5-plus", accountId, voiceId: "remote-voice", kind: "clone",
    createdAt: new Date().toISOString(), referenceAssetId: "asset", referencePath: "",
    referenceName: "voice.wav", referenceDuration: 5, notes: "", favorite: false,
    pinned: false, pinOrder: null, isDefault: true, status: "ready",
    createParams: { languageHints: ["zh"], maxPromptAudioLength: 20, enablePreprocess: false, enableVolumeNormalization: false },
  };
}

test("v111 Wan preview treats one long reference audio as 14 seconds but still enforces total 15 seconds", () => {
  const model = structuredClone(models.find((item) => item.id === "wan3")!);
  const draft: Draft = { name: "trim", modelId: model.id, accountId: "a", projectId: null, prompt: "test", params: { resolution: "720P", ratio: "9:16", duration: 5, audio: false, seed: -1, watermark: false, prompt_extend: false }, assets: [], outputDir: "out" };
  const audio = (id: string): Asset & { role: "reference_audio" } => ({ id, name: `${id}.wav`, kind: "audio", role: "reference_audio", originalPath: `${id}.wav`, managedPath: null, size: 30 * 1024 * 1024, mime: "audio/wav", hash: id, createdAt: new Date().toISOString(), lastUsedAt: null, tags: [], folder: "", projectId: null, favorite: false, duration: 20, metadata: { detectedFormat: "wav" } });
  const one = wanPreflight(model, draft, [audio("a")]);
  assert.equal(one.audioSeconds, 14);
  assert.equal(one.ok, true);
  assert(one.issues.some((issue) => issue.code === "audio-auto-trim" && issue.severity === "warning"));
  assert.equal(wanPreflight(model, draft, [audio("a"), audio("b")]).issues.some((issue) => issue.code === "audio-total"), true);
});

test("v111 speech estimate reacts to text, punctuation and rate without counting instruction", () => {
  const short = estimateSpeechDuration("你好世界。", 1, "voice");
  const long = estimateSpeechDuration("你好世界，这是更长的一段测试文本。请自然说完！", 1, "voice");
  assert(long.seconds > short.seconds);
  assert(estimateSpeechDuration("你好世界。", 2, "voice").seconds < short.seconds);
  assert(estimateSpeechDuration("你好世界。", 0.5, "voice").seconds > short.seconds);
});

test("v111 asset verification falls back to original and same-hash reimport repairs an unavailable record", async () => {
  const { app, root } = setup();
  const original = join(root, "source.wav");
  const replacement = join(root, "replacement.wav");
  const bytes = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(64)]);
  writeFileSync(original, bytes);
  writeFileSync(replacement, bytes);
  const imported = await app.assets.import(original, true);
  unlinkSync(imported.asset.managedPath!);
  assert.equal(await app.assets.verify(app.assets.get(imported.asset.id)), original);
  unlinkSync(original);
  const repaired = await app.assets.import(replacement, false);
  assert.equal(repaired.asset.id, imported.asset.id);
  assert.equal(repaired.asset.originalPath, replacement);
  app.close();
});

test("v111 audio unknown submission cannot be retried and deleting one result keeps its file", async () => {
  const { app, root } = setup();
  const account = app.credentials.save({ name: "A", providerId: "alibaba", workspaceId: "ws", key: "key" });
  const savedVoice = app.audio.saveVoice(voice(account.id));
  app.audio.stop();
  const batch = await app.audio.createBatch({ name: "batch", text: "测试台词", accountId: account.id, voiceId: savedVoice.id, requestId: randomUUID(), configs: [{ id: randomUUID(), name: "one", instruction: "", rate: 1, pitch: 1, volume: 50, seed: 1, format: "wav", sampleRate: 24000 }] });
  const job = batch.jobs[0];
  const task = app.tasks.get(job.taskId);
  task.status = "Paused";
  task.errorCode = "SubmissionUnknown";
  app.tasks.save(task);
  job.status = "failed";
  app.db.run("UPDATE cosy_jobs SET status=?,data=? WHERE id=?", job.status, JSON.stringify(job), job.id);
  assert.throws(() => app.audio.retryFailed(batch.id), /避免再次付费/);

  const kept = join(root, "kept.wav");
  writeFileSync(kept, "keep");
  task.status = "Completed";
  task.outputPath = kept;
  task.errorCode = null;
  app.tasks.save(task);
  job.status = "completed";
  job.outputPath = kept;
  app.db.run("UPDATE cosy_jobs SET status=?,data=? WHERE id=?", job.status, JSON.stringify(job), job.id);
  app.audio.deleteJob(job.id);
  assert.equal(existsSync(kept), true);
  assert.equal(app.audio.batches().length, 0);
  app.close();
});

test("v111 task creation snapshots the real cached 14-second audio and reuses it", async () => {
  const { app, root } = setup(true);
  const source = join(root, "twenty.wav");
  execFileSync("ffmpeg", ["-nostdin", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-ac", "1", "-ar", "24000", source], { stdio: "ignore" });
  const before = readFileSync(source);
  const asset = (await app.assets.import(source, false)).asset;
  const account = app.credentials.save({ name: "Wan", providerId: "alibaba", workspaceId: "ws", key: "key", region: "cn-beijing" });
  const outputDir = join(root, "output");
  const draft: Draft = { name: "trim", modelId: "wan3", accountId: account.id, projectId: null, prompt: "生成测试视频", params: { resolution: "720P", ratio: "9:16", duration: 5, audio: false, seed: -1, watermark: false, prompt_extend: false }, assets: [{ assetId: asset.id, role: "reference_audio", bindingId: randomUUID() }], outputDir };
  const first = await app.tasks.create(draft, randomUUID());
  const second = await app.tasks.create(draft, randomUUID());
  const used = first.snapshot.assets[0];
  assert.notEqual(used.id, asset.id);
  assert.equal(used.metadata?.source, "wan-audio-trim");
  assert.equal(used.metadata?.sourceAssetId, asset.id);
  assert(Math.abs(Number(used.duration) - 14) < 0.15);
  assert.equal(second.snapshot.assets[0].id, used.id);
  assert.deepEqual(readFileSync(source), before);
  app.close();
});
