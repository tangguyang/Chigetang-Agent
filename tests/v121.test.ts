import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { models } from '../src/shared/catalog.ts';
import { collectTaskPackageIssues, formatTaskPackageIssues, packageDeclaredPaths, validateTaskPackage } from '../src/shared/taskPackage.ts';
import { SafeTaskZip, TaskPackageService } from '../src/main/services/taskPackage.ts';

const workflow=new URL('../resources/workflow/',import.meta.url);
const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex');

function parseTemplate(name:string) {
 const zip=new SafeTaskZip(readFileSync(new URL(name,workflow)));
 const manifest=validateTaskPackage(JSON.parse(zip.read('manifest.json').toString('utf8')),path=>zip.has(path),path=>zip.read(path).toString('utf8'));
 const declared=packageDeclaredPaths(manifest);
 assert.deepEqual(new Set(zip.paths()),declared);
 for(const asset of manifest.assets)assert.equal(digest(zip.read(asset.path)),asset.sha256,asset.id);
 return manifest;
}

test('v1.2.2 bundled templates keep schema 1.2.0 and preserve multi-material bindings',()=>{
 const single=parseTemplate('单任务测试模板_V2.2.zip'),multi=parseTemplate('多任务测试模板_V2.2.zip');
 assert.equal(single.segments.length,1);assert.equal(multi.segments.length,3);
 assert.equal(single.schema_version,'1.2.0');assert.equal(multi.schema_version,'1.2.0');
 const bindings=single.segments[0].bindings!;
 assert.deepEqual(Object.keys(bindings),['person','person_side','motion','motion_detail','voice','voice_tone']);
 assert.deepEqual(single.assets.reduce((count,asset)=>(count[asset.type]++,count),{image:0,video:0,audio:0}),{image:2,video:2,audio:2});
 for(const manifest of [multi])for(const segment of manifest.segments) {
  assert(Number.isInteger(segment.duration_seconds));
  assert(segment.bindings?.person?.startsWith('person.'));
  assert(segment.bindings?.motion?.startsWith('motion.'));
  assert(segment.bindings?.voice?.startsWith('voice.'));
 }
 assert.deepEqual(multi.segments.map(segment=>segment.duration_seconds),[10,10,11]);
 assert.equal(new Set(multi.segments.flatMap(segment=>Object.values(segment.bindings!))).size,9);
});

test('v1.2.2 import lint reports every detectable mismatch in one response',()=>{
 const manifest:any={schema_version:'1.2.0',package_type:'chigetang.wan-task',task_id:'bad-pack',task_name:'',engine:'wrong',
  assets:[{id:'person.01',type:'audio',path:'assets/person.jpg',usage:'analysis_only',sha256:'bad'}],
  shared:{params:{duration:10.5,audio:'yes',resolution:'4K',ratio:'2:1'},bindings:{person:'person.99'}},
  segments:[{id:'segment_001',order:2,prompt_file:'prompts/001.txt',duration_seconds:10.5,bindings:{motion:'motion.99',voice:'voice.99'}}]};
 const issues=collectTaskPackageIssues(manifest,path=>path==='prompts/001.txt',()=>'参考 @person @motion @voice，请添加字幕。');
 assert(issues.length>=10,issues.join('\n'));
 const message=formatTaskPackageIssues(issues);
 assert.match(message,/共发现 \d+ 项问题/);
 for(const expected of ['person.99','motion.99','voice.99','输出时长','字幕'])assert(message.includes(expected),expected);
});

test('v1.2.2 one-click page is empty by default, keeps Prompt read-only and persists supported params',()=>{
 const source=readFileSync(new URL('../src/renderer/pages/OneClick.tsx',import.meta.url),'utf8');
 assert.match(source,/\['duration','audio','ratio','resolution','seed','watermark','prompt_extend'\]/);
 assert.doesNotMatch(source,/patch:\{prompt,params\}/);
 assert.doesNotMatch(source,/'packages\.list'/);
 assert.doesNotMatch(source,/<textarea/);
 assert.match(source,/oneclick-prompt-snapshot/);
});

function fakeApplication(root:string) {
 const registry=new Map<string,any>(),byHash=new Map<string,any>();let taskNumber=0;
 const model=structuredClone(models.find(item=>item.id==='wan3')!);
 const app:any={root,models:()=>[model],credentials:{list:()=>[{id:'account',providerId:model.providerId,enabled:true,isDefault:true}]},settings:()=>({outputDir:root}),
  assets:{
   import:async(path:string)=>{const bytes=readFileSync(path),hash=digest(bytes),existing=byHash.get(hash);if(existing)return {asset:existing,duplicate:true};const kind=path.endsWith('.jpg')?'image':path.endsWith('.mp4')?'video':'audio';const asset={id:'asset-'+(registry.size+1),name:path.split('/').pop(),kind,originalPath:path,managedPath:null,size:bytes.length,mime:'test',hash,createdAt:'',lastUsedAt:null,tags:[],folder:'',projectId:null,favorite:false,width:kind==='audio'?undefined:720,height:kind==='audio'?undefined:1280,fps:kind==='video'?25:undefined,duration:kind==='video'?6:kind==='audio'?5:undefined,metadata:{detectedFormat:path.split('.').pop()}};registry.set(asset.id,asset);byHash.set(hash,asset);return {asset,duplicate:false};},
   refreshMetadata:async(id:string)=>registry.get(id),get:(id:string)=>registry.get(id),
   rollbackUnreferencedImports:(items:Array<{id:string;expectedOriginalPath:string}>)=>{const removed:string[]=[];for(const item of items){const asset=registry.get(item.id);if(asset?.originalPath===item.expectedOriginalPath){registry.delete(item.id);byHash.delete(asset.hash);removed.push(item.id);}}return {removed,retained:items.map(item=>item.id).filter(id=>!removed.includes(id))};},
  },
  tasks:{estimate:()=>({cost:{amount:1,currency:'CNY',kind:'estimate',note:''},breakdown:[]}),create:async()=>({id:'task-'+(++taskNumber),status:'Draft'}),resume:()=>{}},
 };
 return {app,registry};
}

test('v1.2.2 imports all material types, persists sound toggle and safely opens a fresh round',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-v121-'));
 try {
  const first=fakeApplication(root),clearService=new TaskPackageService(first.app);
  const templatePath=fileURLToPath(new URL('单任务测试模板_V2.2.zip',workflow));
  const clearPack=await clearService.importZip(templatePath);
  assert.deepEqual(clearPack.segments[0].mapping.map(item=>item.slot),['@Image1','@Image2','@Video1','@Video2','@Audio1','@Audio2']);
  assert.equal(clearPack.segments[0].params.audio,true);
  const updated=await clearService.update(clearPack.sessionId,'segment_001',{params:{audio:false}});
  assert.equal(updated.segments[0].params.audio,false);
  assert(existsSync(clearPack.folder));assert.equal(clearService.list().length,1);
  const cleared=await clearService.discard(clearPack.sessionId);
  assert.equal(cleared.removed,true);assert.equal(clearService.list().length,0);assert(!existsSync(clearPack.folder));assert.equal(first.registry.size,0);

  const second=fakeApplication(root),roundService=new TaskPackageService(second.app);
  const initial=await roundService.importZip(templatePath);
  await roundService.confirm(initial.sessionId,initial.revision);
  await roundService.submit(initial.sessionId);
  const next=await roundService.importZip(templatePath);
  assert.equal(next.renewedTaskId,true);assert.equal(next.sourceTaskId,initial.sourceTaskId);assert.notEqual(next.taskId,initial.taskId);
  assert.equal(next.state,'ready');
 } finally {rmSync(root,{recursive:true,force:true});}
});
