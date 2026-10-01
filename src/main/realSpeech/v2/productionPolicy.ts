import type { Obj } from "../../../features/realSpeech/domain.ts";
import { isDeepStrictEqual } from "node:util";

export const weightedInstructionLength = (text: string) =>
  [...text].reduce((n, c) => n + (/\p{Script=Han}/u.test(c) ? 2 : 1), 0);

/** Only declared execution fields determine risk; director text is never interpreted. */
export function controlAssessment(w: Obj, rules: Obj) {
  const e = w.execution;
  const segments = w.ssml.speakSegments;
  const kinds = new Set(w.ssml.nodes.map((n: Obj) => n.kind));
  const weightedLength = weightedInstructionLength(e.instruction);
  const instruction = Boolean(e.instruction);
  const ssml = w.ssml.enabled;
  const hotFix = Boolean(
    w.hotFix.pronunciation.length || w.hotFix.replace.length,
  );
  const transition = w.transition.pauseMs > 0;
  const groups =
    Number(instruction) + Number(ssml) + Number(hotFix) + Number(transition);
  const high =
    segments.length > 1 ||
    segments.some(
      (s: Obj) => s.rate !== 1 || s.pitch !== 1 || s.volume !== 50,
    ) ||
    e.rate !== 1 ||
    e.pitch !== 1 ||
    e.volume !== 50 ||
    weightedLength > rules.instructionRecommendedWeightedMax ||
    groups >= 3 ||
    kinds.size >= 3;
  const complexity = high
    ? "L3"
    : groups >= 2 || kinds.size > 1
      ? "L2"
      : groups || segments.length
        ? "L1"
        : "L0";
  const risk =
    complexity === "L3"
      ? "HIGH"
      : instruction || w.ssml.nodes.length || complexity === "L2"
        ? "MEDIUM"
        : "LOW";
  const warnings: string[] = [];
  if (complexity === "L3")
    warnings.push(
      "该控制在第一批真实听感测试中曾明显增加AI/TTS感或拼接感，建议仅用于实验。",
    );
  if (weightedLength > rules.instructionRecommendedWeightedMax)
    warnings.push(
      "长指令高风险；推荐加权长度不超过20，这是产品建议，不是官方上限。",
    );
  if (w.ssml.nodes.some((n: Obj) => n.kind === "break"))
    warnings.push("停顿必须服务语义；需人工验证自然度，400ms不是常用模板值。");
  if (instruction && ssml)
    warnings.push("控制叠加须证明听感收益，不能因为更精细就叠加。");
  return {
    controlComplexity: complexity,
    minimumNaturalnessRisk: risk,
    weightedInstructionLength: weightedLength,
    warnings,
  };
}

export function validateProductionPolicy(w: Obj, rules: Obj) {
  const result = controlAssessment(w, rules);
  if (w.controlComplexity !== result.controlComplexity)
    throw Error(
      "controlComplexity与明确执行字段不一致：" + result.controlComplexity,
    );
  const ranks: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  if (ranks[w.naturalnessRisk] < ranks[result.minimumNaturalnessRisk])
    throw Error("naturalnessRisk低估控制风险");
  if (
    result.controlComplexity === "L3" &&
    (!w.experimental || w.naturalnessRisk !== "HIGH")
  )
    throw Error("L3必须experimental=true且naturalnessRisk=HIGH");
  if (
    (result.controlComplexity === "L2" ||
      result.controlComplexity === "L3" ||
      w.experimental) &&
    !w.controlReason.trim()
  )
    throw Error("L2/L3或实验控制必须提供明确理由");
  if (
    w.ssml.nodes.some(
      (n: Obj) =>
        n.kind === "break" &&
        (n.timeMs < rules.breakRecommendedMs[0] ||
          n.timeMs > rules.breakRecommendedMs[1]),
    ) &&
    !w.controlReason.trim()
  )
    throw Error("超出产品建议的停顿必须说明语义理由；400ms不是默认模板");
  if (w.instructionIntentCount !== Number(Boolean(w.execution.instruction)))
    throw Error(
      "instructionIntentCount须为空指令0或单一核心状态1；软件不自行判断导演语义",
    );
  return result;
}

/** Compare effective variable families, not merely the number of Patch keys. */
export function primaryVariableDiff(before: Obj, after: Obj) {
  const same = isDeepStrictEqual;
  const changed: string[] = [];
  for (const k of ["instruction", "rate", "pitch", "volume", "seed"])
    if (!same(before.execution[k], after.execution[k])) changed.push(k);
  if (before.synthesisText !== after.synthesisText) changed.push("text");
  for (const kind of ["break", "phoneme", "sub", "sayAs"])
    if (
      !same(
        before.ssml.nodes.filter((n: Obj) => n.kind === kind),
        after.ssml.nodes.filter((n: Obj) => n.kind === kind),
      )
    )
      changed.push(kind);
  if (
    before.ssml.enabled !== after.ssml.enabled ||
    !same(
      before.ssml.speakSegments.map((s: Obj) => [s.segmentId, s.start, s.end]),
      after.ssml.speakSegments.map((s: Obj) => [s.segmentId, s.start, s.end]),
    )
  )
    changed.push("speakStructure");
  for (const [field, initial, family] of [
    ["rate", 1, "localRate"],
    ["pitch", 1, "localPitch"],
    ["volume", 50, "localVolume"],
  ] as const) {
    const values = (w: Obj) =>
      w.ssml.speakSegments
        .filter((s: Obj) => s[field] !== initial)
        .map((s: Obj) => [s.segmentId, s.start, s.end, s[field]]);
    if (!same(values(before), values(after))) changed.push(family);
  }
  if (!same(before.hotFix.pronunciation, after.hotFix.pronunciation))
    changed.push("hotFixPronunciation");
  if (!same(before.hotFix.replace, after.hotFix.replace))
    changed.push("hotFixReplace");
  if (!same(before.transition, after.transition)) changed.push("transition");
  // Enabling the SSML envelope only to carry one node family is supporting metadata.
  if (
    changed.includes("speakStructure") &&
    same(before.ssml.speakSegments, after.ssml.speakSegments) &&
    changed.filter((k) => ["break", "phoneme", "sub", "sayAs"].includes(k))
      .length === 1
  )
    changed.splice(changed.indexOf("speakStructure"), 1);
  return changed;
}
