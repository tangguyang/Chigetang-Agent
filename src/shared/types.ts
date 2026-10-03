export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type Params = Record<string, string | number | boolean>;
export type ProviderId = string;
export type AssetKind = "image" | "video" | "audio";
export type AssetRole =
  | "reference_image"
  | "reference_video"
  | "reference_audio"
  | "first_frame"
  | "last_frame";
export type TaskStatus =
  | "Draft"
  | "Queued"
  | "Uploading"
  | "Submitting"
  | "Processing"
  | "Downloading"
  | "Completed"
  | "Failed"
  | "Cancelled"
  | "Paused";
export interface Parameter {
  key: string;
  label: string;
  type: "select" | "number" | "boolean";
  options?: string[];
  min?: number;
  max?: number;
  default: string | number | boolean;
  advanced?: boolean;
}
export interface ModelCapabilities {
  supportsTextPrompt: boolean;
  supportsImage: boolean;
  supportsMultipleImages: boolean;
  supportsReferenceVideo: boolean;
  supportsAudio: boolean;
  supportsStartFrame: boolean;
  supportsEndFrame: boolean;
  supportsFirstLastFrame: boolean;
  supportsMixedFrameReferences?: boolean;
  supportsDuration: boolean;
  supportsResolution: boolean;
  supportsAspectRatio: boolean;
  supportsFPS: boolean;
  supportsSeed: boolean;
  supportsWatermark: boolean;
  supportsNativeAudio: boolean;
  supportsPromptEnhance: boolean;
  supportsNegativePrompt: boolean;
  supportsMultiShot: boolean;
  supportsEditVideo: boolean;
  supportsCharacterReference: boolean;
  supportsProductReference: boolean;
  supportsAsyncTask: boolean;
  /** Maximum reference-video seconds plus requested output seconds. */
  inputOutputDurationLimit?: number;
  promptLimit: number;
  roles: AssetRole[];
  parameters: Parameter[];
  limits: Partial<
    Record<
      AssetKind,
      {
        extensions: string[];
        maxMB: number;
        maxCount: number;
        minSide?: number;
        maxSide?: number;
        maxRatio?: number;
        minSeconds?: number;
        maxSeconds?: number;
        totalSeconds?: number;
        minFPS?: number;
      }
    >
  >;
}
export interface PricingRule {
  id: string;
  resolution?: string;
  region?: string;
  inputType?: "text" | "image" | "video";
  audio?: boolean;
  minDuration?: number;
  maxDuration?: number;
  rate: number;
  unit: "second" | "million_tokens";
  basis?: "output" | "input_output";
  tokensPerSecond?: number;
}
export interface Mention {
  id: string;
  assetId: string;
  bindingId: string;
  start: number;
  end: number;
  label: string;
}
export interface DraftSummary {
  id: string;
  name: string;
  updatedAt: string;
}
export interface ConnectionResult {
  ok: boolean;
  accountId: string;
  accountName: string;
  keyLoaded: boolean;
  workspaceId: string;
  region: string;
  endpoint: string;
  model: string;
  checks: string[];
  error?: string;
  details?: ApiErrorDetails;
}
export interface ApiErrorDetails {
  httpStatus: number;
  code: string;
  message: string;
  requestId: string;
}
export interface Price {
  rules?: PricingRule[];
  currency: "CNY" | "USD";
  unit: "second" | "million_tokens";
  rate: number | null;
  source: string;
  updatedAt: string;
  basis?: "output" | "input_output";
}
export interface Model {
  audio?: AudioCapabilities;
  id: string;
  name: string;
  providerId: ProviderId;
  officialId: string;
  adapter: string;
  adapterVersion: string;
  type: "video" | "image" | "audio" | "text";
  enabled: boolean;
  favorite: boolean;
  verified: boolean;
  note: string;
  capabilities: ModelCapabilities;
  price: Price;
}
export interface Provider {
  id: ProviderId;
  name: string;
  endpoint: string;
  region: string;
  adapter: string;
  maxConcurrent: number;
  enabled: boolean;
  docs: string;
}
export interface Account {
  id: string;
  name: string;
  providerId: ProviderId;
  workspaceId: string;
  region: string;
  endpoint: string;
  notes: string;
  manualBalance: string;
  enabled: boolean;
  isDefault: boolean;
  maxConcurrent: number;
  createdAt: string;
  maskedKey: string;
  modelPrices?: Record<string, Price>;
}
export interface Asset {
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  metadata?: Record<string, string>;
  id: string;
  name: string;
  kind: AssetKind;
  originalPath: string;
  managedPath: string | null;
  size: number;
  mime: string;
  hash: string;
  createdAt: string;
  lastUsedAt: string | null;
  tags: string[];
  folder: string;
  projectId: string | null;
  favorite: boolean;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  hasAlpha?: boolean;
  thumbnailPath?: string;
  missing?: boolean;
  usageCount?: number;
  defaultUsage?: string;
  remoteUrl?: string;
  libraryDeletedAt?: string | null;
  /** Path became unavailable. Kept reversible and never deletes the record. */
  unavailableAt?: string | null;
}
export interface AssetBinding {
  bindingId?: string;
  userRole?: string;
  assetId: string;
  role: AssetRole;
}
export interface Project {
  id: string;
  name: string;
  outputDir: string;
  createdAt: string;
}
export interface Prompt {
  id: string;
  name: string;
  content: string;
  folder: string;
  tags: string[];
  favorite: boolean;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface Draft {
  draftId?: string;
  mentions?: Mention[];
  name: string;
  modelId: string;
  accountId: string;
  projectId: string | null;
  prompt: string;
  params: Params;
  assets: AssetBinding[];
  outputDir: string;
  parentVersionId?: string;
  groupId?: string;
}
export interface Cost {
  amount: number | null;
  currency: string;
  kind: "estimate" | "actual" | "unknown";
  note: string;
}
export interface Snapshot {
  draft: Draft;
  model: Model;
  provider: Provider;
  account: Account;
  assets: (Asset & { role: AssetRole })[];
  price: Price;
  estimatedCost: Cost;
  appVersion: string;
  createdAt: string;
}
export interface Task {
  type?: AssetKind | "video-group";
  segment?: {
    index: number;
    count: number;
    start: number;
    end: number;
    duration: number;
    parentId?: string;
  };
  outputs?: Artifact[];
  id: string;
  groupId: string;
  version: number;
  parentTaskId: string | null;
  parentVersionId: string | null;
  name: string;
  status: TaskStatus;
  snapshot: Snapshot;
  apiTaskId: string | null;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  outputPath: string | null;
  resultUrl: string | null;
  rawResult: Json | null;
  error: string | null;
  errorCode: string | null;
  downloadStatus: "none" | "pending" | "completed" | "failed";
  cost: Cost;
  actualCost?: Cost | null;
  apiError?: ApiErrorDetails;
  connectionAccount?: Account;
  progress: number | null;
  nextPollAt: number;
  retryCount: number;
  deletedAt: string | null;
}
export interface Settings {
  assetDir?: string;
  audioDir?: string;
  otherDir?: string;
  backupDir?: string;
  closeBehavior?: "exit" | "tray";
  ffmpegPath?: string;
  theme: "light" | "dark" | "system";
  language: string;
  defaultModel: string;
  defaultAccount: string;
  outputDir: string;
  globalConcurrency: number;
  providerConcurrency: Record<string, number>;
  maxRetries: number;
  pollSeconds: number;
  pollSecondsCustomized?: boolean;
  notifications: boolean;
  downloadTimeoutSeconds: number;
  queuePaused: boolean;
  portable: boolean;
  lastOutputDir: string;
  lastImportDir?: string;
}
export interface BuildIdentity {
  version: string;
  gitCommit: string;
  gitBranch: string;
  buildId: string;
  buildTime: string;
  sourceTreeHash: string;
  sourceDirty: boolean;
  dataRoot: string;
  executablePath: string;
}
export interface Bootstrap {
  identity?: BuildIdentity;
  models: Model[];
  providers: Provider[];
  accounts: Account[];
  projects: Project[];
  settings: Settings;
  draft: Draft | null;
  root: string;
  installPath: string;
  version: string;
}
export interface Page<T> {
  items: T[];
  total: number;
}
export interface ListQuery {
  generated?: boolean;
  hidden?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  kind?: string;
  status?: string;
  modelId?: string;
  providerId?: string;
  accountId?: string;
  projectId?: string;
  favorite?: boolean;
  from?: string;
  to?: string;
  folder?: string;
  sort?: "recent" | "created";
}
export interface AppBridge {
  invoke<T = unknown>(action: string, payload?: unknown): Promise<T>;
  onChange(callback: () => void): () => void;
  onNavigate(callback: (taskId: string) => void): () => void;
  filePath(file: File): string;
}
declare global {
  interface Window {
    aiVideo: AppBridge;
  }
}

export interface Artifact {
  kind: AssetKind;
  mimeType: string;
  extension: string;
  localPath: string;
  duration?: number;
  metadata: Record<string, string>;
}
export interface AudioCapabilities {
  supportsSystemVoice: boolean;
  supportsVoiceClone: boolean;
  supportsVoiceDesign: boolean;
  supportsInstruction: boolean;
  supportsRate: boolean;
  supportsPitch: boolean;
  supportsVolume: boolean;
  supportsTimestamp: boolean;
  supportsSeed: boolean;
  supportedFormats: string[];
  systemVoices: { id: string; name: string }[];
  endpoints: Record<string, { tts: string; clone: string }>;
  enrollmentModel: string;
  maxCharacters: number;
  protocol?: "qwen-tts" | "qwen-audio";
  instructionField?: "instruction" | "instructions";
}
export interface Voice {
  id: string;
  name: string;
  providerId: string;
  region: string;
  model: string;
  accountId: string;
  voiceId: string;
  kind: "clone" | "design";
  createdAt: string;
  referenceAssetId: string;
  referencePath: string;
  notes: string;
  favorite: boolean;
  pinned: boolean;
  pinOrder: number | null;
  isDefault: boolean;
  status: "ready" | "pending" | "unavailable" | "unknown";
  referenceName: string;
  referenceDuration: number;
  createParams: VoiceCloneParams;
  sourceVoiceId?: string | null;
  sourceTaskId?: string | null;
  sourceConfigId?: string | null;
  sourceAudioPath?: string | null;
  lastError?: string | null;
}
export interface VoiceCloneParams {
  languageHints: string[];
  maxPromptAudioLength: number;
  enablePreprocess: boolean;
  enableVolumeNormalization: boolean;
}
export interface AudioRequest {
  name: string;
  text: string;
  instruction: string;
  modelId: string;
  accountId: string;
  voiceId: string;
  format: "wav" | "mp3";
  params: Params;
  durationMode?: "auto" | "manual";
  targetDuration?: number | null;
  durationReferenceAssetId?: string | null;
  configId?: string;
  configName?: string;
  batchId?: string;
  sampleRate?: 24000;
}
export interface AudioGenerationConfig {
  id: string;
  name: string;
  instruction: string;
  rate: number;
  pitch: number;
  volume: number;
  seed: number;
  format: "wav";
  sampleRate: 24000;
  collapsed?: boolean;
}
export interface AudioBatchInput {
  name: string;
  text: string;
  accountId: string;
  voiceId: string;
  configs: AudioGenerationConfig[];
  requestId: string;
}
export interface AudioBatchRecord {
  id: string;
  name: string;
  text: string;
  voiceId: string;
  voiceName: string;
  accountId: string;
  createdAt: string;
  jobs: AudioJobRecord[];
}
export interface AudioJobRecord {
  id: string;
  batchId: string;
  taskId: string;
  configIndex: number;
  config: AudioGenerationConfig;
  status:
    | "pending"
    | "generating"
    | "completed"
    | "failed"
    | "uncertain"
    | "cancelled";
  requestId: string | null;
  outputPath: string | null;
  assetId: string | null;
  duration: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface InstructionPreset {
  id: string;
  name: string;
  content: string;
  notes: string;
  favorite: boolean;
  position: number;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface InstructionHistory {
  id: string;
  content: string;
  favorite: boolean;
  configName: string;
  taskId: string;
  lastUsedAt: string;
}
export interface AssetFolder {
  id: string;
  name: string;
  parentId: string | null;
}
