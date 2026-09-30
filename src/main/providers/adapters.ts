import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  normalizeWorkspace,
  validateWorkspace,
} from "../../shared/accounts.ts";
import type { Asset, Json, Snapshot } from "../../shared/types.ts";
import { AppError } from "../services/errors.ts";
import { HttpClient, object, readError, secureURL, str } from "./http.ts";
export function endpoint(s: Snapshot) {
  const workspace = normalizeWorkspace(s.account.workspaceId || "");
  const region = s.account.region.trim();
  if (s.provider.adapter === "alibaba") {
    try {
      validateWorkspace(workspace);
    } catch (e) {
      throw new AppError(
        "ValidationError",
        `账户“${s.account.name}”：${e instanceof Error ? e.message : "Workspace ID 无效"}`,
      );
    }
    if (
      ![
        "cn-beijing",
        "ap-southeast-1",
        "ap-northeast-1",
        "eu-central-1",
        "us-east-1",
        "cn-hongkong",
      ].includes(region)
    )
      throw new AppError(
        "ValidationError",
        "Region 不受当前百炼接入支持，请检查账户地域。",
      );
  }
  const template = (s.account.endpoint || s.provider.endpoint).trim();
  if (template.includes("/compatible-mode"))
    throw new AppError(
      "ValidationError",
      "WAN 视频生成不能使用 compatible-mode 聊天地址，请清空自定义 Endpoint 使用视频服务。",
    );
  const raw = template.replace(
    /\{(?:workspace|WorkspaceId|workspaceId|workspace_id|workspaceID)\}/g,
    workspace,
  );
  const u = secureURL(raw);
  if (s.provider.adapter === "alibaba") {
    if (
      !/(^|\.)(maas\.aliyuncs\.com|dashscope\.aliyuncs\.com|dashscope-intl\.aliyuncs\.com)$/.test(
        u.hostname,
      )
    )
      throw new AppError(
        "ValidationError",
        "Endpoint 必须是阿里云百炼官方域名。",
      );
    if (u.hostname.endsWith(".maas.aliyuncs.com"))
      u.hostname = `${workspace}.${region}.maas.aliyuncs.com`;
    u.pathname = u.pathname.replace(/\/api\/v1(?:\/.*)?$/, "");
  } else if (!/(^|\.)(volces\.com|bytepluses\.com)$/.test(u.hostname))
    throw new AppError(
      "ValidationError",
      "Endpoint 必须是当前官方 Provider 域名。",
    );
  if (u.search || u.hash)
    throw new AppError("ValidationError", "Endpoint 不能携带查询参数。");
  return u.toString().replace(/\/$/, "");
}

export interface ProviderAdapter {
  request(
    s: Snapshot,
    key: string,
    path: string,
    options?: Parameters<HttpClient["request"]>[2],
  ): Promise<Json>;
  upload(
    s: Snapshot,
    key: string,
    asset: Asset,
    signal?: AbortSignal,
  ): Promise<string>;
}
export class AlibabaProvider implements ProviderAdapter {
  http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }
  request(
    s: Snapshot,
    key: string,
    path: string,
    options?: Parameters<HttpClient["request"]>[2],
  ) {
    return this.http.request(endpoint(s) + path, key, options);
  }
  async upload(s: Snapshot, key: string, a: Asset, signal?: AbortSignal) {
    if (a.remoteUrl) {
      secureURL(a.remoteUrl);
      return a.remoteUrl;
    }
    const file = a.managedPath || a.originalPath;
    if (a.kind === "image")
      return `data:${a.mime};base64,${(await readFile(file)).toString("base64")}`;
    const policy = object(
      object(
        await this.request(
          s,
          key,
          `/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(s.model.officialId)}`,
          { signal },
        ),
      ).data,
    );
    const host = str(policy.upload_host);
    if (!secureURL(host).hostname.endsWith(".aliyuncs.com"))
      throw new AppError("UploadError", "上传地址不是阿里云官方存储。");
    if (a.size > Number(policy.max_file_size_mb) * 1024 * 1024)
      throw new AppError("UploadError", "素材超过当前上传凭证允许大小。");
    const objectKey = `${str(policy.upload_dir)}/${randomUUID()}-${basename(file)}`;
    const form = new FormData();
    for (const [k, v] of Object.entries({
      OSSAccessKeyId: policy.oss_access_key_id,
      policy: policy.policy,
      Signature: policy.signature,
      key: objectKey,
      "x-oss-object-acl": policy.x_oss_object_acl,
      "x-oss-forbid-overwrite": policy.x_oss_forbid_overwrite,
      success_action_status: "200",
    }))
      form.set(k, String(v));
    form.set(
      "file",
      new Blob([new Uint8Array(await readFile(file))], { type: a.mime }),
      basename(file),
    );
    const response = await this.http.fetcher(host, {
      method: "POST",
      body: form,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(300000)])
        : AbortSignal.timeout(300000),
      redirect: "error",
    });
    if (!response.ok) {
      const detail = await readError(response, key);
      const error = new AppError(
        "UploadError",
        `素材上传失败：HTTP ${detail.httpStatus} · ${detail.code}\n${detail.message}\nrequest_id: ${detail.requestId}`,
        response.status === 429 || response.status >= 500,
      );
      error.details = detail;
      throw error;
    }
    return `oss://${objectKey}`;
  }
}
export class VolcengineProvider implements ProviderAdapter {
  http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }
  request(
    s: Snapshot,
    key: string,
    path: string,
    options?: Parameters<HttpClient["request"]>[2],
  ) {
    return this.http.request(endpoint(s) + path, key, options);
  }
  async upload(_s: Snapshot, _key: string, a: Asset) {
    if (a.remoteUrl) {
      secureURL(a.remoteUrl);
      return a.remoteUrl;
    }
    if (a.kind === "image" || a.kind === "audio")
      return `data:${a.mime};base64,${(await readFile(a.managedPath || a.originalPath)).toString("base64")}`;
    throw new AppError(
      "UploadError",
      "此模型的视频需要官方可访问的素材 URL，请在资产详情填写。",
    );
  }
}
