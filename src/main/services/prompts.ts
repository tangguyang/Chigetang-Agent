import { randomUUID } from "node:crypto";
import type { ListQuery, Page, Prompt } from "../../shared/types.ts";
import type { Database } from "../database/db.ts";
export class PromptManager {
  db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  save(input: Partial<Prompt> & { content: string; name: string }) {
    if (!input.name.trim()) throw new Error("请输入模板名称。");
    const previous = input.id
      ? this.db.one<{ data: string }>(
          "SELECT data FROM prompts WHERE id=?",
          input.id,
        )
      : undefined;
    const old = previous ? (JSON.parse(previous.data) as Prompt) : undefined;
    const now = new Date().toISOString();
    const item: Prompt = {
      id: input.id || randomUUID(),
      name: input.name,
      content: input.content,
      folder: input.folder ?? "",
      tags: input.tags ?? [],
      favorite: input.favorite ?? false,
      projectId: input.projectId ?? null,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      version: (old?.version ?? 0) + 1,
    };
    this.db.transaction(() => {
      this.db.run(
        "INSERT INTO prompts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,content=excluded.content,folder=excluded.folder,project_id=excluded.project_id,favorite=excluded.favorite,updated_at=excluded.updated_at,data=excluded.data",
        item.id,
        item.name,
        item.content,
        item.folder,
        item.projectId,
        Number(item.favorite),
        now,
        JSON.stringify(item),
      );
      this.db.run(
        "INSERT INTO prompt_versions VALUES(?,?,?,?,?)",
        randomUUID(),
        item.id,
        item.version,
        item.content,
        now,
      );
    });
    return item;
  }
  list(q: ListQuery = {}): Page<Prompt> {
    const text = `%${q.search ?? ""}%`;
    const favorite = q.favorite ? " AND favorite=1" : "";
    const project = q.projectId ? " AND project_id=?" : "";
    const folder = q.folder ? " AND folder=?" : "";
    const p = [
      text,
      text,
      text,
      ...(q.projectId ? [q.projectId] : []),
      ...(q.folder ? [q.folder] : []),
    ];
    const sql = `(name LIKE ? OR content LIKE ? OR data LIKE ?)${favorite}${project}${folder}`;
    return {
      total:
        this.db.one<{ n: number }>(
          `SELECT count(*) n FROM prompts WHERE ${sql}`,
          ...p,
        )?.n ?? 0,
      items: this.db
        .all<{
          data: string;
        }>(
          `SELECT data FROM prompts WHERE ${sql} ORDER BY updated_at DESC LIMIT 40 OFFSET ?`,
          ...p,
          ((q.page ?? 1) - 1) * 40,
        )
        .map((r) => JSON.parse(r.data) as Prompt),
    };
  }
  versions(id: string) {
    return this.db.all<{
      version: number;
      content: string;
      created_at: string;
    }>(
      "SELECT version,content,created_at FROM prompt_versions WHERE prompt_id=? ORDER BY version DESC",
      id,
    );
  }
}
