import { BrowserWindow, clipboard, ipcMain, screen } from "electron";
import { readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { readableBounds, type Bounds } from "./documentBounds.ts";
const registry: Record<string, { file: string; title: string }> = {
  manual: { file: "manual.md", title: "真人口播 V2 使用手册" },
  director: { file: "director.md", title: "ChatGPT导演意图词典" },
  template: { file: "template.md", title: "口播台词需求模板" },
  compiler: { file: "compiler.md", title: "ChatGPT协议编译规范" },
  capability: { file: "capability.md", title: "CosyVoice Capability能力说明" },
  diagnosis: { file: "diagnosis.md", title: "听感诊断手册" },
};
export class SpeechDocumentWindows {
  windows = new Map<string, BrowserWindow>();
  snapshots = new Map<number, { title: string; text: string }>();
  bounds: Record<string, Bounds> = {};
  root: string;
  stateFile: string;
  preload: string;
  visible: boolean;
  constructor(
    resources: string,
    stateRoot: string,
    preload: string,
    visible = true,
  ) {
    this.visible = visible;
    this.root = resources;
    this.stateFile = join(stateRoot, "speech-document-bounds.json");
    this.preload = preload;
    try {
      if (existsSync(this.stateFile))
        this.bounds = JSON.parse(readFileSync(this.stateFile, "utf8"));
    } catch {
      this.bounds = {};
    }
    const check = (event: Electron.IpcMainInvokeEvent) => {
      const doc = this.snapshots.get(event.sender.id);
      if (!doc || event.senderFrame !== event.sender.mainFrame)
        throw Error("不可信文档请求");
      return doc;
    };
    ipcMain.handle("speech-document:read", (event) => check(event));
    ipcMain.handle("speech-document:copy", async (event) => {
      const doc = check(event);
      clipboard.writeText(doc.text);
      if ((await clipboard.readText()) !== doc.text)
        throw Error("剪贴板写入失败");
      return true;
    });
    ipcMain.handle("speech-document:close", (event) => {
      check(event);
      BrowserWindow.fromWebContents(event.sender)?.close();
      return true;
    });
  }
  open(id: string) {
    const doc = Object.hasOwn(registry, id) ? registry[id] : undefined;
    if (!doc) throw Error("未注册文档");
    const existing = this.windows.get(id);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      if (this.visible) {
        existing.show();
        existing.focus();
      }
      return;
    }
    const raw = this.bounds[id];
    const saved =
      raw && [raw.x, raw.y, raw.width, raw.height].every(Number.isFinite)
        ? raw
        : undefined;
    const bounds = readableBounds(
      saved,
      screen.getAllDisplays().map((d) => d.workArea),
      screen.getPrimaryDisplay().workArea,
    );
    const win = new BrowserWindow({
      show: this.visible,
      ...bounds,
      minWidth: 320,
      minHeight: 240,
      title: doc.title,
      autoHideMenuBar: true,
      resizable: true,
      minimizable: true,
      maximizable: true,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    this.windows.set(id, win);
    const wcId = win.webContents.id;
    this.snapshots.set(wcId, {
      title: doc.title,
      text: readFileSync(join(this.root, "docs", doc.file), "utf8"),
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_w, _p, cb) =>
      cb(false),
    );
    win.webContents.on("render-process-gone", () => win.close());
    win.on("close", () => {
      this.bounds[id] = win.getNormalBounds();
      try {
        writeFileSync(this.stateFile + ".tmp", JSON.stringify(this.bounds));
        renameSync(this.stateFile + ".tmp", this.stateFile);
      } catch {
        /* reading remains usable when preferences cannot be saved */
      }
    });
    win.on("closed", () => {
      this.windows.delete(id);
      this.snapshots.delete(wcId);
    });
    void win.loadFile(join(this.root, "viewer", "index.html"));
  }
  closeAll() {
    for (const w of this.windows.values()) w.close();
  }
}
