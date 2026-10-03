import { useEffect, useRef, useState } from "react";
import { api, run, time, labels, useApp, media } from "../store.ts";
import { Modal } from "../components/common.tsx";
import type { ProductionTask } from "../../shared/production.ts";
import type { Draft } from "../../shared/types.ts";
export function ProductionPage() {
  const [workflowId, setWorkflowId] = useState(
    () => sessionStorage.getItem("production-workflow") || "",
  );
  const state = useApp(),
    [search, setSearch] = useState(""),
    [favorite, setFavorite] = useState(false),
    [feature, setFeature] = useState(""),
    [driver, setDriver] = useState(""),
    [includeDeleted, setDeleted] = useState(false),
    [page, setPage] = useState(1),
    [status, setStatus] = useState("");
  const [data, setData] = useState<{ items: ProductionTask[]; total: number }>({
      items: [],
      total: 0,
    }),
    [detail, setDetail] = useState<ProductionTask | null>(null),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const load = async () => {
    const n = ++seq.current;
    try {
      const next = await api<typeof data>("production.list", {
        search,
        workflowId,
        favorite,
        feature,
        driver,
        includeDeleted,
        page,
        status,
      });
      if (n === seq.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (n === seq.current) setError(String(e));
    }
  };
  useEffect(() => {
    const timer = setTimeout(() => void load(), 150),
      stop = window.aiVideo.onChange(() => void load()),
      poll = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      stop();
    };
  }, [
    search,
    workflowId,
    favorite,
    feature,
    driver,
    includeDeleted,
    page,
    status,
  ]);
  const openDetail = (r: ProductionTask) => {
    setDetail(r);
    setNote(r.note);
  };
  const reuse = (r: ProductionTask) =>
    void run(async () => {
      const draft = await api<Draft>("production.reuse", { id: r.id });
      state.setDraft(draft);
      state.setPage("生成视频");
    });
  const preview = (r: ProductionTask) => {
    const out = r.outputs[0];
    if (!out) return <span>{labels[r.status] || r.status}</span>;
    const src = out.assetId
      ? media("asset", out.assetId)
      : out.taskId
        ? media("output", out.taskId)
        : `aivideo://local/production/${encodeURIComponent(r.id)}`;
    return out.kind === "audio" ? (
      <audio controls preload="none" src={src} />
    ) : out.kind === "image" ? (
      <img src={src} alt={r.name} />
    ) : (
      <video controls preload="metadata" src={src} />
    );
  };
  return (
    <section className="list-page">
      <div className="list-scroll">
        <div className="page-title">
          <div>
            <h1>生成任务</h1>
            <p>GUI 与 Codex 的生产记录、结果、备注和收藏。</p>
          </div>
          <button
            aria-pressed={favorite}
            className={favorite ? "primary" : ""}
            onClick={() => {
              setFavorite(!favorite);
              setPage(1);
            }}
          >
            ★ {favorite ? "只看收藏" : "收藏任务"}
          </button>
        </div>
        {workflowId && (
          <p>
            正在查看批次 {workflowId}{" "}
            <button
              onClick={() => {
                setWorkflowId("");
                sessionStorage.removeItem("production-workflow");
                setPage(1);
              }}
            >
              查看全部任务
            </button>
          </p>
        )}
        <div className="filters">
          <input
            data-search
            aria-label="搜索生成任务"
            placeholder="搜索名称、备注、模型或任务ID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="功能来源"
            value={feature}
            onChange={(e) => {
              setFeature(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部功能</option>
            {[
              "一键复刻",
              "一键复制",
              "一键生成",
              "视频生成",
              "Qwen",
              "CosyVoice",
              "音频生成",
              "真人口播",
              "真人口播 V2",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            aria-label="驾驶来源"
            value={driver}
            onChange={(e) => {
              setDriver(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部来源</option>
            {["GUI", "Codex", "历史未知"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            aria-label="任务状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            {[
              "Draft",
              "Queued",
              "Processing",
              "Completed",
              "Failed",
              "unknown_result",
              "Cancelled",
              "Paused",
            ].map((x) => (
              <option key={x} value={x}>
                {labels[x] || x}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => {
                setDeleted(e.target.checked);
                setPage(1);
              }}
            />
            包括历史已删除记录
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        <p>{data.total} 个任务</p>
        <div className="production-grid">
          {data.items.map((r) => (
            <article className="production-card" key={r.id}>
              <div className="production-preview">{preview(r)}</div>
              <div className="production-card-body">
                <div className="production-card-title">
                  <h3>{r.name}</h3>
                  <button
                    aria-label={(r.favorite ? "取消收藏" : "收藏") + r.name}
                    aria-pressed={r.favorite}
                    onClick={() =>
                      void run(async () => {
                        await api("production.update", {
                          id: r.id,
                          favorite: !r.favorite,
                        });
                        await load();
                      })
                    }
                  >
                    {r.favorite ? "★" : "☆"}
                  </button>
                </div>
                <p>
                  {r.feature} · {r.driver} · {labels[r.status] || r.status}
                  {r.deleted ? " · 历史已删除" : ""}
                </p>
                <small>
                  {time(r.createdAt)} · {r.model}
                </small>
                <p className="production-note">{r.note || "暂无备注"}</p>
                <div className="actions">
                  <button onClick={() => openDetail(r)}>
                    详情 / 参数 / 备注
                  </button>
                  <button
                    disabled={!r.outputs.length}
                    onClick={() =>
                      void run(() => api("production.open", { id: r.id }))
                    }
                  >
                    打开结果
                  </button>
                  <button
                    disabled={!r.outputs.length}
                    onClick={() =>
                      void run(() =>
                        api("production.open", { id: r.id, folder: true }),
                      )
                    }
                  >
                    所在文件夹
                  </button>
                  {r.system === "task" ? (
                    <button onClick={() => reuse(r)}>复用方案</button>
                  ) : (
                    <button
                      onClick={() =>
                        state.setPage(
                          r.system.startsWith("speech")
                            ? "真人口播"
                            : "生成音频",
                        )
                      }
                    >
                      原工作台
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
        {!data.items.length && !error && (
          <p>暂无匹配任务。调整筛选，或从核心生产功能创建任务。</p>
        )}
        <div className="actions">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span>第 {page} 页</span>
          <button
            disabled={page * 24 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      </div>
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <p>
            {detail.feature} · {detail.driver} · {detail.id}
          </p>
          <label>
            任务备注
            <textarea
              aria-label="任务备注"
              maxLength={4000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setBusy(true);
                try {
                  const next = await api<ProductionTask>("production.update", {
                    id: detail.id,
                    note,
                  });
                  setDetail(next);
                  await load();
                } finally {
                  setBusy(false);
                }
              })
            }
          >
            保存备注
          </button>
          <h3>输出文件</h3>
          {detail.outputs.map((out, i) => (
            <div key={out.path}>
              <p className="production-path">{out.path}</p>
              <button
                onClick={() =>
                  void run(() =>
                    api("production.open", { id: detail.id, index: i }),
                  )
                }
              >
                打开
              </button>
              <button
                onClick={() =>
                  void run(() =>
                    api("production.open", {
                      id: detail.id,
                      index: i,
                      folder: true,
                    }),
                  )
                }
              >
                所在文件夹
              </button>
            </div>
          ))}
          <details>
            <summary>查看完整生产参数</summary>
            <pre className="production-params">
              {JSON.stringify(detail.params, null, 2)}
            </pre>
          </details>
          {detail.system === "task" && (
            <button
              onClick={() => {
                state.setTask(detail.recordId);
                setDetail(null);
              }}
            >
              原任务详情与恢复操作
            </button>
          )}
        </Modal>
      )}
    </section>
  );
}
