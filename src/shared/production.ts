import type { Draft } from "./types.ts";
export type Driver = "GUI" | "Codex" | "历史未知";
export interface ProductionOutput {
  path: string;
  kind: string;
  assetId?: string;
  taskId?: string;
}
export interface ProductionTask {
  id: string;
  recordId: string;
  system: "task" | "asset" | "speech" | "speech-v2" | "execution";
  name: string;
  feature: string;
  driver: Driver;
  createdAt: string;
  status: string;
  model: string;
  note: string;
  favorite: boolean;
  outputs: ProductionOutput[];
  deleted: boolean;
  workflowId?: string;
  params?: unknown;
  draft?: Draft;
}
export interface CoreAsset {
  alias: string;
  type: "person" | "product" | "brand" | "voice" | "other";
  path: string;
  sha256: string;
  updatedAt: string;
  description: string;
  assetId: string;
}
export interface CopyWorkflow {
  id: string;
  requestId: string;
  name: string;
  createdAt: string;
  driver: Driver;
  drafts: Draft[];
  taskIds: string[];
  state: "prepared" | "submitting" | "submitted" | "blocked";
  revision: number;
  fingerprint?: string;
  confirmed?: boolean;
  issues?: string[];
  error?: string;
}
