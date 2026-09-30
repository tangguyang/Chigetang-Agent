import { TaskService } from './tasks.ts';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access,mkdir } from 'node:fs/promises';
import { normalizeDraft,autoBindMentions,compilePrompt } from '../../shared/mentions.ts';
import { accountPrice,selectPrice } from '../../shared/pricing.ts';
import type { Draft,Snapshot,Asset,Task } from '../../shared/types.ts';
import { AppError } from './errors.ts';
import { engineEndpoint } from '../models/engineAdapters.ts';
import { estimateCost } from './cost.ts';
import { recordBilling } from './billing.ts';
export class EngineTaskService extends TaskService {
  async create(
    draft: Draft,
    requestId: string,
    exactSnapshot?: Snapshot,
    deferQueue = false,
  ) {
    const selected=exactSnapshot?.model ?? this.d.models().find(m=>m.id===draft.modelId);
    if(!selected || !['kling','wan-safe','seedance'].includes(selected.adapter))return super.create(draft,requestId,exactSnapshot,deferQueue);
    if (!requestId || requestId.length > 100)
      throw new AppError("ValidationError", "任务请求无效。");
    draft = normalizeDraft(draft);
    const oldId = this.d.db.get<string | null>("request:" + requestId, null);
    if (oldId) return this.get(oldId);
    const model =
      exactSnapshot?.model ??
      this.d.models().find((m) => m.id === draft.modelId);
    if (!model) throw new AppError("ValidationError", "请先选择模型。");

    const provider =
      exactSnapshot?.provider ??
      this.d.providers().find((p) => p.id === model.providerId);
    if (!provider || !provider.enabled)
      throw new AppError("ValidationError", "服务商尚未启用。");
    const accounts = this.d.credentials
      .list()
      .filter((a) => a.enabled && a.providerId === provider.id);
    const account =
      draft.accountId === "auto"
        ? accounts.sort(
            (a, b) =>
              Number(b.isDefault) - Number(a.isDefault) ||
              this.accountLoad(a.id) - this.accountLoad(b.id),
          )[0]
        : accounts.find((a) => a.id === draft.accountId);
    if (!account)
      throw new AppError(
        "AuthenticationError",
        "请先在“模型与 API”添加可用账户。",
      );
    this.d.credentials.getKey(account.id);
    const libraryAssets: Asset[] = [];
    for (const binding of draft.assets)
      libraryAssets.push(
        model.adapter === "wan-safe"
          ? await this.d.assets.refreshMetadata(binding.assetId)
          : this.d.assets.get(binding.assetId),
      );
    draft = autoBindMentions(draft, libraryAssets);
    const assets = draft.assets.map((binding) => ({
      ...libraryAssets.find((asset) => asset.id === binding.assetId)!,
      role: binding.role,
    }));
    const s: Snapshot = {
      draft: { ...structuredClone(draft), accountId: account.id },
      model: structuredClone(model),
      provider: structuredClone(provider),
      account: structuredClone(account),
      assets,
      price: structuredClone(
        accountPrice(
          this.d.models().find((m) => m.id === model.id) ?? model,
          account,
        ),
      ),
      estimatedCost: {
        amount: null,
        currency: model.price.currency,
        kind: "unknown",
        note: "",
      },
      appVersion: "1.2.8",
      createdAt: new Date().toISOString(),
    };
    const adapter = this.d.adapter(model);
    engineEndpoint(s);
    compilePrompt(s.draft, s.assets, s.model.adapter);
    adapter.validateInput(s);
    s.price = selectPrice(s.price, s.draft, s.assets, s.account.region);
    for (const a of assets) await this.d.assets.verify(a);
    s.estimatedCost = estimateCost({ ...s, region: s.account.region });
    const dir =
      this.d.resolvePath?.(draft.outputDir || this.d.settings().outputDir) ??
      (draft.outputDir || this.d.settings().outputDir);
    if (!dir) throw new AppError("ValidationError", "请选择输出目录。");
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK).catch(() => {
      throw new AppError("StorageError", "输出目录不可写，请更换保存位置。");
    });
    s.draft.outputDir = dir;
    return this.d.db.transaction(() => {
      const existing = this.d.db.get<string | null>(
        "request:" + requestId,
        null,
      );
      if (existing) return this.get(existing);
      const parent = draft.parentVersionId
        ? this.get(draft.parentVersionId)
        : null;
      const groupId = parent?.groupId ?? randomUUID();
      const version =
        (this.d.db.one<{ v: number }>(
          "SELECT max(version) v FROM task_versions WHERE task_id=?",
          groupId,
        )?.v ?? 0) + 1;
      const id = randomUUID(),
        now = new Date().toISOString();
      const t: Task = {
        id,
        groupId,
        version,
        parentTaskId: parent?.groupId ?? null,
        parentVersionId: parent?.id ?? null,
        name:
          draft.name.trim() || `视频任务 ${now.slice(5, 16).replace("T", " ")}`,
        status: deferQueue ? "Draft" : "Queued",
        snapshot: s,
        apiTaskId: null,
        createdAt: now,
        submittedAt: null,
        completedAt: null,
        updatedAt: now,
        outputPath: null,
        resultUrl: null,
        rawResult: null,
        error: null,
        errorCode: null,
        downloadStatus: "none",
        cost: s.estimatedCost,
        progress: null,
        nextPollAt: 0,
        retryCount: 0,
        deletedAt: null,
      };
      this.d.db.run(
        "INSERT OR IGNORE INTO tasks VALUES(?,?,?)",
        groupId,
        t.name,
        now,
      );
      const { snapshot, ...mutable } = t;
      this.d.db.run(
        "INSERT INTO task_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        groupId,
        t.parentTaskId,
        t.parentVersionId,
        version,
        t.status,
        provider.id,
        model.id,
        account.id,
        draft.projectId,
        now,
        null,
        JSON.stringify(mutable),
      );
      this.d.db.run(
        "INSERT INTO task_snapshots VALUES(?,?)",
        id,
        JSON.stringify(s),
      );
      this.d.db.run(
        "INSERT INTO price_snapshots VALUES(?,?)",
        id,
        JSON.stringify(s.price),
      );
      this.d.db.run(
        "INSERT INTO usage_records VALUES(?,?,?,?)",
        id,
        t.cost.currency,
        t.cost.amount,
        t.cost.kind,
      );
      assets.forEach((a, index) => {
        this.d.db.run(
          "INSERT INTO task_assets VALUES(?,?,?,?)",
          id,
          a.id,
          a.role,
          index,
        );
      });
      recordBilling(this.d.db, t);
      this.d.db.set("request:" + requestId, id);
      this.d.db.set("recentModel:" + model.id, now);
      this.d.changed();
      return t;
    });
  }
}
