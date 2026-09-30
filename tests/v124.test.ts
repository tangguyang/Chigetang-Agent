import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import {
  buildWanFriendlySegments,
  formatTimelineTranscript,
  joinTranscriptionTokens,
  type TranscriptionToken,
} from "../src/shared/transcription.ts";

test("v1.2.4 sidebar places 转文字 directly after 复刻音色 and defaults to 一键生成", () => {
  const main = readFileSync("src/renderer/main.tsx", "utf8");
  assert.match(main, /\["复刻音色", FileText\],\s*\["转文字", FileText\]/);
  const store = readFileSync("src/renderer/store.ts", "utf8");
  assert.match(store, /page: "一键生成"/);
});

test("v1.2.4 transcription header exposes output/model/guide actions", () => {
  const page = readFileSync("src/renderer/pages/Transcription.tsx", "utf8");
  assert.match(page, /音视频转文字/);
  assert.match(page, /transcription\.openOutput/);
  assert.match(page, /transcription\.openModel/);
  assert.match(page, /transcription\.openGuide/);
  assert.ok(existsSync("docs/本地转文字-模型安装说明.txt"));
});

test("Wan-friendly segmentation keeps semantic punctuation and 2-5 second target where possible", () => {
  const raw: TranscriptionToken[] = [
    { text: "今", startMs: 0, endMs: 400 },
    { text: "天", startMs: 400, endMs: 800 },
    { text: "讲", startMs: 800, endMs: 1200 },
    { text: "体", startMs: 1200, endMs: 1600 },
    { text: "重", startMs: 1600, endMs: 2000 },
    { text: "管", startMs: 2000, endMs: 2400 },
    { text: "理", startMs: 2400, endMs: 2800 },
    { text: "。", startMs: 2800, endMs: 3000 },
    { text: "先", startMs: 3300, endMs: 3700 },
    { text: "看", startMs: 3700, endMs: 4100 },
    { text: "饮", startMs: 4100, endMs: 4500 },
    { text: "食", startMs: 4500, endMs: 4900 },
    { text: "。", startMs: 4900, endMs: 5200 },
  ];
  const segments = buildWanFriendlySegments(raw);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "今天讲体重管理。");
  assert.equal(segments[1].text, "先看饮食。");
  assert.match(formatTimelineTranscript(segments), /\[00:00\.000 --> 00:03\.000\]/);
});

test("token join supports sentencepiece spaces without breaking Chinese", () => {
  assert.equal(joinTranscriptionTokens(["你", "好", "，", "▁hello", "▁world", "!"]), "你好， hello world!");
});
