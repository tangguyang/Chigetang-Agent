import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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

// Called only by the existing main-process dispatcher. Credentials never cross IPC.
export async function generateQwenAudio(app: Application, input: QwenAudioInput) {
  if (input.model !== QWEN_AUDIO_MODEL) throw Error("仅支持 " + QWEN_AUDIO_MODEL);
  if (!input.voice.trim() || !input.text.trim()) throw Error("voice 和 text 不能为空");
  if (input.voice.startsWith("cosyvoice-")) throw Error("不能沿用 CosyVoice 音色；需要 Qwen-Audio voice ID");
  const accounts = app.credentials.list().filter(a => a.enabled && a.providerId === "alibaba" && a.region === "cn-beijing");
  const account = input.accountId
    ? accounts.find(a => a.id === input.accountId)
    : accounts.find(a => a.isDefault) || (accounts.length === 1 ? accounts[0] : undefined);
  if (!account) throw Error("缺少可明确选择的安全阿里云北京连接，请指定 accountId");
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
