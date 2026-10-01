import React, { useEffect, useState } from "react";
import type { Obj } from "./domain.ts";
import "./style.css";
import "./v2/style.css";
const api = <T,>(action: string, p?: unknown) =>
  window.aiVideo.invoke<T>("realSpeech:v2:" + action, p);
const audio = (task: string, id: string, legacy = false) =>
  `aivideo://local/${legacy ? "realSpeechLegacy" : "realSpeechV2"}/${encodeURIComponent(task)}?artifact=${encodeURIComponent(id)}`;
const docs = [
  ["manual", "使用手册"],
  ["director", "导演意图词典"],
  ["template", "台词需求模板"],
  ["compiler", "协议编译规范"],
  ["capability", "CosyVoice能力说明"],
  ["diagnosis", "听感诊断手册"],
];
const dump = (x: unknown) => JSON.stringify(x, null, 2);
export default function Page() {
  const [tasks, setTasks] = useState<Obj[]>([]),
    [legacy, setLegacy] = useState<Obj[]>([]),
    [voices, setVoices] = useState<Obj[]>([]),
    [task, setTask] = useState<Obj | null>(null),
    [old, setOld] = useState<Obj | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState("新真人口播"),
    [voiceRef, setVoice] = useState(""),
    [text, setText] = useState(
      () => localStorage.getItem("real-speech-v2-plan-draft") || "",
    ),
    [preview, setPreview] = useState<Obj | null>(null),
    [attested, setAttested] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [feedback, setFeedback] = useState(""),
    [goldenConfirmed, setGoldenConfirmed] = useState(false),
    [showLegacy, setShowLegacy] = useState(false);
  async function refresh() {
    const r = await api<Obj>("list");
    setTasks(r.tasks);
    setLegacy(r.legacy);
    setVoices(r.voices);
  }
  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("real-speech-v2-plan-draft", text);
    } catch {
      /* draft editing remains usable */
    }
  }, [text]);
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = (await fn()) as Obj;
      if (r?.taskId) setTask(r);
      else if (r?.task) setTask(r.task);
      if (r?.job?.error) setNotice(r.job.error);
      await refresh();
      return r;
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const params = () => ({
    taskId: task!.taskId,
    taskRevision: task!.taskRevision,
  });
  const mutate = (p: Obj) => run(() => api("mutate", { ...params(), ...p }));
  const generate = (ids: string[]) =>
    run(() => api("generate", { ...params(), windowIds: ids }));
  async function open(t: Obj) {
    const r = await run(() => api<Obj>("get", { taskId: t.taskId }));
    if (r) {
      setOld(null);
      setSelected([]);
      setGoldenConfirmed(false);
    }
  }
  return (
    <div
      className="rs rs-v2"
      aria-busy={busy}
      onPlayCapture={(event) => {
        const current = event.target as HTMLAudioElement;
        if (current.tagName === "AUDIO")
          for (const other of document.querySelectorAll<HTMLAudioElement>(
            ".rs-v2 audio",
          ))
            if (other !== current) other.pause();
      }}
    >
      <h2>真人口播 V2</h2>
      <div className="rs-v2-docs">
        {docs.map(([id, title]) => (
          <button
            key={id}
            onClick={() => {
              void api("document", { documentId: id }).catch((e) =>
                setError(String(e)),
              );
            }}
          >
            {title}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="rs-v2-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <p className="rs-v2-note">
        软件只校验、执行和保留版本。待验证能力保留在Plan，真实生成出口等待Capability
        Spike。
      </p>
      <section className="rs-v2-import">
        <h3>导入执行方案</h3>
        <label>
          任务名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          复刻音色
          <select
            value={voiceRef}
            onChange={(e) => setVoice(e.target.value)}
            disabled={busy}
          >
            <option value="">选择现有复刻音色</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          REAL_SPEECH_EXECUTION_PLAN_V2
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
              setAttested(false);
            }}
            rows={9}
            spellCheck={false}
          />
        </label>
        <button
          disabled={busy || !text.trim()}
          onClick={() =>
            run(async () => {
              const p = await api<Obj>("preview", { text });
              setPreview(p);
              return null;
            })
          }
        >
          导入并校验方案
        </button>
        {preview && (
          <div>
            <p>
              Plan：{preview.plan.planId} · Profile：
              {preview.plan.capabilityVersion} · {preview.plan.windows.length}
              个Window
            </p>
            <pre>{preview.plan.originalText}</pre>
            {preview.pending.map((w: Obj) => (
              <p key={w.windowId}>
                {w.windowId} 待验证：{w.capabilities.join("、") || "无"}
              </p>
            ))}
            <label>
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
              />
              该Plan来自我已确认的导演方案
            </label>
            <p>导演稿附件可选，无需另上传。</p>
            <button
              disabled={busy || !attested || !name.trim() || !voiceRef}
              onClick={() =>
                run(async () => {
                  const t = await api<Obj>("import", {
                    name,
                    voiceRef,
                    text,
                    confirmed: attested,
                  });
                  setOld(null);
                  setPreview(null);
                  return t;
                })
              }
            >
              保存执行方案
            </button>
          </div>
        )}
      </section>
      <div className="rs-v2-layout">
        <aside>
          <h3>V2任务</h3>
          {tasks.map((t) => (
            <button key={t.taskId} disabled={busy} onClick={() => open(t)}>
              {t.name}
            </button>
          ))}
          <button onClick={() => setShowLegacy(!showLegacy)}>
            旧v1.2.9任务（只读）
          </button>
          {showLegacy &&
            legacy.map((t) => (
              <button
                key={t.taskId}
                onClick={() => {
                  setOld(t);
                  setTask(null);
                }}
              >
                {t.name}
              </button>
            ))}
        </aside>
        <main>
          {old && (
            <section>
              <h3>{old.name} · 旧任务只读</h3>
              <p>旧数据库和原始音频保留，不执行旧导演流程。</p>
              <pre>{old.originalText}</pre>
              {(old.windows || []).map((w: Obj) => (
                <article key={w.windowId}>
                  <h4>{w.windowId}</h4>
                  {[...(w.results || [])].reverse().map((v: Obj) => (
                    <div key={v.id}>
                      <span>V{v.revision}</span>
                      <audio
                        controls
                        preload="none"
                        src={audio(old.taskId, v.id, true)}
                      />
                    </div>
                  ))}
                </article>
              ))}
            </section>
          )}
          {task && (
            <>
              <h3>{task.name}</h3>
              <p>
                Plan {task.plan.planId} · 修订 {task.taskRevision}
              </p>
              <div className="rs-v2-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    setSelected(task.windows.map((w: Obj) => w.windowId))
                  }
                >
                  选择全篇
                </button>
                <button disabled={busy} onClick={() => setSelected([])}>
                  清空选择
                </button>
                <button
                  disabled={busy || !selected.length}
                  onClick={() => generate(selected)}
                >
                  生成所选Window（{selected.length}）
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(() => api("concat", params()))}
                >
                  最终拼接当前版本
                </button>
              </div>
              <section>
                <h4>多锚点试演</h4>
                {task.plan.rehearsalAnchors.length === 0 ? (
                  <p>Plan未指定锚点，软件不会自动挑选。</p>
                ) : (
                  task.plan.rehearsalAnchors.map((a: Obj) => {
                    const state = task.windows.find(
                      (w: Obj) => w.windowId === a.windowId,
                    );
                    const pass = [...task.anchorReviews]
                      .reverse()
                      .find(
                        (r: Obj) =>
                          r.anchorId === a.anchorId &&
                          r.versionId === state.selectedVersionId,
                      );
                    return (
                      <div key={a.anchorId}>
                        <strong>
                          {a.anchorId} → {a.windowId}
                        </strong>
                        <span>
                          {" "}
                          {a.purpose} {pass?.passed ? " · 已通过" : ""}
                        </span>
                        <button
                          disabled={busy || state.locked}
                          onClick={() => generate([a.windowId])}
                        >
                          试演完整Window
                        </button>
                        <button
                          disabled={busy || !state.selectedVersionId}
                          onClick={() =>
                            mutate({
                              type: "anchor",
                              anchorId: a.anchorId,
                              passed: true,
                              feedback,
                            })
                          }
                        >
                          确认当前版本通过
                        </button>
                        <button
                          disabled={busy || !state.selectedVersionId}
                          onClick={() =>
                            mutate({
                              type: "anchor",
                              anchorId: a.anchorId,
                              passed: false,
                              feedback,
                            })
                          }
                        >
                          未通过
                        </button>
                      </div>
                    );
                  })
                )}
              </section>
              {task.plan.windows.map((config: Obj, index: number) => {
                const state = task.windows.find(
                  (w: Obj) => w.windowId === config.windowId,
                );
                return (
                  <WindowCard
                    key={task.taskId + config.windowId}
                    task={task}
                    config={config}
                    state={state}
                    index={index}
                    busy={busy}
                    selected={selected.includes(config.windowId)}
                    toggle={() =>
                      setSelected((s) =>
                        s.includes(config.windowId)
                          ? s.filter((id) => id !== config.windowId)
                          : [...s, config.windowId],
                      )
                    }
                    generate={() => generate([config.windowId])}
                    mutate={mutate}
                    run={run}
                    feedback={feedback}
                  />
                );
              })}
              <section>
                <h4>真人听感诊断</h4>
                <label>
                  用户反馈
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="填写实际听到的问题、位置和希望怎样改变"
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    mutate({ type: "feedback", windowIds: selected, feedback })
                  }
                >
                  保存反馈
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api("export", { ...params(), scope: "all", feedback }),
                    )
                  }
                >
                  导出全篇诊断ZIP
                </button>
                <button
                  disabled={busy || !selected.length}
                  onClick={() =>
                    run(() =>
                      api("export", {
                        ...params(),
                        scope: "selected",
                        windowIds: selected,
                        feedback,
                      }),
                    )
                  }
                >
                  导出所选Window诊断ZIP
                </button>
                <p>
                  包含WAV、Plan、当前参数、真实生成参数与选中版本；软件不自行诊断。
                </p>
              </section>
              <section>
                <h4>最终音频与Golden</h4>
                {[...task.finals].reverse().map((f: Obj) => (
                  <div key={f.finalId}>
                    <span>
                      {f.at}
                      {task.selectedFinalId === f.finalId
                        ? " · 当前最终版本"
                        : ""}
                    </span>
                    <audio
                      controls
                      preload="none"
                      src={audio(task.taskId, f.finalId)}
                    />
                  </div>
                ))}
                <label>
                  <input
                    type="checkbox"
                    checked={goldenConfirmed}
                    onChange={(e) => setGoldenConfirmed(e.target.checked)}
                  />
                  我已完整试听当前拼接，确认保留为Golden并锁定引用Window
                </label>
                <button
                  disabled={busy || !goldenConfirmed || !task.selectedFinalId}
                  onClick={() =>
                    mutate({
                      type: "golden",
                      confirmed: goldenConfirmed,
                      feedback,
                    })
                  }
                >
                  保存Golden
                </button>
                {task.goldens.map((g: Obj) => (
                  <p key={g.goldenId}>
                    Golden {g.at} · {g.finalId}
                  </p>
                ))}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
function WindowCard({
  task,
  config,
  state,
  index,
  busy,
  selected,
  toggle,
  generate,
  mutate,
  run,
  feedback,
}: {
  task: Obj;
  config: Obj;
  state: Obj;
  index: number;
  busy: boolean;
  selected: boolean;
  toggle: () => void;
  generate: () => void;
  mutate: (p: Obj) => unknown;
  run: (fn: () => Promise<unknown>) => Promise<any>;
  feedback: string;
}) {
  const [patch, setPatch] = useState(""),
    [diff, setDiff] = useState<Obj | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [a, setA] = useState(""),
    [b, setB] = useState("");
  const params = {
    taskId: task.taskId,
    taskRevision: task.taskRevision,
    windowId: config.windowId,
  };
  useEffect(() => {
    setDiff(null);
    setConfirmed(false);
  }, [task.planHash, task.taskRevision]);
  const notes = task.plan.intentRanges.filter(
    (n: Obj) => n.target.windowId === config.windowId,
  );
  const versions = [...state.versions].reverse();
  const hasUnknown = state.attempts.some(
    (x: Obj) => x.status === "unknown" && !x.billingAcknowledged,
  );
  return (
    <article className="rs-v2-window">
      <h4>
        <label>
          <input type="checkbox" checked={selected} onChange={toggle} />
          {index + 1}. {config.windowId}
        </label>
        {state.locked ? " · 已锁定" : ""}
      </h4>
      <p>{config.original}</p>
      {config.synthesisText !== config.original && (
        <p>合成文本：{config.synthesisText}</p>
      )}
      <details open>
        <summary>导演意图（只读）</summary>
        {notes.map((n: Obj) => (
          <div key={n.intentId}>
            <strong>{n.target.targetText}</strong>
            <p>{n.humanIntent}</p>
            <p>
              重点：{n.emphasisTerms.map((e: Obj) => e.text).join("、") || "无"}{" "}
              · {n.requestedConfidence}
            </p>
            <p>
              语速：{n.pacingIntent}；停顿：{n.pauseIntent}
            </p>
            <p>
              情绪：{n.emotionIntent}；关系：{n.relationshipIntent}
            </p>
            <p>
              执行路径：
              {n.adoptedExecution
                .map(
                  (e: Obj) =>
                    e.capability +
                    " " +
                    e.confidence +
                    " " +
                    e.fieldRefs.join(","),
                )
                .join("；")}
            </p>
            <p>{n.limitation}</p>
          </div>
        ))}
      </details>
      <details>
        <summary>明确执行参数</summary>
        <pre>
          {dump({
            execution: config.execution,
            ssml: config.ssml,
            hotFix: config.hotFix,
            transition: config.transition,
          })}
        </pre>
      </details>
      <button disabled={busy || state.locked || hasUnknown} onClick={generate}>
        生成新音频版本
      </button>
      <button
        disabled={
          busy ||
          (state.locked &&
            task.goldens.some((g: Obj) =>
              g.windowIds.includes(config.windowId),
            ))
        }
        onClick={() =>
          mutate({
            type: "lock",
            windowId: config.windowId,
            locked: !state.locked,
          })
        }
      >
        {state.locked ? "解除锁定" : "锁定Window"}
      </button>
      <button
        disabled={busy || !state.selectedVersionId}
        onClick={() =>
          run(() =>
            api("export", {
              ...params,
              scope: "single",
              windowIds: [config.windowId],
              feedback,
            }),
          )
        }
      >
        导出单Window诊断
      </button>
      {hasUnknown && (
        <div role="alert">
          <p>请求结果未知，禁止自动重发；先恢复下载或核账。</p>
          <button
            disabled={busy}
            onClick={() =>
              run(() => api("acknowledge", { ...params, confirmed: true }))
            }
          >
            我已核对计费，允许另建新请求
          </button>
        </div>
      )}
      {state.attempts
        .filter((a: Obj) => a.status === "unknown")
        .map((r: Obj) => (
          <div key={r.attemptId}>
            <p>{r.error}</p>
            <button
              disabled={busy}
              onClick={() =>
                run(() => api("recover", { ...params, attemptId: r.attemptId }))
              }
            >
              恢复已有响应下载
            </button>
          </div>
        ))}
      <h5>音频版本（时间倒序，原始文件保留）</h5>
      {versions.length === 0 && <p>尚无音频版本</p>}
      {versions.map((v: Obj) => (
        <div key={v.versionId} className="rs-v2-version">
          <span>
            V{v.versionNumber} · {v.at}
            {state.selectedVersionId === v.versionId ? " · 当前版本" : ""}
          </span>
          <audio
            controls
            preload="none"
            src={audio(task.taskId, v.versionId)}
          />
          <button
            disabled={
              busy || state.locked || state.selectedVersionId === v.versionId
            }
            onClick={() =>
              mutate({
                type: "select",
                windowId: config.windowId,
                versionId: v.versionId,
              })
            }
          >
            选择当前版本
          </button>
          <button
            disabled={busy || state.locked}
            onClick={() =>
              mutate({
                type: "rollback",
                windowId: config.windowId,
                versionId: v.versionId,
              })
            }
          >
            回滚配置与音频至V{v.versionNumber}
          </button>
        </div>
      ))}
      <div className="rs-v2-ab">
        <h5>A/B试听</h5>
        {[
          ["A", a, setA],
          ["B", b, setB],
        ].map(([label, id, setter]) => (
          <label key={label as string}>
            {label as string}
            <select
              value={id as string}
              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
            >
              <option value="">选择音频版本</option>
              {versions.map((v: Obj) => (
                <option key={v.versionId} value={v.versionId}>
                  V{v.versionNumber}
                </option>
              ))}
            </select>
            {id && (
              <audio
                controls
                preload="none"
                src={audio(task.taskId, id as string)}
              />
            )}
          </label>
        ))}
      </div>
      <label>
        ChatGPT修复方案 · {config.windowId}
        <textarea
          value={patch}
          onChange={(e) => {
            setPatch(e.target.value);
            setDiff(null);
            setConfirmed(false);
          }}
          rows={5}
          placeholder="REAL_SPEECH_EXECUTION_PATCH_V2"
        />
      </label>
      <button
        disabled={busy || state.locked || !patch.trim()}
        onClick={() =>
          run(async () => {
            const out = await api<Obj>("patchPreview", {
              ...params,
              text: patch,
            });
            setDiff(out);
            setConfirmed(false);
            return null;
          })
        }
      >
        导入修复并查看Diff
      </button>
      {diff && (
        <div>
          <p>
            目标：{diff.patch.targetWindowIds.join("、")} · 重新生成：
            {diff.generateIds.join("、") || "无（仅说明修订）"}
          </p>
          <pre>{dump(diff.diff)}</pre>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我确认以上Diff及目标范围
          </label>
          <button
            disabled={busy || !confirmed || state.locked}
            onClick={() =>
              run(() =>
                api("patchApply", {
                  ...params,
                  text: patch,
                  confirmed,
                  previewHash: diff.previewHash,
                }),
              )
            }
          >
            {diff.generateIds.length ? "应用并生成新版本" : "应用说明修订"}
          </button>
        </div>
      )}
    </article>
  );
}
