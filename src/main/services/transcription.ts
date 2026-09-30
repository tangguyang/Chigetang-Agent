import { spawn, type ChildProcess } from "node:child_process";
import { cpus } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import {
  appendFile,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, parse, relative } from "node:path";
import type { Settings } from "../../shared/types.ts";
import {
  TRANSCRIPTION_AUDIO_EXTENSIONS,
  TRANSCRIPTION_VIDEO_EXTENSIONS,
  buildWanFriendlySegments,
  formatReadableTranscript,
  formatTimelineTranscript,
  joinTranscriptionTokens,
  type TranscriptionResult,
  type TranscriptionSource,
  type TranscriptionStatus,
  type TranscriptionToken,
  type TranscriptionProgress,
} from "../../shared/transcription.ts";
import { probeMedia } from "./media.ts";
import { ffmpegBinary, hasFFmpeg } from "./transcode.ts";

const MODEL_FILES = ["model.int8.onnx", "tokens.txt"];
interface SherpaResult {
  text?: string;
  tokens?: string[];
  timestamps?: number[];
  durations?: number[];
  lang?: string;
}
interface Silence {
  start: number;
  end: number;
}
function parseSherpaJson(stdout: string): SherpaResult {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      return JSON.parse(line) as SherpaResult;
    } catch {
      /* Other CLI output. */
    }
  }
  throw new Error("本地识别引擎没有返回可读取的结果，请检查模型和运行时版本。");
}
function safeName(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .trim()
      .replace(/[. ]+$/, "") || "转写任务"
  ).slice(0, 45);
}
function taskStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export class TranscriptionService {
  private active?: {
    cancelled: boolean;
    child?: ChildProcess;
    done: Promise<void>;
  };
  private state: TranscriptionProgress = { stage: "idle", busy: false };
  constructor(
    private root: string,
    private programPath: string,
    private settings: () => Settings,
  ) {}
  outputDir() {
    const path = join(this.root, "outputs", "transcription");
    mkdirSync(path, { recursive: true });
    return path;
  }
  modelDir() {
    const path = join(this.root, "models", "sensevoice");
    mkdirSync(path, { recursive: true });
    return path;
  }
  runtimePath() {
    return (
      process.env.AIVIDEO_SHERPA_ONNX_PATH ||
      join(
        this.programPath,
        "resources",
        "sherpa-onnx",
        process.platform === "win32"
          ? "sherpa-onnx-offline.exe"
          : "sherpa-onnx-offline",
      )
    );
  }
  async status(): Promise<TranscriptionStatus> {
    const modelDir = this.modelDir();
    const missingModelFiles = MODEL_FILES.filter((name) => {
      try {
        const s = statSync(join(modelDir, name));
        return !s.isFile() || s.size === 0;
      } catch {
        return true;
      }
    });
    return {
      outputDir: this.outputDir(),
      modelDir,
      modelReady: missingModelFiles.length === 0,
      runtimeReady: existsSync(this.runtimePath()),
      ffmpegReady: await hasFFmpeg(this.settings().ffmpegPath),
      missingModelFiles,
      engine: "sherpa-onnx",
      model: "SenseVoice Small INT8",
    };
  }
  async inspect(path: string): Promise<TranscriptionSource> {
    const extension = extname(path).toLowerCase();
    const kind = (TRANSCRIPTION_AUDIO_EXTENSIONS as readonly string[]).includes(
      extension,
    )
      ? "audio"
      : (TRANSCRIPTION_VIDEO_EXTENSIONS as readonly string[]).includes(
            extension,
          )
        ? "video"
        : undefined;
    if (!kind)
      throw new Error(
        "暂不支持这个文件格式。请选择 MP4/MOV/MKV/AVI 或 MP3/WAV/M4A/AAC。",
      );
    const file = await stat(path).catch(() => null);
    if (!file?.isFile() || !file.size)
      throw new Error("文件不存在、为空或已被移动，请重新选择。");
    const media = await probeMedia(
      path,
      join(this.programPath, "resources", "MediaInfoModule.wasm"),
    ).catch(() => {
      throw new Error("无法读取文件，请确认文件完整且能正常播放。");
    });
    if (!media.duration || !media.sampleRate)
      throw new Error("文件损坏或没有可用音轨，请选择带有人声的音视频。");
    // Bound temporary PCM disk usage and pathological container durations.
    if (media.duration > 4 * 3600)
      throw new Error("单个文件最长支持 4 小时，请先分成较短的文件再转写。");
    return {
      path,
      name: basename(path),
      size: file.size,
      duration: media.duration,
      kind,
    };
  }
  progress(): TranscriptionProgress {
    return this.state;
  }
  private update(stage: TranscriptionProgress["stage"], detail?: string) {
    this.state = { ...this.state, stage, detail };
  }
  private checkCancelled() {
    if (this.active?.cancelled) throw new Error("已取消任务");
  }
  start(sourcePath: string) {
    if (this.active)
      throw new Error("已有转文字任务正在执行，请等待完成或先取消。");
    this.state = { stage: "preparing", busy: true };
    const job = { cancelled: false, done: Promise.resolve() };
    this.active = job;
    job.done = this.execute(sourcePath)
      .then((result) => {
        this.state = {
          stage: "completed",
          busy: false,
          source: result.source,
          result,
        };
      })
      .catch(async (error) => {
        await this.log(error);
        const code = (error as NodeJS.ErrnoException).code;
        const detail = job.cancelled
          ? "任务已取消，可以重新开始。"
          : code === "ENOSPC"
            ? "磁盘空间不足，请清理用户数据所在磁盘后重试。"
            : code === "EACCES" || code === "EPERM"
              ? "无法写入文件，请检查目录权限，或关闭正在占用结果的程序。"
              : code === "ENAMETOOLONG"
                ? "文件路径过长，请缩短文件名或用户数据目录路径后重试。"
                : code === "EEXIST" || code === "ENOTDIR"
                  ? "保存目录被同名文件占用，请检查用户数据目录后重试。"
                  : code === "ENOENT"
                    ? "所需文件不存在或已被移动，请重新选择文件并检查完整程序包。"
                    : code === "EROFS"
                      ? "用户数据目录为只读，请选择可以写入的磁盘。"
                      : error instanceof Error
                        ? error.message
                        : "转文字失败，请查看日志或重试。";
        this.state = {
          ...this.state,
          busy: false,
          stage: job.cancelled ? "cancelled" : "failed",
          detail,
        };
      })
      .finally(() => {
        if (this.active === job) this.active = undefined;
      });
    return this.progress();
  }
  async wait() {
    await this.active?.done;
    return this.progress();
  }
  async cancel() {
    const job = this.active;
    if (!job) return this.progress();
    job.cancelled = true;
    // Direct executable, no shell/grandchildren; close is awaited by process().
    job.child?.kill("SIGKILL");
    await job.done;
    return this.progress();
  }
  private async log(error: unknown) {
    const path = join(this.root, "logs");
    try {
      mkdirSync(path, { recursive: true });
      const file = join(path, "transcription.log");
      if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024)
        await rm(file);
      await appendFile(
        file,
        `${new Date().toISOString()} ${error instanceof Error ? error.stack : String(error)}\n`,
      );
    } catch {
      /* Logging must not hide the original failure. */
    }
  }
  private async process(
    binary: string,
    args: string[],
    userError: string,
    timeoutMs = 30 * 60_000,
    cwd?: string,
  ) {
    this.checkCancelled();
    const job = this.active!;
    return new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(binary, args, {
          cwd,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        job.child = child;
        let stdout = "",
          stderr = "",
          launchError: Error | undefined,
          timedOut = false,
          overflow = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (data: string) => {
          stdout += data;
          if (stdout.length > 8 * 1024 * 1024) {
            overflow = true;
            child.kill("SIGKILL");
          }
        });
        child.stderr.on("data", (data: string) => {
          stderr = (stderr + data).slice(-2 * 1024 * 1024);
        });
        child.on("error", (error) => {
          launchError = error;
        });
        child.on("close", async (code, signal) => {
          clearTimeout(timer);
          if (job.child === child) job.child = undefined;
          if (job.cancelled) {
            reject(new Error("已取消任务"));
            return;
          }
          if (code !== 0 || launchError || timedOut || overflow) {
            await this.log(
              new Error(
                `${binary}: code=${code} signal=${signal} timeout=${timedOut}\n${launchError?.stack || ""}\n${stderr}`,
              ),
            );
            reject(
              new Error(
                /No space left|not enough space/i.test(stderr)
                  ? "磁盘空间不足，请清理用户数据所在磁盘后重试。"
                  : timedOut
                    ? "本地处理超时，请缩短文件或关闭其他占用内存的程序后重试。"
                    : userError,
              ),
            );
          } else resolve({ stdout, stderr });
        });
      },
    );
  }
  resultPath(taskId: string, kind: "folder" | "full" | "timeline") {
    // Only the current successful task can be opened; no renderer-supplied paths.
    const result = this.state.result;
    if (!result || result.taskId !== taskId)
      throw new Error("对应的转写结果不存在或已经被移动。");
    const path =
      kind === "folder"
        ? result.outputDir
        : kind === "full"
          ? result.fullTextPath
          : result.timelineTextPath;
    if (!existsSync(path))
      throw new Error("对应的转写结果不存在或已经被移动。");
    return path;
  }
  private async validateModel() {
    const status = await this.status();
    this.checkCancelled();
    if (!status.modelReady)
      throw new Error(
        "本地识别模型未安装。请点击标题右侧 AI 图标打开模型目录，点击文档图标查看下载安装说明。",
      );
    if (!status.runtimeReady)
      throw new Error(
        "本地识别引擎缺失，请使用包含 sherpa-onnx 运行时的完整程序包。",
      );
    if (!status.ffmpegReady)
      throw new Error(
        "FFmpeg 不可用，请恢复软件自带 FFmpeg 或检查设置中的 FFmpeg 路径。",
      );
    const manifest = JSON.parse(
      await readFile(
        join(
          this.programPath,
          "resources",
          "sherpa-onnx",
          "model-checksums.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    for (const name of MODEL_FILES) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(join(status.modelDir, name))) {
        this.checkCancelled();
        hash.update(chunk);
      }
      if (hash.digest("hex") !== manifest[name])
        throw new Error(
          "本地识别模型文件不完整或版本不匹配。请点击文档图标，重新安装指定 INT8 模型的两个文件。",
        );
    }
  }
  private async execute(sourcePath: string): Promise<TranscriptionResult> {
    const started = Date.now();
    const source = await this.inspect(sourcePath);
    this.state = { ...this.state, source };
    this.checkCancelled();
    this.update("checking");
    await this.validateModel();
    this.checkCancelled();
    const taskId = `${safeName(parse(source.name).name)}_${taskStamp()}_${randomUUID().slice(0, 8)}`;
    const outputDir = join(this.outputDir(), taskId);
    const workDir = join(this.root, "cache", "transcription", randomUUID());
    const internalDir = join(this.root, "data", "transcription");
    const internalPath = join(internalDir, taskId + ".json");
    mkdirSync(workDir, { recursive: true });
    const ffmpeg = ffmpegBinary(this.settings().ffmpegPath);
    let committed = false;
    try {
      this.update("extracting");
      const wav = join(workDir, "input.wav");
      // first_pts=0 preserves leading audio delay; async fills timestamp gaps.
      // No silence removal, speed change or time-stretch is applied.
      await this.process(
        ffmpeg,
        [
          "-nostdin",
          "-y",
          "-v",
          "error",
          "-i",
          source.path,
          "-map",
          "0:a:0",
          "-vn",
          "-af",
          "aresample=16000:async=1:first_pts=0",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          wav,
        ],
        "音轨提取失败，请确认文件完整、能正常播放且含有可用音轨。",
      );
      const audio = await probeMedia(
        wav,
        join(this.programPath, "resources", "MediaInfoModule.wasm"),
      );
      const duration = audio.duration;
      if (!duration) throw new Error("没有读取到可用音频，请检查源文件。");
      const detected = await this.process(
        ffmpeg,
        [
          "-nostdin",
          "-hide_banner",
          "-i",
          wav,
          "-af",
          "silencedetect=noise=-40dB:d=0.35",
          "-f",
          "null",
          "-",
        ],
        "音频分析失败，请检查文件或磁盘空间。",
      );
      const silences: Silence[] = [];
      let silenceStart = 0;
      for (const match of detected.stderr.matchAll(
        /silence_(start|end):\s*([\d.]+)/g,
      )) {
        if (match[1] === "start") silenceStart = Number(match[2]);
        else silences.push({ start: silenceStart, end: Number(match[2]) });
      }
      // Split long recordings only inside measured silence, never fixed 3s cuts.
      const cuts = [0];
      for (const silence of silences) {
        let cut = Math.max(
          cuts[cuts.length - 1] + 20,
          silence.start + Math.min(0.15, (silence.end - silence.start) / 2),
        );
        while (cut < silence.end - 0.05 && duration - cut > 1) {
          cuts.push(Math.round(cut * 16000) / 16000);
          cut += 30;
        }
      }
      cuts.push(duration);
      if (cuts.some((cut, i) => i > 0 && cut - cuts[i - 1] > 120))
        throw new Error(
          "文件含有超过 2 分钟没有清晰停顿的连续音频。为避免内存不足和截断原话，请先按完整语句分成较短文件。",
        );
      const tokens: TranscriptionToken[] = [];
      const rawResults: { offset: number; result: SherpaResult }[] = [];
      const texts: string[] = [];
      // All CLI arguments are ASCII relative paths. Windows receives the
      // Unicode model directory through CreateProcessW's working directory.
      this.update("recognizing", `第 1 / ${cuts.length - 1} 段`);
      for (let i = 0; i < cuts.length - 1; i++) {
        this.checkCancelled();
        const offset = cuts[i],
          end = cuts[i + 1];
        // Avoid hallucinations for detected entirely silent chunks.
        if (
          silences.some((s) => s.start <= offset + 0.02 && s.end >= end - 0.02)
        )
          continue;
        this.update("recognizing", `第 ${i + 1} / ${cuts.length - 1} 段`);
        const chunk = join(workDir, "chunk.wav");
        await this.process(
          ffmpeg,
          [
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-i",
            wav,
            "-af",
            `atrim=start_sample=${Math.round(offset * 16000)}:end_sample=${Math.round(end * 16000)},asetpts=PTS-STARTPTS`,
            "-c:a",
            "pcm_s16le",
            chunk,
          ],
          "音频分段处理失败，请检查磁盘空间。",
        );
        const decoded = await this.process(
          this.runtimePath(),
          [
            "--tokens=tokens.txt",
            "--sense-voice-model=model.int8.onnx",
            "--sense-voice-language=auto",
            "--sense-voice-use-itn=1",
            `--num-threads=${Math.max(1, Math.min(4, cpus().length))}`,
            "--provider=cpu",
            "--debug=false",
            relative(this.modelDir(), chunk),
          ],
          "本地识别失败，请检查模型是否完整，或关闭其他占用内存的程序后重试。",
          30 * 60_000,
          this.modelDir(),
        );
        const raw = parseSherpaJson(decoded.stdout);
        rawResults.push({ offset, result: raw });
        const parts = raw.tokens || [],
          times = raw.timestamps || [];
        const text = String(raw.text || joinTranscriptionTokens(parts)).trim();
        if (!text) continue;
        if (
          !parts.length ||
          parts.length !== times.length ||
          times.some(
            (t, j) =>
              !Number.isFinite(t) ||
              t < 0 ||
              t > end - offset + 0.1 ||
              (j > 0 && t < times[j - 1]),
          )
        )
          throw new Error(
            "识别引擎未返回有效的真实时间戳，无法生成时间帧逐字稿。请恢复软件自带的识别运行时。",
          );
        texts.push(text);
        for (let j = 0; j < parts.length; j++) {
          const start = offset + times[j];
          const next = j + 1 < times.length ? offset + times[j + 1] : end;
          const explicitDuration = raw.durations?.[j];
          let stop =
            Number.isFinite(explicitDuration) && explicitDuration! > 0
              ? Math.min(next, start + explicitDuration!)
              : next;
          // CTC emits token starts. Ends use the next observed start or the
          // measured silence boundary, not evenly allocated text durations.
          const silence = silences.find(
            (s) => s.start > start && s.start < stop,
          );
          if (silence) stop = silence.start;
          tokens.push({
            text: parts[j],
            startMs: Math.round(start * 1000),
            endMs: Math.round(stop * 1000),
          });
        }
      }
      this.checkCancelled();
      this.update("timeline");
      const fullText = texts.map(formatReadableTranscript).join("\n\n");
      const segments = buildWanFriendlySegments(tokens);
      if (!fullText || !segments.length)
        throw new Error("没有识别到可用的人声文字，请检查音频内容和音量。");
      const timelineText = formatTimelineTranscript(segments);
      this.checkCancelled();
      this.update("writing");
      const staged = join(workDir, "result");
      mkdirSync(staged);
      mkdirSync(internalDir, { recursive: true });
      const txt = (value: string) =>
        "\ufeff" + value.replace(/\r?\n/g, "\r\n") + "\r\n";
      await writeFile(join(staged, "01_完整逐字稿.txt"), txt(fullText), "utf8");
      await writeFile(
        join(staged, "02_时间帧逐字稿.txt"),
        txt(timelineText),
        "utf8",
      );
      await writeFile(
        internalPath,
        JSON.stringify(
          { taskId, source, rawResults, tokens, segments },
          null,
          2,
        ),
        "utf8",
      );
      this.checkCancelled();
      await rename(staged, outputDir);
      this.checkCancelled();
      committed = true;
      return {
        taskId,
        source,
        outputDir,
        fullTextPath: join(outputDir, "01_完整逐字稿.txt"),
        timelineTextPath: join(outputDir, "02_时间帧逐字稿.txt"),
        fullText,
        timelineText,
        language: rawResults[0]?.result.lang || "auto",
        elapsedMs: Date.now() - started,
        segments,
      };
    } finally {
      if (!committed) {
        await rm(outputDir, { recursive: true, force: true }).catch((e) =>
          this.log(e),
        );
        await rm(internalPath, { force: true }).catch((e) => this.log(e));
      }
      await rm(workDir, { recursive: true, force: true }).catch((e) =>
        this.log(e),
      );
    }
  }
}
