import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync, backup } from "node:sqlite";
import { migrations } from "./schema.ts";
export class Database {
  db: DatabaseSync;
  path: string;
  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0,
    );
    if (version > migrations.at(-1)!.version)
      throw new Error(
        "数据由较新版本创建，请使用最新 AI Video，禁止降级覆盖。",
      );
    const pending = migrations.filter((m) => m.version > version);
    if (pending.length) {
      try {
        if (version > 0 && pending.some((migration) => migration.backup)) {
          const dst = join(
            dirname(path),
            `pre-migration-v${version}-${Date.now()}.sqlite`,
          );
          this.db.exec(`VACUUM INTO '${dst.replaceAll("'", "''")}'`);
        }
        this.transaction(() => {
          for (const m of pending) {
            this.db.exec(m.sql);
            this.db.exec(`PRAGMA user_version=${m.version}`);
          }
          const check = this.db.prepare("PRAGMA integrity_check").get();
          if (check?.integrity_check !== "ok")
            throw new Error("数据库完整性检查失败");
          if (this.db.prepare("PRAGMA foreign_key_check").all().length)
            throw new Error("数据库关联检查失败");
        });
      } catch (error) {
        this.db.close();
        throw new Error(
          `数据库迁移失败，已回滚并停止启动。原数据及升级前备份保留，请检查磁盘权限/空间后重试。${String(error)}`,
        );
      }
    }
  }
  run(sql: string, ...p: SQLInputValue[]) {
    return this.db.prepare(sql).run(...p);
  }
  one<T>(sql: string, ...p: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...p) as T | undefined;
  }
  all<T>(sql: string, ...p: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...p) as T[];
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  get<T>(key: string, fallback: T): T {
    const row = this.one<{ data: string }>(
      "SELECT data FROM settings WHERE key=?",
      key,
    );
    return row ? (JSON.parse(row.data) as T) : fallback;
  }
  set(key: string, value: unknown) {
    this.run(
      "INSERT INTO settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      key,
      JSON.stringify(value),
    );
  }
  async backupTo(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) throw new Error("备份文件已存在");
    await backup(this.db, path);
    return path;
  }
  close() {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.close();
  }
}
