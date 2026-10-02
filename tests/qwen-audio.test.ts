import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/main/services/application.ts";
import { generateQwenAudio, QWEN_AUDIO_MODEL } from "../src/main/services/qwenAudio.ts";

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
