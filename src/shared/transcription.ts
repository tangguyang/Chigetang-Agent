export const TRANSCRIPTION_AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
] as const;

export const TRANSCRIPTION_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
] as const;

export type TranscriptionSourceKind = "audio" | "video";

export interface TranscriptionSource {
  path: string;
  name: string;
  size: number;
  duration?: number;
  kind: TranscriptionSourceKind;
}

export interface TranscriptionToken {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionStatus {
  outputDir: string;
  modelDir: string;
  modelReady: boolean;
  runtimeReady: boolean;
  ffmpegReady: boolean;
  missingModelFiles: string[];
  engine: "sherpa-onnx";
  model: "SenseVoice Small INT8";
}

export interface TranscriptionResult {
  taskId: string;
  source: TranscriptionSource;
  outputDir: string;
  fullTextPath: string;
  timelineTextPath: string;
  fullText: string;
  timelineText: string;
  language: string;
  elapsedMs: number;
  segments: TranscriptionSegment[];
}

export type TranscriptionStage =
  | "idle"
  | "preparing"
  | "checking"
  | "extracting"
  | "recognizing"
  | "timeline"
  | "writing"
  | "completed"
  | "failed"
  | "cancelled";
export interface TranscriptionProgress {
  stage: TranscriptionStage;
  busy: boolean;
  detail?: string;
  source?: TranscriptionSource;
  result?: TranscriptionResult;
}
export const TRANSCRIPTION_STAGE_LABELS: Record<TranscriptionStage, string> = {
  idle: "等待导入",
  preparing: "准备中",
  checking: "检查模型",
  extracting: "提取/转换音频",
  recognizing: "识别中",
  timeline: "整理时间轴",
  writing: "生成文件",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
};

const strongPunctuation = /[。！？!?；;]/;
const weakPunctuation = /[，,、：:]/;

function cleanToken(token: string) {
  if (!token || /^<\|.*\|>$/.test(token)) return "";
  return token.replaceAll("▁", " ");
}

export function joinTranscriptionTokens(tokens: string[]) {
  return tokens
    .map(cleanToken)
    .join("")
    .replace(/\s+([，。！？、；：,.!?;:])/g, "$1")
    .replace(/([（“‘])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Convert fine-grained token timestamps into Wan-friendly semantic windows.
 * Natural punctuation/silence boundaries win; 2–5 seconds is the target range.
 */
export function buildWanFriendlySegments(tokens: TranscriptionToken[]) {
  const usable = tokens.filter((item) => cleanToken(item.text));
  if (!usable.length) return [] as TranscriptionSegment[];

  const segments: TranscriptionSegment[] = [];
  let start = 0;
  let candidate = -1;
  // Only split at whole-word boundaries, including Chinese compound words.
  const joined = usable.map((item) => cleanToken(item.text)).join("");
  const wordEnds = new Set(
    [...new Intl.Segmenter("zh", { granularity: "word" }).segment(joined)].map(
      (part) => part.index + part.segment.length,
    ),
  );
  let textOffset = 0;

  const push = (endIndex: number) => {
    if (endIndex < start) return;
    const slice = usable.slice(start, endIndex + 1);
    const text = joinTranscriptionTokens(slice.map((item) => item.text));
    if (text) {
      segments.push({
        startMs: slice[0].startMs,
        endMs: Math.max(slice[0].startMs + 1, slice[slice.length - 1].endMs),
        text,
      });
    }
    start = endIndex + 1;
    candidate = -1;
  };

  for (let index = 0; index < usable.length; index += 1) {
    const item = usable[index];
    const duration = item.endMs - usable[start].startMs;
    const next = usable[index + 1];
    const gap = next ? next.startMs - item.endMs : 0;
    const token = cleanToken(item.text);
    textOffset += token.length;
    const wordBoundary = wordEnds.has(textOffset);
    const naturalBoundary = strongPunctuation.test(token) || gap >= 420;
    const weakBoundary = weakPunctuation.test(token) || gap >= 260;

    if (wordBoundary && (naturalBoundary || (duration >= 2000 && weakBoundary)))
      candidate = index;

    if (wordBoundary && duration >= 2000 && naturalBoundary) {
      push(index);
      continue;
    }

    if (duration >= 5000 && wordBoundary) {
      const chosen = candidate >= start ? candidate : index;
      push(chosen);
    }
  }

  if (start < usable.length) push(usable.length - 1);

  // Avoid an isolated very short tail when it can be merged without creating
  // an excessively long window. This keeps prompts readable without hard cuts.
  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    const previous = segments[segments.length - 2];
    if (
      last.endMs - last.startMs < 1000 &&
      last.endMs - previous.startMs <= 6000
    ) {
      previous.endMs = last.endMs;
      previous.text =
        previous.text +
        (/[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(last.text)
          ? " "
          : "") +
        last.text;
      segments.pop();
    }
  }

  return segments;
}

export function formatTimestamp(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function formatTimelineTranscript(segments: TranscriptionSegment[]) {
  return segments
    .map(
      (segment) =>
        `[${formatTimestamp(segment.startMs)} --> ${formatTimestamp(segment.endMs)}]\n${segment.text}`,
    )
    .join("\n\n");
}

export function formatReadableTranscript(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized
    .replace(/([。！？!?；;]+)/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
