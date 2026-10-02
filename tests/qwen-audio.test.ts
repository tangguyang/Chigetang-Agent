import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Application } from "../src/main/services/application.ts";
import { cloneQwenAudio, generateQwenAudio, QWEN_AUDIO_MODEL, type QwenAudioInput } from "../src/main/services/qwenAudio.ts";
import { CapabilityRegistry } from "../src/main/capabilities/registry.ts";
import { registerApplicationCapabilities } from "../src/main/capabilities/catalog.ts";

test("Qwen-Audio: secure service preserves inputs, rejects unsafe paths, never retries paid POST", async () => {
  const root = mkdtempSync(join(tmpdir(), "ctg-qwen-test-"));
  process.env.AIVIDEO_TEST_ROOT = root;
  const wav = readFileSync("tests/fixtures/sample.wav");
  let posts = 0;
  let fail = false;
  const input = { model: QWEN_AUDIO_MODEL, voice: "qwen-fixture", text: "原始完整文本。", instruction: "完整指令。", outputPath: "outputs/audio/test.wav" };
  const app = new Application(root, {
    isEncryptionAvailable: () => true,
    encryptString: s => Buffer.from(s),
    decryptString: b => b.toString(),
  }, async () => ({ duration: 1, sampleRate: 24000, channels: 1 }), () => {}, () => {}, async (_url, init) => {
    if (init?.method === "POST") {
      posts++;
      assert.equal(init.headers && (init.headers as Record<string, string>).Authorization, "Bearer fake-test-key");
      assert.deepEqual(JSON.parse(String(init.body)), { model: input.model, input: { voice: input.voice, text: input.text, instruction: input.instruction, format: "wav", sample_rate: 24000 } });
      if (fail) return Response.json({ code: "Denied", message: "fake refusal" }, { status: 500 });
      return Response.json({ request_id: "fixture-request", output: { audio: { url: "https://example.com/result.wav" } } });
    }
    return new Response(wav);
  });
  try {
    app.credentials.save({ name: "fake", providerId: "alibaba", workspaceId: "ws-test", region: "cn-beijing", key: "fake-test-key", enabled: true });
    await assert.rejects(generateQwenAudio(app, { ...input, outputPath: "../escape.wav" }), /outputs\/audio/);
    await assert.rejects(generateQwenAudio(app, { ...input, voice: "cosyvoice-test" }), /CosyVoice/);
    assert.equal(posts, 0);
    const result = await generateQwenAudio(app, input);
    assert.equal(result.outputPath, join(root, "outputs", "audio", "test.wav"));
    assert.deepEqual(readFileSync(result.outputPath), wav);
    assert.equal(JSON.stringify(result).includes("fake-test-key"), false);
    await assert.rejects(generateQwenAudio(app, input), /禁止覆盖/);
    assert.equal(posts, 1);
    fail = true;
    await assert.rejects(generateQwenAudio(app, { ...input, outputPath: "outputs/audio/fail.wav" }));
    assert.equal(posts, 2);
  } finally {
    app.audio.stop();
    app.db.close();
  }
});

test("Qwen native controls: service and capability preserve optional fields and reject invalid values before POST", async () => {
  const root = mkdtempSync(join(tmpdir(), "ctg-qwen-controls-"));
  process.env.AIVIDEO_TEST_ROOT = root;
  const wav = readFileSync("tests/fixtures/sample.wav");
  const bodies: unknown[] = [];
  let expectedControls: Record<string, number> = {};
  let expectedVoice = "qwen-fixture";
  const base: QwenAudioInput = { model: QWEN_AUDIO_MODEL, voice: "qwen-fixture", text: "原始完整文本。", instruction: "完整指令。", outputPath: "outputs/audio/legacy.wav" };
  const app = new Application(root, {
    isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString(),
  }, async () => ({ duration: 1, sampleRate: 24000, channels: 1 }), () => {}, () => {}, async (_url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      assert.deepEqual(body, { model: base.model, input: { voice: expectedVoice, text: base.text, instruction: base.instruction, format: "wav", sample_rate: 24000, ...expectedControls } });
      return Response.json({ output: { audio: { url: "https://example.com/result.wav" } } });
    }
    return new Response(wav);
  });
  const registry = new CapabilityRegistry();
  registerApplicationCapabilities(registry, (id, p) => {
    assert.equal(id, "audio.qwen.generate");
    return generateQwenAudio(app, p as QwenAudioInput);
  });
  const execute = (params: Record<string, unknown>) => registry.executeCapability({ capability: "audio.qwen.generate", params, confirm: true });
  try {
    const account = app.credentials.save({ name: "fake", providerId: "alibaba", workspaceId: "ws-test", region: "cn-beijing", key: "fake-test-key", enabled: true });
    assert.equal((await execute(base)).status, "succeeded");
    expectedControls = { rate: 1, pitch: 0.85, volume: 50, seed: 12345 };
    assert.equal((await execute({ ...base, ...expectedControls, outputPath: "outputs/audio/native.wav" })).status, "succeeded");
    expectedControls = { volume: 0, seed: 0 };
    assert.equal((await execute({ ...base, ...expectedControls, outputPath: "outputs/audio/zeros.wav" })).status, "succeeded");
    const invalid: [string, unknown][] = [
      ["rate", 0.49], ["rate", 2.01], ["pitch", 0.49], ["pitch", 2.01],
      ["volume", -1], ["volume", 101], ["volume", 50.5],
      ["seed", -1], ["seed", 65536], ["seed", 1.5],
      ["rate", NaN], ["pitch", Infinity], ["volume", "50"], ["seed", null],
    ];
    for (const [key, value] of invalid) {
      const params = { ...base, outputPath: "outputs/audio/invalid.wav", [key]: value };
      const count = bodies.length;
      await assert.rejects(generateQwenAudio(app, params as QwenAudioInput), /Qwen 参数/);
      assert.equal((await execute(params)).status, "failed");
      assert.equal(bodies.length, count, `${key}=${String(value)} must not POST`);
    }
    for (const key of ["speech_rate", "pitch_rate", "parameters"]) {
      const count = bodies.length;
      assert.equal((await execute({ ...base, [key]: 1 })).status, "failed");
      assert.equal(bodies.length, count);
    }
    const source = resolve("tests/fixtures/sample.wav");
    const asset = (await app.assets.import(source, false)).asset;
    const voice = { id: "qwen-named-fixture", name: "测试Qwen名称", providerId: "alibaba", region: "cn-beijing", model: QWEN_AUDIO_MODEL, accountId: account.id, voiceId: "qwen-resolved-id", kind: "clone", createdAt: new Date().toISOString(), referenceAssetId: asset.id, referencePath: source, notes: "", status: "ready" };
    app.db.run("INSERT INTO cosy_voices VALUES(?,?,?,?,?,?,?)", voice.id, voice.accountId, voice.model, 0, null, 0, JSON.stringify(voice));
    expectedControls = {};
    expectedVoice = voice.voiceId;
    for (const value of [voice.name, voice.id])
      assert.equal((await execute({ ...base, voice: value, outputPath: `outputs/audio/resolved-${value === voice.id ? "id" : "name"}.wav` })).status, "succeeded");
    expectedControls = { rate: 0.5, pitch: 2, volume: 100, seed: 65535 };
    assert.equal((await execute({ ...base, voice: voice.id, ...expectedControls, outputPath: "outputs/audio/bounds.wav" })).status, "succeeded");
  } finally { app.close(); }
});

test("Qwen clone reuses OSS resolver and persists actual model-specific voice", async () => {
  const root = mkdtempSync(join(tmpdir(), "ctg-qwen-clone-test-"));
  process.env.AIVIDEO_TEST_ROOT = root;
  let clones = 0;
  const app = new Application(root, {
    isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString(),
  }, async () => ({ duration: 10, sampleRate: 24000, channels: 1 }), () => {}, () => {}, async (url, init) => {
    if (String(url).includes("getPolicy")) {
      assert.match(String(url), /model=qwen-audio-3.0-tts-plus/);
      return Response.json({ data: { upload_host: "https://fixture.oss-cn-beijing.aliyuncs.com", max_file_size_mb: 10, upload_dir: "fixture", oss_access_key_id: "fake", policy: "fake", signature: "fake", x_oss_object_acl: "private", x_oss_forbid_overwrite: "true" } });
    }
    if (init?.body instanceof FormData) return new Response("", { status: 200 });
    clones++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "voice-enrollment");
    assert.equal(body.input.target_model, QWEN_AUDIO_MODEL);
    assert.equal(body.input.action, "create_voice");
    assert.equal(body.input.prefix, "chigetang_qwen_test");
    assert.deepEqual(body.input.language_hints, ["zh"]);
    assert.match(body.input.url, /^oss:\/\//);
    assert.equal((init?.headers as Record<string, string>)["X-DashScope-OssResourceResolve"], "enable");
    return Response.json({ request_id: "clone-fixture", output: { voice_id: "qwen-actual-fixture" } });
  });
  try {
    app.credentials.save({ name: "fake", providerId: "alibaba", workspaceId: "ws-test", region: "cn-beijing", key: "fake-test-key", enabled: true });
    const input = { referencePath: resolve("tests/fixtures/sample.wav"), name: "测试Qwen", prefix: "chigetang_qwen_test", language: "zh" };
    const result = await cloneQwenAudio(app, input);
    assert.equal(result.voiceId, "qwen-actual-fixture");
    const saved = app.audio.voices().find(v => v.name === input.name)!;
    assert.equal(saved.model, QWEN_AUDIO_MODEL);
    assert.equal(saved.sourceAudioPath, input.referencePath);
    assert.equal(saved.voiceId, result.voiceId);
    await assert.rejects(cloneQwenAudio(app, input), /重复复刻/);
    assert.equal(clones, 1);
  } finally { app.close(); }
});

