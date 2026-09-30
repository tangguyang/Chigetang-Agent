import type { ApiErrorDetails } from "../../shared/types.ts";
export type ErrorCode =
  | "AuthenticationError"
  | "RateLimitError"
  | "NetworkError"
  | "ValidationError"
  | "UploadError"
  | "ProviderError"
  | "TaskFailedError"
  | "DownloadError"
  | "AssetMissingError"
  | "SubmissionUnknown"
  | "StorageError";
export class AppError extends Error {
  details?: ApiErrorDetails;
  code: ErrorCode;
  retryable: boolean;
  status?: number;
  constructor(
    code: ErrorCode,
    message: string,
    retryable = false,
    status?: number,
  ) {
    super(message);
    this.name = code;
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}
export function toError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new AppError(
    /ENOENT/.test(message)
      ? "AssetMissingError"
      : /ENOSPC|SQLITE_FULL|EACCES/.test(message)
        ? "StorageError"
        : "ProviderError",
    /ENOSPC|SQLITE_FULL/.test(message)
      ? "磁盘空间不足，请释放空间后重试。"
      : message,
  );
}
export function httpError(status: number): AppError {
  if (status === 401 || status === 403)
    return new AppError(
      "AuthenticationError",
      status === 401
        ? "API Key 无效或已过期，请在“模型与 API”重新输入。"
        : "账户没有访问权限，请检查模型开通状态、地域和业务空间。",
      false,
      status,
    );
  if (status === 402)
    return new AppError(
      "ProviderError",
      "账户余额或套餐额度不足，请在百炼检查账单、充值或开通模型后重试。",
      false,
      status,
    );
  if (status === 404)
    return new AppError(
      "ProviderError",
      "模型或接口不存在。请核对模型 ID、Endpoint 和账户地域后重试。",
      false,
      status,
    );
  if (status === 429)
    return new AppError(
      "RateLimitError",
      "当前账户请求频率过高，请稍后重试或降低任务并发。",
      true,
      status,
    );
  return new AppError(
    status === 400 ? "ValidationError" : "ProviderError",
    status === 400
      ? "输入不符合模型要求，请检查素材、参数和账户地域。"
      : `服务暂时不可用（${status}）。`,
    status >= 500,
    status,
  );
}
