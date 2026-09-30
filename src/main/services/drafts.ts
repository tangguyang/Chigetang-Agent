import { randomUUID } from "node:crypto";
import { defaults } from "../../shared/catalog.ts";
import { normalizeDraft } from "../../shared/mentions.ts";
import type {
  Draft,
  DraftSummary,
  Model,
  Settings,
} from "../../shared/types.ts";
import type { Database } from "../database/db.ts";
export class DraftManager {
  db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  save(input: Draft) {
    if (typeof input.prompt !== "string" || input.prompt.length > 200000)
      throw new Error("草稿内容过大");
    const d = normalizeDraft(input);
    this.db.transaction(() => {
      this.db.run(
        "INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at,data=excluded.data",
        d.draftId!,
        d.name,
        new Date().toISOString(),
        JSON.stringify(d),
      );
      this.db.set("draft", d);
    });
    return d;
  }
  rename(id: string, name: string) {
    const draft = this.get(id);
    draft.name = name.trim().slice(0, 100);
    this.db.transaction(() => {
      this.db.run(
        "UPDATE drafts SET name=?,data=?,updated_at=? WHERE id=?",
        draft.name,
        JSON.stringify(draft),
        new Date().toISOString(),
        id,
      );
      if (this.db.get<Draft | null>("draft", null)?.draftId === id)
        this.db.set("draft", draft);
    });
    return draft;
  }
  list() {
    return this.db
      .all<{
        id: string;
        name: string;
        updated_at: string;
      }>("SELECT id,name,updated_at FROM drafts ORDER BY updated_at DESC")
      .map(
        (r) =>
          ({
            id: r.id,
            name: r.name || "未命名任务",
            updatedAt: r.updated_at,
          }) satisfies DraftSummary,
      );
  }
  get(id: string) {
    const r = this.db.one<{ data: string }>(
      "SELECT data FROM drafts WHERE id=?",
      id,
    );
    if (!r) throw new Error("草稿不存在");
    return JSON.parse(r.data) as Draft;
  }
  create(model: Model, settings: Settings, projectId: string | null) {
    return this.save({
      draftId: randomUUID(),
      name: "",
      modelId: model.id,
      accountId: settings.defaultAccount,
      projectId,
      prompt: "",
      mentions: [],
      assets: [],
      params: {
        ...defaults(model),
        duration: 0,
        ...(model.capabilities.parameters
          .find((p) => p.key === "ratio")
          ?.options?.includes("9:16")
          ? { ratio: "9:16" }
          : {}),
      },
      outputDir: settings.lastOutputDir || settings.outputDir,
    });
  }
  remove(id: string) {
    this.db.run("DELETE FROM drafts WHERE id=?", id);
    const current = this.db.get<Draft | null>("draft", null);
    if (current?.draftId === id) this.db.set("draft", null);
  }
}
