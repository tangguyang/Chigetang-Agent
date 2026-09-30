import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppBridge } from "../shared/types.ts";
const bridge: AppBridge = {
  invoke: async <T>(action: string, payload?: unknown) => {
    const channel = action.startsWith("realSpeech:") ? "realSpeech:invoke" : "ai-video";
    const response = (await ipcRenderer.invoke(
      channel,
      action.startsWith("realSpeech:") ? action.slice(11) : action,
      payload,
    )) as { ok: boolean; data: T; error?: string };
    if (!response.ok) throw new Error(response.error || "操作失败");
    return response.data;
  },
  onChange: (callback) => {
    const fn = () => callback();
    ipcRenderer.on("changed", fn);
    return () => ipcRenderer.removeListener("changed", fn);
  },
  onNavigate: (callback) => {
    const fn = (_event: unknown, id: string) => callback(id);
    ipcRenderer.on("navigate-task", fn);
    return () => ipcRenderer.removeListener("navigate-task", fn);
  },
  filePath: (file) => webUtils.getPathForFile(file),
};
contextBridge.exposeInMainWorld("aiVideo", bridge);
