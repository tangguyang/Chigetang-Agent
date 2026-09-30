import { useEffect, useState } from "react";
import type { Asset, Page } from "../../shared/types.ts";
import { AssetPreview } from "../pages/Assets.tsx";
import { api, run } from "../store.ts";
import { Empty, Modal, Pagination, SearchBox } from "./common.tsx";
export function AssetPicker({
  onClose,
  onPick,
  allowed = ["image", "video", "audio"],
}: {
  onClose: () => void;
  onPick: (a: Asset[]) => void;
  allowed?: string[];
}) {
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState(""),
    [sort, setSort] = useState<"recent" | "created">("recent"),
    [page, setPage] = useState(1),
    [data, setData] = useState<Page<Asset>>({ items: [], total: 0 }),
    [selected, setSelected] = useState<Asset[]>([]),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    run(async () => {
      setBusy(true);
      try {
        setData(
          await api<Page<Asset>>("assets.list", {
            search,
            kind: kind || (allowed.length === 1 ? allowed[0] : ""),
            sort,
            page,
          }),
        );
      } finally {
        setBusy(false);
      }
    });
  useEffect(() => {
    void refresh();
  }, [search, kind, sort, page]);
  return (
    <Modal title="从资产库选择" onClose={onClose} wide>
      <div className="filters">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="搜索文件名 / 标签"
        />
        <select
          aria-label="选择器素材类型"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部支持类型</option>
          {allowed.map((k) => (
            <option key={k} value={k}>
              {k === "image" ? "图片" : k === "video" ? "视频" : "音频"}
            </option>
          ))}
        </select>
        <select
          aria-label="素材排序"
          value={sort}
          onChange={(e) => setSort(e.target.value as "recent" | "created")}
        >
          <option value="recent">最近使用</option>
          <option value="created">最近导入</option>
        </select>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const rows = await api<{ asset: Asset }[]>("assets.import", { copy: false });
              setSelected(rows.map((row) => row.asset));
              await refresh();
            })
          }
        >
          上传素材
        </button>
      </div>
      {busy ? (
        <p>正在读取素材…</p>
      ) : !data.total ? (
        <Empty
          title="资产库还没有素材"
          description="导入一次，以后可直接复用。"
        />
      ) : (
        <div className="asset-picker-grid">
          {data.items
            .filter((a) => allowed.includes(a.kind))
            .map((a) => (
              <button
                key={a.id}
                disabled={a.missing}
                aria-pressed={selected.some((s) => s.id === a.id)}
                className={`asset-pick ${selected.some((s) => s.id === a.id) ? "selected" : ""}`}
                onClick={() =>
                  setSelected((list) =>
                    list.some((s) => s.id === a.id)
                      ? list.filter((s) => s.id !== a.id)
                      : [...list, a],
                  )
                }
              >
                <div className="asset-pick-image">
                  <AssetPreview asset={a} />
                  <span className="selection-check">
                    {selected.some((s) => s.id === a.id) ? "✓" : "○"}
                  </span>
                </div>
                <strong>{a.name}</strong>
                <small>
                  {a.kind === "image"
                    ? "图片"
                    : a.kind === "video"
                      ? "视频"
                      : "音频"}{" "}
                  · {a.width ? `${a.width} × ${a.height}` : "—"}
                  {a.duration ? ` · ${a.duration.toFixed(1)} 秒` : ""}
                </small>
                <small>{(a.size / 1024 / 1024).toFixed(2)} MB</small>
              </button>
            ))}
        </div>
      )}
      <Pagination page={page} total={data.total} onChange={setPage} />
      <div className="actions">
        <span>已选 {selected.length} 项</span>
        <button onClick={() => setSelected([])}>取消选择</button>
        <button
          className="primary"
          disabled={!selected.length}
          onClick={() => onPick(selected)}
        >
          添加选中素材
        </button>
      </div>
    </Modal>
  );
}
