import React, { act } from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { RealSpeechService } from "../src/main/realSpeech/service.ts";
import Page from "../src/features/realSpeech/Page.tsx";

const dir=mkdtempSync(join(tmpdir(),"repair2-ui-"));
const service=new RealSpeechService(dir);
const tone=join(dir,"tone.wav");
execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","0.4","-c:a","pcm_s16le",tone],{windowsHide:true});
let task:any, copied="", reveals=0, paid=0, pending=0, failWindow="";
window.confirm=()=>true;
Object.assign(window,{aiVideo:{invoke:async(action:string,p:any={})=>{
  pending++; try { let result:any;
  switch(action.replace("realSpeech:","")) {
    case "list": return {tasks:service.list(),voices:[{id:"V1",name:"测试音色",status:"ready"}]};
    case "create": result=service.newTask(p);break;
    case "get": result=service.get(p.taskId);break;
    case "update": result=service.update(p);break;
    case "preview": return service.preview(p);
    case "apply": result=service.apply(p);break;
    case "generate": result=await service.generate(p,async(_snapshot,path)=>{paid++;if(p.windowId===failWindow)throw Object.assign(Error("测试未知结果"),{code:"SubmissionUnknown"});writeFileSync(path,readFileSync(tone));return {duration:0.4,sampleRate:48000};});break;
    case "feedback": result=service.feedback(p);break;
    case "export": {const out=service.exportTask(p,join(process.cwd(),"resources/docs"));copied=out.text;result=out.task;break;}
    case "concat": result=await service.concat(p);break;
    case "reveal": assert.ok(existsSync(service.output(p.taskId,p.resultId)));reveals++;return true;
    case "copy": copied=p.text;return true;
    default: throw Error("Unexpected "+action);
  }
  task=structuredClone(result);return structuredClone(result); } finally {pending--;}
}}});
const root=createRoot(document.getElementById("root")!);
const button=(text:string,scope:ParentNode=document)=>{
  const b=[...scope.querySelectorAll("button")].find(b=>b.textContent?.includes(text));
  assert.ok(b,text);return b;
};
const click=async(text:string,scope:ParentNode=document,allowError=false)=>{
  const b=button(text,scope);assert.equal(b.disabled,false,text+" should be enabled");
  await act(async()=>{b.click();await new Promise(r=>setTimeout(r,20));});
  while(pending) await act(async()=>{await new Promise(r=>setTimeout(r,30));});
  const alerts=[...document.querySelectorAll(".rs-error")].map(x=>x.textContent).filter(Boolean);
  if(!allowError) assert.deepEqual(alerts,[],text+": "+alerts.join(";"));
};
const change=async(el:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string)=>{
  const prototype=el.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:el.tagName==="SELECT"?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;
  await act(async()=>{Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(el,value);el.dispatchEvent(new window.Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));});
};
const labelled=(text:string,scope:ParentNode=document)=>{
  const label=[...scope.querySelectorAll("label")].find(l=>l.textContent?.includes(text));
  assert.ok(label,text);return label.querySelector("input,textarea,select")! as HTMLInputElement;
};
const card=(index:number)=>document.querySelectorAll(".rs-window")[index];
await act(async()=>root.render(<Page/>));
await change(document.querySelector("textarea")!,"第一句。第二句。第三句。");
await change(labelled("现有复刻音色"),"V1");
await click("创建任务");
const plan={schema:"REAL_SPEECH_PERFORMANCE_PLAN_V1",protocolVersion:"1.0",targetModel:"cosyvoice-v3.5-plus",planId:"ui-stage2",sourceText:task.originalText,globalDirection:"自然聊天",phrases:["第一句。","第二句。","第三句。"].map((text,i)=>({phraseId:`P00${i+1}`,text,salesAction:"解释",direction:"自然说",pace:"NORMAL",energy:"MEDIUM",emphasis:[],pauseAfter:"NONE"})),windows:[1,2,3].map(i=>({windowId:`GW00${i}`,phraseIds:[`P00${i}`],instruction:"自然面对镜头说。",rate:1,pitch:1,volume:50,seed:0,transitionPauseMs:0,pronunciation:[],rhythmBreaks:[]})),missingInputs:[]};
await change(document.querySelector("textarea[placeholder]")!,JSON.stringify(plan));
await click("导入并校验方案");
assert.ok(document.body.textContent?.includes("应用前变更预览"));
await click("确认应用方案");
await click("生成本段",card(0));
await click("生成所有未生成（2）");
assert.equal(paid,3);
console.log("PASS 黄金路径1：创建→阶段二校验预览应用→首段→其余段");
await change(labelled("本段实际表演方向",card(1)),"汉".repeat(41));
assert.equal(button("保存本段修改",card(1)).disabled,true);
assert.ok(button("保存本段修改",card(1)).textContent?.includes("Instruction 超过模型限制"));
await click("取消本段修改",card(1));
await change(labelled("发音与定点停顿",card(1)),"{invalid");
assert.equal(button("保存本段修改",card(1)).disabled,true);
await click("取消本段修改",card(1));
console.log("PASS 非法Instruction/JSON均可取消，禁用原因可见，无草稿死锁");
await change(labelled("导演演法",card(2)),"轻轻反问，收住句尾");
await change(labelled("销售力度（导演备注）",card(2)),"LOW");
await click("保存导演备注",card(2));
assert.equal(task.units[2].salesPressure,"LOW");
await change(labelled("本段实际表演方向",card(2)),"轻轻反问，自然收住句尾。");
await click("保存本段修改",card(2));
await click("重新生成本段",card(2));
assert.equal(task.windows[2].results.length,2);
const versions=card(2).querySelectorAll(".rs-version");
assert.ok(versions[0].textContent?.includes("rev2"));
await click("设为当前",versions[1]);
assert.equal(task.windows[2].selectedRevision,1);
await click("打开音频文件位置",card(2));
console.log("PASS 黄金路径2：导演/Instruction人工保存→rev2→rev1保留→切回rev1");
await change(labelled("诊断范围"),"GW003");
await change(labelled("最明显的不自然发生在哪一句"),"句尾还太生硬");
await click("保存并复制优化请求给 ChatGPT");
assert.ok(copied.includes("只优化窗口 GW003"));
const before=structuredClone(task.windows.slice(0,2));
const local={schema:"CHATGPT_EXECUTION_PLAN_V1",protocolVersion:"1.2",capabilitiesVersion:1,planId:"ui-local",taskId:task.taskId,taskRevision:task.taskRevision,exportId:task.exportId,contextHash:task.contextHash,action:"UPDATE_ONLY",targets:{windowIds:["GW003"],unitIds:[]},changes:[{scope:"WINDOW",targetId:"GW003",field:"instruction",value:"自然聊天，句尾轻松收住。"}],keepUnchanged:[],repair:{mode:"NONE",windowIds:[],unitIds:[]},regenerate:false,reconcat:false,validationFocus:[],missingInputs:[]};
await change(document.querySelector("textarea[placeholder]")!,JSON.stringify(local));
await click("导入并校验方案");await click("确认应用方案");
assert.deepEqual(task.windows.slice(0,2),before);
await click("重新生成本段",card(2));
console.log("PASS 黄金路径3：本段诊断保存复制→局部修订→其他段不变→重生成");
await change(labelled("原稿"),"第一句。第二句改。第三句。");
await click("保存并重新解析原稿");
assert.equal(task.units[0].phraseId,"P001");assert.equal(task.units[1].phraseRevision,2);
assert.deepEqual(task.windows[0],before[0]);
await click("重新生成本段",card(1));
console.log("PASS 黄金路径4：改一句→局部解析→身份/历史保留→继续生成");
await click("拼接 / 更新完整WAV");
assert.ok(existsSync(task.final.path));assert.equal(task.final.sampleRate,48000);
await click("打开完整音频位置");
assert.ok(reveals>=2);
console.log("PASS 黄金路径5：当前版本→真实FFmpeg拼接48kPCM→文件位置");
if ((window as any).captureWorkflow) await (window as any).captureWorkflow();
for(const index of [0,1]) {
  await change(labelled("本段实际表演方向",card(index)),"重新解释，放松一点。");
  await click("保存本段修改",card(index));
}
failWindow="GW001";
await click("重新生成所有待更新（2）",document,true);
assert.equal(task.windows[0].status,"unknown_result");
assert.equal(task.windows[1].status,"generated");
assert.ok(document.body.textContent?.includes("未自动重试"));
assert.equal(button("重新生成本段",card(0)).disabled,true);
assert.ok(button("重新生成本段",card(0)).textContent?.includes("核对云端计费"));
console.log("PASS 批量一段未知结果后其他段继续；未知段保留计费确认保护");
await act(async()=>root.unmount());service.close();
console.log("RESULT 五条黄金路径通过；模拟TTS音源，不代表真人听感或真实付费云端验收");
