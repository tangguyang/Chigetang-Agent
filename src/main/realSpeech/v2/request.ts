import type { Obj } from "../../../features/realSpeech/domain.ts";
const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
/** This allowlist intentionally never reads intentRanges or directorReference. */
export function buildRequest(model: string, voice: string, w: Obj): Obj {
  const chars = [...w.synthesisText];
  function content(start: number, end: number, first: boolean) {
    let text = "",
      pos = start;
    const nodes = w.ssml.nodes
      .filter((n: Obj) =>
        n.kind === "break"
          ? (n.offset > start && n.offset <= end) || (first && n.offset === 0)
          : n.start >= start && n.end <= end,
      )
      .sort(
        (a: Obj, b: Obj) =>
          (a.offset ?? a.start) - (b.offset ?? b.start) ||
          (a.kind === "break" ? -1 : 1),
      );
    for (const n of nodes) {
      const at = n.offset ?? n.start;
      text += esc(chars.slice(pos, at).join(""));
      pos = at;
      if (n.kind === "break") text += `<break time="${n.timeMs}ms"/>`;
      else {
        const inner = esc(n.text);
        text +=
          n.kind === "phoneme"
            ? `<phoneme alphabet="${esc(n.alphabet)}" ph="${esc(n.ph)}">${inner}</phoneme>`
            : n.kind === "sub"
              ? `<sub alias="${esc(n.alias)}">${inner}</sub>`
              : `<say-as interpret-as="${esc(n.interpretAs)}">${inner}</say-as>`;
        pos = n.end;
      }
    }
    return text + esc(chars.slice(pos, end).join(""));
  }
  const text = w.ssml.enabled
    ? w.ssml.speakSegments.length
      ? w.ssml.speakSegments
          .map(
            (s: Obj, i: number) =>
              `<speak rate="${s.rate}" pitch="${s.pitch}" volume="${s.volume}">${content(s.start, s.end, i === 0)}</speak>`,
          )
          .join("")
      : `<speak>${content(0, chars.length, true)}</speak>`
    : w.synthesisText;
  const e = w.execution;
  return {
    model,
    input: {
      voice,
      text,
      instruction: e.instruction,
      rate: e.rate,
      pitch: e.pitch,
      volume: e.volume,
      seed: e.seed,
      format: e.format,
      sample_rate: e.sampleRate,
      language_hints: e.languageHints,
      enable_ssml: w.ssml.enabled,
      ...(w.hotFix.pronunciation.length || w.hotFix.replace.length
        ? {
            hot_fix: {
              pronunciation: w.hotFix.pronunciation.map((h: Obj) => ({
                [h.word]: h.pinyin,
              })),
              replace: w.hotFix.replace.map((h: Obj) => ({
                [h.source]: h.target,
              })),
            },
          }
        : {}),
    },
  };
}
