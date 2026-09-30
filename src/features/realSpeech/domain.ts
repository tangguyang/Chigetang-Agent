export const APP_VERSION = "1.2.9",
  MANUAL_VERSION = "5.0",
  PROTOCOL_VERSION = "1.2",
  CAPABILITIES_VERSION = 1;
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
    valid: hanCount <= 40 && weightedCount <= 100,
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
    case "pitch":
      num(v, 0.5, 2);
      break;
    case "volume":
      num(v, 0, 100, true);
      break;
    case "seed":
      num(v, 0, 65535, true);
      break;
    case "transitionPauseMs":
      num(v, 0, 2000, true);
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
    ? blocks.filter((b) => /CHATGPT_(DIRECTOR|EXECUTION)_PLAN_V1/.test(b))
    : [text.trim()];
  if (candidates.length !== 1) throw Error("必须且只能包含一个协议JSON");
  const p = JSON.parse(candidates[0]);
  validateShape(p);
  return p;
}
export function validateShape(p: Obj) {
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
