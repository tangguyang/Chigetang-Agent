import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../src/main/services/application.ts";
import { BUILTIN_PRESETS, instructionLength } from "../src/main/services/audio.ts";
import { COSYVOICE_MODEL_ID } from "../src/shared/audioCatalog.ts";
import type { AudioGenerationConfig } from "../src/shared/types.ts";

const vault = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString(),
};
const wav = readFileSync(resolve("tests/fixtures/sample.wav"));

function harness(options: { duration?: number; failSeed?: number } = {}) {
  const calls: { url: string; body: any }[] = [];
  let serial = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).includes("getPolicy"))
      return Response.json({ data: { upload_host: "https://fixture.oss-cn-beijing.aliyuncs.com", max_file_size_mb: 100, upload_dir: "fixture", oss_access_key_id: "mock", policy: "mock", signature: "mock", x_oss_object_acl: "private", x_oss_forbid_overwrite: "true" } });
    if (init?.body instanceof FormData) return new Response("", { status: 200 });
    if (String(url).includes("result.wav")) return new Response(wav);
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body });
    if (body.input?.action === "create_voice") return Response.json({ request_id: "clone-request", output: { voice_id: `cosyvoice-v3.5-plus-fixture-${++serial}` } });
    if (body.input?.action === "query_voice") return Response.json({ request_id: "query-request", output: { status: "ready" } });
    if (body.input?.seed === options.failSeed) return Response.json({ code: "InvalidParameter", message: "mock failure" });
    return Response.json({ request_id: `tts-${body.input.seed}`, output: { audio: { url: "https://example.com/result.wav" } } });
  };
  const root = mkdtempSync(join(tmpdir(), "agent109-"));
  const app = new Application(
    root, vault,
    async () => ({ duration: options.duration ?? 12, sampleRate: 24000, channels: 1, bitDepth: 16 }),
    () => {}, () => {}, fetcher,
  );
  app.audio.stopped = true;
  const account = app.credentials.save({ name: "Mock Beijing", providerId: "alibaba", region: "cn-beijing", workspaceId: "ws-test", key: "mock-key", enabled: true, maxConcurrent: 2 });
  const source = join(root, "reference.wav");
  writeFileSync(source, wav);
  return { app, account, source, root, calls, fetcher };
}

async function cloneVoice(app: Application, accountId: string, source: string, name = "品牌主理人 V1") {
  const asset = (await app.assets.import(source, false)).asset;
  return app.audio.clone({ accountId, assetId: asset.id, name, notes: "长期使用", languageHints: ["zh"], maxPromptAudioLength: 20, enablePreprocess: false, enableVolumeNormalization: false });
}

const config = (id: string, seed = 12345, instruction = "自然聊天"):
  AudioGenerationConfig => ({ id, name: `配置 ${id}`, instruction, rate: 1, pitch: 1, volume: 50, seed, format: "wav", sampleRate: 24000 });

test("v109: only CosyVoice 3.5 Plus remains and Wan 3.0 model/request path is unchanged", async () => {
  const { app, account } = harness();
  const audio = app.models().filter((item) => item.type === "audio");
  assert.deepEqual(audio.map((item) => item.id), [COSYVOICE_MODEL_ID]);
  assert.equal(audio[0].officialId, "cosyvoice-v3.5-plus");
  const wan = app.models().find((item) => item.id === "wan3");
  assert(wan && wan.type === "video");
  const draft = app.newDraft();
  draft.accountId = account.id;
  draft.modelId = "wan3";
  draft.prompt = "人物在办公室自然讲解";
  draft.params.duration = 5;
  const task = await app.tasks.create(draft, "wan-regression-v109");
  assert.equal(task.snapshot.model.id, "wan3");
  assert.equal(task.snapshot.draft.prompt, draft.prompt);
  assert.equal(task.snapshot.draft.params.duration, 5);
  app.close();
});

test("v109: one-time legacy cleanup deletes only owned audio and protects Wan/draft references", async () => {
  const { app, account, root, fetcher } = harness();
  const audioDir = app.settings().audioDir!;
  mkdirSync(audioDir, { recursive: true });
  const protectedPath = join(audioDir, "protected.wav"), removablePath = join(audioDir, "removable.wav");
  writeFileSync(protectedPath, wav); writeFileSync(removablePath, Buffer.concat([wav, Buffer.from([1])]));
  const protectedAsset = (await app.assets.import(protectedPath, false)).asset;
  const removableAsset = (await app.assets.import(removablePath, false)).asset;
  protectedAsset.metadata = { source: "generated", taskId: "legacy-protected" };
  removableAsset.metadata = { source: "generated", taskId: "legacy-removable" };
  app.assets.save(protectedAsset); app.assets.save(removableAsset);
  const draft = app.newDraft();
  draft.assets = [{ assetId: protectedAsset.id, role: "reference_audio", bindingId: "wan-protected-audio" }];
  app.saveDraft(draft);
  const now = new Date().toISOString();
  for (const [id, path] of [["legacy-protected", protectedPath], ["legacy-removable", removablePath]]) {
    app.db.run("INSERT INTO tasks VALUES(?,?,?)", id, id, now);
    app.db.run(
      "INSERT INTO task_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, id, null, null, 1, "Completed", "alibaba", "legacy-audio", account.id,
      null, now, null, JSON.stringify({ id, type: "audio", outputPath: path, outputs: [] }),
    );
  }
  app.db.run("DELETE FROM settings WHERE key='v109-audio-cleaned'");
  app.close();
  const next = new Application(root, vault, async () => ({ duration: 12, sampleRate: 24000, channels: 1 }), () => {}, () => {}, fetcher);
  assert(existsSync(protectedPath));
  assert.equal(next.assets.get(protectedAsset.id).id, protectedAsset.id);
  assert(!existsSync(removablePath));
  assert.throws(() => next.assets.get(removableAsset.id));
  assert.equal(next.tasks.list({ kind: "audio" }).total, 0);
  next.close();
});

test("v109: voice enrollment submits official fields, saves full voice_id and persists management state", async () => {
  const { app, account, source, root, calls, fetcher } = harness();
  const voice = await cloneVoice(app, account.id, source);
  const create = calls.find((item) => item.body.input?.action === "create_voice")!.body;
  assert.deepEqual(create, { model: "voice-enrollment", input: {
    action: "create_voice", target_model: COSYVOICE_MODEL_ID,
    prefix: create.input.prefix, url: create.input.url, language_hints: ["zh"],
    max_prompt_audio_length: 20, enable_preprocess: false, enable_volume_normalization: "false",
  }});
  assert.match(create.input.prefix, /^[A-Za-z0-9]{1,10}$/);
  assert.match(create.input.url, /^oss:\/\//);
  assert.equal(voice.voiceId, "cosyvoice-v3.5-plus-fixture-1");
  app.audio.updateVoice(voice.id, { notes: "新备注", pinned: true, isDefault: true });
  app.close();
  const next = new Application(root, vault, async () => ({ duration: 12, sampleRate: 24000, channels: 1 }), () => {}, () => {}, fetcher);
  const saved = next.audio.voices()[0];
  assert.equal(saved.notes, "新备注"); assert.equal(saved.pinned, true); assert.equal(saved.isDefault, true);
  next.close();
});

test("v109: invalid reference duration, format and size stop before enrollment", async () => {
  const tooLong = harness({ duration: 25 });
  await assert.rejects(cloneVoice(tooLong.app, tooLong.account.id, tooLong.source), /参考音频超过当前上限[\s\S]*25\.0 秒[\s\S]*20\.0 秒/);
  assert.equal(tooLong.calls.length, 0); tooLong.app.close();

  const invalid = harness();
  const textPath = join(invalid.root, "reference.txt"); writeFileSync(textPath, "not audio");
  await assert.rejects(invalid.app.assets.import(textPath, false), /不支持此格式/);
  invalid.app.close();

  const large = harness();
  const largePath = join(large.root, "large.wav"); writeFileSync(largePath, Buffer.alloc(10 * 1024 * 1024 + 1));
  const largeAsset = (await large.app.assets.import(largePath, false)).asset;
  await assert.rejects(large.app.audio.clone({ accountId: large.account.id, assetId: largeAsset.id, name: "过大" }), /参考音频文件过大/);
  large.app.close();
});

test("v109: instruction counting, 20 presets, CRUD, favorite and ordering persist", async () => {
  const { app, root, fetcher } = harness();
  assert.equal(BUILTIN_PRESETS.length, 20);
  assert.equal(app.audio.presets().length, 20);
  assert(BUILTIN_PRESETS.every(([, text]) => instructionLength(text) <= 100));
  assert.equal(instructionLength("中文A!"), 6);
  const custom = app.audio.savePreset({ name: "自定义", content: "真实自然", notes: "测试", favorite: true });
  app.audio.savePreset({ ...custom, name: "重命名" });
  const ids = app.audio.presets().map((item) => item.id);
  app.audio.reorderPresets([custom.id, ...ids.filter((id) => id !== custom.id)]);
  assert.equal(app.audio.presets()[0].name, "重命名");
  app.close();
  const next = new Application(root, vault, async () => ({ duration: 12, sampleRate: 24000, channels: 1 }), () => {}, () => {}, fetcher);
  assert.equal(next.audio.presets()[0].id, custom.id);
  next.audio.deletePreset(custom.id); assert.equal(next.audio.presets().length, 20);
  next.close();
});

test("v109: 1-10 config batch is sequential, saves exact parameters, isolates failure and retries only failed", async () => {
  const { app, account, source, calls } = harness({ failSeed: 2 });
  const voice = await cloneVoice(app, account.id, source);
  const batch = await app.audio.createBatch({ name: "批量测试", text: "这是共享台词。", accountId: account.id, voiceId: voice.id, configs: [config("A", 1), config("B", 2), config("C", 3)], requestId: "batch-once" });
  assert.equal((await app.audio.createBatch({ name: "重复", text: "不会重复扣费", accountId: account.id, voiceId: voice.id, configs: [config("X")], requestId: "batch-once" })).id, batch.id);
  app.audio.stopped = false;
  for (const job of batch.jobs) await app.audio.execute(app.tasks.get(job.taskId));
  app.audio.stopped = true;
  const finished = app.audio.batch(batch.id);
  assert.deepEqual(finished.jobs.map((item) => item.status), ["completed", "failed", "completed"]);
  assert(finished.jobs[0].outputPath && existsSync(finished.jobs[0].outputPath));
  assert.equal(finished.jobs[0].duration, 12);
  const sent = calls.find((item) => item.body.input?.seed === 1)!.body;
  assert.deepEqual(sent, { model: COSYVOICE_MODEL_ID, input: { text: "这是共享台词。", voice: voice.voiceId, instruction: "自然聊天", rate: 1, pitch: 1, volume: 50, seed: 1, format: "wav", sample_rate: 24000 } });
  assert.equal(app.audio.history().length, 1);
  app.audio.retryFailed(batch.id);
  assert.deepEqual(app.audio.batch(batch.id).jobs.map((item) => item.status), ["completed", "pending", "completed"]);
  app.close();
});

test("v109: empty text, weighted instruction, parameter ranges and 10-config limit reject locally", async () => {
  const { app, account, source, calls } = harness();
  const voice = await cloneVoice(app, account.id, source);
  const base = { name: "校验", accountId: account.id, voiceId: voice.id, requestId: "validate", text: "台词" };
  await assert.rejects(app.audio.createBatch({ ...base, text: "", configs: [config("A")] }), /台词为空/);
  await assert.rejects(app.audio.createBatch({ ...base, requestId: "long", configs: [config("A", 1, "字".repeat(51))] }), /102 \/ 100/);
  await assert.rejects(app.audio.createBatch({ ...base, requestId: "rate", configs: [{ ...config("A"), rate: 2.1 }] }), /rate=2\.1/);
  await assert.rejects(app.audio.createBatch({ ...base, requestId: "many", configs: Array.from({ length: 11 }, (_, i) => config(String(i), i)) }), /最多支持 10 套/);
  assert.equal(calls.filter((item) => !item.body.input?.action).length, 0);
  app.close();
});

test("v109: completed result prepares linked second clone without overwriting original", async () => {
  const { app, account, source } = harness();
  const original = await cloneVoice(app, account.id, source);
  const batch = await app.audio.createBatch({ name: "二次复刻", text: "满意的成品。", accountId: account.id, voiceId: original.id, configs: [config("A")], requestId: "reclone-source" });
  app.audio.stopped = false; await app.audio.execute(app.tasks.get(batch.jobs[0].taskId)); app.audio.stopped = true;
  const draft = app.audio.prepareReclone(batch.jobs[0].taskId);
  assert.equal(draft.sourceVoiceId, original.id); assert.equal(draft.sourceTaskId, batch.jobs[0].taskId); assert(draft.assetId);
  const second = await app.audio.clone({ accountId: account.id, assetId: draft.assetId, name: draft.name, notes: draft.notes, sourceVoiceId: draft.sourceVoiceId, sourceTaskId: draft.sourceTaskId, sourceConfigId: draft.sourceConfigId, sourceAudioPath: draft.sourceAudioPath });
  assert.notEqual(second.voiceId, original.voiceId); assert.equal(second.sourceVoiceId, original.id); assert.equal(app.audio.voices().length, 2);
  app.close();
});
