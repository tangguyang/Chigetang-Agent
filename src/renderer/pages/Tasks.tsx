import {
  ArrowUpRight,
  Download,
  Film,
  FolderOpen,
  Play,
  RotateCcw,
  RefreshCw,
  SquarePen,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Draft, Page, Task } from "../../shared/types.ts";
import { Empty, Modal, Pagination, SearchBox } from "../components/common.tsx";
import { AudioTaskDetail } from "./AudioTaskDetail.tsx";
import { api, labels, media, money, run, time, useApp } from "../store.ts";
export function TasksPage() {
  const { boot, setTask } = useApp();
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [model, setModel] = useState(""),
    [provider, setProvider] = useState(""),
    [account, setAccount] = useState(""),
    [project, setProject] = useState(""),
    [from, setFrom] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<Page<Task>>({ items: [], total: 0 }),
    [refreshing, setRefreshing] = useState(false),
    [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const refresh = () =>
    run(async () =>
      setData(
        await api<Page<Task>>("tasks.list", {
          search,
          kind,
          status,
          modelId: model,
          providerId: provider,
          accountId: account,
          projectId: undefined,
          from: from || undefined,
          page,
        }),
      ),
    );
  useEffect(() => {
    void refresh();
    return window.aiVideo.onChange(() => {
      void refresh();
    });
  }, [kind, search, status, model, provider, account, project, from, page]);
  return (
    <section className="list-page">
      <div className="list-scroll">
        <div className="page-title">
          <div>
            <h1>任务</h1>
            <p>每一次创作，都有完整记录。</p>
          </div>
          <div className="actions">
            <button
              disabled={refreshing}
              onClick={() =>
                void run(async () => {
                  setRefreshing(true);
                  try {
                    const r = await api<{
                      attempted: number;
                      succeeded: number;
                      failed: number;
                      refreshedAt: string;
                    }>("tasks.refreshAll");
                    setLastRefresh(r.refreshedAt);
                    await refresh();
                    useApp
                      .getState()
                      .message(
                        r.attempted === 0
                          ? "当前没有需要刷新的云端任务"
                          : r.failed
                            ? `刷新完成：成功 ${r.succeeded}，失败 ${r.failed}`
                            : `已刷新 ${r.succeeded} 个云端任务`,
                      );
                  } finally {
                    setRefreshing(false);
                  }
                })
              }
            >
              <RefreshCw size={15} className={refreshing ? "spin" : ""} />
              {refreshing ? "刷新中…" : "刷新状态"}
            </button>
            <button
              className="primary"
              onClick={() => void run(() => useApp.getState().newDraft())}
            >
              创建视频
            </button>
            {lastRefresh && (
              <small className="last-refresh">
                最近刷新：{time(lastRefresh)}
              </small>
            )}
          </div>
        </div>
        <div className="tabs">
          {[
            ["", "全部任务"],
            ["video", "视频任务"],
            ["audio", "音频任务"],
          ].map(([k, v]) => (
            <button
              key={k}
              className={kind === k ? "active" : ""}
              onClick={() => {
                setKind(k);
                setPage(1);
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="filters">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="搜索任务名称或 Prompt"
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            {Object.entries(labels)
              .filter(([k]) => k !== "Draft")
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部模型</option>
            {boot?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filters secondary-filters">
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部 Provider</option>
            {boot?.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部 API 账户</option>
            {boot?.accounts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="创建起始日期"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {!data.total ? (
          <Empty
            title="还没有任务"
            description="创建第一个视频，Prompt、素材与模型参数会自动留下快照。"
          />
        ) : (
          <div className="task-grid">
            {data.items.map((t) => (
              <div className="task-card-shell" key={t.id}>
                <button
                  className="task-card"
                  key={t.id}
                  onClick={() => setTask(t.id)}
                >
                  <div className="task-preview">
                    {t.type === "audio" ? (
                      <span>♫ 音频</span>
                    ) : t.type === "image" && t.outputPath ? (
                      <img
                        loading="lazy"
                        src={media("output", t.id)}
                        alt={t.name}
                      />
                    ) : t.outputPath ? (
                      <video
                        preload="metadata"
                        muted
                        src={media("output", t.id)}
                      />
                    ) : (
                      <Film size={30} />
                    )}
                    <span className="version">V{t.version}</span>
                  </div>
                  <div className="task-info">
                    <div>
                      <strong>{t.name}</strong>
                      <span className={`status ${t.status}`}>
                        {t.downloadStatus === "failed"
                          ? "下载失败"
                          : labels[t.status]}
                      </span>
                    </div>
                    <p>
                      {t.snapshot.model.name} · {t.snapshot.provider.name}
                    </p>
                    <small>
                      {t.type === "audio"
                        ? "音频"
                        : t.type === "video-group"
                          ? `自动分段复刻 · 进度 ${t.progress ?? 0}%`
                          : `${String(t.snapshot.draft.params.duration)} 秒 · ${String(t.snapshot.draft.params.resolution)}`}{" "}
                      · {money(t.cost)}
                    </small>
                    <footer>
                      <small>{time(t.createdAt)}</small>
                      <ArrowUpRight size={17} />
                    </footer>
                  </div>
                </button>
                {t.type === "audio" && t.outputPath && (
                  <audio controls preload="none" src={media("output", t.id)} />
                )}
                <div className="task-card-actions">
                  <button
                    onClick={() => void run(() => api("open", { taskId: t.id, folder: true }))}
                  >
                    打开文件位置
                  </button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api("tasks.remove", { id: t.id });
                        await refresh();
                      })
                    }
                  >
                    删除任务
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Pagination page={page} total={data.total} size={30} onChange={setPage} />
    </section>
  );
}
export function TaskDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [task, setTask] = useState<Task | null>(null),
    [versions, setVersions] = useState<Task[]>([]),
    [segments, setSegments] = useState<Task[]>([]),
    [busy, setBusy] = useState(false),
    [apiId, setApiId] = useState(""),
    [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const state = useApp();
  const operationLock = useRef(false);
  const lastOperation = useRef(0);
  const load = () =>
    run(async () => {
      const current = await api<Task>("tasks.get", { id });
      setTask(current);
      setVersions(await api<Task[]>("tasks.versions", { id }));
      setSegments(
        current.type === "video-group"
          ? await api<Task[]>("tasks.children", { parentId: id })
          : [],
      );
    });
  useEffect(() => {
    void load();
    return window.aiVideo.onChange(() => {
      void load();
    });
  }, [id]);
  async function operation(fn: () => Promise<unknown>) {
    if (operationLock.current || Date.now() - lastOperation.current < 1200)
      return;
    operationLock.current = true;
    lastOperation.current = Date.now();
    setBusy(true);
    try {
      await run(fn);
      await load();
    } finally {
      setBusy(false);
      operationLock.current = false;
    }
  }
  async function clone(independent: boolean) {
    await state.flushDraft();
    const d = await api<Draft>("tasks.clone", { id, independent });
    state.setDraft(d);
    await state.flushDraft();
    state.setPage("生成视频");
    onClose();
  }
  if (task?.type === "audio")
    return <AudioTaskDetail task={task} onClose={onClose} />;
  return (
    <Modal
      title={task ? `${task.name} / V${task.version}` : "加载任务…"}
      onClose={onClose}
      wide
    >
      {task && (
        <>
          <div className="detail-top">
            <div className="result-player">
              {task.outputPath ? (
                <>
                  <video
                    controls
                    loop
                    src={media("output", task.id)}
                    onDoubleClick={(e) =>
                      void e.currentTarget.requestFullscreen()
                    }
                  />
                  <select
                    aria-label="播放速度"
                    defaultValue="1"
                    onChange={(e) => {
                      const video =
                        e.currentTarget.parentElement?.querySelector("video");
                      if (video) video.playbackRate = Number(e.target.value);
                    }}
                  >
                    {[0.5, 1, 1.5, 2].map((n) => (
                      <option key={n} value={n}>
                        {n}× 播放
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <Empty
                  title={
                    task.downloadStatus === "failed"
                      ? "视频已在云端生成"
                      : labels[task.status]
                  }
                  description={
                    task.downloadStatus === "failed"
                      ? "重新下载只获取已生成的视频，不会再次生成扣费。"
                      : "任务状态会自动更新。"
                  }
                />
              )}
            </div>
            <dl>
              <dt>状态</dt>
              <dd>
                <span className={`status ${task.status}`}>
                  {labels[task.status]}
                </span>
              </dd>
              <dt>模型 / Provider</dt>
              <dd>
                {task.snapshot.model.name} / {task.snapshot.provider.name}
              </dd>
              <dt>预计费用 / 当前估算</dt>
              <dd className="cost">{money(task.cost)}</dd>
              <dt>提交前预计费用</dt>
              <dd>{money(task.snapshot.estimatedCost)}</dd>
              <dt>实际费用 / 扣费</dt>
              <dd>
                {task.actualCost
                  ? money(task.actualCost)
                  : "未取得官方账单数据"}
              </dd>
              <dt>API 账户</dt>
              <dd>{task.snapshot.account.name}</dd>
              <dt>创建时间</dt>
              <dd>{time(task.createdAt)}</dd>
              <dt>云端任务 ID</dt>
              <dd className="path">{task.apiTaskId ?? "尚未返回"}</dd>
              <dt>输出路径</dt>
              <dd className="path">{task.outputPath ?? "尚未下载"}</dd>
            </dl>
          </div>
          {task.error && <div className="notice warning">{task.error}</div>}
          {task.type === "video-group" && (
            <div className="detail-section">
              <h3>分段生成状态</h3>
              <div className="version-list">
                {segments.map((segment) => (
                  <div key={segment.id}>
                    <button onClick={() => state.setTask(segment.id)}>
                      Segment{segment.segment?.index} ·{" "}
                      {segment.segment?.duration.toFixed(2)} 秒
                      <small>{labels[segment.status]}</small>
                    </button>
                    {["Failed", "Cancelled", "Paused"].includes(
                      segment.status,
                    ) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void operation(() =>
                            api("tasks.segment.retry", {
                              id: segment.id,
                              requestId: crypto.randomUUID(),
                            }),
                          )
                        }
                      >
                        仅重试该段
                      </button>
                    )}
                    {segment.error && <small>{segment.error}</small>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="actions">
            <button
              disabled={busy || !task.apiTaskId || task.type === "video-group"}
              onClick={() =>
                void operation(async () => {
                  await api("tasks.refreshStatus", { id });
                  setLastRefresh(new Date().toISOString());
                })
              }
            >
              <RefreshCw size={16} /> 刷新状态
            </button>
            {lastRefresh && (
              <small className="last-refresh">
                最近刷新：{time(lastRefresh)}
              </small>
            )}
            <button
              className="primary"
              disabled={busy || task.type === "video-group"}
              onClick={() =>
                void operation(async () => {
                  if (
                    !window.confirm(
                      "再次生成会创建新的云端生成任务，可能再次扣费。确定继续吗？",
                    )
                  )
                    return;
                  const t = await api<Task>("tasks.again", {
                    id,
                    requestId: crypto.randomUUID(),
                  });
                  state.message(`新版本 V${t.version} 已创建`);
                })
              }
            >
              <RotateCcw size={16} />
              再次生成
            </button>
            <button
              disabled={busy || task.type === "video-group"}
              onClick={() => void operation(() => clone(false))}
            >
              <SquarePen size={16} />
              编辑后生成
            </button>
            <button
              disabled={busy}
              onClick={() => void operation(() => api("open", { taskId: id, folder: true }))}
            >
              <FolderOpen size={16} />
              打开文件位置
            </button>
            {task.outputPath && (
              <>
                <button
                  onClick={() => void run(() => api("open", { taskId: id }))}
                >
                  <Play size={16} />
                  打开视频
                </button>
              </>
            )}
            {task.apiTaskId && (
              <button
                disabled={busy || task.status === "Downloading"}
                onClick={() =>
                  void operation(() => api("tasks.redownload", { id }))
                }
              >
                <Download size={16} />
                重新下载
              </button>
            )}
            {["Queued", "Processing"].includes(task.status) && (
              <button
                disabled={busy}
                onClick={() =>
                  void operation(() => api("tasks.cancel", { id }))
                }
              >
                取消任务
              </button>
            )}
          </div>
          {task.status === "Paused" && (
            <div className="actions">
              <input
                placeholder="云端任务 ID（提交结果不明时填写）"
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
              />
              <button
                disabled={busy}
                onClick={() =>
                  void operation(() =>
                    api("tasks.resume", { id, apiTaskId: apiId || undefined }),
                  )
                }
              >
                关联 / 恢复查询
              </button>
            </div>
          )}
          <div className="detail-section">
            <div className="section-heading">
              <h3>Prompt 快照</h3>
              <div className="actions">
                <button
                  onClick={() =>
                    void run(
                      () =>
                        navigator.clipboard.writeText(
                          task.snapshot.draft.prompt,
                        ),
                      "Prompt 已复制",
                    )
                  }
                >
                  复制 Prompt
                </button>
                <button
                  onClick={() =>
                    void run(
                      () =>
                        api("prompts.save", {
                          name: `${task.name} V${task.version}`,
                          content: task.snapshot.draft.prompt,
                          projectId: task.snapshot.draft.projectId,
                        }),
                      "已保存为模板",
                    )
                  }
                >
                  保存模板
                </button>
              </div>
            </div>
            <pre className="prompt-snapshot">{task.snapshot.draft.prompt}</pre>
          </div>
          <div className="detail-columns">
            <section>
              <h3>参数</h3>
              <dl>
                {Object.entries(task.snapshot.draft.params).map(([k, v]) => (
                  <div className="dl-row" key={k}>
                    <dt>
                      {task.snapshot.model.capabilities.parameters.find(
                        (p) => p.key === k,
                      )?.label ?? k}
                    </dt>
                    <dd>
                      {typeof v === "boolean"
                        ? v
                          ? "开启"
                          : "关闭"
                        : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3>输入资产</h3>
              {task.snapshot.assets.map((a, i) => (
                <button
                  className="asset-ref"
                  key={i}
                  onClick={() => void run(() => api("open", { assetId: a.id }))}
                >
                  {a.kind === "image" && (
                    <img src={media("thumb", a.id)} alt="" />
                  )}
                  <span>
                    {a.name}
                    <small>
                      {a.role} · {a.width ?? "—"}×{a.height ?? "—"}
                    </small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </section>
          </div>
          <h3>历史版本</h3>
          <div className="version-list">
            {versions.map((v) => (
              <button
                key={v.id}
                className={v.id === id ? "selected" : ""}
                onClick={() => state.setTask(v.id)}
              >
                V{v.version}
                {v.parentVersionId
                  ? ` ← V${versions.find((x) => x.id === v.parentVersionId)?.version ?? "?"}`
                  : ""}
                <small>{labels[v.status]}</small>
              </button>
            ))}
          </div>
          <details>
            <summary>API 原始结果与成本来源</summary>
            <p>{task.cost.note}</p>
            <p>{task.snapshot.price.source}</p>
            <pre>{JSON.stringify(task.rawResult, null, 2)}</pre>
            <small>
              Task ID: {id} · Adapter {task.snapshot.model.adapterVersion}
            </small>
          </details>
          <div className="actions danger-zone">
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void operation(async () => {
                  if (await api<boolean>("tasks.remove", { id })) onClose();
                })
              }
            >
              删除任务记录
            </button>
            {task.outputPath && (
              <button
                className="danger"
                onClick={() =>
                  void operation(() => api("tasks.deleteOutput", { id }))
                }
              >
                仅删除本地视频
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
