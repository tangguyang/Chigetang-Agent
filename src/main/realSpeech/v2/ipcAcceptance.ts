import { resolve, relative, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import type { BrowserWindow } from "electron";
import type { Adapter } from "./service.ts";
/** Explicit packaged acceptance mode. Never valid for a production data root. */
export function acceptanceMode(argv: string[], env: NodeJS.ProcessEnv) {
  if (!argv.includes("--agent-control-acceptance")) return null;
  const root = resolve(env.CHIGETANG_AGENT_ACCEPTANCE_ROOT || ""),
    real = realpathSync(root),
    rel = relative(realpathSync(tmpdir()), real);
  if (
    !rel ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    !/^ctg-ipc-acceptance-[^\\/]+$/.test(rel) ||
    root.toLowerCase() !== real.toLowerCase()
  )
    throw Error("验收模式仅允许独立OS临时目录");
  const fixture = JSON.parse(
    readFileSync(join(root, "acceptance-fixture.json"), "utf8"),
  );
  if (
    fixture.schema !== "CHIGETANG_ISOLATED_IPC_ACCEPTANCE_V1" ||
    !fixture.taskId
  )
    throw Error("缺少隔离验收夹具");
  return { root, taskId: String(fixture.taskId) };
}
export const acceptanceAdapter: Adapter = async (_body, path) => {
  const b = Buffer.alloc(44 + 4800);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(96000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(4800, 40);
  writeFileSync(path, b, { flag: "wx" });
  return { requestId: "isolated-ipc-fake-only", usage: { characters: 0 } };
};
export function observeAcceptance(
  window: BrowserWindow,
  root: string,
  _taskId: string,
  stop: () => void = () => {},
) {
  let busy = false,
    last = "";
  const timer = setInterval(async () => {
    if (window.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    if (existsSync(join(root, "acceptance-stop"))) {
      clearInterval(timer);
      stop();
      return;
    }
    if (busy) return;
    busy = true;
    try {
      const snapshot = await window.webContents.executeJavaScript(`(()=>{
        if(!document.querySelector('.rs-v2')){[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='真人口播')?.click();return {ready:false};}
        if(!document.querySelector('.rs-v2-window')){document.querySelector('.rs-v2-layout aside button')?.click();return {ready:false};}
        return {ready:true,windows:[...document.querySelectorAll('.rs-v2-window')].map(c=>({windowId:c.textContent.match(/GW\\d{3,}/)?.[0],versions:[...c.querySelectorAll('.rs-v2-version > span')].map(s=>({number:Number(s.textContent.match(/V(\\d+)/)?.[1]),selected:s.textContent.includes('当前版本')}))}))};
      })()`);
      const text = JSON.stringify(snapshot);
      if (text !== last) {
        last = text;
        writeFileSync(join(root, "acceptance-ui.json"), text);
        if (snapshot.ready) {
          await window.webContents.executeJavaScript(
            `(()=>{const c=[...document.querySelectorAll('.rs-v2-window')].find(c=>/GW002/.test(c.textContent));c?.querySelector('.rs-v2-version')?.scrollIntoView({block:'center'});})()`,
          );
          await new Promise((r) => setTimeout(r, 100));
          const image = await window.webContents.capturePage();
          writeFileSync(join(root, "acceptance-ui.png"), image.toPNG());
        }
      }
    } catch {
    } finally {
      busy = false;
    }
  }, 300);
  window.on("closed", () => clearInterval(timer));
}
