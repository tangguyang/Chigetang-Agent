import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TaskPackageService} from '../src/main/services/taskPackage.ts';
import {WanAdapter} from '../src/main/models/adapters.ts';
import {models} from '../src/shared/catalog.ts';

const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const template=new URL('../resources/workflow/单任务测试模板_V2.2.zip',import.meta.url);
function fixture(root:string){
 const registry=new Map<string,any>(); let submissions=0;
 const model=structuredClone(models.find(m=>m.id==='wan3')!);
 const app:any={root,models:()=>[model],credentials:{list:()=>[{id:'a',name:'本地模拟账户',providerId:'alibaba',enabled:true,isDefault:true}]},settings:()=>({outputDir:root}),
  assets:{import:async(path:string)=>{const b=readFileSync(path),id=digest(b);const kind=path.endsWith('.jpg')?'image':path.endsWith('.mp4')?'video':'audio';const asset={id,name:path.split('/').at(-1),kind,originalPath:path,managedPath:null,size:b.length,mime:'test',hash:id,createdAt:'',lastUsedAt:null,tags:[],folder:'',projectId:null,favorite:false,width:kind==='audio'?undefined:720,height:kind==='audio'?undefined:1280,fps:kind==='video'?25:undefined,duration:kind==='video'?6:kind==='audio'?5:undefined,metadata:{detectedFormat:path.split('.').at(-1)}};asset.metadata.detectedFormat=path.split('.').at(-1);registry.set(id,asset);return {asset,duplicate:false};},refreshMetadata:async(id:string)=>registry.get(id),get:(id:string)=>registry.get(id)},
  tasks:{estimate:()=>({cost:{amount:1,currency:'CNY',kind:'estimate',note:''},breakdown:[]}),create:async()=>{submissions++;return {id:`task-${submissions}`,status:'Draft'};},resume:()=>{}},
 };
 return {app,registry,get submissions(){return submissions;}};
}

test('v125 recovery invalidates confirmation; inspected assets and compiled prompt correspond to bindings',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-v125-'));
 try{
  const env=fixture(root),first=new TaskPackageService(env.app),pack=await first.importZip(fileURLToPath(template));
  assert.equal(pack.segments[0].submission?.assets.length,6);
  assert.equal(pack.segments[0].submission?.assets[0].slot,'@Image1');
  assert(pack.segments[0].submission?.prompt.includes('视频1'));
  assert.equal(pack.segments[0].submission?.modelName,'Wan 3.0');
  assert.equal(pack.segments[0].submission?.accountName,'本地模拟账户');
  await first.confirm(pack.sessionId,pack.revision);
  const restarted=new TaskPackageService(env.app);
  const recovered=await restarted.restore(pack.sessionId);
  assert.equal(recovered.confirmed,false);
  assert.equal(recovered.segments[0].checked,false);
  assert.match(recovered.segments[0].issue??'',/重新预检/);
  assert.equal(env.submissions,0);
  await assert.rejects(restarted.submit(pack.sessionId),/重新确认|预检未通过/);
  const checked=await restarted.preflight(pack.sessionId);
  assert.equal(checked.segments[0].checked,true);
  assert.equal(checked.segments[0].submission?.assets.length,6);
  assert(checked.segments[0].submission?.assets.every(item=>item.hash===env.registry.get(item.assetId).hash));
  assert.equal(checked.segments[0].params.prompt_extend,false);
  const audio=checked.segments[0].submission!.assets.find(item=>item.role==='reference_audio')!;
  env.registry.get(audio.assetId).duration=20;
  const blocked=await restarted.preflight(pack.sessionId);
  assert.equal(blocked.segments[0].checked,false);
  assert.match(blocked.segments[0].issue??'',/时长不合规/);
  await assert.rejects(restarted.confirm(pack.sessionId,blocked.revision),/未通过/);
  assert.equal(env.submissions,0);
  env.registry.get(audio.assetId).duration=5;
  await restarted.update(pack.sessionId,'segment_001',{params:{prompt_extend:true}});
  const optedIn=await restarted.preflight(pack.sessionId);
  assert(optedIn.segments[0].warnings.some(w=>w.code==='prompt-extend-enabled'));
  await restarted.update(pack.sessionId,'segment_001',{params:{prompt_extend:false}});
  const safe=await restarted.preflight(pack.sessionId);
  assert.equal(safe.segments[0].warnings.length,0);
  await restarted.confirm(pack.sessionId,safe.revision);
  assert.equal((await restarted.submit(pack.sessionId)).length,1);
  assert.equal(env.submissions,1);
  await assert.rejects(restarted.submit(pack.sessionId),/不能重复/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('v125 missing prompt_extend is explicitly sent false without overriding intentional true',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-v125-default-'));
 try{
  const env=fixture(root),svc=new TaskPackageService(env.app),model=env.app.models()[0];
  const make=(params:Record<string,unknown>)=>(svc as any).makeDraft({task_name:'审查',shared:{params},assets:[]},model,'a',{id:'part',duration_seconds:5},{},'原样生成',new Map(),'1.2.0').draft;
  const draft=make({duration:5,audio:false,resolution:'720P',ratio:'9:16'});
  assert.equal(draft.params.prompt_extend,false);
  assert.equal(make({...draft.params,prompt_extend:true}).params.prompt_extend,true);
  const adapter=new WanAdapter({} as any,async()=> '');let sent:any;
  (adapter.provider as any).request=async(_snapshot:unknown,_key:string,_path:string,request:any)=>{sent=request.body;return {output:{task_id:'test-only'}}};
  await adapter.submitTask({draft,model,assets:[]} as any,'no-real-key',[]);
  assert.equal(sent.parameters.prompt_extend,false);
  assert.equal(sent.parameters.duration,5);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('v125 locked uncertain package is view-only after restart',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-v125-locked-'));
 try{
  const env=fixture(root),svc=new TaskPackageService(env.app),pack=await svc.importZip(fileURLToPath(template));
  const session=join(pack.folder,'session.json');const persisted=JSON.parse(readFileSync(session,'utf8'));
  persisted.state='submitting';writeFileSync(session,JSON.stringify(persisted));
  const rebooted=new TaskPackageService(env.app);
  const restored=await rebooted.restore(pack.sessionId);
  assert.equal(restored.state,'blocked');assert(existsSync(session));
  await assert.rejects(rebooted.submit(pack.sessionId),/状态不明/);
  assert.equal(env.submissions,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
