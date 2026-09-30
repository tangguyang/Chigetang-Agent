import { useEffect, useState } from "react";
import type { Asset, Page } from "../../shared/types.ts";
import { api, media, run, time, useApp } from "../store.ts";
import { Modal, SearchBox, Pagination } from "./common.tsx";
export function AudioPicker({
  onPick,
  onClose,
}: {
  onPick: (a: Asset[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("recent"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<Page<Asset>>({ items: [], total: 0 });
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () =>
        void run(async () => {
          const r = await api<Page<Asset>>("assets.list", {
            kind: "audio",
            search,
            favorite: tab === "favorite",
            generated: tab === "recent",
            page,
          });
          if (alive) setData(r);
        }),
      180,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tab, search, page]);
  return (
    <Modal title="选择参考音频" onClose={onClose} wide>
      <div className="tabs">
        {[
          ["recent", "最近生成"],
          ["all", "全部音频"],
          ["favorite", "收藏音频"],
        ].map(([k, v]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => {
              setTab(k);
              setPage(1);
            }}
          >
            {v}
          </button>
        ))}
        <button
          onClick={() =>
            void run(async () => {
              await useApp.getState().flushDraft();
              onClose();
              useApp.getState().setPage("生成音频");
            })
          }
        >
          ＋ 生成新配音
        </button>
        <button
          onClick={() =>
            void run(async () => {
              await api("assets.import", { kind: "audio", copy: false });
              setTab("all");
              setData(await api("assets.list", { kind: "audio", page: 1 }));
              setPage(1);
            })
          }
        >
          导入音频
        </button>
      </div>
      <SearchBox
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
      />
      {data.items.map((a) => (
        <article key={a.id} className="audio-picker-row">
          <div>
            <strong>♫ {a.name}</strong>
            <small>
              {a.duration?.toFixed(1) || "—"} 秒 ·{" "}
              {a.metadata?.voice || "上传音频"} · {time(a.createdAt)}
            </small>
          </div>
          <audio controls preload="none" src={media("asset", a.id)} />
          <button
            disabled={a.missing}
            className="primary"
            onClick={() => onPick([a])}
          >
            选择
          </button>
        </article>
      ))}
      {!data.total && <p>暂无音频，可以导入或生成新配音。</p>}
      <Pagination page={page} total={data.total} onChange={setPage} />
    </Modal>
  );
}
