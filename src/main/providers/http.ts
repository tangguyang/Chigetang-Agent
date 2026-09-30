import type { Json } from "../../shared/types.ts";
import { AppError, httpError } from "../services/errors.ts";
import type { Logger } from "../services/logger.ts";
export type Fetcher = typeof fetch;
export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const t = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
export function secureURL(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:")
    throw new AppError("ValidationError", "服务地址必须使用 HTTPS。");
  if (u.username || u.password)
    throw new AppError("ValidationError", "地址不能包含凭据。");
  return u;
}
export class HttpClient {
  fetcher: Fetcher;
  logger?: Logger;
  maxRetries: number;
  constructor(fetcher: Fetcher = fetch, logger?: Logger, maxRetries = 3) {
    this.fetcher = fetcher;
    this.logger = logger;
    this.maxRetries = maxRetries;
  }
  async request(
    url: string,
    key: string,
    options: {
      method?: string;
      body?: Json;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      paidSubmit?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<Json> {
    secureURL(url);
    const method = options.method ?? "GET";
    const timeoutMs =
      options.timeoutMs ?? (options.paidSubmit ? 180000 : 60000);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        const requestSignal = options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs);
        response = await this.fetcher(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            ...options.headers,
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          signal: requestSignal,
          redirect: "error",
        });
      } catch (e) {
        if (options.signal?.aborted) throw e;
        if (options.paidSubmit) {
          const timeout =
            e instanceof Error &&
            (e.name === "TimeoutError" || /timeout/i.test(e.message));
          throw new AppError(
            "SubmissionUnknown",
            timeout
              ? `提交接口在 ${Math.ceil(timeoutMs / 1000)} 秒内未返回任务 ID。云端可能已受理，已暂停以防重复扣费；请先到控制台核对任务，再决定是否重新生成。`
              : "提交连接中断，云端可能已受理。已暂停以防重复扣费；请先到控制台核对任务，再决定是否重新生成。",
          );
        }
        if (attempt < this.maxRetries) {
          await sleep(Math.min(30000, 1000 * 2 ** attempt), options.signal);
          continue;
        }
        throw new AppError(
          "NetworkError",
          "网络连接中断或请求超时，请检查连接后恢复查询。",
          true,
        );
      }
      this.logger?.write("api", "http_response", {
        status: response.status,
        method,
        attempt,
      });
      if (!response.ok) {
        const err = httpError(response.status);
        const details = await readError(response, key);
        err.details = details;
        err.message += `\nHTTP ${details.httpStatus} · code: ${details.code}\nmessage: ${details.message}\nrequest_id: ${details.requestId}`;
        if (options.paidSubmit && response.status >= 500) {
          const unknown = new AppError(
            "SubmissionUnknown",
            `提交结果不明，已暂停以防重复扣费。\n${err.message}`,
          );
          unknown.details = details;
          throw unknown;
        }
        if (err.retryable && attempt < this.maxRetries) {
          const retry = Number(response.headers.get("retry-after"));
          await sleep(
            Math.min(60000, retry > 0 ? retry * 1000 : 1000 * 2 ** attempt),
            options.signal,
          );
          continue;
        }
        throw err;
      }
      try {
        if (response.status === 204) return {};
        const raw = (await response.json()) as Json;
        return key
          ? (JSON.parse(
              JSON.stringify(raw).replaceAll(key, "[REDACTED]"),
            ) as Json)
          : raw;
      } catch {
        throw new AppError(
          options.paidSubmit ? "SubmissionUnknown" : "ProviderError",
          "服务返回格式异常，请核对云端状态。",
        );
      }
    }
  }
}
export function object(v: Json): Record<string, Json> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new AppError("ProviderError", "服务返回数据格式不正确。");
  return v;
}
export function str(v: Json | undefined) {
  return typeof v === "string" ? v : "";
}

export function redact(text: string, key = "") {
  return (key ? text.replaceAll(key, "[REDACTED]") : text).replace(
    /Bearer\s+\S+|sk-[A-Za-z0-9_-]+/g,
    "[REDACTED]",
  );
}
export async function readError(response: Response, key: string) {
  let raw: Record<string, unknown> = {};
  let text = "";
  try {
    text = await response.text();
    const value = JSON.parse(text);
    if (value && typeof value === "object") raw = value;
  } catch {}
  const nested =
    raw.error && typeof raw.error === "object"
      ? (raw.error as Record<string, unknown>)
      : raw;
  const clean = (v: unknown, fallback: string) =>
    redact(v === undefined ? fallback : String(v), key).slice(0, 2000);
  return {
    httpStatus: response.status,
    code: clean(nested.code ?? raw.Code, "未返回"),
    message: clean(
      nested.message ?? raw.Message,
      text || response.statusText || "未返回",
    ),
    requestId: clean(
      raw.request_id ??
        raw.requestId ??
        raw.RequestId ??
        response.headers.get("x-request-id") ??
        response.headers.get("x-dashscope-request-id"),
      "未返回",
    ),
  };
}
