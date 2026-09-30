import { requestedWanPrice, validatePrice } from "../../shared/pricing.ts";
import { randomUUID } from "node:crypto";
import {
  normalizeWorkspace,
  validateWorkspace,
} from "../../shared/accounts.ts";
import type { Account } from "../../shared/types.ts";
import type { Database } from "../database/db.ts";
import { AppError } from "./errors.ts";
export interface Vault {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
  getSelectedStorageBackend?(): string;
}
export class CredentialManager {
  db: Database;
  vault: Vault;
  constructor(db: Database, vault: Vault) {
    this.db = db;
    this.vault = vault;
  }
  list() {
    return this.db
      .all<{ data: string }>("SELECT data FROM credentials")
      .map((r) => {
        const a = JSON.parse(r.data) as Account & {
          workspace_id?: string;
          workspaceID?: string;
        };
        return {
          ...a,
          workspaceId: normalizeWorkspace(
            a.workspaceId || a.workspace_id || a.workspaceID || "",
          ),
          region: (a.region || "cn-beijing").trim(),
          endpoint: (a.endpoint || "").trim(),
        };
      });
  }
  save(
    input: Partial<Account> & {
      key?: string;
      workspace_id?: string;
      workspaceID?: string;
    },
  ) {
    const id = input.id || randomUUID();
    const prev = this.list().find((a) => a.id === id);
    input = {
      ...prev,
      ...input,
      workspaceId: normalizeWorkspace(
        input.workspaceId ??
          input.workspace_id ??
          input.workspaceID ??
          prev?.workspaceId ??
          "",
      ),
      region: (input.region ?? prev?.region ?? "cn-beijing").trim(),
      endpoint: (input.endpoint ?? prev?.endpoint ?? "").trim(),
    };
    if (prev && input.providerId !== prev.providerId)
      throw new AppError(
        "ValidationError",
        "已有账户不能更换服务商，请新建账户，历史任务仍引用原账户。",
      );
    if (!input.name?.trim() || !input.providerId)
      throw new AppError("ValidationError", "请输入账户名称并选择服务商。");
    if (!prev && !input.key?.trim())
      throw new AppError("AuthenticationError", "请输入 API Key。");
    if (
      !this.vault.isEncryptionAvailable() ||
      (process.platform === "linux" &&
        this.vault.getSelectedStorageBackend?.() === "basic_text")
    )
      throw new AppError(
        "AuthenticationError",
        "系统安全凭据服务不可用，无法安全保存 API Key。",
      );
    if (input.providerId === "alibaba")
      validateWorkspace(input.workspaceId ?? "");
    let blob: Buffer;
    if (input.key?.trim()) {
      blob = this.vault.encryptString(input.key.trim());
    } else {
      const row = this.db.one<{ encrypted: Uint8Array }>(
        "SELECT encrypted FROM credentials WHERE id=?",
        id,
      );
      if (!row)
        throw new AppError("AuthenticationError", "请重新输入 API Key。");
      blob = Buffer.from(row.encrypted);
    }
    for (const price of Object.values(input.modelPrices ?? {}))
      validatePrice(price);
    const account: Account = {
      modelPrices:
        input.modelPrices ??
        (input.providerId === "alibaba" ? { wan3: requestedWanPrice() } : {}),
      id,
      name: input.name.trim(),
      providerId: input.providerId,
      workspaceId: input.workspaceId ?? "",
      region: input.region ?? "cn-beijing",
      endpoint: input.endpoint ?? "",
      notes: input.notes ?? "",
      manualBalance: input.manualBalance ?? "",
      enabled: input.enabled ?? true,
      isDefault: input.isDefault ?? false,
      maxConcurrent: Math.max(1, Math.min(10, input.maxConcurrent ?? 2)),
      createdAt: prev?.createdAt ?? new Date().toISOString(),
      maskedKey: input.key
        ? `•••• ${input.key.trim().slice(-4)}`
        : (prev?.maskedKey ?? "••••"),
    };
    this.db.transaction(() => {
      if (account.isDefault)
        for (const other of this.list().filter(
          (x) => x.providerId === account.providerId,
        )) {
          other.isDefault = false;
          this.db.run(
            "UPDATE credentials SET data=? WHERE id=?",
            JSON.stringify(other),
            other.id,
          );
        }
      this.db.run(
        "INSERT INTO credentials VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,encrypted=excluded.encrypted",
        id,
        JSON.stringify(account),
        blob,
      );
    });
    return account;
  }
  getKey(id: string) {
    const r = this.db.one<{ encrypted: Uint8Array }>(
      "SELECT encrypted FROM credentials WHERE id=?",
      id,
    );
    if (!r)
      throw new AppError("AuthenticationError", "账户不存在，请重新选择。");
    try {
      return this.vault.decryptString(Buffer.from(r.encrypted));
    } catch {
      throw new AppError(
        "AuthenticationError",
        "凭据属于另一台电脑或 Windows 用户，请重新输入 API Key。",
      );
    }
  }
}
