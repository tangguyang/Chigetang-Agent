import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { Application } from "./application.ts";
import type {
  Account,
  AudioBatchInput,
  AudioBatchRecord,
  AudioGenerationConfig,
  AudioJobRecord,
  AudioRequest,
  Draft,
  InstructionHistory,
  InstructionPreset,
  Json,
  Model,
  Task,
  Voice,
  VoiceCloneParams,
} from "../../shared/types.ts";
import { COSYVOICE_MODEL_ID, voiceCompatible } from "../../shared/audioCatalog.ts";
import { videoStem } from "../../shared/filenames.ts";
import { retainDraftAssets } from "../../shared/draftCompatibility.ts";
import { normalizeDraft } from "../../shared/mentions.ts";
import { normalizeWorkspace, validateWorkspace } from "../../shared/accounts.ts";
import { HttpClient, object, secureURL } from "../providers/http.ts";
import { AlibabaProvider } from "../providers/adapters.ts";
import { AppError, toError } from "./errors.ts";
import { DownloadManager } from "./downloads.ts";
import { writableDirectory } from "./storage.ts";
import { brand } from "../../shared/brand.ts";

const MAX_REFERENCE_SECONDS = 20;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const DEFAULT_CLONE_PARAMS: VoiceCloneParams = {
  languageHints: ["zh"],
  maxPromptAudioLength: 20,
  enablePreprocess: false,
  enableVolumeNormalization: false,
};

const BUILTIN_PRESETS = [
  ["自然聊天", "延续参考声线，像跟熟人聊天，语气松弛，停顿自然。"],
  ["去播音腔", "保持本人说话习惯，随口表达，不字正腔圆，不刻意拖尾。"],
  ["低调从容", "像年轻企业负责人私下交流，语气从容，不刻意压低嗓音。"],
  ["真诚分享", "像分享自己的亲身经历，语气真诚，表达自然，不朗诵。"],
  ["生活化口播", "像日常对话，有轻微口语起伏，不要正式解说感。"],
  ["先松后紧", "开头松弛，中段逐渐认真，结尾自然加重语气。"],
  ["先疑问后确认", "先带一点疑问，短暂停顿，再用确定的语气解释。"],
  ["克制反问", "像面对朋友反问，句尾自然上扬，不咄咄逼人。"],
  ["认真提醒", "像提醒身边人，先平和说明，再强调关键事实，不说教。"],
  ["情绪爆点", "前半段收住情绪，最后一句明显加强力度，不喊叫。"],
  ["年轻总裁", "像年轻企业负责人交流，冷静自信，有亲和力，不摆架子。"],
  ["坚定决策", "语气明确，句子干脆，重要信息加重，不做演讲式表达。"],
  ["冷静分析", "像面对面分析问题，语速平稳，逻辑清晰，少夸张起伏。"],
  ["温和鼓励", "像鼓励熟悉的人，语气温和，逐渐坚定，不煽情。"],
  ["轻松调侃", "带一点自然笑意，语气轻松，像熟人之间开玩笑。"],
  ["开头抓注意", "第一句直接进入重点，语气有精神，不突然拔高音调。"],
  ["观点输出", "像表达自己的判断，先说明，再强调核心观点，不说教。"],
  ["产品分享", "像分享自己用过的东西，真实自然，不用促销播音腔。"],
  ["强反转", "前半段平静铺垫，转折处短暂停顿，后半段明显加强。"],
  ["自然收尾", "最后一句自然收住，留一点口语余韵，不刻意拖长尾音。"],
] as const;

function instructionLength(value: string) {
  return [...value].reduce(
    (sum, char) => sum + (/\p{Script=Han}/u.test(char) ? 2 : 1),
    0,
  );
}

function detailedError(title: string, detected: string, reason: string, solution: string) {
  return new Error(
    `${title}\n实际检测：${detected}\n失败原因：${reason}\n解决方法：${solution}`,
  );
}

function providerMessage(kind: "clone" | "tts", code: string, message: string) {
  const raw = `${code} ${message}`.toLowerCase();
  const action = kind === "clone" ? "创建音色" : "生成配音";
  if (/401|unauthorized|invalid.?api.?key|api.?key/.test(raw))
    return `${action}失败\n实际检测：API 身份验证未通过（${code || "无错误码"}）\n失败原因：API Key 无效、已失效或不属于北京地域。\n解决方法：在“模型与 API”中检查北京地域连接后重试。`;
  if (/429|rate.?limit|throttl/.test(raw))
    return `${action}受限\n实际检测：服务端限流（${code || "429"}）\n失败原因：短时间请求过多。\n解决方法：稍后只重试失败项，已成功结果不会丢失。`;
  if (/voice.*not.*found|voice_not_found/.test(raw))
    return `音色不可用\n实际检测：voice_id 不存在或无法访问（${code || "无错误码"}）\n失败原因：音色与账户、地域或模型不匹配。\n解决方法：选择当前北京连接下由 CosyVoice 3.5 Plus 创建的有效音色。`;
  if (/region|model.*not|unsupported/.test(raw))
    return `模型或地域不兼容\n实际检测：${code || message || "服务端拒绝请求"}\n失败原因：CosyVoice 3.5 Plus 目前仅接入北京地域。\n解决方法：切换北京地域 API 连接并确认模型权限。`;
  return `${action}失败\n实际检测：${code || "服务端返回失败"}\n失败原因：${message || "服务端未提供详细说明"}\n解决方法：核对 request_id、模型权限、账户余额和输入参数后重试。`;
}

export class AudioService {
  app: Application;
  active = new Set<string>();
  cloning = 0;
  stopped = false;
  timer?: NodeJS.Timeout;

  constructor(app: Application) {
    this.app = app;
    this.seedPresets();
  }

  private seedPresets() {
    if (this.app.db.one<{ n: number }>("SELECT count(*) n FROM cosy_presets")?.n) return;
    const now = new Date().toISOString();
    this.app.db.transaction(() => {
      BUILTIN_PRESETS.forEach(([name, content], index) => {
        if (instructionLength(content) > 100)
          throw new Error(`内置情绪预设“${name}”超过官方字符限制。`);
        const preset: InstructionPreset = {
          id: `builtin-${String(index + 1).padStart(2, "0")}`,
          name,
          content,
          notes: "产品内置候选预设，实际效果请以试听为准。",
          favorite: false,
          position: index + 1,
          builtin: true,
          createdAt: now,
          updatedAt: now,
        };
        this.app.db.run(
          "INSERT INTO cosy_presets VALUES(?,?,?,?,?)",
          preset.id,
          preset.position,
          0,
          1,
          JSON.stringify(preset),
        );
      });
    });
  }

  voices(): Voice[] {
    return this.app.db
      .all<{ data: string }>(
        "SELECT data FROM cosy_voices ORDER BY pinned DESC,COALESCE(pin_order,2147483647),rowid DESC",
      )
      .map((row) => JSON.parse(row.data) as Voice);
  }

  saveVoice(voice: Voice) {
    if (voice.model !== COSYVOICE_MODEL_ID)
      throw new Error("只允许保存 CosyVoice 3.5 Plus 音色。请重新创建音色。");
    this.app.db.transaction(() => {
      if (voice.isDefault)
        for (const item of this.voices().filter(
          (item) =>
            item.id !== voice.id &&
            item.accountId === voice.accountId &&
            item.isDefault,
        )) {
          item.isDefault = false;
          this.app.db.run(
            "UPDATE cosy_voices SET is_default=0,data=? WHERE id=?",
            JSON.stringify(item),
            item.id,
          );
        }
      this.app.db.run(
        "INSERT INTO cosy_voices VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,model_id=excluded.model_id,pinned=excluded.pinned,pin_order=excluded.pin_order,is_default=excluded.is_default,data=excluded.data",
        voice.id,
        voice.accountId,
        voice.model,
        Number(voice.pinned),
        voice.pinOrder,
        Number(voice.isDefault),
        JSON.stringify(voice),
      );
    });
    this.app.changed();
    return voice;
  }

  updateVoice(id: string, patch: Partial<Voice>) {
    const current = this.voices().find((voice) => voice.id === id);
    if (!current) throw new Error("音色不存在，请刷新列表。");
    return this.saveVoice({
      ...current,
      name: (patch.name ?? current.name).trim() || current.name,
      notes: patch.notes ?? current.notes,
      pinned: patch.pinned ?? current.pinned,
      pinOrder:
        patch.pinned === false
          ? null
          : patch.pinned === true && current.pinOrder === null
            ? this.nextPinOrder()
            : current.pinOrder,
      isDefault: patch.isDefault ?? current.isDefault,
    });
  }

  private nextPinOrder() {
    return this.app.db.one<{ n: number }>(
      "SELECT COALESCE(MAX(pin_order),0)+1 n FROM cosy_voices",
    )?.n ?? 1;
  }

  reorderVoices(ids: string[]) {
    const pinned = this.voices().filter((voice) => voice.pinned);
    if (ids.length !== pinned.length || ids.some((id) => !pinned.some((voice) => voice.id === id)))
      throw new Error("置顶音色顺序已变化，请刷新后重试。");
    this.app.db.transaction(() => {
      ids.forEach((id, index) => {
        const voice = pinned.find((item) => item.id === id)!;
        voice.pinOrder = index + 1;
        this.app.db.run(
          "UPDATE cosy_voices SET pin_order=?,data=? WHERE id=?",
          voice.pinOrder,
          JSON.stringify(voice),
          id,
        );
      });
    });
    this.app.changed();
    return this.voices();
  }

  async removeVoice(id: string) {
    const voice = this.voices().find((item) => item.id === id);
    if (!voice) throw new Error("音色不存在，请刷新列表。");
    this.app.db.run("DELETE FROM cosy_voices WHERE id=?", id);
    const referencedElsewhere = this.voices().some(
      (item) => item.referencePath === voice.referencePath,
    );
    if (
      !referencedElsewhere &&
      voice.referencePath &&
      resolve(voice.referencePath).startsWith(
        resolve(this.app.root, "voices", "references") + sep,
      )
    )
      await unlink(voice.referencePath).catch(() => {});
    this.app.changed();
    return true;
  }

  presets(): InstructionPreset[] {
    return this.app.db
      .all<{ data: string }>("SELECT data FROM cosy_presets ORDER BY position")
      .map((row) => JSON.parse(row.data) as InstructionPreset);
  }

  savePreset(input: Partial<InstructionPreset>) {
    const current = input.id ? this.presets().find((preset) => preset.id === input.id) : undefined;
    const content = String(input.content ?? current?.content ?? "").trim();
    const count = instructionLength(content);
    if (!content || count > 100)
      throw detailedError(
        "情绪指令无法保存",
        `${count} / 100 字符`,
        !content ? "指令内容为空。" : `超过限制 ${count - 100} 字符。`,
        "修改内容后再保存；软件不会自动截断。",
      );
    const now = new Date().toISOString();
    const preset: InstructionPreset = {
      id: current?.id ?? randomUUID(),
      name: String(input.name ?? current?.name ?? "新预设").trim() || "新预设",
      content,
      notes: String(input.notes ?? current?.notes ?? ""),
      favorite: input.favorite ?? current?.favorite ?? false,
      position:
        current?.position ??
        (this.app.db.one<{ n: number }>(
          "SELECT COALESCE(MAX(position),0)+1 n FROM cosy_presets",
        )?.n ?? 1),
      builtin: current?.builtin ?? false,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.app.db.run(
      "INSERT INTO cosy_presets VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,favorite=excluded.favorite,builtin=excluded.builtin,data=excluded.data",
      preset.id,
      preset.position,
      Number(preset.favorite),
      Number(preset.builtin),
      JSON.stringify(preset),
    );
    this.app.changed();
    return preset;
  }

  deletePreset(id: string) {
    this.app.db.run("DELETE FROM cosy_presets WHERE id=?", id);
    this.reorderPresets(this.presets().map((preset) => preset.id));
    return true;
  }

  reorderPresets(ids: string[]) {
    const presets = this.presets();
    if (ids.length !== presets.length || ids.some((id) => !presets.some((preset) => preset.id === id)))
      throw new Error("预设顺序已变化，请刷新后重试。");
    this.app.db.transaction(() => {
      this.app.db.run("UPDATE cosy_presets SET position=position+10000");
      ids.forEach((id, index) => {
        const preset = presets.find((item) => item.id === id)!;
        preset.position = index + 1;
        preset.updatedAt = new Date().toISOString();
        this.app.db.run(
          "UPDATE cosy_presets SET position=?,data=? WHERE id=?",
          preset.position,
          JSON.stringify(preset),
          id,
        );
      });
    });
    this.app.changed();
    return this.presets();
  }

  history(): InstructionHistory[] {
    return this.app.db
      .all<{ data: string }>(
        "SELECT data FROM cosy_instruction_history ORDER BY last_used_at DESC",
      )
      .map((row) => JSON.parse(row.data) as InstructionHistory);
  }

  updateHistory(id: string, favorite: boolean) {
    const item = this.history().find((entry) => entry.id === id);
    if (!item) throw new Error("历史指令不存在，请刷新列表。");
    item.favorite = favorite;
    this.app.db.run(
      "UPDATE cosy_instruction_history SET favorite=?,data=? WHERE id=?",
      Number(favorite),
      JSON.stringify(item),
      id,
    );
    this.app.changed();
    return item;
  }

  deleteHistory(id: string) {
    this.app.db.run("DELETE FROM cosy_instruction_history WHERE id=?", id);
    this.app.changed();
    return true;
  }

  private recordInstruction(content: string, configName: string, taskId: string) {
    if (!content.trim()) return;
    const existing = this.app.db.one<{ id: string; data: string }>(
      "SELECT id,data FROM cosy_instruction_history WHERE content=?",
      content,
    );
    const now = new Date().toISOString();
    const item: InstructionHistory = existing
      ? { ...(JSON.parse(existing.data) as InstructionHistory), configName, taskId, lastUsedAt: now }
      : { id: randomUUID(), content, favorite: false, configName, taskId, lastUsedAt: now };
    this.app.db.run(
      "INSERT INTO cosy_instruction_history VALUES(?,?,?,?,?) ON CONFLICT(content) DO UPDATE SET favorite=excluded.favorite,last_used_at=excluded.last_used_at,data=excluded.data",
      item.id,
      item.content,
      Number(item.favorite),
      item.lastUsedAt,
      JSON.stringify(item),
    );
  }

  private resolve(accountId: string) {
    const model = this.app.models().find(
      (item) => item.id === COSYVOICE_MODEL_ID && item.enabled && item.type === "audio",
    );
    if (!model?.audio)
      throw new Error("CosyVoice 3.5 Plus 当前不可用，请检查模型初始化状态。");
    const account = this.app.credentials.list().find(
      (item) =>
        item.id === accountId &&
        item.enabled &&
        item.providerId === "alibaba" &&
        item.region === "cn-beijing",
    );
    if (!account)
      throw detailedError(
        "API 连接不可用",
        accountId ? "未找到可用的北京地域连接" : "未选择 API 连接",
        "CosyVoice 3.5 Plus 当前仅接入北京地域。",
        "在“模型与 API”中启用北京地域连接后重试。",
      );
    return { model, account };
  }

  private async request(
    model: Model,
    account: Account,
    kind: "tts" | "clone",
    body: Json,
    headers?: Record<string, string>,
  ) {
    const workspace = normalizeWorkspace(account.workspaceId || "");
    validateWorkspace(workspace);
    const url = model.audio!.endpoints[account.region][kind].replace("{workspace}", workspace);
    secureURL(url);
    const result = object(
      await new HttpClient(this.app.fetcher, this.app.logger, 0).request(
        url,
        this.app.credentials.getKey(account.id),
        { method: "POST", body, headers, paidSubmit: true },
      ),
    );
    if (result.code && result.code !== "Success")
      throw new AppError(
        "ProviderError",
        providerMessage(kind, String(result.code), String(result.message || "")),
      );
    return result;
  }

  private async validateReference(assetId: string) {
    let asset = this.app.assets.get(assetId);
    if (asset.kind !== "audio")
      throw detailedError(
        "参考文件格式错误",
        `检测到 ${asset.kind} 文件`,
        "复刻音色只接受音频。",
        "请选择 WAV、MP3 或 M4A 音频。",
      );
    let path: string;
    try {
      path = await this.app.assets.verify(asset);
      asset = { ...asset, ...(await this.app.assets.probe(path, "audio", asset.id)) };
    } catch (error) {
      throw detailedError(
        "音频无法解码",
        asset.name,
        error instanceof Error ? error.message : String(error),
        "重新导出有效的 WAV、MP3 或 M4A 文件后再上传。",
      );
    }
    const extension = extname(path).toLowerCase();
    if (![".wav", ".mp3", ".m4a"].includes(extension))
      throw detailedError(
        "参考文件格式错误",
        extension || "无扩展名",
        "当前工作流仅支持 WAV、MP3、M4A。",
        "请重新导出为支持的格式。",
      );
    const file = await stat(path);
    if (file.size > MAX_REFERENCE_BYTES)
      throw detailedError(
        "参考音频文件过大",
        `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        "当前工作流上限为 10 MB。",
        "降低码率或缩短录音后重试。",
      );
    const duration = Number(asset.duration || 0);
    if (!duration)
      throw detailedError(
        "无法读取音频时长",
        asset.name,
        "文件元数据缺失或无法解码。",
        "重新导出音频后再上传。",
      );
    if (duration > MAX_REFERENCE_SECONDS)
      throw detailedError(
        "参考音频超过当前上限",
        `当前音频：${duration.toFixed(1)} 秒；当前工作流上限：20.0 秒`,
        "本产品不会静默截取前 20 秒。",
        "请先裁剪至 20 秒以内，再创建音色。",
      );
    if (duration < 3)
      throw detailedError(
        "参考音频短于接口下限",
        `当前音频：${duration.toFixed(1)} 秒；官方下限：3.0 秒`,
        "样本过短，接口不会接受。",
        "请提供 3–20 秒音频，推荐 10–20 秒。",
      );
    const sampleRate = Number(asset.sampleRate || 0);
    if (!sampleRate)
      throw detailedError(
        "无法读取采样率",
        asset.name,
        "音频采样率元数据不可用。",
        "重新导出为常见采样率的 WAV、MP3 或 M4A。",
      );
    if (!asset.channels || asset.channels > 2)
      throw detailedError(
        "参考音频声道不符合要求",
        `${asset.channels || "未知"} 声道`,
        "当前工作流只接受单声道或双声道音频。",
        "重新导出为单声道或双声道后重试。",
      );
    return { asset, path, duration, sampleRate };
  }

  async clone(input: {
    accountId: string;
    assetId: string;
    name: string;
    notes?: string;
    languageHints?: string[];
    maxPromptAudioLength?: number;
    enablePreprocess?: boolean;
    enableVolumeNormalization?: boolean;
    sourceVoiceId?: string | null;
    sourceTaskId?: string | null;
    sourceConfigId?: string | null;
    sourceAudioPath?: string | null;
  }) {
    const { model, account } = this.resolve(input.accountId);
    if (!input.name.trim())
      throw detailedError(
        "音色名称为空",
        "未输入名称",
        "无法建立可管理的音色版本。",
        "请输入音色名称后重试。",
      );
    const params: VoiceCloneParams = {
      languageHints: input.languageHints?.length ? [input.languageHints[0]] : ["zh"],
      maxPromptAudioLength: input.maxPromptAudioLength ?? 20,
      enablePreprocess: input.enablePreprocess ?? false,
      enableVolumeNormalization: input.enableVolumeNormalization ?? false,
    };
    if (
      !Number.isFinite(params.maxPromptAudioLength) ||
      params.maxPromptAudioLength < 3 ||
      params.maxPromptAudioLength > MAX_REFERENCE_SECONDS
    )
      throw detailedError(
        "参考音频最大使用时长无效",
        `${params.maxPromptAudioLength} 秒`,
        "官方合法范围为 3–30 秒，本产品工作流固定不超过 20 秒。",
        "请输入 3–20 秒。",
      );
    const source = await this.validateReference(input.assetId);
    const folder = join(this.app.root, "voices", "references");
    await mkdir(folder, { recursive: true });
    const ownedPath = join(folder, `${randomUUID()}${extname(source.path).toLowerCase()}`);
    await copyFile(source.path, ownedPath);
    const makeDefault = this.voices().length === 0;
    const provisional: Voice = {
      id: randomUUID(),
      name: input.name.trim(),
      providerId: "alibaba",
      region: "cn-beijing",
      model: COSYVOICE_MODEL_ID,
      accountId: account.id,
      voiceId: "",
      kind: "clone",
      createdAt: new Date().toISOString(),
      referenceAssetId: "",
      referencePath: ownedPath,
      referenceName: source.asset.name,
      referenceDuration: source.duration,
      notes: input.notes || "",
      favorite: false,
      pinned: false,
      pinOrder: null,
      isDefault: false,
      status: "pending",
      createParams: params,
      sourceVoiceId: input.sourceVoiceId ?? null,
      sourceTaskId: input.sourceTaskId ?? null,
      sourceConfigId: input.sourceConfigId ?? null,
      sourceAudioPath: input.sourceAudioPath ?? null,
      lastError: null,
    };
    try {
      this.saveVoice(provisional);
    } catch (error) {
      await unlink(ownedPath).catch(() => {});
      throw error;
    }
    let requestStarted = false;
    this.cloning++;
    try {
      const provider = this.app.providers().find((item) => item.id === model.providerId)!;
      const upload = new AlibabaProvider(new HttpClient(this.app.fetcher, this.app.logger, 0));
      const snapshot = {
        draft: {
          name: input.name,
          modelId: model.id,
          accountId: account.id,
          projectId: null,
          prompt: "",
          params: {},
          assets: [],
          outputDir: this.app.settings().audioDir!,
        },
        model,
        provider,
        account,
        assets: [],
        price: model.price,
        estimatedCost: { amount: null, currency: "CNY", kind: "unknown" as const, note: "" },
        appVersion: brand.version,
        createdAt: new Date().toISOString(),
      };
      const url = await upload.upload(
        snapshot,
        this.app.credentials.getKey(account.id),
        { ...source.asset, originalPath: ownedPath, managedPath: ownedPath },
      );
      requestStarted = true;
      const result = object(
        await this.request(
          model,
          account,
          "clone",
          {
            model: "voice-enrollment",
            input: {
              action: "create_voice",
              target_model: COSYVOICE_MODEL_ID,
              prefix: `v${randomUUID().replaceAll("-", "").slice(0, 9)}`,
              url,
              language_hints: params.languageHints,
              max_prompt_audio_length: params.maxPromptAudioLength,
              enable_preprocess: params.enablePreprocess,
              // The HTTP API requires this field as "true"/"false"; the SDK
              // accepts a boolean. This service uses HTTP directly.
              enable_volume_normalization: String(params.enableVolumeNormalization),
            },
          },
          url.startsWith("oss:") ? { "X-DashScope-OssResourceResolve": "enable" } : undefined,
        ),
      );
      const output = object(result.output ?? {});
      const voiceId = output.voice_id ?? output.voice;
      if (typeof voiceId !== "string" || !voiceId)
        throw new AppError(
          "SubmissionUnknown",
          "创建请求已发送，但未返回 voice_id。请先在百炼控制台核对，避免重复创建。",
        );
      provisional.voiceId = voiceId;
      provisional.status = "unknown";
      provisional.lastError = "已取得 voice_id，正在完成本地登记。";
      this.saveVoice(provisional);
      let status: Voice["status"] = "ready";
      let lastError: string | null = null;
      try {
        const queried = await this.request(model, account, "clone", {
          model: "voice-enrollment",
          input: { action: "query_voice", voice_id: voiceId },
        });
        const detail = object(queried.output ?? {});
        const raw = String(
          detail.status ?? object(detail.voice ?? {}).status ?? "ready",
        ).toLowerCase();
        status = /fail|error|unavailable/.test(raw)
          ? "unavailable"
          : /pending|process|creating/.test(raw)
            ? "pending"
            : "ready";
      } catch (error) {
        status = "unknown";
        lastError = `音色已创建并保存 voice_id，但状态查询失败：${toError(error).message}`;
      }
      const imported = await this.app.assets.import(ownedPath, false);
      return this.saveVoice({
        ...provisional,
        voiceId,
        referenceAssetId: imported.asset.id,
        isDefault: makeDefault,
        status,
        lastError,
      });
    } catch (error) {
      if (requestStarted) {
        provisional.status = "unknown";
        provisional.lastError = `音色创建结果需核对：${toError(error).message}`;
        try {
          this.saveVoice(provisional);
        } catch (saveError) {
          this.app.logger.write("error", "clone_evidence_save_failed", {
            message: toError(saveError).message,
          });
        }
      } else {
        this.app.db.run("DELETE FROM cosy_voices WHERE id=?", provisional.id);
        await unlink(ownedPath).catch(() => {});
      }
      throw error;
    } finally {
      this.cloning--;
    }
  }

  private validateConfig(config: AudioGenerationConfig) {
    const count = instructionLength(config.instruction);
    if (count > 100)
      throw detailedError(
        `配置“${config.name}”的情绪指令过长`,
        `${count} / 100 字符`,
        `超过限制 ${count - 100} 字符。`,
        "修改指令后再生成；软件不会自动截断。",
      );
    const numeric: [string, number, number, number, boolean][] = [
      ["rate", config.rate, 0.5, 2, false],
      ["pitch", config.pitch, 0.5, 2, false],
      ["volume", config.volume, 0, 100, true],
      ["seed", config.seed, 0, 65535, true],
    ];
    for (const [name, value, min, max, integer] of numeric)
      if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
        throw detailedError(
          "生成参数越界",
          `${config.name} · ${name}=${String(value)}`,
          `合法范围为 ${min}–${max}${integer ? " 的整数" : ""}。`,
          "恢复默认值或输入合法数值后重试。",
        );
    if (config.format !== "wav" || config.sampleRate !== 24000)
      throw detailedError(
        "输出参数不受支持",
        `${config.format} / ${config.sampleRate}Hz`,
        "当前专业工作流固定输出 24kHz WAV。",
        "恢复默认输出参数后重试。",
      );
  }

  async createBatch(input: AudioBatchInput) {
    if (!input.requestId) throw new Error("提交标识缺失，请重新点击批量生成。");
    const duplicate = this.app.db.one<{ id: string }>(
      "SELECT id FROM cosy_batches WHERE request_id=?",
      input.requestId,
    );
    if (duplicate) return this.batch(duplicate.id);
    const { model, account } = this.resolve(input.accountId);
    const voice = this.voices().find((item) => item.id === input.voiceId);
    if (!voice || !voice.voiceId || !voiceCompatible(voice, model, account))
      throw detailedError(
        "音色不可用",
        input.voiceId || "未选择音色",
        "音色不存在，或与 CosyVoice 3.5 Plus、北京地域、当前 API 连接不匹配。",
        "重新选择有效音色后生成。",
      );
    if (voice.status === "unavailable")
      throw detailedError(
        "音色状态不可用",
        voice.voiceId,
        voice.lastError || "远端音色不可用。",
        "重新创建音色，或选择其他可用音色。",
      );
    const textLength = [...input.text].length;
    if (!input.text.trim() || textLength > 20000)
      throw detailedError(
        "共享台词不符合要求",
        `${textLength} / 20000 字符`,
        !input.text.trim() ? "台词为空。" : `超过官方上限 ${textLength - 20000} 字符。`,
        "修改台词后再生成；软件不会自动改写或截断。",
      );
    if (!input.configs.length || input.configs.length > 10)
      throw detailedError(
        "生成配置数量无效",
        `${input.configs.length} 套`,
        input.configs.length > 10 ? "当前最多支持 10 套生成配置。" : "至少需要 1 套配置。",
        "删除多余配置或新增一套配置后重试。",
      );
    if (new Set(input.configs.map((config) => config.id)).size !== input.configs.length)
      throw new Error("生成配置 ID 重复，请复制或新增配置后重试。");
    input.configs.forEach((config) => this.validateConfig(config));
    const directory = this.app.settings().audioDir!;
    await writableDirectory(directory);
    const secondCheck = this.app.db.one<{ id: string }>(
      "SELECT id FROM cosy_batches WHERE request_id=?",
      input.requestId,
    );
    if (secondCheck) return this.batch(secondCheck.id);
    const now = new Date().toISOString();
    const batchId = randomUUID();
    const batchData = {
      id: batchId,
      name: input.name.trim() || `批量配音 ${now.slice(5, 16).replace("T", " ")}`,
      text: input.text,
      voiceId: voice.id,
      voiceName: voice.name,
      accountId: account.id,
      createdAt: now,
    };
    const created: { task: Task; job: AudioJobRecord }[] = [];
    input.configs.forEach((config, index) => {
      const taskId = randomUUID();
      const request: AudioRequest = {
        name: `${batchData.name} · ${config.name}`,
        text: input.text,
        instruction: config.instruction,
        modelId: COSYVOICE_MODEL_ID,
        accountId: account.id,
        voiceId: voice.id,
        format: "wav",
        sampleRate: 24000,
        params: { rate: config.rate, pitch: config.pitch, volume: config.volume, seed: config.seed },
        durationMode: "auto",
        configId: config.id,
        configName: config.name,
        batchId,
      };
      const draft: Draft = {
        name: request.name,
        modelId: model.id,
        accountId: account.id,
        projectId: null,
        prompt: input.text,
        params: {
          audioRequest: JSON.stringify({
            ...request,
            voiceName: voice.name,
            remoteVoice: voice.voiceId,
          }),
        },
        assets: [],
        outputDir: directory,
      };
      const cost = {
        amount: null,
        currency: "CNY",
        kind: "unknown" as const,
        note: "费用以百炼实际账单为准（当前无法准确预估）",
      };
      const task: Task = {
        id: taskId,
        groupId: batchId,
        version: index + 1,
        parentTaskId: null,
        parentVersionId: null,
        name: draft.name,
        type: "audio",
        outputs: [],
        status: "Queued",
        snapshot: {
          draft,
          model,
          provider: this.app.providers().find((item) => item.id === model.providerId)!,
          account,
          assets: [],
          price: model.price,
          estimatedCost: cost,
          appVersion: brand.version,
          createdAt: now,
        },
        apiTaskId: null,
        createdAt: now,
        submittedAt: null,
        completedAt: null,
        updatedAt: now,
        outputPath: null,
        resultUrl: null,
        rawResult: null,
        error: null,
        errorCode: null,
        downloadStatus: "none",
        cost,
        progress: null,
        nextPollAt: 0,
        retryCount: 0,
        deletedAt: null,
      };
      const job: AudioJobRecord = {
        id: randomUUID(),
        batchId,
        taskId,
        configIndex: index,
        config: { ...config },
        status: "pending",
        requestId: null,
        outputPath: null,
        assetId: null,
        duration: null,
        error: null,
        createdAt: now,
        completedAt: null,
      };
      created.push({ task, job });
    });
    this.app.db.transaction(() => {
      this.app.db.run(
        "INSERT INTO cosy_batches VALUES(?,?,?,?)",
        batchId,
        input.requestId,
        now,
        JSON.stringify(batchData),
      );
      for (const { task, job } of created) {
        this.app.db.run("INSERT INTO tasks VALUES(?,?,?)", task.id, task.name, now);
        const { snapshot, ...mutable } = task;
        this.app.db.run(
          "INSERT INTO task_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          task.id,
          task.id,
          null,
          null,
          task.version,
          task.status,
          model.providerId,
          model.id,
          account.id,
          null,
          now,
          null,
          JSON.stringify(mutable),
        );
        this.app.db.run("INSERT INTO task_snapshots VALUES(?,?)", task.id, JSON.stringify(snapshot));
        this.app.db.run("INSERT INTO price_snapshots VALUES(?,?)", task.id, JSON.stringify(model.price));
        this.app.db.run(
          "INSERT INTO cosy_jobs VALUES(?,?,?,?,?,?)",
          job.id,
          batchId,
          task.id,
          job.configIndex,
          job.status,
          JSON.stringify(job),
        );
      }
    });
    created.forEach(({ task }) => this.app.tasks.save(task));
    this.app.changed();
    void this.tick();
    return this.batch(batchId);
  }

  batches(): AudioBatchRecord[] {
    return this.app.db
      .all<{ id: string }>(
        "SELECT b.id FROM cosy_batches b WHERE EXISTS (SELECT 1 FROM cosy_jobs j JOIN task_versions v ON v.id=j.task_id WHERE j.batch_id=b.id AND v.deleted_at IS NULL) ORDER BY b.created_at DESC",
      )
      .map((row) => this.batch(row.id));
  }

  batch(id: string): AudioBatchRecord {
    const row = this.app.db.one<{ data: string }>("SELECT data FROM cosy_batches WHERE id=?", id);
    if (!row) throw new Error("批量任务不存在，请刷新历史记录。");
    const data = JSON.parse(row.data) as Omit<AudioBatchRecord, "jobs">;
    const jobs = this.app.db
      .all<{ data: string }>(
        "SELECT j.data FROM cosy_jobs j JOIN task_versions v ON v.id=j.task_id WHERE j.batch_id=? AND v.deleted_at IS NULL ORDER BY j.config_index",
        id,
      )
      .map((item) => JSON.parse(item.data) as AudioJobRecord);
    return { ...data, jobs };
  }

  renameJob(id: string, name: string) {
    const row = this.app.db.one<{ data: string }>(
      "SELECT data FROM cosy_jobs WHERE id=?",
      id,
    );
    if (!row) throw new Error("音频成品不存在，请刷新任务列表。");
    const job = JSON.parse(row.data) as AudioJobRecord;
    const next = name.trim();
    if (!next) throw new Error("音频名称不能为空。");
    if ([...next].length > 80 || /[\\/:*?"<>|\r\n]/.test(next))
      throw new Error("音频名称最多 80 个字符，且不能包含路径特殊字符。");
    job.config = { ...job.config, name: next };
    const task = this.app.tasks.get(job.taskId);
    task.name = next;
    const { snapshot: _snapshot, ...mutable } = task;
    this.app.db.transaction(() => {
      this.app.db.run(
        "UPDATE cosy_jobs SET status=?,data=? WHERE id=?",
        job.status,
        JSON.stringify(job),
        job.id,
      );
      this.app.db.run(
        "UPDATE task_versions SET data=? WHERE id=?",
        JSON.stringify(mutable),
        task.id,
      );
      this.app.db.run("UPDATE tasks SET name=? WHERE id=?", next, task.groupId);
    });
    this.app.changed();
    return job;
  }

  deleteJob(id: string) {
    const row = this.app.db.one<{ data: string }>(
      "SELECT data FROM cosy_jobs WHERE id=?",
      id,
    );
    if (!row) throw new Error("音频成品不存在，请刷新任务列表。");
    const job = JSON.parse(row.data) as AudioJobRecord;
    const task = this.app.tasks.get(job.taskId);
    if (
      this.active.has(task.id) ||
      ["pending", "generating"].includes(job.status) ||
      ["Queued", "Uploading", "Submitting", "Processing", "Downloading"].includes(
        task.status,
      )
    )
      throw new Error("音频正在执行，请完成后再删除记录。");
    const deletedAt = new Date().toISOString();
    task.deletedAt = deletedAt;
    const { snapshot: _snapshot, ...mutable } = task;
    this.app.db.transaction(() => {
      this.app.db.run(
        "UPDATE task_versions SET deleted_at=?,data=? WHERE id=?",
        deletedAt,
        JSON.stringify(mutable),
        task.id,
      );
      this.app.db.run("DELETE FROM cosy_jobs WHERE id=?", id);
    });
    this.app.changed();
    return true;
  }

  retryFailed(batchId: string) {
    const batch = this.batch(batchId);
    const failed = batch.jobs.filter((job) => job.status === "failed");
    if (!failed.length) throw new Error("当前批次没有失败项。");
    const pairs = failed.map((job) => ({
      job,
      task: this.app.tasks.get(job.taskId),
    }));
    if (
      pairs.some(
        ({ task }) =>
          task.errorCode === "SubmissionUnknown" &&
          !task.apiTaskId &&
          !task.resultUrl,
      )
    )
      throw new Error(
        "有任务的云端提交结果未知，请先在控制台核对，避免再次付费。",
      );
    this.app.db.transaction(() => {
      for (const { job, task } of pairs) {
        task.status = task.resultUrl ? "Downloading" : "Queued";
        task.error = null;
        task.errorCode = null;
        task.downloadStatus = task.resultUrl ? "pending" : "none";
        task.retryCount += 1;
        const { snapshot: _snapshot, ...mutable } = task;
        this.app.db.run(
          "UPDATE task_versions SET status=?,data=? WHERE id=?",
          task.status,
          JSON.stringify(mutable),
          task.id,
        );
        job.status = "pending";
        job.error = null;
        this.app.db.run(
          "UPDATE cosy_jobs SET status=?,data=? WHERE id=?",
          job.status,
          JSON.stringify(job),
          job.id,
        );
      }
    });
    this.app.changed();
    void this.tick();
    return this.batch(batchId);
  }

  private saveJob(job: AudioJobRecord) {
    this.app.db.run(
      "UPDATE cosy_jobs SET status=?,data=? WHERE id=?",
      job.status,
      JSON.stringify(job),
      job.id,
    );
    this.app.changed();
  }

  private jobForTask(taskId: string) {
    const row = this.app.db.one<{ data: string }>(
      "SELECT data FROM cosy_jobs WHERE task_id=?",
      taskId,
    );
    return row ? (JSON.parse(row.data) as AudioJobRecord) : null;
  }

  start() {
    for (const row of this.app.db.all<{ id: string }>(
      "SELECT id FROM task_versions WHERE json_extract(data,'$.type')='audio' AND status IN ('Submitting','Processing','Downloading')",
    )) {
      const task = this.app.tasks.get(row.id);
      task.status = task.resultUrl ? "Downloading" : "Paused";
      task.error = task.resultUrl
        ? null
        : "上次配音提交被中断，云端可能已计费。请核对控制台后只重试失败项。";
      this.app.tasks.save(task);
      const job = this.jobForTask(task.id);
      if (job) {
        job.status = task.resultUrl ? "generating" : "uncertain";
        job.error = task.error;
        this.saveJob(job);
      }
    }
    this.timer = setInterval(
      () =>
        void this.tick().catch((error) =>
          this.app.logger.write("error", "audio_queue_tick", {
            message: toError(error).message,
          }),
        ),
      750,
    );
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.stopped || this.active.size || this.app.settings().queuePaused) return;
    const row = this.app.db.one<{ id: string }>(
      "SELECT id FROM task_versions WHERE json_extract(data,'$.type')='audio' AND status IN ('Queued','Downloading') AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
    );
    if (!row) return;
    const task = this.app.tasks.get(row.id);
    const settings = this.app.settings();
    const reserved = this.app.db.all<{ account_id: string; provider_id: string }>(
      "SELECT account_id,provider_id FROM task_versions WHERE status IN ('Uploading','Submitting','Processing','Downloading') AND COALESCE(json_extract(data,'$.type'),'video')<>'video-group' AND id<>?",
      task.id,
    );
    if (
      reserved.length >= settings.globalConcurrency ||
      reserved.filter((item) => item.provider_id === task.snapshot.model.providerId).length >=
        (settings.providerConcurrency[task.snapshot.model.providerId] ?? 2) ||
      reserved.filter((item) => item.account_id === task.snapshot.account.id).length >=
        task.snapshot.account.maxConcurrent
    )
      return;
    this.active.add(task.id);
    task.status = task.resultUrl ? "Downloading" : "Submitting";
    this.app.tasks.save(task);
    const job = this.jobForTask(task.id);
    if (job) {
      job.status = "generating";
      this.saveJob(job);
    }
    void this.execute(task)
      .catch((error) =>
        this.app.logger.write("error", "audio_execute_unhandled", {
          message: toError(error).message,
        }),
      )
      .finally(() => this.active.delete(task.id));
  }

  async execute(task: Task) {
    const job = this.jobForTask(task.id);
    try {
      const input = JSON.parse(
        String(task.snapshot.draft.params.audioRequest),
      ) as AudioRequest & { remoteVoice: string; voiceName: string };
      if (this.stopped) return;
      if (!task.resultUrl) {
        task.submittedAt = new Date().toISOString();
        this.app.tasks.save(task);
        const result = await this.request(task.snapshot.model, task.snapshot.account, "tts", {
          model: COSYVOICE_MODEL_ID,
          input: {
            text: input.text,
            voice: input.remoteVoice,
            instruction: input.instruction,
            rate: Number(input.params.rate),
            pitch: Number(input.params.pitch),
            volume: Number(input.params.volume),
            seed: Number(input.params.seed),
            format: "wav",
            sample_rate: 24000,
          },
        });
        const resultOutput = object(result.output ?? {});
        const audio = object(resultOutput.audio ?? {});
        if (typeof audio.url !== "string" || !audio.url)
          throw new AppError(
            "SubmissionUnknown",
            "生成请求已发送，但接口未返回音频地址。请核对控制台后再决定是否重试，避免重复扣费。",
          );
        task.resultUrl = audio.url.startsWith("http://")
          ? audio.url.replace("http://", "https://")
          : audio.url;
        task.rawResult = result;
        task.apiTaskId = String(result.request_id || audio.id || "");
        task.status = "Downloading";
        task.downloadStatus = "pending";
        this.app.tasks.save(task);
        if (job) {
          job.requestId = task.apiTaskId || null;
          this.saveJob(job);
        }
      }
      const manager = new DownloadManager(
        this.app.logger,
        this.app.settings().downloadTimeoutSeconds * 1000,
        this.app.fetcher,
      );
      if (!task.outputPath)
        task.outputPath = await manager.download(
          task.resultUrl,
          join(
            task.snapshot.draft.outputDir,
            `${videoStem(task.name)}-${task.id.slice(0, 8)}.wav`,
          ),
        );
      const imported = await this.app.assets.import(task.outputPath, false);
      imported.asset.name = task.name;
      imported.asset.metadata = {
        ...imported.asset.metadata,
        source: "generated",
        model: COSYVOICE_MODEL_ID,
        voice: input.voiceName,
        taskId: task.id,
        batchId: input.batchId || "",
        configId: input.configId || "",
        instruction: input.instruction,
      };
      this.app.assets.save(imported.asset);
      task.outputs = [{
        kind: "audio",
        mimeType: "audio/wav",
        extension: "wav",
        localPath: task.outputPath,
        duration: imported.asset.duration,
        metadata: {
          assetId: imported.asset.id,
          voice: input.voiceName,
          size: String(imported.asset.size),
          configId: input.configId || "",
          instruction: input.instruction,
        },
      }];
      task.status = "Completed";
      task.downloadStatus = "completed";
      task.completedAt = new Date().toISOString();
      task.error = null;
      task.errorCode = null;
      this.app.tasks.save(task);
      this.recordInstruction(input.instruction, input.configName || "未命名配置", task.id);
      if (job) {
        job.status = "completed";
        job.outputPath = task.outputPath;
        job.assetId = imported.asset.id;
        job.duration = imported.asset.duration ?? null;
        job.error = null;
        job.completedAt = task.completedAt;
        this.saveJob(job);
      }
    } catch (error) {
      if (this.stopped) return;
      const parsed = toError(error);
      task.status = task.resultUrl
        ? "Completed"
        : parsed.code === "SubmissionUnknown"
          ? "Paused"
          : "Failed";
      task.downloadStatus = task.resultUrl ? "failed" : "none";
      task.error = parsed.message;
      task.errorCode = parsed.code;
      this.app.tasks.save(task);
      if (job) {
        job.status =
          parsed.code === "SubmissionUnknown" ? "uncertain" : "failed";
        job.error = parsed.message;
        this.saveJob(job);
      }
    } finally {
      setTimeout(() => void this.tick(), 0);
    }
  }

  redownload(id: string) {
    const task = this.app.tasks.get(id);
    if (task.type !== "audio" || !task.resultUrl)
      throw new Error("没有可恢复的音频地址，请核对云端结果。");
    if (task.outputPath && !existsSync(task.outputPath)) task.outputPath = null;
    task.status = "Downloading";
    task.downloadStatus = "pending";
    this.app.tasks.save(task);
    const job = this.jobForTask(id);
    if (job) {
      job.status = "pending";
      job.error = null;
      this.saveJob(job);
    }
    void this.tick();
    return task;
  }

  prepareReclone(taskId: string) {
    const task = this.app.tasks.get(taskId);
    if (task.type !== "audio" || task.status !== "Completed" || !task.outputPath)
      throw new Error("只有已完成并已保存的配音才能进入二次复刻。");
    const request = JSON.parse(String(task.snapshot.draft.params.audioRequest)) as AudioRequest;
    const artifact = task.outputs?.find((item) => item.localPath === task.outputPath);
    const assetId = artifact?.metadata.assetId;
    if (!assetId) throw new Error("成品音频尚未写入资产库，请先重新下载。");
    const draft = {
      assetId,
      name: `V1_二次复刻_${String(this.voices().filter((voice) => voice.sourceTaskId).length + 1).padStart(2, "0")}`,
      notes: "实验性音色迭代：二次复刻不保证提高相似度。",
      sourceVoiceId: request.voiceId,
      sourceTaskId: task.id,
      sourceConfigId: request.configId || null,
      sourceAudioPath: task.outputPath,
    };
    this.app.db.set("cosy-reclone-draft", draft);
    return draft;
  }

  recloneDraft() {
    return this.app.db.get<Record<string, string | null> | null>("cosy-reclone-draft", null);
  }

  clearRecloneDraft() {
    this.app.db.run("DELETE FROM settings WHERE key='cosy-reclone-draft'");
    return true;
  }

  async bind(assetId: string, draftId: string) {
    const asset = this.app.assets.get(assetId);
    if (asset.kind !== "audio") throw new Error("请选择音频资产。");
    await this.app.assets.verify(asset, false);
    const draft = this.app.drafts.get(draftId);
    const model = this.app.models().find((item) => item.id === draft.modelId);
    if (!model?.capabilities.roles.includes("reference_audio"))
      throw new Error("目标视频模型不支持参考音频，请切换支持该输入的模型。");
    const remaining = draft.assets.filter((item) => item.role !== "reference_audio");
    const normalized = normalizeDraft(
      retainDraftAssets(draft, [
        ...remaining,
        { assetId, role: "reference_audio", bindingId: randomUUID(), userRole: "音频" },
      ]),
    );
    this.app.drafts.save(normalized);
    asset.lastUsedAt = new Date().toISOString();
    this.app.assets.save(asset);
    this.app.changed();
    return normalized;
  }
}

export { instructionLength, BUILTIN_PRESETS, MAX_REFERENCE_SECONDS };
