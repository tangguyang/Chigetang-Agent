import { compilePrompt } from "../../shared/mentions.ts";
import type {
  ApiErrorDetails,
  Cost,
  Json,
  ModelCapabilities,
  Snapshot,
} from "../../shared/types.ts";
import { AlibabaProvider, VolcengineProvider } from "../providers/adapters.ts";
import { HttpClient, object, str } from "../providers/http.ts";
import { estimateCost } from "../services/cost.ts";
import { AppError } from "../services/errors.ts";
import { validateInput } from "./validation.ts";
export interface CloudStatus {
  status:
    | "pending"
    | "processing"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "unknown";
  url?: string;
  raw: Json;
  message?: string;
  details?: ApiErrorDetails;
}
export interface ModelAdapter {
  validateInput(s: Snapshot): void;
  uploadAssets(s: Snapshot, key: string, signal?: AbortSignal): Promise<Json[]>;
  submitTask(
    s: Snapshot,
    key: string,
    assets: Json[],
    signal?: AbortSignal,
  ): Promise<string>;
  getTaskStatus(
    s: Snapshot,
    key: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<CloudStatus>;
  cancelTask(s: Snapshot, key: string, id: string): Promise<boolean>;
  getResult(status: CloudStatus): string;
  downloadResult(url: string, destination: string): Promise<string>;
  estimateCost(s: Snapshot): Cost;
  getCapabilities(s: Snapshot): ModelCapabilities;
  getErrorMessage(e: unknown): string;
}
export abstract class BaseAdapter implements ModelAdapter {
  http: HttpClient;
  downloader: (url: string, dest: string) => Promise<string>;
  constructor(
    http: HttpClient,
    downloader: (url: string, dest: string) => Promise<string>,
  ) {
    this.http = http;
    this.downloader = downloader;
  }
  validateInput = validateInput;
  estimateCost = estimateCost;
  getCapabilities(s: Snapshot) {
    return s.model.capabilities;
  }
  getErrorMessage(e: unknown) {
    return e instanceof Error ? e.message : "任务发生未知错误。";
  }
  getResult(s: CloudStatus) {
    if (!s.url)
      throw new AppError("DownloadError", "云端成功但尚未返回下载地址。");
    return s.url;
  }
  downloadResult(url: string, destination: string) {
    return this.downloader(url, destination);
  }
  abstract uploadAssets(
    s: Snapshot,
    key: string,
    signal?: AbortSignal,
  ): Promise<Json[]>;
  abstract submitTask(
    s: Snapshot,
    key: string,
    assets: Json[],
    signal?: AbortSignal,
  ): Promise<string>;
  abstract getTaskStatus(
    s: Snapshot,
    key: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<CloudStatus>;
  async cancelTask(_s: Snapshot, _key: string, _id: string) {
    return false;
  }
}
export class WanAdapter extends BaseAdapter {
  provider = new AlibabaProvider(this.http);
  async uploadAssets(s: Snapshot, key: string, signal?: AbortSignal) {
    const result: Json[] = [];
    for (const a of s.assets)
      result.push({
        type: a.role,
        url: await this.provider.upload(s, key, a, signal),
      });
    return result;
  }
  async submitTask(
    s: Snapshot,
    key: string,
    assets: Json[],
    signal?: AbortSignal,
  ) {
    const raw = await this.provider.request(
      s,
      key,
      "/api/v1/services/aigc/video-generation/video-synthesis",
      {
        method: "POST",
        body: {
          model: s.model.officialId,
          input: {
            prompt: compilePrompt(s.draft, s.assets, s.model.adapter),
            ...(assets.length ? { media: assets } : {}),
          },
          parameters: s.draft.params,
        },
        headers: {
          "X-DashScope-Async": "enable",
          ...(assets.some((a) => str(object(a).url).startsWith("oss:"))
            ? { "X-DashScope-OssResourceResolve": "enable" }
            : {}),
        },
        signal,
        paidSubmit: true,
      },
    );
    let id = "";
    try {
      id = str(object(object(raw).output).task_id);
    } catch {}
    if (!id) {
      const error = new AppError(
        "SubmissionUnknown",
        "未取得云端任务 ID，请到控制台核对是否已受理。",
      );
      const obj = object(raw);
      const out =
        obj.output && typeof obj.output === "object" ? object(obj.output) : obj;
      error.details = {
        httpStatus: 200,
        code: str(out.code) || str(obj.code) || "未返回",
        message: str(out.message) || str(obj.message) || "未返回",
        requestId: str(obj.request_id) || "未返回",
      };
      error.message += `\nHTTP 200 · code: ${error.details.code}\nmessage: ${error.details.message}\nrequest_id: ${error.details.requestId}`;
      throw error;
    }
    return id;
  }
  async getTaskStatus(
    s: Snapshot,
    key: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<CloudStatus> {
    const raw = await this.provider.request(
      s,
      key,
      `/api/v1/tasks/${encodeURIComponent(id)}`,
      { signal },
    );
    const out = object(object(raw).output);
    const map: Record<string, CloudStatus["status"]> = {
      PENDING: "pending",
      RUNNING: "processing",
      SUCCEEDED: "succeeded",
      FAILED: "failed",
      CANCELED: "cancelled",
      UNKNOWN: "unknown",
    };
    return {
      status: map[str(out.task_status)] ?? "unknown",
      url: str(out.video_url) || undefined,
      raw,
      message: `HTTP 200 · code: ${str(out.code) || "未返回"}\nmessage: ${str(out.message) || "未返回"}\nrequest_id: ${str(object(raw).request_id) || "未返回"}`,
      details: {
        httpStatus: 200,
        code: str(out.code) || "未返回",
        message: str(out.message) || "未返回",
        requestId: str(object(raw).request_id) || "未返回",
      },
    };
  }
}
export class SeedanceAdapter extends BaseAdapter {
  provider = new VolcengineProvider(this.http);
  async uploadAssets(s: Snapshot, key: string) {
    const assets: Json[] = [];
    for (const a of s.assets)
      assets.push({
        type: `${a.kind}_url`,
        [`${a.kind}_url`]: { url: await this.provider.upload(s, key, a) },
        role: a.role,
      });
    return assets;
  }
  async submitTask(
    s: Snapshot,
    key: string,
    assets: Json[],
    signal?: AbortSignal,
  ) {
    const raw = await this.provider.request(
      s,
      key,
      "/contents/generations/tasks",
      {
        method: "POST",
        body: {
          model: s.model.officialId,
          content: [
            {
              type: "text",
              text: compilePrompt(s.draft, s.assets, s.model.adapter),
            },
            ...assets,
          ],
          ...Object.fromEntries(
            Object.entries(s.draft.params).filter(
              ([k]) =>
                k !== "omni_reference_task_type" ||
                s.assets.some((a) => a.role.startsWith("reference_")),
            ),
          ),
        },
        signal,
        paidSubmit: true,
      },
    );
    let id = "";
    try {
      id = str(object(raw).id);
    } catch {}
    if (!id)
      throw new AppError(
        "SubmissionUnknown",
        "未取得任务 ID，请核对方舟控制台。",
      );
    return id;
  }
  async getTaskStatus(
    s: Snapshot,
    key: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<CloudStatus> {
    const raw = await this.provider.request(
      s,
      key,
      `/contents/generations/tasks/${encodeURIComponent(id)}`,
      { signal },
    );
    const obj = object(raw);
    const map: Record<string, CloudStatus["status"]> = {
      queued: "pending",
      running: "processing",
      succeeded: "succeeded",
      failed: "failed",
      cancelled: "cancelled",
      expired: "unknown",
    };
    const content = obj.content ? object(obj.content) : {};
    return {
      status: map[str(obj.status)] ?? "unknown",
      url: str(content.video_url) || undefined,
      raw,
      message: obj.error ? str(object(obj.error).message) : undefined,
    };
  }
  async cancelTask(s: Snapshot, key: string, id: string) {
    await this.provider.request(
      s,
      key,
      `/contents/generations/tasks/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return true;
  }
}
