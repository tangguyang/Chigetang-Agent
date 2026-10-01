import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const source=readFileSync("scripts/test-repair2-workflow-ui.tsx","utf8");
const test=source.replace('const dir=mkdtempSync', '(async()=>{\nconst dir=mkdtempSync')+'\n})().catch(e=>{console.error(e);require("electron").ipcRenderer.send("workflow-failed",String(e));});';
writeFileSync("scripts/.repair2-native-tests.tsx",test);
await build({entryPoints:["scripts/.repair2-native-tests.tsx"],bundle:true,platform:"node",format:"cjs",target:"node24",outfile:"scripts/.repair2-native-tests.cjs",packages:"external",loader:{".css":"empty"}});
mkdirSync("release/validation",{recursive:true});
const css=readdirSync("dist/renderer/assets").filter(name=>name.endsWith(".css"));
writeFileSync("scripts/.repair2-native.html",`<html><head>${css.map(name=>`<link rel="stylesheet" href="../dist/renderer/assets/${name}">`).join("")}</head><body><div id="root"></div><script>globalThis.IS_REACT_ACT_ENVIRONMENT=true;window.captureWorkflow=()=>require("electron").ipcRenderer.invoke("capture-workflow");require("./.repair2-native-tests.cjs");</script></body></html>`);
writeFileSync("scripts/.repair2-electron.cjs",`
const {app,BrowserWindow,ipcMain}=require("electron");
const path=require("node:path");
app.setPath("userData",path.join(require("node:os").tmpdir(),"ctg-repair2-native-"+Date.now()));
let window,done=false;
function finish(code){if(done)return;done=true;app.exit(code);}
ipcMain.on("workflow-failed",(_e,text)=>{console.error(text);finish(1);});
ipcMain.handle("capture-workflow",async()=>{require("node:fs").writeFileSync(path.resolve("release/validation/windows-workflow.png"),(await window.webContents.capturePage()).toPNG());});
app.whenReady().then(async()=>{
 window=new BrowserWindow({show:false,width:1440,height:1080,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false}});
 window.webContents.on("console-message",async(event)=>{
  const message=event.message;
  console.log(message);
  if(message.startsWith("RESULT 五条")){
   finish(0);
  }
 });
 await window.loadFile(path.resolve("scripts/.repair2-native.html"));
 setTimeout(()=>{console.error("Windows UI workflow timed out");finish(1);},60000);
});`);
const executable=resolve("node_modules/electron/dist/electron.exe");
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(executable,[resolve("scripts/.repair2-electron.cjs")],{stdio:"inherit",env,windowsHide:true,timeout:90000});
if(result.error)console.error(result.error);
process.exit(result.status??1);
