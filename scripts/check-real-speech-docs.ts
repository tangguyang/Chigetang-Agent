import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import {
  APP_VERSION,
  MANUAL_VERSION,
  PROTOCOL_VERSION,
  ACTIONS,
  FIELDS,
  validateShape,
} from "../src/features/realSpeech/domain.ts";
const manual = "真人口播表演生产系统_使用手册_V5.0.md",
  protocol = "ChatGPT_真人口播返回协议_V1.2.md",
  stage1 = "阶段1_真人带货口播导演对齐_V1.0.md",
  stage2 = "阶段2_真人口播执行编译_V1.0.md";
assert.equal(
  JSON.parse(readFileSync("package.json", "utf8")).version,
  APP_VERSION,
);
for (const name of [manual, protocol, "真人口播_Runtime字段说明.md"]) {
  assert.ok(existsSync("resources/docs/" + name));
  assert.equal(
    readFileSync("docs/" + name, "utf8"),
    readFileSync("resources/docs/" + name, "utf8"),
  );
}

for (const name of [stage1, stage2]) {
  assert.ok(existsSync("resources/docs/" + name));
  assert.ok(existsSync("docs/archive/acceptance/v129-repair2/" + name));
  assert.equal(
    readFileSync("docs/archive/acceptance/v129-repair2/" + name, "utf8"),
    readFileSync("resources/docs/" + name, "utf8"),
  );
}
const stage2Text = readFileSync("resources/docs/" + stage2, "utf8");
assert.ok(stage2Text.includes("REAL_SPEECH_PERFORMANCE_PLAN_V1"));
assert.ok(stage2Text.includes("cosyvoice-v3.5-plus"));
assert.ok(stage2Text.includes("Han <= 40"));
assert.ok(stage2Text.includes("API加权 <= 100"));

const m = readFileSync("resources/docs/" + manual, "utf8"),
  p = readFileSync("resources/docs/" + protocol, "utf8");
assert.ok(m.includes("V" + MANUAL_VERSION));
assert.ok(p.includes("V" + PROTOCOL_VERSION));
for (const field of FIELDS) assert.ok(p.includes(field));
for (const action of ACTIONS) assert.ok(p.includes(action));
const examples = [...p.matchAll(/```json\s*([\s\S]*?)```/g)]
  .filter((x) => x[1].trim().startsWith("{"))
  .map((x) => JSON.parse(x[1]))
  .filter((x) => x.generationWindows || x.action);
assert.equal(examples.length, 2);
examples.forEach(validateShape);
console.log("真人口播文档版本、阶段一/二镜像、模型边界、字段白名单和完整示例Schema校验通过");