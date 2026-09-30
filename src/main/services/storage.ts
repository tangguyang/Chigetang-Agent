import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, join, isAbsolute, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Settings } from "../../shared/types.ts";
export const directoryKeys = [
  "outputDir",
  "audioDir",
  "otherDir",
  "backupDir",
] as const;
export const WINDOWS_DATA_ROOT = "D:\\吃个糖Agent数据库";
export const managedDirectories = [
  "database",
  "config",
  "voices",
  "projects",
  "outputs",
  "cloud",
  "cache",
  "backups",
  "logs",
] as const;
export function ensureDataLayout(root: string) {
  for (const name of managedDirectories)
    mkdirSync(join(root, name), { recursive: true });
}
export function defaultDirectories(root: string) {
  return {
    outputDir: join(root, "outputs", "video"),
    audioDir: join(root, "outputs", "audio"),
    otherDir: join(root, "outputs", "other"),
    backupDir: join(root, "backups"),
  };
}
export async function writableDirectory(path: string) {
  if (!isAbsolute(path))
    throw new Error("保存目录必须是完整路径，请重新选择文件夹。");
  try {
    await mkdir(path, { recursive: true });
    const probe = join(path, `.write-${randomUUID()}`);
    const handle = await open(probe, "wx");
    await handle.close();
    await unlink(probe);
  } catch {
    throw new Error(
      "保存目录不可写。请检查磁盘空间和文件夹权限，或选择其他目录。",
    );
  }
}
export function validateDataRoot(root: string) {
  if (process.platform === "win32" && root !== WINDOWS_DATA_ROOT)
    throw new Error(`用户数据目录必须固定为 ${WINDOWS_DATA_ROOT}。`);
  try {
    ensureDataLayout(root);
    const probe = join(root, `.write-${randomUUID()}`);
    writeFileSync(probe, "ok", { flag: "wx" });
    rmSync(probe);
  } catch {
    throw new Error(
      `数据目录 ${root} 不存在、不可写或空间不足，软件已停止以防数据写入其他位置。`,
    );
  }
}
/** Copy-once migration: source remains untouched; only a complete staging tree is published. */
export function migrateLegacyRoot(destination: string, candidates: string[]) {
  if (existsSync(join(destination, "database", "ai-video.sqlite"))) {
    ensureDataLayout(destination);
    return;
  }
  const sources = [...new Set(candidates)].filter(
    (p) =>
      p !== destination &&
      (existsSync(join(p, "database", "ai-video.sqlite")) ||
        existsSync(join(p, "data", "ai-video.sqlite"))),
  );
  if (sources.length > 1)
    throw new Error(
      `检测到多个旧数据目录，无法安全自动选择。请设置 AIVIDEO_LEGACY_ROOT 指向要迁移的目录：${sources.join("；")}`,
    );
  if (!sources.length) {
    ensureDataLayout(destination);
    return;
  }
  const source = sources[0];
  const nested = relative(source, destination);
  if (
    nested &&
    !nested.startsWith("..") &&
    !isAbsolute(nested) &&
    dirname(destination) !== source
  )
    throw new Error("新数据目录不能位于旧数据目录内部。");
  const staging = destination + ".migrating-" + randomUUID();
  ensureDataLayout(staging);
  try {
    // SQLite snapshot includes committed WAL; never copy a live SQLite file alone.
    const sourceDb = existsSync(join(source, "database", "ai-video.sqlite"))
      ? join(source, "database", "ai-video.sqlite")
      : join(source, "data", "ai-video.sqlite");
    const old = new DatabaseSync(sourceDb, {
      readOnly: true,
    });
    try {
      if (old.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
        throw new Error("旧数据库完整性检查失败");
      old.exec(
        `VACUUM INTO '${join(staging, "database", "ai-video.sqlite").replaceAll("'", "''")}'`,
      );
    } finally {
      old.close();
    }
    cpSync(
      join(staging, "database", "ai-video.sqlite"),
      join(staging, "backups", `pre-v107-${Date.now()}.sqlite`),
    );
    for (const name of [
      "assets",
      "projects",
      "outputs",
      "backups",
      "logs",
      "voices",
      "cloud",
      "cache",
    ]) {
      if (existsSync(join(source, name)))
        cpSync(join(source, name), join(staging, name), {
          recursive: true,
          errorOnExist: false,
        });
    }
    // Chromium Local State and profile are needed to retain OS-protected credentials/local drafts.
    const oldChromium = existsSync(join(source, "config", "chromium"))
      ? join(source, "config", "chromium")
      : join(source, "data", "chromium");
    if (existsSync(oldChromium))
      cpSync(
        oldChromium,
        join(staging, "config", "chromium"),
        { recursive: true },
      );
    const db = new DatabaseSync(join(staging, "database", "ai-video.sqlite"));
    try {
      db.prepare(
        "INSERT INTO settings(key,data) VALUES('rootPath',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      ).run(JSON.stringify(source));
    } finally {
      db.close();
    }
    writeFileSync(
      join(staging, "migration.json"),
      JSON.stringify(
        { source, migratedAt: new Date().toISOString(), version: "1.0.7" },
        null,
        2,
      ),
    );
    mkdirSync(dirname(destination), { recursive: true });
    if (existsSync(destination))
      throw new Error(
        "目标数据目录已存在但没有数据库，请先检查其内容，不能自动覆盖。",
      );
    renameSync(staging, destination);
  } catch (e) {
    // Only our unpublished staging directory is disposable; original data is untouched.
    rmSync(staging, { recursive: true, force: true });
    throw new Error(
      `用户数据迁移失败，已停止启动；旧数据完整保留。${String(e)}`,
    );
  }
}
export function assertOutsideProgram(root: string, program: string) {
  const r = relative(program, root);
  if (!r || (!r.startsWith("..") && !isAbsolute(r)))
    throw new Error(
      "用户数据目录不能位于程序目录内，请将 AIVIDEO_USER_DATA_ROOT 设置到独立目录。",
    );
}
