import type { AudioBatchRecord } from "./types.ts";

export interface SpeechDurationEstimate {
  seconds: number;
  low: number;
  high: number;
  calibrated: boolean;
}

function spokenUnits(text: string) {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const words = (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?/g) ?? [])
    .length;
  const shortPauses = (text.match(/[，、,;；:：]/g) ?? []).length;
  const longPauses = (text.match(/[。！？!?\n]/g) ?? []).length;
  return han + words * 1.7 + shortPauses * 0.45 + longPauses * 0.9;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function estimateSpeechDuration(
  text: string,
  rate: number,
  voiceId: string,
  batches: AudioBatchRecord[] = [],
): SpeechDurationEstimate {
  const units = spokenUnits(text);
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const samples = batches
    .filter((batch) => batch.voiceId === voiceId)
    .flatMap((batch) =>
      batch.jobs.map((job) => ({
        units: spokenUnits(batch.text),
        seconds: Number(job.duration),
        rate: Number(job.config.rate),
      })),
    )
    .filter(
      (sample) =>
        sample.units >= 5 &&
        sample.seconds >= 1 &&
        sample.seconds <= 3600 &&
        sample.rate >= 0.5 &&
        sample.rate <= 2,
    )
    .slice(0, 10)
    .map((sample) => sample.units / (sample.seconds * sample.rate))
    .filter((speed) => speed >= 1.5 && speed <= 8);
  const unitsPerSecond = samples.length >= 3 ? median(samples) : 3.85;
  const seconds = units ? Math.max(0.5, units / unitsPerSecond / safeRate) : 0;
  return {
    seconds,
    low: seconds * 0.85,
    high: seconds * 1.18,
    calibrated: samples.length >= 3,
  };
}
