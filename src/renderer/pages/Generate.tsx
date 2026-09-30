import { EngineBar } from "../components/EngineBar.tsx";
import { useWorkbenchTasks } from '../components/WorkbenchTaskSidebar.tsx';
import { WorkspaceTab } from "../components/WorkspaceTab.tsx";
import { durationOptions, validDuration } from "../../shared/duration.ts";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Film,
  FolderOpen,
  Image,
  Layers,
  Music,
  PanelRightClose,
  PanelRightOpen,
  Upload,
  Eye,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usageRoles } from "../../shared/mentions.ts";
import {
  assetCompatibilityReason,
  mergeImportedAssets,
  retainDraftAssets,
} from "../../shared/draftCompatibility.ts";
import type {
  Asset,
  AssetRole,
  Draft,
  Cost,
  Page,
  Task,
} from "../../shared/types.ts";
import { AudioPicker } from "../components/AudioPicker.tsx";
import { AssetPicker } from "../components/AssetPicker.tsx";
import { Empty, Field, Modal } from "../components/common.tsx";
import { PromptEditor } from "../components/PromptEditor.tsx";
import { RatioPicker } from "../components/RatioPicker.tsx";
import { api, labels, media, run, useApp } from "../store.ts";
import { AssetPreview } from "./Assets.tsx";
import { formatWanIssue, wanPreflight } from "../../shared/safeWanPreflight.ts";
const roleNames: Record<AssetRole, string> = {
  reference_image: "参考图片 · 产品 / 人物",
  reference_video: "参考视频",
  reference_audio: "参考音频",
  first_frame: "首帧图片",
  last_frame: "尾帧图片",
};
export function GeneratePage() {
  const { boot, draft, setDraft, setTask, message, draftSaveStatus } = useApp();
  const [picker, setPicker] = useState<AssetRole | "all" | null>(null),
    [assets, setAssets] = useState<Asset[]>([]),
    [mode, setMode] = useState("reference"),
    [busy, setBusy] = useState(false),
    [collapsed, setCollapsed] = useState(false);
  const {tasks:queue,refresh:loadQueue}=useWorkbenchTasks(12);
  const [preview, setPreview] = useState<Asset | null>(null);
  const [segmentPlan, setSegmentPlan] = useState<{
    totalSeconds: number;
    maxSeconds: number;
    calls: number;
    segments: { index: number; start: number; end: number; duration: number }[];
    cost: Cost;
  } | null>(null);
  const [quote, setQuote] = useState<{
    cost: Cost;
    accountName?: string;
    breakdown?: {
      referenceSeconds: number;
      outputSeconds: number;
      referenceAmount: number | null;
      outputAmount: number | null;
    };
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    if (draft)
      void api<{ cost: Cost; accountName?: string }>("tasks.estimate", draft)
        .then((q) => {
          if (!cancelled) setQuote(q);
        })
        .catch((e: unknown) => {
          if (!cancelled)
            setQuote({
              cost: {
                amount: null,
                currency: "CNY",
                kind: "unknown",
                note:
                  e instanceof Error
                    ? e.message
                    : "无法预估，请检查素材与价格配置",
              },
            });
        });
    return () => {
      cancelled = true;
    };
  }, [
    draft?.modelId,
    draft?.accountId,
    draft?.params,
    draft?.assets,
    boot?.models,
    boot?.accounts,
  ]);
  const currentMode = useRef(mode);
  currentMode.current = mode;
  const submitting = useRef(false);
  const lastSubmit = useRef(0);
  const model =
    boot?.models.find((m) => m.id === (draft?.modelId === "wan3" ? "wan-safe" : draft?.modelId));
  const compatibility =
    model && draft
      ? draft.assets.map((binding) => ({
          binding,
          asset: assets.find((asset) => asset.id === binding.assetId),
          reason: assetCompatibilityReason(
            assets.find((asset) => asset.id === binding.assetId),
            binding,
            model,
          ),
        }))
      : [];
  const incompatible = compatibility.filter((item) => item.reason);
  const preflight =
    model?.adapter === "wan-safe" && draft
      ? wanPreflight(
          model,
          draft,
          assets.map((asset) => ({
            ...asset,
            role: draft.assets.find((binding) => binding.assetId === asset.id)?.role,
          })),
        )
      : null;
  const preflightError = preflight?.issues.find((issue) => issue.severity === "error");
  const canAutoSegment =
    model?.adapter === "wan3" &&
    incompatible.some(
      (item) =>
        item.asset?.duration &&
        ["video", "audio"].includes(item.asset.kind) &&
        item.asset.duration >
          (model.capabilities.limits[item.asset.kind]?.maxSeconds ?? Infinity),
    );
  const mixed =
    !!draft?.assets.some((a) => a.role.endsWith("frame")) &&
    !!draft?.assets.some((a) => a.role.startsWith("reference_"));
  const blocked =
    draft && assets.length !== draft.assets.length
      ? "正在读取素材真实信息"
      : preflightError
        ? formatWanIssue(preflightError)
        : !model || !draft || !validDuration(model, draft.params, assets)
      ? "请选择时长"
      : incompatible.length
        ? canAutoSegment
          ? "长素材需使用自动分段复刻"
          : incompatible[0].reason || "当前素材与模型不兼容"
      : mixed && !model.capabilities.supportsMixedFrameReferences
        ? "当前模型不支持首尾帧与补充参考混合提交"
        : "";
  useEffect(() => {
    if (!boot || !draft || !model) return;
    const enabled = boot.accounts
      .filter((a) => a.enabled && a.providerId === model.providerId)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    const selected = enabled.find((a) => a.id === draft.accountId);
    if (draft.modelId === model.id && (selected || !enabled.length)) return;
    setDraft({
      ...draft,
      modelId: model.id,
      accountId: selected?.id ?? enabled[0]?.id ?? "auto",
      params:
        draft.modelId === model.id
          ? draft.params
          : {
              ...draft.params,
            },
    });
  }, [boot?.accounts, draft?.draftId, draft?.modelId, draft?.accountId]);
  useEffect(() => {
    let cancelled = false;
    setAssets([]);
    if (draft)
      void Promise.all(
        draft.assets.map((b) =>
          api<Asset>("assets.inspect", { id: b.assetId }).catch(async () => ({
            ...(await api<Asset>("assets.get", { id: b.assetId })),
            missing: true,
          })),
        ),
      )
        .then((loaded) => {
          if (!cancelled) setAssets(loaded);
        })
        .catch((e) => {
          if (!cancelled) message(String(e));
        });
    return () => {
      cancelled = true;
    };
  }, [draft?.assets]);
  useEffect(() => {
    if (
      draft?.assets.some(
        (a) => a.role === "first_frame" || a.role === "last_frame",
      )
    )
      setMode("frames");
    else setMode(model?.capabilities.roles.some(r=>r.startsWith("reference_"))?"reference":"frames");
  }, [draft?.modelId, draft?.draftId]);
  async function submit() {
    if (!draft || submitting.current || Date.now() - lastSubmit.current < 1200)
      return;
    if (blocked) {
      message(blocked);
      return;
    }
    lastSubmit.current = Date.now();
    submitting.current = true;
    setBusy(true);
    try {
      const t = await api<Task>("tasks.create", {
        draft,
        requestId: crypto.randomUUID(),
      });
      message(`已创建 ${t.name} · V${t.version}`);
      void api("settings.save", { lastOutputDir: draft.outputDir }).catch(
        () => undefined,
      );
      await useApp.getState().finishSubmittedDraft(draft.draftId!);
      await loadQueue();
    } catch (e) {
      message(e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function prepareSegments() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      setSegmentPlan(
        await api("tasks.segment.plan", { draft }),
      );
    } catch (error) {
      message(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function submitSegments() {
    if (!draft || !segmentPlan || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const task = await api<Task>("tasks.segment.create", {
        draft,
        requestId: crypto.randomUUID(),
      });
      message(`已创建 ${segmentPlan.calls} 段自动复刻任务`);
      setSegmentPlan(null);
      await useApp.getState().finishSubmittedDraft(draft.draftId!);
      setTask(task.id);
      await loadQueue();
    } catch (error) {
      message(error instanceof Error ? error.message : String(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (!e.defaultPrevented && e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [draft]);
  if (!boot || !draft) return null;
  if (!model) return <section><h1>生成工作台</h1><p className="notice warning">草稿模型不存在，请重新选择；原 Prompt 和素材已保留。</p><EngineBar draft={draft} onChange={setDraft}/></section>;
  const params = model.capabilities.parameters.filter(
    (p) => p.key !== "omni_reference_task_type" || mode !== "frames",
  );
  const accounts = boot.accounts.filter(
    (a) => a.providerId === model.providerId && a.enabled,
  );
  const roles = model.capabilities.roles.filter((r) =>
    mode === "frames"
      ? r === "first_frame" || r === "last_frame"
      : r.startsWith("reference_"),
  );
  const referenceRoles = model.capabilities.roles.filter((r) =>
    r.startsWith("reference_"),
  );
  function commitImport(imported: Asset[], targetRoles = roles) {
    const next =
      currentMode.current === mode
        ? mergeImportedAssets(
            draft!,
            useApp.getState().draft,
            imported,
            targetRoles,
            targetRoles.some(
              (role) => role === "first_frame" || role === "last_frame",
            ),
          )
        : null;
    if (!next) {
      message(
        "工作区或素材模式已切换，素材已保留在资产库，请在需要的工作区选择。",
      );
      return;
    }
    const added =
      next.assets.length - (useApp.getState().draft?.assets.length ?? 0);
    if (added) setDraft(next);
    message(
      added
        ? `已加入 ${added} 个素材`
        : "未加入素材：请检查素材类型、重复素材或首尾帧槽位。",
    );
  }
  async function uploadDirect() {
    const imported = await api<{ asset: Asset; duplicate?: boolean }[]>(
      "assets.import",
      {
        copy: false,
        projectId: draft?.projectId,
      },
    );
    if (imported.length)
      commitImport(
        imported.map((r) => r.asset),
        referenceRoles,
      );
  }
  async function drop(e: React.DragEvent, role: AssetRole) {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("application/x-ai-asset");
    if (id) {
      commitImport([await api<Asset>("assets.get", { id })], [role]);
      return;
    }
    const paths = [...e.dataTransfer.files].map((f) =>
      window.aiVideo.filePath(f),
    );
    const imported = await api<{ asset: Asset }[]>("assets.import", {
      paths,
      copy: false,
      projectId: draft?.projectId,
    });
    if (imported.length)
      commitImport(
        imported.map((r) => r.asset),
        [role],
      );
  }
  async function dropIntoWorkspace(e: React.DragEvent) {
    e.preventDefault();
    if (e.defaultPrevented && !e.dataTransfer.files.length) return;
    const paths = [...e.dataTransfer.files].map(f => window.aiVideo.filePath(f)).filter(Boolean);
    if (!paths.length) return;
    if (mode !== "reference") return message("请在自由参考模式下拖入文件；首尾帧请拖入对应槽位。");
    const imported = await api<{asset:Asset}[]>("assets.import", { paths, copy:false, projectId:draft?.projectId });
    if (imported.length) commitImport(imported.map(item=>item.asset), referenceRoles);
  }
  const availableDurationOptions = durationOptions(model, draft.params, assets);
  const currentDuration = Number(draft.params.duration);
  return (
    <div className={`engine-generation generation-layout ${collapsed ? "queue-collapsed" : ""}`} onDragOver={e=>e.preventDefault()} onDrop={e=>void run(()=>dropIntoWorkspace(e))}>
      <section className="generation">
        <div className="generation-scroll">
          <div className="page-title generation-title">
            <div>
              <h1>生成工作台</h1>
            </div>
            <button
              className="icon-button"
              title="任务队列"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelRightOpen /> : <PanelRightClose />}
            </button>
          </div>
          <EngineBar draft={draft} onChange={setDraft}/>
          {!accounts.length && (
            <div className="notice">
              添加一个 API 账户即可开始。
              <button onClick={() => useApp.getState().setPage("模型与 API")}>
                配置账户 <ArrowRight size={14} />
              </button>
            </div>
          )}
          {!model.enabled && <div className="notice warning">{model.note}</div>}
          <div className="workspace-tabs" aria-label="编辑工作区标签">
            {useApp
              .getState()
              .visibleDrafts()
              .map((d) => (
                <WorkspaceTab
                  key={d.id}
                  name={d.id === draft.draftId ? draft.name : d.name}
                  active={d.id === draft.draftId}
                  onOpen={() => {
                    if (d.id !== useApp.getState().draft?.draftId)
                      void run(() => useApp.getState().openDraft(d.id));
                  }}
                  onClose={() =>
                    void run(() => useApp.getState().closeWorkspace(d.id))
                  }
                  onRename={(name) =>
                    void run(async () => {
                      const current = useApp.getState().draft;
                      if (current?.draftId === d.id) {
                        setDraft({ ...current, name });
                        await useApp.getState().flushDraft();
                      } else {
                        await api("draft.rename", { id: d.id, name });
                        await useApp.getState().refreshDrafts();
                      }
                    })
                  }
                />
              ))}
            <button
              className="workspace-tab-new"
              onClick={() => void run(() => useApp.getState().newDraft())}
            >
              + 新建
            </button>
            <span className={`draft-save-state ${draftSaveStatus}`}>
              {draftSaveStatus === "saving"
                ? "保存中…"
                : draftSaveStatus === "error"
                  ? "保存失败"
                  : "已保存"}
            </span>
          </div>
          {model.adapter === "seedance" && (
            <p className="muted" style={{ fontSize: 10 }}>
              Seedance 官方建议中文 Prompt 不超过 500
              字；软件保留长文，不自动删改。
              {model.id === "seedance25"
                ? "参考视频需在资产库填写公网 URL；真人素材按方舟授权规则使用。"
                : ""}
            </p>
          )}
          <section className="materials">
            <div className="section-heading">
              <div>
                <span className="eyebrow">素材</span>
              </div>
              {model.capabilities.supportsFirstLastFrame && (
                <div className="segmented">
                  <button
                    className={mode === "reference" ? "active" : ""}
                    onClick={() => {
                      if (mode === "reference") return;
                      setMode("reference");
                      setDraft(
                        retainDraftAssets(
                          draft,
                          draft.assets.filter((a) =>
                            a.role.startsWith("reference_"),
                          ),
                        ),
                      );
                    }}
                  >
                    自由参考
                  </button>
                  <button
                    className={mode === "frames" ? "active" : ""}
                    onClick={() => {
                      if (mode === "frames") return;
                      setMode("frames");
                      setDraft({
                        ...retainDraftAssets(
                          draft,
                          draft.assets.filter((a) =>
                            a.role.endsWith("frame"),
                          ),
                        ),
                        params: Object.fromEntries(
                          Object.entries({
                            ...draft.params,
                            ratio: "adaptive",
                          }).filter(([k]) => k !== "omni_reference_task_type"),
                        ),
                      });
                    }}
                  >
                    首尾帧
                  </button>
                </div>
              )}
            </div>
            {mode === "frames" && (
              <p className="muted">
                首帧与尾帧独立绑定；下方入口添加产品、人物等补充参考。
              </p>
            )}
            {mode === "frames" &&
              !model.capabilities.supportsMixedFrameReferences && (
                <p className="notice warning">
                  当前模型接口不支持首尾帧与补充参考混合提交。可保留补充素材，但提交前须移除补充素材或切换自由参考。
                </p>
              )}
            <div className="material-actions">
              <button
                className="upload-direct-button"
                disabled={!referenceRoles.length}
                onClick={() => void run(uploadDirect)}
              >
                <Upload size={15} /> 上传素材
              </button>
              <button
                className="library-select-button"
                disabled={!referenceRoles.length}
                onClick={() => setPicker("all")}
              >
                从资产库选择
              </button>
            </div>
            <div className="upload-slots">
              {roles.map((role) => (
                <button
                  key={role}
                  className="upload-slot"
                  onClick={() => setPicker(role)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => void run(() => drop(e, role))}
                >
                  {role.includes("video") ? (
                    <Film size={22} />
                  ) : role.includes("audio") ? (
                    <Music size={22} />
                  ) : (
                    <Image size={22} />
                  )}
                  <strong>{roleNames[role]}</strong>
                  <small>拖入文件 / 点击从资产库选择</small>
                </button>
              ))}
            </div>
            {draft.assets
              .filter((b) => b.role === "reference_audio")
              .map((b) => {
                const a = assets.find((a) => a.id === b.assetId);
                return a ? (
                  <div className="audio-picker-row" key={b.assetId}>
                    <div>
                      <strong>{a.name}</strong>
                      <small>{a.duration ? (a.duration > 14 ? `原音频 ${a.duration.toFixed(2)} 秒 · 保留完整音频` : `${a.duration.toFixed(2)} 秒`) : "时长未知"}</small>
                    </div>
                    <audio controls preload="none" src={media("asset", a.id)} />
                    <button onClick={() => setPicker("reference_audio")}>
                      替换
                    </button>
                    <button
                      onClick={() =>
                        setDraft(
                          retainDraftAssets(
                            draft,
                            draft.assets.filter((x) => x !== b),
                          ),
                        )
                      }
                    >
                      移除
                    </button>
                  </div>
                ) : null;
              })}
            {!roles.length && (
              <p className="muted">
                此模式通过文字生成，或切换为首尾帧添加图片。
              </p>
            )}
            {(["frames", "references"] as const).map((group) => (
              <div key={group} className="bound-material-group">
                {draft.assets.some((b) =>
                  group === "frames"
                    ? b.role.endsWith("frame")
                    : b.role.startsWith("reference_"),
                ) && (
                  <small>
                    {group === "frames" ? "首帧 / 尾帧" : "补充参考素材"}
                  </small>
                )}
                <div className="selected-assets">
                  {draft.assets.map((b, i) => {
                    if ((group === "frames") !== b.role.endsWith("frame"))
                      return null;
                    const a = assets.find((a) => a.id === b.assetId);
                    return (
                      <div className="selected-asset" key={`${b.assetId}-${i}`}>
                        {a && (
                          <button
                            className="mini-thumb"
                            title="点击放大预览"
                            onClick={() => setPreview(a)}
                          >
                            <AssetPreview asset={a} />
                          </button>
                        )}
                        <div className="asset-info">
                          <strong title={a?.name}>
                            {b.role.includes("image")
                              ? "Image"
                              : b.role.includes("video")
                                ? "Video"
                                : b.role.includes("audio")
                                  ? "Audio"
                                  : roleNames[b.role]}
                            {
                              draft.assets
                                .slice(0, i + 1)
                                .filter((x) => x.role === b.role).length
                            }{" "}
                            · {a?.name ?? "加载中"}
                          </strong>
                          <small>
                            {a
                              ? `${(a.size / 1024 / 1024).toFixed(1)} MB · ${a.width ? `${a.width}×${a.height}` : ""}${a.duration ? (b.role === "reference_audio" && a.duration > 14 ? `原音频 ${a.duration.toFixed(2)} 秒 · 保留完整音频` : `${a.duration.toFixed(1)} 秒`) : ""}`
                              : ""}
                          </small>
                          {a && (
                            <small
                              className={
                                assetCompatibilityReason(a, b, model)
                                  ? "danger"
                                  : "success"
                              }
                            >
                              {assetCompatibilityReason(a, b, model)
                                ? `⚠ 当前模型不兼容：${assetCompatibilityReason(a, b, model)}`
                                : "✓ 当前模型兼容"}
                            </small>
                          )}
                        </div>
                        <select
                          className="asset-role"
                          aria-label="素材用途"
                          value={b.userRole || "其他"}
                          onChange={(e) => {
                            const userRole = e.target.value;
                            setDraft({
                              ...draft,
                              assets: draft.assets.map((v) =>
                                v.bindingId === b.bindingId
                                  ? { ...v, userRole }
                                  : v,
                              ),
                            });
                            void run(() =>
                              api("assets.save", {
                                id: b.assetId,
                                defaultUsage: userRole,
                              }),
                            );
                          }}
                        >
                          {usageRoles.map((r) => (
                            <option key={r}>{r}</option>
                          ))}
                        </select>
                        <button
                          title="移除"
                          onClick={() =>
                            setDraft(
                              retainDraftAssets(
                                draft,
                                draft.assets.filter((_, n) => n !== i),
                              ),
                            )
                          }
                        >
                          <X size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
          <PromptEditor
            key={draft.draftId}
            value={draft.prompt}
            assets={assets}
            bindings={draft.assets}
            mentions={draft.mentions}
            onChange={(prompt, mentions) =>
              setDraft({ ...draft, prompt, mentions })
            }
            limit={model.capabilities.promptLimit}
          />
          <section className="parameters">
            <span className="eyebrow">输出</span>
            <div className="parameter-grid">
              {params
                .filter((p) => ["duration","ratio","resolution","audio","generate_audio"].includes(p.key))
                .map((p) => (
                  <Field key={p.key} label={p.label}>
                    {p.key === "duration" ? (
                      <select
                        aria-label="时长"
                        value={Number(draft.params.duration) || 0}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            params: {
                              ...draft.params,
                              duration: Number(e.target.value),
                            },
                          })
                        }
                      >
                        <option value={0}>请选择时长</option>
                        {currentDuration !== 0 &&
                          !availableDurationOptions.includes(currentDuration) && (
                            <option value={currentDuration}>
                              当前设置 {currentDuration} 秒（需调整）
                            </option>
                          )}
                        {availableDurationOptions.map((n) => (
                          <option key={n} value={n}>
                            {n === -1 ? "智能时长" : `${n} 秒`}
                          </option>
                        ))}
                      </select>
                    ) : p.key === "ratio" ? (
                      <RatioPicker
                        value={String(draft.params.ratio ?? "9:16")}
                        options={p.options ?? []}
                        onChange={(ratio) =>
                          setDraft({
                            ...draft,
                            params: { ...draft.params, ratio },
                          })
                        }
                      />
                    ) : p.type === "select" ? (
                      <select
                        value={String(draft.params[p.key] ?? p.default)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            params: {
                              ...draft.params,
                              [p.key]: e.target.value,
                              ...(p.key === "omni_reference_task_type" &&
                              ["edit", "extend"].includes(e.target.value)
                                ? {
                                    ratio: "adaptive",
                                    ...(e.target.value === "edit"
                                      ? { duration: 0 }
                                      : {}),
                                  }
                                : {}),
                            },
                          })
                        }
                      >
                        {p.options?.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    ) : p.type === "boolean" ? (
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.params[p.key] ?? p.default)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              params: {
                                ...draft.params,
                                [p.key]: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>{draft.params[p.key] ? "开启" : "关闭"}</span>
                      </label>
                    ) : (
                      <input
                        type="number"
                        min={p.min}
                        max={p.max}
                        value={Number(draft.params[p.key] ?? p.default)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            params: {
                              ...draft.params,
                              [p.key]: Number(e.target.value),
                            },
                          })
                        }
                      />
                    )}
                  </Field>
                ))}
            </div>
            <details>
              <summary>高级参数</summary>
              <div className="parameter-grid">
                {params
                  .filter((p) => !["duration","ratio","resolution","audio","generate_audio"].includes(p.key))
                  .map((p) => (
                    <Field key={p.key} label={p.label}>
                      {p.type === "boolean" ? (
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={Boolean(draft.params[p.key] ?? p.default)}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                params: {
                                  ...draft.params,
                                  [p.key]: e.target.checked,
                                },
                              })
                            }
                          />
                          <span>{draft.params[p.key] ? "开启" : "关闭"}</span>
                        </label>
                      ) : p.type === 'select' ? <select value={String(draft.params[p.key]??p.default)} onChange={e=>setDraft({...draft,params:{...draft.params,[p.key]:e.target.value}})}>{p.options?.map(v=><option key={v}>{v}</option>)}</select> : (
                        <input
                          type="number"
                          min={p.min}
                          max={p.max}
                          value={Number(draft.params[p.key] ?? p.default)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              params: {
                                ...draft.params,
                                [p.key]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      )}
                    </Field>
                  ))}
              </div>
            </details>
            {preflight && (
              <div className={`preflight ${preflight.ok ? "valid" : "invalid"}`}>
                <div>
                  <strong>{preflight.ok ? "参数预检查通过" : "参数预检查未通过"}</strong>
                  <span>
                    参考视频 {preflight.videoSeconds.toFixed(2)} 秒 · 参考音频 {preflight.audioSeconds.toFixed(2)} 秒 · 输出 {preflight.smartDuration ? "智能时长" : `${preflight.outputSeconds || "未选择"} 秒`}
                  </span>
                </div>
                {preflight.issues.slice(0, 3).map((issue) => (
                  <p key={`${issue.code}-${issue.assetId ?? "all"}`} className={issue.severity}>
                    {formatWanIssue(issue)}
                  </p>
                ))}
              </div>
            )}
            <div className="output-folder">
              <FolderOpen size={18} />
              <span title={draft.outputDir}>{draft.outputDir}</span>
              <button
                onClick={() =>
                  void run(async () => {
                    const dir = await api<string | null>("dialog.directory");
                    if (dir) setDraft({ ...draft, outputDir: dir });
                  })
                }
              >
                更改
              </button>
            </div>
          </section>
        </div>
        <footer className="generation-footer">
          <div className="submit-bar">
            <div>
              <strong data-estimated-cost>
                {quote
                  ? quote.cost.amount === null
                    ? "预计费用：待配置"
                    : `预计 ${quote.cost.currency === "CNY" ? "¥" : "$"}${quote.cost.amount.toFixed(2)}`
                  : "正在计算预计费用…"}
              </strong>
              {blocked && (
                <small role="status" className="validation-reason">
                  {blocked}
                </small>
              )}
              {!accounts.length && <small role="status" className="validation-reason">请先在“模型与 API”配置可用连接。</small>}
            </div>
            <button
              className="primary generate-button"
              disabled={
                busy ||
                !model.enabled ||
                !accounts.length ||
                (!!blocked && !canAutoSegment)
              }
              title={blocked || undefined}
              onClick={() =>
                canAutoSegment ? void prepareSegments() : void submit()
              }
            >
              {busy
                ? "正在创建…"
                : canAutoSegment
                  ? "自动分段复刻"
                  : "开始生成"}
              <ArrowRight size={18} />
              <kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </footer>
      </section>
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)}>
          <div
            className="large-preview click-close-preview"
            onClick={() => setPreview(null)}
            title="点击预览关闭"
          >
            <AssetPreview asset={preview} controls />
          </div>
        </Modal>
      )}
      {segmentPlan && (
        <Modal
          title="确认自动分段复刻"
          onClose={() => setSegmentPlan(null)}
        >
          <p>
            检测到长素材，预计分为 <b>{segmentPlan.calls}</b> 段，共调用{" "}
            <b>{segmentPlan.calls}</b> 次。
          </p>
          <div className="version-list">
            {segmentPlan.segments.map((segment) => (
              <div key={segment.index}>
                <strong>Segment{segment.index}</strong>
                <small>
                  {segment.start.toFixed(2)}–{segment.end.toFixed(2)} 秒 ·{" "}
                  {segment.duration.toFixed(2)} 秒
                </small>
              </div>
            ))}
          </div>
          <p className="muted">
            Prompt 会按时间轴切分，人物图与 Seed 策略保持一致；完成后自动拼接，并重新封装完整 Audio1。
          </p>
          <p>
            预计费用：
            <b>
              {segmentPlan.cost.amount === null
                ? "待配置，以官方账单为准"
                : `${segmentPlan.cost.currency === "CNY" ? "¥" : "$"}${segmentPlan.cost.amount.toFixed(2)}`}
            </b>
          </p>
          <div className="actions">
            <button onClick={() => setSegmentPlan(null)}>取消</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void submitSegments()}
            >
              {busy ? "正在切分素材…" : "确认并开始生成"}
            </button>
          </div>
        </Modal>
      )}
      {!collapsed && (
        <aside className="queue">
          <header>
            <h3>
              任务列表 <span>{queue.length}</span>
            </h3>
            <span className="live">
              <i className="dot" />
              实时
            </span>
          </header>
          <p className="muted">生成进行时，你可以继续创作。</p>
          {!queue.length ? (
            <Empty
              title="你的创作即将出现"
              description="提交后，进度与生成结果会保留在这里。"
            />
          ) : (
            <div className="queue-list">
              {queue.map((t) => (
                <div className="queue-row" key={t.id}>
                  <button
                    className="queue-item"
                    key={t.id}
                    onClick={() => setTask(t.id)}
                  >
                    <div className="queue-icon">
                      <Film size={22} />
                    </div>
                    <div>
                      <strong>{t.name}</strong>
                      <small>
                        {t.snapshot.model.name} · V{t.version}
                      </small>
                      <span className={`status ${t.status}`}>
                        {t.downloadStatus === "failed"
                          ? "生成成功 · 下载失败"
                          : labels[t.status]}
                      </span>
                    </div>
                    <ArrowRight size={14} />
                  </button>
                  <button
                    className="queue-delete"
                    aria-label={`删除任务 ${t.name}`}
                    title="删除任务"
                    onClick={() =>
                      void run(async () => {
                        await api("tasks.remove", { id: t.id });
                        await loadQueue();
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="queue-foot">
            <Layers size={18} />
            <p>
              资产、Prompt 和每次生成
              <br />
              都保留在你的电脑。
            </p>
          </div>
        </aside>
      )}
      {picker === "reference_audio" && (
        <AudioPicker
          onClose={() => setPicker(null)}
          onPick={(list) =>
            void run(async () => {
              await useApp.getState().flushDraft();
              const bound = await api<Draft>("audio.bind", {
                assetId: list[0].id,
                draftId: draft.draftId,
              });
              setDraft(bound);
              setPicker(null);
            })
          }
        />
      )}

      {picker && picker !== "reference_audio" && (
        <AssetPicker
          onClose={() => setPicker(null)}
          allowed={
            picker === "all"
              ? [
                  ...new Set(
                    referenceRoles.map((r) =>
                      r.includes("video")
                        ? "video"
                        : r.includes("audio")
                          ? "audio"
                          : "image",
                    ),
                  ),
                ]
              : [
                  picker.includes("video")
                    ? "video"
                    : picker.includes("audio")
                      ? "audio"
                      : "image",
                ]
          }
          onPick={(list) => {
            commitImport(list, picker === "all" ? referenceRoles : [picker]);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}
