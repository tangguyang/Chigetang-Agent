import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SafeTaskZip,TaskPackageService} from '../src/main/services/taskPackage.ts';
import {TASK_PACKAGE_VERSION,TASK_PACKAGE_LIMITS,validateTaskPackage,taskPackageTokens,validatePromptBindings} from '../src/shared/taskPackage.ts';
import {packageGuide} from '../src/shared/taskPackageDocs.ts';
import {models} from '../src/shared/catalog.ts';
function crc32(buffer:Buffer){let crc=0xffffffff;for(const b of buffer){crc^=b;for(let k=0;k<8;k++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}return(crc^0xffffffff)>>>0;}
function zip(files:Record<string,Buffer|string>){const locals:Buffer[]=[],centrals:Buffer[]=[];let offset=0,count=0;for(const [name,data] of Object.entries(files)){
 const bytes=Buffer.isBuffer(data)?data:Buffer.from(data),label=Buffer.from(name),crc=crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(label.length,26);
 central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(label.length,28);central.writeUInt32LE(offset,42);
 locals.push(local,label,bytes);centrals.push(central,label);offset+=local.length+label.length+bytes.length;count++;
 }const idx=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(idx.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,idx,end]);}
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const prompt='参考 @person 与 @motion，按 @voice 还原本段表演，禁止字幕和屏幕文字；手部没有美甲、戒指、手镯。';
function fixture(two=false) {
 const person=Buffer.from('fixture-image'),video=Buffer.from('fixture-video'),voice=Buffer.from('fixture-audio');
 const assets=[{id:'person.main',type:'image',path:'assets/person.jpg',usage:'wan_reference',sha256:hash(person)},
 {id:'motion.001',type:'video',path:'assets/video.mp4',usage:'wan_reference',sha256:hash(video)},
 {id:'voice.001',type:'audio',path:'assets/voice.wav',usage:'wan_reference',sha256:hash(voice)}];
 const segments=[{id:'seg1',order:1,prompt_file:'prompts/001.txt',duration_seconds:17,bindings:{motion:'motion.001',voice:'voice.001'}}];
 const files:Record<string,Buffer|string>={'assets/person.jpg':person,'assets/video.mp4':video,'assets/voice.wav':voice,'prompts/001.txt':prompt};
 if(two){const v=Buffer.from('different-video'),a=Buffer.from('different-audio');assets.push({id:'motion.002',type:'video',path:'assets/video2.mp4',usage:'wan_reference',sha256:hash(v)},{id:'voice.002',type:'audio',path:'assets/voice2.wav',usage:'wan_reference',sha256:hash(a)});files['assets/video2.mp4']=v;files['assets/voice2.wav']=a;
 segments.push({id:'seg2',order:2,prompt_file:'prompts/002.txt',duration_seconds:17,bindings:{motion:'motion.002',voice:'voice.002'}});files['prompts/002.txt']=prompt;}
 const manifest:any={schema_version:TASK_PACKAGE_VERSION,package_type:'chigetang.wan-task',task_id:'v120-test-001',task_name:'协议正例',engine:'wan3',assets,shared:{params:{duration:17,resolution:'720P',ratio:'9:16',audio:false,seed:-1},bindings:{person:'person.main'}},segments};
 files['manifest.json']=JSON.stringify(manifest);return{files,manifest};
}
const read=(files:Record<string,Buffer|string>)=>{const z=new SafeTaskZip(zip(files));return validateTaskPackage(JSON.parse(z.read('manifest.json').toString()),p=>z.has(p),p=>z.read(p).toString());};
test('v120 contract: version/limits/exported docs reflect machine definitions',()=>{
 const spec=packageGuide('spec'),guide=packageGuide('stage1');
 assert(spec.includes('schema_version: "1.2.0"'));assert(spec.includes(`${TASK_PACKAGE_LIMITS.assets} 项`));
 assert(spec.includes('reference_order'));assert(spec.includes('bindings 的键是不带 @'));
 assert(guide.includes('第一阶段时间表'));assert(guide.includes('无字幕'));assert(guide.includes('镜头表'));
 assert.equal(read(fixture().files).schema_version,TASK_PACKAGE_VERSION);
});
test('v120 reject @ binding key, unknown shared field and undeclared file',()=>{
 const one=fixture();one.manifest.shared.bindings={'@person':'person.main'};one.files['manifest.json']=JSON.stringify(one.manifest);
 assert.throws(()=>read(one.files),/bindings.*@person|别名不合法/);
 const two=fixture();two.manifest.shared.reference_order=['person','motion','voice'];two.files['manifest.json']=JSON.stringify(two.manifest);
 assert.throws(()=>read(two.files),/reference_order/);
 const three=fixture();three.files['analysis/extra.md']='not declared';const z=new SafeTaskZip(zip(three.files));const m=validateTaskPackage(JSON.parse(z.read('manifest.json').toString()),p=>z.has(p),p=>z.read(p).toString());
 const declared=new Set(['manifest.json',...m.assets.map(x=>x.path),...m.segments.map(x=>x.prompt_file)]);
 assert(z.paths().some(p=>!declared.has(p)));
});
test('v120 alias parsing supports Chinese, overlap, escaped @@, and rejects adjacent longer token',()=>{
 const refs={person:'person.main',motion:'motion.001',voice:'voice.001',人物母图:'person.main'};
 assert.deepEqual(taskPackageTokens('@@not @person，@人物母图。@motion @voice @person'),['@person','@人物母图','@motion','@voice','@person']);
 assert.deepEqual(validatePromptBindings('@person @motion @voice @人物母图',refs),['@person','@motion','@voice','@人物母图']);
 assert.throws(()=>validatePromptBindings('@person后续 @motion @voice @人物母图',refs),/未绑定素材/);
});
test('v120 SHA, ZIP CRC, path and duplicate limits reject without task creation',()=>{
 const one=fixture();one.manifest.assets[0].sha256='f'.repeat(64);one.files['manifest.json']=JSON.stringify(one.manifest);
 const z=new SafeTaskZip(zip(one.files));assert.notEqual(hash(z.read('assets/person.jpg')),one.manifest.assets[0].sha256);
 assert.throws(()=>new SafeTaskZip(zip({'../escape.mp4':'wrong'})),/路径/);
 const data=zip(fixture().files),broken=Buffer.from(data);const first='assets/person.jpg';broken[30+Buffer.byteLength(first)]^=1;
 assert.throws(()=>new SafeTaskZip(broken).read(first),/完整性/);
});
test('v120 persisted editable drafts invalidate old preflight, reject unbound and over-budget duration',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg-v120-'));try{
  const f=fixture(true),file=join(root,'input.zip');writeFileSync(file,zip(f.files));const registry=new Map<string,any>(), rows=new Map<string,any>(),calls:any[]=[],resumed:string[]=[];
  const model=structuredClone(models.find(m=>m.id==='wan3')!);
  const app:any={root,models:()=>[model],credentials:{list:()=>[{id:'a',enabled:true,providerId:'alibaba',isDefault:true}]},settings:()=>({outputDir:root}),
   assets:{import:async(p:string)=>{const data=readFileSync(p),id=hash(data),kind=p.endsWith('jpg')?'image':p.endsWith('mp4')?'video':'audio';const asset={id,name:p.split('/').pop(),kind,originalPath:p,managedPath:null,size:data.length,mime:'test',hash:id,createdAt:'',lastUsedAt:null,tags:[],folder:'',projectId:null,favorite:false,width:720,height:1280,fps:25,duration:kind==='video'?9.6:kind==='audio'?14:undefined,metadata:{detectedFormat:p.split('.').pop()}};registry.set(id,asset);return{asset,duplicate:false};},refreshMetadata:async(id:string)=>registry.get(id),get:(id:string)=>registry.get(id)},
   tasks:{estimate:()=>({cost:{amount:null,currency:'CNY',kind:'unknown',note:''},breakdown:[]}),create:async(draft:any,req:string,_snapshot:any,defer:boolean)=>{assert(defer);let row=rows.get(req);if(!row){row={id:'task'+(rows.size+1),status:'Draft'};rows.set(req,row);calls.push(draft);}return row;},resume:(id:string)=>{resumed.push(id);for(const row of rows.values())if(row.id===id)row.status='Queued';}}
  };
  const svc=new TaskPackageService(app),initial=await svc.importZip(file);assert.equal(initial.segments.length,2);
  assert.notEqual(initial.segments[0].mapping.find(m=>m.kind==='video')?.assetId,initial.segments[1].mapping.find(m=>m.kind==='video')?.assetId);
  const id=initial.sessionId;
  assert.equal(initial.confirmed,false);
  await assert.rejects(svc.submit(id),/尚未确认/);
  const reimport=await svc.importZip(file);assert.equal(reimport.sessionId,id);
  const original=svc.detail(id);
  await assert.rejects(svc.update(id,'seg1',{prompt:'bad @missing',params:{ratio:'INVALID'}}),/画幅/);
  assert.deepEqual(svc.detail(id),original,'invalid patch must leave all fields unchanged');
  const bad=await svc.update(id,'seg1',{prompt:prompt+' @missing'});assert.equal(bad.segments[0].revision,2);
  const badCheck=await svc.preflight(id);assert.match(badCheck.segments[0].issue??'',/未绑定/);
  await assert.rejects(svc.submit(id),/预检未通过/);
  await svc.update(id,'seg1',{prompt,params:{duration:21}});
  const long=await svc.preflight(id);assert.match(long.segments[0].issue??'',/时长|秒/);
  await svc.update(id,'seg1',{params:{duration:17}});
  const recovered=await svc.preflight(id);assert(!recovered.segments.some(s=>s.issue));
  const rebooted=new TaskPackageService(app);assert.equal(rebooted.detail(id).segments[0].revision,4);
  await assert.rejects(rebooted.submit(id),/重新确认/);
  await rebooted.confirm(id,recovered.revision);
  assert.equal(rebooted.detail(id).confirmed,true);
  const done=await rebooted.submit(id);assert.equal(done.length,2);assert.equal(resumed.length,2);
  await assert.rejects(rebooted.submit(id),/不能重复/);
  const nextRound=await rebooted.importZip(file);assert.equal(nextRound.renewedTaskId,true);assert.notEqual(nextRound.taskId,nextRound.sourceTaskId);
 }finally{rmSync(root,{recursive:true,force:true});}
});
