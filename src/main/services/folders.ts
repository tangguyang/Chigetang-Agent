import { randomUUID } from "node:crypto";
import type { AssetFolder, Asset } from "../../shared/types.ts";
import type { Database } from "../database/db.ts";
export class FolderManager {
  db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  list(): AssetFolder[] {
    return this.db.all(
      "SELECT id,name,parent_id parentId FROM asset_folders ORDER BY name",
    );
  }
  save(input: Partial<AssetFolder>): AssetFolder {
    const old = this.list().find((f) => f.id === input.id);
    const f = {
      id: input.id || randomUUID(),
      name: (input.name ?? old?.name ?? "").trim(),
      parentId:
        input.parentId === undefined ? (old?.parentId ?? null) : input.parentId,
    };
    if (!f.name || f.name.length > 100 || /[/\\]/.test(f.name))
      throw new Error("请输入 1–100 字的文件夹名称，不要包含斜杠。");
    let parent = f.parentId;
    const seen = new Set([f.id]);
    while (parent) {
      if (seen.has(parent)) throw new Error("不能将文件夹放入自身或子文件夹。");
      seen.add(parent);
      const row = this.list().find((r) => r.id === parent);
      if (!row) throw new Error("上级文件夹不存在，请重新选择。");
      parent = row.parentId;
    }
    try {
      this.db.run(
        "INSERT INTO asset_folders VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,parent_id=excluded.parent_id",
        f.id,
        f.name,
        f.parentId,
      );
    } catch {
      throw new Error("同级已有这个文件夹名称，请使用其他名称。");
    }
    return f;
  }
  remove(id: string) {
    const children = this.list().filter((f) => f.parentId === id);
    if (
      children.some((c) =>
        this.list().some(
          (f) => f.parentId === null && f.id !== id && f.name === c.name,
        ),
      )
    )
      throw new Error("根目录已有同名子文件夹，请先重命名再删除上级目录。");
    this.db.transaction(() => {
      this.db.run(
        "UPDATE asset_folders SET parent_id=NULL WHERE parent_id=?",
        id,
      );
      for (const row of this.db.all<{ data: string }>(
        "SELECT data FROM assets WHERE folder=?",
        id,
      )) {
        const a = JSON.parse(row.data) as Asset;
        a.folder = "";
        this.db.run(
          "UPDATE assets SET folder=?,data=? WHERE id=?",
          "",
          JSON.stringify(a),
          a.id,
        );
      }
      this.db.run("DELETE FROM asset_folders WHERE id=?", id);
    });
  }
}
