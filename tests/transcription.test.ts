import test, { mock } from "node:test";
import fsPromises from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TranscriptionService } from "../src/main/services/transcription.ts";
import {
  buildWanFriendlySegments,
  formatTimestamp,
  type TranscriptionProgress,
} from "../src/shared/transcription.ts";
import type { Settings } from "../src/shared/types.ts";

const fixture = process.env.TRANSCRIPTION_FIXTURES;
const runtime = process.env.AIVIDEO_SHERPA_ONNX_PATH;
const hasRealASR = Boolean(fixture && runtime);
const base = process.env.TRANSCRIPTION_TEST_OUTPUT
  ? resolve(process.env.TRANSCRIPTION_TEST_OUTPUT)
  : mkdtempSync(join(tmpdir(), "transcription-qa-"));
console.log("Evidence directory:", base);
const program = process.cwd();
const settings = () =>
  ({ ffmpegPath: process.env.AIVIDEO_FFMPEG_PATH || "ffmpeg" }) as Settings;
const reports: unknown[] = [];
function ffmpeg(args: string[]) {
  execFileSync(
    settings().ffmpegPath!,
    ["-nostdin", "-y", "-v", "error", ...args],
    { stdio: "pipe" },
  );
}
function record(name: string, state: TranscriptionProgress) {
  reports.push({
    name,
    stage: state.stage,
    detail: state.detail,
    source: state.source,
    result: state.result,
  });
  writeFileSync(join(base, "evidence.json"), JSON.stringify(reports, null, 2));
}
async function run(service: TranscriptionService, file: string, name: string) {
  const stages: string[] = [];
  service.start(file);
  const timer = setInterval(() => stages.push(service.progress().stage), 2);
  try {
    const state = await service.wait();
    record(name, state);
    return state;
  } finally {
    clearInterval(timer);
    writeFileSync(
      join(base, name + "-stages.json"),
      JSON.stringify([...new Set(stages)]),
    );
  }
}

test("timestamp format and whole-word segmentation", () => {
  assert.equal(formatTimestamp(820), "00:00.820");
  assert.equal(formatTimestamp(3_600_820), "60:00.820");
  const parts = ["我", "们", "讨", "论", "体", "重", "管", "理", "。"];
  const segments = buildWanFriendlySegments(
    parts.map((text, i) => ({ text, startMs: i * 700, endMs: (i + 1) * 700 })),
  );
  assert.equal(segments.map((s) => s.text).join(""), parts.join(""));
  assert(!segments.some((s) => s.text.endsWith("管")), "must not split 管理");
  for (let i = 1; i < segments.length; i++)
    assert(segments[i].startMs >= segments[i - 1].endMs);
});

test(
  "real SenseVoice: imports, files, timeline, errors, cancellation and consecutive jobs",
  { skip: !hasRealASR, timeout: 180_000 },
  async (t) => {
    mkdirSync(base, { recursive: true });
    const sourceDir = join(base, "原始音视频 空格");
    mkdirSync(sourceDir, { recursive: true });
    const wav = join(sourceDir, "中文口播.wav"),
      mp3 = join(sourceDir, "中文口播.mp3"),
      mp4 = join(sourceDir, "延迟音轨 中文.mp4"),
      silent = join(sourceDir, "无音轨.mp4");
    copyFileSync(join(fixture!, "zh.wav"), wav);
    ffmpeg(["-i", wav, mp3]);
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:r=10:d=8",
      "-itsoffset",
      "1.25",
      "-i",
      wav,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      mp4,
    ]);
    ffmpeg(["-f", "lavfi", "-i", "color=s=160x90:r=10:d=1", "-an", silent]);
    const root = join(base, "用户数据 中文 空格");
    const service = new TranscriptionService(root, program, settings);
    await t.test("T1 WAV/MP3 metadata and T2 MP4 metadata", async () => {
      for (const [file, kind] of [
        [wav, "audio"],
        [mp3, "audio"],
        [mp4, "video"],
      ]) {
        const info = await service.inspect(file);
        assert.equal(info.kind, kind);
        assert(info.size > 1000);
        assert(info.duration! > 5);
        assert(info.duration! < 9);
      }
    });
    await t.test(
      "T3 missing and incomplete model; no fake output",
      async () => {
        let state = await run(service, wav, "missing-model");
        assert.equal(state.stage, "failed");
        assert.match(state.detail!, /本地识别模型未安装/);
        const dir = service.modelDir();
        writeFileSync(join(dir, "model.int8.onnx"), "incomplete");
        writeFileSync(join(dir, "tokens.txt"), "bad");
        state = await run(service, wav, "incomplete-model");
        assert.equal(state.stage, "failed");
        assert.match(state.detail!, /不完整|版本不匹配/);
        assert.deepEqual(readdirSync(service.outputDir()), []);
        for (const name of ["model.int8.onnx", "tokens.txt"])
          copyFileSync(join(fixture!, name), join(dir, name));
      },
    );
    let first: TranscriptionProgress;
    await t.test(
      "T4/T5/T6/T9 real Chinese inference, two TXT, real token timestamps, Chinese paths",
      async () => {
        first = await run(service, wav, "real-wav");
        assert.equal(first.stage, "completed", first.detail);
        const result = first.result!;
        assert(result.fullText.includes("早上"));
        assert(result.fullText.includes("下午"));
        assert.deepEqual(readdirSync(result.outputDir).sort(), [
          "01_完整逐字稿.txt",
          "02_时间帧逐字稿.txt",
        ]);
        assert.equal(
          readFileSync(result.fullTextPath).subarray(0, 3).toString("hex"),
          "efbbbf",
        );
        const internal = JSON.parse(
          readFileSync(
            join(root, "data", "transcription", result.taskId + ".json"),
            "utf8",
          ),
        );
        assert(internal.rawResults[0].result.timestamps.length > 5);
        assert.equal(
          result.segments[0].startMs,
          Math.round(internal.rawResults[0].result.timestamps[0] * 1000),
        );
        assert(result.segments[0].startMs > 400, "leading silence preserved");
        for (let i = 1; i < result.segments.length; i++)
          assert(result.segments[i].startMs >= result.segments[i - 1].endMs);
        assert.match(
          result.timelineText,
          /\[\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}\.\d{3}\]/,
        );
        assert.equal(
          service.resultPath(result.taskId, "full"),
          result.fullTextPath,
        );
        assert.throws(() => service.resultPath("../escape", "full"));
        assert.deepEqual(readdirSync(join(root, "cache", "transcription")), []);
      },
    );
    await t.test(
      "T8 consecutive MP3 and T2 delayed MP4 retains original video timeline",
      async () => {
        const next = await run(service, mp3, "real-mp3");
        assert.equal(next.stage, "completed", next.detail);
        const delayed = await run(service, mp4, "real-mp4");
        assert.equal(delayed.stage, "completed", delayed.detail);
        const delta =
          delayed.result!.segments[0].startMs -
          first.result!.segments[0].startMs;
        assert(
          delta > 1050 && delta < 1450,
          `audio offset should remain 1.25s, got ${delta}ms`,
        );
      },
    );
    await t.test("unsupported, corrupt and no-audio sources", async () => {
      await assert.rejects(
        () => service.inspect(join(sourceDir, "bad.exe")),
        /不支持/,
      );
      await assert.rejects(() => service.inspect(silent), /音轨/);
      const broken = join(sourceDir, "损坏.wav");
      writeFileSync(broken, "not an audio file");
      await assert.rejects(() => service.inspect(broken), /损坏|读取/);
    });
    const long = join(sourceDir, "长口播.wav");
    ffmpeg(["-stream_loop", "7", "-i", wav, "-c:a", "pcm_s16le", long]);
    await t.test(
      "T7 kill actual ASR child, reject duplicates, then restart",
      async () => {
        service.start(long);
        assert.throws(() => service.start(wav), /正在执行/);
        let pid: number | undefined;
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const child = (service as any).active?.child;
          if (child?.spawnfile === runtime) {
            pid = child.pid;
            break;
          }
          if (!service.progress().busy) break;
          await new Promise((r) => setTimeout(r, 2));
        }
        assert(pid, "must cancel a real running sherpa child");
        const cancelled = await service.cancel();
        record("cancelled", cancelled);
        assert.equal(cancelled.stage, "cancelled");
        assert.equal(cancelled.busy, false);
        assert.throws(() => process.kill(pid!, 0), /ESRCH/);
        assert.deepEqual(readdirSync(join(root, "cache", "transcription")), []);
        const restarted = await run(service, wav, "restart-after-cancel");
        assert.equal(restarted.stage, "completed", restarted.detail);
      },
    );
    await t.test(
      "multi-chunk genuine inference retains offset, no overlap or lost chunks",
      async () => {
        const state = await run(service, long, "real-long");
        assert.equal(state.stage, "completed", state.detail);
        const result = state.result!;
        const internal = JSON.parse(
          readFileSync(
            join(root, "data", "transcription", result.taskId + ".json"),
            "utf8",
          ),
        );
        assert(internal.rawResults.length >= 2);
        assert(result.segments.at(-1)!.endMs > 40_000);
        assert.equal((result.fullText.match(/时间/g) || []).length, 8);
        assert.equal(
          result.segments.map((s) => s.text).join(""),
          internal.tokens.map((token: any) => token.text).join(""),
        );
        for (let i = 1; i < result.segments.length; i++)
          assert(result.segments[i].startMs >= result.segments[i - 1].endMs);
      },
    );
    await t.test(
      "missing FFmpeg and missing / unlaunchable runtime",
      async () => {
        const badFfmpeg = new TranscriptionService(
          root,
          program,
          () => ({ ffmpegPath: join(base, "missing-ffmpeg") }) as Settings,
        );
        let state = await run(badFfmpeg, wav, "missing-ffmpeg");
        assert.equal(state.stage, "failed");
        assert.match(state.detail!, /FFmpeg/);
        const original = process.env.AIVIDEO_SHERPA_ONNX_PATH;
        try {
          process.env.AIVIDEO_SHERPA_ONNX_PATH = join(base, "missing-runtime");
          state = await run(service, wav, "missing-runtime");
          assert.equal(state.stage, "failed");
          assert.match(state.detail!, /引擎缺失/);
          // An existing file that cannot perform inference; never a fake successful ASR.
          const invalid = join(base, "invalid-runtime");
          writeFileSync(invalid, "invalid executable", { mode: 0o755 });
          process.env.AIVIDEO_SHERPA_ONNX_PATH = invalid;
          state = await run(service, wav, "unlaunchable-runtime");
          assert.equal(state.stage, "failed");
          assert.match(state.detail!, /本地识别失败/);
        } finally {
          process.env.AIVIDEO_SHERPA_ONNX_PATH = original;
        }
      },
    );
    await t.test(
      "output write / disk-full failure is explicit and leaves no partial result",
      async () => {
        const before = readdirSync(service.outputDir()).sort();
        const original = fsPromises.writeFile;
        const injected = mock.method(
          fsPromises,
          "writeFile",
          async (...args: any[]) => {
            if (String(args[0]).endsWith("02_时间帧逐字稿.txt"))
              throw Object.assign(new Error("fault injection: disk full"), {
                code: "ENOSPC",
              });
            return (original as any)(...args);
          },
        );
        let state: TranscriptionProgress;
        try {
          state = await run(service, wav, "disk-full-injected");
        } finally {
          injected.mock.restore();
        }
        assert.equal(state!.stage, "failed");
        assert.match(state!.detail!, /磁盘空间不足/);
        assert.deepEqual(readdirSync(service.outputDir()).sort(), before);
        assert.deepEqual(readdirSync(join(root, "cache", "transcription")), []);
      },
    );
    await t.test(
      "silent audio returns clear error, cleans temporary data",
      async () => {
        const silence = join(sourceDir, "静音.wav");
        ffmpeg([
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=16000:cl=mono",
          "-t",
          "3",
          silence,
        ]);
        const state = await run(service, silence, "silent");
        assert.equal(state.stage, "failed");
        assert.match(state.detail!, /没有识别到/);
        assert.deepEqual(readdirSync(join(root, "cache", "transcription")), []);
      },
    );
  },
);
