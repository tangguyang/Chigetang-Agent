import {PaidAcceptanceGate} from './realSpeech/v2/paidAcceptanceGate.ts';
import {registerSpeechCapabilities} from './capabilities/speech.ts';
import {CapabilityRegistry} from './capabilities/registry.ts';
import {registerDiscovery} from './capabilities/runtime.ts';
import {registerJobs} from './capabilities/jobs.ts';
import {TextService} from './services/text.ts';
import {registerApplicationCapabilities} from './capabilities/catalog.ts';
import { watchSpeechChanges } from "./realSpeech/v2/runtimeCoordination.ts";
import {acquireWriter,completeWriterRecovery} from './realSpeech/v2/writerLease.ts';
import {startControlBridge} from './realSpeech/v2/controlPipe.ts';
import {SpeechAgentControl} from './realSpeech/v2/agentControl.ts';
import {SecretFilter} from '../cli/output.ts';
import {acceptanceMode,acceptanceAdapter,observeAcceptance} from './realSpeech/v2/ipcAcceptance.ts';
import { RealSpeechV2Service } from "./realSpeech/v2/service.ts";
import { SpeechDocumentWindows } from "./realSpeech/v2/documents.ts";
import { libraryView } from "./services/libraryView.ts";
import { ReplicaService } from "./services/replica.ts";
import { LocalTools } from "./services/localTools.ts";
import {
  app,
  Tray,
  Menu,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  net,
  Notification,
  protocol,
  safeStorage,
  shell,
  clipboard,
} from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { brand } from "../shared/brand.ts";
import type {
  Account,
  Asset,
  AssetKind,
  Draft,
  ListQuery,
  Model,
  Prompt,
  Settings,
} from "../shared/types.ts";
import { TranscriptionService } from "./services/transcription.ts";
import { Application } from "./services/application.ts";
import { toError } from "./services/errors.ts";
import { probeMedia } from "./services/media.ts";
import {
  migrateLegacyRoot,
  defaultDirectories,
  directoryKeys,
  validateDataRoot,
  WINDOWS_DATA_ROOT,
  writableDirectory,
} from "./services/storage.ts";
import { hasFFmpeg } from "./services/transcode.ts";
import { TaskPackageService } from "./services/taskPackage.ts";
import { compileLocalTask } from "./services/localTaskCompiler.ts";
import { packageGuide } from "../shared/taskPackageDocs.ts";
import { Stage1TemplateService } from "./services/stage1Template.ts";
import type {
  AudioBatchInput,
  Voice,
  AssetFolder,
  InstructionPreset,
} from "../shared/types.ts";
const exec = promisify(execFile);
const headless = process.argv.includes('--agent-headless');
let capabilityRegistry: CapabilityRegistry;
let tray: Tray | undefined;
let quitPending = false;
let window: BrowserWindow;
let service: Application;
let transcriptionService: TranscriptionService;
let taskPackageService: TaskPackageService;
let replicaService: ReplicaService;
let localTools: LocalTools;
let stage1TemplateService: Stage1TemplateService;
const textService=new TextService();
let realSpeech: import("./realSpeech/service.ts").RealSpeechService | undefined;
let realSpeechInit: Promise<import("./realSpeech/service.ts").RealSpeechService> | undefined;
let realSpeechV2: RealSpeechV2Service | undefined;
let speechDocuments: SpeechDocumentWindows | undefined;
let stopSpeechWatch: (() => void) | undefined;
let unregisterControl: (() => void) | undefined;
let releaseSpeechWriter: ReturnType<typeof acquireWriter>|undefined;
const agentFilter=new SecretFilter();
const paidAcceptance=process.argv.includes('--agent-control-paid-acceptance');
const isolatedAcceptance=acceptanceMode(paidAcceptance?[...process.argv,'--agent-control-acceptance']:process.argv,process.env);
let paidGate:PaidAcceptanceGate|undefined;
if(paidAcceptance) {
  try {if(!headless)throw Error('真实验收必须无窗口运行');paidGate=new PaidAcceptanceGate(isolatedAcceptance!.root);}
  catch(error){console.error('真实验收授权已失效或无效',String(error));app.exit(1);process.exit(1);}
}
const agentAdapter=isolatedAcceptance&&!paidAcceptance?acceptanceAdapter:undefined;
function speechControl() {
  realSpeechV2 ??= new RealSpeechV2Service(service.root,service,join(app.getAppPath(),'resources/real-speech-v2'));
  return new SpeechAgentControl(realSpeechV2,agentAdapter);
}
let closing = false;
const WORKFLOW_FILES = {
  stage1: "阶段1_爆款逆向工程_V2.2.md",
  stage2: "阶段2_Wan任务生产_V2.2.md",
  converter: "阶段3_任务包转换_V2.2.md",
  singleTemplate: "单任务测试模板_V2.2.zip",
  multiTemplate: "多任务测试模板_V2.2.zip",
} as const;
const workflowFile = (kind: keyof typeof WORKFLOW_FILES) =>
  join(app.getAppPath(), "resources", "workflow", WORKFLOW_FILES[kind]);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "aivideo",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
const packagedDir = dirname(app.getPath("exe"));
const legacyInstalledRoot = join(
  app.getPath("appData"),
  "AI Video",
  "AI Video",
);
const currentInstalledRoot = join(
  app.getPath("appData"),
  "吃个糖Agent",
  "吃个糖Agent",
);
const previousUserDataRoot = join(
  app.getPath("appData"),
  "吃个糖Agent",
  "UserData",
);
const root =
  isolatedAcceptance?.root ||
  process.env.AIVIDEO_TEST_ROOT ||
  (process.platform === "win32"
    ? WINDOWS_DATA_ROOT
    : process.env.AIVIDEO_USER_DATA_ROOT ||
      join(app.isPackaged ? packagedDir : process.cwd(), "UserData"));
let rootError: unknown;
let ownsInstance=true;
try {
  mkdirSync(join(root, "config", "chromium"), { recursive: true });
  app.setPath("userData", join(root, "config", "chromium"));
  ownsInstance=app.requestSingleInstanceLock();
} catch(error) {rootError=error;}
if(ownsInstance) {
try {
  if(rootError)throw rootError;
  releaseSpeechWriter=acquireWriter(root);
  if(!isolatedAcceptance) {
  migrateLegacyRoot(
    root,
    process.env.AIVIDEO_LEGACY_ROOT
      ? [process.env.AIVIDEO_LEGACY_ROOT]
      : [
          packagedDir,
          join(packagedDir, "UserData"),
          previousUserDataRoot,
          legacyInstalledRoot,
          currentInstalledRoot,
          ...(!app.isPackaged ? [join(process.cwd(), "test-data")] : []),
        ],
  );
  validateDataRoot(root);
  }
} catch (error) {
  rootError = error;
}
}
if (!rootError) {
  mkdirSync(join(root, "config", "chromium"), { recursive: true });
  app.setPath("userData", join(root, "config", "chromium"));
}
app.setName(brand.name);
app.setAppUserModelId(brand.name);
if (!ownsInstance) {app.quit();}
else {
  app.on("second-instance", (_event, argv) => {
    if(headless&&!argv.includes('--agent-headless')) {
      dialog.showErrorBox(brand.name,`后台主进程 PID ${process.pid} 正在运行，GUI未另开数据库。后台调用可继续使用现有 Agent Control。若要切换GUI，请先等待任务空闲后运行 agent-stop.cmd，再启动GUI。`);
      return;
    }
    if (window && !headless && !argv.includes('--agent-headless')) {
      window.show();
      window.restore();
      window.focus();
    }
  });
  void app
    .whenReady()
    .then(async () => {
      if (rootError) throw rootError;
      const probe = async (
        path: string,
        kind: AssetKind,
        id: string,
      ): Promise<Partial<Asset>> => {
        if (kind === "image") {
          const img = nativeImage.createFromPath(path);
          if (img.isEmpty())
            return probeMedia(
              path,
              join(app.getAppPath(), "resources", "MediaInfoModule.wasm"),
            );
          const dimensions = img.getSize();
          const thumb = join(root, "cache", "thumbnails", id + ".png");
          mkdirSync(dirname(thumb), { recursive: true });
          writeFileSync(thumb, img.resize({ width: 360 }).toPNG());
          const bytes =
            extname(path).toLowerCase() === ".png"
              ? await readFile(path)
              : null;
          return {
            ...dimensions,
            thumbnailPath: thumb,
            hasAlpha: bytes
              ? bytes[25] === 4 ||
                bytes[25] === 6 ||
                bytes.includes(Buffer.from("tRNS"))
              : false,
          };
        }
        try {
          return await probeMedia(
            path,
            join(app.getAppPath(), "resources", "MediaInfoModule.wasm"),
          );
        } catch {
          return {};
        }
      };
      service = new Application(
        root,
        safeStorage,
        probe,
        () => window?.webContents.send("changed"),
        (task) => {
          if (headless || !service.settings().notifications || !Notification.isSupported())
            return;
          const n = new Notification({
            title: brand.name,
            body: `${task.snapshot.model.name} · ${task.downloadStatus === "failed" ? "生成成功，下载失败" : task.status === "Completed" ? "生成完成" : "任务需要处理"}`,
          });
          n.on("click", () => {
            window.show();
            window.webContents.send("navigate-task", task.id);
          });
          n.show();
        },
        (input, init) => {
          if(isolatedAcceptance&&!paidAcceptance)throw Error('隔离IPC验收禁止所有真实网络请求');
          if(paidGate&&init?.method==='POST') {
            const url=new URL(String(input));
            if(url.pathname.endsWith('/video-synthesis')&&url.protocol==='https:'&&url.hostname.endsWith('.cn-beijing.maas.aliyuncs.com')) {
              const submitting=service.tasks.list({pageSize:1000}).items.filter(t=>t.status==='Submitting');
              if(submitting.length!==1||service.settings().maxRetries!==0)throw Error('真实验收仅允许单并发且禁止重试');
              service.logger.write('api','paid_acceptance_submit',paidGate.reserve(submitting[0],JSON.parse(String(init.body))));
            } else if(!url.hostname.endsWith('.aliyuncs.com')||!url.hostname.includes('.oss-'))throw Error('真实验收禁止其他付费POST');
          }
          return net.fetch(input instanceof URL ? input.href : input, init);
        },
        app.getAppPath(),
      );
      protocol.handle("aivideo", async (request) => {
        try {
          const u = new URL(request.url);
          const [kind, id] = u.pathname.split("/").filter(Boolean);
          let file: string;
          if (kind === "asset" || kind === "thumb") {
            const a = service.assets.get(id);
            file =
              kind === "thumb" && a.thumbnailPath
                ? a.thumbnailPath
                : a.managedPath || a.originalPath;
          } else if (kind === "output") {
            file = service.tasks.get(id).outputPath || "";
          } else if (kind === "realSpeechV2" && realSpeechV2) {
            file=realSpeechV2.output(id,String(u.searchParams.get("artifact")));
          } else if (kind === "realSpeechLegacy" && realSpeechV2) {
            file=realSpeechV2.legacyOutput(id,String(u.searchParams.get("artifact")));
          } else if (kind === "realSpeech" && realSpeech) {
            const artifact = u.searchParams.get("artifact");
            file=artifact ? realSpeech.output(id,artifact) : realSpeech.get(id).final?.path;
          } else return new Response("", { status: 404 });
          if (!file || !existsSync(file))
            return new Response("", { status: 404 });
          const response = await net.fetch(pathToFileURL(file).href, {
            headers: request.headers,
          });
          const headers = new Headers(response.headers);
          headers.set("Access-Control-Allow-Origin", "*");
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        } catch {
          return new Response("", { status: 404 });
        }
      });
      transcriptionService = new TranscriptionService(root, app.getAppPath(), () => service.settings());
      taskPackageService = new TaskPackageService(service);
      replicaService = new ReplicaService(service);
      localTools = new LocalTools(()=>service.settings().ffmpegPath);
      stage1TemplateService = new Stage1TemplateService(service.root, {
        version: "2.2",
        content: readFileSync(workflowFile("stage1"), "utf8"),
        name: "阶段1 爆款逆向工程 V2.2（v1.2.2 内置）",
      });
      if (!headless) {
      window = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 1050,
        minHeight: 720,
        icon: join(
          app.getAppPath(),
          "resources",
          process.platform === "win32" ? "brand.ico" : "brand.png",
        ),
        title: brand.name,
        backgroundColor: "#f6f5f2",
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      }
      async function invokeSpeech(action:string,payload:unknown,agent=false):Promise<unknown> {
          const p = (payload ?? {}) as Record<string, any>;
          if (action.startsWith("v2:")) {
            const resources=join(app.getAppPath(),"resources","real-speech-v2");
            if(action==="v2:document") {
              speechDocuments ??= new SpeechDocumentWindows(resources,service.root,join(__dirname,"speech-document-preload.cjs"));
              speechDocuments.open(String(p.documentId));return true;
            }
            realSpeechV2 ??= new RealSpeechV2Service(service.root,service,resources);
            stopSpeechWatch ??= watchSpeechChanges(root, () => service.changed());
            let result:unknown;
            switch(action.slice(3)) {
              case "list": result={tasks:realSpeechV2.list(),legacy:realSpeechV2.legacyList(),voices:realSpeechV2.voices()};break;
              case "get": result=realSpeechV2.get(String(p.taskId));break;
              case "preview": result=realSpeechV2.preview(String(p.text));break;
              case "import": result=realSpeechV2.importPlan(p);break;
              case "mutate": result=realSpeechV2.mutate(p);break;
              case "patchPreview": result=realSpeechV2.previewPatch(p);break;
              case "patchApply": {const applied=realSpeechV2.applyPatch(p);result=applied.jobId&&!applied.reused?await realSpeechV2.runJob(String(applied.jobId),agentAdapter):applied;break;}
              case "generate": {const job=realSpeechV2.createJob(p);result=await realSpeechV2.runJob(job.jobId,agentAdapter);break;}
              case "concat": result=await realSpeechV2.concat(p);break;
              case "acknowledge": result=realSpeechV2.acknowledge(p);break;
              case "recover": result=await realSpeechV2.recover(p);break;
              case "export": {const out=await realSpeechV2.exportDiagnosis(p);if(!agent)await shell.openPath(out.path);result=out;break;}
              default:throw new Error("未知V2操作");
            }
            if (!["v2:list","v2:get","v2:preview","v2:patchPreview"].includes(action)) service.changed();return result;
          }
          if (!realSpeech) {
            realSpeechInit ??= import("./realSpeech/service.ts").then(({ RealSpeechService })=>new RealSpeechService(service.root,service)).catch(error=>{realSpeechInit=undefined;throw error;});
            realSpeech=await realSpeechInit;
          }
          const docs = join(app.getAppPath(), "resources", "docs");
          let data: unknown;
          switch(action) {
            case "list": try{await realSpeech.syncAssets();}catch(error){console.warn("口播资产同步待重试",String(error));} data = { tasks: realSpeech.list(), voices: service.audio.voices().map(v=>({id:v.id,name:v.name,status:v.status})), signatures: realSpeech.list().flatMap(t=>(t.signatures||[]).map((s:any)=>({taskId:t.taskId,name:t.name,...s}))) }; break;
            case "get": data=realSpeech.get(String(p.taskId),true);break;
            case "create": data = realSpeech.newTask(p); break;
            case "remove": data = await realSpeech.remove(p); break;
            case "update": data = realSpeech.update(p); break;
            case "preview": data = realSpeech.preview(p); break;
            case "apply": data = realSpeech.apply(p); break;
            case "generate": data = await realSpeech.generate(p); break;
            case "recover": data = await realSpeech.recover(p); break;
            case "concat": data = await realSpeech.concat(p); break;
            case "feedback": data = realSpeech.feedback(p); break;
            case "export": { const out=realSpeech.exportTask(p,docs); if(!agent){clipboard.writeText(out.text); if(p.attachments) await shell.openPath(out.dir);} data=out; break; }
            case "copy": clipboard.writeText(String(p.text)); data=true; break;
            case "reveal": { const file=realSpeech.output(String(p.taskId),String(p.resultId)); if(!existsSync(file))throw new Error("音频文件不存在"); shell.showItemInFolder(file); data=true; break; }
            case "document": { const files: Record<string,string> = { stage1:"阶段1_真人带货口播导演对齐_V1.0.md",stage2:"阶段2_真人口播执行编译_V1.0.md",manual:"真人口播表演生产系统_使用手册_V5.0.md",protocol:"ChatGPT_真人口播返回协议_V1.2.md",diagnosis:"真人口播小白听感诊断手册_V1.1.md" }; if(!files[p.kind])throw new Error("文档不存在"); data=readFileSync(join(docs,files[p.kind]),"utf8"); break; }
            default: throw new Error("未知真人口播操作");
          }

        return data;
      }
      ipcMain.handle("realSpeech:invoke", async(event,action:string,payload:unknown)=>{
        try{if(headless||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error("不可信请求");return {ok:true,data:await invokeSpeech(action,payload)};}catch(error){return {ok:false,error:String(error)};}
      });
      async function invokeOperation(action: string, payload: unknown, agent = false): Promise<unknown> {
        const confirm = agent ? async (_message: string) => true : globalConfirm;
            const p = (payload ?? {}) as Record<string, unknown>;
            let result: unknown;
            switch (action) {
              case 'text.process':result=textService.process(String(p.text),String(p.operation));break;
              case 'text.subtitles':result=await textService.subtitles(p.segments as {startMs:number;endMs:number;text:string}[],String(p.output));break;
              case 'video.frames': result=await localTools.media('frames',p);break;
              case 'video.convert': result=await localTools.media('convert',p);break;
              case 'media.trim': if((p.kind==='audio')!==(p.format==='wav'))throw Error('音频裁切使用 wav，视频裁切使用 mp4');result=await localTools.media('trim',p);break;
              case 'video.concat': result=await localTools.media('concat',p);break;
              case 'audio.convert': result=await localTools.media('audio',p);break;
              case 'image.process': {
                const input=await localTools.input(String(p.path),['.png','.jpg','.jpeg','.webp','.bmp']);
                let image=nativeImage.createFromPath(input);if(image.isEmpty())throw Error('图片解码失败');
                if(p.width||p.height)image=image.resize({width:p.width as number|undefined,height:p.height as number|undefined});
                await writeFile(String(p.output),p.format==='jpg'?image.toJPEG(Number(p.quality||90)):image.toPNG(),{flag:'wx'});
                result={path:p.output,...image.getSize()};break;
              }
              case 'files.export': {
                if(Boolean(p.assetId)===Boolean(p.taskId))throw Error('指定且仅指定 assetId 或 taskId');
                const input=p.assetId?await service.assets.verify(service.assets.get(String(p.assetId)),false):service.tasks.get(String(p.taskId)).outputPath;
                if(!input)throw Error('没有可导出的本地文件');await copyFile(input,String(p.output),1);result={path:p.output};break;
              }
              case "audio.capabilities":
                result = {
                  ffmpeg: await hasFFmpeg(service.settings().ffmpegPath),
                };
                break;
              case "audio.batch.create":
                result = await service.audio.createBatch(
                  payload as AudioBatchInput,
                );
                break;
              case "audio.batches":
                result = service.audio.batches();
                break;
              case "audio.batch.retry":
                result = service.audio.retryFailed(String(p.id));
                break;
              case "audio.job.rename":
                result = service.audio.renameJob(
                  String(p.id),
                  String(p.name ?? ""),
                );
                break;
              case "audio.job.delete":
                result = service.audio.deleteJob(String(p.id));
                break;
              case "audio.presets":
                result = service.audio.presets();
                break;
              case "audio.presets.save":
                result = service.audio.savePreset(
                  payload as Partial<InstructionPreset>,
                );
                break;
              case "audio.presets.delete":
                result = service.audio.deletePreset(String(p.id));
                break;
              case "audio.presets.reorder":
                result = service.audio.reorderPresets(
                  Array.isArray(p.ids) ? p.ids.map(String) : [],
                );
                break;
              case "audio.history":
                result = service.audio.history();
                break;
              case "audio.history.favorite":
                result = service.audio.updateHistory(
                  String(p.id),
                  Boolean(p.favorite),
                );
                break;
              case "audio.history.delete":
                result = service.audio.deleteHistory(String(p.id));
                break;
              case "audio.reclone.prepare":
                result = service.audio.prepareReclone(String(p.taskId));
                break;
              case "audio.reclone.draft":
                result = service.audio.recloneDraft();
                break;
              case "audio.reclone.clear":
                result = service.audio.clearRecloneDraft();
                break;
              case "audio.bind":
                result = await service.audio.bind(
                  String(p.assetId),
                  String(p.draftId),
                );
                break;
              case "voices.list":
                result = service.audio.voices();
                break;
              case "voices.clone":
                result = await service.audio.clone(
                  p as unknown as Parameters<typeof service.audio.clone>[0],
                );
                break;
              case "voices.save":
                result = service.audio.updateVoice(
                  String(p.id),
                  p as Partial<Voice>,
                );
                break;
              case "voices.reorder":
                result = service.audio.reorderVoices(
                  Array.isArray(p.ids) ? p.ids.map(String) : [],
                );
                break;
              case "voices.remove":
                if (
                  await confirm(
                    "从音色工作台移除此音色？远端音色和原始录音不会删除，本地专用参考副本会移除。",
                  )
                ) {
                  result = await service.audio.removeVoice(String(p.id));
                }
                break;
              case "transcription.select": {
                const selected = await dialog.showOpenDialog(window, {
                  title: "选择要转文字的视频或音频", properties: ["openFile"],
                  filters: [{ name: "音视频", extensions: ["mp4", "mov", "mkv", "avi", "mp3", "wav", "m4a", "aac"] }],
                });
                result = selected.canceled || !selected.filePaths[0] ? null : await transcriptionService.inspect(selected.filePaths[0]);
                break;
              }
              case "transcription.result": result=(await readFile(transcriptionService.resultPath(String(p.taskId),p.kind as "full"|"timeline"),"utf8")).replace(/^\uFEFF/,"");break;
              case "transcription.inspect":
                result = await transcriptionService.inspect(String(p.path || ""));
                break;
              case "transcription.progress":
                result = transcriptionService.progress();
                break;
              case "transcription.start":
                result = transcriptionService.start(String(p.path || ""));
                break;
              case 'transcription.wait': result=await transcriptionService.wait();break;
              case 'transcription.run': {
                await transcriptionService.inspect(String(p.path));
                transcriptionService.start(String(p.path));
                const completed=await transcriptionService.wait();
                if(completed.stage!=='completed')throw Error(completed.detail||'转写未完成');
                result=completed.result;break;
              }
              case "transcription.cancel":
                result = await transcriptionService.cancel();
                break;
              case "transcription.openResult": {
                if (!["folder", "full", "timeline"].includes(String(p.kind))) throw new Error("结果类型无效。");
                const path = transcriptionService.resultPath(String(p.taskId), p.kind as "folder" | "full" | "timeline");
                const error = await shell.openPath(path);
                if (error) throw new Error("无法打开结果，请检查文件是否被移动或删除。");
                result = true;
                break;
              }
              case "transcription.copy": {
                if (!["full", "timeline"].includes(String(p.kind))) throw new Error("结果类型无效。");
                const path = transcriptionService.resultPath(String(p.taskId), p.kind as "full" | "timeline");
                clipboard.writeText((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
                result = true;
                break;
              }
              case "transcription.openOutputFolder": {
                const path = join(root, "outputs", "transcription");
                mkdirSync(path, { recursive: true });
                const error = await shell.openPath(path);
                if (error) throw new Error(error);
                result = true;
                break;
              }
              case "transcription.openModelFolder": {
                const path = join(root, "models", "sensevoice");
                mkdirSync(path, { recursive: true });
                const error = await shell.openPath(path);
                if (error) throw new Error(error);
                result = true;
                break;
              }
              case "transcription.openGuide": {
                const path = join(
                  app.getAppPath(),
                  "resources",
                  "docs",
                  "音视频转文字_模型安装指南.txt",
                );
                if (!existsSync(path)) throw new Error("模型安装说明文档不存在，请重新安装软件。");
                const error = await shell.openPath(path);
                if (error) throw new Error(error);
                result = true;
                break;
              }
              case "folders.list":
                result = service.folders.list();
                break;
              case "folders.save":
                result = service.folders.save(p as Partial<AssetFolder>);
                break;
              case "folders.remove":
                if (
                  await confirm(
                    "删除此逻辑文件夹？其中素材和子文件夹回到根目录，真实文件不移动。",
                  )
                ) {
                  service.folders.remove(String(p.id));
                  result = true;
                }
                break;
              case "directories.reset": {
                const key = String(p.key) as (typeof directoryKeys)[number];
                if (!directoryKeys.includes(key))
                  throw new Error("未知目录设置");
                result = await service.saveSettings({
                  [key]: defaultDirectories(root)[key],
                });
                break;
              }
              case "directories.open": {
                const key = String(p.key) as (typeof directoryKeys)[number];
                if (!directoryKeys.includes(key))
                  throw new Error("未知目录设置");
                const path = service.settings()[key]!;
                await writableDirectory(path);
                const error = await shell.openPath(path);
                if (error) throw new Error(error);
                break;
              }
              case "tools.select": {const r=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:p.kind==='pdf'?'PDF':'视频',extensions:p.kind==='pdf'?['pdf']:['mp4','mov','mkv']}]});result=r.canceled?null:r.filePaths[0];break;}
              case "tools.audio": result=await localTools.audio(String(p.path),String(p.format),p.directory?String(p.directory):undefined);break;
              case "tools.pdfRead": result=await localTools.pdfRead(String(p.path));break;
              case "tools.pdfStart": result=await localTools.pdfStart(String(p.path),String(p.format),p.directory?String(p.directory):undefined);break;
              case "tools.pdfPage": result=await localTools.pdfPage(String(p.id),Number(p.page),p.bytes as Uint8Array);break;
              case "tools.pdfFinish": result=await localTools.pdfFinish(String(p.id),p.success===true);break;
              case "tools.open": result=await localTools.open(String(p.folder),shell.openPath);break;
              case "replica.import": {if(agent){result=await replicaService.importZip(String(p.path));break;}const r=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'复刻任务包',extensions:['zip']}]});result=r.canceled?null:await replicaService.importZip(r.filePaths[0]);break;}
              case "replica.list": result=replicaService.list();break;
              case "replica.update": result=replicaService.update(String(p.id),String(p.segmentId),p.draft as Draft);break;
              case "replica.preflight": result=await replicaService.preflight(String(p.id));break;
              case "replica.confirm": result=await replicaService.confirm(String(p.id),Number(p.revision));break;
              case "replica.submit": result=await replicaService.submit(String(p.id));break;
              case "packages.import": {
                if(agent){result=await taskPackageService.importZip(String(p.path));break;}
                const selected = await dialog.showOpenDialog(window, {
                  defaultPath: app.getPath("desktop"),
                  title: "选择 ChatGPT 标准任务包",
                  properties: ["openFile"],
                  filters: [{ name: "ChatGPT 复刻任务包", extensions: ["zip"] }],
                });
                result = selected.filePaths[0]
                  ? await taskPackageService.importZip(selected.filePaths[0])
                  : null;
                break;
              }
              case "replica.compile": {
                if(agent){result=await compileLocalTask(String(p.path),String(p.output),{tempRoot:join(root,"cache","task-compile"),wasmPath:join(app.getAppPath(),"resources","MediaInfoModule.wasm"),ffmpegPath:service.settings().ffmpegPath});break;}
                const selected=await dialog.showOpenDialog(window,{title:"选择已确认的编译方案",properties:["openFile"],filters:[{name:"JSON 方案",extensions:["json"]}]});
                if(!selected.filePaths[0]){result=null;break;}
                const saved=await dialog.showSaveDialog(window,{title:"保存标准任务包",defaultPath:join(app.getPath("desktop"),"吃个糖Agent-本地编译任务.zip"),filters:[{name:"ZIP 任务包",extensions:["zip"]}]});
                if(!saved.filePath){result=null;break;}
                const compiled=await compileLocalTask(selected.filePaths[0],saved.filePath,{tempRoot:join(root,"cache","task-compile"),wasmPath:join(app.getAppPath(),"resources","MediaInfoModule.wasm"),ffmpegPath:service.settings().ffmpegPath});
                result=compiled;
                break;
              }
              case "packages.compileTemplate": {
                if(agent){await copyFile(join(app.getAppPath(),"resources","workflow","本地任务编译模板_v1.0.json"),String(p.output),1);result=p.output;break;}
                const saved=await dialog.showSaveDialog(window,{title:"保存编译模板",defaultPath:join(app.getPath("desktop"),"本地任务编译模板_v1.0.json"),filters:[{name:"JSON 编译模板",extensions:["json"]}]});
                if(!saved.filePath){result=null;break;}
                await copyFile(join(app.getAppPath(),"resources","workflow","本地任务编译模板_v1.0.json"),saved.filePath);
                result=saved.filePath;break;
              }
              case "packages.list": {
                result = taskPackageService.list();
                break;
              }
              case "packages.detail": {
                result = taskPackageService.detail(String(p.sessionId || ""));
                break;
              }
              case "packages.update": {
                result = await taskPackageService.update(String(p.sessionId || ""), String(p.segmentId || ""), p.patch as {prompt?:string;params?:Record<string,unknown>});
                break;
              }
              case "packages.preflight": {
                result = await taskPackageService.preflight(String(p.sessionId || ""));
                break;
              }
              case "packages.confirm": {
                result = await taskPackageService.confirm(String(p.sessionId || ""), Number(p.revision));
                break;
              }
              case "packages.openFolder": {
                const path = taskPackageService.folder(String(p.sessionId || ""));
                const error = await shell.openPath(path);
                if (error) throw new Error(error);
                result = true;
                break;
              }
              case "packages.submit": {
                result = await taskPackageService.submit(String(p.sessionId || ""));
                break;
              }
              case "packages.discard": {
                if (
                  await confirm(
                    "清空当前导入的任务包草稿？已提交的付费记录和被其他任务使用的素材不会被删除。",
                  )
                )
                  result = await taskPackageService.discard(
                    String(p.sessionId || ""),
                  );
                else result = null;
                break;
              }
              case "packages.stage1Info": {
                result = stage1TemplateService.current();
                break;
              }
              case "packages.stage1Inspect": {
                if(agent){result=await stage1TemplateService.inspect(String(p.path));break;}
                const selected = await dialog.showOpenDialog(window, {
                  title: "选择第一阶段指令 (.md / .docx)", properties: ["openFile"],
                  filters: [{name:"指令文档",extensions:["md","docx"]}],
                });
                result = selected.filePaths[0] ? await stage1TemplateService.inspect(selected.filePaths[0]) : null;
                break;
              }
              case "packages.stage1Apply": {
                result = await stage1TemplateService.apply(String(p.token||""),p.allowLegacy===true);
                break;
              }
              case "packages.stage1Restore": {
                result = await stage1TemplateService.restore();
                break;
              }
              case "packages.exportGuide": {
                if(agent){const k=String(p.kind) as keyof typeof WORKFLOW_FILES|"spec";const target=String(p.output);if(k==="singleTemplate"||k==="multiTemplate")await copyFile(workflowFile(k),target,1);else await writeFile(target,k==="stage1"?stage1TemplateService.current().content:k==="spec"?packageGuide("spec"):readFileSync(workflowFile(k),"utf8"),{flag:"wx"});result=target;break;}
                if (!["stage1", "stage2", "converter", "spec", "singleTemplate", "multiTemplate"].includes(String(p.kind)))
                  throw new Error("未知文档类型");
                const kind = String(p.kind) as keyof typeof WORKFLOW_FILES | "spec";
                const filename = kind === "spec"
                  ? "吃个糖Agent_标准ZIP任务包规范_v1.2.0.md"
                  : WORKFLOW_FILES[kind];
                const binary = kind === "singleTemplate" || kind === "multiTemplate";
                const selection = await dialog.showSaveDialog(window, {
                  title: "保存到桌面（可更改位置）",
                  defaultPath: join(app.getPath("desktop"), filename),
                  filters: [{ name: binary ? "ZIP 任务包模板" : "Markdown 文档", extensions: [binary ? "zip" : "md"] }],
                });
                if (selection.filePath && !selection.canceled) {
                  if (binary) await copyFile(workflowFile(kind), selection.filePath);
                  else {
                    const content = kind === "stage1"
                      ? stage1TemplateService.current().content
                      : kind === "spec"
                      ? packageGuide("spec")
                      : readFileSync(workflowFile(kind), "utf8");
                    await writeFile(selection.filePath, content, "utf8");
                  }
                  result = selection.filePath;
                } else result = null;
                break;
              }
              case "bootstrap":
                result = service.bootstrap();
                break;
              case "draft.save":
                result = service.saveDraft(payload as Draft);
                break;
              case "draft.new":
                result = service.newDraft();
                break;
              case "draft.list":
                result = service.drafts.list();
                break;
              case "draft.load":
                result = service.drafts.get(String(p.id));
                break;
              case "draft.finishSubmitted":
                service.drafts.remove(String(p.id));
                result = true;
                break;
              case "draft.remove":
                if (
                  await confirm("确定删除这个未提交任务吗？素材文件不会删除。")
                ) {
                  service.drafts.remove(String(p.id));
                  result = true;
                } else result = false;
                break;
              case "accounts.test":
                result = await service.testAccount(
                  String(p.id),
                  p.modelId ? String(p.modelId) : undefined,
                );
                break;
              case "accounts.balance":
                result = await service.balance(String(p.id));
                break;
              case "billing.correct":
                service.billing.correct(
                  String(p.id),
                  p.amount as number | null,
                  String(p.note ?? ""),
                );
                result = true;
                break;
              case "billing.history":
                result = service.billing.history(String(p.id));
                break;
              case "billing.report":
                result = service.billing.report(p);
                break;
              case "draft.rename":
                result = service.drafts.rename(
                  String(p.id),
                  String(p.name ?? ""),
                );
                break;
              case "draft.get":
                result = service.db.get("draft", null);
                break;
              case "settings.save":
                result = await service.saveSettings(
                  payload as Partial<Settings>,
                );
                break;
              case "data.resetDefaults":
                if (String(p.confirmation) !== "恢复默认设置")
                  throw new Error("确认文字不正确，操作已取消。");
                if (
                  await confirm(
                    "确认恢复默认设置？仅清空窗口布局、工作台状态和界面偏好；API、素材记录、音色、Prompt、任务和成品都会保留。",
                  )
                )
                  result = service.resetDefaults();
                else result = false;
                break;
              case "data.factoryReset":
                if (String(p.confirmation) !== "确认重置")
                  throw new Error("请输入“确认重置”后再执行。");
                if (
                  await confirm(
                    `确认恢复出厂状态？将清空软件管理的数据库记录和 API 密钥；用户原始素材绝不会删除。生成成品：${p.deleteOutputs ? "移入可恢复备份区" : "保留"}。`,
                  )
                )
                  result = await service.factoryReset(Boolean(p.deleteOutputs));
                else result = false;
                break;
              case "projects.create":
                result = service.createProject(
                  String(p.name),
                  p.outputDir ? String(p.outputDir) : undefined,
                );
                break;
              case "models.save":
                result = service.updateModel(String(p.id), p as Partial<Model>);
                break;
              case "accounts.save":
                result = service.credentials.save(
                  payload as Partial<Account> & { key?: string },
                );
                break;
              case "accounts.reveal":
                result = service.credentials.getKey(String(p.id));
                break;
              case "library.list": {
                let warning="";
                try {if(!realSpeech){realSpeechInit ??= import("./realSpeech/service.ts").then(({RealSpeechService})=>new RealSpeechService(service.root,service)).catch(e=>{realSpeechInit=undefined;throw e;});realSpeech=await realSpeechInit;}await realSpeech.syncAssets();}catch(e){warning="真人口播数据／资产同步需要处理："+String(e);}
                result={...await libraryView(service,realSpeech,p,replicaService!.list(),taskPackageService!.list()),warning};break;
              }
              case "replica.manual": result=readFileSync(join(app.getAppPath(),"resources","docs","一键复刻使用手册.md"),"utf8");break;
              case "assets.list":
                result = await service.assets.list(payload as ListQuery);
                break;
              case "assets.get":
                result = service.assets.get(String(p.id));
                break;
              case "assets.thumbnail.ensure": {
                const asset=service.assets.get(String(p.id));service.thumbnails.enqueue(asset,p.force===true);
                await service.thumbnails.pending;result=service.assets.get(asset.id);break;
              }
              case "library.hide": {
                const ids=service.db.get<string[]>('library-hidden',[]);
                const id=String(p.id);
                service.db.set('library-hidden',p.hidden===false?ids.filter(x=>x!==id):[...new Set([...ids,id])]);
                if(p.hidden===false&&service.db.one('SELECT id FROM assets WHERE id=?',id)){const a=service.assets.get(id);service.assets.save({...a,libraryDeletedAt:null});}
                result={id,hidden:p.hidden!==false};service.changed();break;
              }
              case "assets.inspect":
                result = await service.assets.refreshMetadata(String(p.id));
                break;
              case "assets.import": {
                let paths = p.paths as string[] | undefined;
                if (!paths) {
                  const remembered = service.settings().lastImportDir;
                  const selection = await dialog.showOpenDialog(window, {
                    defaultPath:
                      remembered && existsSync(remembered)
                        ? remembered
                        : app.getPath("desktop"),
                    properties: ["openFile", "multiSelections"],
                    filters: [
                      {
                        name: "图片 / 视频 / 音频",
                        extensions:
                          p.kind === "audio"
                            ? ["wav", "mp3", "m4a", "aac", "flac", "ogg"]
                            : p.kind === "image"
                              ? ["jpg", "jpeg", "png", "webp", "bmp"]
                            : [
                                "jpg",
                                "jpeg",
                                "png",
                                "webp",
                                "bmp",
                                "mp4",
                                "mov",
                                "mp3",
                                "wav",
                                "m4a",
                                "aac",
                                "flac",
                                "ogg",
                              ],
                      },
                    ],
                  });
                  paths = selection.filePaths;
                  if (!selection.canceled && paths[0])
                    await service.saveSettings({
                      lastImportDir: dirname(paths[0]),
                    });
                }
                if (!Array.isArray(paths) || paths.length > 100)
                  throw new Error("一次最多导入 100 个文件。");
                result = [];
                for (const path of paths) {
                  const imported = await service.assets.import(
                    path,
                    p.copy === true,
                    p.projectId ? String(p.projectId) : null,
                  );
                  if (p.folder && !imported.duplicate) {
                    if (!service.folders.list().some((f) => f.id === p.folder))
                      throw new Error("目标文件夹不存在，请刷新后重试。");
                    imported.asset.folder = String(p.folder);
                    service.assets.save(imported.asset);
                  }
                  (result as unknown[]).push(imported);
                }
                service.changed();
                break;
              }
              case "assets.save": {
                const a = service.assets.get(String(p.id));
                for (const k of [
                  "name",
                  "folder",
                  "tags",
                  "favorite",
                  "projectId",
                  "remoteUrl",
                  "defaultUsage",
                ] as const)
                  if (k in p) Object.assign(a, { [k]: p[k] });
                service.assets.save(a);
                service.changed();
                result = a;
                break;
              }
              case "assets.relocate": {
                if(agent){result=await service.assets.relocate(String(p.id),String(p.path));break;}
                const asset = service.assets.get(String(p.id));
                const file = await dialog.showOpenDialog(window, {
                  defaultPath: existsSync(dirname(asset.originalPath))
                    ? dirname(asset.originalPath)
                    : app.getPath("desktop"),
                  properties: ["openFile"],
                });
                result = file.filePaths[0]
                  ? await service.assets.relocate(
                      String(p.id),
                      file.filePaths[0],
                    )
                  : null;
                break;
              }
              case "assets.relocateFolder": {
                if(agent){result=await service.assets.relocateFolder(String(p.id),String(p.path));service.changed();break;}
                const folder = await dialog.showOpenDialog(window, {
                  defaultPath: app.getPath("desktop"),
                  properties: ["openDirectory"],
                  title: "选择移动或改名后的素材文件夹",
                });
                result = folder.filePaths[0]
                  ? await service.assets.relocateFolder(
                      String(p.id),
                      folder.filePaths[0],
                    )
                  : null;
                service.changed();
                break;
              }
              case "assets.refresh":
                result = await service.assets.refresh();
                service.changed();
                break;
              case "assets.thumbnail": {
                const a = service.assets.get(String(p.id));
                const data = String(p.data);
                if (
                  data.length > 2000000 ||
                  !data.startsWith("data:image/png;base64,")
                )
                  throw new Error("缩略图无效");
                const img = nativeImage.createFromDataURL(data);
                if (img.isEmpty()) break;
                const path = join(root, "cache", "thumbnails", a.id + ".png");
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, img.resize({ width: 360 }).toPNG());
                a.thumbnailPath = path;
                service.assets.save(a);
                break;
              }
              case "assets.remove": {
                const id = String(p.id);
                if (
                  await confirm(
                    "仅从资产库移除此记录？电脑上的原始文件、任务引用和生成结果都会保留。",
                  )
                )
                  result = service.assets.removeRecords([id]);
                break;
              }
              case "assets.removeMany": {
                const ids = Array.isArray(p.ids)
                  ? p.ids.map(String).slice(0, 1000)
                  : [];
                if (!ids.length) throw new Error("请选择要移除的素材记录。");
                if (
                  await confirm(
                    `仅从资产库移除选中的 ${ids.length} 条记录？电脑上的原始文件、任务引用和生成结果都会保留。`,
                  )
                )
                  result = service.assets.removeRecords(ids);
                break;
              }
              case "prompts.list":
                result = service.prompts.list(payload as ListQuery);
                break;
              case "prompts.save":
                result = service.prompts.save(payload as Prompt);
                break;
              case "prompts.versions":
                result = service.prompts.versions(String(p.id));
                break;
              case "tasks.estimate":
                result = service.tasks.estimate(p as unknown as Draft);
                break;
              case "tasks.segment.plan":
                result = await service.tasks.segmentPlan(
                  (p.draft ?? payload) as Draft,
                );
                break;
              case "tasks.segment.create":
                result = await service.tasks.createSegmented(
                  p.draft as Draft,
                  String(p.requestId),
                );
                break;
              case "tasks.children":
                result = service.tasks.children(String(p.parentId));
                break;
              case "tasks.segment.retry":
                result = await service.tasks.retrySegment(
                  String(p.id),
                  String(p.requestId),
                );
                break;
              case "tasks.create":
                result = await service.tasks.create(
                  p.draft as Draft,
                  String(p.requestId),
                  undefined,
                  agent && p.deferQueue === true,
                );
                break;
              case "tasks.list":
                result = service.tasks.list(payload as ListQuery);
                break;
              case "tasks.get":
                result = service.tasks.get(String(p.id));
                break;
              case "tasks.versions":
                result = service.tasks.versions(String(p.id));
                break;
              case "tasks.clone":
                result = service.tasks.cloneDraft(
                  String(p.id),
                  Boolean(p.independent),
                );
                break;
              case "tasks.again": {
                result = await service.tasks.again(
                  String(p.id),
                  String(p.requestId),
                );
                break;
              }
              case "tasks.resume":
                result = service.tasks.resume(
                  String(p.id),
                  p.apiTaskId ? String(p.apiTaskId) : undefined,
                );
                break;
              case "tasks.cancel":
                result = await service.tasks.cancel(String(p.id));
                break;
              case "tasks.redownload":
                result =
                  service.tasks.get(String(p.id)).type === "audio"
                    ? service.audio.redownload(String(p.id))
                    : await service.tasks.redownload(String(p.id));
                break;
              case "tasks.refreshStatus":
                result = await service.tasks.refreshStatus(String(p.id));
                break;
              case "tasks.refreshAll":
                result = await service.tasks.refreshAll();                break;
              case "tasks.remove": {
                const task = service.tasks.get(String(p.id));
                if (service.audio.active.has(task.id))
                  throw new Error(
                    "配音正在执行，请完成后再删除，避免丢失结果。",
                  );
                service.tasks.removeRecord(task.id);
                result = true;
                break;
              }
              case "tasks.deleteOutput": {
                const t = service.tasks.get(String(p.id));
                if (
                  t.outputPath &&
                  (await confirm(
                    "将此输出文件移入回收站？任务、Prompt 和资产仍保留。",
                  ))
                ) {
                  await shell.trashItem(t.outputPath);
                  t.outputs = (t.outputs ?? []).filter(
                    (a) => a.localPath !== t.outputPath,
                  );
                  t.outputPath = null;
                  t.downloadStatus = "none";
                  service.tasks.save(t);
                }
                break;
              }
              case "statistics":
                result = service.statistics(
                  p as { from?: string; to?: string },
                );
                break;
              case "dialog.directory": {
                const r = await dialog.showOpenDialog(window, {
                  defaultPath: app.getPath("desktop"),
                  properties: ["openDirectory", "createDirectory"],
                });
                result = r.filePaths[0] ?? null;
                break;
              }
              case "dialog.confirm":
                result = await confirm(String(p.message));
                break;
              case "open": {
                let path: string;
                let openDirectory = false;
                if (p.assetId) {
                  const a = service.assets.get(String(p.assetId));
                  path = await service.assets.verify(a, false);
                } else if (p.taskId) {
                  const task = service.tasks.get(String(p.taskId));
                  path =
                    [task.outputPath, ...(task.outputs ?? []).map((item) => item.localPath)]
                      .find((candidate): candidate is string =>
                        Boolean(candidate && existsSync(candidate)),
                      ) || "";
                  if (p.folder && !path) {
                    const outputDir = service.resolvePath(
                      task.snapshot.draft.outputDir,
                    );
                    if (existsSync(outputDir)) {
                      path = outputDir;
                      openDirectory = true;
                    }
                  }
                } else
                  path =
                    p.kind === "logs"
                      ? join(root, "logs")
                      : p.kind === "data"
                        ? root
                        : service.settings().outputDir;
                if (!path) throw new Error("文件尚未下载。");
                if ((p.taskId || p.assetId) && !existsSync(path))
                  throw new Error(
                    p.taskId
                      ? "本地音频文件已丢失或路径失效，请先重新下载。"
                      : "原始素材文件已丢失，请在隐藏资产中重新定位。",
                  );
                if (p.folder && !openDirectory) shell.showItemInFolder(path);
                else {
                  const error = await shell.openPath(path);
                  if (error) throw new Error(error);
                }
                break;
              }
              case "backup":
                result = await service.db.backupTo(
                  join(
                    service.settings().backupDir!,
                    `AI-Video-${Date.now()}.sqlite`,
                  ),
                );
                break;
              default:
                throw new Error("不支持的操作。");
            }

        return result;
      }
      capabilityRegistry = new CapabilityRegistry(agentFilter);
      capabilityRegistry.registerWorkflow();
      registerDiscovery(capabilityRegistry,root);
      registerJobs(capabilityRegistry,root);
      capabilityRegistry.register({id:'runtime.status',description:'本机执行进程状态',service:'Application',effect:'read',inputSchema:{type:'object',additionalProperties:false},outputSchema:{type:'object'}},()=>({version:brand.version,pid:process.pid,headless,windowCount:BrowserWindow.getAllWindows().length,dataRoot:root,writerRecovery:releaseSpeechWriter?.recovered??null,queuePaused:service.settings().queuePaused}));
      capabilityRegistry.register({id:'runtime.stop',description:'任务空闲时关闭本机执行进程，须 confirm:true',service:'Application',effect:'destructive',inputSchema:{type:'object',additionalProperties:false},outputSchema:{type:'object'}},()=>{
        const active=service.db.one<{n:number}>("SELECT count(*) n FROM task_versions WHERE status IN ('Queued','Uploading','Submitting','Processing','Downloading')")?.n;
        if(active||transcriptionService.progress().busy||service.audio.cloning||service.audio.active.size||realSpeech?.active.size||realSpeechV2?.active.size)throw Error('仍有任务执行，先等待完成或取消');
        setTimeout(()=>{closing=true;app.quit();},200);return {stopping:true};
      });
      registerSpeechCapabilities(capabilityRegistry,(id,p)=>invokeSpeech(id,p,true));
      registerApplicationCapabilities(capabilityRegistry, (id,p) => invokeOperation(id,p,true));
      ipcMain.handle("ai-video", async (event, action: string, payload: unknown) => {
        try {
          if (headless || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error("不可信请求");
          return {ok:true,data:await invokeOperation(action,payload)};
        } catch(e) { const err=toError(e); service.logger.write("error","operation_failed",{action,code:err.code}); return {ok:false,error:err.message,code:err.code,details:err.details}; }
      });
      if (!headless) {
      await window.loadFile(join(__dirname, "renderer", "index.html"));
      }
      if(releaseSpeechWriter?.recovered) {await service.saveSettings({queuePaused:true});completeWriterRecovery(root,releaseSpeechWriter.recovered);service.logger.write('runtime','stale_writer_recovered',{backup:releaseSpeechWriter.recovered,queuePaused:true});}
      service.tasks.start();
      service.audio.start();
      if (!headless) try {
        tray = new Tray(
          nativeImage
            .createFromPath(join(app.getAppPath(), "resources", "brand.png"))
            .resize({ width: 16, height: 16 }),
        );
        tray.setToolTip(brand.name);
        tray.setContextMenu(
          Menu.buildFromTemplate([
            {
              label: "打开主界面",
              click: () => {
                window.show();
                window.restore();
                window.focus();
              },
            },
            { label: "退出软件", click: () => void requestQuit() },
          ]),
        );
        tray.on("double-click", () => {
          window.show();
          window.restore();
          window.focus();
        });
      } catch {
        service.logger.write("application", "tray_unavailable");
      }
      const getKey=service.credentials.getKey.bind(service.credentials);
      service.credentials.getKey=(id:string)=>{const key=getKey(id);agentFilter.remember(key);return key;};
      if(process.platform==='win32') {
        // Finish the normal GUI startup/recovery before accepting READ commands.
        speechControl();
        unregisterControl=await startControlBridge(root,app.getAppPath(),speechControl,()=>service.changed(),agentFilter,()=>{closing=true;app.quit();}, capabilityRegistry);
      }
      if(isolatedAcceptance&&!headless&&!process.argv.includes('--agent-control-manual-observation'))observeAcceptance(window,root,isolatedAcceptance.taskId,()=>{closing=true;app.quit();});
      service.logger.write("application", "started", {
        version: service.bootstrap().version,
      });
      if (!headless) window.on("close", (event) => {
        if (closing) return;
        event.preventDefault();
        if (
          service.settings().closeBehavior === "tray" &&
          tray &&
          !tray.isDestroyed()
        ) {
          window.hide();
          return;
        }
        void requestQuit();
      });
    })
    .catch((error) => {
      if (headless) console.error("后台启动失败", agentFilter.text(error instanceof Error?error.message:String(error)));
      else dialog.showErrorBox(
        brand.name,
        "启动失败，现有数据不会被重置。请检查目录权限与数据库版本。\n" +
          (error instanceof Error ? error.message : "未知错误"),
      );
      app.quit();
    });
  app.on("before-quit", (event) => {
    if (!closing && window && service) {
      event.preventDefault();
      void requestQuit();
    } else {
      void transcriptionService?.cancel();
      service?.tasks.stop();
      service?.audio.stop();
    }
  });
  app.on("will-quit", () => {
    try {
      if (service) service.thumbnails.stopped = true;
      stopSpeechWatch?.();
      unregisterControl?.();
      speechDocuments?.closeAll();
      realSpeechV2?.db.close();
      realSpeech?.close();
      service?.db.close();
    } catch {} finally {releaseSpeechWriter?.();releaseSpeechWriter=undefined;}
  });
  app.on("window-all-closed", () => app.quit());
}
const confirm = globalConfirm;
async function globalConfirm(message: string) {
  const r = await dialog.showMessageBox(window, {
    type: "question",
    message,
    buttons: ["取消", "确认"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return r.response === 1;
}

async function requestQuit() {
  if (quitPending || closing) return;
  quitPending = true;
  try {
    const running =
      service.db.one<{ n: number }>(
        "SELECT count(*) n FROM task_versions WHERE status IN ('Queued','Uploading','Submitting','Processing','Downloading')",
      )?.n || service.audio.cloning || realSpeech?.active.size || realSpeechV2?.active.size;
    if (running) window.show();
    if (
      running &&
      !(await confirm("当前有生成任务正在运行，退出可能中断任务，是否继续？"))
    )
      return;
    try {
      const saved = await window.webContents.executeJavaScript(
        "({video:window.__flushDraft?.(),audio:window.__audioDraft?.()})",
      );
      if (saved.video) service.saveDraft(saved.video as Draft);
      if (saved.audio) service.db.set("audioDraft", saved.audio);
    } catch {
      if (!(await confirm("工作区保存失败，是否仍然退出？"))) return;
    }
    closing = true;
    service.thumbnails.stopped = true;
    service.tasks.stop();
    service.audio.stop();
    tray?.destroy();
    speechDocuments?.closeAll();
    app.quit();
  } finally {
    quitPending = false;
  }
}
