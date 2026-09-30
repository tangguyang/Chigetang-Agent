import type { Model } from "./types.ts";

export interface SegmentRange {
  index: number;
  start: number;
  end: number;
  duration: number;
}

export function segmentLimit(model: Model) {
  const video = model.capabilities.limits.video?.maxSeconds ?? Infinity;
  const audio = model.capabilities.limits.audio?.maxSeconds ?? Infinity;
  const output =
    model.capabilities.parameters.find(
      (parameter) => parameter.key === "duration",
    )?.max ?? Infinity;
  const joint = model.capabilities.inputOutputDurationLimit
    ? model.capabilities.inputOutputDurationLimit / 2
    : Infinity;
  return Math.min(video, audio, output, joint);
}

export function planSegments(
  totalSeconds: number,
  maxSeconds: number,
  preferredCuts: number[] = [],
): SegmentRange[] {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0)
    throw new Error("无法读取长素材时长，不能自动分段。");
  if (!Number.isFinite(maxSeconds) || maxSeconds < 2)
    throw new Error("当前模型的单段时长限制无法用于自动分段。");
  const cuts = [...new Set(preferredCuts)]
    .filter((value) => value > 0.5 && value < totalSeconds - 0.5)
    .sort((a, b) => a - b);
  const result: SegmentRange[] = [];
  let start = 0;
  while (totalSeconds - start > maxSeconds + 0.001) {
    const target = start + maxSeconds;
    const minimum = start + Math.min(2, maxSeconds / 3);
    const natural = cuts
      .filter((cut) => cut >= minimum && cut <= target)
      .sort((a, b) => b - a)[0];
    let end = natural ?? target;
    if (totalSeconds - end < 2) end = totalSeconds - 2;
    if (end <= start) end = target;
    result.push({
      index: result.length + 1,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      duration: Number((end - start).toFixed(3)),
    });
    start = end;
  }
  result.push({
    index: result.length + 1,
    start: Number(start.toFixed(3)),
    end: Number(totalSeconds.toFixed(3)),
    duration: Number((totalSeconds - start).toFixed(3)),
  });
  return result;
}

const TIMECODE =
  /(\d+(?:\.\d+)?)\s*(?:-|~|–|—|至)\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?/i;

/** Keep global lines and clip/rebase timeline lines without changing the source Prompt. */
export function promptForSegment(prompt: string, segment: SegmentRange) {
  return prompt
    .split("\n")
    .flatMap((line) => {
      const match = line.match(TIMECODE);
      if (!match) return [line];
      const from = Number(match[1]);
      const to = Number(match[2]);
      const overlapStart = Math.max(from, segment.start);
      const overlapEnd = Math.min(to, segment.end);
      if (overlapEnd <= overlapStart) return [];
      const localStart = Number((overlapStart - segment.start).toFixed(2));
      const localEnd = Number((overlapEnd - segment.start).toFixed(2));
      return [
        line.replace(
          TIMECODE,
          `${localStart.toFixed(2)}-${localEnd.toFixed(2)}秒`,
        ),
      ];
    })
    .join("\n")
    .trim();
}
