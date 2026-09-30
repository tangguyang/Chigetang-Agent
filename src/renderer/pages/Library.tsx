import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen } from "lucide-react";
import { api, media, run, time, useApp, labels } from "../store.ts";
import { AssetsPage, AssetPreview } from "./Assets.tsx";
import { Modal, Pagination } from "../components/common.tsx";
import type { Asset, Task } from "../../shared/types.ts";
import type { LibraryRow } from "../../main/services/libraryView.ts";
import type { Obj } from "../../features/realSpeech/domain.ts";
export function LibraryPage() {
  const state = useApp();
  const [q, setQ] = useState<Obj>(() => {
    try {
      return {
        ...JSON.parse(sessionStorage.getItem("library-query") || "{}"),
        kind: state.assetKind === "hidden" ? "" : state.assetKind,
        page: 1,
      };
    } catch {
      return { kind: "video", source: "tasks", page: 1 };
    }
  });
  const [data, setData] = useState<{ items: LibraryRow[]; total: number }>({
      items: [],
      total: 0,
    }),
    [error, setError] = useState(""),
    [local, setLocal] = useState(false),
    [detail, setDetail] = useState<LibraryRow | null>(null),
    [hidden, setHidden] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem("library-hidden") || "[]");
      } catch {
        return [];
      }
    }),
    [folders, setFolders] = useState<Obj[]>([]);
  useEffect(() => {
    void api<Obj[]>("folders.list")
      .then(setFolders)
      .catch((e) => setError(String(e)));
  }, []);
  const scroll = useRef<HTMLDivElement>(null),
    request = useRef(0);
  useEffect(() => {
    const node = scroll.current;
    if (node)
      node.scrollTop = Number(sessionStorage.getItem("library-scroll") || 0);
    return () => {
      if (node)
        sessionStorage.setItem("library-scroll", String(node.scrollTop));
    };
  }, []);
  const patch = (changes: Obj) =>
    setQ((old) => ({ ...old, ...changes, page: changes.page || 1 }));
  useEffect(() => {
    patch({
      kind: state.assetKind === "hidden" ? "" : state.assetKind,
      hidden: state.assetKind === "hidden",
    });
  }, [state.assetKind]);
  const load = async () => {
    const seq = ++request.current;
    try {
      const next = await api<typeof data>("library.list", {
        source: "tasks",
        ...q,
        hiddenIds: hidden,
      });
      if (seq === request.current) {
        setData(next);
        setError((next as Obj).warning || "");
      }
    } catch (e) {
      if (seq === request.current) setError(String(e));
    }
  };
  useEffect(() => {
    sessionStorage.setItem("library-query", JSON.stringify(q));
    const timer = setTimeout(() => void load(), 180);
    const stop = window.aiVideo.onChange(() => void load());
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [q, hidden]);
  useEffect(() => {
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [q, hidden]);
  const showDetail = (row: LibraryRow) =>
    void run(async () => {
      if (row.category === "speech") {
        const t = await window.aiVideo.invoke<Obj>("realSpeech:get", {
          taskId: row.id,
        });
        setDetail({ ...row, children: [t] });
      } else if (row.category === "asset" && !row.asset?.missing) {
        const asset = await api<Asset>("assets.get", { id: row.id });
        setDetail({ ...row, asset });
      } else setDetail(row);
    });
  const hide = (id: string) => {
    const next = hidden.includes(id)
      ? hidden.filter((x) => x !== id)
      : [...hidden, id];
    setHidden(next);
    localStorage.setItem("library-hidden", JSON.stringify(next));
  };
  const speechOpen = (id: string) => {
    localStorage.setItem("real-speech-selected", id);
    state.setPage("真人口播");
  };
  const openTask = (t: Task) => state.setTask(t.id);
  const taskPreview = (t: Task) =>
    t.outputPath ? (
      t.type === "audio" ? (
        <audio controls src={media("output", t.id)} />
      ) : t.type === "image" ? (
        <img src={media("output", t.id)} alt={t.name} />
      ) : (
        <video controls preload="metadata" src={media("output", t.id)} />
      )
    ) : (
      <p>{labels[t.status] || t.status} · 尚无本地结果</p>
    );
  return (
    <section className="list-page">
      <div className="list-scroll" ref={scroll}>
        <div className="page-title">
          <div>
            <h1>资产库</h1>
            <p>按类型找到生成任务、结果和本地素材。</p>
          </div>
          <button onClick={() => setLocal(true)}>导入／管理本地素材</button>
        </div>
        <div className="asset-kind-tabs" role="tablist" aria-label="资产类型">
          {[
            ["", "全部"],
            ["video", "视频"],
            ["image", "图片"],
            ["audio", "音频"],
            ["prompt", "脚本／Prompt"],
          ].map(([k, v]) => (
            <button
              key={k}
              role="tab"
              aria-selected={q.kind === k}
              className={q.kind === k ? "selected" : ""}
              onClick={() => state.setAssetKind(k)}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="filters">
          <select
            aria-label="来源"
            value={q.source || "tasks"}
            onChange={(e) => patch({ source: e.target.value })}
          >
            <option value="all">全部</option>
            <option value="tasks">生成任务</option>
            <option value="assets">结果资产／本地素材</option>
          </select>
          <input
            aria-label="搜索资产与任务"
            placeholder="搜索名称、任务ID、Prompt／口播文本"
            value={q.search || ""}
            onChange={(e) => patch({ search: e.target.value })}
          />
          <select
            aria-label="任务状态"
            value={q.status || ""}
            onChange={(e) => patch({ status: e.target.value })}
          >
            <option value="">全部状态</option>
            <option value="running">进行中</option>
            <option value="completed">已完成</option>
            <option value="attention">失败／待处理</option>
          </select>
          <select
            aria-label="排序"
            value={q.sort || "latest"}
            onChange={(e) => patch({ sort: e.target.value })}
          >
            <option value="latest">最新</option>
            <option value="oldest">最早</option>
          </select>
          <button
            onClick={() =>
              patch({
                source: "all",
                search: "",
                status: "",
                module: "",
                folder: "",
                project: "",
                favorite: false,
                showHidden: false,
              })
            }
          >
            清除筛选
          </button>
        </div>
        <details>
          <summary>辅助筛选</summary>
          <div className="filters">
            <select
              value={q.module || ""}
              onChange={(e) => patch({ module: e.target.value })}
            >
              <option value="">全部模块</option>
              {[
                "一键生成",
                "一键复刻",
                "专业音频",
                "真人口播",
                "历史任务",
                "生成结果",
                "本地素材",
              ].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <select
              aria-label="文件夹"
              value={q.folder || ""}
              onChange={(e) => patch({ folder: e.target.value })}
            >
              <option value="">全部文件夹</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              aria-label="所属项目"
              value={q.project || ""}
              onChange={(e) => patch({ project: e.target.value })}
            >
              <option value="">全部项目</option>
              {state.boot?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={!!q.favorite}
                onChange={(e) => patch({ favorite: e.target.checked })}
              />
              收藏素材
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!q.showHidden}
                onChange={(e) => patch({ showHidden: e.target.checked })}
              />
              显示已隐藏记录
            </label>
          </div>
        </details>
        <p>
          {data.total} 条符合条件 ·
          搜索使用包含匹配；素材搜索名称和标签。已删除口播任务的音频在“结果资产／本地素材”。
        </p>
        {error && (
          <p role="alert">
            {error}
            <button onClick={() => void load()}>重试</button>
          </p>
        )}
        {!data.total && !error && (
          <p>没有符合条件的记录。可清除筛选、导入素材或前往工作台生成。</p>
        )}
        <div className="asset-grid">
          {data.items.map((row) => (
            <article className="asset-card" key={row.id}>
              <button className="asset-visual" onClick={() => showDetail(row)}>
                {row.asset ? (
                  <AssetPreview asset={row.asset as Asset} />
                ) : (
                  <span>
                    {row.kind === "audio" ? "♫" : "▶"}{" "}
                    {row.category === "task" && row.ids.length > 1
                      ? `分段结果 ${row.children?.filter((t) => t.status === "Completed").length}/${row.ids.length}`
                      : row.module}
                  </span>
                )}
              </button>
              <div className="asset-info">
                <strong title={row.name}>{row.name}</strong>
                {row.category === "asset" ? (
                  <button
                    className="file-shortcut"
                    title={
                      row.asset?.missing
                        ? "原文件缺失，可在素材管理重新定位"
                        : "打开原文件"
                    }
                    aria-label="打开原文件"
                    disabled={row.asset?.missing}
                    onClick={() =>
                      void run(() => api("open", { assetId: row.id }))
                    }
                  >
                    <FileText size={18} />
                  </button>
                ) : row.category === "task" ? (
                  <button
                    className="file-shortcut"
                    title="选择并打开生成结果"
                    aria-label="打开生成结果"
                    disabled={
                      !row.children?.some(
                        (t) => t.outputPath || t.outputs?.length,
                      )
                    }
                    onClick={() => {
                      const files = row.children?.filter((t) => t.outputPath);
                      if (
                        files?.length === 1 &&
                        (files[0].outputs || []).length <= 1
                      )
                        void run(() => api("open", { taskId: files[0].id }));
                      else showDetail(row);
                    }}
                  >
                    <FileText size={18} />
                  </button>
                ) : (
                  <button
                    className="file-shortcut"
                    title="查看口播结果"
                    onClick={() => showDetail(row)}
                  >
                    <FileText size={18} />
                  </button>
                )}
                <small>
                  {labels[row.status as keyof typeof labels] ||
                    (
                      {
                        ready_to_concat: "片段已生成，待拼接",
                        pending: "待试演／生成",
                        dirty: "参数已变更，待生成",
                        generated: "已生成",
                        confirmed: "已确认",
                        failed: "生成失败",
                        interrupted: "中断",
                        unknown_result: "结果未知",
                      } as Obj
                    )[row.status] ||
                    row.status}{" "}
                  · {row.module}
                </small>
                <small>
                  {row.createdAt ? time(row.createdAt) : "历史记录"}
                  {row.deleted ? " · 来源任务已删除" : ""}
                </small>
                <button onClick={() => hide(row.id)}>
                  {hidden.includes(row.id) ? "恢复显示" : "隐藏记录"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
      <Pagination
        page={q.page || 1}
        total={data.total}
        size={24}
        onChange={(page) => patch({ page })}
      />
      {local && (
        <Modal
          wide
          title="素材管理／导入"
          onClose={() => {
            setLocal(false);
            void load();
          }}
        >
          <AssetsPage />
        </Modal>
      )}
      {detail && (
        <Modal wide title={detail.name} onClose={() => setDetail(null)}>
          {detail.category === "asset" ? (
            <>
              <AssetPreview asset={detail.asset as Asset} controls />
              <p>
                {detail.deleted ? "来源任务已删除，音频仍可独立使用。" : ""}
              </p>
              <button
                disabled={detail.asset?.missing}
                onClick={() =>
                  void run(() => api("open", { assetId: detail.id }))
                }
              >
                打开原文件
              </button>
              <button
                disabled={detail.asset?.missing}
                onClick={() =>
                  void run(() =>
                    api("open", { assetId: detail.id, folder: true }),
                  )
                }
              >
                打开目录
              </button>
              <pre>{detail.asset?.metadata?.realSpeechSources}</pre>
            </>
          ) : detail.category === "task" ? (
            <>
              {detail.children?.map((t) => (
                <section key={t.id}>
                  <h3>{t.name}</h3>
                  {taskPreview(t as Task)}
                  <button onClick={() => openTask(t as Task)}>
                    任务详情／恢复／再次生成
                  </button>
                  <button
                    disabled={!t.outputPath}
                    onClick={() =>
                      void run(() => api("open", { taskId: t.id }))
                    }
                  >
                    打开原文件
                  </button>
                  {(t.outputs || []).length > 1 &&
                    (t.outputs || []).map((o: Obj, i: number) => (
                      <div key={o.id || i}>
                        结果 {i + 1}
                        <button
                          disabled={!o.metadata?.assetId}
                          onClick={() =>
                            void run(() =>
                              api("open", { assetId: o.metadata.assetId }),
                            )
                          }
                        >
                          打开此结果
                        </button>
                      </div>
                    ))}
                </section>
              ))}
            </>
          ) : (
            <>
              {detail.children?.map((t) => (
                <section key={t.taskId}>
                  <p>{t.finalDirty ? "旧完整口播／待重新合成" : ""}</p>
                  {t.final && (
                    <audio
                      controls
                      src={`aivideo://local/realSpeech/${t.taskId}?artifact=${encodeURIComponent(t.final.id)}`}
                    />
                  )}
                  <details>
                    <summary>试演、片段与历史版本</summary>
                    {[
                      ...t.windows,
                      ...(t.rehearsal ? [t.rehearsal] : []),
                      ...(t.archives || []).flatMap(
                        (a: Obj) => a.windows || [],
                      ),
                    ].map((w: Obj, i: number) => (
                      <div key={i}>
                        <h4>{w.windowId}</h4>
                        {(w.results || []).map((r: Obj) => (
                          <div key={r.id}>
                            <span>v{r.revision}</span>
                            <audio
                              controls
                              src={`aivideo://local/realSpeech/${t.taskId}?artifact=${encodeURIComponent(r.id)}`}
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                  </details>
                  {detail.deleted ? (
                    <>
                      <p>
                        来源任务已删除；保留请求核对和已有结果下载，不会重新调用模型。
                      </p>
                      {[...t.windows, ...(t.rehearsal ? [t.rehearsal] : [])]
                        .filter((w: Obj) =>
                          ["unknown_result", "interrupted"].includes(w.status),
                        )
                        .map((w: Obj) => (
                          <button
                            key={w.windowId}
                            onClick={() =>
                              void run(async () => {
                                await window.aiVideo.invoke(
                                  "realSpeech:recover",
                                  {
                                    taskId: t.taskId,
                                    taskRevision: t.taskRevision,
                                    windowId: w.windowId,
                                  },
                                );
                                setDetail(null);
                                await load();
                              })
                            }
                          >
                            恢复{w.windowId}下载（不调用模型）
                          </button>
                        ))}
                    </>
                  ) : (
                    <>
                      <button onClick={() => speechOpen(t.taskId)}>
                        进入口播工作台
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            if (
                              !window.confirm(
                                "删除工作任务记录？已生成音频保留在资产库，不删除文件。",
                              )
                            )
                              return;
                            await window.aiVideo.invoke("realSpeech:remove", {
                              taskId: t.taskId,
                              taskRevision: t.taskRevision,
                            });
                            setDetail(null);
                            await load();
                          })
                        }
                      >
                        删除任务记录（保留音频）
                      </button>
                    </>
                  )}
                </section>
              ))}
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
