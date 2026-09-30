import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Application } from "../src/main/services/application.ts";
import { audioModels, voiceCompatible } from "../src/shared/audioCatalog.ts";
import { defaults, models } from "../src/shared/catalog.ts";
import {
  assetCompatibilityReason,
  retainDraftAssets,
} from "../src/shared/draftCompatibility.ts";
import { durationOptions } from "../src/shared/duration.ts";
import {
  autoBindMentions,
  compilePrompt,
  missingTextMentions,
} from "../src/shared/mentions.ts";
import { planSegments, promptForSegment } from "../src/shared/segmentation.ts";
import {
  defaultDirectories,
  migrateLegacyRoot,
} from "../src/main/services/storage.ts";
import { probeMedia } from "../src/main/services/media.ts";
import { hasFFmpeg } from "../src/main/services/transcode.ts";
import type { Asset, Draft } from "../src/shared/types.ts";

const asset = (id: string, kind: Asset["kind"], duration?: number): Asset => ({
  id,
  name: `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`,
  kind,
  originalPath: `C:/吃个糖 Agent/${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`,
  managedPath: null,
  size: 1024,
  mime:
    kind === "image"
      ? "image/png"
      : kind === "video"
        ? "video/mp4"
        : "audio/wav",
  hash: id,
  createdAt: "2026-09-19T00:00:00Z",
  lastUsedAt: null,
  tags: [],
  folder: "",
  projectId: null,
  favorite: false,
  duration,
  ...(kind === "image" ? { width: 1024, height: 1024 } : {}),
  ...(kind === "video" ? { width: 1080, height: 1920, fps: 30 } : {}),
});

const draft = (prompt: string): Draft => ({
  name: "v106",
  modelId: "wan3",
  accountId: "auto",
  projectId: null,
  prompt,
  params: { duration: 5 },
  assets: [
    { assetId: "image-a", role: "reference_image", bindingId: "bi-a" },
    { assetId: "image-b", role: "reference_image", bindingId: "bi-b" },
    { assetId: "video-a", role: "reference_video", bindingId: "bv-a" },
    { assetId: "audio-a", role: "reference_audio", bindingId: "ba-a" },
  ],
  outputDir: "C:/吃个糖 Agent/UserData/outputs/video",
});

const assets = [
  asset("image-a", "image"),
  asset("image-b", "image"),
  asset("video-a", "video", 22.23),
  asset("audio-a", "audio", 24.16),
];

test("v106: copied @ mentions bind with optional spaces and missing indexes stay unbound", () => {
  const bound = autoBindMentions(
    draft("@Image 1 跟随 @Video1 和 @Audio 1；@Video2 不存在"),
    assets,
  );
  assert.match(bound.prompt, /@Image1/);
  assert.equal(bound.mentions?.length, 3);
  assert.deepEqual(missingTextMentions(bound), ["Video2"]);
  assert.throws(() => compilePrompt(bound, assets, "wan3"), /@Video2 未找到/);
});

test("v106: removing the first image keeps stable binding and relabels the visible token", () => {
  const bound = autoBindMentions(draft("@Image1 与 @Image2"), assets);
  const kept = bound.assets.filter((binding) => binding.assetId !== "image-a");
  const next = retainDraftAssets(bound, kept);
  assert.equal(next.prompt.trim(), "与 @Image1");
  assert.equal(next.mentions?.[0].assetId, "image-b");
  assert.match(compilePrompt(next, assets, "wan3"), /图1/);
});

test("v106: capability reports long media separately and limits legal output duration", () => {
  const wan = structuredClone(models.find((model) => model.id === "wan3")!);
  const video = assets.find((item) => item.kind === "video")!;
  assert.match(
    assetCompatibilityReason(video, draft("").assets[2], wan)!,
    /22\.23.*15/,
  );
  const options = durationOptions(wan, {}, [{ ...video, duration: 12 }]);
  assert.equal(options.at(-1), 18);
  assert(!options.includes(19));
});

test("v106: natural cut can create more than two aligned segments", () => {
  const segments = planSegments(34.2, 15, [11.82, 24.16]);
  assert.deepEqual(
    segments.map(({ start, end }) => [start, end]),
    [
      [0, 11.82],
      [11.82, 24.16],
      [24.16, 34.2],
    ],
  );
  assert(segments.every((segment) => segment.duration <= 15));
});

test("v106: timeline prompt clips and rebases a range crossing a segment cut", () => {
  const prompt = "人物恒定\n10~14秒 加强手势\n14~18秒 反问";
  assert.equal(
    promptForSegment(prompt, { index: 2, start: 12, end: 18, duration: 6 }),
    "人物恒定\n0.00-2.00秒 加强手势\n2.00-6.00秒 反问",
  );
});

test("v106: Qwen-Audio clone model exposes separate instruction protocol", () => {
  const model = audioModels(models[0]).find(
    (item) => item.id === "qwen-audio-tts-plus",
  )!;
  assert.equal(model.officialId, "qwen-audio-3.0-tts-plus");
  assert.equal(model.audio?.supportsVoiceClone, true);
  assert.equal(model.audio?.supportsInstruction, true);
  assert.equal(model.audio?.instructionField, "instruction");
  assert.match(model.audio!.endpoints["cn-beijing"].tts, /\{workspace\}/);
  assert(
    !
    voiceCompatible(
      {
        id: "old-voice",
        name: "旧版音色",
        providerId: "alibaba",
        region: "cn-beijing",
        model: "qwen3-tts-vc-2026-01-22",
        accountId: "account",
        voiceId: "old-remote-id",
        kind: "clone",
        createdAt: "2026-09-19T00:00:00Z",
        referenceAssetId: "reference-audio",
        referencePath: "C:/reference.wav",
        notes: "",
        favorite: false,
      },
      model,
      {
        id: "account",
        name: "account",
        providerId: "alibaba",
        workspaceId: "ws-test",
        region: "cn-beijing",
        endpoint: "",
        notes: "",
        manualBalance: "",
        enabled: true,
        isDefault: true,
        maxConcurrent: 2,
        createdAt: "2026-09-19T00:00:00Z",
        maskedKey: "••••",
      },
    ),
  );
});

test("v106: Qwen-Audio request keeps text, voice and instruction separate and saves an asset", async () => {
  const calls: Record<string, unknown>[] = [];
  const wav = readFileSync(resolve("tests/fixtures/sample.wav"));
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).includes("result.wav")) return new Response(wav);
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({
      output: { audio: { url: "https://example.com/result.wav" } },
    });
  };
  const root = mkdtempSync(join(tmpdir(), "agent106-audio-"));
  const app = new Application(
    root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
    async () => ({ duration: 5, sampleRate: 24000, channels: 1, bitDepth: 16 }),
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
    enabled: true,
    maxConcurrent: 2,
  });
  const model = app.models().find((item) => item.id === "qwen-audio-tts-plus")!;
  const voice = app.audio.saveVoice({
    id: "voice-fixture",
    name: "我的音色",
    providerId: "alibaba",
    region: "cn-beijing",
    model: model.officialId,
    accountId: account.id,
    voiceId: "remote-voice",
    kind: "clone",
    createdAt: "2026-09-19T00:00:00Z",
    referenceAssetId: "",
    referencePath: "",
    notes: "",
    favorite: false,
  });
  const task = await app.audio.create(
    {
      name: "情绪测试",
      text: "这是台词。",
      instruction: "真实笃定，最后一句加强。",
      modelId: model.id,
      accountId: account.id,
      voiceId: voice.id,
      format: "wav",
      params: {},
    },
    "v106-audio-request",
  );
  for (let index = 0; index < 100; index++) {
    if (["Completed", "Failed"].includes(app.tasks.get(task.id).status)) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  const completed = app.tasks.get(task.id);
  assert.equal(completed.status, "Completed", completed.error || "");
  const request = calls[0] as { input: Record<string, unknown> };
  assert.deepEqual(request.input, {
    text: "这是台词。",
    voice: "remote-voice",
    format: "wav",
    sample_rate: 24000,
    instruction: "真实笃定，最后一句加强。",
  });
  assert(
    (await app.assets.list({ kind: "audio" })).items.some(
      (item) => item.metadata?.taskId === task.id,
    ),
  );
  app.audio.stop();
  app.close();
});

test("v106: portable defaults stay under the selected software data root", () => {
  const root = "D:/工具/吃个糖 Agent/UserData";
  const paths = defaultDirectories(root);
  assert(Object.values(paths).every((path) => path.startsWith(root)));
  assert.match(paths.audioDir, /outputs[\\/]audio$/);
  assert.match(paths.outputDir, /outputs[\\/]video$/);
});

test("v106: legacy portable data can migrate into its immediate UserData child", () => {
  const root = mkdtempSync(join(tmpdir(), "agent106-portable-"));
  const app = new Application(
    root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
    async () => ({}),
    () => {},
    () => {},
  );
  app.prompts.save({ name: "便携数据", content: "保留" });
  app.close();
  const destination = join(root, "UserData");
  migrateLegacyRoot(destination, [root]);
  const moved = new Application(
    destination,
    {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
    async () => ({}),
    () => {},
    () => {},
  );
  assert.equal(moved.prompts.list().items[0].content, "保留");
  moved.close();
});

test("v106: real 22.23s video and 24.16s audio split, group and merge with master audio", async (t) => {
  if (!(await hasFFmpeg())) {
    t.skip("FFmpeg unavailable");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "agent106-segments-"));
  const videoPath = join(root, "reference-22.23.mp4");
  const audioPath = join(root, "master-24.16.wav");
  execFileSync(
    "ffmpeg",
    [
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x240:r=24:d=22.23",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      videoPath,
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "ffmpeg",
    [
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=24000:duration=24.16",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      audioPath,
    ],
    { stdio: "ignore" },
  );
  const app = new Application(
    root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
    (path, kind) => probeMedia(path, resolve("resources/MediaInfoModule.wasm")),
    () => {},
    () => {},
  );
  const account = app.credentials.save({
    name: "fixture",
    providerId: "alibaba",
    workspaceId: "ws-test",
    region: "cn-beijing",
    key: "fake-test-key",
    enabled: true,
    maxConcurrent: 2,
  });
  const video = (await app.assets.import(videoPath, true)).asset;
  const audio = (await app.assets.import(audioPath, true)).asset;
  assert(Math.abs((video.duration ?? 0) - 22.23) < 0.15);
  assert(Math.abs((audio.duration ?? 0) - 24.16) < 0.05);
  const wan = app.models().find((model) => model.id === "wan3")!;
  const source: Draft = {
    ...app.newDraft(),
    name: "24秒自动分段",
    accountId: account.id,
    prompt: "人物恒定\n0~12秒 @Video1 跟随 @Audio1\n12~24.16秒 继续表演",
    params: { ...defaults(wan), duration: 5 },
    assets: [
      {
        assetId: video.id,
        role: "reference_video",
        bindingId: "video-binding",
      },
      {
        assetId: audio.id,
        role: "reference_audio",
        bindingId: "audio-binding",
      },
    ],
  };
  const parent = await app.tasks.createSegmented(source, "v106-real-segments");
  const children = app.tasks.children(parent.id);
  assert.equal(children.length, 2);
  assert(
    children.every((child) =>
      child.snapshot.assets
        .filter((item) => item.kind !== "image")
        .every((item) => (item.duration ?? Infinity) <= 15.1),
    ),
  );
  for (const child of children) {
    const segmentVideo = child.snapshot.assets.find(
      (item) => item.role === "reference_video",
    )!;
    child.outputPath = segmentVideo.managedPath || segmentVideo.originalPath;
    child.status = "Completed";
    child.completedAt = new Date().toISOString();
    app.tasks.save(child);
  }
  await app.tasks.finalizeSegmentGroup(parent.id);
  const completed = app.tasks.get(parent.id);
  assert.equal(completed.status, "Completed", completed.error || "");
  assert(completed.outputPath && existsSync(completed.outputPath));
  assert((completed.outputs?.[0].duration ?? 0) > 23.5);
  assert(
    (await app.assets.list({ kind: "video" })).items.some(
      (item) => item.metadata?.taskId === parent.id,
    ),
  );
  app.close();
});
