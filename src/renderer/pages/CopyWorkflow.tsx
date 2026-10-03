import { useEffect, useState } from "react";
import { api, run, time, useApp } from "../store.ts";
import type {
  CopyWorkflow,
  CoreAsset,
  ProductionTask,
} from "../../shared/production.ts";
import type { Draft } from "../../shared/types.ts";
export function CopyWorkflowPage() {
  const app = useApp(),
    [list, setList] = useState<CopyWorkflow[]>([]),
    [selected, setSelected] = useState<any>(null),
    [name, setName] = useState("复制生产批次"),
    [count, setCount] = useState(5),
    [source, setSource] = useState(""),
    [history, setHistory] = useState<ProductionTask[]>([]),
    [core, setCore] = useState<CoreAsset[]>([]),
    [person, setPerson] = useState(""),
    [product, setProduct] = useState(""),
    [json, setJson] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [edit, setEdit] = useState("");
  const refresh = async () => setList(await api("copy.list"));
  useEffect(() => {
    void run(async () => {
      await refresh();
      setCore(await api("core-assets.list"));
      const result = await api<{ items: ProductionTask[] }>("production.list", {
        includeDeleted: true,
        pageSize: 100,
      });
      setHistory(
        result.items.filter(
          (t) =>
            t.system === "task" &&
            t.draft &&
            t.outputs.some((o) => o.kind === "video"),
        ),
      );
    });
    const stop = window.aiVideo.onChange(() => void refresh());
    return stop;
  }, []);
  useEffect(() => {
    if (!selected?.id) return;
    const timer = setInterval(() => {
      void api("copy.get", { id: selected.id })
        .then(setSelected)
        .catch((e) => setError(String(e)));
    }, 3000);
    return () => clearInterval(timer);
  }, [selected?.id]);
  const act = (fn: () => Promise<any>) =>
    void run(async () => {
      setBusy(true);
      setError("");
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    });
  return (
    <section className="list-page">
      <div className="list-scroll">
        <div className="page-title">
          <div>
            <h1>一键复制</h1>
            <p>复用已准备好的方案与核心素材，批量生产同类视频。</p>
          </div>
          <button
            onClick={() => {
              if (selected)
                sessionStorage.setItem("production-workflow", selected.id);
              else sessionStorage.removeItem("production-workflow");
              app.setPage("生成任务");
            }}
          >
            查看生产结果
          </button>
        </div>
        <div className="copy-layout">
          <div className="panel">
            <h2>准备生产方案</h2>
            <label>
              批次名称
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              复制数量
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <label>
              历史视频方案
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">使用当前视频方案或粘贴完整方案</option>
                {history.map((t) => (
                  <option key={t.id} value={t.recordId}>
                    {t.name} · {t.model}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                setSource("");
                setJson(JSON.stringify(app.draft, null, 2));
              }}
            >
              使用当前视频工作台方案
            </button>
            <label>
              人物素材
              <select
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">保留方案原素材</option>
                {core
                  .filter((a) => a.type === "person")
                  .map((a) => (
                    <option key={a.alias}>{a.alias}</option>
                  ))}
              </select>
            </label>
            <label>
              产品素材
              <select
                value={product}
                onChange={(e) => setProduct(e.target.value)}
              >
                <option value="">保留方案原素材</option>
                {core
                  .filter((a) => a.type === "product")
                  .map((a) => (
                    <option key={a.alias}>{a.alias}</option>
                  ))}
              </select>
            </label>
            {!core.length && (
              <p>
                尚未登记长期核心素材。可在上传素材详情中明确指定，或由 Codex
                调用核心素材登记能力。
              </p>
            )}
            <details open={!source}>
              <summary>完整 Draft 方案（Codex 可提供）</summary>
              <textarea
                aria-label="复制生产方案"
                className="production-params"
                rows={12}
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder="保留完整 prompt、params、assets、modelId；语义分析由 Codex 完成"
              />
            </details>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const draft = source
                    ? undefined
                    : json.trim()
                      ? (JSON.parse(json) as Draft)
                      : app.draft!;
                  const w = await api<CopyWorkflow>("copy.create", {
                    requestId: crypto.randomUUID(),
                    name,
                    count,
                    ...(source ? { sourceTaskId: source } : { draft }),
                    bindings: [
                      ...(person
                        ? [{ alias: person, role: "reference_image" }]
                        : []),
                      ...(product
                        ? [{ alias: product, role: "reference_image" }]
                        : []),
                    ],
                  });
                  setSelected(w);
                })
              }
            >
              建立批次
            </button>
          </div>
          <div className="panel">
            <h2>批次追踪与人工接管</h2>
            <select
              aria-label="复制批次"
              value={selected?.id || ""}
              onChange={(e) =>
                act(async () =>
                  setSelected(await api("copy.get", { id: e.target.value })),
                )
              }
            >
              <option value="">选择批次</option>
              {list.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.driver} · {w.state}
                </option>
              ))}
            </select>
            {selected && (
              <>
                <p>
                  {selected.name} · {selected.driver} ·{" "}
                  {time(selected.createdAt)}
                </p>
                <p>
                  {selected.drafts.length} 个方案 · {selected.state}
                </p>
                {selected.queuePaused && selected.state === "submitted" && (
                  <p>
                    生成队列已暂停。可在视频工作台恢复队列，任务与方案已保存。
                  </p>
                )}
                <div className="actions">
                  <button
                    disabled={busy || selected.state !== "prepared"}
                    onClick={() =>
                      act(async () =>
                        setSelected(
                          await api("copy.preflight", { id: selected.id }),
                        ),
                      )
                    }
                  >
                    1. 预检
                  </button>
                  <button
                    disabled={
                      busy ||
                      !selected.fingerprint ||
                      selected.issues?.length ||
                      selected.state !== "prepared"
                    }
                    onClick={() =>
                      act(async () =>
                        setSelected(
                          await api("copy.confirm", {
                            id: selected.id,
                            revision: selected.revision,
                          }),
                        ),
                      )
                    }
                  >
                    2. 确认方案
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !selected.confirmed ||
                      selected.state !== "prepared"
                    }
                    onClick={() =>
                      act(async () => {
                        const w = await api("copy.submit", { id: selected.id });
                        if (w)
                          setSelected(
                            await api("copy.get", { id: selected.id }),
                          );
                      })
                    }
                  >
                    3. 正式生成（收费）
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () =>
                        setSelected(await api("copy.get", { id: selected.id })),
                      )
                    }
                  >
                    刷新状态
                  </button>
                </div>
                {selected.issues?.map((x: string) => (
                  <p key={x} role="alert">
                    {x}
                  </p>
                ))}
                {selected.error && <p role="alert">{selected.error}</p>}
                <details>
                  <summary>检查 / 调整全部方案与参数</summary>
                  <pre className="production-params">
                    {JSON.stringify(selected.drafts, null, 2)}
                  </pre>
                  {selected.state === "prepared" && (
                    <>
                      <button
                        onClick={() =>
                          setEdit(JSON.stringify(selected.drafts, null, 2))
                        }
                      >
                        编辑方案
                      </button>
                      <textarea
                        aria-label="调整复制批次"
                        rows={10}
                        className="production-params"
                        value={edit}
                        onChange={(e) => setEdit(e.target.value)}
                      />
                      <button
                        disabled={busy || !edit.trim()}
                        onClick={() =>
                          act(async () => {
                            setSelected(
                              await api("copy.update", {
                                id: selected.id,
                                revision: selected.revision,
                                drafts: JSON.parse(edit),
                              }),
                            );
                            setEdit("");
                          })
                        }
                      >
                        保存调整并重新预检
                      </button>
                    </>
                  )}
                </details>
                {selected.tasks?.map((t: any) => (
                  <div key={t.id}>
                    <p>
                      {t.name} · {t.status}
                    </p>
                    <button onClick={() => app.setTask(t.id)}>接管任务</button>
                    <button
                      disabled={!t.outputPath}
                      onClick={() =>
                        void run(() =>
                          api("production.open", { id: "task:" + t.id }),
                        )
                      }
                    >
                      打开结果
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
