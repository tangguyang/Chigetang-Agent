export const APP_VERSION = "1.3.0",
  MANUAL_VERSION = "5.0",
  PROTOCOL_VERSION = "1.2",
  CAPABILITIES_VERSION = 1;

// CosyVoice 3.5 Plus 唯一执行能力表。
// providerInstructionWeightedMax=100 为服务端硬限制；instructionHanSafetyMax=40
// 是吃个糖为标点/数字/字母预留空间的项目安全门槛。所有 UI、协议和请求
// 必须从这里取范围，禁止各处自行发明或漂移参数。
export const COSYVOICE_35_PLUS = Object.freeze({
  model: "cosyvoice-v3.5-plus",
  region: "cn-beijing",
  format: "wav",
  sampleRate: 48000,
  instructionHanSafetyMax: 40,
  providerInstructionWeightedMax: 100,
  rate: [0.5, 2] as const,
  pitch: [0.5, 2] as const,
  volume: [0, 100] as const,
  seed: [0, 65535] as const,
  transitionPauseMs: [0, 2000] as const,
  languageHints: ["zh"] as const,
});
export const ACTIONS = [
  "UPDATE_ONLY",
  "REGENERATE_WINDOW",
  "REGENERATE_REPAIR_WINDOW",
  "JOINT_REPAIR",
  "RECONCAT_ONLY",
  "NO_CHANGE",
] as const;
export const FIELDS = [
  "speakerProfile",
  "performanceArc",
  "instruction",
  "synthesisText",
  "pronunciation",
  "rhythmData",
  "transitionPauseMs",
  "rate",
  "pitch",
  "volume",
  "seed",
];
export const QUESTIONS = [
  "像真实的人面对镜头讲话",
  "不会明显感觉在念稿",
  "像同一个人在同一次录制里说完",
  "轻重、快慢和停顿符合内容意思",
  "重点会自然突出",
  "停顿像真人思考或换气",
  "有说服力，但不像播音或喊卖",
  "人物状态从头到尾变化自然",
  "产品名、数字、专业词自然清楚",
  "不会很快因为声音表现怀疑是 AI",
];
export const ANSWERS = [
  "非常符合",
  "基本符合",
  "不太符合",
  "完全不符合",
  "听不出来 / 不确定",
];
export function instructionCount(s: string) {
  let hanCount = 0,
    weightedCount = 0;
  for (const c of s) {
    const han = /\p{Script=Han}/u.test(c);
    hanCount += Number(han);
    weightedCount += han ? 2 : 1;
  }
  return {
    hanCount,
    weightedCount,
    valid:
      hanCount <= COSYVOICE_35_PLUS.instructionHanSafetyMax &&
      weightedCount <= COSYVOICE_35_PLUS.providerInstructionWeightedMax,
  };
}
export function checkInstruction(s: string) {
  if (!instructionCount(s).valid)
    throw Error("Instruction 超限：汉字最多40，API加权最多100；不会自动截断。");
}
export function units(text: string) {
  return (text.match(/[^。！？\n]+[。！？\n]*/gu) || []).map((text, i) => ({
    id: `U${String(i + 1).padStart(3, "0")}`,
    text,
  }));
}

/**
 * Reparse edited copy while preserving IDs of unchanged semantic units.
 * Exact-text LCS keeps stable references for unchanged phrases; genuinely new/edited
 * units receive monotonically increasing IDs so an old ChatGPT plan can never silently
 * bind to different text.
 */
export function reconcileUnits(previous: Obj[], text: string): Obj[] {
  let fresh = units(text);
  const oldText = previous.map((u) => String(u.text)).join("");
  // Keep the director's phrase boundaries when a text edit is contained in one
  // phrase, including phrases spanning several punctuation-delimited sentences.
  if (previous.length && oldText !== text) {
    let prefix = 0, suffix = 0;
    while (prefix < Math.min(oldText.length, text.length) && oldText[prefix] === text[prefix]) prefix++;
    while (suffix < Math.min(oldText.length, text.length) - prefix && oldText.at(-1 - suffix) === text.at(-1 - suffix)) suffix++;
    let offset = 0;
    const index = previous.findIndex((u) => {
      const start = offset;
      offset += String(u.text).length;
      return prefix >= start && prefix < offset && oldText.length - suffix <= offset;
    });
    if (index >= 0) {
      const start = previous.slice(0, index).reduce((n, u) => n + String(u.text).length, 0);
      const end = start + String(previous[index].text).length + text.length - oldText.length;
      if (end > start) fresh = previous.map((u, i) => ({ id: String(u.id), text: i === index ? text.slice(start, end) : String(u.text) }));
    }
  } else if (previous.length && oldText === text) {
    fresh = previous.map((u) => ({ id: String(u.id), text: String(u.text) }));
  }
  if (!previous.length) return fresh;
  const a = previous.map((u) => String(u.text));
  const b = fresh.map((u) => String(u.text));
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  // Exact LCS matches preserve the complete Phrase metadata, not only the ID.
  const matches: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      matches.push([i, j]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const exactByNew = new Map(matches.map(([oi, ni]) => [ni, previous[oi]]));

  // For a one-for-one edited Phrase between stable anchors, preserve the human
  // Phrase identity/annotations but allocate a new Unit ID. This invalidates old
  // machine bindings while keeping the user's Phrase card and marks it revised.
  const revisedByNew = new Map<number, Obj>();
  const anchors: Array<[number, number]> = [[-1, -1], ...matches, [a.length, b.length]];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [oa, na] = anchors[k], [ob, nb] = anchors[k + 1];
    const oldStart = oa + 1, oldCount = ob - oldStart;
    const newStart = na + 1, newCount = nb - newStart;
    if (oldCount > 0 && oldCount === newCount) {
      for (let x = 0; x < oldCount; x++) {
        const old = previous[oldStart + x];
        if (old?.phraseId) revisedByNew.set(newStart + x, old);
      }
    }
  }

  let nextId = Math.max(0, ...previous.map((u) => {
    const m = /^U(\d+)$/.exec(String(u.id));
    return m ? Number(m[1]) : 0;
  })) + 1;
  return fresh.map((u, index) => {
    const exact = exactByNew.get(index);
    if (exact)
      return { ...structuredClone(exact), text: u.text, phraseChanged: false };
    const revised = revisedByNew.get(index);
    if (revised)
      return {
        ...structuredClone(revised),
        id: `U${String(nextId++).padStart(3, "0")}`,
        text: u.text,
        phraseRevision: Number(revised.phraseRevision || 1) + 1,
        phraseChanged: true,
      };
    return { id: `U${String(nextId++).padStart(3, "0")}`, text: u.text };
  });
}
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.entries(x)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
export type Obj = Record<string, any>;
function obj(x: unknown, keys: string[], required = keys): asserts x is Obj {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw Error("需要JSON对象");
  for (const k of Object.keys(x))
    if (!keys.includes(k)) throw Error("未知字段：" + k);
  for (const k of required) if (!(k in x)) throw Error("缺少字段：" + k);
}
function str(x: unknown) {
  if (typeof x !== "string" || x.length > 20000)
    throw Error("需要字符串（最多20000字符）");
}
function strings(x: unknown) {
  if (
    !Array.isArray(x) ||
    x.some((v) => typeof v !== "string") ||
    x.length > 500
  )
    throw Error("需要字符串数组");
}
function num(x: unknown, a: number, b: number, int = false) {
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    x < a ||
    x > b ||
    (int && !Number.isInteger(x))
  )
    throw Error(`参数必须在${a}至${b}之间`);
}
function choice(x: unknown, v: readonly string[]) {
  if (!v.includes(String(x))) throw Error("未知枚举：" + String(x));
}
const energy = ["LOW", "MEDIUM", "MEDIUM_HIGH", "HIGH"];
function profile(x: unknown) {
  obj(x, ["scene", "tone", "energy", "salesPressure", "forbiddenStyles"]);
  str(x.scene);
  str(x.tone);
  choice(x.energy, energy);
  choice(x.salesPressure, ["LOW", "MEDIUM", "HIGH"]);
  strings(x.forbiddenStyles);
  x.forbiddenStyles.forEach((v: string) =>
    choice(v, [
      "NEWS_ANCHOR",
      "CORPORATE_NARRATION",
      "LIVE_SELLING_SHOUT",
      "SCRIPT_READING",
    ]),
  );
}
function arr(x: unknown, fn: (v: any) => void) {
  if (!Array.isArray(x) || x.length > 500) throw Error("需要数组");
  x.forEach(fn);
}
function arc(x: unknown) {
  arr(x, (v) => {
    obj(v, ["unitIds", "intent", "energy", "note"]);
    strings(v.unitIds);
    str(v.intent);
    choice(v.energy, energy);
    str(v.note);
  });
}
function pronunciation(x: unknown) {
  arr(x, (v) => {
    obj(v, ["word", "pinyin"]);
    str(v.word);
    str(v.pinyin);
    if (!/^[a-zA-ZüÜvV1-5\s]+$/.test(v.pinyin)) throw Error("发音需拼音声调");
  });
}
function rhythm(x: unknown) {
  arr(x, (v) => {
    obj(v, ["unitId", "pauseMs"]);
    str(v.unitId);
    num(v.pauseMs, 0, 2000, true);
  });
}
export function fieldValue(field: string, v: unknown) {
  choice(field, FIELDS);
  switch (field) {
    case "instruction":
      str(v);
      checkInstruction(v as string);
      break;
    case "synthesisText":
      str(v);
      if (!(v as string).trim() || /[<>]/.test(v as string))
        throw Error("合成文本须为非空纯文本；精确停顿使用rhythmData");
      break;
    case "rate":
      num(v, ...COSYVOICE_35_PLUS.rate);
      break;
    case "pitch":
      num(v, ...COSYVOICE_35_PLUS.pitch);
      break;
    case "volume":
      num(v, ...COSYVOICE_35_PLUS.volume, true);
      break;
    case "seed":
      num(v, ...COSYVOICE_35_PLUS.seed, true);
      break;
    case "transitionPauseMs":
      num(v, ...COSYVOICE_35_PLUS.transitionPauseMs, true);
      break;
    case "speakerProfile":
      profile(v);
      break;
    case "performanceArc":
      arc(v);
      break;
    case "pronunciation":
      pronunciation(v);
      break;
    case "rhythmData":
      rhythm(v);
  }
}
export function parsePlan(text: string): Obj {
  if (text.length > 250000) throw Error("协议过大");
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(
    (m) => m[1],
  );
  const candidates = blocks.length
    ? blocks.filter((b) => /(CHATGPT_(DIRECTOR|EXECUTION)_PLAN_V1|REAL_SPEECH_PERFORMANCE_PLAN_V1)/.test(b))
    : [text.trim()];
  if (candidates.length !== 1) throw Error("必须且只能包含一个协议JSON");
  const p = JSON.parse(candidates[0]);
  validateShape(p);
  return p;
}
function validatePerformanceImportShape(p: Obj) {
  obj(p, [
    "schema",
    "protocolVersion",
    "targetModel",
    "planId",
    "sourceText",
    "globalDirection",
    "phrases",
    "windows",
    "missingInputs",
  ]);
  if (p.schema !== "REAL_SPEECH_PERFORMANCE_PLAN_V1") throw Error("导入协议类型错误");
  if (p.protocolVersion !== "1.0") throw Error("真人口播执行协议版本不匹配");
  if (p.targetModel !== COSYVOICE_35_PLUS.model) throw Error("目标模型必须为 CosyVoice 3.5 Plus");
  ["planId", "sourceText", "globalDirection"].forEach((k) => str(p[k]));
  if (!p.planId.trim() || !p.sourceText.trim()) throw Error("planId/sourceText不能为空");
  strings(p.missingInputs);
  arr(p.phrases, (v) => {
    obj(v, [
      "phraseId",
      "text",
      "salesAction",
      "direction",
      "pace",
      "energy",
      "emphasis",
      "pauseAfter",
    ]);
    ["phraseId", "text", "salesAction", "direction"].forEach((k) => str(v[k]));
    if (!/^P\d{3,}$/.test(v.phraseId)) throw Error("Phrase ID格式错误");
    if (!v.text.length) throw Error("Phrase文本不能为空");
    choice(v.pace, ["SLOW", "NORMAL", "FAST"]);
    choice(v.energy, ["LOW", "MEDIUM", "HIGH"]);
    strings(v.emphasis);
    choice(v.pauseAfter, ["NONE", "SHORT", "MEDIUM", "LONG"]);
  });
  if (!p.phrases.length) throw Error("至少需要一个Phrase");
  arr(p.windows, (w) => {
    obj(w, [
      "windowId",
      "phraseIds",
      "instruction",
      "rate",
      "pitch",
      "volume",
      "seed",
      "transitionPauseMs",
      "pronunciation",
      "rhythmBreaks",
    ]);
    str(w.windowId);
    if (!/^GW\d{3,}$/.test(w.windowId)) throw Error("Window ID格式错误");
    strings(w.phraseIds);
    if (!w.phraseIds.length) throw Error("Window不能为空");
    fieldValue("instruction", w.instruction);
    fieldValue("rate", w.rate);
    fieldValue("pitch", w.pitch);
    fieldValue("volume", w.volume);
    fieldValue("seed", w.seed);
    fieldValue("transitionPauseMs", w.transitionPauseMs);
    pronunciation(w.pronunciation);
    arr(w.rhythmBreaks, (r) => {
      obj(r, ["afterPhraseId", "pauseMs"]);
      str(r.afterPhraseId);
      num(r.pauseMs, ...COSYVOICE_35_PLUS.transitionPauseMs, true);
    });
  });
  if (!p.windows.length) throw Error("至少需要一个Generation Window");
}

export function validateShape(p: Obj) {
  if (p?.schema === "REAL_SPEECH_PERFORMANCE_PLAN_V1") {
    validatePerformanceImportShape(p);
    return;
  }
  const base = [
    "schema",
    "protocolVersion",
    "capabilitiesVersion",
    "planId",
    "taskId",
    "taskRevision",
    "exportId",
    "contextHash",
  ];
  const director = [
    "recommendedMode",
    "speakerProfile",
    "performanceArc",
    "performanceBeats",
    "generationWindows",
    "rehearsal",
    "pronunciation",
    "qcFocus",
    "missingInputs",
  ];
  const execution = [
    "action",
    "targets",
    "changes",
    "keepUnchanged",
    "repair",
    "regenerate",
    "reconcat",
    "validationFocus",
    "missingInputs",
  ];
  choice(p.schema, ["CHATGPT_DIRECTOR_PLAN_V1", "CHATGPT_EXECUTION_PLAN_V1"]);
  const d = p.schema === "CHATGPT_DIRECTOR_PLAN_V1";
  obj(p, [...base, ...(d ? director : execution)]);
  base
    .filter((k) => !["taskRevision", "capabilitiesVersion"].includes(k))
    .forEach((k) => str(p[k]));
  if (p.protocolVersion !== PROTOCOL_VERSION || p.capabilitiesVersion !== 1)
    throw Error("协议或能力版本不匹配");
  num(p.taskRevision, 1, 1e9, true);
  if (!p.planId.trim()) throw Error("planId为空");
  strings(p.missingInputs);
  if (d) {
    choice(p.recommendedMode, [
      "CONTINUOUS",
      "DIRECTED_WINDOWS",
      "CONTINUOUS_WITH_LOCAL_REPAIR",
    ]);
    profile(p.speakerProfile);
    arc(p.performanceArc);
    arr(p.performanceBeats, (b) => {
      obj(b, [
        "beatId",
        "unitIds",
        "intent",
        "localPerformanceDelta",
        "emphasis",
        "rhythmHint",
      ]);
      strings(b.unitIds);
      strings(b.emphasis);
      ["beatId", "intent", "localPerformanceDelta", "rhythmHint"].forEach((k) =>
        str(b[k]),
      );
    });
    arr(p.generationWindows, (w) => {
      obj(w, [
        "windowId",
        "beatIds",
        "unitIds",
        "instruction",
        "rhythmPlan",
        "transitionPauseMsAfter",
        "seedPolicy",
      ]);
      str(w.windowId);
      strings(w.beatIds);
      strings(w.unitIds);
      fieldValue("instruction", w.instruction);
      rhythm(w.rhythmPlan);
      num(w.transitionPauseMsAfter, 0, 2000, true);
      choice(w.seedPolicy, ["KEEP_IF_GOOD", "FIXED", "RANDOM"]);
    });
    obj(p.rehearsal, ["unitIds", "reason"]);
    strings(p.rehearsal.unitIds);
    str(p.rehearsal.reason);
    pronunciation(p.pronunciation);
    strings(p.qcFocus);
  } else {
    choice(p.action, ACTIONS);
    obj(p.targets, ["windowIds", "unitIds"]);
    strings(p.targets.windowIds);
    strings(p.targets.unitIds);
    arr(p.changes, (c) => {
      obj(c, ["scope", "targetId", "field", "value"]);
      choice(c.scope, ["TASK", "WINDOW"]);
      str(c.targetId);
      fieldValue(c.field, c.value);
      if (
        ["speakerProfile", "performanceArc"].includes(c.field) !==
        (c.scope === "TASK")
      )
        throw Error("字段scope不匹配");
    });
    strings(p.keepUnchanged);
    obj(p.repair, ["mode", "windowIds", "unitIds"]);
    choice(p.repair.mode, [
      "SINGLE_WINDOW",
      "MULTI_WINDOW",
      "BOUNDARY_JOINT",
      "FULL_CONTINUOUS",
      "NONE",
    ]);
    strings(p.repair.windowIds);
    strings(p.repair.unitIds);
    if (typeof p.regenerate !== "boolean" || typeof p.reconcat !== "boolean")
      throw Error("需要布尔值");
    strings(p.validationFocus);
    const regen = [
      "REGENERATE_WINDOW",
      "REGENERATE_REPAIR_WINDOW",
      "JOINT_REPAIR",
    ].includes(p.action);
    if (p.regenerate !== regen) throw Error("action与regenerate冲突");
    if (["NO_CHANGE", "RECONCAT_ONLY"].includes(p.action) && p.changes.length)
      throw Error("该动作不能修改配置");
    if (p.action === "NO_CHANGE" && p.reconcat)
      throw Error("NO_CHANGE不可拼接");
    if (p.action === "RECONCAT_ONLY" && !p.reconcat)
      throw Error("需要reconcat");
  }
}
export function validateContext(p: Obj, t: Obj) {
  validateShape(p);
  if (p.schema === "REAL_SPEECH_PERFORMANCE_PLAN_V1") {
    if (p.sourceText !== t.originalText)
      throw Error("执行方案原稿与当前任务不一致，请用当前原稿重新执行阶段二");
    const phraseIds = p.phrases.map((v: Obj) => v.phraseId);
    if (new Set(phraseIds).size !== phraseIds.length) throw Error("Phrase ID重复");
    if (p.phrases.map((v: Obj) => v.text).join("") !== p.sourceText)
      throw Error("Phrase必须按原顺序逐字覆盖完整原稿，不得改字或漏字");
    const windowIds = p.windows.map((w: Obj) => w.windowId);
    if (new Set(windowIds).size !== windowIds.length) throw Error("Window ID重复");
    const coverage = p.windows.flatMap((w: Obj) => {
      if (w.phraseIds.some((id: string) => !phraseIds.includes(id)))
        throw Error("Window引用未知Phrase");
      for (const r of w.rhythmBreaks)
        if (!w.phraseIds.includes(r.afterPhraseId))
          throw Error("停顿引用必须位于当前Window");
      return w.phraseIds;
    });
    if (canonical(coverage) !== canonical(phraseIds))
      throw Error("Window必须按顺序覆盖全部Phrase且不重复");
    return;
  }
  for (const k of ["taskId", "taskRevision", "exportId", "contextHash"])
    if (p[k] !== t[k]) throw Error("旧方案或任务不匹配：" + k);
  const known = t.units.map((u: Obj) => u.id);
  const refs = (ids: string[]) => {
    strings(ids);
    if (ids.some((id) => !known.includes(id))) throw Error("未知Unit");
  };
  if (p.schema === "CHATGPT_DIRECTOR_PLAN_V1") {
    const beats = p.performanceBeats.map((b: Obj) => b.beatId),
      wins = p.generationWindows.map((w: Obj) => w.windowId);
    if (
      new Set(beats).size !== beats.length ||
      new Set(wins).size !== wins.length ||
      !wins.length
    )
      throw Error("Beat/Window为空或重复");
    p.performanceBeats.forEach((b: Obj) => refs(b.unitIds));
    p.performanceArc.forEach((a: Obj) => refs(a.unitIds));
    refs(p.rehearsal.unitIds);
    const rehearsalIndices = p.rehearsal.unitIds.map((id: string) =>
      known.indexOf(id),
    );
    if (
      rehearsalIndices.some(
        (n: number, i: number) => i > 0 && n !== rehearsalIndices[i - 1] + 1,
      )
    )
      throw Error("试演Unit须连续");
    if (!p.rehearsal.unitIds.length) throw Error("试演不能为空");
    const coverage: string[] = p.generationWindows.flatMap((w: Obj) => {
      refs(w.unitIds);
      if (
        !/^GW\d{3,}$/.test(w.windowId) ||
        !w.unitIds.length ||
        w.beatIds.some((id: string) => !beats.includes(id))
      )
        throw Error("Window或Beat引用无效");
      w.rhythmPlan.forEach((r: Obj) => {
        refs([r.unitId]);
        if (!w.unitIds.includes(r.unitId)) throw Error("节奏引用超出Window");
      });
      return w.unitIds;
    });
    if (JSON.stringify(coverage) !== JSON.stringify(known))
      throw Error("Window必须按顺序覆盖全部Unit且不重复");
    if (p.recommendedMode === "CONTINUOUS" && wins.length !== 1)
      throw Error("连续模式只能一个Window");
  } else {
    refs(p.targets.unitIds);
    if (
      new Set(p.targets.windowIds).size !== p.targets.windowIds.length ||
      new Set(p.targets.unitIds).size !== p.targets.unitIds.length
    )
      throw Error("目标引用重复");
    refs(p.repair.unitIds);
    const wins = t.windows.map((w: Obj) => w.windowId);
    for (const id of [
      ...p.targets.windowIds,
      ...p.repair.windowIds,
      ...p.changes
        .filter((c: Obj) => c.scope === "WINDOW")
        .map((c: Obj) => c.targetId),
    ])
      if (!wins.includes(id)) throw Error("未知Window");
    p.changes.forEach((c: Obj) => {
      if (c.scope === "TASK" && c.targetId !== t.taskId)
        throw Error("任务scope引用错误");
      if (p.keepUnchanged.includes(c.field)) throw Error("锁定字段冲突");
      if (c.field === "performanceArc")
        c.value.forEach((a: Obj) => refs(a.unitIds));
      if (c.field === "rhythmData")
        c.value.forEach((r: Obj) => {
          refs([r.unitId]);
          if (
            !t.windows
              .find((w: Obj) => w.windowId === c.targetId)
              .unitIds.includes(r.unitId)
          )
            throw Error("节奏引用超出目标窗口");
        });
      if (
        p.regenerate &&
        c.scope === "WINDOW" &&
        !p.targets.windowIds.includes(c.targetId)
      )
        throw Error("变更必须属于重生成目标");
    });
    if (p.regenerate && !p.targets.windowIds.length)
      throw Error("重生成目标为空");
    if (
      p.regenerate &&
      p.targets.unitIds.length &&
      p.targets.unitIds.some(
        (id: string) =>
          !p.targets.windowIds.some((wid: string) =>
            t.windows.find((w: Obj) => w.windowId === wid).unitIds.includes(id),
          ),
      )
    )
      throw Error("Unit不属于目标窗口");
    if (p.action === "JOINT_REPAIR") {
      if (p.repair.mode !== "BOUNDARY_JOINT")
        throw Error("联合修复mode必须BOUNDARY_JOINT");
      const changes = p.changes.filter((c: Obj) => c.scope === "WINDOW");
      for (const field of [
        "instruction",
        "rate",
        "pitch",
        "volume",
        "seed",
        "pronunciation",
        "rhythmData",
        "synthesisText",
      ]) {
        const edits = changes.filter((c: Obj) => c.field === field);
        if (
          edits.some(
            (c: Obj) => canonical(c.value) !== canonical(edits[0]?.value),
          )
        )
          throw Error("联合修复应统一生成参数");
      }

      const indices = p.targets.windowIds.map((id: string) => wins.indexOf(id));
      if (
        indices.length < 2 ||
        indices.some(
          (n: number, i: number) => i > 0 && n !== indices[i - 1] + 1,
        )
      )
        throw Error("联合修复必须相邻Window");
    }
    if (
      p.action === "REGENERATE_REPAIR_WINDOW" &&
      JSON.stringify(p.repair.unitIds) !==
        JSON.stringify(
          p.targets.windowIds.flatMap(
            (id: string) =>
              t.windows.find((w: Obj) => w.windowId === id).unitIds,
          ),
        )
    )
      throw Error("局部修复须覆盖完整Window上下文");
  }
}

export const CASE_CHECKS: Record<string, string[]> = {
  "CASE 1": [
    "开场不喊",
    "反问自然",
    "懒馋宝宝三拍不机械",
    "价格不促销腔",
    "CTA不突然升能量",
  ],
  "CASE 2": [
    "吐槽真实",
    "工厂经历像聊天",
    "叙事到配方过渡自然",
    "重复品牌句保持同一人物",
    "CTA人物一致",
  ],
  "CASE 3": [
    "权威不播音",
    "身份介绍自然",
    "长机构名与成分清晰",
    "长句枚举有呼吸",
    "后段不变主播",
  ],
  通用: [],
};
