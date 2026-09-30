import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
const exec = promisify(execFile);
export function ffmpegBinary(configured?: string) {
  const bundled = join(
    dirname(process.execPath),
    "resources",
    "app",
    "resources",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  const development = join(
    process.cwd(),
    "resources",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  return (
    configured ||
    process.env.AIVIDEO_FFMPEG_PATH ||
    (existsSync(bundled)
      ? bundled
      : existsSync(development)
        ? development
        : "ffmpeg")
  );
}
export async function hasFFmpeg(configured?: string) {
  try {
    await exec(ffmpegBinary(configured), ["-version"], {
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}
export async function convertAudio(
  input: string,
  output: string,
  configured?: string,
) {
  try {
    await exec(
      ffmpegBinary(configured),
      [
        "-nostdin",
        "-n",
        "-i",
        input,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "24000",
        ...(output.endsWith(".wav")
          ? ["-c:a", "pcm_s16le"]
          : ["-c:a", "libmp3lame", "-b:a", "128k"]),
        output,
      ],
      { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
  } catch {
    throw new Error(
      "音频转换失败。请在设置中配置可用的 FFmpeg，或提供 24kHz 单声道 16bit WAV；保存 MP3 需要 FFmpeg。",
    );
  }
}

function atempoChain(tempo: number) {
  const values: number[] = [];
  while (tempo > 2) {
    values.push(2);
    tempo /= 2;
  }
  while (tempo < 0.5) {
    values.push(0.5);
    tempo /= 0.5;
  }
  values.push(tempo);
  return values.map((value) => `atempo=${value.toFixed(8)}`).join(",");
}
export async function calibrateAudioDuration(
  input: string,
  output: string,
  actualSeconds: number,
  targetSeconds: number,
  configured?: string,
) {
  if (!(actualSeconds > 0) || !(targetSeconds > 0))
    throw new Error("音频时长无效，无法校准。");
  try {
    await exec(
      ffmpegBinary(configured),
      [
        "-nostdin",
        "-n",
        "-i",
        input,
        "-vn",
        "-filter:a",
        atempoChain(actualSeconds / targetSeconds),
        "-ac",
        "1",
        "-ar",
        "24000",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
  } catch {
    await unlink(output).catch(() => {});
    throw new Error("保音高时长校准失败，原始生成音频已保留。");
  }
}

export async function detectSilenceCuts(
  input: string,
  configured?: string,
) {
  try {
    const { stderr } = await exec(
      ffmpegBinary(configured),
      [
        "-nostdin",
        "-i",
        input,
        "-af",
        "silencedetect=n=-35dB:d=0.22",
        "-f",
        "null",
        "-",
      ],
      { timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    const values = [...stderr.matchAll(/silence_(?:start|end):\s*([0-9.]+)/g)].map(
      (match) => Number(match[1]),
    );
    const centers: number[] = [];
    for (let index = 0; index + 1 < values.length; index += 2)
      centers.push((values[index] + values[index + 1]) / 2);
    return centers;
  } catch {
    return [];
  }
}

export async function trimMediaSegment(
  input: string,
  output: string,
  start: number,
  duration: number,
  kind: "video" | "audio",
  configured?: string,
) {
  try {
    await exec(
      ffmpegBinary(configured),
      [
        "-nostdin",
        "-y",
        "-ss",
        String(start),
        "-i",
        input,
        "-t",
        String(duration),
        ...(kind === "video"
          ? [
              "-vf",
              `tpad=stop_mode=clone:stop_duration=${duration}`,
              "-c:v",
              "libx264",
              "-preset",
              "medium",
              "-crf",
              "18",
              "-pix_fmt",
              "yuv420p",
              "-an",
            ]
          : ["-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le"]),
        output,
      ],
      { timeout: 300000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch {
    await unlink(output).catch(() => {});
    throw new Error(
      `自动分段失败：无法裁切${kind === "video" ? "参考视频" : "参考音频"}。请检查 FFmpeg 和文件是否可读。`,
    );
  }
}

export async function concatVideoWithAudio(
  videos: string[],
  audio: string | null,
  output: string,
  configured?: string,
) {
  if (!videos.length) throw new Error("没有可拼接的分段视频。");
  const list = output + ".concat.txt";
  await writeFile(
    list,
    videos
      .map((path) => `file '${path.replaceAll("'", "'\\''")}'`)
      .join("\n"),
    "utf8",
  );
  try {
    await exec(
      ffmpegBinary(configured),
      [
        "-nostdin",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        ...(audio ? ["-i", audio, "-map", "0:v:0", "-map", "1:a:0"] : []),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        ...(audio ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : ["-an"]),
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 600000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch {
    await unlink(output).catch(() => {});
    throw new Error(
      audio
        ? "分段视频拼接或最终音轨封装失败，分段结果已保留，可重试。"
        : "分段视频拼接失败，分段结果已保留，可重试。",
    );
  } finally {
    await unlink(list).catch(() => {});
  }
}
