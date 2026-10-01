import { readFileSync, statSync } from "node:fs";
import type { Obj } from "../../../features/realSpeech/domain.ts";
import { RealSpeechV2Service, type Adapter } from "./service.ts";
import { controlAssessment } from "./productionPolicy.ts";
import type { Args } from "../../../cli/args.ts";

/** Transport-neutral controlled entry. No TTS compilation or diagnosis lives here. */
export class SpeechAgentControl {
  service: RealSpeechV2Service;
  adapter?: Adapter;
  constructor(service: RealSpeechV2Service, adapter?: Adapter) {
    this.service = service;
    this.adapter = adapter;
  }
  private info(t: Obj) {
    return {
      taskId: t.taskId,
      name: t.name,
      voiceRef: t.voiceRef,
      planId: t.plan.planId,
      planHash: t.planHash,
      taskRevision: t.taskRevision,
      createdAt: t.createdAt,
      protocolVersion: t.plan.protocolVersion,
      capabilityProfileId: t.plan.capabilityProfileId,
      capabilityVersion: t.plan.capabilityVersion,
      windowCount: t.windows.length,
      golden: t.goldens.map((g: Obj) => ({
        goldenId: g.goldenId,
        finalId: g.finalId,
        windowIds: g.windowIds,
      })),
    };
  }
  private versions(t: Obj, id: string) {
    const { w } = this.service.selected(t, id);
    return [...w.versions]
      .reverse()
      .map((v: Obj) => ({
        versionId: v.versionId,
        versionNumber: v.versionNumber,
        createdAt: v.at,
        selected: v.versionId === w.selectedVersionId,
        fileHash: v.fileHash,
        path: this.service.output(t.taskId, v.versionId),
        fingerprint: v.fingerprint,
        configRevision:
          v.configRevision ??
          w.attempts.find((a: Obj) => a.versionId === v.versionId)
            ?.configRevision ??
          null,
        configAtGeneration: v.config,
        intentRangesAtGeneration: v.intentRanges,
        requestId: v.requestId ?? null,
        usage: v.usage ?? null,
      }));
  }
  context(taskId: string, id: string) {
    const t = this.service.get(taskId),
      { w } = this.service.selected(t, id),
      config = t.plan.windows.find((w: Obj) => w.windowId === id),
      versions = this.versions(t, id);
    return {
      schema: "REAL_SPEECH_AGENT_CONTEXT_V1",
      ...this.info(t),
      window: { ...config, configRevision: w.configRevision, locked: w.locked },
      selectedVersion: versions.find((v) => v.selected) || null,
      versions,
      intentRanges: t.plan.intentRanges.filter(
        (n: Obj) => n.target.windowId === id,
      ),
      rehearsalAnchor: t.plan.rehearsalAnchors.filter(
        (a: Obj) => a.windowId === id,
      ),
      anchorReviews: t.anchorReviews.filter((r: Obj) =>
        t.plan.rehearsalAnchors.some(
          (a: Obj) => a.windowId === id && a.anchorId === r.anchorId,
        ),
      ),
      feedback: t.feedback.filter(
        (f: Obj) => !f.windowIds.length || f.windowIds.includes(id),
      ),
      attempts: w.attempts.map((a: Obj) => ({
        attemptId: a.attemptId,
        status: a.status,
        createdAt: a.createdAt,
        versionId: a.versionId || null,
        configRevision: a.configRevision,
        error: a.error || null,
      })),
      productionPolicySummary: {
        ...this.service.validator.profile.productPolicy,
        usage: "DISPLAY_AND_DIAGNOSIS_ONLY",
        assessment: controlAssessment(
          config,
          this.service.validator.profile.productPolicy.productionRules,
        ),
        softwareDoesNotDiagnoseAudio: true,
        changeIsolationPolicy: "ONE_PRIMARY_VARIABLE_AT_A_TIME",
      },
      capabilitySummary: this.service.validator.profile,
      taskProfileSnapshot: t.profileSnapshot,
      engine: t.plan.engine,
      unresolvedItems: t.plan.unresolvedItems,
    };
  }
  async execute(args: Args) {
    const { command, values: v, flags } = args;
    if (command === "tasks")
      return this.service.list().map((t) => this.info(t));
    const t = this.service.get(v.task),
      revision = v["task-revision"]
        ? Number(v["task-revision"])
        : t.taskRevision;
    if (command === "show")
      return {
        ...this.info(t),
        windows: t.plan.windows.map((c: Obj) => ({
          ...c,
          selectedVersionId: this.service.selected(t, c.windowId).w
            .selectedVersionId,
          configRevision: this.service.selected(t, c.windowId).w.configRevision,
          locked: this.service.selected(t, c.windowId).w.locked,
        })),
      };
    if (["window", "context", "diagnose"].includes(command))
      return this.context(v.task, v.window);
    if (command === "versions") return this.versions(t, v.window);
    if (command === "patch-preview" || command === "patch-apply") {
      if (statSync(v.file).size > 2_000_000) throw Error("Patch文件超过2MB");
      const text = readFileSync(v.file, "utf8"),
        p = { taskId: v.task, text };
      if (command === "patch-preview") return this.service.previewPatch(p);
      if (!flags.has("confirm")) throw Error("需要 --confirm");
      const applied = this.service.applyPatch({
        ...p,
        previewHash: v["preview-hash"],
        confirmed: true,
        experimentalConfirmed: flags.has("experimental-confirm"),
      });
      // A repeated patch is never a paid retry, including a job left queued after a crash.
      if (applied.reused || !applied.jobId) return applied;
      return this.completed(
        await this.service.runJob(applied.jobId, this.adapter),
      );
    }
    if (command === "generate") {
      if (!flags.has("confirm")) throw Error("需要 --confirm");
      const config = t.plan.windows.find((w: Obj) => w.windowId === v.window);
      if (!config) throw Error("Window不存在");
      if (config.experimental && !flags.has("experimental-confirm"))
        throw Error("实验配置还需要 --experimental-confirm；未创建job");
      const j = this.service.createJob({
        taskId: v.task,
        taskRevision: revision,
        windowIds: [v.window],
      });
      return this.completed(await this.service.runJob(j.jobId, this.adapter));
    }
    if (command === "select" || command === "rollback")
      return this.service.mutate({
        taskId: v.task,
        taskRevision: revision,
        windowId: v.window,
        versionId: v.version,
        type: command,
      });
    if (command === "concat") {
      if (!flags.has("confirm")) throw Error("需要 --confirm");
      return this.service.concat({ taskId: v.task, taskRevision: revision });
    }
    if (command === "export-diagnosis")
      return this.service.exportDiagnosis({
        taskId: v.task,
        taskRevision: revision,
        scope: "single",
        windowIds: [v.window],
        feedback: v.feedback || "",
      });
    throw Error("未知命令");
  }
  private completed(result: Obj) {
    if (result.job.status !== "completed")
      throw Error(
        `生成未完成：${result.job.status}；${result.job.error || "请核对状态，禁止自动重试"}`,
      );
    return result;
  }
}
