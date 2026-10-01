import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  copyFileSync,
} from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Application } from "../../services/application.ts";
import type { Obj } from "../../../features/realSpeech/domain.ts";
import { voiceCompatible } from "../../../shared/audioCatalog.ts";
import {
  normalizeWorkspace,
  validateWorkspace,
} from "../../../shared/accounts.ts";
import { HttpClient, secureURL } from "../../providers/http.ts";
import { ffmpegBinary } from "../../services/transcode.ts";
import { writeTaskZip } from "../../services/taskZipWriter.ts";
import { RealSpeechService } from "../service.ts";
import {
  PlanValidator,
  strictJSON,
  planHash,
  sha256,
  canonicalV2,
  resolvePointer,
} from "./validator.ts";
import { buildRequest } from "./request.ts";
import { readSnapshot } from "./readSnapshot.ts";
import { TaskLocks } from "./taskLock.ts";
import { controlAssessment, primaryVariableDiff } from "./productionPolicy.ts";
const exec = promisify(execFile);
const now = () => new Date().toISOString();
export type Adapter = (body: Obj, path: string) => Promise<Obj>;
export type ServiceOpenMode = "managed" | "readOnly" | "existingWrite";
export class RealSpeechV2Service {
  db: DatabaseSync;
  root: string;
  dataRoot: string;
  app?: Application;
  validator: PlanValidator;
  active = new Set<string>();
  locks: TaskLocks;
  readOnly: boolean;
  snapshotCleanup?: () => void;
  constructor(root: string, app?: Application, resources?: string, mode: ServiceOpenMode = "managed") {
    this.app = app;
    this.dataRoot = root;
    this.root = join(root, "real-speech-v2");
    this.readOnly = mode === "readOnly";
    this.locks = new TaskLocks(this.root);
    if (mode === "managed") mkdirSync(this.root, { recursive: true });
    else if (!existsSync(join(this.root, "real_speech_v2.db"))) throw Error("V2数据库不存在；CLI不会创建或迁移数据库");
    this.validator = new PlanValidator(resources);
    const snapshot = this.readOnly ? readSnapshot(join(this.root, "real_speech_v2.db")) : null;
    this.snapshotCleanup = snapshot?.cleanup;
    try { this.db = new DatabaseSync(snapshot?.path || join(this.root, "real_speech_v2.db"), { readOnly: this.readOnly }); }
    catch(e) { snapshot?.cleanup(); throw e; }
    if (mode !== "managed") {
      this.db.exec("PRAGMA busy_timeout=5000" + (this.readOnly ? "; PRAGMA query_only=ON" : ""));
      return; // No DDL, WAL-mode changes, directory creation, or recovery on CLI opens.
    }
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS patches(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,hash TEXT NOT NULL,job_id TEXT,data TEXT NOT NULL);",
    );
    if (
      this.db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
    )
      throw Error("V2数据库校验失败；旧任务库未改动");
    for (const listed of this.list()) {
      try {
        this.locks.run(listed.taskId, () => this.tx(() => {
          // Re-read only after acquiring the lease; a CLI may have just completed.
          const task = this.get(listed.taskId);
          let changed = false;
          for (const w of task.windows)
            for (const a of w.attempts)
              if (a.status === "submitting") {
                a.status = "unknown";
                a.error = "程序中断，禁止自动重发；先核对控制台";
                changed = true;
              }
          if (changed) { task.taskRevision++; this.save(task); }
          for (const row of this.db.prepare("SELECT data FROM jobs WHERE task_id=?").all(task.taskId)) {
            const j = JSON.parse(String(row.data));
            if (j.status === "running") { j.status = "interrupted"; this.saveJob(j); }
          }
        }));
      } catch (e: any) {
        if (e.code !== "TASK_LOCK_BUSY") throw e;
        // Live or stale leases are never reclaimed by UI startup recovery.
      }
    }
  }
  assertWritable() { if (this.readOnly) throw Error("只读Service禁止修改"); }
  tx<T>(fn: () => T) {
    this.assertWritable();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  save(t: Obj) {
    this.assertWritable();
    this.db
      .prepare(
        "INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(t.taskId, JSON.stringify(t));
    return t;
  }
  saveJob(j: Obj) {
    this.assertWritable();
    this.db
      .prepare(
        "INSERT INTO jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(j.jobId, j.taskId, JSON.stringify(j));
    return j;
  }
  list(): Obj[] {
    return this.db
      .prepare("SELECT data FROM tasks ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  get(id: string): Obj {
    const r = this.db.prepare("SELECT data FROM tasks WHERE id=?").get(id);
    if (!r) throw Error("V2任务不存在");
    return JSON.parse(String(r.data));
  }
  job(id: string): Obj {
    const r = this.db.prepare("SELECT data FROM jobs WHERE id=?").get(id);
    if (!r) throw Error("生成任务不存在");
    return JSON.parse(String(r.data));
  }
  revision(t: Obj, reason: string) {
    this.assertWritable();
    this.db.prepare("INSERT INTO revisions VALUES(?,?,?)").run(
      randomUUID(),
      t.taskId,
      JSON.stringify({
        at: now(),
        reason,
        plan: t.plan,
        planHash: t.planHash,
        voiceRef: t.voiceRef,
      }),
    );
  }
  checkIdle(t: Obj, expected?: number) {
    if (this.active.has(t.taskId) || (!this.locks.held.has(t.taskId) && this.locks.busy(t.taskId))) throw Error("任务正在运行");
    if (
      arguments.length > 1 &&
      (!Number.isSafeInteger(expected) || expected !== t.taskRevision)
    )
      throw Error("任务已变化，请刷新");
  }
  voices() {
    return (
      this.app?.audio
        .voices()
        .filter(
          (v) =>
            v.kind === "clone" &&
            v.status === "ready" &&
            v.model === this.validator.profile.model,
        )
        .map((v) => ({ id: v.id, name: v.name, status: v.status })) || []
    );
  }
  legacyList(): Obj[] {
    const path = join(this.dataRoot, "real-speech", "real_speech.db");
    if (!existsSync(path)) return [];
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db
        .prepare("SELECT data FROM tasks ORDER BY rowid DESC")
        .all()
        .map((r) => JSON.parse(String(r.data)));
    } finally {
      db.close();
    }
  }
  legacyOutput(taskId: string, resultId: string) {
    const t = this.legacyList().find((t) => t.taskId === taskId);
    if (!t) throw Error("旧任务不存在");
    const all = [
      ...(t.windows || []).flatMap((w: Obj) => w.results || []),
      ...(t.rehearsal?.results || []),
      ...(t.finals || []),
      t.final,
      t.golden,
    ].filter(Boolean);
    const found = all.find((r) => r.id === resultId);
    if (!found?.path || !existsSync(found.path))
      throw Error("旧音频不存在，原始记录保留");
    return found.path;
  }
  preview(text: string) {
    const plan = this.validator.validate(strictJSON(text));
    return {
      plan,
      planHash: planHash(plan),
      pending: plan.windows.map((w: Obj) => ({
        windowId: w.windowId,
        capabilities: this.validator.pending(w),
        ...controlAssessment(
          w,
          this.validator.profile.productPolicy.productionRules,
        ),
      })),
    };
  }
  importPlan(p: Obj) {
    if (!p.name?.trim() || !p.voiceRef)
      throw Error("请填写任务名称并选择复刻音色");
    if (p.confirmed !== true) throw Error("请明确确认Plan来自已确认导演方案");
    const plan = structuredClone(this.preview(p.text).plan);
    if (
      plan.windows.some((w: Obj) => w.experimental) &&
      p.experimentalConfirmed !== true
    )
      throw Error(
        "实验方案须用户在软件中明确开启实验模式；Plan中的true不能替代用户确认",
      );
    // Keep the imported Plan immutable; its own hash is recorded separately.
    const voiceBinding = this.app ? this.binding(p.voiceRef) : null;
    if (
      plan.voiceRequirements.requestedVoiceRef &&
      plan.voiceRequirements.requestedVoiceRef !== p.voiceRef
    )
      throw Error("Plan指定音色与所选音色不匹配");
    const taskId = randomUUID(),
      ph = planHash(plan);
    const t: Obj = {
      taskId,
      name: p.name.trim(),
      voiceRef: p.voiceRef,
      voiceBinding,
      taskRevision: 1,
      plan,
      planHash: ph,
      createdAt: now(),
      profileHash: planHash(this.validator.profile),
      profileSnapshot: structuredClone(this.validator.profile),
      experimentalApproval: plan.windows.some((w: Obj) => w.experimental)
        ? {
            enabled: true,
            at: now(),
            source: "local_user_explicit_experiment",
            planHash: ph,
            windows: plan.windows
              .filter((w: Obj) => w.experimental)
              .map((w: Obj) => ({
                windowId: w.windowId,
                configHash: planHash(w),
              })),
          }
        : null,
      confirmation: {
        recordId: randomUUID(),
        at: now(),
        statement: "该Plan来自我已确认的导演方案",
        planId: plan.planId,
        planHash: ph,
        profileVersion: plan.capabilityVersion,
        profileHash: planHash(this.validator.profile),
        source: "local_user_attestation",
        optionalDocumentHash: plan.directorReference?.documentHash || null,
        attachmentState: plan.directorReference?.documentHash
          ? "declared_unverified"
          : "not_provided",
      },
      windows: plan.windows.map((w: Obj) => ({
        windowId: w.windowId,
        configRevision: 1,
        versions: [],
        attempts: [],
        selectedVersionId: null,
        locked: false,
      })),
      anchorReviews: [],
      finals: [],
      selectedFinalId: null,
      goldens: [],
      feedback: [],
      history: [],
    };
    return this.tx(() => {
      this.save(t);
      this.revision(t, "导入Plan，用户明确确认");
      return t;
    });
  }
  binding(ref: string) {
    const app = this.app;
    if (!app) throw Error("未连接真实凭据系统");
    const v = app.audio.voices().find((v) => v.id === ref);
    const a = app.credentials.list().find((a) => a.id === v?.accountId);
    const m = app
      .models()
      .find((m) => m.id === this.validator.profile.model && m.enabled);
    if (
      !v?.voiceId ||
      v.kind !== "clone" ||
      v.status !== "ready" ||
      !a?.enabled ||
      a.region !== "cn-beijing" ||
      !m ||
      !voiceCompatible(v, m, a)
    )
      throw Error("复刻音色、账户或北京模型不匹配");
    const workspace = normalizeWorkspace(a.workspaceId || "");
    validateWorkspace(workspace);
    const url = this.validator.profile.transports.http.ttsEndpoint.replace(
      "{workspaceId}",
      workspace,
    );
    secureURL(url);
    return { voice: v.voiceId, accountId: a.id, url };
  }
  selected(t: Obj, id: string) {
    const w = t.windows.find((w: Obj) => w.windowId === id);
    if (!w) throw Error("Window不存在");
    const v = w.versions.find((v: Obj) => v.versionId === w.selectedVersionId);
    return { w, v };
  }
  output(taskId: string, artifactId: string) {
    const t = this.get(taskId);
    const all = [...t.windows.flatMap((w: Obj) => w.versions), ...t.finals];
    const v = all.find(
      (v: Obj) => v.versionId === artifactId || v.finalId === artifactId,
    );
    if (!v) throw Error("音频不存在");
    const path = resolve(v.path);
    if (!path.startsWith(resolve(this.root) + sep) || !existsSync(path))
      throw Error("音频路径无效");
    if (sha256(readFileSync(path)) !== v.fileHash)
      throw Error("原始音频字节已变化，请检查存储；不会覆盖或自动修复");
    return path;
  }
  executionFingerprint(t: Obj, w: Obj) {
    return planHash({
      request: buildRequest(t.plan.engine.model, t.voiceRef, w),
      transition: w.transition,
      profile: t.plan.capabilityVersion,
      profileHash: t.profileHash,
    });
  }
  sourceHash(t: Obj) {
    return planHash(
      t.plan.windows.map((w: Obj) => ({
        windowId: w.windowId,
        selected: this.selected(t, w.windowId).v?.fileHash || null,
        versionId: this.selected(t, w.windowId).v?.versionId || null,
        transition: w.transition,
      })),
    );
  }
  mutate(p: Obj) {
    this.assertWritable();
    return this.locks.run(String(p.taskId), () => this.tx(() => this.mutateImpl(p)));
  }
  private mutateImpl(p: Obj) {
    const t = this.get(p.taskId);
    this.checkIdle(t, p.taskRevision);
    const { w, v } = p.windowId
      ? this.selected(t, p.windowId)
      : { w: null, v: null };
    if (p.type === "select") {
      if (w.locked) throw Error("Window已锁定");
      if (!w.versions.some((a: Obj) => a.versionId === p.versionId))
        throw Error("版本不存在");
      w.selectedVersionId = p.versionId;
    } else if (p.type === "rollback") {
      if (w.locked) throw Error("Window已锁定");
      const target = w.versions.find((a: Obj) => a.versionId === p.versionId);
      if (!target) throw Error("版本不存在");
      const i = t.plan.windows.findIndex((a: Obj) => a.windowId === p.windowId);
      const previous = t.plan;
      const next = structuredClone(previous);
      next.windows[i] = structuredClone(target.config);
      for (const lock of [
        ...previous.windows[i].lockedFields,
        ...previous.lockedFields
          .filter((path: string) => path.startsWith(`/windows/${i}/`))
          .map((path: string) => path.slice(`/windows/${i}`.length)),
      ])
        if (
          canonicalV2(resolvePointer(previous.windows[i], lock)) !==
          canonicalV2(resolvePointer(next.windows[i], lock))
        )
          throw Error("回滚不能修改锁定字段");
      next.intentRanges = next.intentRanges
        .filter((n: Obj) => n.target.windowId !== p.windowId)
        .concat(target.intentRanges);
      for (const lock of previous.lockedFields)
        if (
          canonicalV2(resolvePointer(previous, lock)) !==
          canonicalV2(resolvePointer(next, lock))
        )
          throw Error("回滚不能修改Plan锁定字段");
      this.validator.validate(next);
      next.parentPlanId = previous.planId;
      next.planId = randomUUID();
      t.plan = next;
      t.planHash = planHash(next);
      w.configRevision++;
      w.selectedVersionId = target.versionId;
      this.revision(t, "从旧版本恢复配置与选中音频");
    } else if (p.type === "lock") {
      if (
        p.locked !== true &&
        t.goldens.some((g: Obj) => g.windowIds.includes(p.windowId))
      )
        throw Error("Golden引用Window不能解锁");
      w.locked = p.locked === true;
    } else if (p.type === "anchor") {
      const a = t.plan.rehearsalAnchors.find(
        (a: Obj) => a.anchorId === p.anchorId,
      );
      if (!a) throw Error("anchor不存在");
      const s = this.selected(t, a.windowId);
      if (!s.v) throw Error("请先生成或选择该完整Window");
      const config = t.plan.windows.find((w: Obj) => w.windowId === a.windowId);
      if (s.v.fingerprint !== this.executionFingerprint(t, config))
        throw Error("当前音频与配置不同，不能确认锚点");
      t.anchorReviews.push({
        anchorId: a.anchorId,
        versionId: s.v.versionId,
        fingerprint: s.v.fingerprint,
        passed: p.passed === true,
        feedback: String(p.feedback || ""),
        at: now(),
      });
    } else if (p.type === "feedback") {
      t.feedback.push({
        at: now(),
        windowIds: p.windowIds || [],
        description: String(p.feedback || ""),
        selectedVersions: t.windows.map((w: Obj) => ({
          windowId: w.windowId,
          versionId: w.selectedVersionId,
        })),
      });
    } else if (p.type === "golden") {
      const f = t.finals.find((f: Obj) => f.finalId === t.selectedFinalId);
      if (!f || f.sourceHash !== this.sourceHash(t) || p.confirmed !== true)
        throw Error("请拼接当前版本并明确确认已完整试听");
      t.goldens.push({
        goldenId: randomUUID(),
        finalId: f.finalId,
        windowIds: t.windows.map((w: Obj) => w.windowId),
        selectedVersions: t.windows.map((w: Obj) => ({
          windowId: w.windowId,
          versionId: w.selectedVersionId,
        })),
        feedback: String(p.feedback || ""),
        planHash: t.planHash,
        at: now(),
      });
      for (const w of t.windows) w.locked = true;
    } else throw Error("未知V2操作");
    t.taskRevision++;
    t.history.push({ at: now(), type: p.type, windowId: p.windowId || null });
    return this.save(t);
  }
  previewPatch(p: Obj) {
    const t = this.get(p.taskId);
    this.checkIdle(t);
    const patch = strictJSON(p.text);
    this.validator.schema(patch, true);
    this.validator.profileCheck(patch);
    if (p.windowId && !patch.targetWindowIds.includes(p.windowId))
      throw Error("Patch目标不包含当前Window");
    if (
      patch.taskId !== t.taskId ||
      patch.basePlanId !== t.plan.planId ||
      patch.basePlanHash !== t.planHash
    )
      throw Error("Patch基线已变化");
    const targets = patch.targetWindowIds;
    const same = (a: string[], b: string[]) =>
      canonicalV2([...a].sort()) === canonicalV2([...b].sort());
    if (
      !same(
        targets,
        patch.expectedVersions.map((e: Obj) => e.windowId),
      ) ||
      !same(
        targets,
        patch.changes.map((e: Obj) => e.windowId),
      ) ||
      new Set(patch.changes.map((e: Obj) => e.windowId)).size !==
        targets.length ||
      new Set(patch.expectedVersions.map((e: Obj) => e.windowId)).size !==
        targets.length
    )
      throw Error("Patch目标集合不完整或重复");
    const locked = t.windows
      .filter((w: Obj) => w.locked)
      .map((w: Obj) => w.windowId);
    if (
      !same(locked, patch.lockedWindows) ||
      targets.some((id: string) => locked.includes(id))
    )
      throw Error("lockedWindows不可变更或省略");
    const next = structuredClone(t.plan),
      diff: Obj[] = [],
      generateIds: string[] = [];
    const primaryVariables = new Set<string>();
    for (const ch of patch.changes) {
      const { w, v } = this.selected(t, ch.windowId),
        expect = patch.expectedVersions.find(
          (e: Obj) => e.windowId === ch.windowId,
        );
      if (
        expect.configRevision !== w.configRevision ||
        expect.selectedVersionId !== (v?.versionId || null) ||
        expect.selectedVersionHash !== (v?.fileHash || null)
      )
        throw Error("目标配置或所选版本已变化");
      const index = next.windows.findIndex(
          (w: Obj) => w.windowId === ch.windowId,
        ),
        config = next.windows[index],
        before = this.executionFingerprint(t, config);
      let changed = false;
      for (const [key, value] of Object.entries(ch.set)) {
        if (key === "intentRanges") {
          if (
            next.lockedFields.some(
              (lock: string) =>
                lock === "/intentRanges" || lock.startsWith("/intentRanges/"),
            )
          )
            throw Error("导演说明字段已锁定");
          if ((value as Obj[]).some((n) => n.target.windowId !== ch.windowId))
            throw Error("展示说明越过目标Window");
          const old = next.intentRanges.filter(
            (n: Obj) => n.target.windowId === ch.windowId,
          );
          if (canonicalV2(old) !== canonicalV2(value)) {
            diff.push({
              windowId: ch.windowId,
              field: key,
              before: old,
              after: value,
            });
            changed = true;
          }
          next.intentRanges = next.intentRanges
            .filter((n: Obj) => n.target.windowId !== ch.windowId)
            .concat(value);
          continue;
        }
        const local = [
          "instruction",
          "rate",
          "pitch",
          "volume",
          "seed",
        ].includes(key)
          ? `/execution/${key}`
          : `/${key}`;
        const full = `/windows/${index}${local}`;
        if (
          [...config.lockedFields, ...next.lockedFields].some(
            (lock: string) =>
              lock === local ||
              full === lock ||
              full.startsWith(lock + "/") ||
              lock.startsWith(full + "/"),
          )
        )
          throw Error("锁定字段不能修改：" + key);
        const old = resolvePointer(config, local);
        if (canonicalV2(old) !== canonicalV2(value)) {
          diff.push({
            windowId: ch.windowId,
            field: key,
            before: old,
            after: value,
          });
          changed = true;
        }
        if (local.startsWith("/execution/")) config.execution[key] = value;
        else config[key] = value;
      }
      if (
        canonicalV2(config.executionConfidence) !==
        canonicalV2(ch.executionConfidence)
      ) {
        if (
          config.lockedFields.some(
            (lock: string) =>
              lock === "/executionConfidence" ||
              lock.startsWith("/executionConfidence/"),
          ) ||
          next.lockedFields.some(
            (lock: string) =>
              `/windows/${index}/executionConfidence`.startsWith(lock + "/") ||
              lock === `/windows/${index}/executionConfidence` ||
              lock.startsWith(`/windows/${index}/executionConfidence/`),
          )
        )
          throw Error("锁定执行说明不能修改");
        config.executionConfidence = ch.executionConfidence;
        changed = true;
        diff.push({
          windowId: ch.windowId,
          field: "executionConfidence",
          before: t.plan.windows[index].executionConfidence,
          after: ch.executionConfidence,
        });
      }
      if (!changed) throw Error("Patch没有真实变化");
      for (const variable of primaryVariableDiff(t.plan.windows[index], config))
        primaryVariables.add(variable);
      if (before !== this.executionFingerprint(t, config))
        generateIds.push(ch.windowId);
    }
    if (primaryVariables.size > 1)
      throw Error(
        "ONE_PRIMARY_VARIABLE_AT_A_TIME：一次Patch只能改变一个主要变量，实际为" +
          [...primaryVariables].join("、"),
      );
    this.validator.validate(next);
    return {
      patch,
      next,
      diff,
      generateIds,
      primaryVariables: [...primaryVariables],
      experimentalRequired: targets.some(
        (id: string) =>
          next.windows.find((w: Obj) => w.windowId === id)?.experimental,
      ),
      previewHash: planHash({ patch, next, revision: t.taskRevision }),
      taskRevision: t.taskRevision,
    };
  }
  applyPatch(p: Obj): { task: Obj; jobId: string | null; reused: boolean } {
    this.assertWritable();
    return this.locks.run(String(p.taskId), () => this.applyPatchImpl(p));
  }
  private applyPatchImpl(p: Obj): { task: Obj; jobId: string | null; reused: boolean } {
    if (p.confirmed !== true) throw Error("需要明确确认Diff");
    const patch = strictJSON(p.text);
    if (patch.taskId !== p.taskId) throw Error("Patch任务不匹配");
    const old = this.db
      .prepare("SELECT hash,job_id FROM patches WHERE id=?")
      .get(patch.patchId);
    if (old) {
      if (old.hash !== planHash(patch)) throw Error("patchId内容不一致");
      return {
        task: this.get(p.taskId),
        jobId: old.job_id ? String(old.job_id) : null,
        reused: true,
      };
    }
    const preview = this.previewPatch(p);
    if (preview.experimentalRequired && p.experimentalConfirmed !== true)
      throw Error("实验修复须在软件中明确确认实验风险");
    if (preview.previewHash !== p.previewHash)
      throw Error("Diff已过期，请重新预览");
    const t = this.get(p.taskId);
    const next = preview.next;
    next.parentPlanId = t.plan.planId;
    next.planId = randomUUID();
    t.plan = next;
    t.planHash = planHash(next);
    if (preview.experimentalRequired)
      t.experimentalApproval = {
        enabled: true,
        at: now(),
        source: "local_user_explicit_patch_experiment",
        planHash: t.planHash,
        windows: [
          ...(t.experimentalApproval?.windows || []).filter(
            (w: Obj) => !preview.patch.targetWindowIds.includes(w.windowId),
          ),
          ...next.windows
            .filter(
              (w: Obj) =>
                w.experimental &&
                preview.patch.targetWindowIds.includes(w.windowId),
            )
            .map((w: Obj) => ({
              windowId: w.windowId,
              configHash: planHash(w),
            })),
        ],
      };
    t.taskRevision++;
    for (const id of preview.patch.targetWindowIds)
      t.windows.find((w: Obj) => w.windowId === id).configRevision++;
    const j = preview.generateIds.length
      ? {
          jobId: randomUUID(),
          taskId: t.taskId,
          status: "queued",
          windowIds: preview.generateIds,
          completedWindowIds: [],
          planHash: t.planHash,
          createdAt: now(),
          reason: "patch",
          patchId: patch.patchId,
        }
      : null;
    this.tx(() => {
      this.save(t);
      this.revision(t, "Patch " + patch.patchId);
      if (j) this.saveJob(j);
      this.db
        .prepare("INSERT INTO patches VALUES(?,?,?,?,?)")
        .run(
          patch.patchId,
          t.taskId,
          planHash(patch),
          j?.jobId || null,
          JSON.stringify(patch),
        );
    });
    return { task: t, jobId: j?.jobId || null, reused: false };
  }
  createJob(p: Obj) {
    this.assertWritable();
    return this.locks.run(String(p.taskId), () => this.createJobImpl(p));
  }
  private createJobImpl(p: Obj) {
    this.assertWritable();
    const t = this.get(p.taskId);
    this.checkIdle(t, p.taskRevision);
    const ids = p.windowIds as string[];
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !t.windows.some((w: Obj) => w.windowId === id))
    )
      throw Error("请选择有效Window");
    if (ids.some((id) => t.windows.find((w: Obj) => w.windowId === id).locked))
      throw Error("锁定Window不能生成");
    const j = {
      jobId: randomUUID(),
      taskId: t.taskId,
      status: "queued",
      windowIds: ids,
      completedWindowIds: [],
      planHash: t.planHash,
      createdAt: now(),
      reason: "explicit_user_generation",
    };
    this.saveJob(j);
    return j;
  }
  async runJob(jobId: string, adapter?: Adapter) {
    this.assertWritable();
    return this.locks.run(this.job(jobId).taskId, () => this.runJobImpl(jobId, adapter));
  }
  private async runJobImpl(jobId: string, adapter?: Adapter) {
    const j = this.job(jobId);
    if (
      ["completed", "running", "unknown", "failed", "interrupted"].includes(
        j.status,
      )
    )
      throw Error("任务不可自动重发，请核账后创建新任务");
    const t = this.get(j.taskId);
    this.checkIdle(t);
    if (t.planHash !== j.planHash) throw Error("配置已经变化");
    if (!adapter) {
      const pending = t.plan.windows
        .filter((w: Obj) => j.windowIds.includes(w.windowId))
        .flatMap((w: Obj) => this.validator.pending(w));
      if (pending.length) {
        j.status = "blocked_pending_spike";
        j.error =
          "等待Capability Spike验证：" + [...new Set(pending)].join(",");
        this.saveJob(j);
        return { task: t, job: j };
      }
    }
    this.active.add(t.taskId);
    j.status = "running";
    this.saveJob(j);
    try {
      for (const id of j.windowIds) {
        if (j.completedWindowIds.includes(id)) continue;
        await this.generateWindow(t, id, adapter);
        j.completedWindowIds.push(id);
        this.saveJob(j);
      }
      j.status = "completed";
    } catch (e) {
      j.status = "failed";
      j.error = String(e);
      if (t.windows.some((w: Obj) => w.attempts.at(-1)?.status === "unknown"))
        j.status = "unknown";
    } finally {
      this.saveJob(j);
      this.active.delete(t.taskId);
      this.app?.changed();
    }
    return { task: this.get(t.taskId), job: j };
  }
  async generateWindow(t: Obj, id: string, adapter?: Adapter) {
    this.assertWritable();
    this.validator.validate(t.plan);
    if (t.profileHash !== planHash(this.validator.profile))
      throw Error("受信Profile已变化，请重新确认方案");
    const state = t.windows.find((w: Obj) => w.windowId === id),
      config = t.plan.windows.find((w: Obj) => w.windowId === id);
    if (
      config.experimental &&
      !t.experimentalApproval?.windows?.some(
        (w: Obj) => w.windowId === id && w.configHash === planHash(config),
      )
    )
      throw Error("实验配置没有对应的本地用户批准；不能依据Plan文字自行开启");
    if (state.locked) throw Error("Window已锁定");
    if (
      state.attempts.some(
        (a: Obj) => a.status === "submitting" || (a.status === "unknown" && !a.billingAcknowledged),
      )
    )
      throw Error("旧请求结果未知，请先核账");
    if (
      t.plan.unresolvedItems.some(
        (u: Obj) =>
          !u.resolved && (!u.windowIds.length || u.windowIds.includes(id)),
      )
    )
      throw Error("存在未解决意图");
    const binding = adapter
      ? { voice: t.voiceRef, accountId: "test-only", url: "" }
      : this.binding(t.voiceRef);
    if (
      !adapter &&
      t.voiceBinding &&
      canonicalV2(binding) !== canonicalV2(t.voiceBinding)
    )
      throw Error("音色绑定已经变化，请重新确认新Plan");
    const body = buildRequest(t.plan.engine.model, binding.voice, config);
    const dir = join(this.root, "outputs", t.taskId, id, randomUUID());
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "audio.wav");
    const attempt: Obj = {
      attemptId: randomUUID(),
      status: "submitting",
      createdAt: now(),
      body,
      requestFingerprint: planHash(body),
      configRevision: state.configRevision,
      config: structuredClone(config),
      intentRanges: t.plan.intentRanges.filter(
        (n: Obj) => n.target.windowId === id,
      ),
      accountId: binding.accountId,
      profileHash: t.profileHash,
      dir,
    };
    state.attempts.push(attempt);
    t.taskRevision++;
    this.save(t);
    try {
      writeFileSync(
        join(dir, "request.json"),
        JSON.stringify({
          body,
          requestFingerprint: attempt.requestFingerprint,
        }),
        { flag: "wx" },
      );
      const meta = adapter
        ? await adapter(body, path)
        : await this.synthesize(body, path, binding);
      await this.verifyWav(path);
      const version = {
        versionId: randomUUID(),
        versionNumber: state.versions.length + 1,
        at: now(),
        path,
        fileHash: sha256(readFileSync(path)),
        fingerprint: this.executionFingerprint(t, config),
        configRevision: attempt.configRevision,
        requestSnapshot: body,
        config: structuredClone(config),
        intentRanges: structuredClone(attempt.intentRanges),
        ...meta,
      };
      state.versions.push(version);
      if (!state.selectedVersionId) state.selectedVersionId = version.versionId;
      attempt.status = "completed";
      attempt.versionId = version.versionId;
    } catch (e) {
      attempt.error = String(e);
      attempt.status = "unknown";
      throw e;
    } finally {
      t.taskRevision++;
      this.save(t);
    }
  }
  async synthesize(
    body: Obj,
    path: string,
    binding: { accountId: string; url: string },
  ) {
    const app = this.app!;
    const key = app.credentials.getKey(binding.accountId);
    const response = await new HttpClient(app.fetcher, app.logger, 0).request(
      binding.url,
      key,
      { method: "POST", paidSubmit: true, body },
    );
    writeFileSync(
      join(dirname(path), "response.private.json"),
      JSON.stringify(response),
      { flag: "wx" },
    );
    const r = response as Obj;
    if (!r.output?.audio?.url) throw Error("提交结果未知；核账后再操作");
    await this.download(r, path);
    return { requestId: r.request_id, usage: r.usage };
  }
  async download(r: Obj, path: string) {
    const u = secureURL(String(r.output.audio.url).replace(/^http:/, "https:"));
    const host = u.hostname;
    if (!host.endsWith(".aliyuncs.com")) throw Error("拒绝非阿里云音频地址");
    const resp = await this.app!.fetcher(u, {
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) throw Error("已生成但下载失败，可恢复下载不重发TTS");
    const data = Buffer.from(await resp.arrayBuffer());
    writeFileSync(path + ".tmp", data, { flag: "wx" });
    await this.verifyWav(path + ".tmp");
    renameSync(path + ".tmp", path);
  }
  verifyWav(path: string) {
    return RealSpeechService.prototype.verifyWav.call(this as any, path);
  }
  acknowledge(p: Obj) {
    this.assertWritable();
    return this.locks.run(String(p.taskId), () => this.acknowledgeImpl(p));
  }
  private acknowledgeImpl(p: Obj) {
    const t = this.get(p.taskId);
    this.checkIdle(t, p.taskRevision);
    if (p.confirmed !== true) throw Error("请明确确认已核账");
    const w = t.windows.find((w: Obj) => w.windowId === p.windowId);
    if (!w) throw Error("Window不存在");
    for (const a of w.attempts)
      if (a.status === "unknown")
        a.billingAcknowledged = {
          at: now(),
          statement: "用户确认核账后允许新请求",
        };
    t.taskRevision++;
    return this.save(t);
  }
  async recover(p: Obj) {
    this.assertWritable();
    return this.locks.run(String(p.taskId), () => this.recoverImpl(p));
  }
  private async recoverImpl(p: Obj) {
    const t = this.get(p.taskId);
    this.checkIdle(t, p.taskRevision);
    const state = t.windows.find((w: Obj) => w.windowId === p.windowId),
      attempt = state?.attempts.find((a: Obj) => a.attemptId === p.attemptId);
    if (!attempt || attempt.status !== "unknown") throw Error("没有待恢复请求");
    const f = join(attempt.dir, "response.private.json");
    if (!existsSync(f))
      throw Error("未收到下载地址；请核对控制台，禁止自动重发");
    this.active.add(t.taskId);
    try {
      const path = join(attempt.dir, "recovered-" + randomUUID() + ".wav");
      const r = JSON.parse(readFileSync(f, "utf8"));
      await this.download(r, path);
      state.versions.push({
        versionId: randomUUID(),
        versionNumber: state.versions.length + 1,
        at: now(),
        path,
        fileHash: sha256(readFileSync(path)),
        fingerprint: this.executionFingerprint(t, attempt.config),
        configRevision: attempt.configRevision,
        config: attempt.config,
        intentRanges: attempt.intentRanges,
        requestSnapshot: attempt.body,
        requestId: r.request_id,
        usage: r.usage,
      });
      const v = state.versions.at(-1);
      if (!state.selectedVersionId) state.selectedVersionId = v.versionId;
      attempt.status = "completed";
      attempt.versionId = v.versionId;
      t.taskRevision++;
      return this.save(t);
    } finally {
      this.active.delete(t.taskId);
    }
  }
  async concat(p: Obj) {
    this.assertWritable();
    return this.locks.run(String(p.taskId), () => this.concatImpl(p));
  }
  private async concatImpl(p: Obj) {
    const t = this.get(p.taskId);
    this.checkIdle(t, p.taskRevision);
    const selected = t.windows.map((w: Obj) => this.selected(t, w.windowId).v);
    if (selected.some((v: Obj) => !v)) throw Error("每个Window需要选定音频");
    this.active.add(t.taskId);
    try {
      const dir = join(this.root, "outputs", t.taskId, "final", randomUUID());
      mkdirSync(dir, { recursive: true });
      const path = join(dir, "audio.wav");
      const args = ["-nostdin", "-n"];
      for (const v of selected)
        args.push("-i", this.output(t.taskId, v.versionId));
      const filters: string[] = [],
        labels: string[] = [];
      t.plan.windows.forEach((w: Obj, i: number) => {
        filters.push(
          `[${i}:a]aformat=sample_rates=48000:sample_fmts=s16:channel_layouts=mono[a${i}]`,
        );
        labels.push(`[a${i}]`);
        if (i < t.windows.length - 1 && w.transition.pauseMs) {
          filters.push(
            `anullsrc=r=48000:cl=mono,atrim=duration=${w.transition.pauseMs / 1000}[s${i}]`,
          );
          labels.push(`[s${i}]`);
        }
      });
      filters.push(labels.join("") + `concat=n=${labels.length}:v=0:a=1[out]`);
      args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        path,
      );
      await exec(ffmpegBinary(this.app?.settings().ffmpegPath), args, {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      });
      await this.verifyWav(path);
      const f = {
        finalId: randomUUID(),
        at: now(),
        path,
        fileHash: sha256(readFileSync(path)),
        sourceHash: this.sourceHash(t),
        selectedVersions: t.windows.map((w: Obj) => ({
          windowId: w.windowId,
          versionId: w.selectedVersionId,
        })),
        planHash: t.planHash,
      };
      t.finals.push(f);
      t.selectedFinalId = f.finalId;
      t.taskRevision++;
      return this.save(t);
    } finally {
      this.active.delete(t.taskId);
    }
  }
  async exportDiagnosis(p: Obj) {
    return this.locks.run(String(p.taskId), () => this.exportDiagnosisImpl(p));
  }
  private async exportDiagnosisImpl(p: Obj) {
    const t = this.get(p.taskId);
    this.checkIdle(t, p.taskRevision);
    const ids =
      p.scope === "all" ? t.windows.map((w: Obj) => w.windowId) : p.windowIds;
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
      throw Error("请选择诊断范围");
    const rows = ids.map((id) => {
      const { w, v } = this.selected(t, id);
      if (!v) throw Error("选中Window没有音频：" + id);
      return {
        windowId: id,
        configRevision: w.configRevision,
        selectedVersionId: v.versionId,
        fileHash: v.fileHash,
        currentConfig: t.plan.windows.find((c: Obj) => c.windowId === id),
        actualRequest: v.requestSnapshot,
        configAtGeneration: v.config,
        versionNumber: v.versionNumber,
      };
    });
    const dir = join(this.root, "exports", t.taskId, randomUUID());
    mkdirSync(join(dir, "audio"), { recursive: true });
    const json = (name: string, data: unknown) =>
      writeFileSync(join(dir, name), JSON.stringify(data, null, 2), {
        flag: "wx",
      });
    json("plan.json", t.plan);
    json("capability-profile.json", t.profileSnapshot);
    json("current-versions.json", rows);
    json("production-policy.json", {
      principle: "NATURALNESS_FIRST_MINIMAL_INTERVENTION",
      changeIsolationPolicy: "ONE_PRIMARY_VARIABLE_AT_A_TIME",
      experimentalApproval: t.experimentalApproval || null,
      windows: rows.map((r: Obj) => ({
        windowId: r.windowId,
        declaredComplexity: r.currentConfig.controlComplexity,
        declaredRisk: r.currentConfig.naturalnessRisk,
        instructionIntentCount: r.currentConfig.instructionIntentCount,
        controlReason: r.currentConfig.controlReason,
        experimental: r.currentConfig.experimental,
        pronunciationCompletenessIntent: t.plan.intentRanges
          .filter((n: Obj) => n.target.windowId === r.windowId)
          .map((n: Obj) => n.pronunciationCompletenessIntent || ""),
      })),
    });
    json(
      "intent-ranges.json",
      t.plan.intentRanges.filter((n: Obj) => ids.includes(n.target.windowId)),
    );
    json("user-feedback.json", {
      scope: p.scope,
      windowIds: ids,
      feedback: String(p.feedback || ""),
      history: t.feedback,
    });
    json("manifest.json", {
      schema: "REAL_SPEECH_DIAGNOSIS_V2",
      taskId: t.taskId,
      planId: t.plan.planId,
      planHash: t.planHash,
      at: now(),
      windowIds: ids,
      evidenceBasis: "audio_attached_not_diagnosed_by_software",
      currentConfigMayDifferFromSelectedAudio: true,
    });
    for (const row of rows)
      copyFileSync(
        this.output(t.taskId, row.selectedVersionId),
        join(dir, "audio", row.windowId + ".wav"),
      );
    if (p.scope === "all" && t.selectedFinalId) {
      const f = t.finals.find((f: Obj) => f.finalId === t.selectedFinalId);
      if (f.sourceHash === this.sourceHash(t))
        copyFileSync(
          this.output(t.taskId, f.finalId),
          join(dir, "audio", "current-final.wav"),
        );
    }
    const zip = dir + ".zip";
    const files = [
      "plan.json",
      "capability-profile.json",
      "current-versions.json",
      "production-policy.json",
      "intent-ranges.json",
      "user-feedback.json",
      "manifest.json",
      ...ids.map((id) => "audio/" + id + ".wav"),
      ...(existsSync(join(dir, "audio", "current-final.wav"))
        ? ["audio/current-final.wav"]
        : []),
    ];
    await writeTaskZip(
      zip,
      files.map((path) => ({ path, file: join(dir, path) })),
    );
    return { path: zip, windowIds: ids };
  }
  close() {
    if (this.active.size) throw Error("V2任务仍在运行");
    this.db.close();
    this.snapshotCleanup?.();
  }
}
