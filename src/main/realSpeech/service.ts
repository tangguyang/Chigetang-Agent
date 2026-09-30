import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { join, dirname, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  canonical,
  units,
  checkInstruction,
  instructionCount,
  parsePlan,
  validateContext,
  fieldValue,
  ACTIONS,
  CASE_CHECKS,
  FIELDS,
  type Obj,
} from "../../features/realSpeech/domain.ts";
import { HttpClient, secureURL } from "../providers/http.ts";
import {
  normalizeWorkspace,
  validateWorkspace,
} from "../../shared/accounts.ts";
import { voiceCompatible } from "../../shared/audioCatalog.ts";
import { ffmpegBinary } from "../services/transcode.ts";
import type { Application } from "../services/application.ts";
import type { Json } from "../../shared/types.ts";
const exec = promisify(execFile);
export const hash = (x: unknown) =>
  createHash("sha256").update(canonical(x)).digest("hex");
const repairContext = (t: Obj, action: string) =>
  hash({
    voiceRef: t.voiceRef,
    originalText: t.originalText,
    windows: t.windows.map((w: Obj) => ({
      id: w.windowId,
      unitIds: w.unitIds,
    })),
    strategy: action === "JOINT_REPAIR" ? "JOINT" : "WINDOW",
  });
export const finalSource = (windows: Obj[]) =>
  hash(
    windows.map((w: Obj) => ({
      windowId: w.windowId,
      resultId: (
        w.results.find((r: Obj) => r.revision === w.selectedRevision) ||
        w.results.at(-1)
      )?.id,
      pause: w.transitionPauseMs,
    })),
  );
export class RealSpeechService {
  db: DatabaseSync;
  root: string;
  app?: Application;
  active = new Set<string>();
  constructor(root: string, app?: Application) {
    this.app = app;
    this.root = join(root, "real-speech");
    mkdirSync(this.root, { recursive: true });
    const path = join(this.root, "real_speech.db");
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000",
      );
      if (
        this.db.prepare("PRAGMA integrity_check").get()?.integrity_check !==
        "ok"
      )
        throw Error("真人口播数据库损坏，旧音频不受影响");
      const version = Number(
        this.db.prepare("PRAGMA user_version").get()?.user_version,
      );
      if (version > 2) throw Error("请使用新版真人口播模块");
      if (existsSync(path) && !existsSync(join(this.root, "pre-v129.db")))
        this.db.exec(
          `VACUUM INTO '${join(this.root, "pre-v129.db").replaceAll("'", "''")}'`,
        );
      if (version < 1)
        this.tx(() =>
          this.db.exec(
            "CREATE TABLE tasks(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE plans(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,task_id TEXT NOT NULL,data TEXT NOT NULL); PRAGMA user_version=1;",
          ),
        );
      if(version < 2) {
        if(version===1 && !existsSync(join(this.root,"pre-v129-repair.db"))) this.db.exec(`VACUUM INTO '${join(this.root,"pre-v129-repair.db").replaceAll("'","''")}'`);
        this.tx(()=>this.db.exec("CREATE TABLE IF NOT EXISTS audio_assets(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS audio_assets_task ON audio_assets(task_id); PRAGMA user_version=2;"));
      }
      for (const t of this.list()) {
        let changed = false;
        if(t.rehearsalPassed && (!t.rehearsalApprovalHash || !this.rehearsalMatches(t))){t.rehearsalPassed=false;changed=true;}
        for (const w of t.windows)
          if (w.status === "generating") {
            w.status = "interrupted";
            changed = true;
          }
        if (t.rehearsal?.status === "generating") {
          t.rehearsal.status = "interrupted";
          changed = true;
        }
        if (changed) {
          t.taskRevision++;
          this.save(t);
        }
      }
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  tx<T>(fn: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  save(t: Obj) {
    this.db
      .prepare(
        "INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(t.taskId, JSON.stringify(t));
    return t;
  }
  list(includeDeleted = false): Obj[] {
    return this.db
      .prepare("SELECT data FROM tasks ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(String(r.data)))
      .filter(t => includeDeleted || !t.deletedAt);
  }
  get(id: string, includeDeleted = false): Obj {
    const r = this.db.prepare("SELECT data FROM tasks WHERE id=?").get(id);
    if (!r) throw Error("任务不存在");
    const t = JSON.parse(String(r.data));
    if(t.deletedAt && !includeDeleted) throw Error("任务已删除，音频保留在资产库");
    return t;
  }
  idle(t: Obj) {
    if ([...this.active].some((k) => k.startsWith(t.taskId + ":")))
      throw Error("正在生成，请等待后修改");
  }
  rehearsalConfig(t: Obj) {
    const ids = t.rehearsalUnitIds || t.director?.rehearsal?.unitIds || t.windows[0].unitIds.slice(0,3);
    const known = t.units.map((u: Obj)=>u.id);
    const positions = ids.map((id: string)=>known.indexOf(id));
    if(!ids.length || positions.some((n: number,i: number)=>n<0 || (i>0 && n!==positions[i-1]+1))) throw Error("试演范围须为连续有效Unit");
    const source = t.windows.find((w: Obj)=>ids.every((id: string)=>w.unitIds.includes(id)));
    if(!source) throw Error("试演范围跨越生成窗口，请选择同一窗口内的连续Unit");
    if(source.synthesisText) throw Error("自定义合成文本无法可靠映射试演Unit，请清空自定义文本或调整方案后试演");
    return {voiceRef:t.voiceRef,unitIds:ids,text:ids.map((id:string)=>t.units.find((u:Obj)=>u.id===id).text).join(""),instruction:source.instruction,rate:source.rate,pitch:source.pitch,volume:source.volume,seed:source.seed,pronunciation:source.pronunciation,rhythmData:source.rhythmData.filter((r:Obj)=>ids.includes(r.unitId)),synthesisText:""};
  }
  rehearsalMatches(t: Obj) {
    try { return t.rehearsal?.bindingHash === hash(this.rehearsalConfig(t)); } catch { return false; }
  }
  assetTail: Promise<void> = Promise.resolve();
  async syncAssets(t?: Obj) {
    const work=this.assetTail.catch(()=>{}).then(()=>this.syncAssetsNow(t));
    this.assetTail=work;return work;
  }
  private async syncAssetsNow(t?: Obj) {

    for(const task of t ? [t] : this.list(true)) {
      const rows: Array<{r:Obj; role:string; windowId?:string}> = [];
      for(const w of [...task.windows,...(task.rehearsal?[task.rehearsal]:[]),...(task.archives||[]).flatMap((a:Obj)=>a.windows||[])])
        for(const r of w.results||[]) rows.push({r,role:w.windowId==='REHEARSAL'?'试演':'口播片段',windowId:w.windowId});
      for(const r of [...(task.finals||[]),...(task.final?[task.final]:[])]) rows.push({r,role:'完整口播'});
      for(const {r,role,windowId} of rows) {
        if(!r.id) continue;
        const priorRow=this.db.prepare("SELECT data FROM audio_assets WHERE id=?").get(r.id);
        const prior=priorRow?JSON.parse(String(priorRow.data)):{};
        const record:Obj={...prior,...r,taskId:task.taskId,name:task.name,role,windowId,deleted:!!task.deletedAt};
        const persist=()=>this.db.prepare("INSERT INTO audio_assets VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(r.id,task.taskId,JSON.stringify(record));
        persist();
        if(!r.path || !existsSync(r.path) || !this.app?.assets) continue;
        const stamp=statSync(r.path);const stampKey=stamp.size+":"+stamp.mtimeMs;
        let asset;
        if(prior.assetId&&prior.fileStamp===stampKey) {try{const cached=this.app.assets.get(prior.assetId);if(existsSync(cached.managedPath||cached.originalPath))asset=cached;}catch{}}
        if(!asset) asset=(await this.app.assets.import(r.path,false)).asset;
        record.fileStamp=stampKey;
        const sources = JSON.parse(asset.metadata?.realSpeechSources || '[]');
        const source = {taskId:task.taskId,name:task.name,resultId:r.id,role,windowId,revision:r.revision,deleted:!!task.deletedAt,snapshot:r.snapshot||null};
        const index=sources.findIndex((x:Obj)=>x.taskId===task.taskId&&x.resultId===r.id);
        if(index>=0) sources[index]=source; else sources.push(source);
        asset.metadata={...asset.metadata,realSpeechSources:JSON.stringify(sources)};
        record.assetId=asset.id;persist();
        this.app.assets.save(asset);
      }
      const current=this.get(task.taskId,true);
      if(current.taskRevision===task.taskRevision&&current.assetSyncError){delete current.assetSyncError;this.save(current);}
    }
  }
  async remove(p: Obj) {
    const t=this.get(p.taskId);this.idle(t);
    if(p.taskRevision!==t.taskRevision) throw Error("任务已变化，请刷新");
    const key=t.taskId+":remove";this.active.add(key);
    try {
      await this.syncAssets(t);
      const next={...t,deletedAt:new Date().toISOString(),taskRevision:t.taskRevision+1,pendingAction:null};
      this.tx(()=>{this.save(next);for(const row of this.db.prepare("SELECT id,data FROM audio_assets WHERE task_id=?").all(t.taskId)){const data=JSON.parse(String(row.data));data.deleted=true;this.db.prepare("UPDATE audio_assets SET data=? WHERE id=?").run(JSON.stringify(data),row.id);}});
      return true;
    } finally {this.active.delete(key);}
  }
  newTask(p: Obj) {
    if (
      typeof p.originalText !== "string" ||
      !p.originalText.trim() ||
      [...p.originalText].length > 20000
    )
      throw Error("原稿须为1至20000字符");
    const u = units(p.originalText);
    if (!u.length) throw Error("原稿缺少可朗读文字");
    const t = {
      taskId: "RS-" + randomUUID(),
      taskRevision: 1,
      name: String(p.name || "真人口播"),
      originalText: p.originalText,
      units: u,
      voiceRef: String(p.voiceRef || ""),
      goal: String(p.goal || "自然面对镜头连续说完"),
      description: "",
      createdAt: new Date().toISOString(),
      speakerProfile: null,
      performanceArc: [],
      signatures: [],
      golden: null,
      windows: [
        this.window(
          "GW001",
          u.map((v) => v.id),
        ),
      ],
      history: [],
      qc: [],
      rehearsalPassed: false,
    };
    return this.save(t);
  }
  window(windowId: string, unitIds: string[], p: Obj = {}) {
    return {
      windowId,
      unitIds,
      instruction: "像本人面对镜头自然聊天，直接可信，不播音、不喊卖。",
      synthesisText: "",
      rhythmData: [],
      pronunciation: [],
      transitionPauseMs: 0,
      rate: 1,
      pitch: 1,
      volume: 50,
      seed: 0,
      status: "pending",
      results: [],
      ...p,
    };
  }
  update(p: Obj) {
    const t = this.get(p.taskId);
    this.idle(t);
    if (p.taskRevision !== t.taskRevision) throw Error("任务已变化，请刷新");
    if (p.originalText !== undefined && p.originalText !== t.originalText) {
      if (
        typeof p.originalText !== "string" ||
        !p.originalText.trim() ||
        [...p.originalText].length > 20000
      )
        throw Error("原稿无效");
      t.archives = [
        ...(t.archives || []),
        {
          windows: t.windows,
          originalText: t.originalText,
          revision: t.taskRevision,
        },
      ];
      t.finalDirty = true;
      if (t.rehearsal)
        t.archives.push({ windows: [t.rehearsal], revision: t.taskRevision });
      t.originalText = p.originalText;
      t.units = units(p.originalText);
      t.windows = [
        this.window(
          "GW001",
          t.units.map((v: Obj) => v.id),
        ),
      ];
      t.rehearsalPassed = false;
      t.director = null;
      t.rehearsal = null;
      t.rehearsalUnitIds = null;
      t.pendingAction = null;
    }
    if (p.voiceRef !== undefined && p.voiceRef !== t.voiceRef) {
      t.finalDirty = true;
      t.voiceRef = String(p.voiceRef);
      t.windows.forEach((w: Obj) => (w.status = "dirty"));
      t.rehearsalPassed = false;
    }
    for (const k of ["name", "goal", "description"])
      if (p[k] !== undefined) t[k] = String(p[k]);
    if (p.window) {
      const w = t.windows.find((w: Obj) => w.windowId === p.window.windowId);
      if (!w) throw Error("Window不存在");
      let audioChanged = false;
      for (const [k, v] of Object.entries(p.window)) {
        if (k === "windowId") continue;
        if (k === "synthesisText" && v === "") {
        } else fieldValue(k, v);
        if (["speakerProfile", "performanceArc"].includes(k))
          throw Error("不可修改任务字段");
        if (k !== "transitionPauseMs" && canonical(w[k]) !== canonical(v))
          audioChanged = true;
        if (canonical(w[k]) !== canonical(v)) t.finalDirty = true;
        w[k] = v;
      }
      if (audioChanged) {
        w.status = "dirty";
        t.rehearsalPassed = false;
      }
    }
    if (p.rehearsalUnitIds) {
      if (!Array.isArray(p.rehearsalUnitIds) || !p.rehearsalUnitIds.length)
        throw Error("试演范围为空");
      const known = t.units.map((u: Obj) => u.id),
        indices = p.rehearsalUnitIds.map((id: string) => known.indexOf(id));
      if (
        indices.some(
          (n: number, i: number) =>
            n < 0 || (i > 0 && n !== indices[i - 1] + 1),
        )
      )
        throw Error("试演必须为连续Unit");
      t.rehearsalUnitIds = p.rehearsalUnitIds;
      t.rehearsalPassed = false;
    }
    if (p.manualGroups) {
      if (!Array.isArray(p.manualGroups)) throw Error("分段格式错误");
      const all = p.manualGroups.flat();
      if (
        canonical(all) !== canonical(t.units.map((u: Obj) => u.id)) ||
        p.manualGroups.some((g: string[]) => !g.length)
      )
        throw Error("分段须按顺序完整覆盖台词");
      t.archives = [
        ...(t.archives || []),
        { windows: t.windows, revision: t.taskRevision },
      ];
      t.finalDirty = true;
      t.director=null;
      t.rehearsalUnitIds=null;
      t.windows = p.manualGroups.map((g: string[], i: number) =>
        this.window("GW" + String(i + 1).padStart(3, "0"), g),
      );
      t.rehearsalPassed = false;
      t.pendingAction = null;
    }
    t.taskRevision++;
    return this.save(t);
  }
  exportTask(p: Obj, docs: string) {
    const t = this.get(p.taskId);
    this.idle(t);
    if (!["Director", "Diagnosis", "Repair", "FinalQC"].includes(p.kind))
      throw Error("未知任务类型");
    t.exportId = "EXP-" + randomUUID();
    t.contextHash = hash({ ...t, exportId: undefined, contextHash: undefined });
    this.save(t);
    const safe = { ...t };
    const scrub = (x: any): any =>
      Array.isArray(x)
        ? x.map(scrub)
        : x && typeof x === "object"
          ? Object.fromEntries(
              Object.entries(x)
                .filter(
                  ([k]) =>
                    ![
                      "path",
                      "outputPath",
                      "referencePath",
                      "url",
                      "audioUrl",
                      "remoteVoice",
                    ].includes(k),
                )
                .map(([k, v]) => [k, scrub(v)]),
            )
          : x;
    const protocol = readFileSync(
      join(docs, "ChatGPT_真人口播返回协议_V1.2.md"),
      "utf8",
    );
    const detail = readFileSync(
      join(docs, "真人口播_Runtime字段说明.md"),
      "utf8",
    );
    const dir = join(this.root, "exports", t.exportId);
    mkdirSync(dir, { recursive: true });
    let count = 0;
    if(p.attachments) for (const w of [...t.windows, ...(t.rehearsal ? [t.rehearsal] : [])])
      for (const r of w.results.slice(-2))
        if (existsSync(r.path)) {
          copyFileSync(r.path, join(dir, `${w.windowId}-${r.revision}.wav`));
          count++;
        }
    if (p.attachments && t.final?.path && existsSync(t.final.path))
      copyFileSync(t.final.path, join(dir, "current-final.wav"));
    const voice = this.app?.audio.voices().find((v) => v.id === t.voiceRef);
    const text = `# ChatGPT 真人口播 ${p.kind} Task\n软件版本1.2.9；不改原稿，不改音色。不猜发音“破平台食谱”。\n${count ? "音频附件包已准备；剪贴板不包含音频，需用户另行附上。" : "本次仅复制文字，未附音频；不得声称已听过音频。"}\n导演参考字段不会直接传入模型；关键表演要求须写入窗口instruction，整体rate不是句内速度。初始seed固定0。\n当前能力：${JSON.stringify({ actions: ACTIONS, fields: FIELDS, rate: [0.5, 2], pitch: [0.5, 2], volume: [0, 100], seed: [0, 65535], sampleRate: 48000, ssml: "仅unit后break，通过rhythmData；不接受任意XML", pronunciation: "hot_fix拼音", instruction: "Han<=40 weighted<=100" })}\n任务上下文：\n\`\`\`json\n${JSON.stringify(scrub({ ...safe, voiceName: voice?.name, windows: t.windows.map((w: Obj) => ({ ...w, instructionCounts: instructionCount(w.instruction) })) }), null, 2)}\n\`\`\`\n请返回 ${p.kind === "Director" ? "CHATGPT_DIRECTOR_PLAN_V1" : "CHATGPT_EXECUTION_PLAN_V1"}。\n${protocol}\n${detail}`;
    writeFileSync(join(dir, "CHATGPT_TASK.md"), text, { flag: "wx" });
    return { text, dir, task: t };
  }
  preview(p: Obj) {
    const t = this.get(p.taskId);
    this.idle(t);
    const plan = parsePlan(p.text);
    validateContext(plan, t);
    if(plan.schema==='CHATGPT_DIRECTOR_PLAN_V1'&&!plan.generationWindows.some((w:Obj)=>plan.rehearsal.unitIds.every((id:string)=>w.unitIds.includes(id)))) throw Error("导演试演范围跨越生成窗口，请修改为单一窗口内连续Unit");
    const ph = hash(plan);
    if (
      this.db
        .prepare("SELECT id FROM plans WHERE id=? OR hash=?")
        .get(plan.planId, ph)
    )
      throw Error("该方案已应用，不能重复执行");
    return {
      plan,
      planHash: ph,
      before: t.windows,
      after:
        plan.schema === "CHATGPT_DIRECTOR_PLAN_V1"
          ? plan.generationWindows
          : plan.changes,
    };
  }
  apply(p: Obj) {
    const preview = this.preview(p),
      plan = structuredClone(preview.plan),
      t = this.get(p.taskId);
    return this.tx(() => {
      if (plan.schema === "CHATGPT_DIRECTOR_PLAN_V1") {
        t.archives = [
          ...(t.archives || []),
          { windows: t.windows, revision: t.taskRevision },
        ];
        t.finalDirty = true;
        t.director = plan;
        t.rehearsalUnitIds = null;
        t.windows = plan.generationWindows.map((w: Obj) =>
          this.window(w.windowId, w.unitIds, {
            instruction: w.instruction,
            rhythmData: w.rhythmPlan,
            transitionPauseMs: w.transitionPauseMsAfter,
            pronunciation: plan.pronunciation,
          }),
        );
        t.speakerProfile = plan.speakerProfile;
        t.performanceArc = plan.performanceArc;
        t.rehearsalPassed = false;
      } else {
        for (const c of plan.changes) {
          const target =
            c.scope === "TASK"
              ? t
              : t.windows.find((w: Obj) => w.windowId === c.targetId);
          if (
            c.scope === "WINDOW" &&
            canonical(target[c.field]) !== canonical(c.value)
          )
            t.finalDirty = true;
          target[c.field] = c.value;
          if (c.scope === "WINDOW" && c.field !== "transitionPauseMs")
            target.status = "dirty";
        }
        if (plan.regenerate) {
          const issue = t.qc.at(-1)?.problem || "未分类";
          const attempts = t.history.filter(
            (h: Obj) =>
              h.issue === issue &&
              (!h.repairContext ||
                h.repairContext === repairContext(t, plan.action)) &&
              h.windowIds?.some((id: string) =>
                plan.targets.windowIds.includes(id),
              ),
          ).length;
          if (attempts >= 3)
            throw Error(
              "同类问题已达三轮，请检查音色源、分段或原稿；停止同策略重试",
            );
          if (plan.action === "JOINT_REPAIR") {
            const index = t.windows.findIndex(
              (w: Obj) => w.windowId === plan.targets.windowIds[0],
            );
            const old = t.windows.slice(
              index,
              index + plan.targets.windowIds.length,
            );
            t.archives = [
              ...(t.archives || []),
              { windows: old, revision: t.taskRevision },
            ];
            const combined = this.window(
              old[0].windowId,
              old.flatMap((w: Obj) => w.unitIds),
              {
                ...old[0],
                unitIds: old.flatMap((w: Obj) => w.unitIds),
                synthesisText: "",
                status: "dirty",
                results: [],
                transitionPauseMs: old.at(-1).transitionPauseMs,
              },
            );
            t.windows.splice(index, old.length, combined);
            plan.targets.windowIds = [combined.windowId];
          }
          t.pendingAction = {
            action: plan.action,
            windowIds: plan.targets.windowIds,
            reconcat: plan.reconcat,
          };
        } else
          t.pendingAction =
            plan.action === "RECONCAT_ONLY"
              ? { action: plan.action, windowIds: [], reconcat: true }
              : null;
        t.history.push({
          plan: preview.plan,
          planHash: preview.planHash,
          issue: t.qc.at(-1)?.problem || "未分类",
          windowIds: plan.targets.windowIds,
          before: preview.before,
          revision: t.taskRevision,
          repairContext: repairContext(
            { ...t, windows: preview.before },
            plan.action,
          ),
        });
        if (plan.changes.some((c: Obj) => c.field !== "transitionPauseMs"))
          t.rehearsalPassed = false;
      }
      this.db
        .prepare("INSERT INTO plans VALUES(?,?,?,?)")
        .run(
          preview.plan.planId,
          preview.planHash,
          t.taskId,
          JSON.stringify(preview.plan),
        );
      t.taskRevision++;
      this.save(t);
      return t;
    });
  }
  feedback(p: Obj) {
    const t = this.get(p.taskId);
    this.idle(t);
    if (p.taskRevision !== t.taskRevision) throw Error("任务已变化，请刷新");
    if (p.type === "qc") {
      const q = p.data;
      if (
        !q ||
        !Array.isArray(q.answers) ||
        q.answers.length !== 10 ||
        q.answers.some(
          (s: unknown) =>
            ![
              "非常符合",
              "基本符合",
              "不太符合",
              "完全不符合",
              "听不出来 / 不确定",
            ].includes(String(s)),
        )
      )
        throw Error("请完成10题听感诊断");
      if (
        q.range &&
        ((q.range.start !== "" && !Number.isFinite(Number(q.range.start))) ||
          (q.range.end !== "" && !Number.isFinite(Number(q.range.end))) ||
          (q.range.start !== "" &&
            q.range.end !== "" &&
            Number(q.range.end) < Number(q.range.start)))
      )
        throw Error("问题时间范围不正确");
      if (typeof q.problem !== "string" || typeof q.description !== "string")
        throw Error("反馈格式错误");
      if (q.caseName !== undefined && !(q.caseName in CASE_CHECKS))
        throw Error("未知专项验收");
      t.qc.push({
        ...q,
        finalSourceHash: t.final?.sourceHash,
        revision: t.taskRevision,
        at: new Date().toISOString(),
      });
    } else if (p.type === "rehearsal") {
      if (
        !t.rehearsal?.results?.length ||
        t.rehearsal.status !== "generated" ||
        p.data !== true
      )
        throw Error("请先试听成功试演");
      const result = t.rehearsal.results.at(-1);
      const duration = result.duration;
      if (!Number.isFinite(duration) || duration <= 0 || !result.path || !existsSync(result.path)) throw Error("试演音频缺失或时长无效，请恢复文件后确认");
      if(result.fileHash && createHash("sha256").update(readFileSync(result.path)).digest("hex")!==result.fileHash) throw Error("试演文件已变化或损坏，请恢复音频后确认");
      if(!this.rehearsalMatches(t)) throw Error("这是旧参数试演，请按当前音色、参数和范围重新试演");
      t.rehearsalPassed = true;
      t.rehearsalApprovalHash = t.rehearsal.bindingHash;
    } else if (p.type === "ab") {
      if (!["A 更自然", "B 更自然", "差不多", "都不好"].includes(p.data))
        throw Error("无效A/B结论");
      const w = t.windows.find((w: Obj) => w.windowId === p.windowId);
      if (!w || w.results.length < 2) throw Error("需要两版结果");
      w.ab = p.data;
      if (p.data === "A 更自然") w.selectedRevision = w.results.at(-2).revision;
      else if (p.data === "B 更自然")
        w.selectedRevision = w.results.at(-1).revision;
      if (["A 更自然", "B 更自然"].includes(p.data)) {
        const snapshot = w.results.find(
          (r: Obj) => r.revision === w.selectedRevision,
        )?.snapshot;
        if (snapshot)
          for (const k of [
            "instruction",
            "synthesisText",
            "rhythmData",
            "pronunciation",
            "rate",
            "pitch",
            "volume",
            "seed",
          ])
            if (snapshot[k] !== undefined) w[k] = structuredClone(snapshot[k]);
        w.status = "generated";
        t.finalDirty = true;
      }
      if (t.history.length) t.history.at(-1).ab = p.data;
    } else if (p.type === "confirm") {
      const w = t.windows.find((w: Obj) => w.windowId === p.windowId);
      if (!w || w.status !== "generated") throw Error("只能确认已生成结果");
      w.status = "confirmed";
      const result =
        w.results.find((r: Obj) => r.revision === w.selectedRevision) ||
        w.results.at(-1);
      if (result) result.confirmed = true;
    } else if (p.type === "golden") {
      if (
        !t.final ||
        t.finalDirty ||
        t.final.sourceHash !== finalSource(t.windows) ||
        !t.qc.length ||
        t.qc.at(-1).finalSourceHash !== t.final.sourceHash ||
        [0, 1, 2, 6, 9].some(
          (i) => !["非常符合", "基本符合"].includes(t.qc.at(-1).answers[i]),
        ) ||
        t.qc.at(-1).pronunciationOk !== true ||
        t.qc.at(-1).seamsOk !== true ||
        (t.qc.at(-1).caseName &&
          CASE_CHECKS[t.qc.at(-1).caseName].some(
            (k) => t.qc.at(-1).caseChecks?.[k] !== true,
          )) ||
        !t.windows.every((w: Obj) => w.status === "confirmed")
      )
        throw Error("请确认所有片段、重新拼接并完整试听填写QC");
      t.golden = {
        ...t.final,
        qc: t.qc.at(-1),
        revision: t.taskRevision,
        at: new Date().toISOString(),
      };
    } else if (p.type === "signature") {
      const w = t.windows.find((w: Obj) => w.windowId === p.windowId);
      if (!w || w.status !== "confirmed") throw Error("请先确认满意片段");
      t.signatures = [
        ...(t.signatures || []),
        {
          intent: String(p.data || "固定句"),
          window: structuredClone(w),
          revision: t.taskRevision,
        },
      ];
    } else throw Error("未知反馈类型");
    t.taskRevision++;
    return this.save(t);
  }
  async generate(
    p: Obj,
    adapter?: (snapshot: Obj, path: string) => Promise<Obj>,
  ) {
    const t = this.get(p.taskId);
    if (p.taskRevision !== t.taskRevision) throw Error("任务已变化，请刷新");
    this.idle(t);
    const key = t.taskId + ":generate";
    this.active.add(key);
    let w: Obj | undefined;
    let sent = false;
    try {
      if (p.rehearsal) {
        if (
          t.rehearsal &&
          ["unknown_result", "interrupted"].includes(t.rehearsal.status) &&
          p.acknowledge !== true
        )
          throw Error("试演上次请求结果未知，请核对计费后确认重新请求");
        const config = this.rehearsalConfig(t);
        t.rehearsalPassed = false;
        t.rehearsalApprovalHash = null;
        this.save(t);
        t.rehearsal = this.window("REHEARSAL", config.unitIds, {
          ...config,
          bindingHash: hash(config),
          results: t.rehearsal?.results || [],
        });
        w = t.rehearsal;
      } else {
        if (
          (!t.rehearsalPassed || (t.rehearsalApprovalHash && (!this.rehearsalMatches(t) || t.rehearsalApprovalHash!==t.rehearsal.bindingHash))) &&
          !t.pendingAction?.windowIds.includes(p.windowId)
        )
          throw Error("请先生成当前参数的试演并确认听感通过");
        w = t.windows.find((w: Obj) => w.windowId === p.windowId);
      }
      if (!w) throw Error("Window不存在");
      if (
        ["unknown_result", "interrupted"].includes(w.status) &&
        p.acknowledge !== true
      )
        throw Error("上次请求结果未知，请先核对服务端计费，确认后手动重新请求");
      checkInstruction(w.instruction);
      for (const k of [
        "rate",
        "pitch",
        "volume",
        "seed",
        "rhythmData",
        "pronunciation",
      ])
        fieldValue(k, w[k]);
      if (
        w.transitionPauseMs &&
        w.rhythmData.some(
          (r: Obj) => r.unitId === w!.unitIds.at(-1) && r.pauseMs > 0,
        )
      )
        throw Error("窗口尾部SSML停顿与段间停顿冲突，只保留一层");
      let text =
        w.synthesisText ||
        w.unitIds
          .map((id: string) => t.units.find((u: Obj) => u.id === id).text)
          .join("");
      if (!text.trim() || [...text].length > 20000 || /[<>]/.test(text))
        throw Error("合成文本无效");
      if (w.rhythmData.length) {
        if (w.synthesisText)
          throw Error("自定义合成文本与Unit停顿不能同时使用");
        const escape = (s: string) =>
          s
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
        text =
          "<speak>" +
          w.unitIds
            .map(
              (id: string) =>
                escape(t.units.find((u: Obj) => u.id === id).text) +
                (w!.rhythmData.find((r: Obj) => r.unitId === id)
                  ? `<break time="${w!.rhythmData.find((r: Obj) => r.unitId === id).pauseMs}ms"/>`
                  : ""),
            )
            .join("") +
          "</speak>";
      }
      const revision = (w.results.at(-1)?.revision || 0) + 1;
      const dir = join(
        this.root,
        "outputs",
        t.taskId,
        w.windowId,
        `rev${revision}-${randomUUID()}`,
      );
      mkdirSync(dir, { recursive: true });
      const snapshot: Obj = {
        text,
        synthesisText: w.synthesisText,
        rhythmData: w.rhythmData,
        unitIds: w.unitIds,
        voiceRef: t.voiceRef,
        instruction: w.instruction,
        rate: w.rate,
        pitch: w.pitch,
        volume: w.volume,
        seed: w.seed,
        pronunciation: w.pronunciation,
        format: "wav",
        sample_rate: 48000,
        enable_ssml: w.rhythmData.length > 0,
        clientRequestId: randomUUID(),
      };
      const prepared = adapter ? undefined : this.prepare(snapshot);
      if (prepared) {
        snapshot.model = "cosyvoice-v3.5-plus";
        snapshot.accountRef = prepared.accountRef;
        snapshot.remoteVoice = prepared.voice;
        snapshot.endpoint = prepared.url;
      }
      snapshot.requestSnapshotHash = hash(snapshot);
      writeFileSync(
        join(dir, "request.json"),
        JSON.stringify(snapshot, null, 2),
        { flag: "wx" },
      );
      w.previousStatus = w.status;
      w.status = "generating";
      w.snapshot = { ...snapshot, outputPath: join(dir, "audio.wav") };
      t.taskRevision++;
      this.save(t);
      sent = true;
      const path = join(dir, "audio.wav");
      const result = adapter
        ? await adapter(snapshot, path)
        : await this.synthesize(snapshot, path, prepared!);
      w.results.push({ id: randomUUID(), revision, path, snapshot, ...result, fileHash: existsSync(path)?createHash("sha256").update(readFileSync(path)).digest("hex"):undefined });
      w.selectedRevision = revision;
      w.status = "generated";
      if (!p.rehearsal) {
        t.finalDirty = true;
        if (t.pendingAction?.windowIds.includes(w.windowId)) {
          const history = t.history.at(-1);
          if (history) {
            history.afterResults = {
              ...(history.afterResults || {}),
              [w.windowId]: w.results.at(-1),
            };
          }
          t.pendingAction.windowIds = t.pendingAction.windowIds.filter(
            (id: string) => id !== w!.windowId,
          );
          if (!t.pendingAction.windowIds.length)
            t.pendingAction = t.pendingAction.reconcat
              ? { action: "RECONCAT_ONLY", windowIds: [], reconcat: true }
              : null;
        }
      }
      t.taskRevision++;
      this.save(t);
      try { await this.syncAssets(t); } catch(e) { t.assetSyncError=String(e); this.save(t); }
      return t;
    } catch (e) {
      if (w && sent) {
        w.status =
          (e as Obj).code === "SubmissionUnknown" ||
          (w.snapshot?.outputPath &&
            existsSync(join(dirname(w.snapshot.outputPath), "response.json")))
            ? "unknown_result"
            : "failed";
        w.error = String(e);
        t.taskRevision++;
        this.save(t);
      }
      throw e;
    } finally {
      this.active.delete(key);
    }
  }
  prepare(s: Obj) {
    const app = this.app!;
    const voice = app.audio.voices().find((v) => v.id === s.voiceRef);
    const model = app
      .models()
      .find((m) => m.id === "cosyvoice-v3.5-plus" && m.enabled);
    const account = app.credentials
      .list()
      .find(
        (a) =>
          a.id === voice?.accountId && a.enabled && a.region === "cn-beijing",
      );
    if (
      !voice?.voiceId ||
      !model ||
      !account ||
      voice.status === "unavailable" ||
      !voiceCompatible(voice, model, account)
    )
      throw Error("请选择与北京CosyVoice3.5Plus连接匹配的可用复刻音色");
    const workspace = normalizeWorkspace(account.workspaceId || "");
    validateWorkspace(workspace);
    const url = model.audio!.endpoints[account.region].tts.replace(
      "{workspace}",
      workspace,
    );
    secureURL(url);
    return {
      accountRef: account.id,
      url,
      key: app.credentials.getKey(account.id),
      voice: voice.voiceId,
    };
  }
  async synthesize(
    s: Obj,
    path: string,
    c: { url: string; key: string; voice: string },
  ) {
    checkInstruction(s.instruction);
    const {
      text,
      instruction,
      rate,
      pitch,
      volume,
      seed,
      format,
      sample_rate,
      enable_ssml,
    } = s;
    const result = (await new HttpClient(
      this.app!.fetcher,
      this.app!.logger,
      0,
    ).request(c.url, c.key, {
      method: "POST",
      paidSubmit: true,
      body: {
        model: "cosyvoice-v3.5-plus",
        input: {
          text,
          voice: c.voice,
          instruction,
          rate,
          pitch,
          volume,
          seed,
          format,
          sample_rate,
          enable_ssml,
          language_hints: ["zh"],
          ...(s.pronunciation.length
            ? {
                hot_fix: {
                  pronunciation: s.pronunciation.map((v: Obj) => ({
                    [v.word]: v.pinyin,
                  })),
                },
              }
            : {}),
        },
      } as Json,
    })) as Obj;
    const url = result.output?.audio?.url;
    if (!url) {
      const e = Object.assign(
        Error("请求已发送，但结果未知，请核对控制台后手动重试"),
        { code: "SubmissionUnknown" },
      );
      throw e;
    }
    writeFileSync(
      join(dirname(path), "response.json"),
      JSON.stringify(result),
      { flag: "wx" },
    );
    try {
      const safe = secureURL(String(url).replace(/^http:/, "https:"));
      const response = await this.app!.fetcher(safe, {
        signal: AbortSignal.timeout(120000),
        redirect: "error",
      });
      if (!response.ok)
        throw Error("生成已成功，下载失败；请保留快照并核对控制台");
      const bytes = Buffer.from(await response.arrayBuffer());
      writeFileSync(path + ".tmp", bytes, { flag: "wx" });
      const metadata = await this.verifyWav(path + ".tmp");
      renameSync(path + ".tmp", path);
      return { requestId: result.request_id, usage: result.usage, ...metadata };
    } catch (e) {
      throw Object.assign(
        Error(
          "云端已生成，下载或文件验证失败。可恢复下载，无需再次计费：" +
            String(e),
        ),
        { code: "SubmissionUnknown" },
      );
    }
  }
  async verifyWav(path: string) {
    const ffmpeg = ffmpegBinary(this.app?.settings().ffmpegPath);
    const bundled = join(
      dirname(process.execPath),
      "resources",
      "app",
      "resources",
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    );
    const development = join(
      process.cwd(),
      "resources",
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    );
    const probe = existsSync(bundled)
      ? bundled
      : existsSync(development)
        ? development
        : "ffprobe";
    const { stdout } = await exec(
      probe,
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
      { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
    );
    const info = JSON.parse(stdout),
      audio = info.streams.find((s: Obj) => s.codec_type === "audio");
    if (
      info.format.format_name !== "wav" ||
      audio?.codec_name !== "pcm_s16le" ||
      Number(audio.sample_rate) !== 48000 ||
      Number(info.format.duration) <= 0
    )
      throw Error("输出不是48kHz PCM WAV或时长无效");
    await exec(
      ffmpeg,
      ["-nostdin", "-v", "error", "-i", path, "-f", "null", "-"],
      { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
    );
    return {
      sampleRate: 48000,
      codec: audio.codec_name,
      channels: Number(audio.channels),
      duration: Number(info.format.duration),
      verification: "ffprobe元数据及FFmpeg完整解码",
    };
  }
  async concat(p: Obj) {
    const t = this.get(p.taskId);
    this.idle(t);
    if (p.taskRevision !== t.taskRevision) throw Error("任务已变化，请刷新");
    const key = t.taskId + ":concat";
    this.active.add(key);
    try {
      if (
        !t.windows.every((w: Obj) =>
          ["generated", "confirmed"].includes(w.status),
        )
      )
        throw Error("请先生成所有片段");
      const selected = t.windows.map(
        (w: Obj) =>
          w.results.find((r: Obj) => r.revision === w.selectedRevision) ||
          w.results.at(-1),
      );
      const dir = join(this.root, "outputs", t.taskId, "final", randomUUID());
      mkdirSync(dir, { recursive: true });
      const path = join(dir, "audio.wav"),
        tmp = path + ".tmp.wav";
      const args = ["-nostdin", "-n"];
      selected.forEach((r: Obj) => args.push("-i", r.path));
      const filters: string[] = [],
        labels: string[] = [];
      t.windows.forEach((w: Obj, i: number) => {
        filters.push(
          `[${i}:a]aformat=sample_rates=48000:sample_fmts=s16:channel_layouts=mono[a${i}]`,
        );
        labels.push(`[a${i}]`);
        if (i < t.windows.length - 1 && w.transitionPauseMs) {
          filters.push(
            `anullsrc=r=48000:cl=mono,atrim=duration=${w.transitionPauseMs / 1000}[s${i}]`,
          );
          labels.push(`[s${i}]`);
        }
      });
      filters.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`);
      args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        tmp,
      );
      await exec(ffmpegBinary(this.app?.settings().ffmpegPath), args, {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      });
      const meta = await this.verifyWav(tmp);
      renameSync(tmp, path);
      t.finals = [...(t.finals || []), t.final].filter(Boolean);
      t.final = {
        id: randomUUID(),
        path,
        ...meta,
        sourceHash: finalSource(t.windows),
      };
      t.taskRevision++;
      t.pendingAction = null;
      t.finalDirty = false;
      this.save(t);
      try { await this.syncAssets(t); } catch(e) { t.assetSyncError=String(e); this.save(t); }
      return t;
    } finally {
      this.active.delete(key);
    }
  }
  async recover(p: Obj) {
    const t = this.get(p.taskId,true);
    this.idle(t);
    if (t.taskRevision !== p.taskRevision) throw Error("请刷新任务");
    const w =
      p.windowId === "REHEARSAL"
        ? t.rehearsal
        : t.windows.find((w: Obj) => w.windowId === p.windowId);
    if (
      !w?.snapshot?.outputPath ||
      !["unknown_result", "interrupted"].includes(w.status)
    )
      throw Error("没有待恢复请求");
    const key = t.taskId + ":recover";
    this.active.add(key);
    try {
      const path = w.snapshot.outputPath;
      const result = JSON.parse(
        readFileSync(join(dirname(path), "response.json"), "utf8"),
      );
      const url = secureURL(
        String(result.output.audio.url).replace(/^http:/, "https:"),
      );
      if (!existsSync(path)) {
        const res = await this.app!.fetcher(url, {
          signal: AbortSignal.timeout(120000),
          redirect: "error",
        });
        if (!res.ok) throw Error("下载地址已过期或不可用，请核对控制台");
        writeFileSync(
          path + ".recover.tmp",
          Buffer.from(await res.arrayBuffer()),
          { flag: "w" },
        );
        await this.verifyWav(path + ".recover.tmp");
        renameSync(path + ".recover.tmp", path);
      }
      const meta = await this.verifyWav(path);
      const revision = (w.results.at(-1)?.revision || 0) + 1;
      w.results.push({
        id: randomUUID(),
        revision,
        path,
        snapshot: w.snapshot,
        requestId: result.request_id,
        usage: result.usage,
        ...meta,
        fileHash:createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
      w.selectedRevision = revision;
      w.status = "generated";
      if (p.windowId !== "REHEARSAL") {
        t.finalDirty = true;
        if(t.pendingAction?.windowIds?.includes(w.windowId)) {t.pendingAction.windowIds=t.pendingAction.windowIds.filter((id:string)=>id!==w.windowId);if(!t.pendingAction.windowIds.length)t.pendingAction=t.pendingAction.reconcat?{action:"RECONCAT_ONLY",windowIds:[],reconcat:true}:null;}
      } else {t.rehearsalPassed=false;t.rehearsalApprovalHash=null;}
      w.error = null;
      t.taskRevision++;
      this.save(t);
      try { await this.syncAssets(t); } catch(e) { t.assetSyncError=String(e); this.save(t); }
      return t;
    } finally {
      this.active.delete(key);
    }
  }
  output(taskId: string, id: string) {
    const t = this.get(taskId,true);
    let found: string | undefined;
    const visit = (x: any) => {
      if (!x || typeof x !== "object") return;
      if (x.id === id && typeof x.path === "string") found = x.path;
      for (const value of Object.values(x))
        if (value && typeof value === "object") visit(value);
    };
    visit(t);
    if (!found || !found.startsWith(join(this.root, "outputs", taskId) + sep))
      throw Error("音频不存在");
    return found;
  }
  close() {
    this.db.close();
  }
}
