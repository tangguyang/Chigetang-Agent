import { existsSync } from "node:fs";
import { copyFile, mkdir, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Voice } from "../../shared/types.ts";
import { AlibabaProvider } from "../providers/adapters.ts";
import type { Application } from "./application.ts";
import { normalizeWorkspace, validateWorkspace } from "../../shared/accounts.ts";
import { HttpClient, object } from "../providers/http.ts";
import { DownloadManager } from "./downloads.ts";

export const QWEN_AUDIO_MODEL = "qwen-audio-3.0-tts-plus";
export type QwenAudioInput = {
  model: string;
  voice: string;
  text: string;
  instruction: string;
  outputPath: string;
  accountId?: string;
};

function qwenAccount(app: Application, accountId?: string) {
  const accounts = app.credentials.list().filter(a => a.enabled && a.providerId === "alibaba" && a.region === "cn-beijing");
  const account = accountId ? accounts.find(a => a.id === accountId) : accounts.find(a => a.isDefault) || (accounts.length === 1 ? accounts[0] : undefined);
  if (!account) throw Error("缺少可明确选择的安全阿里云北京连接，请指定 accountId");
  return account;
}

export async function cloneQwenAudio(app: Application, input: { referencePath: string; name: string; prefix: string; language: string; accountId?: string }) {
  const account = qwenAccount(app, input.accountId);
  if (!input.name.trim() || !input.prefix.trim() || input.language !== "zh") throw Error("音色名称、prefix 或 language 无效");
  if (app.audio.voices().some(v => v.model === QWEN_AUDIO_MODEL && v.name === input.name)) throw Error("同名 Qwen 音色已存在，请使用现有音色，禁止重复复刻");
  const model = app.models().find(m => m.officialId === "cosyvoice-v3.5-plus")!;
  const provider = app.providers().find(p => p.id === "alibaba")!;
  if (!model || !provider) throw Error("缺少现有阿里云音频 Provider 配置");
  const source = (await app.assets.import(input.referencePath, false)).asset;
  if (source.kind !== "audio" || !source.duration || source.duration < 3 || source.duration > 20 || source.size > 10 * 1024 * 1024) throw Error("参考音频需要可解码的 3–20 秒、10MB以内音频");
  const folder = join(app.root, "voices", "references");
  await mkdir(folder, { recursive: true });
  const ownedPath = join(folder, `${randomUUID()}${extname(input.referencePath)}`);
  await copyFile(input.referencePath, ownedPath);
  const voice: Voice = { id: randomUUID(), name: input.name, providerId: "alibaba", region: account.region, model: QWEN_AUDIO_MODEL, accountId: account.id, voiceId: "", kind: "clone", createdAt: new Date().toISOString(), referenceAssetId: source.id, referencePath: ownedPath, referenceName: source.name, referenceDuration: source.duration, sourceAudioPath: input.referencePath, notes: `来源：${input.referencePath}`, favorite: false, pinned: false, pinOrder: null, isDefault: false, status: "pending", createParams: { languageHints: [input.language], maxPromptAudioLength: 20, enablePreprocess: false, enableVolumeNormalization: false }, lastError: null };
  // Existing voice-management storage, written solely inside the owning Application.
  const save = () => {
    app.db.run("INSERT INTO cosy_voices VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", voice.id, voice.accountId, voice.model, 0, null, 0, JSON.stringify(voice));
    app.changed();
  };
  save();
  app.audio.cloning++;
  try {
    const http = new HttpClient(app.fetcher, app.logger, 0);
    const upload = new AlibabaProvider(http);
    const url = await upload.upload({ model: { ...model, officialId: QWEN_AUDIO_MODEL }, provider, account } as Parameters<typeof upload.upload>[0], app.credentials.getKey(account.id), { ...source, originalPath: ownedPath, managedPath: ownedPath });
    const workspace = normalizeWorkspace(account.workspaceId || "");
    validateWorkspace(workspace);
    const result = object(await http.request(`https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`, app.credentials.getKey(account.id), {
      method: "POST", paidSubmit: true,
      headers: url.startsWith("oss:") ? { "X-DashScope-OssResourceResolve": "enable" } : undefined,
      body: { model: "voice-enrollment", input: { action: "create_voice", target_model: QWEN_AUDIO_MODEL, prefix: input.prefix, language_hints: [input.language], url } },
    }));
    if (result.code && result.code !== "Success") throw Error(`Qwen 复刻拒绝：${String(result.code)} ${String(result.message || "")}`);
    const output = object(result.output || {});
    const returnedId = output.voice_id ?? output.voice;
    if (typeof returnedId !== "string" || !returnedId || returnedId.startsWith("cosyvoice-")) throw Error("接口未返回 Qwen 专属 voice ID；禁止自动重试");
    voice.voiceId = returnedId;
    voice.status = "ready";
    save();
    return { voiceId: voice.voiceId, name: voice.name, target_model: voice.model, referenceSource: input.referencePath, accountId: account.id, requestId: String(result.request_id || "") };
  } catch (error) {
    voice.status = "unknown";
    voice.lastError = error instanceof Error ? error.message : "复刻失败";
    save();
    throw error;
  } finally { app.audio.cloning--; }
}

// Called only by the existing main-process dispatcher. Credentials never cross IPC.
export async function generateQwenAudio(app: Application, input: QwenAudioInput) {
  if (input.model !== QWEN_AUDIO_MODEL) throw Error("仅支持 " + QWEN_AUDIO_MODEL);
  if (!input.voice.trim() || !input.text.trim()) throw Error("voice 和 text 不能为空");
  if (input.voice.startsWith("cosyvoice-")) throw Error("不能沿用 CosyVoice 音色；需要 Qwen-Audio voice ID");
  const account = qwenAccount(app, input.accountId);
  const named = app.audio.voices().filter(v => v.model === QWEN_AUDIO_MODEL && v.accountId === account.id && (v.name === input.voice || v.id === input.voice));
  if (named.length > 1) throw Error("音色名称不唯一，请指定项目音色 ID");
  if (named.length === 1) {
    if (named[0].status !== "ready" || !named[0].voiceId) throw Error("Qwen 音色尚未可用");
    input = { ...input, voice: named[0].voiceId };
  }
  const workspace = normalizeWorkspace(account.workspaceId || "");
  validateWorkspace(workspace);
  const audioRoot = resolve(app.root, "outputs", "audio");
  const destination = isAbsolute(input.outputPath) ? resolve(input.outputPath) : resolve(app.root, input.outputPath);
  const contained = (root: string, path: string) => {
    const rel = relative(root, path);
    return rel !== "" && rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../") && !isAbsolute(rel);
  };
  if (!contained(audioRoot, destination) || !destination.toLowerCase().endsWith(".wav"))
    throw Error("outputPath 必须是 outputs/audio 内的 WAV 路径");
  if (existsSync(destination)) throw Error("输出已存在，禁止覆盖或再次付费");
  await mkdir(dirname(destination), { recursive: true });
  if (!contained(await realpath(audioRoot), join(await realpath(dirname(destination)), relative(dirname(destination), destination))))
    throw Error("输出目录链接超出 outputs/audio");
  app.logger.write("runtime", "qwen_audio_submit", { model: input.model, voice: input.voice, outputPath: destination });
  const response = object(await new HttpClient(app.fetcher, app.logger, 0).request(
    `https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`,
    app.credentials.getKey(account.id),
    { method: "POST", paidSubmit: true, body: {
      model: input.model,
      input: { voice: input.voice, text: input.text, instruction: input.instruction, format: "wav", sample_rate: 24000 },
    } },
  ));
  if (response.code && response.code !== "Success") throw Error(`Qwen-Audio 拒绝请求：${String(response.code)} ${String(response.message || "")}`);
  const audio = object(object(response.output || {}).audio || {});
  if (typeof audio.url !== "string" || !audio.url) throw Error("提交后未返回音频地址；禁止自动重试，请核对云端记录");
  const path = await new DownloadManager(app.logger, app.settings().downloadTimeoutSeconds * 1000, app.fetcher)
    .download(audio.url.replace(/^http:/, "https:"), destination);
  const imported = await app.assets.import(path, false);
  imported.asset.metadata = { ...imported.asset.metadata, source: "generated", model: input.model, voice: input.voice, instruction: input.instruction, requestId: String(response.request_id || "") };
  app.assets.save(imported.asset);
  app.changed();
  return { outputPath: path, assetId: imported.asset.id, requestId: String(response.request_id || ""), model: input.model };
}

