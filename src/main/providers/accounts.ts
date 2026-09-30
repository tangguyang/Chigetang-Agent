import { brand } from "../../shared/brand.ts";
import { defaults } from "../../shared/catalog.ts";
import type {
  Account,
  ConnectionResult,
  Model,
  Provider,
  Snapshot,
} from "../../shared/types.ts";
import { toError } from "../services/errors.ts";
import { endpoint } from "./adapters.ts";
import { HttpClient } from "./http.ts";
export interface ProviderAccountAdapter {
  balance(): Promise<{ supported: boolean; message: string }>;
  test(s: Snapshot, key: string, http: HttpClient): Promise<string[]>;
}
class AlibabaAccount implements ProviderAccountAdapter {
  async balance() {
    return {
      supported: false,
      message: "该Provider暂不支持API余额实时查询（当前 API Key 接入）",
    };
  }
  async test(s: Snapshot, key: string, http: HttpClient) {
    await http.request(
      `${endpoint(s)}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(s.model.officialId)}`,
      key,
    );
    return [
      "本机密钥解密成功",
      "Workspace ID 与 Region 已读取",
      "视频 Endpoint 已构造",
      "当前模型上传鉴权接口可访问（未生成视频）",
      "生成权限与配额仍需首次真实任务确认",
    ];
  }
}
class VolcengineAccount extends AlibabaAccount {
  override async test(s: Snapshot, key: string, http: HttpClient) {
    await http.request(
      `${endpoint(s)}/contents/generations/tasks?page_size=1`,
      key,
    );
    return [
      "本机密钥解密成功",
      "视频任务查询接口可访问（未创建任务）",
      "具体型号生成权限仍需首次真实任务确认",
    ];
  }
}
export function accountAdapter(provider: Provider): ProviderAccountAdapter {
  return provider.adapter === "alibaba"
    ? new AlibabaAccount()
    : new VolcengineAccount();
}
export async function testConnection(
  account: Account,
  model: Model,
  provider: Provider,
  key: () => string,
  http = new HttpClient(),
): Promise<ConnectionResult> {
  const result: ConnectionResult = {
    ok: false,
    accountId: account.id,
    accountName: account.name,
    keyLoaded: false,
    workspaceId: account.workspaceId,
    region: account.region,
    endpoint: "",
    model: model.officialId,
    checks: [],
  };
  try {
    const secret = key();
    result.keyLoaded = Boolean(secret);
    if (!secret) throw new Error("API Key 为空");
    const s: Snapshot = {
      account,
      model,
      provider,
      assets: [],
      price: model.price,
      estimatedCost: {
        amount: null,
        currency: model.price.currency,
        kind: "unknown",
        note: "",
      },
      createdAt: new Date().toISOString(),
      appVersion: brand.version,
      draft: {
        name: "连接测试",
        modelId: model.id,
        accountId: account.id,
        prompt: "",
        params: defaults(model),
        assets: [],
        projectId: null,
        outputDir: "",
      },
    };
    result.endpoint = endpoint(s);
    result.checks = await accountAdapter(provider).test(s, secret, http);
    result.ok = true;
  } catch (e) {
    const error = toError(e);
    result.error = error.message;
    result.details = error.details;
  }
  return result;
}
