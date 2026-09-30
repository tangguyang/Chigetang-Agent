import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealSpeechService } from "../src/main/realSpeech/service.ts";
import type { Application } from "../src/main/services/application.ts";
import type { Obj } from "../src/features/realSpeech/domain.ts";
const base = mkdtempSync(join(tmpdir(), "真人口播媒体-")),
  tone = join(base, "测试音.wav");
execFileSync("ffmpeg", [
  "-nostdin",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=400:sample_rate=48000",
  "-t",
  "10",
  "-c:a",
  "pcm_s16le",
  tone,
]);
const bytes = readFileSync(tone);
let paid = 0,
  download = 0,
  failDownload = false;
const app = {
  audio: {
    voices: () => [
      {
        id: "V1",
        voiceId: "remote-voice",
        accountId: "ACC",
        providerId: "alibaba",
        region: "cn-beijing",
        model: "cosyvoice-v3.5-plus",
        name: "模拟音色",
        status: "ready",
      },
    ],
  },
  models: () => [
    {
      id: "cosyvoice-v3.5-plus",
      officialId: "cosyvoice-v3.5-plus",
      enabled: true,
      providerId: "alibaba",
      audio: {
        endpoints: {
          "cn-beijing": {
            tts: "https://{workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
          },
        },
      },
    },
  ],
  credentials: {
    list: () => [
      {
        id: "ACC",
        enabled: true,
        providerId: "alibaba",
        region: "cn-beijing",
        workspaceId: "workspace123",
      },
    ],
    getKey: () => "fake-test-key",
  },
  settings: () => ({}),
  fetcher: async (url: unknown, options?: RequestInit) => {
    if (options?.method === "POST") {
      paid++;
      const body = JSON.parse(String(options.body));
      assert.equal(body.input.sample_rate, 48000);
      assert.equal(body.input.voice, "remote-voice");
      return Response.json({
        request_id: "mock-" + paid,
        output: { audio: { url: "https://test-result.example/audio.wav" } },
        usage: { characters: body.input.text.length },
      });
    }
    download++;
    if (failDownload) throw Error("download offline");
    return new Response(bytes);
  },
} as unknown as Application;
test("完整HTTP适配器模拟→下载→真实ffprobe/FFmpeg→48kWAV→拼接→Golden门禁", async () => {
  const s = new RealSpeechService(base, app);
  let t = s.newTask({ originalText: "第一句。第二句。", voiceRef: "V1" });
  t = await s.generate({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    rehearsal: true,
  });
  assert.equal(t.rehearsal.results[0].sampleRate, 48000);
  assert.equal(t.rehearsal.results[0].duration, 10);
  t = s.feedback({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "rehearsal",
    data: true,
  });
  t = await s.generate({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    windowId: "GW001",
  });
  const path = t.windows[0].results[0].path;
  const snapshot = JSON.parse(
    readFileSync(
      join(path.substring(0, path.lastIndexOf("/")), "request.json"),
      "utf8",
    ),
  );
  assert.equal(snapshot.remoteVoice, "remote-voice");
  assert.ok(!JSON.stringify(snapshot).includes("fake-test-key"));
  t = s.feedback({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "confirm",
    windowId: "GW001",
  });
  t = await s.concat({ taskId: t.taskId, taskRevision: t.taskRevision });
  assert.equal(t.final.sampleRate, 48000);
  assert.equal(t.final.codec, "pcm_s16le");
  assert.equal(s.output(t.taskId, t.final.id), t.final.path);
  assert.throws(() =>
    s.feedback({
      taskId: t.taskId,
      taskRevision: t.taskRevision,
      type: "golden",
    }),
  );
  t = s.feedback({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "qc",
    data: {
      answers: Array(10).fill("基本符合"),
      problem: "无明显问题",
      description: "测试问卷，仅模拟",
      pronunciationOk: true,
      seamsOk: true,
      caseName: "通用",
    },
  });
  t = s.feedback({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    type: "golden",
  });
  assert.ok(t.golden);
  const oldFinal = readFileSync(t.final.path);
  t.windows[0].results.at(-1).path = join(base, "missing.wav");
  s.save(t);
  await assert.rejects(
    s.concat({ taskId: t.taskId, taskRevision: t.taskRevision }),
  );
  assert.deepEqual(readFileSync(t.final.path), oldFinal);
  assert.equal(paid, 2);
  s.close();
});
test("云端成功下载失败保存remote证据，恢复仅GET不再付费", async () => {
  const s = new RealSpeechService(
    mkdtempSync(join(tmpdir(), "恢复下载-")),
    app,
  );
  let t = s.newTask({ originalText: "恢复测试。", voiceRef: "V1" });
  failDownload = true;
  const before = paid;
  await assert.rejects(
    s.generate({
      taskId: t.taskId,
      taskRevision: t.taskRevision,
      rehearsal: true,
    }),
  );
  t = s.get(t.taskId);
  assert.equal(t.rehearsal.status, "unknown_result");
  failDownload = false;
  t = await s.recover({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    windowId: "REHEARSAL",
  });
  assert.equal(t.rehearsal.status, "generated");
  assert.equal(paid, before + 1);
  assert.ok(download >= 2);
  s.close();
});
test("两个窗口实际拼接增加指定停顿，重拼接不调用TTS", async () => {
  const s = new RealSpeechService(
    mkdtempSync(join(tmpdir(), "两段拼接-")),
    app,
  );
  let t = s.newTask({ originalText: "第一句。第二句。", voiceRef: "V1" });
  t.windows = [s.window("GW001", ["U001"]), s.window("GW002", ["U002"])];
  t.rehearsalPassed = true;
  s.save(t);
  for (const id of ["GW001", "GW002"])
    t = await s.generate({
      taskId: t.taskId,
      taskRevision: t.taskRevision,
      windowId: id,
    });
  t = s.update({
    taskId: t.taskId,
    taskRevision: t.taskRevision,
    window: { windowId: "GW001", transitionPauseMs: 200 },
  }); // pause-only update must retain generated state
  const before = paid;
  t = await s.concat({ taskId: t.taskId, taskRevision: t.taskRevision });
  assert.equal(t.final.duration, 20.2);
  assert.equal(paid, before);
  s.close();
});
