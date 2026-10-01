import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "speechDocument",
  Object.freeze({
    read: () => ipcRenderer.invoke("speech-document:read"),
    copy: () => ipcRenderer.invoke("speech-document:copy"),
    close: () => ipcRenderer.invoke("speech-document:close"),
  }),
);
