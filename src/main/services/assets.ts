import { usageRoles } from "../../shared/mentions.ts";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, mkdir, open, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import type { Asset, AssetKind, ListQuery, Page } from "../../shared/types.ts";
import type { Database } from "../database/db.ts";
import { AppError } from "./errors.ts";
const mime: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
};
const detectedMime: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

/** Bounded signature check: validation never trusts the filename extension alone. */
export async function detectFileSignature(path: string) {
  const handle = await open(path, "r");
  const buffer = Buffer.alloc(64);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  await handle.close();
  const bytes = buffer.subarray(0, bytesRead);
  const ascii = (start: number, end: number) =>
    bytes.subarray(start, end).toString("ascii");
  let format = "";
  let hasAlpha = false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) format = "jpg";
  else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    format = "png";
    const colorType = bytes[25];
    hasAlpha = colorType === 4 || colorType === 6;
  } else if (ascii(0, 2) === "BM") format = "bmp";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    format = "webp";
    hasAlpha = ascii(12, 16) === "VP8X" && Boolean(bytes[20] & 0x10);
  } else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") format = "wav";
  else if (
    ascii(0, 3) === "ID3" ||
    (bytes[0] === 0xff &&
      (bytes[1] & 0xe0) === 0xe0 &&
      (bytes[1] & 0x06) !== 0)
  )
    format = "mp3";
  else if (ascii(4, 8) === "ftyp")
    format = ascii(8, 12) === "qt  " ? "mov" : "mp4";
  return {
    format,
    mime: detectedMime[format] || "application/octet-stream",
    kind: detectedMime[format]?.split("/")[0] as AssetKind | undefined,
    hasAlpha,
  };
}
export async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export type Probe = (
  path: string,
  kind: AssetKind,
  id: string,
) => Promise<Partial<Asset>>;
export class AssetManager {
  db: Database;
  root: string;
  probe: Probe;
  directory: () => string;
  afterImport: (asset: Asset) => void = () => {};
  constructor(db: Database, root: string, probe: Probe = async () => ({})) {
    this.db = db;
    this.root = root;
    this.probe = probe;
    this.directory = () => join(root, "assets");
  }
  get(id: string) {
    const r = this.db.one<{ data: string }>(
      "SELECT data FROM assets WHERE id=?",
      id,
    );
    if (!r) throw new AppError("AssetMissingError", "资产不存在。");
    return JSON.parse(r.data) as Asset;
  }
  async import(path: string, copy: boolean, projectId: string | null = null) {
    const info = await stat(path).catch(() => {
      throw new AppError(
        "AssetMissingError",
        "原始资产不可用，请重新定位文件。",
      );
    });
    if (!info.isFile()) throw new AppError("ValidationError", "请选择文件。");
    const type = mime[extname(path).slice(1).toLowerCase()];
    if (!type)
      throw new AppError(
        "ValidationError",
        "不支持此格式，请选择图片、视频或音频。",
      );
    const signature = await detectFileSignature(path);
    if (signature.format && signature.kind !== type.split("/")[0])
      throw new AppError(
        "ValidationError",
        `文件格式不匹配：${basename(path)}。实际内容与扩展名不一致，请重新导出后上传。`,
      );
    const hash = await hashFile(path);
    const duplicate = this.db.one<{ id: string }>(
      "SELECT id FROM assets WHERE hash=?",
      hash,
    );
    if (duplicate) {
      let asset = this.get(duplicate.id);
      const available = await this.validPath(asset).catch(() => null);
      if (asset.libraryDeletedAt || !available) {
        asset.libraryDeletedAt = null;
        asset.originalPath = path;
        asset.managedPath = null;
        asset.name = basename(path);
        asset.size = info.size;
        asset.unavailableAt = null;
        this.save(asset);
        asset = await this.refreshMetadata(asset.id);
      }
      return { asset, duplicate: true };
    }
    const id = randomUUID();
    let managedPath: string | null = null;
    if (copy) {
      await mkdir(this.directory(), { recursive: true });
      managedPath = join(this.directory(), id + extname(path).toLowerCase());
      await copyFile(path, managedPath, constants.COPYFILE_EXCL);
    }
    const kind = type.split("/")[0] as AssetKind;
    const metadata = await this.probe(managedPath || path, kind, id);
    const asset: Asset = {
      id,
      name: basename(path),
      kind,
      originalPath: path,
      managedPath,
      size: info.size,
      mime: type,
      hash,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      tags: [],
      folder: "",
      projectId,
      favorite: false,
      ...metadata,
      hasAlpha: Boolean(metadata.hasAlpha || signature.hasAlpha),
      metadata: {
        ...(metadata.metadata ?? {}),
        ...(signature.format
          ? { detectedFormat: signature.format, detectedMime: signature.mime }
          : {}),
      },
    };
    this.db.run(
      "INSERT INTO assets(id,hash,name,kind,project_id,folder,favorite,created_at,data) VALUES(?,?,?,?,?,?,?,?,?)",
      id,
      hash,
      asset.name,
      kind,
      projectId,
      "",
      0,
      asset.createdAt,
      JSON.stringify(asset),
    );
    this.afterImport(asset);
    return { asset, duplicate: false };
  }
  save(asset: Asset) {
    if (
      asset.defaultUsage !== undefined &&
      !usageRoles.includes(asset.defaultUsage)
    )
      throw new Error("素材用途无效");
    this.db.transaction(() => {
      this.db.run(
        "UPDATE assets SET name=?,project_id=?,folder=?,favorite=?,data=? WHERE id=?",
        asset.name,
        asset.projectId,
        asset.folder,
        Number(asset.favorite),
        JSON.stringify(asset),
        asset.id,
      );
      this.db.run("DELETE FROM asset_tags WHERE asset_id=?", asset.id);
      for (const tag of new Set(asset.tags))
        this.db.run("INSERT INTO asset_tags VALUES(?,?)", asset.id, tag);
    });
  }
  private async validPath(asset: Asset, checkHash = true) {
    const candidates = [asset.managedPath, asset.originalPath].filter(
      (value, index, values): value is string =>
        Boolean(value) && values.indexOf(value) === index,
    );
    for (const path of candidates) {
      const info = await stat(path).catch(() => null);
      if (!info?.isFile() || info.size !== asset.size) continue;
      if (checkHash && (await hashFile(path)) !== asset.hash) continue;
      return path;
    }
    throw new AppError(
      "AssetMissingError",
      `原始资产不可用：${asset.name}。请在资产库重新定位。`,
    );
  }
  async verify(asset: Asset, hash = true) {
    const path = await this.validPath(asset, hash).catch(() => {
      if (!asset.unavailableAt) {
        asset.unavailableAt = new Date().toISOString();
        this.save(asset);
      }
      throw new AppError(
        "AssetMissingError",
        `原始资产不可用：${asset.name}。请在资产库重新定位。`,
      );
    });
    if (asset.unavailableAt) {
      asset.unavailableAt = null;
      this.save(asset);
    }
    return path;
  }
  async relocate(id: string, path: string) {
    const a = this.get(id);
    if ((await hashFile(path)) !== a.hash)
      throw new AppError(
        "ValidationError",
        "新文件内容与原资产不同，请作为新资产导入。",
      );
    a.originalPath = path;
    a.managedPath = null;
    a.unavailableAt = null;
    this.save(a);
    return this.refreshMetadata(a.id);
  }
  async relocateFolder(id: string, newRoot: string) {
    const anchor = this.get(id);
    const oldRoot = dirname(anchor.originalPath);
    if (!isAbsolute(newRoot)) throw new Error("请选择完整的新文件夹路径。");
    const rows = this.db.all<{ data: string }>("SELECT data FROM assets");
    let repaired = 0;
    const failed: string[] = [];
    for (const row of rows) {
      const asset = JSON.parse(row.data) as Asset;
      const rel = relative(oldRoot, asset.originalPath);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
      const candidate = join(newRoot, rel);
      if (await this.validPath(asset).catch(() => null)) continue;
      try {
        if ((await hashFile(candidate)) !== asset.hash) {
          failed.push(asset.name);
          continue;
        }
        asset.originalPath = candidate;
        asset.managedPath = null;
        asset.unavailableAt = null;
        const refreshed = await this.probe(candidate, asset.kind, asset.id);
        Object.assign(asset, refreshed);
        this.save(asset);
        repaired++;
      } catch {
        failed.push(asset.name);
      }
    }
    return { repaired, failed, oldRoot, newRoot };
  }
  async refresh() {
    const rows = this.db.all<{ data: string }>("SELECT data FROM assets");
    let available = 0;
    let missing = 0;
    for (const row of rows) {
      const asset = JSON.parse(row.data) as Asset;
      if (asset.libraryDeletedAt) continue;
      if (await this.validPath(asset).catch(() => null)) {
        available++;
        if (asset.unavailableAt) {
          asset.unavailableAt = null;
          this.save(asset);
        }
      } else {
        missing++;
        if (!asset.unavailableAt) {
          asset.unavailableAt = new Date().toISOString();
          this.save(asset);
        }
      }
    }
    return { available, missing };
  }
  removeRecords(ids: string[]) {
    const unique = [...new Set(ids)].filter(Boolean);
    const removedAt = new Date().toISOString();
    for (const id of unique) {
      const asset = this.get(id);
      asset.libraryDeletedAt = removedAt;
      this.db.run(
        "UPDATE assets SET data=? WHERE id=?",
        JSON.stringify(asset),
        asset.id,
      );
    }
    return unique.length;
  }
  /** Roll back only records created by a failed task-package import and still wholly unreferenced. */
  rollbackUnreferencedImports(items: Array<{ id: string; expectedOriginalPath: string }>) {
    const removed: string[] = [], retained: string[] = [];
    this.db.transaction(() => {
      for (const item of items) {
        let asset: Asset;
        try { asset = this.get(item.id); } catch { continue; }
        const linked = this.db.one<{ n: number }>(
          `SELECT
            (SELECT count(*) FROM task_assets WHERE asset_id=?) +
            (SELECT count(*) FROM project_assets WHERE asset_id=?) +
            (SELECT count(*) FROM cloud_uploads WHERE asset_id=?) n`,
          item.id, item.id, item.id,
        )?.n ?? 0;
        if (linked || asset.originalPath !== item.expectedOriginalPath || asset.managedPath) {
          retained.push(item.id);
          continue;
        }
        this.db.run("DELETE FROM asset_tags WHERE asset_id=?", item.id);
        this.db.run("DELETE FROM assets WHERE id=?", item.id);
        removed.push(item.id);
      }
    });
    return { removed, retained };
  }
  async list(q: ListQuery = {}): Promise<Page<Asset>> {
    const where = [
        "COALESCE(json_extract(data,'$.metadata.source'),'') NOT IN ('segment-temp','segment-result','wan-audio-trim')",
        "json_extract(data,'$.libraryDeletedAt') IS NULL",
        q.hidden
          ? "json_extract(data,'$.unavailableAt') IS NOT NULL"
          : "json_extract(data,'$.unavailableAt') IS NULL",
      ],
      p: (string | number)[] = [];
    if (q.search) {
      where.push("(name LIKE ? OR data LIKE ?)");
      p.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.kind) {
      where.push("kind=?");
      p.push(q.kind);
    }
    if (q.projectId) {
      where.push("project_id=?");
      p.push(q.projectId);
    }
    if (q.folder) {
      where.push("folder=?");
      p.push(q.folder);
    }
    if (q.favorite) where.push("favorite=1");
    if (q.generated)
      where.push("json_extract(data,'$.metadata.source')='generated'");
    if (q.from) {
      where.push("created_at>=?");
      p.push(q.from);
    }
    if (q.to) {
      where.push("created_at<=?");
      p.push(q.to);
    }
    const sql = where.join(" AND ");
    const size = Math.min(100, q.pageSize ?? 40);
    const selectRows = () => this.db.all<{ data: string }>(
        `SELECT data FROM assets WHERE ${sql} ORDER BY favorite DESC, ${q.sort !== "created" ? "COALESCE(json_extract(data,'$.lastUsedAt'),created_at)" : "created_at"} DESC LIMIT ? OFFSET ?`,
        ...p,
        size,
        Math.max(0, ((q.page ?? 1) - 1) * size),
      );
    let rows = selectRows();
    let changed = false;
    await Promise.all(rows.map(async (r) => {
      const asset = JSON.parse(r.data) as Asset;
      const exists = Boolean(await this.validPath(asset).catch(() => null));
      if (exists === Boolean(asset.unavailableAt)) {
        asset.unavailableAt = exists ? null : new Date().toISOString();
        this.save(asset);
        changed = true;
      }
    }));
    if (changed) rows = selectRows();
    const total = this.db.one<{ n: number }>(
      `SELECT count(*) n FROM assets WHERE ${sql}`,
      ...p,
    )?.n ?? 0;
    const items = rows.map((r) => {
        const a = JSON.parse(r.data) as Asset;
        a.missing = Boolean(a.unavailableAt);
        a.usageCount =
          this.db.one<{ n: number }>(
            "SELECT count(*) n FROM task_assets WHERE asset_id=?",
            a.id,
          )?.n ?? 0;
        return a;
      });
    return { items, total };
  }
  async refreshMetadata(id: string) {
    const asset = this.get(id);
    const path = await this.verify(asset, false);
    const info = await stat(path);
    const signature = await detectFileSignature(path);
    const format = signature.format || asset.metadata?.detectedFormat || "";
    const actualKind = signature.kind || detectedMime[format]?.split("/")[0];
    if (!format || actualKind !== asset.kind)
      throw new AppError(
        "ValidationError",
        `${asset.name} 的实际文件格式无法确认或与资产类型不一致，请重新导入有效文件。`,
      );
    const probed = await this.probe(path, asset.kind, asset.id).catch(() => {
      throw new AppError(
        "ValidationError",
        `${asset.name} 媒体信息读取失败，不能作为合规素材提交。请重新导出后上传。`,
      );
    });
    Object.assign(asset, probed, {
      size: info.size,
      hasAlpha: Boolean(probed.hasAlpha || signature.hasAlpha),
      unavailableAt: null,
      metadata: {
        ...asset.metadata,
        ...(probed.metadata ?? {}),
        detectedFormat: format,
        detectedMime: signature.format
          ? signature.mime
          : detectedMime[format] || asset.mime,
      },
    });
    this.save(asset);
    return asset;
  }
  async dataURL(asset: Asset) {
    return `data:${asset.mime};base64,${(await readFile(await this.verify(asset))).toString("base64")}`;
  }
}
