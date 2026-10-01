import { app, BrowserWindow, clipboard } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { SpeechDocumentWindows } from "../src/main/realSpeech/v2/documents.ts";
const root = mkdtempSync(join(tmpdir(), "ctg-doc-native-"));
app.setPath("userData", join(root, "chromium"));
app
  .whenReady()
  .then(async () => {
    const main = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    await main.loadURL(
      'data:text/html,<button id="work">主窗口可操作</button>',
    );
    const viewer = new SpeechDocumentWindows(
      resolve("resources/real-speech-v2"),
      root,
      resolve("dist/speech-document-preload.cjs"),
      false,
    );
    async function ready(win: BrowserWindow) {
      if (win.webContents.isLoading())
        await new Promise<void>((r) =>
          win.webContents.once("did-finish-load", () => r()),
        );
      await win.webContents.executeJavaScript(
        "new Promise(resolve=>setTimeout(resolve,80))",
      );
    }
    try {
      viewer.open("director");
      const doc = viewer.windows.get("director")!;
      await ready(doc);
      assert.equal(doc.getParentWindow(), null);
      assert.equal(doc.isModal(), false);
      assert.equal(main.isEnabled(), true);
      viewer.open("director");
      assert.equal(viewer.windows.size, 1);
      viewer.open("compiler");
      const other = viewer.windows.get("compiler")!;
      await ready(other);
      assert.equal(viewer.windows.size, 2);
      assert.equal(
        (
          doc.webContents as unknown as {
            getLastWebPreferences(): Electron.WebPreferences;
          }
        ).getLastWebPreferences().nodeIntegration,
        false,
      );
      assert.equal(
        (
          doc.webContents as unknown as {
            getLastWebPreferences(): Electron.WebPreferences;
          }
        ).getLastWebPreferences().contextIsolation,
        true,
      );
      assert.equal(
        (
          doc.webContents as unknown as {
            getLastWebPreferences(): Electron.WebPreferences;
          }
        ).getLastWebPreferences().sandbox,
        true,
      );
      const original = readFileSync(
        "resources/real-speech-v2/docs/director.md",
        "utf8",
      );
      const read = await doc.webContents.executeJavaScript(
        "window.speechDocument.read()",
      );
      assert.equal(read.text, original);
      await doc.webContents.executeJavaScript("window.speechDocument.copy()");
      assert.equal(await clipboard.readText(), original);
      const at = await doc.webContents.executeJavaScript(
        'document.querySelector("header").getBoundingClientRect().top',
      );
      await doc.webContents.executeJavaScript(
        'document.querySelector("main").scrollTop=10000',
      );
      assert.equal(
        await doc.webContents.executeJavaScript(
          'document.querySelector("header").getBoundingClientRect().top',
        ),
        at,
      );
      doc.setSize(360, 300);
      await doc.webContents.executeJavaScript(
        "new Promise(resolve=>setTimeout(resolve,50))",
      );
      assert.equal(
        await doc.webContents.executeJavaScript(
          'document.querySelector("nav").getBoundingClientRect().right<=innerWidth',
        ),
        true,
      );
      doc.minimize();
      doc.restore();
      doc.maximize();
      doc.unmaximize();
      assert.equal(main.isEnabled(), true);
      await doc.webContents.executeJavaScript(
        'document.getElementById("copy").click(); new Promise(resolve=>setTimeout(resolve,40))',
      );
      assert.equal(
        await doc.webContents.executeJavaScript(
          'document.getElementById("copy").textContent',
        ),
        "已复制 ✓",
      );
      const write = clipboard.writeText;
      clipboard.writeText = () => {
        throw Error("模拟剪贴板失败");
      };
      await doc.webContents.executeJavaScript(
        'document.getElementById("copy").click();new Promise(resolve=>setTimeout(resolve,40))',
      );
      assert.match(
        await doc.webContents.executeJavaScript(
          'document.getElementById("error").textContent',
        ),
        /复制失败/,
      );
      clipboard.writeText = write;
      const closed = new Promise<void>((r) => doc.once("closed", () => r()));
      void doc.webContents
        .executeJavaScript('document.getElementById("close").click()')
        .catch(() => {});
      await closed;
      assert.equal(viewer.windows.size, 1);
      assert.equal(main.isDestroyed(), false);
      assert.equal(other.isDestroyed(), false);
      viewer.open("manual");
      const crash = viewer.windows.get("manual")!;
      await ready(crash);
      const crashedClosed = new Promise<void>((r) =>
        crash.once("closed", () => r()),
      );
      crash.webContents.forcefullyCrashRenderer();
      await crashedClosed;
      assert.equal(main.isDestroyed(), false);
      assert.equal(other.isDestroyed(), false);
      assert.equal(
        await other.webContents.executeJavaScript("typeof require"),
        "undefined",
      );
      const othersClosed = new Promise<void>((r) =>
        other.once("closed", () => r()),
      );
      viewer.closeAll();
      await othersClosed;
      assert.equal(viewer.windows.size, 0);
      main.destroy();
      console.log(
        "PASS Electron独立文档窗口：non-modal、并开/复用、完整复制、固定工具栏、小窗口按钮、复制错误、关闭隔离及安全preload",
      );
      app.exit(0);
    } catch (e) {
      console.error(String(e));
      viewer.closeAll();
      main.destroy();
      app.exit(1);
    }
  })
  .catch(() => app.exit(1));
