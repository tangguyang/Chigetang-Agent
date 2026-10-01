import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve('release/v1.3.0/吃个糖Agent-v1.3.0-Windows-x64-绿色版');
const reportDir=resolve('docs/v1.3.0-acceptance');mkdirSync(reportDir,{recursive:true});
const plan=JSON.parse(readFileSync('resources/real-speech-v2/examples/PLAN-MINIMAL-001.json','utf8'));
const port=19330;
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const proc=spawn(join(root,'吃个糖Agent.exe'),[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>','--disable-background-networking'],{env,stdio:'ignore',windowsHide:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function targets(){return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();}
async function connect(t){
 const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map();
 ws.onclose=()=>{for(const p of pending.values())p.reject(Error('CDP closed'));pending.clear();};
 ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);if(p){pending.delete(v.id);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}}};
 return {ws,call:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));})};
}
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+(r.exceptionDetails.exception?.description||''));return r.result.value;}
async function until(c,expression){for(let i=0;i<150;i++){if(await evaluate(c,expression))return;await wait(100);}throw Error('UI timeout: '+expression);}
const click=(c,text)=>evaluate(c,`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing/enabled button');b.click();return true;})()`);
let main;
try{
 let list;for(let i=0;i<200;i++){try{list=await targets();if(list.some(t=>t.url.startsWith('file:')))break;}catch{}await wait(100);}
 const target=list.find(t=>t.url.startsWith('file:'));assert(target,'No packaged renderer');assert(decodeURIComponent(target.url).includes(root.replaceAll('\\','/')),'Renderer outside final package');
 main=await connect(target);await until(main,'!!window.aiVideo && !!document.querySelector("button")');
 const bootstrap=await evaluate(main,`(async()=>{const b=await window.aiVideo.invoke('bootstrap');const a=b.accounts.find(a=>a.providerId==='alibaba');return {version:b.version,root:b.root,accountId:a?.id,region:a?.region,workspacePresent:!!a?.workspaceId,accountCount:b.accounts.length};})()`);
 assert.equal(bootstrap.version,'1.3.0');assert.equal(bootstrap.root,'D:\\吃个糖Agent数据库-v1.3.0');assert(bootstrap.accountId);assert.equal(bootstrap.region,'cn-beijing');assert(bootstrap.workspacePresent);
 const keyRead=await evaluate(main,`window.aiVideo.invoke('accounts.reveal',{id:${JSON.stringify(bootstrap.accountId)}}).then(k=>typeof k==='string'&&k.trim().length>0)`);assert.equal(keyRead,true);
 await click(main,'设置');await wait(100);await click(main,'模型与 API');await until(main,'document.body.innerText.includes("管理账户")');const accountUiVisible=await evaluate(main,'document.body.innerText.includes("API 账户") && document.body.innerText.includes("管理账户")');assert(accountUiVisible);
 await click(main,'真人口播');await until(main,'!!document.querySelector(".rs-v2-import select")');
 const versionVisible=await evaluate(main,'document.body.innerText.includes("v1.3.0")');assert(versionVisible,'Version not displayed');
 const voices=await evaluate(main,'[...document.querySelector(".rs-v2-import select").options].map(o=>({name:o.textContent,id:o.value}))');const voice=voices.find(v=>v.name==='黄明昊修正版');assert(voice,'Existing voice missing');
 await evaluate(main,`(()=>{const section=document.querySelector('.rs-v2-import');const name=section.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,'v1.3.0 最小Plan导入验收');name.dispatchEvent(new Event('input',{bubbles:true}));const select=section.querySelector('select');select.value=${JSON.stringify(voice.id)};select.dispatchEvent(new Event('change',{bubbles:true}));const text=section.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(text,${JSON.stringify(JSON.stringify(plan,null,2))});text.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
 await wait(250);await click(main,'导入并校验方案');await until(main,'document.body.innerText.includes("Plan：PLAN-MINIMAL-001")');
 await evaluate(main,'document.querySelector(".rs-v2-import input[type=checkbox]").click()');await wait(100);await click(main,'保存执行方案');await until(main,'!!document.querySelector(".rs-v2-window")');
 const tasks=await evaluate(main,"window.aiVideo.invoke('realSpeech:v2:list').then(r=>r.tasks.filter(t=>t.plan.planId==='PLAN-MINIMAL-001'))");assert(tasks.length>=1);const task=tasks[0];assert.deepEqual(task.plan,plan);assert.equal(task.windows[0].versions.length,0);assert.equal(task.windows[0].attempts.length,0);
 await evaluate(main,'document.querySelectorAll(".rs-v2-window details")[1].open=true');
 const body=await evaluate(main,'document.querySelector(".rs-v2-window").innerText');for(const field of ['GW001','这是验收示例。','仅原样连续文本基线','L0','LOW','"experimental": false','"instructionIntentCount": 0','"seed": 1234','"enabled": false','"lockedFields"'])assert(body.includes(field),field);
 await evaluate(main,'document.querySelector(".rs-v2-window").scrollIntoView({block:"start"})');await wait(100);
 const fieldsShot=await main.call('Page.captureScreenshot',{format:'png'});writeFileSync(join(reportDir,'plan-fields-runtime.png'),Buffer.from(fieldsShot.data,'base64'));
 await evaluate(main,'document.querySelector(".rs-v2-import").scrollIntoView({block:"start"})');
 const shot=await main.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(reportDir,'plan-minimal-runtime.png'),Buffer.from(shot.data,'base64'));
 await click(main,'使用手册');await wait(400);let docs=await targets();let docTarget=docs.find(t=>t.id!==target.id&&t.url.includes('/viewer/index.html'));assert(docTarget);const doc=await connect(docTarget);await until(doc,'!!document.getElementById("copy")');
 const original=readFileSync(join(root,'resources/app/resources/real-speech-v2/docs/manual.md'),'utf8');const documentRead=await evaluate(doc,'window.speechDocument.read()');assert.equal(documentRead.text,original);
 await evaluate(doc,'document.getElementById("copy").click()');await until(doc,'document.getElementById("copy").textContent.includes("已复制")');
 const top=await evaluate(doc,'document.querySelector("header").getBoundingClientRect().top');await evaluate(doc,'document.querySelector("main").scrollTop=10000');assert.equal(await evaluate(doc,'document.querySelector("header").getBoundingClientRect().top'),top);assert.equal(await evaluate(doc,'typeof require'),'undefined');
 await click(main,'使用手册');assert.equal((await targets()).filter(t=>t.url.includes('/viewer/index.html')).length,1);await click(main,'协议编译规范');await wait(300);assert.equal((await targets()).filter(t=>t.url.includes('/viewer/index.html')).length,2);
 await evaluate(main,'document.querySelector(".rs-v2-import input").focus();document.querySelector(".rs-v2-import input").click()');assert.equal(await evaluate(main,'document.activeElement===document.querySelector(".rs-v2-import input")'),true);
 const docShot=await doc.call('Page.captureScreenshot',{format:'png'});writeFileSync(join(reportDir,'document-runtime.png'),Buffer.from(docShot.data,'base64'));
 await evaluate(doc,'document.getElementById("close").click()').catch(()=>{});await wait(250);assert.equal((await targets()).filter(t=>t.url.includes('/viewer/index.html')).length,1);assert(await evaluate(main,'!!document.querySelector(".rs-v2-window")'));doc.ws.close();
 const compilerTarget=(await targets()).find(t=>t.url.includes('/viewer/index.html'));const compiler=await connect(compilerTarget);await evaluate(compiler,'document.getElementById("close").click()').catch(()=>{});compiler.ws.close();
 const report={version:'1.3.0',exe:join(root,'吃个糖Agent.exe'),pid:proc.pid,actualRendererUrl:target.url,protocol:{schema:task.plan.schema,protocolVersion:task.plan.protocolVersion,capabilityProfileId:task.plan.capabilityProfileId,capabilityVersion:task.plan.capabilityVersion},minimalPlan:'PASS',planUnchanged:true,displayFields:'PASS',voiceName:voice.name,credentialsLocallyDecryptable:keyRead,existingAccountUiVisible:accountUiVisible,workspaceExisting:true,region:bootstrap.region,dataRoot:bootstrap.root,independentDocuments:'PASS',fullMarkdownCopy:'PASS',fixedToolbar:'PASS',mainOperableWithDocuments:true,originalAudioVersionsCreated:0,paidTtsRequests:0,fee:0,networkProtection:'Dead loopback proxy during packaged acceptance; no generation actions',windows10:'NOT_TESTED'};
 writeFileSync(join(reportDir,'runtime.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS packaged EXE real UI / Plan 2.1 draft.3 exact preservation / real existing voice and local credentials / independent documents / zero generation');
 await main.call('Browser.close').catch(()=>{});main.ws.close();
}catch(e){console.error(String(e));if(main)main.ws.close();proc.kill();process.exitCode=1;}
