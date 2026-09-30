import type { Model, ModelCapabilities, Parameter, Provider } from "./types.ts";
const flags: ModelCapabilities = {
  supportsTextPrompt: true,
  supportsImage: true,
  supportsMultipleImages: true,
  supportsReferenceVideo: true,
  supportsAudio: true,
  supportsStartFrame: true,
  supportsEndFrame: true,
  supportsFirstLastFrame: true,
  supportsDuration: true,
  supportsResolution: true,
  supportsAspectRatio: true,
  supportsFPS: false,
  supportsSeed: true,
  supportsWatermark: true,
  supportsNativeAudio: true,
  supportsPromptEnhance: true,
  supportsNegativePrompt: false,
  supportsMultiShot: false,
  supportsEditVideo: true,
  supportsCharacterReference: true,
  supportsProductReference: true,
  supportsAsyncTask: true,
  promptLimit: 20000,
  roles: [
    "reference_image",
    "reference_video",
    "reference_audio",
    "first_frame",
    "last_frame",
  ],
  parameters: [],
  limits: {},
};
const params: Parameter[] = [
  {
    key: "resolution",
    label: "分辨率",
    type: "select",
    options: ["480P", "720P", "1080P"],
    default: "720P",
  },
  {
    key: "ratio",
    label: "画面比例",
    type: "select",
    options: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"],
    default: "adaptive",
  },
  {
    key: "duration",
    label: "时长（秒，-1 为智能）",
    type: "number",
    min: -1,
    max: 30,
    default: 5,
  },
  { key: "audio", label: "生成声音", type: "boolean", default: false },
  {
    key: "seed",
    label: "随机种子（-1 自动）",
    type: "number",
    min: -1,
    max: 2147483647,
    default: -1,
    advanced: true,
  },
  {
    key: "watermark",
    label: "AI 水印",
    type: "boolean",
    default: false,
    advanced: true,
  },
  {
    key: "prompt_extend",
    label: "Prompt 智能改写",
    type: "boolean",
    default: false,
    advanced: true,
  },
];
export const providers: Provider[] = [
  {
    id: "alibaba",
    name: "阿里云百炼",
    endpoint: "https://{workspace}.cn-beijing.maas.aliyuncs.com",
    region: "cn-beijing",
    adapter: "alibaba",
    maxConcurrent: 2,
    enabled: true,
    docs: "https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference",
  },
  {
    id: "volcengine",
    name: "火山方舟",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
    region: "cn-beijing",
    adapter: "volcengine",
    maxConcurrent: 2,
    enabled: true,
    docs: "https://www.volcengine.com/docs/82379/1520757",
  },
];
export const models: Model[] = [
  {
    id: "wan3",
    name: "Wan 3.0",
    providerId: "alibaba",
    officialId: "wan3.0-video",
    adapter: "wan3",
    adapterVersion: "1.0.2",
    type: "video",
    enabled: true,
    favorite: true,
    verified: true,
    note: "官方协议已核对，等待真实 API 验证。",
    capabilities: {
      ...flags,
      inputOutputDurationLimit: 30,
      parameters: params,
      limits: {
        image: {
          extensions: ["jpg", "jpeg", "png", "bmp", "webp"],
          maxMB: 20,
          maxCount: 10,
          minSide: 240,
          maxSide: 8000,
          maxRatio: 8,
        },
        video: {
          extensions: ["mp4", "mov"],
          maxMB: 100,
          maxCount: 5,
          minSide: 240,
          maxSide: 4096,
          maxRatio: 8,
          minSeconds: 1,
          maxSeconds: 15,
          totalSeconds: 15,
          minFPS: 16,
        },
        audio: {
          extensions: ["mp3", "wav"],
          maxMB: 15,
          maxCount: 5,
          minSeconds: 1,
          maxSeconds: 15,
          totalSeconds: 15,
        },
      },
    },
    price: {
      currency: "CNY",
      unit: "second",
      rate: null,
      source: "未配置；请按当前账户地域、分辨率和输入类型核对账单价格",
      updatedAt: "2026-09-15",
      basis: "input_output",
    },
  },
  {
    id: "seedance15",
    name: "Seedance 1.5 Pro",
    providerId: "volcengine",
    officialId: "doubao-seedance-1-5-pro-251215",
    adapter: "seedance",
    adapterVersion: "1.0.2",
    type: "video",
    enabled: true,
    favorite: false,
    verified: true,
    note: "官方协议与能力已核对，等待真实 API 验证。支持文生视频与首尾帧，不支持参考视频。",
    capabilities: {
      ...flags,
      supportsMultipleImages: false,
      supportsReferenceVideo: false,
      supportsAudio: false,
      supportsPromptEnhance: false,
      supportsEditVideo: false,
      supportsCharacterReference: false,
      supportsProductReference: false,
      promptLimit: 10000,
      roles: ["first_frame", "last_frame"],
      parameters: params
        .filter((p) => p.key !== "prompt_extend")
        .map((p) =>
          p.key === "resolution"
            ? { ...p, options: ["480p", "720p"], default: "720p" }
            : p.key === "duration"
              ? { ...p, min: 4, max: 12, default: 5 }
              : p.key === "audio"
                ? { ...p, key: "generate_audio" }
                : p,
        ),
      limits: {
        image: {
          extensions: ["jpg", "jpeg", "png", "webp"],
          maxMB: 10,
          maxCount: 2,
        },
      },
    },
    price: {
      currency: "CNY",
      unit: "million_tokens",
      rate: null,
      source: "待官方定价核对",
      updatedAt: "2026-09-15",
    },
  },
];
export function defaults(model: Model) {
  return Object.fromEntries(
    model.capabilities.parameters.map((p) => [p.key, p.default]),
  );
}
// Seedance official API page verified 2026-09-15. Limits are conservative where
// desktop import supports a subset of formats accepted by the cloud service.
const seed15 = models.find((m) => m.id === "seedance15")!;
seed15.enabled = true;
seed15.verified = true;
seed15.note =
  "官方协议与能力已核对，等待真实 API 验证。支持文生视频与首尾帧，不支持参考视频。";
seed15.capabilities.promptLimit = 100000; // Local editor safety limit, not a claimed provider maximum.
seed15.capabilities.parameters = seed15.capabilities.parameters.map((p) =>
  p.key === "resolution"
    ? { ...p, options: ["480p", "720p", "1080p"] }
    : p.key === "duration"
      ? { ...p, min: -1 }
      : p.key === "ratio"
        ? {
            ...p,
            options: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
          }
        : p,
);
seed15.capabilities.limits.image = {
  extensions: ["jpg", "jpeg", "png", "webp", "bmp"],
  maxMB: 30,
  maxCount: 2,
  minSide: 300,
  maxSide: 6000,
  maxRatio: 2.5,
};
models.push({
  id: "seedance25",
  name: "Seedance 2.5",
  providerId: "volcengine",
  officialId: "doubao-seedance-2-5-260628",
  adapter: "seedance",
  adapterVersion: "1.0.2",
  type: "video",
  enabled: true,
  favorite: true,
  verified: true,
  note: "官方协议已核对，等待真实 API 验证。参考视频需填写官方可访问 URL；真人素材需符合方舟授权规则。",
  capabilities: {
    ...flags,
    supportsSeed: false,
    supportsPromptEnhance: false,
    promptLimit: 100000,
    parameters: [
      ...seed15.capabilities.parameters
        .filter((p) => p.key !== "seed")
        .map((p) =>
          p.key === "duration" ? { ...p, min: -1, max: 30, default: 5 } : p,
        ),
      {
        key: "omni_reference_task_type",
        label: "任务类型",
        type: "select",
        options: ["reference", "edit", "extend", "auto"],
        default: "reference",
      },
    ],
    limits: {
      image: {
        extensions: ["jpg", "jpeg", "png", "webp", "bmp"],
        maxMB: 30,
        maxCount: 30,
        minSide: 300,
        maxSide: 6000,
        maxRatio: 2.5,
      },
      video: {
        extensions: ["mp4", "mov"],
        maxMB: 200,
        maxCount: 10,
        minSide: 300,
        maxSide: 6000,
        maxRatio: 2.5,
        minSeconds: 2,
        maxSeconds: 30,
        totalSeconds: 30,
        minFPS: 24,
      },
      audio: {
        extensions: ["mp3", "wav"],
        maxMB: 15,
        maxCount: 10,
        minSeconds: 2,
        maxSeconds: 30,
        totalSeconds: 30,
      },
    },
  },
  price: {
    currency: "CNY",
    unit: "million_tokens",
    rate: null,
    source: "按账户当前分辨率、含视频输入条件核对价格后配置",
    updatedAt: "2026-09-15",
  },
});
