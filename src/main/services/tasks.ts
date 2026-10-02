import { brand } from "../../shared/brand.ts";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  autoBindMentions,
  compilePrompt,
  normalizeDraft,
} from "../../shared/mentions.ts";
import { selectPrice } from "../../shared/pricing.ts";
import type {
  Asset,
  Draft,
  ListQuery,
  Model,
  Page,
  Provider,
  Settings,
  Snapshot,
  Task,
} from "../../shared/types.ts";
import type { Database } from "../database/db.ts";
import type { ModelAdapter } from "../models/adapters.ts";
import { endpoint } from "../providers/adapters.ts";
import type { AssetManager } from "./assets.ts";
import { recordBilling } from "./billing.ts";
import { accountPrice, costBreakdown } from "../../shared/pricing.ts";
import { AUTO_VIDEO_NAME, videoStem } from "../../shared/filenames.ts";
import { estimateCost, finalCost } from "./cost.ts";
import type { CredentialManager } from "./credentials.ts";
import { AppError, toError } from "./errors.ts";
import type { Logger } from "./logger.ts";
import {
  planSegments,
  promptForSegment,
  segmentLimit,
} from "../../shared/segmentation.ts";
import {
  concatVideoWithAudio,
  detectSilenceCuts,
  trimMediaSegment,
} from "./transcode.ts";
export interface TaskDependencies {
  db: Database;
  assets: AssetManager;
  credentials: CredentialManager;
  models: () => Model[];
  providers: () => Provider[];
  settings: () => Settings;
  adapter: (model: Model) => ModelAdapter;
  logger: Logger;
  changed: () => void;
  notify: (task: Task) => void;
  resolvePath?: (path: string) => string;
}
export class TaskService {
  d: TaskDependencies;
  active = new Map<string, Task>();
  controllers = new Map<string, AbortController>();
  timer?: NodeJS.Timeout;
  stopped = false;
  tickBusy = false;
  finalizing = new Set<string>();
  wanAudioTrims = new Map<string, Promise<Asset>>();
  segmentPreparations = new Map<string, Promise<Task>>();
  constructor(d: TaskDependencies) {
    this.d = d;
  }
  get(id: string): Task {
    const row = this.d.db.one<{ data: string; snapshot: string }>(
      "SELECT v.data,s.data snapshot FROM task_versions v JOIN task_snapshots s ON s.version_id=v.id WHERE v.id=?",
      id,
    );
    if (!row) throw new AppError("ValidationError", "任务不存在。");
    const task = {
      type: "video",
      outputs: [],
      ...JSON.parse(row.data),
      snapshot: JSON.parse(row.snapshot),
    } as Task;
    if (task.outputPath && this.d.resolvePath)
      task.outputPath = this.d.resolvePath(task.outputPath);
    if (this.d.resolvePath)
      task.outputs = task.outputs?.map((a) => ({
        ...a,
        localPath: this.d.resolvePath!(a.localPath),
      }));
    return task;
  }
  save(t: Task) {
    t.updatedAt = new Date().toISOString();
    const { snapshot, ...mutable } = t;
    this.d.db.transaction(() => {
      this.d.db.run(
        "UPDATE task_versions SET status=?,deleted_at=?,data=? WHERE id=?",
        t.status,
        t.deletedAt,
        JSON.stringify(mutable),
        t.id,
      );
      this.d.db.run(
        "INSERT INTO usage_records VALUES(?,?,?,?) ON CONFLICT(version_id) DO UPDATE SET currency=excluded.currency,amount=excluded.amount,kind=excluded.kind",
        t.id,
        t.cost.currency,
        t.cost.amount,
        t.cost.kind,
      );
      if (t.rawResult)
        this.d.db.run(
          "INSERT INTO task_results VALUES(?,?) ON CONFLICT(version_id) DO UPDATE SET data=excluded.data",
          t.id,
          JSON.stringify(t.rawResult),
        );
      this.d.db.run(
        "INSERT INTO downloads VALUES(?,?) ON CONFLICT(version_id) DO UPDATE SET data=excluded.data",
        t.id,
        JSON.stringify({
          status: t.downloadStatus,
          path: t.outputPath,
          url: t.resultUrl,
        }),
      );
    });
    recordBilling(this.d.db, t);
    this.d.logger.write("task", "state", { id: t.id, status: t.status });
    this.d.changed();
  }
  estimate(draft: Draft) {
    const model = this.d.models().find((m) => m.id === draft.modelId);
    if (!model) throw new Error("模型不存在");
    const accounts = this.d.credentials
      .list()
      .filter((a) => a.enabled && a.providerId === model.providerId);
    const account =
      draft.accountId === "auto"
        ? accounts.sort(
            (a, b) =>
              Number(b.isDefault) - Number(a.isDefault) ||
              this.accountLoad(a.id) - this.accountLoad(b.id),
          )[0]
        : accounts.find((a) => a.id === draft.accountId);
    const assets = draft.assets.map((b) => ({
      ...this.d.assets.get(b.assetId),
      role: b.role,
    }));
    return {
      cost: estimateCost({
        price: accountPrice(model, account),
        draft,
        assets,
        region: account?.region,
      }),
      breakdown: costBreakdown({
        price: accountPrice(model, account),
        draft,
        assets,
        region: account?.region,
      }),
      accountId: account?.id,
      accountName: account?.name,
      region: account?.region,
    };
  }

  async segmentPlan(draft: Draft) {
    const model = this.d.models().find((item) => item.id === draft.modelId);
    if (!model || model.adapter !== "wan3")
      throw new AppError(
        "ValidationError",
        "当前只有 Wan 长素材任务支持自动分段复刻。",
      );
    const media = draft.assets
      .map((binding) => ({
        binding,
        asset: this.d.assets.get(binding.assetId),
      }))
      .filter(({ asset }) => asset.kind === "video" || asset.kind === "audio");
    const totalSeconds = Math.max(
      0,
      ...media.map(({ asset }) => asset.duration ?? 0),
    );
    const maxSeconds = segmentLimit(model);
    const audio = media.find(({ asset }) => asset.kind === "audio")?.asset;
    const preferredCuts = audio
      ? await detectSilenceCuts(
          await this.d.assets.verify(audio, false),
          this.d.settings().ffmpegPath,
        )
      : [];
    const segments = planSegments(totalSeconds, maxSeconds, preferredCuts);
    const costs = segments.map((segment) => {
      const copy = structuredClone(draft);
      copy.params.duration = Math.max(2, Math.ceil(segment.duration));
      return this.estimate(copy).cost;
    });
    const known = costs.every((cost) => cost.amount !== null);
    return {
      totalSeconds,
      maxSeconds,
      segments,
      calls: segments.length,
      cost: {
        amount: known
          ? costs.reduce((sum, cost) => sum + (cost.amount ?? 0), 0)
          : null,
        currency: costs[0]?.currency ?? model.price.currency,
        kind: known ? ("estimate" as const) : ("unknown" as const),
        note: known ? "自动分段调用费用合计" : "以官方账单为准",
      },
    };
  }

  async createSegmented(draft: Draft, requestId: string) {
    const active = this.segmentPreparations.get(requestId);
    if (active) return active;
    const pending = this.createSegmentedOnce(draft, requestId).finally(() =>
      this.segmentPreparations.delete(requestId),
    );
    this.segmentPreparations.set(requestId, pending);
    return pending;
  }

  private async createSegmentedOnce(draft: Draft, requestId: string) {
    if (!requestId || requestId.length > 100)
      throw new AppError("ValidationError", "任务请求无效。");
    const previous = this.d.db.get<string | null>(
      "segment-request:" + requestId,
      null,
    );
    if (previous) return this.get(previous);
    draft = normalizeDraft(draft);
    const plan = await this.segmentPlan(draft);
    if (plan.segments.length < 2)
      throw new AppError(
        "ValidationError",
        "当前素材可以单次生成，无需自动分段。",
      );
    const parentId = randomUUID();
    const folder = join(this.d.settings().otherDir!, "segments", parentId);
    await mkdir(folder, { recursive: true });
    const created: Task[] = [];
    try {
      for (const segment of plan.segments) {
        const segmentAssets = [];
        const segmentBindings = [];
        for (const binding of draft.assets) {
          const source = this.d.assets.get(binding.assetId);
          if (source.kind !== "video" && source.kind !== "audio") {
            segmentAssets.push(source);
            segmentBindings.push(binding);
            continue;
          }
          const input = await this.d.assets.verify(source, false);
          const extension = source.kind === "video" ? ".mp4" : ".wav";
          const output = join(
            folder,
            `${source.kind}-${segment.index}-${source.id}${extension}`,
          );
          await trimMediaSegment(
            input,
            output,
            segment.start,
            segment.duration,
            source.kind,
            this.d.settings().ffmpegPath,
          );
          const imported = await this.d.assets.import(output, false);
          imported.asset.name = `${source.name} · Segment${segment.index}`;
          imported.asset.metadata = {
            ...imported.asset.metadata,
            source: "segment-temp",
            parentTaskId: parentId,
            sourceAssetId: source.id,
          };
          this.d.assets.save(imported.asset);
          segmentAssets.push(imported.asset);
          segmentBindings.push({ ...binding, assetId: imported.asset.id });
        }
        let segmentDraft: Draft = {
          ...structuredClone(draft),
          draftId: randomUUID(),
          name: `${draft.name || "视频复刻"} · Segment${segment.index}`,
          prompt: promptForSegment(draft.prompt, segment),
          mentions: [],
          assets: segmentBindings,
          params: {
            ...draft.params,
            duration: Math.max(2, Math.ceil(segment.duration)),
            ...(Object.hasOwn(draft.params, "prompt_extend")
              ? { prompt_extend: false }
              : {}),
            ...(Object.hasOwn(draft.params, "audio") ? { audio: false } : {}),
            ...(Object.hasOwn(draft.params, "generate_audio")
              ? { generate_audio: false }
              : {}),
          },
          parentVersionId: undefined,
          groupId: undefined,
        };
        segmentDraft = autoBindMentions(segmentDraft, segmentAssets);
        const child = await this.create(
          segmentDraft,
          `${requestId}-segment-${segment.index}`,
          undefined,
          true,
        );
        child.parentTaskId = parentId;
        child.segment = {
          ...segment,
          count: plan.segments.length,
          parentId,
        };
        created.push(child);
      }
      const first = created[0];
      const now = new Date().toISOString();
      const snapshot: Snapshot = {
        ...structuredClone(first.snapshot),
        draft: {
          ...structuredClone(draft),
          outputDir: this.d.resolvePath?.(draft.outputDir) ?? draft.outputDir,
        },
        assets: draft.assets.map((binding) => ({
          ...this.d.assets.get(binding.assetId),
          role: binding.role,
        })),
        estimatedCost: plan.cost,
        appVersion: brand.version,
        createdAt: now,
      };
      const parent: Task = {
        id: parentId,
        groupId: parentId,
        version: 1,
        parentTaskId: null,
        parentVersionId: null,
        name:
          draft.name.trim() ||
          `自动分段复刻 ${now.slice(5, 16).replace("T", " ")}`,
        type: "video-group",
        outputs: [],
        status: "Processing",
        snapshot,
        apiTaskId: null,
        createdAt: now,
        submittedAt: now,
        completedAt: null,
        updatedAt: now,
        outputPath: null,
        resultUrl: null,
        rawResult: JSON.parse(JSON.stringify({ segments: plan.segments })),
        error: null,
        errorCode: null,
        downloadStatus: "none",
        cost: plan.cost,
        progress: 0,
        nextPollAt: 0,
        retryCount: 0,
        deletedAt: null,
      };
      this.d.db.transaction(() => {
        this.d.db.run(
          "INSERT INTO tasks VALUES(?,?,?)",
          parentId,
          parent.name,
          now,
        );
        const { snapshot: immutable, ...mutable } = parent;
        this.d.db.run(
          "INSERT INTO task_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          parentId,
          parentId,
          null,
          null,
          1,
          parent.status,
          snapshot.provider.id,
          snapshot.model.id,
          snapshot.account.id,
          draft.projectId,
          now,
          null,
          JSON.stringify(mutable),
        );
        this.d.db.run(
          "INSERT INTO task_snapshots VALUES(?,?)",
          parentId,
          JSON.stringify(immutable),
        );
        this.d.db.run(
          "INSERT INTO price_snapshots VALUES(?,?)",
          parentId,
          JSON.stringify(snapshot.price),
        );
        this.d.db.run(
          "INSERT INTO usage_records VALUES(?,?,?,?)",
          parentId,
          parent.cost.currency,
          parent.cost.amount,
          parent.cost.kind,
        );
        snapshot.assets.forEach((asset, index) =>
          this.d.db.run(
            "INSERT INTO task_assets VALUES(?,?,?,?)",
            parentId,
            asset.id,
            asset.role,
            index,
          ),
        );
        for (const child of created) {
          child.status = "Queued";
          child.updatedAt = now;
          const { snapshot: _snapshot, ...mutable } = child;
          this.d.db.run(
            "UPDATE task_versions SET parent_task_id=?,status=?,data=? WHERE id=?",
            parentId,
            child.status,
            JSON.stringify(mutable),
            child.id,
          );
        }
        this.d.db.set("segment-request:" + requestId, parentId);
      });
      recordBilling(this.d.db, parent);
      this.d.changed();
      return parent;
    } catch (error) {
      for (const task of created) {
        task.status = "Cancelled";
        task.error = "自动分段创建未完成，已停止提交。";
        task.deletedAt = new Date().toISOString();
        this.save(task);
      }
      throw error;
    }
  }

  children(parentId: string) {
    const all = this.d.db
      .all<{
        id: string;
      }>(
        "SELECT id FROM task_versions WHERE parent_task_id=? AND deleted_at IS NULL ORDER BY created_at",
        parentId,
      )
      .map((row) => this.get(row.id));
    const latest = new Map<number, Task>();
    for (const task of all)
      if (task.segment) latest.set(task.segment.index, task);
    return [...latest.values()].sort(
      (a, b) => (a.segment?.index ?? 0) - (b.segment?.index ?? 0),
    );
  }

  async retrySegment(id: string, requestId: string) {
    const original = this.get(id);
    if (!original.segment?.parentId)
      throw new AppError("ValidationError", "当前任务不是分段子任务。");
    if (!["Failed", "Cancelled", "Paused"].includes(original.status))
      throw new AppError("ValidationError", "只能重试失败或已停止的分段。");
    const child = await this.create(
      this.cloneDraft(id, true),
      requestId,
      original.snapshot,
    );
    child.parentTaskId = original.segment.parentId;
    child.segment = original.segment;
    this.save(child);
    this.d.db.run(
      "UPDATE task_versions SET parent_task_id=? WHERE id=?",
      original.segment.parentId,
      child.id,
    );
    const parent = this.get(original.segment.parentId);
    parent.status = "Processing";
    parent.error = null;
    parent.errorCode = null;
    this.save(parent);
    return child;
  }
  async create(
    draft: Draft,
    requestId: string,
    exactSnapshot?: Snapshot,
    deferQueue = false,
  ) {
    if (!requestId || requestId.length > 100)
      throw new AppError("ValidationError", "任务请求无效。");
    draft = normalizeDraft(draft);
    const oldId = this.d.db.get<string | null>("request:" + requestId, null);
    if (oldId) return this.get(oldId);
    const model =
      exactSnapshot?.model ??
      this.d.models().find((m) => m.id === draft.modelId);
    if (!model) throw new AppError("ValidationError", "请先选择模型。");
    draft = await this.prepareWanReferenceAudio(draft, model);
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
        model.adapter === "wan3"
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
      appVersion: brand.version,
      createdAt: new Date().toISOString(),
    };
    const adapter = this.d.adapter(model);
    endpoint(s);
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
  accountLoad(id: string) {
    return [...this.active.values()].filter((t) => t.snapshot.account.id === id)
      .length;
  }
  list(q: ListQuery = {}): Page<Task> {
    const w = ["v.deleted_at IS NULL"],
      p: (string | number)[] = [];
    for (const [k, v] of [
      ["status", q.status],
      ["model_id", q.modelId],
      ["provider_id", q.providerId],
      ["account_id", q.accountId],
      ["project_id", q.projectId],
    ] as const) {
      if (v) {
        w.push(`v.${k}=?`);
        p.push(v);
      }
    }
    if (q.kind) {
      if (q.kind === "video")
        w.push(
          "COALESCE(json_extract(v.data,'$.type'),'video') IN ('video','video-group')",
        );
      else {
        w.push("COALESCE(json_extract(v.data,'$.type'),'video')=?");
        p.push(q.kind);
      }
    }
    if (q.search) {
      w.push("(t.name LIKE ? OR s.data LIKE ?)");
      p.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.from) {
      w.push("v.created_at>=?");
      p.push(q.from);
    }
    if (q.to) {
      w.push("v.created_at<=?");
      p.push(q.to);
    }
    const sql = `FROM task_versions v JOIN tasks t ON t.id=v.task_id JOIN task_snapshots s ON s.version_id=v.id WHERE ${w.join(" AND ")}`;
    const total =
      this.d.db.one<{ n: number }>(`SELECT count(*) n ${sql}`, ...p)?.n ?? 0;
    const size = Math.min(100, q.pageSize ?? 30);
    return {
      total,
      items: this.d.db
        .all<{
          id: string;
        }>(
          `SELECT v.id ${sql} ORDER BY v.created_at DESC LIMIT ? OFFSET ?`,
          ...p,
          size,
          ((q.page ?? 1) - 1) * size,
        )
        .map((r) => this.get(r.id)),
    };
  }
  versions(id: string) {
    const task = this.get(id);
    return this.d.db
      .all<{
        id: string;
      }>(
        "SELECT id FROM task_versions WHERE task_id=? ORDER BY version",
        task.groupId,
      )
      .map((r) => this.get(r.id));
  }
  cloneDraft(id: string, independent = false): Draft {
    const t = this.get(id);
    return {
      ...structuredClone(t.snapshot.draft),
      draftId: randomUUID(),
      name: independent ? t.name + " 副本" : t.name,
      outputDir:
        this.d.resolvePath?.(t.snapshot.draft.outputDir) ??
        t.snapshot.draft.outputDir,
      parentVersionId: independent ? undefined : id,
      groupId: independent ? undefined : t.groupId,
    };
  }
  recover() {
    for (const row of this.d.db.all<{ id: string }>(
      "SELECT id FROM task_versions WHERE COALESCE(json_extract(data,'$.type'),'video')='video' AND status IN ('Uploading','Submitting','Processing','Downloading')",
    )) {
      const t = this.get(row.id);
      if (t.apiTaskId) {
        t.status = t.resultUrl ? "Downloading" : "Processing";
      } else if (t.status === "Submitting") {
        t.status = "Paused";
        t.errorCode = "SubmissionUnknown";
        t.error =
          "软件在提交期间关闭。云端可能已受理，请核对控制台后关联任务 ID。";
      } else t.status = "Queued";
      t.nextPollAt = 0;
      this.save(t);
    }
  }
  start() {
    this.recover();
    for (const row of this.d.db.all<{ id: string }>(
      "SELECT id FROM task_versions WHERE json_extract(data,'$.type')='video-group' AND status IN ('Processing','Downloading')",
    ))
      void this.finalizeSegmentGroup(row.id);
    this.timer = setInterval(() => {
      void this.tick().catch((e) =>
        this.d.logger.write("error", "queue_tick", {
          message: toError(e).message,
        }),
      );
    }, 750);
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const c of this.controllers.values()) c.abort();
  }
  async tick() {
    if (this.stopped || this.tickBusy) return;
    this.tickBusy = true;
    try {
      const settings = this.d.settings();
      const rows = this.d.db.all<{ id: string }>(
        "SELECT id FROM task_versions WHERE COALESCE(json_extract(data,'$.type'),'video')='video' AND status IN ('Queued','Processing','Downloading') ORDER BY created_at",
      );
      for (const row of rows) {
        if (this.active.size >= settings.globalConcurrency) break;
        if (this.active.has(row.id)) continue;
        const t = this.get(row.id);
        if (t.nextPollAt > Date.now()) continue;
        if (settings.queuePaused && t.status === "Queued") continue;
        // Cloud jobs count toward concurrency even between polling requests.
        if (t.status === "Queued") {
          const reserved = this.d.db
            .all<{
              id: string;
            }>(
              "SELECT id FROM task_versions WHERE status IN ('Uploading','Submitting','Processing') AND COALESCE(json_extract(data,'$.type'),'video')<>'video-group'",
            )
            .map((r) => this.get(r.id));
          const pendingReservations = [...this.active.values()].filter(
            (v) => v.status === "Queued",
          );
          const all = [...reserved, ...pendingReservations];
          if (all.length >= settings.globalConcurrency) continue;
          const cap =
            settings.providerConcurrency[t.snapshot.provider.id] ??
            t.snapshot.provider.maxConcurrent;
          if (
            all.filter((v) => v.snapshot.provider.id === t.snapshot.provider.id)
              .length >= cap
          )
            continue;
          const accountCap =
            this.d.credentials
              .list()
              .find((a) => a.id === t.snapshot.account.id)?.maxConcurrent ??
            t.snapshot.account.maxConcurrent;
          if (
            all.filter((v) => v.snapshot.account.id === t.snapshot.account.id)
              .length >= accountCap
          )
            continue;
        }
        const providerActive = [...this.active.values()].filter(
          (a) => a.snapshot.provider.id === t.snapshot.provider.id,
        ).length;
        const pc =
          settings.providerConcurrency[t.snapshot.provider.id] ??
          t.snapshot.provider.maxConcurrent;
        const accountLimit =
          this.d.credentials.list().find((a) => a.id === t.snapshot.account.id)
            ?.maxConcurrent ?? t.snapshot.account.maxConcurrent;
        if (
          providerActive >= pc ||
          this.accountLoad(t.snapshot.account.id) >= accountLimit
        )
          continue;
        this.active.set(t.id, t);
        const control = new AbortController();
        this.controllers.set(t.id, control);
        void this.run(t, control.signal)
          .catch((e) =>
            this.d.logger.write("error", "run_unhandled", {
              message: toError(e).message,
            }),
          )
          .finally(() => {
            this.active.delete(t.id);
            this.controllers.delete(t.id);
          });
      }
    } finally {
      this.tickBusy = false;
    }
  }
  async run(t: Task, signal: AbortSignal) {
    const adapter = this.d.adapter(t.snapshot.model);
    try {
      const runtime = this.runtimeSnapshot(t);
      const key = this.d.credentials.getKey(t.snapshot.account.id);
      if (t.status === "Queued") {
        t.status = "Uploading";
        this.save(t);
        const actualPaths = new Map<string, string>();
        for (const a of t.snapshot.assets) {
          const current = this.d.assets.get(a.id);
          actualPaths.set(
            a.id,
            await this.d.assets.verify({
              ...a,
              originalPath: current.originalPath,
              managedPath: current.managedPath,
            }),
          );
          current.lastUsedAt = new Date().toISOString();
          this.d.assets.save(current);
        }
        const uploadSnapshot = {
          ...runtime,
          assets: t.snapshot.assets.map((a) => {
            const actualPath = actualPaths.get(a.id)!;
            return {
              ...a,
              originalPath: actualPath,
              managedPath: null,
            };
          }),
        };
        const media = await adapter.uploadAssets(uploadSnapshot, key, signal);
        if (signal.aborted) return;
        this.d.db.transaction(() => {
          for (let index = 0; index < t.snapshot.assets.length; index++) {
            const asset = t.snapshot.assets[index];
            const item = media[index];
            const serialized = JSON.stringify(item ?? null);
            const match = serialized.match(/(?:oss:\/\/|https:\/\/)[^"\\]+/);
            const remoteRef = match?.[0] ?? "inline-data";
            this.d.db.run(
              "INSERT INTO cloud_uploads VALUES(?,?,?,?,?,?,?) ON CONFLICT(task_id,asset_id) DO UPDATE SET remote_ref=excluded.remote_ref,created_at=excluded.created_at,data=excluded.data",
              t.id,
              asset.id,
              t.snapshot.provider.id,
              remoteRef,
              new Date().toISOString(),
              null,
              JSON.stringify({ role: asset.role, remoteRef }),
            );
          }
        });
        t.connectionAccount = runtime.account;
        t.status = "Submitting";
        t.submittedAt = new Date().toISOString();
        this.save(t);
        const id = await adapter.submitTask(runtime, key, media, signal);
        t.apiTaskId = id;
        t.status = "Processing";
        t.nextPollAt = Date.now() + this.d.settings().pollSeconds * 1000;
        this.save(t);
        return;
      }
      if (signal.aborted) return;
      if (!t.resultUrl) {
        if (!t.apiTaskId)
          throw new AppError("ProviderError", "缺少云端任务 ID。");
        const result = await adapter.getTaskStatus(
          this.runtimeSnapshot(t),
          key,
          t.apiTaskId,
          signal,
        );
        t.rawResult = result.raw;
        t.retryCount = 0;
        if (result.status === "pending" || result.status === "processing") {
          t.status = "Processing";
          t.nextPollAt = Date.now() + this.d.settings().pollSeconds * 1000;
          this.save(t);
          return;
        }
        if (result.status === "failed") {
          const error = new AppError(
            "TaskFailedError",
            result.message || "云端生成失败，请检查输入后编辑生成新版本。",
          );
          error.details = result.details;
          throw error;
        }
        if (result.status === "cancelled") {
          t.status = "Cancelled";
          this.save(t);
          return;
        }
        if (result.status === "unknown")
          throw new AppError(
            "ProviderError",
            "云端任务已过期或状态未知。历史输入仍然保留，请核对控制台。",
          );
        t.downloadStatus = "pending";
        t.cost = finalCost(t.snapshot, result.raw);
        t.resultUrl = adapter.getResult(result);
        t.status = "Downloading";
        this.save(t);
      }
      await this.download(t, adapter);
      this.d.notify(t);
    } catch (e) {
      if (this.stopped || t.status === "Cancelled") return;
      const err = toError(e);
      t.error = err.message
        .replace(/Bearer\s+\S+|sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
        .slice(0, 2000);
      t.errorCode = err.code;
      t.apiError = err.details;
      if (
        t.resultUrl ||
        t.downloadStatus === "pending" ||
        t.downloadStatus === "failed"
      ) {
        t.status = "Completed";
        t.downloadStatus = "failed";
        t.completedAt ??= new Date().toISOString();
      } else if (err.code === "SubmissionUnknown") {
        t.status = "Paused";
      } else if (t.apiTaskId && err.retryable) {
        t.retryCount++;
        t.status =
          t.retryCount > this.d.settings().maxRetries ? "Paused" : "Processing";
        t.nextPollAt =
          Date.now() +
          Math.max(
            this.d.settings().pollSeconds * 1000,
            Math.min(60000, 2000 * 2 ** t.retryCount),
          );
      } else if (
        err.retryable &&
        t.status === "Uploading" &&
        t.retryCount < this.d.settings().maxRetries
      ) {
        t.retryCount++;
        t.status = "Queued";
        t.nextPollAt = Date.now() + 2000 * 2 ** t.retryCount;
      } else {
        t.status =
          t.apiTaskId && err.code === "AuthenticationError"
            ? "Paused"
            : "Failed";
      }
      this.save(t);
      if (["Completed", "Failed", "Paused"].includes(t.status))
        this.d.notify(t);
      if (t.segment?.parentId)
        void this.finalizeSegmentGroup(t.segment.parentId);
    }
  }
  private async prepareWanReferenceAudio(draft: Draft, model: Model) {
    if (model.adapter !== "wan3") return draft;
    const replacements = new Map<string, Asset>();
    for (const binding of draft.assets) {
      if (binding.role !== "reference_audio") continue;
      const source = await this.d.assets.refreshMetadata(binding.assetId);
      if (source.kind !== "audio" || Number(source.duration || 0) <= 14)
        continue;
      const sourcePath = await this.d.assets.verify(source);
      const sourceInfo = await stat(sourcePath);
      const key = createHash("sha256")
        .update(
          `${source.id}:${source.hash}:${sourcePath}:${sourceInfo.size}:${sourceInfo.mtimeMs}:0:14:pcm_s16le:24000:mono:v1`,
        )
        .digest("hex");
      let pending = this.wanAudioTrims.get(key);
      if (!pending) {
        pending = this.createWanAudioTrim(source, sourcePath, key).finally(() =>
          this.wanAudioTrims.delete(key),
        );
        this.wanAudioTrims.set(key, pending);
      }
      replacements.set(source.id, await pending);
    }
    if (!replacements.size) return draft;
    return {
      ...draft,
      assets: draft.assets.map((binding) => ({
        ...binding,
        assetId: replacements.get(binding.assetId)?.id ?? binding.assetId,
      })),
      mentions: draft.mentions?.map((mention) => ({
        ...mention,
        assetId: replacements.get(mention.assetId)?.id ?? mention.assetId,
      })),
    };
  }
  private async createWanAudioTrim(
    source: Asset,
    sourcePath: string,
    key: string,
  ) {
    const folder = join(dirname(this.d.db.path), "cache", "wan-audio-trims");
    const output = join(folder, `${key}.wav`);
    await mkdir(folder, { recursive: true });
    if (!(await stat(output).catch(() => null))) {
      const temporary = join(folder, `${key}.${randomUUID()}.tmp.wav`);
      try {
        await trimMediaSegment(
          sourcePath,
          temporary,
          0,
          14,
          "audio",
          this.d.settings().ffmpegPath,
        );
        await rename(temporary, output);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
    }
    const imported = await this.d.assets.import(output, false);
    let asset = await this.d.assets.refreshMetadata(imported.asset.id);
    if (
      !asset.duration ||
      asset.duration < 13.8 ||
      asset.duration > 14.15 ||
      asset.size > 15 * 1024 * 1024
    )
      throw new AppError(
        "ValidationError",
        "Wan 参考音频自动截取后校验失败，请检查 FFmpeg 后重试。",
      );
    asset.name = source.name;
    asset.metadata = {
      ...asset.metadata,
      source: "wan-audio-trim",
      sourceAssetId: source.id,
      sourceAssetName: source.name,
      trimStart: "0",
      trimDuration: "14",
    };
    this.d.assets.save(asset);
    asset = this.d.assets.get(asset.id);
    return asset;
  }
  async download(t: Task, adapter: ModelAdapter) {
    t.status = "Downloading";
    t.downloadStatus = "pending";
    this.save(t);
    const name = t.snapshot.draft.name.trim()
      ? videoStem(t.snapshot.draft.name) + ".mp4"
      : AUTO_VIDEO_NAME;
    t.outputPath = await adapter.downloadResult(
      t.resultUrl!,
      join(
        this.d.resolvePath?.(t.snapshot.draft.outputDir) ??
          t.snapshot.draft.outputDir,
        name,
      ),
    );
    t.outputs = [
      {
        kind: "video",
        mimeType: "video/mp4",
        extension: "mp4",
        localPath: t.outputPath,
        metadata: {},
      },
    ];
    const imported = await this.d.assets.import(t.outputPath, false);
    imported.asset.name = t.name;
    imported.asset.metadata = {
      ...imported.asset.metadata,
      source: t.segment ? "segment-result" : "generated",
      taskId: t.id,
      ...(t.segment?.parentId ? { parentTaskId: t.segment.parentId } : {}),
    };
    this.d.assets.save(imported.asset);
    t.outputs[0].duration = imported.asset.duration;
    t.outputs[0].metadata.assetId = imported.asset.id;
    t.status = "Completed";
    t.downloadStatus = "completed";
    t.completedAt ??= new Date().toISOString();
    t.error = null;
    t.errorCode = null;
    this.save(t);
    if (t.segment?.parentId)
      await this.finalizeSegmentGroup(t.segment.parentId);
  }

  async finalizeSegmentGroup(parentId: string) {
    if (this.finalizing.has(parentId)) return;
    this.finalizing.add(parentId);
    try {
      const parent = this.get(parentId);
      if (parent.type !== "video-group" || parent.status === "Completed")
        return;
      const children = this.children(parentId);
      if (!children.length) return;
      const completed = children.filter((task) => task.status === "Completed");
      parent.progress = Math.round((completed.length / children.length) * 100);
      const failed = children.find((task) =>
        ["Failed", "Cancelled", "Paused"].includes(task.status),
      );
      if (failed) {
        parent.status = "Failed";
        parent.error = `Segment${failed.segment?.index ?? "?"} 生成失败：${failed.error || "请在分段列表中查看原因并单独重试。"}`;
        parent.errorCode = failed.errorCode || "SegmentFailed";
        this.save(parent);
        return;
      }
      if (completed.length !== children.length) {
        parent.status = "Processing";
        this.save(parent);
        return;
      }
      const videos = completed.map((task) => task.outputPath!).filter(Boolean);
      const masterAudioAsset = parent.snapshot.assets.find(
        (asset) => asset.role === "reference_audio",
      );
      const masterAudio = masterAudioAsset
        ? await this.d.assets.verify(
            this.d.assets.get(masterAudioAsset.id),
            false,
          )
        : null;
      const output = join(
        parent.snapshot.draft.outputDir,
        `${videoStem(parent.name)}-${parent.id.slice(0, 8)}.mp4`,
      );
      parent.status = "Downloading";
      parent.downloadStatus = "pending";
      this.save(parent);
      await concatVideoWithAudio(
        videos,
        masterAudio,
        output,
        this.d.settings().ffmpegPath,
      );
      const imported = await this.d.assets.import(output, false);
      imported.asset.name = parent.name;
      imported.asset.metadata = {
        ...imported.asset.metadata,
        source: "generated",
        taskId: parent.id,
        segmented: "true",
      };
      this.d.assets.save(imported.asset);
      parent.outputPath = output;
      parent.outputs = [
        {
          kind: "video",
          mimeType: "video/mp4",
          extension: "mp4",
          localPath: output,
          duration: imported.asset.duration,
          metadata: { assetId: imported.asset.id },
        },
      ];
      parent.status = "Completed";
      parent.downloadStatus = "completed";
      parent.completedAt = new Date().toISOString();
      parent.progress = 100;
      parent.error = null;
      parent.errorCode = null;
      parent.cost = {
        amount: children.every((task) => task.cost.amount !== null)
          ? children.reduce((sum, task) => sum + (task.cost.amount ?? 0), 0)
          : null,
        currency: children[0].cost.currency,
        kind: children.every((task) => task.cost.amount !== null)
          ? "estimate"
          : "unknown",
        note: "分段任务费用合计；以官方账单为准",
      };
      this.save(parent);
      this.d.notify(parent);
    } catch (error) {
      const parent = this.get(parentId);
      parent.status = "Failed";
      parent.downloadStatus = "failed";
      parent.error = toError(error).message;
      parent.errorCode = "MergeFailed";
      this.save(parent);
    } finally {
      this.finalizing.delete(parentId);
    }
  }
  async again(id: string, requestId: string) {
    const t = this.get(id);
    return this.create(this.cloneDraft(id), requestId, t.snapshot);
  }
  async redownload(id: string) {
    if (this.active.has(id))
      throw new AppError("ValidationError", "任务正在运行，请稍后再试。");
    const t = this.get(id);
    if (!t.apiTaskId)
      throw new AppError("ValidationError", "没有可查询的云端任务。");
    if (!["Completed", "Failed", "Paused"].includes(t.status))
      throw new AppError("ValidationError", "任务尚未完成，请等待云端生成。");
    this.active.set(id, t);
    try {
      const adapter = this.d.adapter(t.snapshot.model);
      const key = this.d.credentials.getKey(t.snapshot.account.id);
      try {
        const result = await adapter.getTaskStatus(
          this.runtimeSnapshot(t),
          key,
          t.apiTaskId,
        );
        if (result.status === "succeeded") {
          t.resultUrl = result.url ?? t.resultUrl;
          t.rawResult = result.raw;
          t.cost = finalCost(t.snapshot, result.raw);
        }
      } catch {
        if (!t.resultUrl)
          throw new AppError(
            "DownloadError",
            "无法刷新结果链接；生成记录仍然保留，请检查网络和账户。",
          );
      }
      if (!t.resultUrl)
        throw new AppError(
          "DownloadError",
          "云端没有可下载结果，请核对控制台。",
        );
      t.status = "Downloading";
      t.downloadStatus = "pending";
      t.nextPollAt = 0;
      t.error = null;
      this.save(t);
    } finally {
      this.active.delete(id);
    }
  }

  async refreshStatus(id: string) {
    if (this.active.has(id))
      throw new AppError(
        "ValidationError",
        "任务正在执行网络操作，请稍后再刷新。",
      );
    const t = this.get(id);
    if (!t.apiTaskId)
      throw new AppError(
        "ValidationError",
        "任务尚未取得云端任务 ID，不能手动刷新。",
      );
    if (["Queued", "Uploading", "Submitting"].includes(t.status))
      throw new AppError(
        "ValidationError",
        "任务仍在本地提交阶段，无需查询云端状态。",
      );
    this.active.set(id, t);
    try {
      const adapter = this.d.adapter(t.snapshot.model);
      const key = this.d.credentials.getKey(t.snapshot.account.id);
      const result = await adapter.getTaskStatus(
        this.runtimeSnapshot(t),
        key,
        t.apiTaskId,
      );
      t.rawResult = result.raw;
      t.updatedAt = new Date().toISOString();
      t.retryCount = 0;
      t.error = null;
      t.errorCode = null;
      if (result.status === "pending" || result.status === "processing") {
        t.status = "Processing";
        t.nextPollAt = Date.now() + this.d.settings().pollSeconds * 1000;
      } else if (result.status === "succeeded") {
        t.resultUrl = adapter.getResult(result);
        t.cost = finalCost(t.snapshot, result.raw);
        if (t.outputPath && t.downloadStatus === "completed") {
          t.status = "Completed";
        } else {
          t.status = "Downloading";
          t.downloadStatus = "pending";
          t.nextPollAt = 0;
        }
      } else if (result.status === "failed") {
        t.status = "Failed";
        t.error = result.message || "云端生成失败。";
        t.apiError = result.details;
      } else if (result.status === "cancelled") {
        t.status = "Cancelled";
      } else {
        t.status = "Paused";
        t.error = "云端任务状态未知，请核对官方控制台。";
      }
      this.save(t);
      return t;
    } finally {
      this.active.delete(id);
    }
  }
  async refreshAll() {
    const ids = this.d.db
      .all<{ id: string }>(
        "SELECT id FROM task_versions WHERE COALESCE(json_extract(data,'$.type'),'video')='video' AND deleted_at IS NULL AND status IN ('Processing','Paused') ORDER BY created_at DESC",
      )
      .map((row) => row.id)
      .filter((id) => Boolean(this.get(id).apiTaskId));
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await this.refreshStatus(id);
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: toError(e).message });
      }
    }
    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;
    return {
      count: succeeded,
      attempted: results.length,
      succeeded,
      failed,
      results,
      refreshedAt: new Date().toISOString(),
    };
  }

  resume(id: string, apiTaskId?: string) {
    if (this.active.has(id))
      throw new AppError("ValidationError", "任务正在运行。");
    const t = this.get(id);
    if (apiTaskId) {
      if (!/^[a-zA-Z0-9_-]{6,160}$/.test(apiTaskId))
        throw new AppError("ValidationError", "任务 ID 格式无效。");
      t.apiTaskId = apiTaskId;
    }
    if (!t.apiTaskId && t.errorCode === "SubmissionUnknown")
      throw new AppError(
        "SubmissionUnknown",
        "请先在控制台找到任务 ID 并关联，不能直接重提。",
      );
    t.status = t.apiTaskId ? "Processing" : "Queued";
    t.error = null;
    t.errorCode = null;
    t.nextPollAt = 0;
    t.retryCount = 0;
    this.save(t);
  }
  async cancel(id: string) {
    if (this.active.has(id))
      throw new AppError("ValidationError", "正在执行网络操作，请稍后取消。");
    const t = this.get(id);
    if (t.status === "Queued" || t.status === "Draft") {
      t.status = "Cancelled";
      this.save(t);
      return;
    }
    if (!t.apiTaskId)
      throw new AppError("ValidationError", "当前任务不能取消。");
    if (
      !(await this.d
        .adapter(t.snapshot.model)
        .cancelTask(
          this.runtimeSnapshot(t),
          this.d.credentials.getKey(t.snapshot.account.id),
          t.apiTaskId,
        ))
    )
      throw new AppError(
        "ValidationError",
        "此适配器暂不支持云端取消，请在官方控制台操作；查询会继续保留。",
      );
    t.status = "Processing";
    t.nextPollAt = 0;
    this.save(t);
  }
  runtimeSnapshot(t: Task): Snapshot {
    const current = this.d.credentials
      .list()
      .find((a) => a.id === t.snapshot.account.id);
    if (!current)
      throw new AppError(
        "AuthenticationError",
        "任务绑定账户不存在，请检查账户配置。",
      );
    return {
      ...t.snapshot,
      account: t.apiTaskId
        ? (t.connectionAccount ?? t.snapshot.account)
        : current,
    };
  }
  removeRecord(id: string) {
    const t = this.active.get(id) ?? this.get(id);
    if (
      this.active.has(id) ||
      ["Uploading", "Submitting", "Processing", "Downloading"].includes(
        t.status,
      )
    )
      throw new AppError(
        "ValidationError",
        "任务正在执行，删除本地记录不代表取消云端请求。请等待完成或先处理云端任务。",
      );
    if (t.status === "Queued") t.status = "Cancelled";
    t.deletedAt = new Date().toISOString();
    this.save(t);
  }
}
