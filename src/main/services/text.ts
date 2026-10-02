import { writeFile } from "node:fs/promises";
export class TextService {
  process(text: string, operation: string) {
    if (text.length > 1_000_000) throw Error("文本超过100万字符");
    return {
      text:
        operation === "trim"
          ? text.trim()
          : operation === "normalize"
            ? text.normalize("NFKC").replace(/\r\n?/g, "\n")
            : text,
    };
  }
  async subtitles(
    segments: { startMs: number; endMs: number; text: string }[],
    output: string,
  ) {
    const time = (ms: number) => {
      const n = Math.round(ms);
      return `${String(Math.floor(n / 3600000)).padStart(2, "0")}:${String(Math.floor(n / 60000) % 60).padStart(2, "0")}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")},${String(n % 1000).padStart(3, "0")}`;
    };
    for (const s of segments)
      if (s.endMs <= s.startMs) throw Error("字幕结束时间必须晚于开始时间");
    const content = segments
      .map(
        (s, i) =>
          `${i + 1}\n${time(s.startMs)} --> ${time(s.endMs)}\n${s.text}\n`,
      )
      .join("\n");
    await writeFile(output, content, { flag: "wx" });
    return { path: output, count: segments.length };
  }
}
