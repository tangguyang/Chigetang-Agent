import { existsSync } from "node:fs";
import type { Application } from "./application.ts";
import type { RealSpeechService } from "../realSpeech/service.ts";
import type { Obj } from "../../features/realSpeech/domain.ts";
export type LibraryRow = {
  id: string;
  category: "task" | "speech" | "asset";
  name: string;
  kind: string;
  status: string;
  createdAt: string;
  module: string;
  ids: string[];
  children?: Obj[];
  asset?: Obj;
  deleted?: boolean;
  origin?: "upload" | "generated" | "unknown";
  mediaAsset?: Obj;
};
export function stateGroup(status: string) {
  if (["Completed", "generated", "confirmed"].includes(status))
    return "completed";
  if (
    [
      "Queued",
      "Uploading",
      "Submitting",
      "Processing",
      "Downloading",
      "generating",
    ].includes(status)
  )
    return "running";
  return "attention";
}
/** Lightweight metadata is queried before pagination; full snapshots are loaded only for visible cards. */
export async function libraryView(
  app: Application,
  speech: RealSpeechService | undefined,
  q: Obj,
  replicas: Obj[] = [],
  packages: Obj[] = [],
) {
  const mappings = new Map<
    string,
    { id: string; name: string; module: string; order: number }
  >();
  for (const s of replicas)
    (s.taskIds || []).forEach((id: string, order: number) =>
      mappings.set(id, {
        id: "replica:" + s.id,
        name: s.name,
        module: "一键复刻",
        order,
      }),
    );
  for (const s of packages)
    (s.results || []).forEach((r: Obj, order: number) =>
      mappings.set(r.taskId, {
        id: "package:" + s.sessionId,
        name: s.name,
        module: "一键生成",
        order,
      }),
    );
  const regular = app.db.all<Obj>(
    `SELECT v.id,t.name,v.status,v.created_at createdAt,COALESCE(json_extract(v.data,'$.type'),'video') kind,json_extract(v.data,'$.segment.parentId') parentId,json_extract(s.data,'$.draft.prompt') prompt,json_extract(v.data,'$.outputPath') outputPath,json_extract(s.data,'$.draft.projectId') projectId FROM task_versions v JOIN tasks t ON t.id=v.task_id JOIN task_snapshots s ON s.version_id=v.id WHERE v.deleted_at IS NULL ORDER BY v.created_at DESC`,
  );
  const audioIds = new Set(
    app.db.all<Obj>("SELECT task_id FROM cosy_jobs").map((x) => x.task_id),
  );
  const groups = new Map<string, LibraryRow>();
  const search = String(q.search || "").toLocaleLowerCase();
  const matched = new Set<string>();
  const filteredLinks = new Set<string>(),
    tagLinks = new Set<string>();
  const assetRows = app.db.all<Obj>(
    `SELECT id,name,kind,created_at createdAt,json_remove(data,'$.metadata.realSpeechSources') data,COALESCE((SELECT json_group_array(json_object('taskId',json_extract(value,'$.taskId'),'name',json_extract(value,'$.name'),'role',json_extract(value,'$.role'),'revision',json_extract(value,'$.revision'),'deleted',json_extract(value,'$.deleted'))) FROM json_each(COALESCE(json_extract(assets.data,'$.metadata.realSpeechSources'),'[]'))),'[]') speechSources FROM assets`,
  );
  for (const a of assetRows) {
    const v = JSON.parse(a.data);
    v.metadata = { ...v.metadata, realSpeechSources: a.speechSources };
    a.data = JSON.stringify(v);
  }
  for (const a of assetRows) {
    const v = JSON.parse(a.data),
      links = [
        v.metadata?.taskId,
        ...JSON.parse(v.metadata?.realSpeechSources || "[]").map(
          (x: Obj) => x.taskId,
        ),
      ].filter(Boolean);
    if (
      (!q.folder || v.folder === q.folder) &&
      (!q.favorite || v.favorite) &&
      (!q.project || v.projectId === q.project)
    )
      for (const id of links) filteredLinks.add(id);
    if (
      search &&
      (v.tags || []).some((tag: string) =>
        tag.toLocaleLowerCase().includes(search),
      )
    )
      for (const id of links) tagLinks.add(id);
  }
  for (const t of regular) {
    const mapping = mappings.get(t.id);
    const id = mapping?.id || (t.parentId ? "segments:" + t.parentId : t.id);
    let row = groups.get(id);
    if (!row) {
      row = {
        id,
        category: "task",
        name: mapping?.name || t.name,
        kind: t.kind === "video-group" ? "video" : t.kind,
        status: t.status,
        createdAt: t.createdAt,
        module:
          mapping?.module || (audioIds.has(t.id) ? "专业音频" : "历史任务"),
        ids: [],
        children: [],
      };
      groups.set(id, row);
    }
    row.ids.push(t.id);
    row.children!.push({ ...t, order: mapping?.order });
    if (
      !search ||
      tagLinks.has(t.id) ||
      [t.name, t.id, t.prompt, row.name].some((v) =>
        String(v || "")
          .toLocaleLowerCase()
          .includes(search),
      )
    )
      matched.add(id);
    if (stateGroup(t.status) === "running") row.status = t.status;
    else if (
      stateGroup(t.status) === "attention" &&
      stateGroup(row.status) !== "running"
    )
      row.status = t.status;
  }
  let rows = [...groups.values()].filter((x) => matched.has(x.id));
  for (const t of (speech?.db
    .prepare(
      `SELECT id,json_extract(data,'$.name') name,json_extract(data,'$.originalText') text,json_extract(data,'$.createdAt') createdAt,json_extract(data,'$.deletedAt') deletedAt,json_extract(data,'$.windows') windows,json_extract(data,'$.final') final,json_extract(data,'$.finalDirty') dirty FROM tasks`,
    )
    .all() || []) as Obj[]) {
    if (t.deletedAt) {
      const raw = speech!.get(t.id, true);
      const pending = [
        ...raw.windows,
        ...(raw.rehearsal ? [raw.rehearsal] : []),
      ].filter((w) => ["unknown_result", "interrupted"].includes(w.status));
      if (pending.length && q.source !== "tasks")
        rows.push({
          id: t.id,
          category: "speech",
          name: t.name + " · 已删除任务的待恢复请求",
          kind: "audio",
          status: "unknown_result",
          createdAt: t.createdAt || "",
          module: "真人口播",
          ids: [t.id],
          deleted: true,
        });
      continue;
    }
    if (
      search &&
      !tagLinks.has(t.id) &&
      ![t.name, t.id, t.text].some((v) =>
        String(v || "")
          .toLocaleLowerCase()
          .includes(search),
      )
    )
      continue;
    const windows = JSON.parse(t.windows || "[]");
    const status =
      windows.find((w: Obj) => w.status === "generating")?.status ||
      (t.final && !t.dirty
        ? "generated"
        : windows.find((w: Obj) => stateGroup(w.status) === "attention")
            ?.status ||
          (windows.length &&
          windows.every((w: Obj) =>
            ["generated", "confirmed"].includes(w.status),
          )
            ? "ready_to_concat"
            : "pending"));
    rows.push({
      id: t.id,
      category: "speech",
      name: t.name,
      kind: "audio",
      status,
      createdAt: t.createdAt || "",
      module: "真人口播",
      ids: [t.id],
    });
  }
  const taskIds = new Set(regular.map((t) => t.id));
  if (q.source !== "tasks") {
    for (const a of assetRows) {
      const data = JSON.parse(a.data);
      data.unavailableAt =
        data.unavailableAt ||
        (!existsSync(data.managedPath || data.originalPath) ? "missing" : null);
      if (
        (q.folder && data.folder !== q.folder) ||
        (q.favorite && !data.favorite) ||
        (q.project && data.projectId !== q.project)
      )
        continue;
      const rs = JSON.parse(data.metadata?.realSpeechSources || "[]");
      const linked =
        taskIds.has(data.metadata?.taskId) || rs.some((x: Obj) => !x.deleted);
      if (
        q.source === "all" &&
        linked &&
        !q.hidden &&
        !q.showHidden &&
        !data.libraryDeletedAt
      )
        continue;
      if (
        search &&
        ![data.name, ...(data.tags || []), ...rs.map((x: Obj) => x.name)].some(
          (v) =>
            String(v || "")
              .toLocaleLowerCase()
              .includes(search),
        )
      )
        continue;
      rows.push({
        id: a.id,
        category: "asset",
        name: rs.length
          ? `${rs.at(-1).name} · ${rs.at(-1).role} · v${rs.at(-1).revision || 1}`
          : a.name,
        kind: a.kind,
        status: data.unavailableAt ? "missing" : "Completed",
        createdAt: a.createdAt,
        module: rs.length
          ? "真人口播"
          : data.metadata?.source
            ? "生成结果"
            : "本地素材",
        ids: [a.id],
        asset: { ...data, missing: !!data.unavailableAt },
        deleted: rs.some((x: Obj) => x.deleted),
      });
    }
  }
  if (q.source !== "tasks")
    for (const entry of speech?.db
      .prepare("SELECT data FROM audio_assets")
      .all() || []) {
      const a = JSON.parse(String(entry.data));
      if (a.assetId) continue;
      if (
        search &&
        ![a.name, a.taskId, a.role].some((v) =>
          String(v || "")
            .toLocaleLowerCase()
            .includes(search),
        )
      )
        continue;
      rows.push({
        id: "missing:" + a.id,
        category: "asset",
        name: a.name + " · " + a.role + " · 文件缺失",
        kind: "audio",
        status: "missing",
        createdAt: "",
        module: "真人口播",
        ids: [a.id],
        deleted: a.deleted,
        asset: {
          id: "missing:" + a.id,
          name: a.name,
          kind: "audio",
          missing: true,
          tags: [],
          size: 0,
          createdAt: "",
        },
      });
    }
  if (q.source === "assets")
    rows = rows.filter((r) => r.category === "asset" || r.deleted);
  if (q.source === "tasks") rows = rows.filter((r) => r.category !== "asset");
  rows = rows.filter(
    (r) =>
      (!q.kind || r.kind === q.kind) &&
      (!q.module || r.module === q.module) &&
      (!q.status || stateGroup(r.status) === q.status),
  );
  if (q.folder || q.favorite || q.project)
    rows = rows.filter(
      (r) =>
        r.category === "asset" ||
        r.ids.some((id) => filteredLinks.has(id)) ||
        r.children?.some(
          (t) =>
            q.project && t.projectId === q.project && !q.folder && !q.favorite,
        ),
    );
  const hidden = new Set<string>(q.hiddenIds || []);
  for (const id of app.db.get<string[]>("library-hidden", [])) hidden.add(id);
  for (const a of assetRows)
    if (JSON.parse(a.data).libraryDeletedAt) hidden.add(a.id);
  for (const row of rows) {
    if (row.category !== "asset") row.origin = "generated";
    else {
      const metadata = row.asset?.metadata || {},
        source = String(metadata.source || "");
      row.origin =
        metadata.taskId ||
        JSON.parse(metadata.realSpeechSources || "[]").length ||
        [
          "generated",
          "segment-result",
          "segment-temp",
          "wan-audio-trim",
        ].includes(source)
          ? "generated"
          : !source ||
              [
                "upload",
                "uploaded",
                "imported",
                "local-import",
                "manual",
              ].includes(source)
            ? "upload"
            : "unknown";
    }
  }
  if (q.origin) rows = rows.filter((r) => r.origin === q.origin);
  rows = rows.filter((r) =>
    q.hidden || q.showHidden ? hidden.has(r.id) : !hidden.has(r.id),
  );
  rows.sort(
    (a, b) =>
      Number(stateGroup(b.status) === "running") -
        Number(stateGroup(a.status) === "running") ||
      (q.sort === "oldest"
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt)),
  );
  const total = rows.length;
  const page = Math.max(1, Number(q.page) || 1);
  rows = rows.slice((page - 1) * 24, page * 24);
  for (const row of rows) {
    const linked = assetRows.find((a) => {
      const v = JSON.parse(a.data);
      return (
        row.ids.includes(v.metadata?.taskId) ||
        JSON.parse(v.metadata?.realSpeechSources || "[]").some((s: Obj) =>
          row.ids.includes(s.taskId),
        )
      );
    });
    row.mediaAsset =
      row.asset || (linked ? JSON.parse(linked.data) : undefined);
    if (row.category === "task")
      row.children = row.children
        ?.sort(
          (a, b) =>
            (a.order ?? a.segment?.index ?? 0) -
            (b.order ?? b.segment?.index ?? 0),
        )
        .map((t) => app.tasks.get(t.id));
    else if (row.category === "speech") {
      const t = speech!.get(row.id, !!row.deleted);
      row.children = [
        {
          taskId: t.taskId,
          name: t.name,
          taskRevision: t.taskRevision,
          final: t.final,
          finalDirty: t.finalDirty,
        },
      ];
    }
  }
  return { items: rows, total };
}
