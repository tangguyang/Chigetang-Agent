import { ArrowUpRight, Copy, Heart, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { replacePromptFromTemplate } from "../../shared/draftCompatibility.ts";
import type { Page, Prompt } from "../../shared/types.ts";
import {
  Empty,
  Field,
  Modal,
  Pagination,
  SearchBox,
} from "../components/common.tsx";
import { api, run, time, useApp } from "../store.ts";
export function PromptsPage() {
  const { boot, draft, setDraft, setPage, setAssetKind } = useApp();
  const [search, setSearch] = useState(""),
    [folder, setFolder] = useState(""),
    [favorite, setFavorite] = useState(false),
    [page, setPagination] = useState(1),
    [data, setData] = useState<Page<Prompt>>({ items: [], total: 0 }),
    [edit, setEdit] = useState<Partial<Prompt> | null>(null),
    [versions, setVersions] = useState<
      { version: number; content: string; created_at: string }[]
    >([]);
  const refresh = () =>
    run(async () =>
      setData(
        await api<Page<Prompt>>("prompts.list", {
          search,
          folder,
          favorite,
          page,
        }),
      ),
    );
  useEffect(() => {
    void refresh();
  }, [search, folder, favorite, page]);
  const usePrompt = (p: Prompt) => {
    if (draft) {
      setDraft(replacePromptFromTemplate(draft, p.content));
      setPage("生成视频");
      void api("prompts.save", { ...p });
    }
  };
  return (
    <section className="list-page">
      <div className="list-scroll">
        <div className="page-title">
          <div>
            <h1>资产库 · 脚本／Prompt</h1>
            <p>沉淀有效表达，让下次创作更快开始。</p>
          </div>
          <button
            className="primary"
            onClick={() => {
              setEdit({
                name: "",
                content: "",
                folder: "",
                tags: [],
                favorite: false,
              });
              setVersions([]);
            }}
          >
            <Plus size={17} />
            新建模板
          </button>
        </div>
        <div className="asset-kind-tabs" role="tablist" aria-label="资产类型">
          {[["image", "图片"], ["video", "视频"], ["audio", "音频"], ["prompt", "Prompt"], ["hidden", "隐藏资产"]].map(([value, label]) => (
            <button key={value} role="tab" aria-selected={value === "prompt"} className={value === "prompt" ? "selected" : ""} onClick={() => setAssetKind(value)}>{label}</button>
          ))}
        </div>
        <div className="filters">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPagination(1);
            }}
            placeholder="搜索名称、标签或内容"
          />
          <input
            placeholder="按文件夹筛选"
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value);
              setPagination(1);
            }}
          />
          <button
            className={favorite ? "selected" : ""}
            onClick={() => {
              setFavorite(!favorite);
              setPagination(1);
            }}
          >
            <Heart size={16} />
            收藏
          </button>
        </div>
        {!data.total ? (
          <Empty
            title="保存你的第一个 Prompt"
            description="长文案、产品替换、商品展示… 把有效的表达留下来。"
          />
        ) : (
          <div className="prompt-grid">
            {data.items.map((p) => (
              <article className="prompt-card" key={p.id}>
                <div>
                  <span className="pill">{p.folder || "未分类"}</span>
                  <button
                    className={p.favorite ? "accent" : ""}
                    onClick={() =>
                      void run(async () => {
                        await api("prompts.save", {
                          ...p,
                          favorite: !p.favorite,
                        });
                        await refresh();
                      })
                    }
                  >
                    <Heart size={16} />
                  </button>
                </div>
                <h3>{p.name}</h3>
                <p>{p.content}</p>
                <small>
                  {p.tags.join(" · ")} · V{p.version}
                </small>
                <footer>
                  <button onClick={() => usePrompt(p)}>
                    用于生成 <ArrowUpRight size={15} />
                  </button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        setEdit(p);
                        setVersions(
                          await api("prompts.versions", { id: p.id }),
                        );
                      })
                    }
                  >
                    编辑
                  </button>
                  <button
                    title="复制"
                    onClick={() =>
                      void run(
                        () => navigator.clipboard.writeText(p.content),
                        "已复制",
                      )
                    }
                  >
                    <Copy size={16} />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
      <Pagination page={page} total={data.total} onChange={setPagination} />
      {edit && (
        <Modal
          title={edit.id ? "编辑模板" : "新建模板"}
          wide
          onClose={() => setEdit(null)}
        >
          <div className="form-grid">
            <Field label="名称">
              <input
                value={edit.name ?? ""}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </Field>
            <Field label="文件夹">
              <input
                value={edit.folder ?? ""}
                onChange={(e) => setEdit({ ...edit, folder: e.target.value })}
              />
            </Field>
            <Field label="标签">
              <input
                value={edit.tags?.join(",") ?? ""}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    tags: e.target.value.split(/[,，]/).filter(Boolean),
                  })
                }
              />
            </Field>
          </div>
          <textarea
            className="template-editor"
            value={edit.content ?? ""}
            onChange={(e) => setEdit({ ...edit, content: e.target.value })}
          />
          <div className="actions">
            <button
              className="primary"
              onClick={() =>
                void run(async () => {
                  await api("prompts.save", edit);
                  setEdit(null);
                  await refresh();
                }, "模板新版本已保存")
              }
            >
              保存新版本
            </button>
            <button
              onClick={() =>
                void run(
                  () => navigator.clipboard.writeText(edit.content ?? ""),
                  "已复制",
                )
              }
            >
              复制
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.favorite ?? false}
                onChange={(e) =>
                  setEdit({ ...edit, favorite: e.target.checked })
                }
              />
              收藏
            </label>
          </div>
          {versions.length > 0 && (
            <>
              <h3>版本历史</h3>
              <div className="version-list">
                {versions.map((v) => (
                  <button
                    key={v.version}
                    onClick={() => setEdit({ ...edit, content: v.content })}
                  >
                    V{v.version}
                    <small>{time(v.created_at)}</small>
                  </button>
                ))}
              </div>
              <small>载入历史内容后，保存会创建新版本，原版本继续保留。</small>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
