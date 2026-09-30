import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/main/services/application.ts";
import { detectFileSignature } from "../src/main/services/assets.ts";
import { models } from "../src/shared/catalog.ts";
import type { Asset, Draft, Voice } from "../src/shared/types.ts";
import { wanPreflight } from "../src/shared/wanPreflight.ts";

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
function appSetup() {
  const root = mkdtempSync(join(tmpdir(), "v110-"));
  const app = new Application(
    root,
    vault,
    async (_path, kind) => kind === "audio"
      ? { duration: 5, sampleRate: 24000, channels: 1 }
      : { width: 720, height: 1280, duration: kind === "video" ? 3 : undefined, fps: 30 },
    () => {},
    () => {},
  );
  return { app, root };
}
const model = structuredClone(models.find((item) => item.id === "wan3")!);
const draft = (duration: number): Draft => ({
  name: "preflight",
  modelId: model.id,
  accountId: "account",
  projectId: null,
  prompt: "test",
  params: { resolution: "720P", ratio: "9:16", duration, audio: false, seed: -1, watermark: false, prompt_extend: false },
  assets: [],
  outputDir: "C:\\output",
});
const media = (kind: "video" | "audio" | "image", seconds = 3, index = 0): Asset & { role: "reference_video" | "reference_audio" | "reference_image" } => ({
  id: `${kind}-${index}`,
  name: `${kind}-${index}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`,
  kind,
  role: kind === "image" ? "reference_image" : kind === "video" ? "reference_video" : "reference_audio",
  originalPath: "fixture",
  managedPath: null,
  size: 1024,
  mime: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/wav",
  hash: `${kind}-${index}`,
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  tags: [], folder: "", projectId: null, favorite: false,
  width: kind === "audio" ? undefined : 720,
  height: kind === "audio" ? undefined : 1280,
  duration: kind === "image" ? undefined : seconds,
  fps: kind === "video" ? 30 : undefined,
  hasAlpha: false,
  metadata: { detectedFormat: kind === "image" ? "png" : kind === "video" ? "mp4" : "wav" },
});

test("v110 Wan preflight keeps video/audio budgets separate and enforces input plus output", () => {
  const videos15 = Array.from({ length: 5 }, (_, i) => media("video", 3, i));
  const audio15 = Array.from({ length: 5 }, (_, i) => media("audio", 3, i));
  assert.equal(wanPreflight(model, draft(15), [...videos15, ...audio15]).ok, true);
  assert.equal(wanPreflight(model, draft(20), [...videos15, ...audio15]).ok, false);
  const ten = [media("video", 5, 11), media("video", 5, 12), media("audio", 5, 11), media("audio", 5, 12)];
  assert.equal(wanPreflight(model, draft(20), ten).ok, true);
  assert.match(wanPreflight(model, draft(20), videos15).issues.map((item) => item.code).join(), /input-output-total/);
});

test("v110 Wan preflight rejects count, totals, unreadable media, bad format, alpha and mixed modes", () => {
  const tooMany = Array.from({ length: 6 }, (_, i) => media("video", 2, i));
  assert(wanPreflight(model, draft(5), tooMany).issues.some((item) => item.code === "video-count"));
  const longVideo = [media("video", 8, 31), media("video", 8, 32)];
  assert(wanPreflight(model, draft(5), longVideo).issues.some((item) => item.code === "video-total"));
  const longAudio = [media("audio", 8, 1), media("audio", 8, 2)];
  assert(wanPreflight(model, draft(5), longAudio).issues.some((item) => item.code === "audio-total"));
  const invalid = media("video", 3, 20);
  invalid.metadata = { detectedFormat: "avi" };
  invalid.fps = undefined;
  invalid.missing = true;
  assert.equal(wanPreflight(model, draft(5), [invalid]).ok, false);
  const alpha = media("image", 0, 1); alpha.hasAlpha = true;
  const frame = { ...media("image", 0, 2), role: "first_frame" as const };
  assert(wanPreflight(model, draft(5), [alpha]).issues.some((item) => item.code === "image-alpha"));
  assert(wanPreflight(model, draft(5), [frame, media("audio", 3, 3)]).issues.some((item) => item.code === "mixed-modes"));
  const smart = wanPreflight(model, draft(-1), []);
  assert.equal(smart.ok, true);
  assert(smart.issues.some((item) => item.code === "smart-duration" && item.severity === "warning"));
});

test("v110 Wan preflight rejects file size, dimensions, ratio and low frame rate", () => {
  const oversized = media("audio", 3, 41);
  oversized.size = 16 * 1024 * 1024;
  assert(wanPreflight(model, draft(5), [oversized]).issues.some((item) => item.code === "audio-size"));
  const small = media("image", 0, 42);
  small.width = 200;
  small.height = 200;
  assert(wanPreflight(model, draft(5), [small]).issues.some((item) => item.code === "image-dimensions"));
  const wide = media("image", 0, 43);
  wide.width = 7200;
  wide.height = 720;
  assert(wanPreflight(model, draft(5), [wide]).issues.some((item) => item.code === "image-ratio"));
  const lowFps = media("video", 3, 44);
  lowFps.fps = 15;
  assert(wanPreflight(model, draft(5), [lowFps]).issues.some((item) => item.code === "video-fps"));
});

test("v110 signature detection distinguishes MP3 from AAC and detects PNG alpha", async () => {
  const root = mkdtempSync(join(tmpdir(), "v110-signature-"));
  const mp3 = join(root, "voice.mp3");
  const aac = join(root, "voice.aac");
  const png = join(root, "alpha.png");
  writeFileSync(mp3, Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]));
  writeFileSync(aac, Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0, 0]));
  const pngBytes = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(pngBytes);
  pngBytes[25] = 6;
  writeFileSync(png, pngBytes);
  assert.equal((await detectFileSignature(mp3)).format, "mp3");
  assert.equal((await detectFileSignature(aac)).format, "");
  assert.equal((await detectFileSignature(png)).hasAlpha, true);
});

test("v110 missing assets hide reversibly without deleting records or IDs", async () => {
  const { app, root } = appSetup();
  const path = join(root, "asset.png");
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 2, 208, 0, 0, 5, 0, 2, 0]);
  writeFileSync(path, bytes);
  const asset = (await app.assets.import(path, false)).asset;
  unlinkSync(path);
  assert.equal((await app.assets.list({ kind: "image" })).total, 0);
  const hidden = await app.assets.list({ hidden: true });
  assert.equal(hidden.items[0].id, asset.id);
  writeFileSync(path, bytes);
  await app.assets.refresh();
  assert.equal((await app.assets.list({ kind: "image" })).items[0].id, asset.id);
  assert.equal((await app.assets.list({ hidden: true })).total, 0);
  app.close();
});

function voice(accountId: string, id = randomUUID(), isDefault = false): Voice {
  return { id, name: id, providerId: "alibaba", region: "cn-beijing", model: "cosyvoice-v3.5-plus", accountId, voiceId: `remote-${id}`, kind: "clone", createdAt: new Date().toISOString(), referenceAssetId: "asset", referencePath: "", notes: "", favorite: false, pinned: false, pinOrder: null, isDefault, status: "ready", referenceName: "voice.wav", referenceDuration: 5, createParams: { languageHints: ["zh"], maxPromptAudioLength: 20, enablePreprocess: false, enableVolumeNormalization: false } };
}

test("v110 default voice toggles off and is isolated per API account", () => {
  const { app } = appSetup();
  const a = app.credentials.save({ name: "A", providerId: "alibaba", workspaceId: "ws-a", key: "key-a" });
  const b = app.credentials.save({ name: "B", providerId: "alibaba", workspaceId: "ws-b", key: "key-b", isDefault: false });
  const a1 = app.audio.saveVoice(voice(a.id, "a1", true));
  const b1 = app.audio.saveVoice(voice(b.id, "b1", true));
  const a2 = app.audio.saveVoice(voice(a.id, "a2", true));
  assert.equal(app.audio.voices().find((item) => item.id === a1.id)?.isDefault, false);
  assert.equal(app.audio.voices().find((item) => item.id === b1.id)?.isDefault, true);
  app.audio.updateVoice(a2.id, { isDefault: false });
  assert.equal(app.audio.voices().some((item) => item.accountId === a.id && item.isDefault), false);
  app.close();
});

test("v110 single audio result display name persists independently from batch name", async () => {
  const { app } = appSetup();
  const account = app.credentials.save({ name: "A", providerId: "alibaba", workspaceId: "ws-a", key: "key-a" });
  const saved = app.audio.saveVoice(voice(account.id, "voice-a"));
  app.audio.stop();
  const batch = await app.audio.createBatch({ name: "批次名称", text: "测试台词", accountId: account.id, voiceId: saved.id, requestId: randomUUID(), configs: [{ id: randomUUID(), name: "配置名称", instruction: "", rate: 1, pitch: 1, volume: 50, seed: 1, format: "wav", sampleRate: 24000 }] });
  app.audio.renameJob(batch.jobs[0].id, "单条成品名称");
  const reloaded = app.audio.batch(batch.id);
  assert.equal(reloaded.name, "批次名称");
  assert.equal(reloaded.jobs[0].config.name, "单条成品名称");
  assert.equal(app.tasks.get(reloaded.jobs[0].taskId).name, "单条成品名称");
  app.close();
});
