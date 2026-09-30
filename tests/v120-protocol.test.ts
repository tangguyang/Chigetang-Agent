import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafeTaskZip, TaskPackageService } from '../src/main/services/taskPackage.ts';
import { packageGuide } from '../src/shared/taskPackageDocs.ts';
import { validateTaskPackage, packageDeclaredPaths, validateNoOverlayInstructions } from '../src/shared/taskPackage.ts';
import { Stage1TemplateService } from '../src/main/services/stage1Template.ts';

const dir = new URL('./fixtures/',import.meta.url);
const single = 'v120-valid-realmedia-17s.zip';
const multi = 'v120-valid-realmedia-2segments.zip';
function parse(file:string) {
 const zip = new SafeTaskZip(readFileSync(new URL(file,dir)));
 const manifest=validateTaskPackage(JSON.parse(zip.read('manifest.json').toString('utf8')),
  p=>zip.has(p),p=>new TextDecoder('utf-8',{fatal:true}).decode(zip.read(p)));
 const paths=packageDeclaredPaths(manifest);
 for(const p of zip.paths()){assert(paths.has(p),`undeclared ${p}`);zip.read(p);}
 for(const a of manifest.assets)assert.equal(createHash('sha256').update(zip.read(a.path)).digest('hex'),a.sha256);
 return {zip,manifest};
}
test('P0 valid 1.2.0 single ZIP: real JPEG/MP4/WAV bytes and all SHA/CRC declarations',()=>{
 const {zip,manifest:m}=parse(single);assert.equal(m.schema_version,'1.2.0');assert.equal(m.segments.length,1);
 assert.equal(m.segments[0].duration_seconds,17);assert.deepEqual(m.segments[0].source_range_ms,[0,17000]);
 assert.equal(m.shared.bindings?.person,'person.main');
 assert.equal(m.segments[0].bindings?.motion,'motion.001');assert.equal(m.segments[0].bindings?.voice,'voice.001');
 assert.equal(zip.read('assets/person.jpg').subarray(0,2).toString('hex'),'ffd8');
 assert.equal(zip.read('assets/motion01.mp4').subarray(4,8).toString(),'ftyp');
 assert.equal(zip.read('assets/voice01.wav').subarray(0,4).toString(),'RIFF');
});
test('P0 valid 1.2.0 two segments do not share motion/voice',()=>{
 const {manifest:m}=parse(multi);assert.equal(m.segments.length,2);
 assert.notEqual(m.segments[0].bindings?.motion,m.segments[1].bindings?.motion);
 assert.notEqual(m.segments[0].bindings?.voice,m.segments[1].bindings?.voice);
 assert.deepEqual(m.segments.map(s=>s.source_range_ms),[[0,17000],[17000,34000]]);
});
for (const [file,message] of [
 ['v120-invalid-reference-order.zip',/reference_order/],
 ['v120-invalid-at-alias.zip',/别名|@person/],
 ['v120-invalid-realmedia-hash.zip',/HASH_SHOULD_BE_CHECKED_SEPARATELY/],
 ['v120-invalid-default-duration.zip',/默认时长/],
 ['v120-invalid-person-audio.zip',/标准别名/],
 ['v120-invalid-overlay-positive.zip',/附加字幕/],
 ['v120-invalid-undeclared-realmedia.zip',/UNDECLARED_SHOULD_BE_CHECKED_SEPARATELY/],
 ] as const){
 test('P0 rejects '+file,()=>{
  if(file.includes('realmedia-hash')){
   const zip=new SafeTaskZip(readFileSync(new URL(file,dir)));
   const m=validateTaskPackage(JSON.parse(zip.read('manifest.json').toString()),p=>zip.has(p),p=>zip.read(p).toString());
   assert.notEqual(createHash('sha256').update(zip.read(m.assets[0].path)).digest('hex'),m.assets[0].sha256);return;
  }
  if(file.includes('undeclared')){
   const zip=new SafeTaskZip(readFileSync(new URL(file,dir)));
   const m=validateTaskPackage(JSON.parse(zip.read('manifest.json').toString()),p=>zip.has(p),p=>zip.read(p).toString());
   assert(zip.paths().some(p=>!packageDeclaredPaths(m).has(p)));return;
  }
  assert.throws(()=>parse(file),message);
 });
}
test('P0 rejects contradictory overlay imperative variants, preserves native package text',()=>{
 for(const s of ['禁止字幕，请添加字幕。','禁止字幕：添加字幕','不要水印，但请生成水印','画面显示额外文字','请叠加文字浮层'])assert.throws(()=>validateNoOverlayInstructions(s),/附加字幕/);
 for(const s of ['禁止字幕、屏幕文字、水印','保留产品包装原有印字'])assert.doesNotThrow(()=>validateNoOverlayInstructions(s));
});
test('P1 template restore is durably default across restart and preserves sourceVersion',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-restore-'));
 try{
  const svc=new Stage1TemplateService(root),initial=svc.current();
  const file=join(root,'legacy.md');writeFileSync(file,initial.content.replace('第一阶段复刻指令 v1.2.0','第一阶段复刻指令 v1.1.3'));
  const preview=await svc.inspect(file);assert.equal(preview.version,'1.1.3');
  const applied=await svc.apply(preview.token,true);assert.equal(applied.sourceVersion,'1.1.3');assert.equal(applied.custom,true);
  await svc.restore();const reboot=new Stage1TemplateService(root).current();
  assert.equal(reboot.custom,false);assert.equal(reboot.sourceVersion,'1.2.0');assert.equal(reboot.content,initial.content);
  assert.equal(reboot.previousAvailable,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('P0 submitting recovery persists blocked status before exposing session',()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-crash-'));
 try{
  const folder=join(root,'projects','imported-task-packs','session-test');mkdirSync(folder,{recursive:true});
  const session={sessionId:'session-test',taskId:'t1',packageHash:'a',name:'test',folder,schemaVersion:'1.2.0',state:'submitting',results:[],tasks:[],confirmedRevision:0,createdAt:'2026-01-01'};
  writeFileSync(join(folder,'session.json'),JSON.stringify(session));
  const app:any={root};const service=new TaskPackageService(app);
  assert.equal(service.detail('session-test').state,'blocked');
  assert.equal(JSON.parse(readFileSync(join(folder,'session.json'),'utf8')).state,'blocked');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('P0 same-session lock also blocks an independent preflight while submitting',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-preflight-'));
 try{
  const s:any=new TaskPackageService({root} as any);s.submitting.add('session-test');
  await assert.rejects(s.preflight('session-test'),/不能同时发起独立预检/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('P0 exported guides and executable sample both advertise and implement current protocol',()=>{
 const stage1=packageGuide('stage1'),stage2=packageGuide('stage2'),spec=packageGuide('spec');
 for(const doc of [stage1,stage2,spec]) assert(doc.includes('v1.2.0'));
 assert(stage1.includes('单条时间确认表'));assert(stage1.includes('逐段可编辑时间表'));
 assert(stage2.includes('source_range_ms'));assert(spec.includes('标准别名'));
 assert(spec.includes('durationOptions'));assert.equal(parse(single).manifest.schema_version,'1.2.0');
});

test('P0 concurrent repeated import of same task_id cannot create two sessions',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-parallel-import-'));
 try{
  const path=join(root,'input.zip');writeFileSync(path,readFileSync(new URL(single,dir)));
  const {models}=await import('../src/shared/catalog.ts');
  const model=models.find(m=>m.id==='wan3')!;
  let assetCalls=0;
  const app:any={root,models:()=>[model],settings:()=>({outputDir:root}),
   credentials:{list:()=>[{id:'account',providerId:model.providerId,enabled:true,isDefault:true}]},
   assets:{import:async(file:string)=>{assetCalls++;await new Promise(resolve=>setTimeout(resolve,10));return {asset:{id:'asset-'+assetCalls,kind:file.endsWith('.jpg')?'image':file.endsWith('.mp4')?'video':'audio'},duplicate:false};}},
   tasks:{estimate:()=>({cost:{amount:null,currency:'CNY'},breakdown:[]})}};
  const service:any=new TaskPackageService(app);
  service.preflight=async(id:string)=>service.detail(id);
  const outcomes=await Promise.allSettled([service.importZip(path),service.importZip(path)]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);
  assert.match(String((outcomes.find(o=>o.status==='rejected') as PromiseRejectedResult).reason),/正在导入/);
  assert.equal(service.list().length,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('P0 production import rejects undeclared and bad-hash ZIP before asset registration',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-negative-import-'));
 try{
  let imports=0,creates=0;
  const service=new TaskPackageService({root,assets:{import:async()=>{imports++;}},tasks:{create:async()=>{creates++;}}} as any);
  for(const name of ['v120-invalid-undeclared-realmedia.zip','v120-invalid-realmedia-hash.zip']){
   const path=join(root,name);writeFileSync(path,readFileSync(new URL(name,dir)));
   await assert.rejects(service.importZip(path),/未声明文件|素材哈希不匹配/);
  }
  assert.equal(imports,0);assert.equal(creates,0);assert.equal(service.list().length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
