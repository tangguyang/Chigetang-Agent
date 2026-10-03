import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Application } from "./application.ts";
import type { CoreAssetService } from "./coreAssets.ts";
import type { CopyWorkflow, Driver } from "../../shared/production.ts";
import type { Draft, Snapshot, AssetRole } from "../../shared/types.ts";
import { brand } from "../../shared/brand.ts";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class CopyWorkflowService {
  busy = new Set<string>();
  app: Application;
  core: CoreAssetService;
  private mark: (id: string, driver: Driver, feature: string) => void;
  constructor(
    app: Application,
    core: CoreAssetService,
    mark: (id: string, driver: Driver, feature: string) => void,
  ) {
    this.app = app;
    this.core = core;
    this.mark = mark;
  }
  list() {
    return this.app.db.get<CopyWorkflow[]>("copy:workflows", []);
  }
  get(id: string) {
    const w = this.list().find((x) => x.id === id);
    if (!w) throw Error("复制工作流不存在");
    return {
      ...w,
      queuePaused: this.app.settings().queuePaused,
      tasks: w.taskIds.map((id) => {
        const t = this.app.tasks.get(id);
        return {
          id,
          status: t.status,
          name: t.name,
          outputPath: t.outputPath,
          error: t.error,
        };
      }),
    };
  }
  private save(w: CopyWorkflow) {
    const { tasks, ...stored } = w as CopyWorkflow & { tasks?: unknown };
    this.app.db.set("copy:workflows", [
      stored,
      ...this.list().filter((x) => x.id !== w.id),
    ]);
    this.app.changed();
    return w;
  }
  update(id: string, revision: number, drafts: Draft[]) {
    if (this.busy.has(id)) throw Error("工作流处理中");
    const w = this.get(id);
    if (w.state !== "prepared" || w.revision !== revision)
      throw Error("轮次已变化或已提交");
    if (!Array.isArray(drafts) || drafts.length !== w.drafts.length)
      throw Error("方案数量不可改变");
    for (const d of drafts)
      if (
        !d.prompt?.trim() ||
        !Array.isArray(d.assets) ||
        !d.params ||
        !this.app
          .models()
          .some((m) => m.id === d.modelId && m.enabled && m.type === "video")
      )
        throw Error("需要完整视频方案");
    w.drafts = structuredClone(drafts);
    w.revision++;
    w.confirmed = false;
    delete w.fingerprint;
    delete w.issues;
    return this.save(w);
  }
  async create(
    p: {
      requestId: string;
      name: string;
      draft?: Draft;
      sourceTaskId?: string;
      count: number;
      variants?: Partial<Draft>[];
      bindings?: { alias: string; role: AssetRole }[];
    },
    driver: Driver,
  ) {
    if (
      !p.requestId ||
      p.requestId.length > 100 ||
      !Number.isInteger(p.count) ||
      p.count < 1 ||
      p.count > 100
    )
      throw Error("requestId必填，批量数量须1–100");
    const previous = this.list().find((w) => w.requestId === p.requestId);
    if (previous) return this.get(previous.id);
    const base = p.sourceTaskId
      ? this.app.tasks.cloneDraft(p.sourceTaskId, true)
      : p.draft;
    if (!base) throw Error("需要历史任务或完整生产方案");
    if (p.variants && p.variants.length !== p.count)
      throw Error("变体数量须等于批量数量");
    const bindings: { assetId: string; role: AssetRole }[] = [];
    for (const b of p.bindings || []) {
      if (
        ![
          "reference_image",
          "reference_video",
          "reference_audio",
          "first_frame",
          "last_frame",
        ].includes(b.role)
      )
        throw Error("素材角色无效");
      const a = await this.core.resolve(b.alias);
      bindings.push({ assetId: a.assetId, role: b.role });
    }
    const drafts = Array.from({ length: p.count }, (_, i) => {
      const variant = p.variants?.[i] || {},
        d = structuredClone({
          ...base,
          ...variant,
          name:
            variant.name ||
            `${p.name || base.name} ${String(i + 1).padStart(2, "0")}`,
          assets: [...(variant.assets || base.assets), ...bindings],
        });
      if (
        !this.app
          .models()
          .some((m) => m.id === d.modelId && m.enabled && m.type === "video")
      )
        throw Error("复制功能需要已启用视频模型");
      if (!d.prompt?.trim()) throw Error("生产方案Prompt不能为空");
      return d;
    });
    // No await between idempotency recheck and single-writer persistence.
    const existing = this.list().find((w) => w.requestId === p.requestId);
    if (existing) return this.get(existing.id);
    return this.save({
      id: randomUUID(),
      requestId: p.requestId,
      name: p.name || base.name,
      createdAt: new Date().toISOString(),
      driver,
      drafts,
      taskIds: [],
      state: "prepared",
      revision: 1,
    });
  }
  private async fingerprint(w: CopyWorkflow) {
    const files = [];
    for (const d of w.drafts)
      for (const b of d.assets) {
        const a = this.app.assets.get(b.assetId);
        files.push([
          a.id,
          createHash("sha256")
            .update(await readFile(await this.app.assets.verify(a)))
            .digest("hex"),
        ]);
      }
    return hash([
      w.revision,
      w.drafts,
      this.app.models(),
      this.app.providers(),
      this.app.credentials.list(),
      files,
    ]);
  }
  async preflight(id: string) {
    if (this.busy.has(id)) throw Error("工作流处理中");
    this.busy.add(id);
    try {
      const w = this.get(id);
      if (w.state !== "prepared") throw Error("已提交轮次不可修改");
      w.confirmed = false;
      delete w.fingerprint;
      w.issues = [];
      this.save(w);
      for (const d of w.drafts) {
        try {
          const model = this.app
            .models()
            .find((m) => m.id === d.modelId && m.enabled)!;
          if (!model) throw Error("模型不可用");
          const accounts = this.app.credentials
            .list()
            .filter((a) => a.providerId === model.providerId && a.enabled);
          const account =
            d.accountId === "auto"
              ? accounts.find((a) => a.isDefault) ||
                (accounts.length === 1 ? accounts[0] : undefined)
              : accounts.find((a) => a.id === d.accountId);
          if (accounts.length > 1 && !account) throw Error("请选择明确API账户");
          const assets = await Promise.all(
            d.assets.map(async (b) => ({
              ...(await this.app.assets.refreshMetadata(b.assetId)),
              role: b.role,
            })),
          );
          const snapshot = {
            draft: d,
            model,
            provider: this.app
              .providers()
              .find((p) => p.id === model.providerId)!,
            account: account || { id: "offline" },
            assets,
            price: model.price,
            estimatedCost: {
              amount: null,
              currency: "CNY",
              kind: "unknown",
              note: "",
            },
            appVersion: brand.version,
            createdAt: "",
          } as Snapshot;
          this.app.tasks.d.adapter(model).validateInput(snapshot);
          this.app.tasks.estimate(d);
        } catch (e) {
          w.issues.push(d.name + "：" + String(e));
        }
      }
      if (!w.issues.length) w.fingerprint = await this.fingerprint(w);
      return this.save(w);
    } finally {
      this.busy.delete(id);
    }
  }
  async confirm(id: string, revision: number) {
    if (this.busy.has(id)) throw Error("工作流处理中");
    this.busy.add(id);
    try {
      const w = this.get(id);
      if (
        w.state !== "prepared" ||
        w.revision !== revision ||
        !w.fingerprint ||
        w.issues?.length ||
        (await this.fingerprint(w)) !== w.fingerprint
      )
        throw Error("请重新预检当前方案");
      w.confirmed = true;
      return this.save(w);
    } finally {
      this.busy.delete(id);
    }
  }
  async submit(id: string) {
    if (this.busy.has(id)) throw Error("工作流处理中");
    this.busy.add(id);
    try {
      const w = this.get(id);
      if (w.state === "submitted") return w;
      if (
        w.state !== "prepared" ||
        !w.confirmed ||
        !w.fingerprint ||
        (await this.fingerprint(w)) !== w.fingerprint
      )
        throw Error("请先预检并确认；中断轮次禁止自动重新提交");
      // All drafts are created deferred before any provider runs. Existing TaskService owns execution.
      for (const d of w.drafts) {
        const model = this.app.models().find((m) => m.id === d.modelId)!;
        const ac = this.app.credentials
          .list()
          .filter((a) => a.providerId === model.providerId && a.enabled);
        const account =
          d.accountId === "auto"
            ? ac.find((a) => a.isDefault) ||
              (ac.length === 1 ? ac[0] : undefined)
            : ac.find((a) => a.id === d.accountId);
        if (!account) throw Error("正式提交前需要明确API账户");
        this.app.credentials.getKey(account.id);
      }
      w.state = "submitting";
      this.save(w);
      try {
        for (let i = 0; i < w.drafts.length; i++) {
          const t = await this.app.tasks.create(
            w.drafts[i],
            `copy:${w.id}:${i}`,
            undefined,
            true,
          );
          this.mark("task:" + t.id, w.driver, "一键复制");
          w.taskIds.push(t.id);
          this.save(w);
        }
        w.state = "submitted";
        this.save(w);
        for (const taskId of w.taskIds) this.app.tasks.resume(taskId);
        return this.get(id);
      } catch (e) {
        w.state = "blocked";
        w.error = String(e);
        this.save(w);
        throw e;
      }
    } finally {
      this.busy.delete(id);
    }
  }
}
