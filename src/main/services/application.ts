import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { brand } from "../../shared/brand.ts";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  engineModels as seedModels,
  engineProviders as seedProviders,
} from "../../shared/engineCatalog.ts";
import { requestedWanPrice, validatePrice } from "../../shared/pricing.ts";
import type {
  Asset,
  Bootstrap,
  Draft,
  Model,
  Project,
  Provider,
  Settings,
  Task,
  Voice,
} from "../../shared/types.ts";
import { Database } from "../database/db.ts";
import { createEngineAdapter as createAdapter } from "../models/engineAdapters.ts";
import { accountAdapter, testConnection } from "../providers/engineAccounts.ts";
import { secureURL, HttpClient, type Fetcher } from "../providers/http.ts";
import { AssetManager, type Probe } from "./assets.ts";
import { BillingManager } from "./billing.ts";
import { CredentialManager, type Vault } from "./credentials.ts";
import { DownloadManager } from "./downloads.ts";
import { DraftManager } from "./drafts.ts";
import { AppError } from "./errors.ts";
import { Logger } from "./logger.ts";
import { PromptManager } from "./prompts.ts";
import { EngineTaskService as TaskService } from "./engineTasks.ts";
import { audioModels } from "../../shared/audioCatalog.ts";
import { AudioService } from "./audio.ts";
import { FolderManager } from "./folders.ts";
import {
  defaultDirectories,
  directoryKeys,
} from "./storage.ts";
import { ThumbnailQueue } from "./thumbnails.ts";
export class Application {
  thumbnails: ThumbnailQueue;
  audio: AudioService;
  folders: FolderManager;
  root: string;
  db: Database;
  assets: AssetManager;
  credentials: CredentialManager;
  prompts: PromptManager;
  tasks: TaskService;
  drafts: DraftManager;
  billing: BillingManager;
  logger: Logger;
  origins: string[] = [];
  changed: () => void;
  fetcher: Fetcher;
  programPath: string;
  constructor(
    root: string,
    vault: Vault,
    probe: Probe,
    changed: () => void,
    notify: ConstructorParameters<typeof TaskService>[0]["notify"],
    fetcher: Fetcher = fetch,
    programPath: string = process.cwd(),
  ) {
    this.root = root;
    this.fetcher = fetcher;
    this.programPath = programPath;
    this.changed = changed;
    const databasePath=join(root,"database","ai-video.sqlite");
    const existed=existsSync(databasePath);
    this.db = new Database(databasePath);
    if(existed&&!this.db.get('v128-backup',false)){
      const backupPath=join(root,'database','pre-v128-'+Date.now()+'.sqlite');
      this.db.db.prepare('VACUUM INTO ?').run(backupPath);
      this.db.set('v128-backup',backupPath);
    }
    this.clearLegacyAudioData();
    this.origins = this.db.get<string[]>("rootOrigins", []);
    const previous = this.db.get<string>("rootPath", root);
    if (previous !== root && !this.origins.includes(previous))
      this.origins.push(previous);
    this.db.set("rootOrigins", this.origins);
    this.db.set("rootPath", root);
    this.logger = new Logger(join(root, "logs"));
    this.assets = new AssetManager(this.db, root, probe);
    // New user imports are reference-only. This directory exists solely for
    // explicit internal copy operations and legacy compatibility.
    this.assets.directory = () => join(root, "cache", "managed-assets");
    this.folders = new FolderManager(this.db);
    if (this.origins.length) {
      for (const row of this.db.all<{ data: string }>(
        "SELECT data FROM assets",
      )) {
        const a = JSON.parse(row.data) as Asset;
        const original = this.resolvePath(a.originalPath);
        if (existsSync(original)) a.originalPath = original;
        if (a.managedPath) a.managedPath = this.resolvePath(a.managedPath);
        if (a.thumbnailPath)
          a.thumbnailPath = this.resolvePath(a.thumbnailPath);
        this.assets.save(a);
      }
    }
    this.credentials = new CredentialManager(this.db, vault);
    this.drafts = new DraftManager(this.db);
    this.billing = new BillingManager(this.db);
    this.prompts = new PromptManager(this.db);
    for (const p of seedProviders)
      this.db.run(
        "INSERT OR IGNORE INTO providers VALUES(?,?)",
        p.id,
        JSON.stringify(p),
      );
    this.db.transaction(() => {
    for (const m of seedModels)
      this.db.run(
        "INSERT OR IGNORE INTO models VALUES(?,?)",
        m.id,
        JSON.stringify(m),
      );
    for (const m of audioModels(seedModels[0]))
      this.db.run(
        "INSERT INTO models(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        m.id,
        JSON.stringify(m),
      );
      this.db.set("v109-cosyvoice-workbench", true);
    });
    const wan = this.models().find((model) => model.id === "wan3");
    if (
      wan &&
      (wan.capabilities.inputOutputDurationLimit !== 30 ||
        wan.adapterVersion !== brand.version)
    ) {
      wan.capabilities.inputOutputDurationLimit = 30;
      wan.adapterVersion = brand.version;
      this.db.run(
        "UPDATE models SET data=? WHERE id=?",
        JSON.stringify(wan),
        wan.id,
      );
    }
    for (const m of this.models())
      this.db.run(
        "INSERT OR IGNORE INTO pricing_configs VALUES(?,?)",
        m.id,
        JSON.stringify(m.price),
      );
    if (!this.db.get("initialized", false)) {
      // New workspaces no longer create project groups.
      this.db.set("initialized", true);
    }
    if (!this.db.get("v104-account-price", false)) {
      this.db.transaction(() => {
        for (const a of this.credentials
          .list()
          .filter((a) => a.providerId === "alibaba")) {
          a.modelPrices = { wan3: requestedWanPrice(), ...a.modelPrices };
          this.db.run(
            "UPDATE credentials SET data=? WHERE id=?",
            JSON.stringify(a),
            a.id,
          );
        }
        this.db.set("v104-account-price", true);
      });
    }
    this.tasks = new TaskService({
      db: this.db,
      assets: this.assets,
      credentials: this.credentials,
      models: () => this.models(),
      providers: () => this.providers(),
      settings: () => this.settings(),
      adapter: (m) => {
        const h = new HttpClient(
          this.fetcher,
          this.logger,
          this.settings().maxRetries,
        );
        const dm = new DownloadManager(
          this.logger,
          this.settings().downloadTimeoutSeconds * 1000,
          this.fetcher,
        );
        return createAdapter(m, h, (u, d) => dm.download(u, d));
      },
      logger: this.logger,
      changed,
      notify,
      resolvePath: (path) => this.resolvePath(path),
    });
    this.audio = new AudioService(this);
    this.thumbnails = new ThumbnailQueue(this);
    this.assets.afterImport = (a) => this.thumbnails.enqueue(a);
    if (!this.db.get("v107-fixed-directories", false)) {
      const fixed = defaultDirectories(this.root);
      this.db.transaction(() => {
        for (const row of this.db.all<{ id: string; data: string }>(
          "SELECT id,data FROM drafts",
        )) {
          const draft = JSON.parse(row.data) as Draft;
          draft.outputDir = fixed.outputDir;
          this.db.run(
            "UPDATE drafts SET data=? WHERE id=?",
            JSON.stringify(draft),
            row.id,
          );
        }
        const current = this.db.get<Draft | null>("draft", null);
        if (current)
          this.db.set("draft", { ...current, outputDir: fixed.outputDir });
        this.db.set("v107-fixed-directories", true);
      });
    }
  }
  private clearLegacyAudioData() {
    if (this.db.get("v109-audio-cleaned", false)) return;
    const rows = this.db.all<{ id: string; task_id: string; data: string }>(
      "SELECT id,task_id,data FROM task_versions WHERE json_extract(data,'$.type')='audio'",
    );
    const versionIds = new Set(rows.map((row) => row.id));
    const taskIds = new Set(rows.map((row) => row.task_id));
    const protectedAssets = new Set<string>();
    for (const row of this.db.all<{ asset_id: string; version_id: string }>(
      "SELECT asset_id,version_id FROM task_assets",
    ))
      if (!versionIds.has(row.version_id)) protectedAssets.add(row.asset_id);
    for (const row of this.db.all<{ asset_id: string }>(
      "SELECT asset_id FROM project_assets",
    ))
      protectedAssets.add(row.asset_id);
    const collectDraftAssets = (data: string) => {
      try {
        const draft = JSON.parse(data) as Draft;
        for (const binding of draft.assets ?? [])
          protectedAssets.add(binding.assetId);
      } catch {}
    };
    for (const row of this.db.all<{ data: string }>("SELECT data FROM drafts"))
      collectDraftAssets(row.data);
    const legacyDraft = this.db.one<{ data: string }>(
      "SELECT data FROM settings WHERE key='draft'",
    );
    if (legacyDraft) collectDraftAssets(legacyDraft.data);

    const protectedPaths = new Set<string>();
    for (const id of protectedAssets) {
      const row = this.db.one<{ data: string }>(
        "SELECT data FROM assets WHERE id=?",
        id,
      );
      if (!row) continue;
      try {
        const asset = JSON.parse(row.data) as Asset;
        for (const path of [asset.originalPath, asset.managedPath])
          if (path) protectedPaths.add(resolve(path));
      } catch {}
    }

    const removableAssetIds: string[] = [];
    const fileCandidates = new Set<string>();
    for (const row of rows) {
      try {
        const task = JSON.parse(row.data) as Task;
        for (const path of [
          task.outputPath,
          ...(task.outputs ?? []).map((output) => output.localPath),
        ])
          if (path && !protectedPaths.has(resolve(path))) fileCandidates.add(path);
      } catch {}
    }
    for (const row of this.db.all<{ id: string; data: string }>(
      "SELECT id,data FROM assets WHERE kind='audio'",
    )) {
      const asset = JSON.parse(row.data) as Asset;
      if (
        protectedAssets.has(asset.id) ||
        asset.metadata?.source !== "generated" ||
        !taskIds.has(String(asset.metadata?.taskId || ""))
      )
        continue;
      const paths = [asset.originalPath, asset.managedPath].filter(
        (path): path is string => Boolean(path),
      );
      if (paths.some((path) => this.isOwnedAudioPath(path))) {
        removableAssetIds.push(asset.id);
        for (const path of paths) fileCandidates.add(path);
      }
    }
    for (const row of this.db.all<{ data: string }>("SELECT data FROM voices")) {
      try {
        const voice = JSON.parse(row.data) as Partial<Voice>;
        if (
          voice.referencePath &&
          !protectedPaths.has(resolve(voice.referencePath))
        )
          fileCandidates.add(voice.referencePath);
      } catch {}
    }

    this.db.transaction(() => {
      for (const id of versionIds) {
        for (const table of [
          "billing_audit",
          "billing_manual",
          "billing_records",
          "usage_records",
          "downloads",
          "task_results",
          "task_assets",
          "price_snapshots",
          "task_snapshots",
        ])
          this.db.run(
            `DELETE FROM ${table} WHERE ${table === "task_assets" ? "version_id" : table === "billing_audit" ? "version_id" : "version_id"}=?`,
            id,
          );
        this.db.run("DELETE FROM task_versions WHERE id=?", id);
      }
      for (const id of removableAssetIds) {
        this.db.run("DELETE FROM asset_tags WHERE asset_id=?", id);
        this.db.run("DELETE FROM project_assets WHERE asset_id=?", id);
        this.db.run("DELETE FROM assets WHERE id=?", id);
      }
      for (const id of taskIds)
        this.db.run(
          "DELETE FROM tasks WHERE id=? AND NOT EXISTS(SELECT 1 FROM task_versions WHERE task_id=?)",
          id,
          id,
        );
      this.db.run("DELETE FROM voices");
      this.db.set("v109-audio-cleaned", true);
      this.db.set("v109-audio-cleanup-report", {
        removedTaskVersions: versionIds.size,
        removedGeneratedAssets: removableAssetIds.length,
        preservedReferencedAssets: protectedAssets.size,
      });
    });
    let removedFiles = 0;
    for (const path of fileCandidates) {
      if (!this.isOwnedAudioPath(path) || !existsSync(path)) continue;
      try {
        const info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        unlinkSync(path);
        removedFiles++;
      } catch {}
    }
    const report = this.db.get<Record<string, number>>(
      "v109-audio-cleanup-report",
      {},
    );
    this.db.set("v109-audio-cleanup-report", { ...report, removedFiles });
  }
  private isOwnedAudioPath(path: string) {
    const absolute = resolve(path);
    return [join(this.root, "outputs", "audio"), join(this.root, "voices", "references")].some(
      (parent) => {
        const rel = relative(resolve(parent), absolute);
        return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
      },
    );
  }
  resolvePath(path: string) {
    for (const origin of this.origins) {
      const rel = relative(origin, path);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel))
        return join(this.root, rel);
    }
    return path;
  }
  models() {
    return this.db
      .all<{ data: string }>("SELECT data FROM models")
      .map((r) => JSON.parse(r.data) as Model);
  }
  providers() {
    return this.db
      .all<{ data: string }>("SELECT data FROM providers")
      .map((r) => JSON.parse(r.data) as Provider);
  }
  settings(): Settings {
    const settings = this.db.get<Settings>("settings", {
      theme: "system",
      language: "zh-CN",
      defaultModel: "wan3",
      defaultAccount: "auto",
      outputDir: defaultDirectories(this.root).outputDir,
      globalConcurrency: 2,
      providerConcurrency: { alibaba: 2, volcengine: 2 },
      maxRetries: 3,
      pollSeconds: 5,
      notifications: true,
      downloadTimeoutSeconds: 300,
      queuePaused: false,
      portable: true,
      lastOutputDir: defaultDirectories(this.root).outputDir,
    });
    const rememberedOutput = settings.lastOutputDir
      ? this.resolvePath(settings.lastOutputDir)
      : "";
    return {
      closeBehavior: "exit",
      ...settings,
      ...defaultDirectories(this.root),
      portable: true,
      pollSeconds:
        settings.pollSecondsCustomized || settings.pollSeconds !== 15
          ? settings.pollSeconds
          : 5,
      lastOutputDir:
        rememberedOutput && existsSync(rememberedOutput)
          ? rememberedOutput
          : defaultDirectories(this.root).outputDir,
    };
  }
  async saveSettings(value: Partial<Settings>) {
    const previousSettings = this.settings();
    const s = { ...previousSettings, ...value };
    if (value.outputDir && !value.lastOutputDir)
      s.lastOutputDir = value.outputDir;
    if (Object.hasOwn(value, "pollSeconds")) s.pollSecondsCustomized = true;
    if (!["system", "dark", "light"].includes(s.theme))
      throw new AppError("ValidationError", "无效主题。");
    for (const [k, min, max] of [
      ["globalConcurrency", 1, 10],
      ["maxRetries", 0, 10],
      ["pollSeconds", 5, 300],
      ["downloadTimeoutSeconds", 30, 3600],
    ] as const)
      if (!Number.isInteger(s[k]) || s[k] < min || s[k] > max)
        throw new AppError("ValidationError", "设置数值超出范围。");
    for (const n of Object.values(s.providerConcurrency))
      if (!Number.isInteger(n) || n < 1 || n > 10)
        throw new AppError("ValidationError", "服务商并发范围为 1–10。");
    if (!["exit", "tray"].includes(s.closeBehavior!))
      throw new Error("关闭行为无效。");
    for (const k of directoryKeys)
      if (
        Object.hasOwn(value, k) &&
        value[k] !== defaultDirectories(this.root)[k]
      )
        throw new Error(
          "v1.0.7 的永久业务目录固定在数据根目录中，不支持改到其他位置。",
        );
    this.db.transaction(() => {
      this.db.set("settings", s);
      if (value.outputDir && value.outputDir !== previousSettings.outputDir) {
        const rebase = (d: Draft) =>
          [previousSettings.outputDir, previousSettings.lastOutputDir].includes(
            d.outputDir,
          )
            ? { ...d, outputDir: s.outputDir }
            : d;
        for (const row of this.db.all<{ id: string; data: string }>(
          "SELECT id,data FROM drafts",
        ))
          this.db.run(
            "UPDATE drafts SET data=? WHERE id=?",
            JSON.stringify(rebase(JSON.parse(row.data))),
            row.id,
          );
        const current = this.db.get<Draft | null>("draft", null);
        if (current) this.db.set("draft", rebase(current));
      }
    });
    this.changed();
    return s;
  }
  projects() {
    return this.db
      .all<{ data: string }>("SELECT data FROM projects ORDER BY name")
      .map((r) => {
        const p = JSON.parse(r.data) as Project;
        return { ...p, outputDir: this.resolvePath(p.outputDir) };
      });
  }
  createProject(name: string, outputDir?: string) {
    if (!name.trim()) throw new AppError("ValidationError", "请输入项目名称。");
    const id = randomUUID();
    const p: Project = {
      id,
      name: name.trim(),
      outputDir: outputDir || join(this.root, "projects", id, "Outputs"),
      createdAt: new Date().toISOString(),
    };
    this.db.run(
      "INSERT INTO projects VALUES(?,?,?)",
      id,
      p.name,
      JSON.stringify(p),
    );
    return p;
  }
  bootstrap(): Bootstrap {
    const draft = this.db.get<Draft | null>("draft", null);
    if (draft) draft.outputDir = this.resolvePath(draft.outputDir);
    return {
      models: this.models(),
      providers: this.providers(),
      accounts: this.credentials.list(),
      projects: this.projects(),
      settings: this.settings(),
      draft,
      root: this.root,
      installPath: this.programPath,
      version: brand.version,
    };
  }
  saveDraft(draft: Draft) {
    return this.drafts.save(draft);
  }
  newDraft() {
    const settings = this.settings();
    const accounts = this.credentials.list().filter((a) => a.enabled);
    const preferred =
      accounts.find((a) => a.id === settings.defaultAccount) ?? accounts[0];
    const available = this.models().filter(
      (m) => m.enabled && m.type === "video",
    );
    const model =
      available.find(
        (m) =>
          m.id === settings.defaultModel &&
          (!preferred || m.providerId === preferred.providerId),
      ) ??
      available.find((m) => m.providerId === preferred?.providerId) ??
      available[0];
    const account =
      accounts.find(
        (a) =>
          a.id === settings.defaultAccount && a.providerId === model.providerId,
      ) ?? accounts.find((a) => a.providerId === model.providerId);
    return this.drafts.create(
      model,
      { ...settings, defaultAccount: account?.id ?? "auto" },
      null,
    );
  }
  async testAccount(id: string, modelId?: string) {
    const account = this.credentials.list().find((a) => a.id === id);
    if (!account) throw new Error("账户不存在");
    const provider = this.providers().find((p) => p.id === account.providerId)!;
    const model =
      this.models().find(
        (m) => m.id === modelId && m.providerId === provider.id,
      ) ?? this.models().find((m) => m.providerId === provider.id)!;
    return testConnection(
      account,
      model,
      provider,
      () => this.credentials.getKey(id),
      new HttpClient(this.fetcher, this.logger, 0),
    );
  }
  async balance(id: string) {
    const account = this.credentials.list().find((a) => a.id === id);
    if (!account) throw new Error("账户不存在");
    return accountAdapter(
      this.providers().find((p) => p.id === account.providerId)!,
    ).balance();
  }
  updateModel(id: string, patch: Partial<Model>) {
    const m = this.models().find((m) => m.id === id);
    if (!m) throw new AppError("ValidationError", "模型不存在。");
    if (patch.price) {
      validatePrice(patch.price);
      if (
        patch.price.rate !== null &&
        (!Number.isFinite(patch.price.rate) || patch.price.rate < 0)
      )
        throw new AppError("ValidationError", "价格无效。");
    }
    if (patch.audio && m.audio) {
      if (!patch.audio.endpoints || !Object.keys(patch.audio.endpoints).length)
        throw new Error("请配置音频模型地域和接口。");
      for (const endpoints of Object.values(patch.audio.endpoints)) {
        secureURL(endpoints.tts.replace("{workspace}", "example"));
        secureURL(endpoints.clone.replace("{workspace}", "example"));
      }
      // The implemented protocol defines capability support, users configure IDs/endpoints only.
      patch.audio = { ...m.audio, endpoints: patch.audio.endpoints };
    }
    const updated = {
      ...m,
      name: patch.name ?? m.name,
      officialId: patch.officialId ?? m.officialId,
      enabled: patch.enabled ?? m.enabled,
      favorite: patch.favorite ?? m.favorite,
      price: patch.price ?? m.price,
      audio: patch.audio ?? m.audio,
    };
    this.db.run(
      "UPDATE models SET data=? WHERE id=?",
      JSON.stringify(updated),
      id,
    );
    this.db.run(
      "INSERT INTO pricing_configs VALUES(?,?) ON CONFLICT(model_id) DO UPDATE SET data=excluded.data",
      id,
      JSON.stringify(updated.price),
    );
    this.changed();
    return updated;
  }
  statistics(q: { from?: string; to?: string }) {
    const p: string[] = [];
    const where = [
      "COALESCE(json_extract(v.data,'$.type'),'video')<>'video-group'",
    ];
    if (q.from) {
      where.push("v.created_at>=?");
      p.push(q.from);
    }
    if (q.to) {
      where.push("v.created_at<=?");
      p.push(q.to);
    }
    const clause = where.join(" AND ");
    return {
      statuses: this.db.all<{ status: string; count: number }>(
        `SELECT v.status,count(*) count FROM task_versions v WHERE ${clause} GROUP BY v.status`,
        ...p,
      ),
      costs: this.db.all<{
        currency: string;
        amount: number;
        known: number;
        unknown: number;
      }>(
        `SELECT u.currency,sum(u.amount) amount,count(u.amount) known,sum(CASE WHEN u.amount IS NULL THEN 1 ELSE 0 END) unknown FROM task_versions v JOIN usage_records u ON u.version_id=v.id WHERE ${clause} GROUP BY u.currency`,
        ...p,
      ),
      providers: this.db.all<{ provider_id: string; count: number }>(
        `SELECT provider_id,count(*) count FROM task_versions v WHERE ${clause} GROUP BY provider_id`,
        ...p,
      ),
      models: this.db.all<{ model_id: string; count: number }>(
        `SELECT model_id,count(*) count FROM task_versions v WHERE ${clause} GROUP BY model_id`,
        ...p,
      ),
      accounts: this.db.all<{ account_id: string; count: number }>(
        `SELECT account_id,count(*) count FROM task_versions v WHERE ${clause} GROUP BY account_id`,
        ...p,
      ),
      taskGroups:
        this.db.one<{ count: number }>(
          `SELECT count(*) count FROM task_versions v WHERE json_extract(v.data,'$.type')='video-group'${q.from ? " AND v.created_at>=?" : ""}${q.to ? " AND v.created_at<=?" : ""}`,
          ...p,
        )?.count ?? 0,
    };
  }
  hasActiveWork() {
    const active = this.db.one<{ n: number }>(
      "SELECT count(*) n FROM task_versions WHERE deleted_at IS NULL AND status IN ('Queued','Uploading','Submitting','Processing','Downloading')",
    )?.n;
    return Boolean(active || this.audio.active.size || this.audio.cloning);
  }
  resetDefaults() {
    if (this.hasActiveWork())
      throw new Error("当前有生成、上传或复刻任务，完成或取消后才能重置。");
    const fixed = defaultDirectories(this.root);
    this.db.transaction(() => {
      this.db.run("DELETE FROM drafts");
      for (const key of ["draft", "audioDraft", "adoptedAudio"])
        this.db.run("DELETE FROM settings WHERE key=?", key);
      this.db.set("settings", {
        theme: "system",
        language: "zh-CN",
        defaultModel: "wan3",
        defaultAccount: "auto",
        ...fixed,
        globalConcurrency: 2,
        providerConcurrency: { alibaba: 2, volcengine: 2 },
        maxRetries: 3,
        pollSeconds: 5,
        notifications: true,
        downloadTimeoutSeconds: 300,
        portable: true,
        lastOutputDir: fixed.outputDir,
        closeBehavior: "exit",
        queuePaused: false,
      });
    });
    this.changed();
    return true;
  }
  private moveTrackedOutputsToQuarantine() {
    const configuredRoot = join(this.root, "outputs");
    mkdirSync(configuredRoot, { recursive: true });
    const outputRoot = realpathSync(configuredRoot);
    const quarantine = join(
      this.root,
      "backups",
      `factory-reset-outputs-${Date.now()}`,
    );
    let moved = 0;
    for (const row of this.db.all<{ data: string }>(
      "SELECT data FROM task_versions",
    )) {
      const task = JSON.parse(row.data) as Task;
      const paths = [
        task.outputPath,
        ...(task.outputs ?? []).map((item) => item.localPath),
      ].filter((item): item is string => Boolean(item));
      for (const path of new Set(paths)) {
        if (!existsSync(path)) continue;
        const info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        const real = realpathSync(path);
        const rel = relative(outputRoot, real);
        if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
        mkdirSync(quarantine, { recursive: true });
        renameSync(real, join(quarantine, `${moved}-${basename(real)}`));
        moved++;
      }
    }
    return { moved, quarantine: moved ? quarantine : null };
  }
  private moveTrackedCacheToQuarantine() {
    const roots = [
      join(this.root, "cache"),
      join(this.root, "assets", "thumbnails"),
    ]
      .filter((path) => existsSync(path))
      .map((path) => realpathSync(path));
    const assets = this.db
      .all<{ data: string }>("SELECT data FROM assets")
      .map((row) => JSON.parse(row.data) as Asset);
    const sourcePaths = new Set(
      assets.flatMap((asset) =>
        [asset.originalPath, asset.managedPath].filter(
          (path): path is string => Boolean(path),
        ),
      ),
    );
    const quarantine = join(
      this.root,
      "backups",
      `factory-reset-cache-${Date.now()}`,
    );
    let moved = 0;
    for (const asset of assets) {
      const path = asset.thumbnailPath;
      if (!path || !existsSync(path) || sourcePaths.has(path)) continue;
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const real = realpathSync(path);
      if (
        !roots.some((root) => {
          const rel = relative(root, real);
          return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
        })
      )
        continue;
      mkdirSync(quarantine, { recursive: true });
      renameSync(real, join(quarantine, `${moved}-${basename(real)}`));
      moved++;
    }
    return { cacheMoved: moved, cacheQuarantine: moved ? quarantine : null };
  }
  async factoryReset(deleteOutputs: boolean) {
    if (this.hasActiveWork())
      throw new Error("当前有生成、上传或复刻任务，完成或取消后才能恢复出厂。");
    const backup = await this.db.backupTo(
      join(this.root, "backups", `pre-factory-reset-${Date.now()}.sqlite`),
    );
    const outputResult = deleteOutputs
      ? this.moveTrackedOutputsToQuarantine()
      : { moved: 0, quarantine: null };
    const cacheResult = this.moveTrackedCacheToQuarantine();
    this.db.transaction(() => {
      for (const table of [
        "cosy_jobs",
        "cosy_batches",
        "cosy_instruction_history",
        "cosy_presets",
        "cosy_voices",
        "billing_audit",
        "billing_manual",
        "billing_records",
        "usage_records",
        "downloads",
        "task_results",
        "task_assets",
        "price_snapshots",
        "task_snapshots",
        "task_versions",
        "tasks",
        "prompt_versions",
        "prompts",
        "project_assets",
        "asset_tags",
        "assets",
        "asset_folders",
        "drafts",
        "projects",
        "voices",
        "credentials",
        "logs_metadata",
        "cloud_uploads",
        "settings",
      ])
        this.db.run(`DELETE FROM ${table}`);
      this.db.set("initialized", true);
      this.db.set("v107-fixed-directories", true);
    });
    this.changed();
    return { backup, ...outputResult, ...cacheResult };
  }
  close() {
    this.thumbnails.stopped = true;
    this.audio.stop();
    this.tasks.stop();
    this.db.close();
  }
}
