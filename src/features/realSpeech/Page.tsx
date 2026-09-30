import React, { useEffect, useRef, useState } from "react";
import {
  instructionCount,
  COSYVOICE_35_PLUS,
  QUESTIONS,
  ANSWERS,
  CASE_CHECKS,
  type Obj,
} from "./domain.ts";
import "./style.css";
const api = <T,>(action: string, p?: unknown) =>
  window.aiVideo.invoke<T>("realSpeech:" + action, p);
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="rs">
        <h2>真人口播页面暂不可用</h2>
        <p>{this.state.error}</p>
        <p>可以从左侧继续使用音频生成。</p>
        <button onClick={() => this.setState({ error: "" })}>重新打开</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function Page() {
  return (
    <Boundary>
      <Workbench />
    </Boundary>
  );
}
function Workbench() {
  const [tasks, setTasks] = useState<Obj[]>([]),
    [voices, setVoices] = useState<Obj[]>([]),
    [t, setT] = useState<Obj | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState({
      name: "新真人口播",
      originalText: "",
      voiceRef: "",
      goal: "像同一个真人面对镜头自然讲完",
    }),
    [planText, setPlanText] = useState(""),
    [preview, setPreview] = useState<Obj | null>(null),
    [doc, setDoc] = useState(""),
    [answers, setAnswers] = useState<string[]>(
      Array(10).fill("听不出来 / 不确定"),
    ),
    [problem, setProblem] = useState("像念稿"),
    [position, setPosition] = useState("开头"),
    [description, setDescription] = useState(""),
    [range, setRange] = useState({ start: "", end: "" }),
    [notice, setNotice] = useState(""),
    [mode, setMode] = useState("ChatGPT导演"),
    [groups, setGroups] = useState(""),
    [ack, setAck] = useState(false),
    [signatures, setSignatures] = useState<Obj[]>([]),
    [repairConfirm, setRepairConfirm] = useState(false),
    [pronunciationOk, setPronunciationOk] = useState(false),
    [seamsOk, setSeamsOk] = useState(false),
    [caseName, setCaseName] = useState("通用"),
    [caseChecks, setCaseChecks] = useState<Record<string, boolean>>({}),
    [selectedWindowIds, setSelectedWindowIds] = useState<string[]>([]);
  const lock = useRef(false);
  const [unsaved,setUnsaved]=useState<Record<string,boolean>>({});
  const hasUnsaved=Object.values(unsaved).some(Boolean);
  const markDirty=React.useCallback((key:string,value:boolean)=>setUnsaved(old=>old[key]===value?old:{...old,[key]:value}),[]);
  const noticeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const copied=()=>{setNotice("已复制");if(noticeTimer.current)clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setNotice(""),2000);};
  useEffect(()=>()=>{if(noticeTimer.current)clearTimeout(noticeTimer.current);},[]);
  useEffect(()=>setSelectedWindowIds([]),[t?.taskId]);
  const refresh = async (selected?: Obj) => {
    const out = await api<Obj>("list");
    setTasks(out.tasks);
    const chosen=localStorage.getItem("real-speech-selected");if(!selected&&chosen){const found=out.tasks.find((x:Obj)=>x.taskId===chosen);if(found)setT(found);localStorage.removeItem("real-speech-selected");}
    setVoices(out.voices);
    setSignatures(out.signatures || []);
    if (selected)
      setT(
        out.tasks.find((x: Obj) => x.taskId === selected.taskId) || selected,
      );
  };
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
      if(t) {try{await refresh(t);}catch{}}
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(async () => {
      await refresh();
    });
  }, []);
  const mutate = async (action: string, data: Obj) => {
    const next = await api<Obj>(action, {
      taskId: t!.taskId,
      taskRevision: t!.taskRevision,
      ...data,
    });
    await refresh(next);
    setPreview(null);
  };
  const generate = async (w: Obj, rehearsal = false) => {
    if(hasUnsaved) throw Error("请先保存任务信息、窗口参数或试演范围的修改");
    if (
      !rehearsal &&
      ["unknown_result", "interrupted"].includes(w.status) &&
      !ack
    ) {
      setError("请先核对云端请求和计费，再勾选确认重新请求");
      return;
    }
    await mutate("generate", {
      windowId: w.windowId,
      rehearsal,
      acknowledge: ack,
    });
    setAck(false);
  };
  const media = (w?: Obj, r?: Obj) =>
    `aivideo://local/realSpeech/${t!.taskId}${r ? `?artifact=${encodeURIComponent(r.id)}` : ""}`;
  const feedback = (type: string, data: unknown, windowId?: string) =>
    mutate("feedback", { type, data, windowId });
  const diagnosisData = () => ({
    answers,
    problem,
    position,
    description,
    range,
    pronunciationOk,
    seamsOk,
    caseName,
    caseChecks,
  });
  const saveDiagnosis = async (copyToChatGPT = false) => {
    const next = await api<Obj>("feedback", {
      taskId: t!.taskId,
      taskRevision: t!.taskRevision,
      type: "qc",
      data: diagnosisData(),
    });
    let latest = next;
    if (copyToChatGPT) {
      latest = await api<Obj>("export", {
        taskId: next.taskId,
        taskRevision: next.taskRevision,
        kind: "Diagnosis",
        attachments: true,
      });
    }
    await refresh(latest);
    setNotice(copyToChatGPT
      ? "诊断已保存，优化请求已复制；当前音频文件夹已打开"
      : "听感诊断已保存");
  };
  const deleteTask=(x:Obj)=>run(async()=>{
    const ids=new Set([...x.windows,...(x.rehearsal?[x.rehearsal]:[]),...(x.archives||[]).flatMap((a:Obj)=>a.windows||[])].flatMap((w:Obj)=>(w.results||[]).map((r:Obj)=>r.id)));
    for(const r of [...(x.finals||[]),...(x.final?[x.final]:[])])ids.add(r.id);
    if(!window.confirm(`删除“${x.name}”的任务记录？保留 ${ids.size} 份音频版本及请求审计，不删除文件。`))return;
    await api("remove",{taskId:x.taskId,taskRevision:x.taskRevision});
    if(t?.taskId===x.taskId){setT(null);setUnsaved({});await refresh();}else await refresh(t||undefined);
  });
  const copy = async (text: string) => {
    await api("copy", { text });
    setNotice("已复制，可以粘贴给ChatGPT");
  };
  const copyStage1Task = async () => {
    if (!t) return;
    if (hasUnsaved) throw Error("请先保存或取消当前修改，再导出阶段一任务");
    const instruction = await api<string>("document", { kind: "stage1" });
    const text = `# 真人带货口播｜阶段一导演任务\n\n## 原始口播全文\n\n${t.originalText}\n\n## 当前任务目标\n\n${t.goal || "像真人面对镜头自然带货表达"}\n\n${t.description ? `## 补充要求\n\n${t.description}\n\n` : ""}---\n\n${instruction}`;
    await api("copy", { text });
    setNotice("阶段一任务已复制：直接粘贴给 ChatGPT，先讨论并编辑导演方案");
  };
  const batchReason = (targets: Obj[]) =>
    busy
      ? "正在处理，请稍候"
      : hasUnsaved
        ? "请先保存或取消页面中的修改"
        : !t?.voiceRef
          ? "请先选择可用复刻音色"
          : !targets.length
            ? "当前没有符合条件的片段"
            : targets.some((w) => ["unknown_result", "interrupted"].includes(w.status)) && !ack
              ? "包含结果未知/中断片段，请先核对计费并勾选确认"
              : "";
  const generateMany = async (targets: Obj[], label: string) => {
    if (!t) return;
    const reason = batchReason(targets);
    if (reason) throw Error(reason);
    if (!window.confirm(`${label}将调用 CosyVoice 生成 ${targets.length} 段，每段都会新增音频版本且不会覆盖旧文件。确认继续？`)) return;
    let next = t;
    for (const target of targets) {
      next = await api<Obj>("generate", {
        taskId: next.taskId,
        taskRevision: next.taskRevision,
        windowId: target.windowId,
        acknowledge: ack,
      });
    }
    setAck(false);
    await refresh(next);
  };
  const askWindowChatGPT = async (w: Obj, local: Obj) => {
    if (!t) return;
    const selectedResult = w.results?.find((r: Obj) => r.revision === w.selectedRevision) || w.results?.at(-1);
    const phraseContext = w.unitIds
      .map((id: string) => t.units.find((u: Obj) => u.id === id))
      .filter(Boolean)
      .map((u: Obj) => ({
        phraseId: u.phraseId || u.id,
        text: u.text,
        salesAction: u.salesAction || "",
        direction: u.direction || "",
        pace: u.pace || "NORMAL",
        energy: u.energy || "MEDIUM",
        emphasis: u.emphasis || [],
        pauseAfter: u.pauseAfter || "NONE",
      }));
    const prompt = `# 真人口播｜单段优化请求\n\n请只诊断当前这一段，不要重做整篇。目标模型固定 cosyvoice-v3.5-plus。Instruction 必须 Han≤40、API加权≤100；rate/pitch 0.5～2.0，volume 0～100，seed 0～65535。不要发明模型不存在的参数。\n\n## 整篇原稿\n${t.originalText}\n\n## 当前窗口 ${w.windowId}\n台词：${local.original}\n\nPhrase导演上下文：\n${JSON.stringify(phraseContext, null, 2)}\n\n当前准备执行的参数：\n${JSON.stringify({ instruction: local.instruction, synthesisText: local.synthesisText, rate: local.rate, pitch: local.pitch, volume: local.volume, seed: local.seed, transitionPauseMs: local.transitionPauseMs, pronunciation: local.pronunciation, rhythmData: local.rhythmData }, null, 2)}\n\n${selectedResult ? `我会另外把当前 rev${selectedResult.revision} WAV 拖给你听。` : "当前还没有生成音频，请基于台词和表演目标先给方案。"}\n\n请先用直白人话告诉我：问题最可能在哪里、应该怎么改；然后给一份“只改当前窗口”的建议值，其中 Instruction 必须可直接复制进吃个糖。不要改原稿，不要扩展到其他窗口。`;
    await api("copy", { text: prompt });
    if (selectedResult?.id) await api("reveal", { taskId: t.taskId, resultId: selectedResult.id });
    setNotice(selectedResult ? "本段优化请求已复制，当前 WAV 位置已打开；拖给 ChatGPT 即可" : "本段优化请求已复制，可以直接粘贴给 ChatGPT");
  };
  const ungeneratedWindows = t?.windows.filter((w: Obj) => !(w.results || []).length) || [];
  const dirtyWindows = t?.windows.filter((w: Obj) => w.status === "dirty") || [];
  const selectedWindows = t?.windows.filter((w: Obj) => selectedWindowIds.includes(w.windowId)) || [];
  const concatReason = !t
    ? ""
    : busy
      ? "正在处理，请稍候"
      : hasUnsaved
        ? "请先保存或取消页面中的修改"
        : !t.windows.every((w: Obj) => ["generated", "confirmed"].includes(w.status))
          ? `还有 ${t.windows.filter((w: Obj) => !["generated", "confirmed"].includes(w.status)).length} 段尚未生成到当前参数`
          : "";
  const stage2ImportReason = busy
    ? "正在处理，请稍候"
    : hasUnsaved
      ? "请先保存或取消当前修改"
      : !planText.trim()
        ? "请先粘贴阶段二 REAL_SPEECH_PERFORMANCE_PLAN_V1"
        : "";
  const rehearsalReason = !t
    ? ""
    : busy
      ? "正在处理，请稍候"
      : hasUnsaved
        ? "请先保存或取消当前修改"
        : !t.voiceRef
          ? "请先选择可用复刻音色"
          : "";
  return (
    <div className="rs">
      <header>
        <div>
          <h1>真人口播表演生产系统</h1>
          <p>原稿 → ChatGPT导演 → 导入方案 → 单段生成 / 修改 → 拼接</p>
        </div>
        <div className="rs-actions">
          {[
            ["stage1", "① 阶段一导演协议"],
            ["stage2", "② 阶段二执行编译"],
            ["manual", "📄 使用手册"],
            ["diagnosis", "听感诊断手册"],
          ].map(([kind, label]) => (
            <button
              key={kind}
              onClick={() =>
                void run(async () =>
                  setDoc(await api<string>("document", { kind })),
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {error && (
        <div role="alert" className="rs-error">
          {error}
          <button
            onClick={() =>
              void run(() =>
                copy(
                  `请纠正真人口播协议，错误：${error}。不得猜ID或改原稿；instruction必须汉字≤40、加权≤100。请按刚导出的任务上下文返回唯一完整JSON。`,
                ),
              )
            }
          >
            复制协议纠错 / 精简请求
          </button>
          <button onClick={() => void run(() => refresh(t || undefined))}>
            刷新状态
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="rs-layout">
        <aside>
          <h3>我的口播任务</h3>
          <button
            disabled={busy}
            onClick={() => {
              setT(null);
              setUnsaved({});
              setPreview(null);
            }}
          >
            ＋ 新建任务
          </button>
          {tasks.map((x) => (
            <div className="rs-task-row" key={x.taskId}><button
              disabled={busy || hasUnsaved}
              className={t?.taskId === x.taskId ? "selected" : ""}
              key={x.taskId}
              onClick={() => {
                setT(x);
                setPreview(null);
              }}
            >
              {x.name}
              <small>
                第{x.taskRevision}版 {x.golden ? "· Golden Sample" : ""}
              </small>
            </button><button aria-label={"删除任务："+x.name} disabled={busy||hasUnsaved} onClick={()=>void deleteTask(x)}>删除</button></div>
          ))}

        </aside>
        <main>
          {!t ? (
            <section>
              <h2>1. 新建口播</h2>
              <label>
                任务名称
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                现有复刻音色
                <select
                  value={draft.voiceRef}
                  onChange={(e) =>
                    setDraft({ ...draft, voiceRef: e.target.value })
                  }
                >
                  <option value="">选择音色</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                目标
                <input
                  value={draft.goal}
                  onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
                />
              </label>
              <label>
                原稿
                <textarea
                  rows={12}
                  value={draft.originalText}
                  onChange={(e) =>
                    setDraft({ ...draft, originalText: e.target.value })
                  }
                />
              </label>
              <button
                className="primary"
                disabled={busy || !draft.originalText.trim()}
                onClick={() =>
                  void run(async () => {
                    const next = await api<Obj>("create", draft);
                    await refresh(next);
                    setDraft({name:"新真人口播",originalText:"",voiceRef:"",goal:"像同一个真人面对镜头自然讲完"});
                  })
                }
              >
                创建任务
              </button>
            </section>
          ) : (
            <>
              <section>
                <h2>
                  {t.name} <small>第{t.taskRevision}版</small>
                </h2>
                <TaskInfo key={t.taskId} task={t} voices={voices} busy={busy} onDirty={markDirty} save={changes=>run(()=>mutate("update",changes))}/>
                <label>工作模式<select value={mode} onChange={e=>setMode(e.target.value)}><option>ChatGPT导演</option><option>连续一镜到底（手动）</option><option>导演分段（手动）</option></select></label>
                {hasUnsaved && <p role="alert">有未保存修改，请先保存再生成、导出或应用方案。</p>}
                {mode !== "ChatGPT导演" && (
                  <div>
                    <p>手动模式不依赖试演门禁。分段只按语义边界，优先连续生成；试演仅用于快速校准大方向。</p>
                    {mode.includes("分段") && (
                      <label>
                        每行一个生成窗口，Unit以逗号分开
                        <textarea
                          value={groups}
                          onChange={(e) => setGroups(e.target.value)}
                          placeholder="U001,U002\nU003,U004"
                        />
                      </label>
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          mutate("update", {
                            manualGroups: mode.includes("分段")
                              ? groups
                                  .trim()
                                  .split("\n")
                                  .map((s) =>
                                    s.split(/[,，\s]+/).filter(Boolean),
                                  )
                              : [t.units.map((u: Obj) => u.id)],
                          }),
                        )
                      }
                    >
                      应用手动窗口
                    </button>
                  </div>
                )}
              </section>
              <section>
                <h2>2. ChatGPT 两阶段协作</h2>
                <p>
                  阶段一先用可编辑 Markdown 把“这篇到底怎么演”讨论清楚；你可以直接修改 ChatGPT 的导演稿再发回去。确认后再让 ChatGPT 执行阶段二，输出 REAL_SPEECH_PERFORMANCE_PLAN_V1。
                </p>
                <div className="rs-actions">
                  <button
                    disabled={busy || hasUnsaved}
                    title={hasUnsaved ? "请先保存或取消当前修改" : "复制原稿 + 阶段一导演协议"}
                    onClick={() => void run(copyStage1Task)}
                  >
                    ① 复制阶段一任务给 ChatGPT
                  </button>
                  <button onClick={() => void run(async () => setDoc(await api<string>("document", { kind: "stage1" })))}>查看阶段一导演协议</button>
                  <button onClick={() => void run(async () => setDoc(await api<string>("document", { kind: "stage2" })))}>查看阶段二执行协议</button>
                </div>
                {hasUnsaved && <p className="rs-help">阶段一导出暂不可用：请先保存或取消当前修改，避免把旧状态发给 ChatGPT。</p>}
                <h3>阶段二：粘贴最终执行协议</h3>
                <details>
                  <summary>高级 / 旧版兼容导出（正常两阶段流程不需要）</summary>
                  <div className="rs-actions">
                    {[
                      ["Director", "旧版 Director 导出"],
                      ["Diagnosis", "旧版诊断 + WAV"],
                      ["Repair", "旧版修复任务"],
                      ["FinalQC", "旧版最终QC"],
                    ].map(([kind, label]) => (
                      <button
                        key={kind}
                        disabled={busy || hasUnsaved}
                        title={hasUnsaved ? "请先保存或取消当前修改" : "兼容 v1.2.9 旧协议"}
                        onClick={() =>
                          void run(async () => {
                            await mutate("export", { kind, attachments: kind === "Diagnosis" });
                            copied();
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </details>
                <textarea
                  aria-label="ChatGPT方案"
                  rows={5}
                  value={planText}
                  onChange={(e) => {
                    setPlanText(e.target.value);
                    setPreview(null);
                  }}
                  placeholder="粘贴阶段二 REAL_SPEECH_PERFORMANCE_PLAN_V1（或兼容的旧版唯一协议JSON）"
                />
                <button
                  disabled={!!stage2ImportReason}
                  title={stage2ImportReason || "校验阶段二协议"}
                  onClick={() =>
                    void run(async () =>
                      setPreview(
                        await api<Obj>("preview", {
                          taskId: t.taskId,
                          text: planText,
                        }),
                      ),
                    )
                  }
                >
                  导入并校验方案
                </button>
                {stage2ImportReason && planText.trim() && <p className="rs-help">暂不能导入：{stage2ImportReason}</p>}
                {preview && (
                  <div>
                    <h3>应用前变更预览</h3>
                    <div className="rs-diff">
                      <div>
                        <h4>当前窗口 / 原稿</h4>
                        <pre>{JSON.stringify(preview.before, null, 2)}</pre>
                      </div>
                      <div>
                        <h4>方案变更</h4>
                        <pre>{JSON.stringify(preview.after, null, 2)}</pre>
                      </div>
                    </div>
                    <p>应用保存方案。涉及付费重生成时，还需要点击执行。</p>
                    <p>实际执行：窗口instruction及模型支持参数。speakerProfile、performanceArc、performanceBeats为导演参考，不会直接发送；关键快慢与重音必须写入窗口instruction。初始seed固定0。</p>
                    <button
                      disabled={busy || hasUnsaved}
                      onClick={() =>
                        void run(() => mutate("apply", { text: planText }))
                      }
                    >
                      确认应用方案
                    </button>
                  </div>
                )}
              </section>
              <section>
                <h2>3. 逐段生成与版本管理</h2>
                {t.assetSyncError && <p role="alert">音频生成已保存，但资产关联需要重试：{t.assetSyncError}<button onClick={()=>void run(()=>refresh(t))}>重试资产同步</button></p>}
                <p>
                  首次可先做8–15秒快速试演确认大方向；试演是建议，不再是后续单段生成的强制门禁。任意窗口保存修改后都可以直接重新生成该段。
                </p>
                <TrialRange key={t.taskId} task={t} busy={busy} onDirty={markDirty} save={ids=>run(()=>mutate("update",{rehearsalUnitIds:ids}))}/>
                <button
                  disabled={!!rehearsalReason}
                  title={rehearsalReason || "生成8–15秒快速试演"}
                  onClick={() => void run(() => generate(t.windows[0], true))}
                >
                  {busy ? "处理中…" : "生成试演"}
                </button>
                {rehearsalReason && <p className="rs-help">暂不能试演：{rehearsalReason}</p>}
                {["unknown_result", "interrupted"].includes(
                  t.rehearsal?.status,
                ) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        mutate("recover", { windowId: "REHEARSAL" }),
                      )
                    }
                  >
                    恢复试演下载（不调用TTS）
                  </button>
                )}
                {t.rehearsal?.results?.length > 0 && (
                  <div>
                    <audio
                      controls
                      src={media(t.rehearsal, t.rehearsal.results.at(-1))}
                    />
                    <p>
                      试演 {t.rehearsal.results.at(-1).duration?.toFixed(1)} 秒
                      · {t.rehearsal.status}
                    </p>
                    {(t.rehearsal.results.at(-1).duration < 8 || t.rehearsal.results.at(-1).duration > 15) && <p>建议试演8～15秒；本次有效音频已足够判断时，可以确认通过，无需为了时长调慢。</p>}
                    <button
                      disabled={busy || hasUnsaved || t.rehearsal.status !== "generated"}
                      onClick={() =>
                        void run(() => feedback("rehearsal", true))
                      }
                    >
                      已试听，基础方向通过
                    </button>
                  </div>
                )}
                <p>
                  {t.rehearsalPassed
                    ? "✓ 首轮方向已确认；后续可自由逐段修改和重生成"
                    : "试演尚未确认；你仍可直接生成任意单段，建议先用代表性片段快速校准方向"}
                </p>
                {t.pendingAction && (
                  <div>
                    <p>
                      待执行修复：{t.pendingAction.action} ·{" "}
                      {t.pendingAction.windowIds.join("、")}
                      。{t.pendingAction.action === "RECONCAT_ONLY" ? "仅本地拼接，不调用模型、不新增生成费用。" : "会调用CosyVoice并计费。"}
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        checked={repairConfirm}
                        onChange={(e) => setRepairConfirm(e.target.checked)}
                      />
                      确认按已预览方案执行
                    </label>
                    <button
                      disabled={busy || !repairConfirm}
                      onClick={() =>
                        void run(async () => {
                          if (t.pendingAction.action === "RECONCAT_ONLY") {
                            await mutate("concat", {});
                            return;
                          }
                          let next = t;
                          for (const id of t.pendingAction.windowIds)
                            next = await api<Obj>("generate", {
                              taskId: next.taskId,
                              taskRevision: next.taskRevision,
                              windowId: id,
                              acknowledge: ack,
                            });
                          if (t.pendingAction.reconcat)
                            next = await api<Obj>("concat", {
                              taskId: next.taskId,
                              taskRevision: next.taskRevision,
                            });
                          await refresh(next);
                          setRepairConfirm(false);
                        })
                      }
                    >
                      执行方案
                    </button>
                  </div>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  我已核对云端请求及计费，确认重新请求中断 / 未知结果
                </label>
                <div className="rs-actions">
                  <button
                    disabled={!!batchReason(ungeneratedWindows)}
                    title={batchReason(ungeneratedWindows) || `生成 ${ungeneratedWindows.length} 段`}
                    onClick={() => void run(() => generateMany(ungeneratedWindows, "生成所有未生成片段"))}
                  >
                    生成所有未生成（{ungeneratedWindows.length}）
                  </button>
                  <button
                    disabled={!!batchReason(dirtyWindows)}
                    title={batchReason(dirtyWindows) || `重新生成 ${dirtyWindows.length} 段`}
                    onClick={() => void run(() => generateMany(dirtyWindows, "重新生成所有待更新片段"))}
                  >
                    重新生成所有待更新（{dirtyWindows.length}）
                  </button>
                  <button
                    disabled={!!batchReason(selectedWindows)}
                    title={batchReason(selectedWindows) || `生成已选择的 ${selectedWindows.length} 段`}
                    onClick={() => void run(() => generateMany(selectedWindows, "生成已选择片段"))}
                  >
                    生成已选择（{selectedWindows.length}）
                  </button>
                </div>
                {hasUnsaved && <p className="rs-help">批量生成暂停：页面有未保存修改。保存或取消后立即恢复。</p>}
                {t.windows.map((w: Obj) => (
                  <Window
                    key={t.taskId + w.windowId}
                    w={w}
                    busy={busy}
                    selected={selectedWindowIds.includes(w.windowId)}
                    toggleSelected={() => setSelectedWindowIds((old) => old.includes(w.windowId) ? old.filter((id) => id !== w.windowId) : [...old, w.windowId])}
                    voiceReady={!!t.voiceRef}
                    onDirty={markDirty}
                    media={(r) => media(w, r)}
                    update={(changes) =>
                      run(() =>
                        mutate("update", {
                          window: { windowId: w.windowId, ...changes },
                        }),
                      )
                    }
                    generate={() => run(() => generate(w))}
                    feedback={(type, data) =>
                      run(() => feedback(type, data, w.windowId))
                    }
                    recover={() =>
                      run(() => mutate("recover", { windowId: w.windowId }))
                    }
                    reveal={(r) =>
                      run(async () => {
                        await api("reveal", { taskId: t.taskId, resultId: r.id });
                      })
                    }
                    original={w.unitIds
                      .map(
                        (id: string) =>
                          t.units.find((u: Obj) => u.id === id).text,
                      )
                      .join("")}
                    phrases={w.unitIds.map((id: string) => t.units.find((u: Obj) => u.id === id)).filter(Boolean)}
                    updatePhrase={(unitId, changes) =>
                      run(() => mutate("update", { unit: { unitId, ...changes } }))
                    }
                    askChatGPT={(local) => run(() => askWindowChatGPT(w, local))}
                  />
                ))}
                {error && <p role="alert" className="rs-error">{error}</p>}
                <button
                  disabled={!!concatReason}
                  title={concatReason || "只做本地拼接，不调用 CosyVoice"}
                  onClick={() => void run(() => mutate("concat", {}))}
                >
                  拼接 / 更新完整WAV（不调用CosyVoice）
                </button>
                {concatReason && <p className="rs-help">暂不能拼接：{concatReason}</p>}
                {t.final && (
                  <div>
                    <h3>
                      {t.finalDirty
                        ? "旧版完整音频（参数或片段已变化，请重新拼接）"
                        : "完整试听"}
                    </h3>
                    <audio controls src={media()} />
                    <p>48kHz WAV · {t.final.duration?.toFixed(1)} 秒</p>
                  </div>
                )}
                {signatures.length > 0 && (
                  <details>
                    <summary>复用满意固定句的表演参数</summary>
                    {signatures.map((s, i) => (
                      <div key={i}>
                        {s.intent} · {s.name}
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const id = e.target.value;
                            if (id)
                              void run(() =>
                                mutate("update", {
                                  window: {
                                    windowId: id,
                                    instruction: s.window.instruction,
                                    rate: s.window.rate,
                                    pitch: s.window.pitch,
                                    volume: s.window.volume,
                                    seed: s.window.seed,
                                    pronunciation: s.window.pronunciation,
                                  },
                                }),
                              );
                          }}
                        >
                          <option value="">应用到窗口…</option>
                          {t.windows.map((w: Obj) => (
                            <option key={w.windowId}>{w.windowId}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </details>
                )}
              </section>
              <section>
                <h2>4. 真人听感诊断</h2>
                {QUESTIONS.map((q, i) => (
                  <label className="rs-question" key={q}>
                    <span>
                      {i + 1}. {q}
                    </span>
                    <select
                      value={answers[i]}
                      onChange={(e) =>
                        setAnswers(
                          answers.map((a, j) => (i === j ? e.target.value : a)),
                        )
                      }
                    >
                      {ANSWERS.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  第一次觉得不自然
                  <select
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                  >
                    {[
                      "开头",
                      "前半",
                      "中间",
                      "后半",
                      "价格/卖点",
                      "CTA",
                      "整段",
                      "说不清",
                    ].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label>
                  最明显的问题
                  <select
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                  >
                    {[
                      "像念稿",
                      "新闻播音",
                      "企业宣传片",
                      "直播卖货",
                      "太机械",
                      "太平",
                      "太用力",
                      "太快",
                      "太慢",
                      "停顿怪",
                      "重音怪",
                      "某句话语气不对",
                      "前后不像一次录制",
                      "音色不像本人",
                      "发音/数字/专业词奇怪",
                      "明显拼接",
                      "说不清，就是觉得假",
                    ].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {problem.includes("发音")
                    ? "哪个词、数字或长句不自然？"
                    : problem.includes("拼接") || problem.includes("前后")
                      ? "哪个接缝或前后段落不像一次录制？"
                      : "最明显的不自然发生在哪一句？"}
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="可以只写：说不清，就是觉得假"
                  />
                </label>
                <label>
                  问题时间范围（可选，秒）
                  <div className="rs-actions">
                    <input
                      type="number"
                      min={0}
                      value={range.start}
                      onChange={(e) =>
                        setRange({ ...range, start: e.target.value })
                      }
                      placeholder="开始"
                    />
                    <input
                      type="number"
                      min={0}
                      value={range.end}
                      onChange={(e) =>
                        setRange({ ...range, end: e.target.value })
                      }
                      placeholder="结束"
                    />
                  </div>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={pronunciationOk}
                    onChange={(e) => setPronunciationOk(e.target.checked)}
                  />
                  关键产品名、数字和专业词发音已核对正确
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={seamsOk}
                    onChange={(e) => setSeamsOk(e.target.checked)}
                  />
                  完整试听，无明显拼接
                </label>
                <label>
                  专项验收
                  <select
                    value={caseName}
                    onChange={(e) => {
                      setCaseName(e.target.value);
                      setCaseChecks({});
                    }}
                  >
                    {["通用", "CASE 1", "CASE 2", "CASE 3"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                {(CASE_CHECKS[caseName] || []).map((c) => (
                  <label key={c}>
                    <input
                      type="checkbox"
                      checked={caseChecks[c] || false}
                      onChange={(e) =>
                        setCaseChecks({ ...caseChecks, [c]: e.target.checked })
                      }
                    />
                    {c}
                  </label>
                ))}
                <div className="rs-actions">
                  <button
                    disabled={busy}
                    onClick={() => void run(() => saveDiagnosis(false))}
                  >
                    保存听感诊断
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void run(() => saveDiagnosis(true))}
                  >
                    保存并复制优化请求给 ChatGPT
                  </button>
                </div>
                <p>同一窗口同类问题最多三轮，之后检查音色、窗口设计或原稿。</p>
                <button
                  disabled={busy || !t.final}
                  onClick={() => void run(() => feedback("golden", true))}
                >
                  已完整试听，愿意发布 → 设为Golden Sample
                </button>
                {t.golden && <p>✓ 用户已确认Golden Sample</p>}
                <details>
                  <summary>修复历史 / 旧结果（永久保留）</summary>
                  {(t.archives || [])
                    .flatMap((a: Obj) => a.windows || [])
                    .flatMap((w: Obj) =>
                      w.results.map((r: Obj) => (
                        <div key={r.id}>
                          历史 {w.windowId} · rev{r.revision}
                          <audio controls src={media(w, r)} />
                        </div>
                      )),
                    )}
                  {(t.finals || []).map((r: Obj) => (
                    <div key={r.id}>
                      历史完整音频
                      <audio controls src={media(undefined, r)} />
                    </div>
                  ))}
                  <pre>
                    {JSON.stringify(
                      { history: t.history, archives: t.archives, qc: t.qc },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </section>
            </>
          )}
        </main>
      </div>
      {doc && (
        <div className="rs-modal" role="dialog">
          <button onClick={() => setDoc("")}>关闭文档</button>
          <pre>{doc}</pre>
        </div>
      )}
    </div>
  );
}
function Window({
  w,
  busy,
  selected,
  toggleSelected,
  voiceReady,
  media,
  update,
  generate,
  feedback,
  recover,  reveal,
  original,
  phrases,
  updatePhrase,
  askChatGPT,
  onDirty,
}: {
  w: Obj;
  busy: boolean;
  selected: boolean;
  toggleSelected: () => void;
  voiceReady: boolean;
  media: (r: Obj) => string;
  update: (c: Obj) => Promise<void>;
  generate: () => Promise<void>;
  feedback: (type: string, data: unknown) => Promise<void>;
  recover: () => Promise<void>;
  reveal: (r: Obj) => Promise<void>;
  original: string;
  phrases: Obj[];
  updatePhrase: (unitId: string, changes: Obj) => Promise<void>;
  askChatGPT: (local: Obj) => Promise<void>;
  onDirty:(key:string,value:boolean)=>void;
}) {
  const [instruction, setInstruction] = useState(w.instruction),
    [synthesisText, setText] = useState(w.synthesisText),
    [params, setParams] = useState({
      rate: w.rate,
      pitch: w.pitch,
      volume: w.volume,
      seed: w.seed,
      transitionPauseMs: w.transitionPauseMs,
    }),
    [extra, setExtra] = useState(
      JSON.stringify(
        { pronunciation: w.pronunciation, rhythmData: w.rhythmData },
        null,
        2,
      ),
    );
  const previous=useRef(w);
  useEffect(()=>{
    const old=previous.current;
    const wasDirty=instruction!==old.instruction||synthesisText!==old.synthesisText||Object.keys(params).some(k=>params[k as keyof typeof params]!==old[k])||extra!==JSON.stringify({pronunciation:old.pronunciation,rhythmData:old.rhythmData},null,2);
    if(old!==w&&!wasDirty){setInstruction(w.instruction);setText(w.synthesisText);setParams({rate:w.rate,pitch:w.pitch,volume:w.volume,seed:w.seed,transitionPauseMs:w.transitionPauseMs});setExtra(JSON.stringify({pronunciation:w.pronunciation,rhythmData:w.rhythmData},null,2));}
    previous.current=w;
  },[w]);
  const count = instructionCount(instruction);
  const last = w.results.slice(-2);
  const changed =
    instruction !== w.instruction ||
    synthesisText !== w.synthesisText ||
    Object.keys(params).some(
      (k) => params[k as keyof typeof params] !== w[k],
    ) ||
    extra !==
      JSON.stringify(
        { pronunciation: w.pronunciation, rhythmData: w.rhythmData },
        null,
        2,
      );
  let extraValue: Obj = {};
  let extraError = "";
  try {
    extraValue = JSON.parse(extra);
    if (!extraValue || typeof extraValue !== "object" || Array.isArray(extraValue))
      extraError = "高级参数必须是JSON对象";
    else if (Object.keys(extraValue).some((k) => !["pronunciation", "rhythmData"].includes(k)))
      extraError = "高级参数只允许 pronunciation 和 rhythmData";
  } catch {
    extraError = "高级参数不是合法JSON";
  }
  const paramError =
    params.rate < COSYVOICE_35_PLUS.rate[0] || params.rate > COSYVOICE_35_PLUS.rate[1]
      ? `rate 必须在 ${COSYVOICE_35_PLUS.rate[0]}～${COSYVOICE_35_PLUS.rate[1]}`
      : params.pitch < COSYVOICE_35_PLUS.pitch[0] || params.pitch > COSYVOICE_35_PLUS.pitch[1]
        ? `pitch 必须在 ${COSYVOICE_35_PLUS.pitch[0]}～${COSYVOICE_35_PLUS.pitch[1]}`
        : !Number.isInteger(params.volume) || params.volume < COSYVOICE_35_PLUS.volume[0] || params.volume > COSYVOICE_35_PLUS.volume[1]
          ? `volume 必须是 ${COSYVOICE_35_PLUS.volume[0]}～${COSYVOICE_35_PLUS.volume[1]} 的整数`
          : !Number.isInteger(params.seed) || params.seed < COSYVOICE_35_PLUS.seed[0] || params.seed > COSYVOICE_35_PLUS.seed[1]
            ? `seed 必须是 ${COSYVOICE_35_PLUS.seed[0]}～${COSYVOICE_35_PLUS.seed[1]} 的整数`
            : !Number.isInteger(params.transitionPauseMs) || params.transitionPauseMs < COSYVOICE_35_PLUS.transitionPauseMs[0] || params.transitionPauseMs > COSYVOICE_35_PLUS.transitionPauseMs[1]
              ? `transitionPauseMs 必须是 ${COSYVOICE_35_PLUS.transitionPauseMs[0]}～${COSYVOICE_35_PLUS.transitionPauseMs[1]} 的整数`
              : "";
  const saveReason = busy
    ? "正在处理，请稍候"
    : !changed
      ? "没有未保存修改"
      : !count.valid
        ? "Instruction 超过模型限制"
        : paramError || extraError;
  const reset = () => {
    setInstruction(w.instruction);
    setText(w.synthesisText);
    setParams({rate:w.rate,pitch:w.pitch,volume:w.volume,seed:w.seed,transitionPauseMs:w.transitionPauseMs});
    setExtra(JSON.stringify({pronunciation:w.pronunciation,rhythmData:w.rhythmData},null,2));
  };
  const generateReason = busy
    ? "正在处理，请稍候"
    : !voiceReady
      ? "请先选择可用复刻音色"
      : changed
        ? "请先保存或取消本段修改"
        : !count.valid
          ? "Instruction 超过模型限制，请先精简"
          : extraError
            ? extraError
            : "";
  useEffect(()=>{onDirty(w.windowId,changed);return()=>onDirty(w.windowId,false);},[changed,w.windowId,onDirty]);
  return (
    <article className="rs-window">
      <h3>
        {w.windowId}{" "}
        <small>
          {w.status} · {w.unitIds.join("、")}
        </small>
        <label className="rs-inline-check"><input type="checkbox" checked={selected} disabled={busy} onChange={toggleSelected}/> 批量选择</label>
      </h3>
      <p>{original}</p>
      {phrases.filter((u) => u.phraseId).map((u) => (
        <PhraseMeta key={u.id} unit={u} busy={busy} save={updatePhrase} onDirty={onDirty} />
      ))}
      <label>
        本段实际表演方向（Instruction，会发送给 CosyVoice）
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={2}
        />
      </label>
      <p className={count.valid ? "" : "rs-error"}>
        汉字 {count.hanCount}/40 · API计数 {count.weightedCount}/100 ·{" "}
        {count.valid ? "✓ 可生成" : "超限，禁止生成"}
      </p>
      <details>
        <summary>合成文本与高级参数</summary>
        <label>
          合成文本（空则使用原稿）
          <textarea
            rows={3}
            value={synthesisText}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {(Object.keys(params) as (keyof typeof params)[]).map((k) => {
          const range = k === "rate" ? COSYVOICE_35_PLUS.rate
            : k === "pitch" ? COSYVOICE_35_PLUS.pitch
              : k === "volume" ? COSYVOICE_35_PLUS.volume
                : k === "seed" ? COSYVOICE_35_PLUS.seed
                  : COSYVOICE_35_PLUS.transitionPauseMs;
          return (
            <label key={k}>
              {k} <small>({range[0]}～{range[1]})</small>
              <input
                type="number"
                min={range[0]}
                max={range[1]}
                step={k === "rate" || k === "pitch" ? 0.05 : 1}
                value={params[k]}
                onChange={(e) =>
                  setParams({ ...params, [k]: Number(e.target.value) })
                }
              />
            </label>
          );
        })}
        <label>
          发音与定点停顿（新手建议由ChatGPT方案导入）
          <textarea
            rows={4}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
        </label>
      </details>
      {changed && <p>窗口参数有未保存修改：保存后可立即重新生成本段，也可以取消修改。</p>}
      {paramError && <p className="rs-error">参数无效：{paramError}</p>}
      {extraError && <p className="rs-error">{extraError}</p>}
      {w.status !== "generated" && w.status !== "confirmed" && <p>先生成口播，再试听确认；全部片段生成后才能拼接。</p>}
      <div className="rs-actions">
        <button
          disabled={!!saveReason}
          title={saveReason || "保存当前窗口参数"}
          onClick={() => void update({ instruction, synthesisText, ...params, ...extraValue })}
        >
          保存本段修改
        </button>
        <button disabled={busy || !changed} title={!changed ? "没有未保存修改" : "放弃本段未保存修改"} onClick={reset}>
          取消本段修改
        </button>
        <button
          disabled={busy}
          title="复制当前台词、导演上下文和实际执行参数；有音频时同时打开当前WAV位置"
          onClick={() => void askChatGPT({
            original,
            instruction,
            synthesisText,
            ...params,
            ...(extraError ? { pronunciation: w.pronunciation, rhythmData: w.rhythmData } : extraValue),
          })}
        >
          🤖 问 ChatGPT 优化本段
        </button>
        {["unknown_result", "interrupted"].includes(w.status) && (
          <button disabled={busy} onClick={() => void recover()}>
            恢复下载（不调用TTS）
          </button>
        )}
        <button
          disabled={!!generateReason}
          title={generateReason || (w.results.length ? "重新生成会新增版本，不覆盖旧音频" : "生成本段") }
          onClick={() => void generate()}
        >
          {w.results.length ? "重新生成本段" : "生成本段"}
        </button>
        <button
          disabled={busy || w.status !== "generated"}
          title={busy ? "正在处理" : w.status !== "generated" ? "请先生成并试听当前版本" : "确认当前使用版本满意"}
          onClick={() => void feedback("confirm", true)}
        >
          {w.status === "confirmed" ? "已确认满意" : "确认满意"}
        </button>
        <button
          disabled={busy || w.status !== "confirmed"}
          title={busy ? "正在处理" : w.status !== "confirmed" ? "请先确认满意" : "保存为可复用的固定句表演方案"}
          onClick={() => void feedback("signature", "满意固定句")}
        >
          保存固定句方案
        </button>
      </div>
      {changed && saveReason && <p className="rs-help">暂不能保存：{saveReason}</p>}
      {generateReason && <p className="rs-help">不能生成：{generateReason}</p>}
      {w.error && <p className="rs-error">{w.error}</p>}
      {w.results.length > 0 && (
        <details open>
          <summary>生成版本（最新在前，永不覆盖旧音频）</summary>
          <div className="rs-versions">
            {[...w.results].reverse().map((r: Obj) => {
              const current = (w.selectedRevision || w.results.at(-1)?.revision) === r.revision;
              return (
                <div className="rs-version" key={r.id || r.revision}>
                  <div>
                    <strong>rev{r.revision}{current ? " · ★ 当前使用" : ""}</strong>
                    <small>{r.generatedAt ? ` · ${new Date(r.generatedAt).toLocaleString()}` : " · 历史版本"}</small>
                  </div>
                  <audio controls src={media(r)} />
                  <div className="rs-actions">
                    <button disabled={busy || current} onClick={() => void feedback("select", r.revision)}>
                      {current ? "当前使用" : "设为当前"}
                    </button>
                    <button disabled={busy} onClick={() => void reveal(r)}>打开音频文件位置</button>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}
      {last.length === 2 && (
        <details>
          <summary>A/B 快速比较最近两版</summary>
          <div className="rs-ab">
            {last.map((r: Obj, i: number) => (
              <div key={r.revision}>
                <strong>{i === 0 ? "A 上一版" : "B 当前版"} · rev{r.revision}</strong>
                <audio controls src={media(r)} />
              </div>
            ))}
          </div>
          <div className="rs-actions">
            {["A 更自然", "B 更自然", "差不多", "都不好"].map((a) => (
              <button disabled={busy} key={a} onClick={() => void feedback("ab", a)}>{a}</button>
            ))}
          </div>
          {w.ab && <p>A/B：{w.ab}</p>}
        </details>
      )}
    </article>
  );
}

function PhraseMeta({unit,busy,save,onDirty}:{unit:Obj;busy:boolean;save:(unitId:string,changes:Obj)=>Promise<void>;onDirty:(key:string,value:boolean)=>void}) {
  const fromUnit = (u: Obj) => ({
    salesAction: u.salesAction || "",
    direction: u.direction || "",
    pace: u.pace || "NORMAL",
    energy: u.energy || "MEDIUM",
    emphasis: (u.emphasis || []).join("、"),
    pauseAfter: u.pauseAfter || "NONE",
  });
  const [draft,setDraft]=useState(()=>fromUnit(unit));
  const previous=useRef(unit);
  useEffect(()=>{
    const old = previous.current;
    const oldSaved = fromUnit(old);
    const wasDirty = Object.keys(oldSaved).some((k) => draft[k as keyof typeof draft] !== oldSaved[k as keyof typeof oldSaved]);
    if(old!==unit && !wasDirty) setDraft(fromUnit(unit));
    previous.current=unit;
  },[unit]);
  const saved=fromUnit(unit);
  const changed=Object.keys(saved).some(k=>draft[k as keyof typeof draft]!==saved[k as keyof typeof saved]);
  useEffect(()=>{onDirty("phrase:"+unit.id,changed);return()=>onDirty("phrase:"+unit.id,false);},[changed,unit.id,onDirty]);
  return <details className="rs-phrase">
    <summary>{unit.phraseId} · {unit.salesAction || "表演短语"} · {unit.pace || "NORMAL"} / {unit.energy || "MEDIUM"}</summary>
    <p><strong>台词：</strong>{unit.text}</p>
    <fieldset disabled={busy}>
      <label>销售动作<input value={draft.salesAction} onChange={e=>setDraft({...draft,salesAction:e.target.value})}/></label>
      <label>导演演法（人话，可人工修改）<textarea rows={2} value={draft.direction} onChange={e=>setDraft({...draft,direction:e.target.value})}/></label>
      <div className="rs-actions">
        <label>速度<select value={draft.pace} onChange={e=>setDraft({...draft,pace:e.target.value})}>{["SLOW","NORMAL","FAST"].map(x=><option key={x}>{x}</option>)}</select></label>
        <label>情绪<select value={draft.energy} onChange={e=>setDraft({...draft,energy:e.target.value})}>{["LOW","MEDIUM","HIGH"].map(x=><option key={x}>{x}</option>)}</select></label>
        <label>句后停顿<select value={draft.pauseAfter} onChange={e=>setDraft({...draft,pauseAfter:e.target.value})}>{["NONE","SHORT","MEDIUM","LONG"].map(x=><option key={x}>{x}</option>)}</select></label>
      </div>
      <label>重点词（用、分隔）<input value={draft.emphasis} onChange={e=>setDraft({...draft,emphasis:e.target.value})}/></label>
      <p className="rs-help">这些是导演备注，方便你和 ChatGPT 讨论和保留意图；它们不会自动改写 CosyVoice。需要直接改变声音时，请编辑当前窗口的“本段实际表演方向（Instruction）”或高级参数。</p>
      <div className="rs-actions">
        <button disabled={busy || !changed} title={!changed ? "没有未保存的导演备注" : "保存导演备注；不会自动改写 CosyVoice Instruction"} onClick={()=>void save(unit.id,{salesAction:draft.salesAction,direction:draft.direction,pace:draft.pace,energy:draft.energy,pauseAfter:draft.pauseAfter,emphasis:draft.emphasis.split(/[、,，]/).map(x=>x.trim()).filter(Boolean)})}>保存导演备注</button>
        <button disabled={busy || !changed} title={!changed ? "没有未保存修改" : "放弃导演备注修改"} onClick={()=>setDraft(fromUnit(unit))}>取消修改</button>
      </div>
    </fieldset>
  </details>;
}

function TaskInfo({task,voices,busy,save,onDirty}:{task:Obj;voices:Obj[];busy:boolean;save:(changes:Obj)=>Promise<void>;onDirty:(key:string,value:boolean)=>void}) {
  const keys=["name","goal","originalText","voiceRef","description"];
  const [draft,setDraft]=useState<Obj>(()=>Object.fromEntries(keys.map(k=>[k,task[k]||""])));
  const previous=useRef(task);
  useEffect(()=>{const old=previous.current;if(old!==task&&!keys.some(k=>draft[k]!== (old[k]||"")))setDraft(Object.fromEntries(keys.map(k=>[k,task[k]||""])));previous.current=task;},[task]);
  const changed=keys.some(k=>draft[k]!== (task[k]||""));
  const originalChanged=draft.originalText!==task.originalText;
  useEffect(()=>{onDirty("info",changed);return()=>onDirty("info",false);},[changed,onDirty]);
  return <details open><summary>任务信息 · 可修改并保存</summary><fieldset disabled={busy}>
  {keys.filter(k=>k!=="voiceRef").map(k=><label key={k}>{{name:"任务名称",goal:"任务目标",originalText:"原稿",description:"补充描述"}[k]}{k==="originalText"||k==="description"?<textarea rows={k==="originalText"?5:2} value={draft[k]} onChange={e=>setDraft({...draft,[k]:e.target.value})}/>:<input value={draft[k]} onChange={e=>setDraft({...draft,[k]:e.target.value})}/>}</label>)}
  <label>复刻音色<select value={draft.voiceRef} onChange={e=>setDraft({...draft,voiceRef:e.target.value})}><option value="">选择音色</option>{voices.map(v=><option key={v.id} value={v.id}>{v.name} · {v.status}</option>)}</select></label>
  {!draft.voiceRef && <p>尚未选择音色，可保存任务；生成前须选择可用音色。</p>}
  <button disabled={!changed||!draft.originalText.trim()} onClick={()=>{if(originalChanged&&!window.confirm("确认保存原稿修改并重新解析？未变化 Phrase/窗口会尽量保留 ID、参数和音频；真正受影响的部分标记为待重新生成。"))return;void save(draft);}}>{originalChanged?"保存并重新解析原稿":"保存任务信息"}</button>
  <button disabled={!changed} onClick={()=>setDraft(Object.fromEntries(keys.map(k=>[k,task[k]||""])))}>取消修改</button>
  {changed&&<p>有未保存修改</p>}
  </fieldset></details>;
}

function TrialRange({task,busy,onDirty,save}:{task:Obj;busy:boolean;onDirty:(key:string,value:boolean)=>void;save:(ids:string[])=>Promise<void>}) {
  const ids=task.rehearsalUnitIds||task.director?.rehearsal?.unitIds||task.windows[0].unitIds.slice(0,3);
  const current={start:ids[0],end:ids.at(-1)};
  const [selection,setSelection]=useState(current),previous=useRef(current);
  const changed=selection.start!==current.start||selection.end!==current.end;
  useEffect(()=>{if(selection.start===previous.current.start&&selection.end===previous.current.end)setSelection(current);previous.current=current;},[current.start,current.end]);
  useEffect(()=>{onDirty('range',changed);return()=>onDirty('range',false);},[changed,onDirty]);
  return <details><summary>手动调整试演范围（同一窗口内连续Unit）</summary>{(['start','end'] as const).map(k=><label key={k}>{k==='start'?'起始Unit':'结束Unit'}<select disabled={busy} value={selection[k]} onChange={e=>setSelection({...selection,[k]:e.target.value})}>{task.units.map((u:Obj)=><option key={u.id} value={u.id}>{u.id} · {u.text.slice(0,30)}</option>)}</select></label>)}<button disabled={busy||!changed} onClick={()=>{const a=task.units.findIndex((u:Obj)=>u.id===selection.start),b=task.units.findIndex((u:Obj)=>u.id===selection.end);void save(task.units.slice(a,b+1).map((u:Obj)=>u.id));}}>保存试演范围</button>{changed&&<p>试演范围有未保存修改。</p>}</details>;
}