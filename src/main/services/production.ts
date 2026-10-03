import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Application } from "./application.ts";
import type {
  ProductionTask,
  Driver,
  ProductionOutput,
} from "../../shared/production.ts";
import type { Asset, Draft } from "../../shared/types.ts";
type Obj = Record<string, any>;
export function generatedAsset(a: Asset) {
  const m = a.metadata || {};
  return !!(
    m.taskId ||
    (m.realSpeechSources && m.realSpeechSources !== "[]") ||
    ["generated", "segment-result", "segment-temp", "wan-audio-trim"].includes(
      m.source,
    )
  );
}
/** Read-through index: business records remain authoritative in their original stores. */
export class ProductionService {
  app: Application;
  private speech: (v2: boolean) => Promise<Obj[]>;
  private workflows: () => Obj[];
  constructor(
    app: Application,
    speech: (v2: boolean) => Promise<Obj[]>,
    workflows: () => Obj[],
  ) {
    this.app = app;
    this.speech = speech;
    this.workflows = workflows;
  }
  metadata(id: string): Obj {
    return this.app.db.get("production:" + id, {});
  }
  mark(id: string, driver: Driver, feature?: string) {
    const old = this.metadata(id);
    this.app.db.set("production:" + id, {
      ...old,
      driver: old.driver || driver,
      feature: old.feature || feature,
    });
  }
  async update(id: string, p: { note?: string; favorite?: boolean }) {
    await this.get(id);
    if (
      p.note !== undefined &&
      (typeof p.note !== "string" || p.note.length > 4000)
    )
      throw Error("备注最多4000字");
    if (p.favorite !== undefined && typeof p.favorite !== "boolean")
      throw Error("收藏值无效");
    this.app.db.set("production:" + id, {
      ...this.metadata(id),
      ...(p.note !== undefined ? { note: p.note } : {}),
      ...(p.favorite !== undefined ? { favorite: p.favorite } : {}),
      updatedAt: new Date().toISOString(),
    });
    this.app.changed();
    return this.get(id);
  }
  async rows(): Promise<ProductionTask[]> {
    const a = this.app,
      rows: ProductionTask[] = [],
      mapped = new Map<string, Obj>();
    for (const e of a.db.get<ProductionTask[]>("production:executions", [])) {
      const m = this.metadata(e.id);
      rows.push({
        ...e,
        note: m.note || "",
        favorite: !!m.favorite,
        status:
          e.status === "Processing" && !this.active.has(e.id)
            ? "unknown_result"
            : e.status,
      });
    }
    for (const w of this.workflows())
      for (const id of w.taskIds || []) mapped.set(id, w);
    for (const w of a.db.get<Obj[]>("replica:sessions", []))
      for (const id of w.taskIds || [])
        if (!mapped.has(id)) mapped.set(id, { id: w.id, feature: "一键复刻" });
    // task packages are linked through their existing persisted session records.
    for (const r of a.db.all<Obj>(
      "SELECT id FROM task_versions ORDER BY created_at DESC",
    )) {
      const t = a.tasks.get(r.id),
        w = mapped.get(t.id),
        m = this.metadata("task:" + t.id);
      rows.push({
        id: "task:" + t.id,
        recordId: t.id,
        system: "task",
        name: t.name,
        feature:
          m.feature ||
          w?.feature ||
          (t.type === "audio" ? "音频生成" : "视频生成"),
        driver: m.driver || "历史未知",
        createdAt: t.createdAt,
        status: t.status,
        model: t.snapshot.model.name || t.snapshot.model.id,
        note: m.note || "",
        favorite: !!m.favorite,
        deleted: !!t.deletedAt,
        workflowId: w?.id,
        params: t.snapshot.draft,
        draft: t.snapshot.draft,
        outputs: [
          ...(t.outputPath
            ? [
                {
                  path: t.outputPath,
                  kind:
                    t.type === "image"
                      ? "image"
                      : t.type === "audio"
                        ? "audio"
                        : "video",
                  taskId: t.id,
                },
              ]
            : []),
          ...(t.outputs || []).map((x) => ({
            path: x.localPath,
            kind: t.type || "video",
            taskId: t.id,
          })),
        ].filter((x, i, all) => all.findIndex((y) => y.path === x.path) === i),
      });
    }
    const linked = new Set(rows.flatMap((x) => x.outputs.map((o) => o.path)));
    for (const r of a.db.all<Obj>("SELECT data FROM assets")) {
      const asset = JSON.parse(r.data) as Asset;
      if (!generatedAsset(asset)) continue;
      const path = a.resolvePath(asset.managedPath || asset.originalPath);
      if (
        linked.has(path) ||
        (asset.metadata?.taskId &&
          rows.some((x) => x.recordId === asset.metadata!.taskId))
      )
        continue;
      const m = this.metadata("asset:" + asset.id),
        meta = asset.metadata || {};
      // Speech assets are shown with their task below, not as unrelated result cards.
      if (meta.realSpeechSources && meta.realSpeechSources !== "[]") continue;
      rows.push({
        id: "asset:" + asset.id,
        recordId: asset.id,
        system: "asset",
        name: asset.name,
        feature:
          m.feature ||
          (String(meta.model).startsWith("qwen") ? "Qwen" : "音频生成"),
        driver: m.driver || "历史未知",
        createdAt: asset.createdAt,
        status: asset.unavailableAt ? "missing" : "Completed",
        model: meta.model || "",
        note: m.note || "",
        favorite: !!m.favorite,
        deleted: !!asset.libraryDeletedAt,
        params: meta,
        outputs: [{ path, kind: asset.kind, assetId: asset.id }],
      });
    }
    for (const v2 of [false, true])
      for (const t of await this.speech(v2)) {
        const id = (v2 ? "speech-v2:" : "speech:") + (t.taskId || t.id),
          m = this.metadata(id),
          outputs: ProductionOutput[] = [];
        const add = (p: any) => {
          if (typeof p === "string" && p && !outputs.some((x) => x.path === p))
            outputs.push({ path: a.resolvePath(p), kind: "audio" });
        };
        add(
          (t.finals || []).find((f: Obj) => f.finalId === t.selectedFinalId)
            ?.path,
        );
        add(t.final?.path);
        add(t.final?.outputPath);
        for (const f of [...(t.finals || [])].reverse()) add(f.path);
        for (const w of [
          ...(t.windows || []),
          ...(t.rehearsal ? [t.rehearsal] : []),
        ]) {
          add(w.outputPath);
          add(w.path);
          for (const v of [...(w.versions || [])].reverse()) {
            add(v.path);
            add(v.outputPath);
          }
          for (const r of [...(w.results || [])].reverse()) add(r.path);
        }
        const running = (t.windows || []).some(
          (w: Obj) =>
            w.status === "generating" ||
            (w.attempts || []).some((x: Obj) => x.status === "running"),
        );
        rows.push({
          id,
          recordId: t.taskId || t.id,
          system: v2 ? "speech-v2" : "speech",
          name: t.name || t.plan?.name || "真人口播",
          feature: v2 ? "真人口播 V2" : "真人口播",
          driver: m.driver || "历史未知",
          createdAt: t.createdAt || "",
          status: running
            ? "Processing"
            : outputs.length
              ? "Completed"
              : t.status || "Draft",
          model: String(t.plan?.model || t.model || "CosyVoice"),
          note: m.note || "",
          favorite: !!m.favorite,
          deleted: !!t.deletedAt,
          params: t,
          outputs,
        });
      }
    return rows.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }
  async list(q: Obj = {}) {
    const search = String(q.search || "").toLocaleLowerCase();
    const rows = (await this.rows()).filter(
      (r) =>
        (q.includeDeleted || !r.deleted) &&
        (!q.favorite || r.favorite) &&
        (!q.feature || r.feature === q.feature) &&
        (!q.workflowId || r.workflowId === q.workflowId) &&
        (!q.driver || r.driver === q.driver) &&
        (!q.status || r.status === q.status) &&
        (!search ||
          [r.name, r.id, r.note, r.model, r.feature].some((x) =>
            x.toLocaleLowerCase().includes(search),
          )),
    );
    const page = Math.max(1, Number(q.page) || 1),
      size = Math.min(100, Math.max(1, Number(q.pageSize) || 24));
    return {
      items: rows.slice((page - 1) * size, page * size),
      total: rows.length,
      page,
      pageSize: size,
    };
  }
  async get(id: string) {
    const row = (await this.rows()).find((x) => x.id === id);
    if (!row) throw Error("生成任务不存在");
    return row;
  }
  async output(id: string, index = 0) {
    const row = await this.get(id),
      out = row.outputs[index];
    if (!out || !existsSync(out.path)) throw Error("本地结果不存在或尚未下载");
    return out;
  }
  async reuse(id: string): Promise<Draft> {
    const r = await this.get(id);
    if (r.system !== "task")
      throw Error("该任务请在原音频/真人口播页面复用参数");
    return this.app.tasks.cloneDraft(r.recordId, true);
  }
  async references(assetId: string) {
    this.app.assets.get(assetId);
    return (await this.rows())
      .filter(
        (x) =>
          x.draft?.assets.some((b) => b.assetId === assetId) ||
          JSON.stringify(x.params).includes(assetId),
      )
      .map(({ id, name, feature }) => ({ id, name, feature }));
  }
  uploads(q: Obj = {}) {
    const assets = this.app.db
      .all<{ data: string }>("SELECT data FROM assets")
      .map((r) => JSON.parse(r.data) as Asset)
      .filter((a) => !generatedAsset(a));
    const rows = assets
      .filter(
        (a) =>
          (q.hidden
            ? !!a.libraryDeletedAt || !!a.unavailableAt
            : !a.libraryDeletedAt && !a.unavailableAt) &&
          (!q.kind || q.kind === a.kind) &&
          (!q.folder || q.folder === a.folder) &&
          (!q.favorite || a.favorite) &&
          (!q.project || q.project === a.projectId) &&
          (!q.search ||
            [a.name, ...a.tags]
              .join(" ")
              .toLocaleLowerCase()
              .includes(String(q.search).toLocaleLowerCase())) &&
          (!q.from || a.createdAt >= String(q.from)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = Math.max(1, Number(q.page) || 1);
    return {
      items: rows.slice((page - 1) * 24, page * 24).map((a) => ({
        ...a,
        missing:
          !!a.unavailableAt || !existsSync(a.managedPath || a.originalPath),
      })),
      total: rows.length,
    };
  }
  private active = new Set<string>();
  async execute(
    feature: string,
    driver: Driver,
    params: Obj,
    fn: () => Promise<Obj>,
  ) {
    const uuid = randomUUID(),
      id = "execution:" + uuid,
      entry: ProductionTask = {
        id,
        recordId: uuid,
        system: "execution",
        name: String(
          params.name || params.outputPath?.split(/[\\/]/).pop() || feature,
        ),
        feature,
        driver,
        createdAt: new Date().toISOString(),
        status: "Processing",
        model: String(params.model || ""),
        note: "",
        favorite: false,
        outputs: [],
        deleted: false,
        params: structuredClone(params),
      };
    const save = () => {
      this.app.db.set("production:executions", [
        entry,
        ...this.app.db
          .get<ProductionTask[]>("production:executions", [])
          .filter((x) => x.id !== id),
      ]);
      this.app.changed();
    };
    this.active.add(id);
    save();
    try {
      const result = await fn();
      entry.status = "Completed";
      entry.outputs = [
        { path: result.outputPath, kind: "audio", assetId: result.assetId },
      ];
      save();
      return { ...result, productionTaskId: id };
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String(e.code) : "";
      entry.status = code === "SubmissionUnknown" ? "unknown_result" : "Failed";
      entry.params = {
        ...(entry.params as Obj),
        error: String(e),
        errorCode: code,
      };
      save();
      throw e;
    } finally {
      this.active.delete(id);
    }
  }
}
