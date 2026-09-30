import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { models } from '../src/shared/catalog.ts';
import { TaskPackageService } from '../src/main/services/taskPackage.ts';
import { validateNoOverlayInstructions, validateTaskPackage } from '../src/shared/taskPackage.ts';
import { packageGuide } from '../src/shared/taskPackageDocs.ts';

const fixture=new URL('./fixtures/v120-valid-realmedia-17s.zip',import.meta.url);
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');

function appFor(root:string,options:{failImportAt?:number;failEstimate?:boolean;retainRollback?:boolean}={}) {
 const registry=new Map<string,any>();let imports=0,created=0,resumed=0;
 const app:any={root,db:{all:()=>[]},models:()=>[structuredClone(models.find(model=>model.id==='wan3')!)],
  credentials:{list:()=>[{id:'account',providerId:'alibaba',enabled:true,isDefault:true}]},settings:()=>({outputDir:root}),
  assets:{
   import:async(path:string)=>{imports++;if(imports===options.failImportAt)throw new Error('INJECT_ASSET_'+imports);const data=readFileSync(path),kind=path.endsWith('.jpg')?'image':path.endsWith('.mp4')?'video':'audio';const id='asset-'+imports+'-'+hash(data).slice(0,8);const asset={id,name:path.split('/').pop(),kind,originalPath:path,managedPath:null,size:data.length,mime:'test',hash:hash(data),createdAt:'',lastUsedAt:null,tags:[],folder:'',projectId:null,favorite:false,width:720,height:1280,fps:25,duration:kind==='video'?9.6:kind==='audio'?14:undefined,metadata:{detectedFormat:path.split('.').pop()}};registry.set(id,asset);return{asset,duplicate:false};},
   refreshMetadata:async(id:string)=>registry.get(id),get:(id:string)=>registry.get(id),
   rollbackUnreferencedImports:(items:Array<{id:string}>)=>{if(options.retainRollback)return{removed:[],retained:items.map(x=>x.id)};for(const item of items)registry.delete(item.id);return{removed:items.map(x=>x.id),retained:[]};}
  },
  tasks:{estimate:()=>{if(options.failEstimate)throw new Error('INJECT_DRAFT');return{cost:{amount:2,currency:'CNY',kind:'estimate',note:''},breakdown:[]};},create:async()=>({id:'task-'+(++created),status:'Draft'}),resume:()=>{resumed++;}}
 };
 return {app,registry,get imports(){return imports;},get created(){return created;},get resumed(){return resumed;}};
}

test('P0 final overlay matrix rejects same-clause 且/或 and mixed English positives',()=>{
 for(const text of ['添加字幕。','禁止字幕，请添加字幕。','禁止字幕且添加字幕。','不允许字幕或添加字幕。','No subtitles, but add captions.','禁止字幕 and overlay screen text.'])
  assert.throws(()=>validateNoOverlayInstructions(text),/附加字幕/);
 for(const text of ['禁止自动生成字幕、屏幕文字及水印。','Do not add subtitles or watermarks.'])
  assert.doesNotThrow(()=>validateNoOverlayInstructions(text));
});

test('P0 any conflicting segment blocks the complete task package',()=>{
 const manifest:any={schema_version:'1.2.0',package_type:'chigetang.wan-task',task_id:'overlay-group',task_name:'冲突组',engine:'wan3',assets:[],shared:{params:{duration:5,audio:false,resolution:'720P',ratio:'9:16'}},segments:[{id:'s1',order:1,prompt_file:'prompts/1.txt',duration_seconds:5},{id:'s2',order:2,prompt_file:'prompts/2.txt',duration_seconds:5}]};
 assert.throws(()=>validateTaskPackage(manifest,path=>path==='prompts/1.txt'||path==='prompts/2.txt',path=>path.endsWith('1.txt')?'禁止字幕。':'不允许字幕或添加字幕。'),/附加字幕/);
});

test('P0 stale async preflight cannot overwrite revision 2, cost validity or confirmation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-final-race-'));
 try{
  const env=appFor(root),input=join(root,'input.zip');writeFileSync(input,readFileSync(fixture));
  const service:any=new TaskPackageService(env.app),initial=await service.importZip(input),id=initial.sessionId;
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(done=>{release=done;}),begun=new Promise<void>(done=>{started=done;});
  let gated=true,announced=false;const originalRefresh=env.app.assets.refreshMetadata;
  env.app.assets.refreshMetadata=async(assetId:string)=>{if(gated){if(!announced){announced=true;started();}await gate;}return originalRefresh(assetId);};
  const stale=service.preflight(id);await begun;
  const updated=await service.update(id,'seg01',{prompt:initial.segments[0].prompt+' 保持写实。'});
  assert.equal(updated.revision,2);assert.equal(updated.segments[0].checked,false);assert.equal(updated.confirmed,false);
  release();const staleResult=await stale;
  assert.equal(staleResult.revision,2);assert.equal(staleResult.segments[0].checked,false);assert.match(staleResult.segments[0].issue,/重新预检/);
  const persisted=JSON.parse(readFileSync(join(updated.folder,'session.json'),'utf8'));assert.equal(persisted.tasks[0].revision,2);assert.equal(persisted.tasks[0].checkedRevision,0);
  await assert.rejects(service.confirm(id,1),/未通过|过期/);
  gated=false;const checked=await service.preflight(id);assert.equal(checked.segments[0].checked,true);
  await service.confirm(id,2);assert.equal(service.detail(id).confirmed,true);
  let releaseSubmit!:()=>void,startSubmit!:()=>void;const submitGate=new Promise<void>(done=>{releaseSubmit=done;}),submitBegun=new Promise<void>(done=>{startSubmit=done;});
  service.preflight=async()=>{startSubmit();await submitGate;return service.detail(id);};
  const submitting=service.submit(id);await submitBegun;
  await assert.rejects(service.update(id,'seg01',{params:{duration:16}}),/正在提交|状态未知/);
  releaseSubmit();await submitting;assert.equal(env.created,1);assert.equal(env.resumed,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

for(const [name,options,expectedImports] of [
 ['second asset',{failImportAt:2},2],['third asset',{failImportAt:3},3],['draft creation',{failEstimate:true},3],
] as const)test('P1 failed import rolls back unreferenced records and extracted files: '+name,async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-final-clean-'));
 try{
  const env=appFor(root,options),input=join(root,'input.zip');writeFileSync(input,readFileSync(fixture));const service=new TaskPackageService(env.app);
  await assert.rejects(service.importZip(input),/INJECT_/);assert.equal(env.imports,expectedImports);assert.equal(service.list().length,0);assert.equal(env.registry.size,0);
  const base=join(root,'projects','imported-task-packs');assert(!existsSync(base)||readdirSync(base).length===0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('P1 session persistence failure also rolls back and leaves no submittable session',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-final-persist-'));
 try{
  const env=appFor(root),input=join(root,'input.zip');writeFileSync(input,readFileSync(fixture));const service:any=new TaskPackageService(env.app);
  service.persist=async()=>{throw new Error('INJECT_PERSIST');};
  await assert.rejects(service.importZip(input),/INJECT_PERSIST/);assert.equal(service.list().length,0);assert.equal(env.registry.size,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('P1 uncertain ownership preserves only referenced extraction and writes a non-submittable marker',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-final-retain-'));
 try{
  const env=appFor(root,{failImportAt:2,retainRollback:true}),input=join(root,'input.zip');writeFileSync(input,readFileSync(fixture));const service=new TaskPackageService(env.app);
  await assert.rejects(service.importZip(input),/INJECT_ASSET_2/);assert.equal(service.list().length,0);
  const base=join(root,'projects','imported-task-packs'),folders=readdirSync(base);assert.equal(folders.length,1);
  const marker=JSON.parse(readFileSync(join(base,folders[0],'failed-import.json'),'utf8'));assert.equal(marker.submittable,false);assert.equal(marker.retainedAssetIds.length,1);assert(existsSync(marker.retainedPaths[0]));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('P1 restart marks an interrupted current-protocol import as non-submittable without deleting files',()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-final-restart-'));
 try{
  const folder=join(root,'projects','imported-task-packs','11111111-1111-4111-8111-111111111111');mkdirSync(folder,{recursive:true});
  const manifest={schema_version:'1.2.0',package_type:'chigetang.wan-task',task_id:'interrupted'};writeFileSync(join(folder,'manifest.json'),JSON.stringify(manifest));writeFileSync(join(folder,'partial.bin'),'preserve');
  const env=appFor(root);const service=new TaskPackageService(env.app);assert.equal(service.list().length,0);
  const marker=JSON.parse(readFileSync(join(folder,'failed-import.json'),'utf8'));assert.equal(marker.state,'interrupted');assert.equal(marker.submittable,false);assert(existsSync(join(folder,'partial.bin')));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('P0 three exported v1.2.0 documents exactly match their production functions',()=>{
 const base=new URL('../docs/v1.2.0/',import.meta.url);
 for(const [kind,file] of [['stage1','吃个糖Agent_第一阶段复刻指令_v1.2.0.md'],['stage2','吃个糖Agent_第二阶段复刻指令_v1.2.0.md'],['spec','吃个糖Agent_标准ZIP任务包规范_v1.2.0.md']] as const)
  assert.equal(readFileSync(new URL(file,base),'utf8'),packageGuide(kind));
});
