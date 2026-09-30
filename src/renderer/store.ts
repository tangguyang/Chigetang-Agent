import { create } from "zustand";
import { normalizeDraft } from "../shared/mentions.ts";
import type { Bootstrap, Draft, DraftSummary } from "../shared/types.ts";
import { completeSubmittedWorkspace } from "./workspaceLifecycle.ts";
export const api = <T>(action: string, payload?: unknown) =>
  window.aiVideo.invoke<T>(action, payload);
const CLOSED_KEY = "chigetang-workspace-closed";
function closedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}
function setClosed(ids: string[]) {
  localStorage.setItem(CLOSED_KEY, JSON.stringify([...new Set(ids)]));
}
interface Store {
  assetKind: string;
  setAssetKind: (kind: string) => void;
  boot: Bootstrap | null;
  page: string;
  draft: Draft | null;
  drafts: DraftSummary[];
  draftSaveStatus: "saved" | "saving" | "error";
  toast: string | null;
  taskId: string | null;
  setPage: (p: string) => void;
  setTask: (id: string | null) => void;
  message: (s: string) => void;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshDrafts: () => Promise<void>;
  setDraft: (d: Draft) => void;
  flushDraft: () => Promise<void>;
  newDraft: () => Promise<void>;
  openDraft: (id: string) => Promise<void>;
  closeWorkspace: (id: string) => Promise<void>;
  finishSubmittedDraft: (id: string) => Promise<void>;
  visibleDrafts: () => DraftSummary[];
}
let timer: ReturnType<typeof setTimeout>;
let sequence = 0;
export const useApp = create<Store>((set, get) => ({
  assetKind: localStorage.getItem("library-kind") || "video",
  setAssetKind: (assetKind) => {localStorage.setItem("library-kind",assetKind);set({ assetKind, page: "资产库" });},
  boot: null,
  page: "一键生成",
  draft: null,
  drafts: [],
  draftSaveStatus: "saved",
  toast: null,
  taskId: null,
  setPage: (page) => set({ page }),
  setTask: (taskId) => set({ taskId }),
  message: (toast) => {
    set({ toast });
    setTimeout(() => {
      if (get().toast === toast) set({ toast: null });
    }, 6500);
  },
  initialize: async () => {
    const boot = await api<Bootstrap>("bootstrap");
    let emergency: Draft | null = null;
    try {
      emergency = JSON.parse(
        localStorage.getItem("aivideo-draft-emergency") || "null",
      ) as Draft | null;
    } catch {}
    let draft = normalizeDraft(
      emergency ?? boot.draft ?? (await api<Draft>("draft.new")),
    );
    const closed = closedIds();
    if (draft.draftId && closed.includes(draft.draftId)) {
      const all = await api<DraftSummary[]>("draft.list");
      const visible = all.find((d) => !closed.includes(d.id));
      draft = visible
        ? normalizeDraft(await api<Draft>("draft.load", { id: visible.id }))
        : normalizeDraft(await api<Draft>("draft.new"));
    }
    set({ boot, draft, draftSaveStatus: "saving" });
    await api("draft.save", draft);
    set({ draftSaveStatus: "saved" });
    await get().refreshDrafts();
  },
  refresh: async () => set({ boot: await api<Bootstrap>("bootstrap") }),
  refreshDrafts: async () =>
    set({ drafts: await api<DraftSummary[]>("draft.list") }),
  visibleDrafts: () => get().drafts.filter((d) => !closedIds().includes(d.id)),
  setDraft: (input) => {
    const draft = normalizeDraft(input);
    if (draft.draftId)
      setClosed(closedIds().filter((id) => id !== draft.draftId));
    set({ draft, draftSaveStatus: "saving" });
    localStorage.setItem("aivideo-draft-emergency", JSON.stringify(draft));
    clearTimeout(timer);
    const seq = ++sequence;
    timer = setTimeout(() => {
      void api("draft.save", draft)
        .then(() => {
          if (seq === sequence) {
            localStorage.removeItem("aivideo-draft-emergency");
            set({ draftSaveStatus: "saved" });
          }
          return get().refreshDrafts();
        })
        .catch((e) => {
          if (seq === sequence) set({ draftSaveStatus: "error" });
          get().message(`草稿保存失败：${String(e)}`);
        });
    }, 350);
  },
  flushDraft: async () => {
    clearTimeout(timer);
    const seq = ++sequence;
    const d = get().draft;
    if (d) {
      set({ draftSaveStatus: "saving" });
      try {
        await api("draft.save", d);
        if (seq === sequence) set({ draftSaveStatus: "saved" });
      } catch (error) {
        if (seq === sequence) set({ draftSaveStatus: "error" });
        throw error;
      }
    }
    if (seq === sequence) localStorage.removeItem("aivideo-draft-emergency");
    await get().refreshDrafts();
  },
  newDraft: async () => {
    await get().flushDraft();
    const draft = normalizeDraft(await api<Draft>("draft.new"));
    if (draft.draftId)
      setClosed(closedIds().filter((id) => id !== draft.draftId));
    set({ draft, page: "生成视频", draftSaveStatus: "saved" });
    await get().refreshDrafts();
  },
  openDraft: async (id) => {
    await get().flushDraft();
    const draft = normalizeDraft(await api<Draft>("draft.load", { id }));
    setClosed(closedIds().filter((x) => x !== id));
    set({ draft, page: "生成视频", draftSaveStatus: "saving" });
    await api("draft.save", draft);
    set({ draftSaveStatus: "saved" });
    await get().refreshDrafts();
  },
  closeWorkspace: async (id) => {
    await get().flushDraft();
    setClosed([...closedIds(), id]);
    if (get().draft?.draftId !== id) {
      await get().refreshDrafts();
      return;
    }
    const candidates = get().drafts.filter(
      (d) => d.id !== id && !closedIds().includes(d.id),
    );
    if (candidates[0]) {
      const draft = normalizeDraft(
        await api<Draft>("draft.load", { id: candidates[0].id }),
      );
      set({ draft, page: "生成视频", draftSaveStatus: "saving" });
      await api("draft.save", draft);
      set({ draftSaveStatus: "saved" });
    } else {
      const draft = normalizeDraft(await api<Draft>("draft.new"));
      set({ draft, page: "生成视频", draftSaveStatus: "saved" });
    }
    await get().refreshDrafts();
  },
  finishSubmittedDraft: async (id) =>
    completeSubmittedWorkspace(id, {
      currentDraftId: () => get().draft?.draftId,
      cancelPendingSave: () => {
        clearTimeout(timer);
        ++sequence;
        localStorage.removeItem("aivideo-draft-emergency");
      },
      finishSubmitted: () => api("draft.finishSubmitted", { id }),
      afterFinish: () => setClosed(closedIds().filter((x) => x !== id)),
      createReplacement: async () =>
        normalizeDraft(await api<Draft>("draft.new")),
      activateReplacement: (draft) =>
        set({ draft, page: "生成视频", draftSaveStatus: "saved" }),
      onFinishError: (error) =>
        get().message(
          `任务已入队；旧草稿清理失败但不影响生成：${String(error)}`,
        ),
      refreshDrafts: () => get().refreshDrafts(),
    }),
}));
Object.assign(window, { __flushDraft: () => useApp.getState().draft });
export async function run<T>(
  fn: () => Promise<T>,
  success?: string,
): Promise<T | undefined> {
  try {
    const value = await fn();
    if (success) useApp.getState().message(success);
    return value;
  } catch (e) {
    useApp.getState().message(e instanceof Error ? e.message : String(e));
  }
}
export const money = (cost: {
  amount: number | null;
  currency: string;
  kind: string;
}) =>
  cost.amount === null
    ? "费用待确认"
    : `${cost.currency === "CNY" ? "¥" : "$"}${cost.amount.toFixed(2)}${cost.kind === "estimate" ? " · 估算" : ""}`;
export const time = (v: string) =>
  new Date(v).toLocaleString("zh-CN", { hour12: false });
export const media = (kind: "asset" | "thumb" | "output", id: string) =>
  `aivideo://local/${kind}/${id}`;
export const labels: Record<string, string> = {
  Draft: "草稿",
  Queued: "排队中",
  Uploading: "上传素材",
  Submitting: "提交中",
  Processing: "生成中",
  Downloading: "下载中",
  Completed: "已完成",
  Failed: "失败",
  Cancelled: "已取消",
  Paused: "待处理",
};
