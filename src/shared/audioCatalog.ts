import type { Model, AudioCapabilities } from "./types.ts";

export const COSYVOICE_MODEL_ID = "cosyvoice-v3.5-plus";

const cosyVoice: AudioCapabilities = {
  supportsSystemVoice: false,
  supportsVoiceClone: true,
  supportsVoiceDesign: false,
  supportsInstruction: true,
  supportsRate: true,
  supportsPitch: true,
  supportsVolume: true,
  supportsTimestamp: false,
  supportsSeed: true,
  supportedFormats: ["wav"],
  systemVoices: [],
  endpoints: {
    "cn-beijing": {
      tts: "https://{workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
      clone:
        "https://{workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization",
    },
  },
  enrollmentModel: "voice-enrollment",
  maxCharacters: 20000,
  protocol: "qwen-audio",
  instructionField: "instruction",
};

export function audioModels(video: Model): Model[] {
  return [
    {
      id: COSYVOICE_MODEL_ID,
      name: "CosyVoice 3.5 Plus",
      officialId: COSYVOICE_MODEL_ID,
      audio: cosyVoice,
    },
  ].map((v) => ({
    ...video,
    ...v,
    providerId: "alibaba",
    adapter: "qwen-tts-http",
    adapterVersion: "1.0.9",
    type: "audio",
    favorite: false,
    verified: false,
    note: "账号是否已开通需以实际 API 返回为准；MP3 通过本地 FFmpeg 转换。",
    capabilities: { ...video.capabilities, roles: [], parameters: [] },
    price: {
      ...video.price,
      rate: null,
      rules: [],
      source: "费用以百炼账单为准",
    },
  }));
}
export function voiceCompatible(
  voice: import("./types.ts").Voice,
  model: Model,
  account: import("./types.ts").Account,
) {
  return (
    voice.providerId === model.providerId &&
    voice.accountId === account.id &&
    voice.region === account.region &&
    voice.model === COSYVOICE_MODEL_ID &&
    model.officialId === COSYVOICE_MODEL_ID
  );
}
