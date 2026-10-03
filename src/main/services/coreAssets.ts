import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { join, basename, relative, isAbsolute, resolve } from "node:path";
import type { Application } from "./application.ts";
import type { CoreAsset } from "../../shared/production.ts";
const types = ["person", "product", "brand", "voice", "other"];
export class CoreAssetService {
  private registering = new Set<string>();
  app: Application;
  directory: string;
  constructor(app: Application, directory: string) {
    this.app = app;
    this.directory = directory;
  }
  initialize() {
    mkdirSync(this.directory, { recursive: true });
    for (const t of types)
      mkdirSync(join(this.directory, t), { recursive: true });
    if (!existsSync(this.manifest)) this.save([]);
  }
  get manifest() {
    return join(this.directory, "manifest.json");
  }
  list(): CoreAsset[] {
    if (!existsSync(this.manifest)) return [];
    const m = JSON.parse(readFileSync(this.manifest, "utf8"));
    if (
      m.schema !== "chigetang.core-assets" ||
      m.version !== 1 ||
      !Array.isArray(m.assets)
    )
      throw Error("核心素材manifest无效");
    return m.assets;
  }
  private save(assets: CoreAsset[]) {
    const temp = this.manifest + "." + randomUUID() + ".tmp";
    writeFileSync(
      temp,
      JSON.stringify(
        { schema: "chigetang.core-assets", version: 1, assets },
        null,
        2,
      ),
    );
    renameSync(temp, this.manifest);
  }
  private checkedPath(p: string) {
    const base = realpathSync(this.directory),
      full = realpathSync(p),
      rel = relative(base, full);
    if (
      !rel ||
      rel.startsWith("..") ||
      isAbsolute(rel) ||
      !lstatSync(full).isFile()
    )
      throw Error("核心素材路径越界");
    return full;
  }
  async resolve(alias: string) {
    const a = this.list().find((x) => x.alias === alias);
    if (!a) throw Error("核心素材alias未登记：" + alias);
    const path = this.checkedPath(a.path);
    if (
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex") !== a.sha256
    )
      throw Error("核心素材SHA256变化，请明确重新登记");
    const asset = this.app.assets.get(a.assetId);
    if (
      asset.hash !== a.sha256 ||
      realpathSync(asset.managedPath || asset.originalPath) !== path
    )
      throw Error("核心素材绑定已变化，请重新登记");
    return { ...a, path };
  }
  async register(p: {
    alias: string;
    type: string;
    path: string;
    description?: string;
    designated: boolean;
  }) {
    const alias = String(p.alias || "").trim();
    if (this.registering.has(alias))
      throw Error("alias正在登记，请等待当前操作完成");
    this.registering.add(alias);
    try {
      return await this.registerUnlocked(p);
    } finally {
      this.registering.delete(alias);
    }
  }
  private async registerUnlocked(p: {
    alias: string;
    type: string;
    path: string;
    description?: string;
    designated: boolean;
  }) {
    if (p.designated !== true) throw Error("仅登记用户明确指定的长期核心素材");
    if (
      typeof p.alias !== "string" ||
      !p.alias.trim() ||
      p.alias.length > 100 ||
      !types.includes(p.type)
    )
      throw Error("核心素材alias/分类无效");
    this.initialize();
    if (this.list().some((x) => x.alias === p.alias.trim()))
      throw Error("alias已存在，禁止静默替换");
    const imported = await this.app.assets.import(resolve(p.path), false),
      source = await this.app.assets.verify(imported.asset, false);
    if (
      (p.type === "voice" && imported.asset.kind !== "audio") ||
      (["person", "product", "brand"].includes(p.type) &&
        imported.asset.kind !== "image")
    )
      throw Error("核心素材分类与文件类型不符");
    const data = await readFile(source),
      sha256 = createHash("sha256").update(data).digest("hex"),
      destination = join(
        this.directory,
        p.type,
        sha256 + "-" + basename(source),
      );
    const directory = realpathSync(join(this.directory, p.type));
    const rel = relative(realpathSync(this.directory), directory);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw Error("核心素材分类路径越界");
    if (!existsSync(destination)) await copyFile(source, destination, 1);
    this.checkedPath(destination);
    const managed = await this.app.assets.import(destination, false);
    const asset = managed.asset;
    asset.managedPath = destination;
    this.app.assets.save(asset);
    if (this.list().some((x) => x.alias === p.alias.trim()))
      throw Error("alias已存在，禁止静默替换");
    const a: CoreAsset = {
      alias: p.alias.trim(),
      type: p.type as CoreAsset["type"],
      path: destination,
      sha256,
      updatedAt: new Date().toISOString(),
      description: String(p.description || "").slice(0, 1000),
      assetId: managed.asset.id,
    };
    this.save([...this.list(), a]);
    this.app.changed();
    return a;
  }
}
