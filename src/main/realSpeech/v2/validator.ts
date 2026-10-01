import { buildRequest } from "./request.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { Obj } from "../../../features/realSpeech/domain.ts";

export function canonicalV2(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalV2).join(",")}]`;
  if (x !== null && typeof x === "object")
    return `{${Object.keys(x)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalV2((x as Obj)[k]))
      .join(",")}}`;
  if (typeof x === "number" && !Number.isFinite(x)) throw Error("非法数值");
  if (
    typeof x === "string" &&
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      x,
    )
  )
    throw Error("无效Unicode");
  const s = JSON.stringify(x);
  if (s === undefined) throw Error("非法JSON值");
  return s;
}
export const sha256 = (x: string | Buffer) =>
  createHash("sha256").update(x).digest("hex");
export const planHash = (x: unknown) => sha256(canonicalV2(x));
export function strictJSON(text: string): Obj {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 2_000_000)
    throw Error("协议超过2MB或不是文本");
  const parsed = JSON.parse(text);
  const tokens =
    text.match(
      /"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    ) || [];
  let i = 0;
  function walk(depth: number) {
    if (depth > 64) throw Error("JSON嵌套过深");
    const t = tokens[i++];
    if (t === "{") {
      const keys = new Set<string>();
      while (tokens[i] !== "}") {
        const k = JSON.parse(tokens[i++]);
        if (keys.has(k)) throw Error("JSON重复键：" + k);
        keys.add(k);
        i++;
        walk(depth + 1);
        if (tokens[i] === ",") i++;
        else break;
      }
      i++;
    } else if (t === "[") {
      while (tokens[i] !== "]") {
        walk(depth + 1);
        if (tokens[i] === ",") i++;
        else break;
      }
      i++;
    }
  }
  walk(0);
  canonicalV2(parsed);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
    throw Error("协议必须是JSON对象");
  return parsed;
}
const cp = (text: string) => [...text];
const slice = (text: string, a: number, b: number) =>
  cp(text).slice(a, b).join("");
export class PlanValidator {
  profile: Obj;
  planSchema: ReturnType<Ajv2020["compile"]>;
  patchSchema: ReturnType<Ajv2020["compile"]>;
  constructor(resources = join(process.cwd(), "resources", "real-speech-v2")) {
    this.profile = JSON.parse(
      readFileSync(
        join(resources, "COSYVOICE_CAPABILITY_PROFILE.v1.json"),
        "utf8",
      ),
    );
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addSchema(
      JSON.parse(
        readFileSync(join(resources, "schemas/common.schema.json"), "utf8"),
      ),
    );
    this.planSchema = ajv.compile(
      JSON.parse(
        readFileSync(
          join(resources, "schemas/REAL_SPEECH_EXECUTION_PLAN_V2.schema.json"),
          "utf8",
        ),
      ),
    );
    this.patchSchema = ajv.compile(
      JSON.parse(
        readFileSync(
          join(resources, "schemas/REAL_SPEECH_EXECUTION_PATCH_V2.schema.json"),
          "utf8",
        ),
      ),
    );
  }
  schema(x: Obj, patch = false) {
    const v = patch ? this.patchSchema : this.planSchema;
    if (!v(x))
      throw Error(
        (v.errors || [])
          .map((e) => `${e.instancePath || "/"}: ${e.message}`)
          .join("\n"),
      );
  }
  profileCheck(x: Obj) {
    if (
      x.capabilityProfileId !== this.profile.capabilityProfileId ||
      x.capabilityVersion !== this.profile.capabilityVersion
    )
      throw Error("Capability Profile版本不匹配；不能自动升级协议");
  }
  number(cap: string, value: number) {
    const c = this.profile.modelCapabilities[cap];
    const range = c.limits;
    if (
      range &&
      (value < range.min ||
        value > range.max ||
        (range.integer && !Number.isInteger(value)))
    )
      throw Error(`${cap}超出官方范围`);
  }
  validate(x: Obj) {
    this.schema(x);
    this.profileCheck(x);
    const hard = this.profile.productPolicy.hardLimits;
    if (Buffer.byteLength(canonicalV2(x), "utf8") > hard.importBytesMax)
      throw Error("协议超过Profile大小限制");
    if (
      x.engine.model !== this.profile.model ||
      !this.profile.transports.http.regions.includes(x.engine.region) ||
      x.engine.transport !== "http"
    )
      throw Error("模型/地域/接口不匹配");
    if (
      x.voiceRequirements.kind !== "cloned" ||
      x.voiceRequirements.targetModel !== this.profile.model
    )
      throw Error("必须选择匹配模型的复刻音色");
    const expected = sha256(x.originalText);
    if (x.originalTextHash !== null && x.originalTextHash !== expected)
      throw Error("原稿hash不匹配");
    const ids = new Set<string>();
    let end = 0;
    if (x.windows.length > hard.maxWindows) throw Error("Window数量超过500");
    x.windows.forEach((w: Obj, index: number) => {
      if (ids.has(w.windowId)) throw Error("重复WindowId");
      ids.add(w.windowId);
      if (
        w.start !== end ||
        w.end <= w.start ||
        slice(x.originalText, w.start, w.end) !== w.original
      )
        throw Error("Window原稿覆盖错误：" + w.windowId);
      end = w.end;
      if (
        !w.synthesisText.trim() ||
        cp(w.synthesisText).length > hard.synthesisTextCodePointMax
      )
        throw Error("合成文本为空或过长");
      if (w.synthesisText !== w.original && !w.textApproval?.confirmation)
        throw Error("改动合成文本须明确确认");
      const e = w.execution;
      if (
        e.languageHints.some(
          (h: string) =>
            !this.profile.modelCapabilities.languageHints.apiEnum.includes(h),
        )
      )
        throw Error("languageHint不支持");
      const count = cp(e.instruction).reduce(
        (n, c) => n + (/\p{Script=Han}/u.test(c) ? 2 : 1),
        0,
      );
      if (count > this.profile.modelCapabilities.instruction.limits.weightedMax)
        throw Error("instruction加权超过100");
      for (const k of ["rate", "pitch", "volume", "seed"]) this.number(k, e[k]);
      if (
        e.format !== hard.format ||
        e.sampleRate !== hard.sampleRate ||
        e.languageHints.length > hard.maxLanguageHints
      )
        throw Error("输出格式必须wav/48000及最多一个languageHint");
      if (
        !w.ssml.enabled &&
        (w.ssml.nodes.length || w.ssml.speakSegments.length)
      )
        throw Error("关闭SSML时不能有节点");
      let prev = 0;
      const ranges: Obj[] = [];
      const breaks: Obj[] = [];
      for (const n of w.ssml.nodes) {
        if (n.kind === "break") {
          if (
            n.offset < 0 ||
            n.offset > cp(w.synthesisText).length ||
            n.timeMs < this.profile.modelCapabilities.break.limits.timeMsMin ||
            n.timeMs > this.profile.modelCapabilities.break.limits.timeMsMax
          )
            throw Error("break越界");
          breaks.push(n);
          continue;
        }
        if (
          n.start < prev ||
          n.end <= n.start ||
          n.end > cp(w.synthesisText).length ||
          slice(w.synthesisText, n.start, n.end) !== n.text
        )
          throw Error("SSML范围重叠或文本不匹配");
        prev = n.end;
        ranges.push(n);
        if (
          n.kind === "phoneme" &&
          !this.profile.modelCapabilities.phoneme.alphabets.includes(n.alphabet)
        )
          throw Error("phoneme alphabet不支持");
        if (
          n.kind === "phoneme" &&
          n.alphabet === "py" &&
          (!n.ph
            .trim()
            .split(/\s+/)
            .every((p: string) => /^[a-züv:]+[1-5]$/i.test(p)) ||
            n.ph.trim().split(/\s+/).length !== cp(n.text).length)
        )
          throw Error("phoneme拼音和字符数量不匹配");
        if (
          n.kind === "sayAs" &&
          !this.profile.modelCapabilities.sayAs.interpretAs.includes(
            n.interpretAs,
          )
        )
          throw Error("say-as类型不支持");
      }
      for (const b of breaks) {
        if (ranges.some((n) => b.offset > n.start && b.offset < n.end))
          throw Error("break落在读法节点内部");
        if (
          breaks
            .filter((n) => n.offset === b.offset)
            .reduce((a, n) => a + n.timeMs, 0) >
          this.profile.modelCapabilities.break.limits.consecutiveMaxMs
        )
          throw Error("连续break超过10秒");
      }
      let pos = 0;
      const segIds = new Set<string>();
      for (const s of w.ssml.speakSegments) {
        if (segIds.has(s.segmentId)) throw Error("重复speak段ID");
        segIds.add(s.segmentId);
        if (
          s.start !== pos ||
          s.end <= s.start ||
          s.end > cp(w.synthesisText).length
        )
          throw Error("speak必须连续覆盖");
        pos = s.end;
        for (const k of ["rate", "pitch", "volume"]) this.number(k, s[k]);
        if (ranges.some((n) => n.start < s.end && n.end > s.end))
          throw Error("节点跨speak边界");
      }
      if (w.ssml.speakSegments.length && pos !== cp(w.synthesisText).length)
        throw Error("speak未覆盖全文");
      if (
        w.transition.pauseMs > 0 &&
        breaks.some((n) => n.offset === cp(w.synthesisText).length)
      )
        throw Error("尾部break和transition重复");
      for (const n of ranges)
        if (
          w.hotFix.pronunciation.some((h: Obj) => n.text.includes(h.word)) ||
          w.hotFix.replace.some((h: Obj) => n.text.includes(h.source))
        )
          throw Error("hotFix与SSML读法节点冲突");
      for (const h of w.hotFix.replace) {
        if (
          !w.synthesisText.includes(h.source) ||
          /[<>]/.test(h.source + h.target)
        )
          throw Error("hotFix替代文本无效");
        if (w.hotFix.replace.some((b: Obj) => h.target.includes(b.source)))
          throw Error("hotFix链式或循环替换禁止");
      }
      for (const c of w.executionConfidence) {
        this.capability(c.capability, c.level);
        for (const path of c.targetPaths) {
          if (!path.startsWith(`/windows/${index}/`))
            throw Error("执行说明路径越权");
          resolvePointer(x, path);
        }
        if (c.level === "E3" && !c.approximation?.confirmation)
          throw Error("E3近似须明确确认");
      }
      for (const lock of w.lockedFields) resolvePointer(w, lock);
      for (const h of w.pronunciation) {
        if (
          h.method === "phoneme" &&
          !w.ssml.nodes.some(
            (n: Obj) =>
              n.kind === "phoneme" &&
              n.start === h.start &&
              n.end === h.end &&
              n.text === h.word &&
              n.ph === h.ph &&
              n.alphabet === h.alphabet,
          )
        )
          throw Error("pronunciation与phoneme镜像不匹配");
        if (
          h.method === "hotFix" &&
          !w.hotFix.pronunciation.some(
            (n: Obj) => n.word === h.word && n.pinyin === h.ph,
          )
        )
          throw Error("pronunciation与hotFix镜像不匹配");
      }
      const builtLength = cp(
        buildRequest(x.engine.model, "placeholder", w).input.text,
      ).length;
      if (builtLength > hard.serializedTextCodePointMax)
        throw Error("SSML序列化后文本超过Profile限制");
    });
    if (end !== cp(x.originalText).length) throw Error("原稿覆盖不完整");
    for (const lock of x.lockedFields) resolvePointer(x, lock);
    if (x.rehearsalAnchors.length > hard.maxAnchors) throw Error("anchor过多");
    const anchors = new Set<string>();
    for (const a of x.rehearsalAnchors) {
      if (!ids.has(a.windowId) || anchors.has(a.anchorId))
        throw Error("无效或重复anchor");
      anchors.add(a.anchorId);
    }
    const notes = new Set<string>();
    for (const n of x.intentRanges) {
      if (notes.has(n.intentId)) throw Error("重复intentId");
      notes.add(n.intentId);
      this.intent(x, n);
    }
    for (const w of x.windows)
      if (!x.intentRanges.some((n: Obj) => n.target.windowId === w.windowId))
        throw Error("每个Window至少需要一个intentRange");
    for (const u of x.unresolvedItems)
      if (u.windowIds.some((id: string) => !ids.has(id)))
        throw Error("unresolved Window不存在");
    for (let i = 1; i < x.windows.length; i++)
      if (
        x.windows[i - 1].transition.pauseMs > 0 &&
        x.windows[i].ssml.nodes.some(
          (n: Obj) => n.kind === "break" && n.offset === 0,
        )
      )
        throw Error("跨窗口重复停顿");
    return x;
  }
  capability(name: string, level?: string) {
    const c = this.profile.modelCapabilities[name];
    if (!c) throw Error("未知能力：" + name);
    if (level && c.confidence && level !== c.confidence)
      throw Error(name + "的E级与Profile不匹配");
  }
  intent(x: Obj, n: Obj) {
    const index = x.windows.findIndex(
      (w: Obj) => w.windowId === n.target.windowId,
    );
    const w = x.windows[index],
      t = n.target;
    if (
      !w ||
      t.end <= t.start ||
      t.end > cp(w.synthesisText).length ||
      slice(w.synthesisText, t.start, t.end) !== t.targetText
    )
      throw Error("意图范围不匹配");
    for (const e of n.emphasisTerms)
      if (
        e.start < t.start ||
        e.end > t.end ||
        e.end <= e.start ||
        slice(w.synthesisText, e.start, e.end) !== e.text
      )
        throw Error("重点词范围错误");
    for (const a of n.adoptedExecution) {
      this.capability(a.capability, a.confidence);
      for (const ref of a.fieldRefs) {
        if (
          !ref.startsWith(`/windows/${index}/`) ||
          !/^\/windows\/\d+\/(execution|ssml|hotFix|transition|pronunciation)(\/|$)/.test(
            ref,
          )
        )
          throw Error("意图执行路径越权");
        resolvePointer(x, ref);
      }
    }
  }
  pending(w: Obj) {
    const caps = [
      "rate",
      "pitch",
      "volume",
      "seed",
      ...(w.execution.instruction ? ["instruction"] : []),
      ...(w.ssml.enabled ? ["ssml"] : []),
      ...(w.ssml.speakSegments.length
        ? [
            "parallelSpeak",
            "speakRangeRate",
            "speakRangePitch",
            "speakRangeVolume",
          ]
        : []),
      ...w.ssml.nodes.map(
        (n: Obj) =>
          ({ break: "break", sayAs: "sayAs", sub: "sub", phoneme: "phoneme" })[
            n.kind as string
          ],
      ),
      ...(w.hotFix.pronunciation.length || w.hotFix.replace.length
        ? ["hotFix"]
        : []),
    ];
    const pending = [...new Set(caps)].filter(
      (k) =>
        this.profile.productPolicy.capabilityAvailability[k]?.state !==
        "PRODUCT_ENABLED",
    );
    if (
      w.execution.instruction &&
      w.ssml.enabled &&
      this.profile.productPolicy.combinationAvailability?.instructionWithSsml
        ?.state !== "PRODUCT_ENABLED"
    )
      pending.push("instructionWithSsml");
    if (
      w.execution.instruction &&
      w.ssml.speakSegments.length &&
      this.profile.productPolicy.combinationAvailability
        ?.parallelSpeakWithInstruction?.state !== "PRODUCT_ENABLED"
    )
      pending.push("parallelSpeakWithInstruction");
    return pending;
  }
}
export function resolvePointer(x: Obj, path: string) {
  let value: any = x;
  for (const key of path.split("/").slice(1)) {
    const k = key.replaceAll("~1", "/").replaceAll("~0", "~");
    if (value == null || !Object.hasOwn(value, k))
      throw Error("不存在字段：" + path);
    value = value[k];
  }
  return value;
}
