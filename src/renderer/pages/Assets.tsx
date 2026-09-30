import { usageRoles } from "../../shared/mentions.ts";
import { FileText, Heart, Music, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { Asset, Page, AssetFolder } from "../../shared/types.ts";
import {
  Empty,
  Field,
  Modal,
  Pagination,
  SearchBox,
} from "../components/common.tsx";
import { VideoThumbnail } from "../components/VideoThumbnail.tsx";
import { api, media, run, time, useApp } from "../store.ts";
export function AssetPreview({
  asset,
  controls = false,
}: {
  asset: Asset;
  controls?: boolean;
}) {
  if (asset.missing) return <div className="missing">原始资产不可用</div>;
  if (asset.kind === "image")
    return (
      <img src={media("thumb", asset.id)} alt={asset.name} loading="lazy" />
    );
  if (asset.kind === "audio")
    return controls ? (
      <audio controls src={media("asset", asset.id)} />
    ) : (
      <Music size={28} />
    );
  return controls ? (
    <video controls loop src={media("asset", asset.id)} />
  ) : (
    <VideoThumbnail asset={asset} />
  );
}
export function AssetsPage({
  picker,
  onPick,
}: {
  picker?: boolean;
  onPick?: (a: Asset) => void;
}) {
  const { boot, message, assetKind, setAssetKind } = useApp();
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [folderEdit, setFolderEdit] = useState<Partial<AssetFolder> | null>(
    null,
  );
  const loadFolders = async () =>
    setFolders(await api<AssetFolder[]>("folders.list"));
  useEffect(() => {
    void run(loadFolders);
  }, []);
  const folderLabel = (f: AssetFolder): string => {
    const names = [f.name];
    let parent = f.parentId;
    const seen = new Set([f.id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const p = folders.find((x) => x.id === parent);
      if (!p) break;
      names.unshift(p.name);
      parent = p.parentId;
    }
    return names.join(" / ");
  };
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState(assetKind === "hidden" ? "" : assetKind),
    [project, setProject] = useState(""),
    [favorite, setFavorite] = useState(false),
    [folder, setFolder] = useState(""),
    [from, setFrom] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<Page<Asset>>({ items: [], total: 0 }),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<Asset | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    setKind(assetKind === "hidden" ? "" : assetKind);
    setPage(1);
  }, [assetKind]);
  const hidden = assetKind === "hidden";
  const query = {
    search,
    kind,
    projectId: undefined,
    favorite,
    folder,
    from: from || undefined,
    page,
    hidden,
  };
  const refresh = () =>
    run(async () => setData(await api<Page<Asset>>("assets.list", query)));
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 180);
    return () => clearTimeout(timer);
  }, [search, kind, project, favorite, folder, from, page]);
  useEffect(
    () =>
      window.aiVideo.onChange(() => {
        void refresh();
      }),
    [search, kind, project, favorite, folder, from, page],
  );
  async function importFiles(paths?: string[]) {
    setBusy(true);
    try {
      const r = await api<{ asset: Asset; duplicate: boolean }[]>(
        "assets.import",
        { paths, copy: false, folder, projectId: project || null },
      );
      message(
        `已导入 ${r.filter((x) => !x.duplicate).length} 份资产${r.some((x) => x.duplicate) ? "，重复内容已引用现有资产" : ""}`,
      );
      await refresh();
    } catch (e) {
      message(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="list-page"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const paths = [...e.dataTransfer.files].map((f) =>
          window.aiVideo.filePath(f),
        );
        if (paths.length) void importFiles(paths);
      }}
    >
      <div className="list-scroll">
        {!picker && (
          <>
            <div className="page-title">
              <div>
                <h1>资产库</h1>
                <p>让产品、人物与品牌素材，成为可以反复使用的资产。</p>
              </div>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api<{
                        available: number;
                        missing: number;
                      }>("assets.refresh");
                      message(
                        `刷新完成：${result.available} 个可用，${result.missing} 个路径失效`,
                      );
                      await refresh();
                    })
                  }
                >
                  <RefreshCw size={17} /> 刷新
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void importFiles()}
                >
                  <Upload size={17} /> 上传素材
                </button>
              </div>
            </div>
            <div
              className="asset-kind-tabs"
              role="tablist"
              aria-label="资产类型"
            >
              {[
                ["image", "图片"],
                ["video", "视频"],
                ["audio", "音频"],
                ["prompt", "Prompt"],
                ["hidden", "隐藏资产"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={kind === value}
                  className={assetKind === value ? "selected" : ""}
                  onClick={() => setAssetKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="filters">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="搜索名称、标签"
          />
          {picker && (
            <select
              aria-label="资产类型"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部类型</option>
              <option value="image">图片</option>
              <option value="video">视频</option>
              <option value="audio">音频</option>
            </select>
          )}

          <button
            className={favorite ? "selected" : ""}
            onClick={() => {
              setFavorite(!favorite);
              setPage(1);
            }}
          >
            <Heart size={16} />
            收藏
          </button>
          {picker && (
            <button disabled={busy} onClick={() => void importFiles()}>
              <Plus size={16} />
              导入
            </button>
          )}
        </div>
        {!picker && (
          <div className="filters secondary-filters">
            <select
              aria-label="文件夹筛选"
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部文件夹</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {folderLabel(f)}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                setFolderEdit({ name: "", parentId: folder || null })
              }
            >
              ＋ 新建文件夹
            </button>
            <button
              disabled={!folder}
              onClick={() =>
                setFolderEdit(folders.find((f) => f.id === folder) ?? null)
              }
            >
              重命名 / 层级
            </button>
            <button
              disabled={!folder}
              onClick={() =>
                void run(async () => {
                  await api("folders.remove", { id: folder });
                  setFolder("");
                  await loadFolders();
                  await refresh();
                })
              }
            >
              删除文件夹
            </button>
            <input
              type="date"
              aria-label="导入起始日期"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
            <small>仅记录原文件路径，不复制、不移动、不删除原始素材</small>
          </div>
        )}
        {!picker && data.total > 0 && (
          <div className="filters secondary-filters">
            <label className="check">
              <input
                type="checkbox"
                checked={
                  data.items.length > 0 &&
                  data.items.every((asset) => selected.includes(asset.id))
                }
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...new Set([...selected, ...data.items.map((a) => a.id)])]
                      : selected.filter(
                          (id) => !data.items.some((asset) => asset.id === id),
                        ),
                  )
                }
              />
              全选本页
            </label>
            <button
              className="danger"
              disabled={!selected.length}
              onClick={() =>
                void run(async () => {
                  await api("assets.removeMany", { ids: selected });
                  setSelected([]);
                  await refresh();
                })
              }
            >
              <Trash2 size={16} /> 批量移除记录（{selected.length}）
            </button>
          </div>
        )}
        {!data.total ? (
          <Empty
            title={hidden ? "没有隐藏资产" : "拖入你的第一份资产"}
            description={hidden ? "路径恢复或重新定位成功后，素材会自动回到原分类。" : "产品图、人物肖像、参考视频、音乐，都可以从这里开始。"}
            action={
              !hidden && <button disabled={busy} onClick={() => void importFiles()}>
                选择文件
              </button>
            }
          />
        ) : (
          <div className="asset-grid">
            {data.items.map((a) => (
              <article
                className={`asset-card ${a.missing ? "path-missing" : ""}`}
                key={a.id}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData("application/x-ai-asset", a.id)
                }
              >
                {!picker && (
                  <label className="asset-select check">
                    <input
                      type="checkbox"
                      checked={selected.includes(a.id)}
                      onChange={(event) =>
                        setSelected((ids) =>
                          event.target.checked
                            ? [...new Set([...ids, a.id])]
                            : ids.filter((id) => id !== a.id),
                        )
                      }
                    />
                    选择
                  </label>
                )}
                <button
                  className="asset-visual"
                  onClick={() => (picker ? onPick?.(a) : setDetail(a))}
                >
                  <AssetPreview asset={a} />
                </button>
                <div className="asset-info">
                  <strong title={a.name}>{a.name}</strong><button className="file-shortcut" title={a.missing ? "原文件缺失，请重新定位" : "打开原文件"} aria-label="打开原文件" disabled={a.missing} onClick={()=>void run(()=>api("open",{assetId:a.id}))}><FileText size={18}/></button>
                  <button
                    title="收藏"
                    className={a.favorite ? "accent" : ""}
                    onClick={() =>
                      void run(async () => {
                        await api("assets.save", {
                          id: a.id,
                          favorite: !a.favorite,
                        });
                        await refresh();
                      })
                    }
                  >
                    <Heart
                      size={15}
                      fill={a.favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <small>
                    {a.width ? `${a.width} × ${a.height}` : a.kind}{" "}
                    {a.duration ? ` · ${a.duration.toFixed(1)}s` : ""} ·{" "}
                    {(a.size / 1024 / 1024).toFixed(1)} MB
                  </small>
                  {a.missing && (
                    <small className="danger">原始文件不可用 · 已自动隐藏 · 可重新定位</small>
                  )}
                  <small>
                    {[
                      a.defaultUsage,
                      a.tags.join(" · ") ||
                        folders.find((f) => f.id === a.folder)?.name,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "未分类"}{" "}
                    · {time(a.createdAt)}
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <Pagination page={page} total={data.total} onChange={setPage} />
      {folderEdit && (
        <Modal
          title={folderEdit.id ? "编辑文件夹" : "新建文件夹"}
          onClose={() => setFolderEdit(null)}
        >
          <Field label="名称">
            <input
              value={folderEdit.name || ""}
              onChange={(e) =>
                setFolderEdit({ ...folderEdit, name: e.target.value })
              }
            />
          </Field>
          <Field label="上级目录">
            <select
              value={folderEdit.parentId || ""}
              onChange={(e) =>
                setFolderEdit({
                  ...folderEdit,
                  parentId: e.target.value || null,
                })
              }
            >
              <option value="">根目录</option>
              {folders
                .filter((f) => f.id !== folderEdit.id)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderLabel(f)}
                  </option>
                ))}
            </select>
          </Field>
          <button
            className="primary"
            onClick={() =>
              void run(async () => {
                await api("folders.save", folderEdit);
                setFolderEdit(null);
                await loadFolders();
              })
            }
          >
            保存
          </button>
        </Modal>
      )}
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <div
            className="large-preview"
            onClick={
              detail.kind === "image" ? () => setDetail(null) : undefined
            }
            title="点击预览关闭"
          >
            <AssetPreview asset={detail} controls />
          </div>
          <div className="form-grid">
            <Field label="默认素材用途">
              <select
                value={detail.defaultUsage || "其他"}
                onChange={(e) =>
                  setDetail({ ...detail, defaultUsage: e.target.value })
                }
              >
                {usageRoles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="名称">
              <input
                value={detail.name}
                onChange={(e) => setDetail({ ...detail, name: e.target.value })}
              />
            </Field>
            <Field label="移动至逻辑文件夹">
              <select
                value={detail.folder}
                onChange={(e) =>
                  setDetail({ ...detail, folder: e.target.value })
                }
              >
                <option value="">根目录</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderLabel(f)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="标签（逗号分隔）">
              <input
                value={detail.tags.join(",")}
                onChange={(e) =>
                  setDetail({
                    ...detail,
                    tags: e.target.value.split(/[,，]/).filter(Boolean),
                  })
                }
              />
            </Field>
          </div>
          <Field
            label="官方可访问素材 URL（可选）"
            hint="仅在模型需要公网素材时使用；本地原文件仍归你所有。"
          >
            <input
              value={detail.remoteUrl ?? ""}
              onChange={(e) =>
                setDetail({ ...detail, remoteUrl: e.target.value })
              }
            />
          </Field>
          <small className="path">
            {detail.managedPath || detail.originalPath}
          </small>
          <p className="muted">
            导入于 {time(detail.createdAt)} · {detail.fps?.toFixed(2) ?? "—"}{" "}
            FPS · 最近使用{" "}
            {detail.lastUsedAt ? time(detail.lastUsedAt) : "尚未使用"}
          </p>
          <div className="actions">
            <button
              className="primary"
              onClick={() =>
                void run(async () => {
                  await api("assets.save", detail);
                  setDetail(null);
                  await refresh();
                }, "资产信息已保存")
              }
            >
              保存
            </button>
            <button
              onClick={() =>
                onPick
                  ? onPick(detail)
                  : void run(async () => {
                      const state = useApp.getState();
                      if (state.draft) {
                        state.setDraft({
                          ...state.draft,
                          assets: [
                            ...state.draft.assets,
                            {
                              assetId: detail.id,
                              role:
                                detail.kind === "image"
                                  ? "reference_image"
                                  : detail.kind === "video"
                                    ? "reference_video"
                                    : "reference_audio",
                            },
                          ],
                        });
                        state.setPage("生成视频");
                        setDetail(null);
                      }
                    })
              }
            >
              用于当前任务
            </button>
            <button
              onClick={() =>
                void run(() => api("open", { assetId: detail.id }))
              }
            >
              打开原文件
            </button>
            <button
              onClick={() =>
                void run(() =>
                  api("open", { assetId: detail.id, folder: true }),
                )
              }
            >
              打开目录
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  await api("assets.relocate", { id: detail.id });
                  await refresh();
                  setDetail(null);
                })
              }
            >
              重新定位
            </button>
            <button
              disabled={!detail.missing}
              onClick={() =>
                void run(async () => {
                  const result = await api<{
                    repaired: number;
                    failed: string[];
                  } | null>("assets.relocateFolder", { id: detail.id });
                  if (result)
                    message(
                      `已批量恢复 ${result.repaired} 条引用${result.failed.length ? `，${result.failed.length} 条无法恢复` : ""}`,
                    );
                  await refresh();
                  setDetail(null);
                })
              }
            >
              重新定位整个文件夹
            </button>
            <button
              className="danger"
              onClick={() =>
                void run(async () => {
                  await api("assets.remove", { id: detail.id });
                  setDetail(null);
                  await refresh();
                })
              }
            >
              移除记录
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
