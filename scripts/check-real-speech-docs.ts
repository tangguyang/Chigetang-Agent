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
  protocol = "ChatGPT_真人口播返回协议_V1.2.md";
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
console.log("真人口播文档版本、打包位置、字段白名单和完整示例Schema校验通过");
