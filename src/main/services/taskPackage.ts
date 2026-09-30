import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdir, readFile, writeFile, rename, rm, rmdir } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { writableDirectory } from './storage.ts';
import type { Draft, Asset, Model, AssetRole } from '../../shared/types.ts';
import { autoBindMentions, compilePrompt } from '../../shared/mentions.ts';
import { durationOptions } from '../../shared/duration.ts';
import { wanPreflight, formatWanIssue } from '../../shared/wanPreflight.ts';
import { collectTaskPackageIssues, formatTaskPackageIssues, validateTaskPackage, validatePromptBindings, validateNoOverlayInstructions, packageDeclaredPaths, TASK_PACKAGE_LIMITS, validPackagePath, type TaskPackageManifest } from '../../shared/taskPackage.ts';
import type { Application } from './application.ts';

const MAX_ZIP = TASK_PACKAGE_LIMITS.zipBytes;
const MAX_TOTAL = TASK_PACKAGE_LIMITS.totalBytes;
const MAX_ENTRY = TASK_PACKAGE_LIMITS.entryBytes;
interface ZipEntry { offset: number; packed: number; size: number; method: number; crc: number; }
/** Minimal bounded ZIP reader. No executable files, symlinks, encrypted/ZIP64 or path traversal. */
export class SafeTaskZip {
  private data: Buffer;
  private entries = new Map<string, ZipEntry>();
  constructor(data: Buffer, mode:'task'|'docx'='task') {
    if(mode==='docx'&&data.length>10*1024*1024)throw new Error('DOCX 超过 10MiB');
    if (data.length < 22 || data.length > MAX_ZIP) throw new Error('ZIP 大小无效或超过 200MiB');
    this.data = data;
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
      if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的普通 ZIP');
    if (data.readUInt16LE(eocd + 4) || data.readUInt16LE(eocd + 6)) throw new Error('不支持分卷 ZIP');
    const count = data.readUInt16LE(eocd + 10);
    if (count > TASK_PACKAGE_LIMITS.entries || count === 0xffff) throw new Error('ZIP 文件数量超过 500 或使用 ZIP64');
    const length = data.readUInt32LE(eocd + 12), start = data.readUInt32LE(eocd + 16);
    if (length === 0xffffffff || start === 0xffffffff || start + length > eocd) throw new Error('ZIP 目录位置无效');
    let cursor = start, expanded = 0;
    for (let n = 0; n < count; n++) {
      if (cursor + 46 > start + length || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 目录损坏');
      const flag = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10);
      const crc = data.readUInt32LE(cursor + 16), packed = data.readUInt32LE(cursor + 20), size = data.readUInt32LE(cursor + 24);
      const nameLength = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32);
      const offset = data.readUInt32LE(cursor + 42), attr = data.readUInt32LE(cursor + 38) >>> 16;
      if (cursor + 46 + nameLength + extra + comment > start + length) throw new Error('ZIP 文件名损坏');
      let name: string;
      try { name = new TextDecoder('utf-8', {fatal:true}).decode(data.subarray(cursor + 46, cursor + 46 + nameLength)); }
      catch { throw new Error('ZIP 文件名不是合法 UTF-8'); }
      cursor += 46 + nameLength + extra + comment;
      if (name.endsWith('/')) { if (!validPackagePath(name.slice(0,-1))) throw new Error('非法 ZIP 目录：'+name); continue; }
      if (!validPackagePath(name) || this.entries.has(name) || (attr & 0o170000) === 0o120000) throw new Error('非法或重复的 ZIP 路径：' + name);
      if (mode==='task' && name !== 'manifest.json' && (!/^(prompts|assets|analysis|postproduction)\//.test(name) || !/\.(txt|md|json|jpg|jpeg|png|webp|bmp|mov|mp4|mp3|wav|m4a|aac|flac|ogg)$/i.test(name))) throw new Error('不允许的 ZIP 文件类型或位置：' + name);
      if (mode==='docx' && (size>16*1024*1024 || name.endsWith('.bin') || name.endsWith('.exe')))throw new Error('DOCX 包含不支持的二进制文件');
      if (flag & 1 || ![0, 8].includes(method) || size > MAX_ENTRY || packed > MAX_ENTRY || offset === 0xffffffff) throw new Error('ZIP 含不支持的压缩、加密或超大文件：' + name);
      expanded += size;
      if (expanded > MAX_TOTAL) throw new Error('ZIP 解压总容量超过 500MiB');
      this.entries.set(name, {offset, packed, size, method, crc});
    }
    if (cursor !== start + length) throw new Error('ZIP 目录内容不完整');
  }
  has(path: string) { return this.entries.has(path); }
  paths() { return [...this.entries.keys()]; }
  read(path: string): Buffer {
    const e = this.entries.get(path);
    if (!e) throw new Error('ZIP 缺少文件：' + path);
    const p = e.offset, data = this.data;
    if (p + 30 > data.length || data.readUInt32LE(p) !== 0x04034b50) throw new Error('ZIP 文件头损坏：' + path);
    const method = data.readUInt16LE(p + 8), n = data.readUInt16LE(p + 26), x = data.readUInt16LE(p + 28);
    const begin = p + 30 + n + x;
    if (method !== e.method || begin + e.packed > data.length || new TextDecoder('utf-8', {fatal:true}).decode(data.subarray(p + 30, p + 30 + n)) !== path) throw new Error('ZIP 内容与目录不一致：' + path);
    const payload = data.subarray(begin, begin + e.packed);
    const output = e.method === 8 ? inflateRawSync(payload, { maxOutputLength: e.size + 1 }) : payload;
    if (output.length !== e.size || crc32(output) !== e.crc) throw new Error('ZIP 文件完整性校验失败：' + path);
    return output;
  }
}
function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k=0; k<8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface PreparedTask {
 id:string; name:string; draft:Draft; cost:ReturnType<Application['tasks']['estimate']>;
 prompt:string; binding:Record<string,string>; mapping:Array<{alias:string;assetId:string;file:string;slot:string;kind:string}>;
 originalDuration:number; sourceRangeMs?:[number,number]; revision:number; checkedRevision:number; issue?:string;
}
type BatchState='ready'|'submitting'|'submitted'|'blocked';
interface PackageSession {
 sessionId:string; taskId:string; sourceTaskId?:string; packageHash:string; name:string; folder:string;
 schemaVersion:string; state:BatchState; results:Array<{segmentId:string;taskId:string}>;
 tasks:PreparedTask[]; confirmedRevision:number; confirmedHash?:string; createdAt:string;
}
export interface PreparedTaskPack {
 sessionId:string; taskId:string; sourceTaskId:string; renewedTaskId:boolean; name:string; folder:string; revision:number; state:BatchState;
 requiresReconfirmation:boolean; confirmed:boolean; results:PackageSession['results'];
 segments:Array<{id:string;name:string;duration:number;originalDuration:number;prompt:string;revision:number;checked:boolean;issue?:string;
 mapping:PreparedTask['mapping'];cost:PreparedTask['cost']; params:Draft['params'];sourceRangeMs?:[number,number]}>;
}
const decodeText=(b:Buffer,path:string)=>{
 try{return new TextDecoder('utf-8',{fatal:true}).decode(b).replace(/^\uFEFF/,'');}
 catch{throw new Error(path+' 不是有效 UTF-8');}
};
/** Persistent, revision-aware non-billable drafts; the existing TaskService alone submits to Wan. */
export class TaskPackageService {
 private sessions=new Map<string,PackageSession>();
 private submitting=new Set<string>();
 private importing=new Set<string>();
 private mutationTails=new Map<string,Promise<void>>();
 private app:Application;
 private base:string;
 constructor(app:Application) {
  this.app=app; this.base=join(app.root,'projects','imported-task-packs');
  if(existsSync(this.base)) for(const entry of readdirSync(this.base,{withFileTypes:true})) {
   if(!entry.isDirectory())continue;
   try {
    const row=JSON.parse(readFileSync(join(this.base,entry.name,'session.json'),'utf8')) as PackageSession;
    if(row.sessionId===entry.name&&Array.isArray(row.tasks)&&Array.isArray(row.results)) {
     if(!row.confirmedHash)row.confirmedRevision=0; // old candidate sessions did not bind confirmation to a snapshot
     if(row.state==='submitting') {
      row.state='blocked'; // never retry an unknown paid request on restart
      const file=join(this.base,entry.name,'session.json'),temp=file+'.recovery.tmp';
      writeFileSync(temp,JSON.stringify(row),'utf8');renameSync(temp,file); // durable before exposing recovered session
     }
     this.sessions.set(row.sessionId,row);
    }
   } catch { this.recoverInterruptedImport(entry.name); }
  }
 }
 private recoverInterruptedImport(entryName:string) {
  const folder=join(this.base,entryName),manifestPath=join(folder,'manifest.json'),markerPath=join(folder,'failed-import.json');
  if(!existsSync(manifestPath)||existsSync(markerPath))return;
  try {
   const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as {schema_version?:string;package_type?:string;task_id?:string};
   if(manifest.schema_version!=='1.2.0'||manifest.package_type!=='chigetang.wan-task')return;
   const rows=typeof this.app.db?.all==='function'?this.app.db.all<{data:string}>('SELECT data FROM assets'):[];
   const retained=rows.map(row=>JSON.parse(row.data) as Asset).filter(asset=>[asset.originalPath,asset.managedPath].some(path=>path&&this.isWithin(folder,path)));
   const marker={state:'interrupted',submittable:false,taskId:manifest.task_id??'',recoveredAt:new Date().toISOString(),reason:'启动时发现未完成导入；该目录不会进入可提交会话',retainedAssetIds:retained.map(asset=>asset.id),retainedPaths:retained.flatMap(asset=>[asset.originalPath,asset.managedPath].filter((path):path is string=>typeof path==='string'&&this.isWithin(folder,path)))};
   const temp=markerPath+'.recovery.tmp';writeFileSync(temp,JSON.stringify(marker,null,2),'utf8');renameSync(temp,markerPath);
  } catch { /* unknown legacy folders are preserved and never exposed as submittable sessions */ }
 }
 private get(sessionId:string) {
  const row=this.sessions.get(sessionId);
  if(!row)throw new Error('任务包草稿不存在，请重新导入');
  return row;
 }
 private async persist(s:PackageSession) {
  await mkdir(s.folder,{recursive:true});
  const dest=join(s.folder,'session.json'),tmp=dest+'.tmp';
  await writeFile(tmp,JSON.stringify(s),'utf8');await rename(tmp,dest);
 }
 private async withSessionMutation<T>(sessionId:string,action:()=>Promise<T>):Promise<T> {
  const previous=this.mutationTails.get(sessionId)??Promise.resolve();
  let release!:()=>void;
  const hold=new Promise<void>(done=>{release=done;});
  const tail=previous.catch(()=>{}).then(()=>hold);
  this.mutationTails.set(sessionId,tail);
  await previous.catch(()=>{});
  try{return await action();}
  finally{release();if(this.mutationTails.get(sessionId)===tail)this.mutationTails.delete(sessionId);}
 }
 private snapshot(s:PackageSession):string {
  // Persisted semantic inputs; do not hash derived slot-compiled Prompt or transient cost.
  return createHash('sha256').update(JSON.stringify(s.tasks.map(t=>({id:t.id,revision:t.revision,prompt:t.prompt,params:t.draft.params,bindings:t.binding,mapping:t.mapping,modelId:t.draft.modelId,accountId:t.draft.accountId,outputDir:t.draft.outputDir})))).digest('hex');
 }
 private view(s:PackageSession):PreparedTaskPack {
  return {sessionId:s.sessionId,taskId:s.taskId,sourceTaskId:s.sourceTaskId??s.taskId,renewedTaskId:Boolean(s.sourceTaskId&&s.sourceTaskId!==s.taskId),name:s.name,folder:s.folder,revision:Math.max(...s.tasks.map(t=>t.revision)),state:s.state,confirmed:s.confirmedRevision>0&&s.confirmedRevision===Math.max(...s.tasks.map(t=>t.revision))&&s.confirmedHash===this.snapshot(s),
   requiresReconfirmation:s.tasks.some(t=>t.revision>1&&Number(t.draft.params.duration)!==t.originalDuration),results:s.results,
   segments:s.tasks.map(t=>({id:t.id,name:t.name,duration:Number(t.draft.params.duration),originalDuration:t.originalDuration,
    prompt:t.prompt,revision:t.revision,checked:t.checkedRevision===t.revision&&!t.issue,issue:t.issue,mapping:t.mapping,cost:t.cost,params:t.draft.params,sourceRangeMs:t.sourceRangeMs}))};
 }
 list() {return [...this.sessions.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(s=>this.view(s));}
 detail(id:string){return this.view(this.get(id));}
 folder(id:string){return this.get(id).folder;}
 async importZip(path:string):Promise<PreparedTaskPack> {
  const bytes=await readFile(path),zip=new SafeTaskZip(bytes);
  if(!zip.has('manifest.json'))throw new Error('ZIP 根目录缺少 manifest.json');
  let raw:unknown;
  try{raw=JSON.parse(decodeText(zip.read('manifest.json'),'manifest.json'));}
  catch(e){throw new Error('manifest.json 格式错误：'+String(e));}
  const manifestIssues=collectTaskPackageIssues(raw,p=>zip.has(p),p=>decodeText(zip.read(p),p));
  if(manifestIssues.length)throw new Error(formatTaskPackageIssues(manifestIssues));
  const manifest=validateTaskPackage(raw,p=>zip.has(p),p=>decodeText(zip.read(p),p));
  const allowed=packageDeclaredPaths(manifest);
  const integrityIssues:string[]=[];
  for(const entry of zip.paths())if(!allowed.has(entry))integrityIssues.push('ZIP 含未声明文件：'+entry+'；请在 manifest 声明或移除');
  // All CRCs, SHA-256 and file declarations must pass before any assets/records are written.
  for(const entry of zip.paths())try{zip.read(entry);}catch(e){integrityIssues.push(entry+' 完整性校验失败：'+String(e instanceof Error?e.message:e));}
  for(const a of manifest.assets)try {
   if(createHash('sha256').update(zip.read(a.path)).digest('hex')!==a.sha256)integrityIssues.push('素材哈希不匹配 assets.'+a.id+'.sha256 → '+a.path);
  } catch(e){integrityIssues.push('素材无法读取 '+a.id+' → '+a.path+'：'+String(e instanceof Error?e.message:e));}
  if(integrityIssues.length)throw new Error(formatTaskPackageIssues(integrityIssues));
  const models=this.app.models(),model=models.find(m=>m.adapter==='wan3'&&m.enabled);
  if(!model)throw new Error('Wan 3.0 模型未启用，请前往模型与 API 设置');
  const accounts=this.app.credentials.list().filter(a=>a.enabled&&a.providerId===model.providerId);
  const defaults=accounts.filter(a=>a.isDefault);
  const account=defaults.length===1?defaults[0]:accounts.length===1?accounts[0]:undefined;
  if(!account)throw new Error('请在模型与 API 设置中选择唯一的默认可用 Wan 账户');
  const outputDir=this.app.settings().outputDir;
  if(!outputDir)throw new Error('视频输出目录未设置，请前往设置');
  await writableDirectory(outputDir);
  const packageHash=createHash('sha256').update(bytes).digest('hex');
  const related=[...this.sessions.values()].filter(s=>(s.sourceTaskId??s.taskId)===manifest.task_id);
  const reusable=related.find(s=>s.packageHash===packageHash&&s.state==='ready');
  if(reusable)return this.view(reusable);
  const uncertain=related.find(s=>s.state==='submitting'||s.state==='blocked');
  if(uncertain)throw new Error('此任务包有提交中或状态未知的旧轮次；请先核查任务记录，为避免重复扣费暂不自动重发');
  const effectiveTaskId=related.some(s=>s.state==='submitted')?this.nextRoundTaskId(manifest.task_id):manifest.task_id;
  const conflictingReady=related.find(s=>s.state==='ready');
  if(conflictingReady)throw new Error('task_id 与已导入但未提交的任务包重复，且文件内容不同；请先清空旧草稿再导入');
  if(this.importing.has(manifest.task_id))throw new Error('此 task_id 的任务包正在导入，请完成前一批导入后重试；禁止重复建立草稿');
  this.importing.add(manifest.task_id);
  const syntax=manifest.schema_version==='1.0'&&Object.keys({...manifest.shared.bindings,...manifest.segments.reduce((all,seg)=>({...all,...seg.bindings}),{})}).some(k=>k.startsWith('@'))?'1.0-at':manifest.schema_version==='1.0'?'1.0-plain':manifest.schema_version;
  const sessionId=randomUUID(),root=join(this.base,sessionId);
  const assets=new Map<string,Asset>();
  const importedRecords:Array<{asset:Asset;duplicate:boolean;extractedPath:string}>=[];
  let registered=false;
  try {
  for(const entry of zip.paths()) {
   const dest=join(root,...entry.split('/'));
   await mkdir(join(dest,'..'),{recursive:true});
   await writeFile(dest,zip.read(entry),{flag:'wx'});
  }
  const mediaIssues:string[]=[];
  for(const a of manifest.assets.filter(a=>a.usage==='wan_reference')) {
   const extractedPath=join(root,...a.path.split('/'));
   try {
    const imported=await this.app.assets.import(extractedPath,false);
    importedRecords.push({asset:imported.asset,duplicate:Boolean(imported.duplicate),extractedPath});
    if(imported.asset.kind!==a.type)mediaIssues.push('素材真实类型不匹配：'+a.id+'，声明 '+a.type+'，检测到 '+imported.asset.kind);
    else assets.set(a.id,imported.asset);
   } catch(e){throw e;}
  }
  if(mediaIssues.length)throw new Error(formatTaskPackageIssues(mediaIssues));
  const tasks:PreparedTask[]=[];
  for(const seg of [...manifest.segments].sort((a,b)=>a.order-b.order)) {
   const binding={...manifest.shared.bindings,...seg.bindings};
   const prompt=decodeText(zip.read(seg.prompt_file),seg.prompt_file);
   const {draft,mapping}=this.makeDraft(manifest,model,account.id,seg,binding,prompt,assets,syntax);
   tasks.push({id:seg.id,name:draft.name,draft,prompt,binding,mapping,revision:1,checkedRevision:0,
    originalDuration:seg.duration_seconds,sourceRangeMs:seg.source_range_ms,cost:this.app.tasks.estimate(draft)});
  }
  const session:PackageSession={sessionId,taskId:effectiveTaskId,sourceTaskId:manifest.task_id,packageHash,name:manifest.task_name,folder:root,schemaVersion:syntax,
   state:'ready',results:[],tasks,confirmedRevision:0,createdAt:new Date().toISOString()};
  this.sessions.set(sessionId,session);registered=true;
  await this.persist(session);
  await this.preflight(sessionId);
  return this.view(this.get(sessionId));
  } catch(e) {
   if(registered)this.sessions.delete(sessionId);
   await this.cleanupFailedImport(root,zip.paths(),manifest.task_id,packageHash,importedRecords,e);
   throw e;
 } finally {this.importing.delete(manifest.task_id);}
 }
 private nextRoundTaskId(source:string) {
  const suffix='_r'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'_'+randomUUID().replace(/-/g,'').slice(0,8);
  return source.slice(0,Math.max(1,101-suffix.length))+suffix;
 }
 async discard(sessionId:string) {
  return this.withSessionMutation(sessionId,async()=>{
   const session=this.get(sessionId);
   if(this.submitting.has(sessionId)||session.state==='submitting'||session.state==='blocked')throw new Error('当前批次正在提交或状态未知，请先核查任务记录，不能清空');
   if(session.state==='submitted')throw new Error('已提交批次属于付费审计记录，不能从此处删除');
   if(!this.isWithin(this.base,session.folder)||resolve(session.folder)===resolve(this.base))throw new Error('任务包目录安全校验失败，未执行清空');
   const candidates=[...new Map(session.tasks.flatMap(task=>task.mapping).map(mapping=>[mapping.assetId,{id:mapping.assetId,expectedOriginalPath:join(session.folder,...mapping.file.split('/'))}])).values()];
   const outcome=this.app.assets.rollbackUnreferencedImports(candidates);
   const retainedPaths=outcome.retained.flatMap(id=>{
    try {const asset=this.app.assets.get(id);return [asset.originalPath,asset.managedPath].filter((path):path is string=>typeof path==='string'&&path.length>0&&this.isWithin(session.folder,path));}
    catch{return [];}
   });
   this.sessions.delete(sessionId);
   if(!retainedPaths.length)await rm(session.folder,{recursive:true,force:true});
   else {
    await rm(join(session.folder,'session.json'),{force:true});
    await rm(join(session.folder,'session.json.tmp'),{force:true});
    await writeFile(join(session.folder,'discarded-session.json'),JSON.stringify({state:'discarded',submittable:false,discardedAt:new Date().toISOString(),retainedAssetIds:outcome.retained,retainedPaths},null,2),'utf8');
   }
   return {removed:true,removedAssetIds:outcome.removed,retainedAssetIds:outcome.retained};
  });
 }
 private async cleanupFailedImport(root:string,paths:string[],taskId:string,packageHash:string,imports:Array<{asset:Asset;duplicate:boolean;extractedPath:string}>,failure:unknown) {
  let removed:string[]=[];
  try {
   const created=[...new Map(imports.filter(x=>!x.duplicate).map(x=>[x.asset.id,{id:x.asset.id,expectedOriginalPath:x.extractedPath}])).values()];
   removed=this.app.assets.rollbackUnreferencedImports(created).removed;
  } catch { /* preserve files whenever database ownership cannot be proven */ }
  const removedIds=new Set(removed),retainedAssets=imports.filter(x=>!removedIds.has(x.asset.id));
  const retainedPaths=new Set<string>();
  for(const item of retainedAssets)for(const path of [item.asset.originalPath,item.asset.managedPath])if(path&&this.isWithin(root,path))retainedPaths.add(resolve(path));
  await rm(join(root,'session.json'),{force:true}).catch(()=>{});
  await rm(join(root,'session.json.tmp'),{force:true}).catch(()=>{});
  for(const path of [...paths].sort((a,b)=>b.split('/').length-a.split('/').length)) {
   const absolute=resolve(root,...path.split('/'));
   if(!retainedPaths.has(absolute))await rm(absolute,{force:true}).catch(()=>{});
  }
  const directories=[...new Set(paths.flatMap(path=>{
   const parts=path.split('/').slice(0,-1),rows:string[]=[];
   for(let i=1;i<=parts.length;i++)rows.push(resolve(root,...parts.slice(0,i)));
   return rows;
  }))].sort((a,b)=>b.length-a.length);
  for(const directory of directories)await rmdir(directory).catch(()=>{});
  if(retainedPaths.size) {
   await mkdir(root,{recursive:true});
   const marker={state:'failed',submittable:false,taskId,packageHash,failedAt:new Date().toISOString(),reason:String(failure instanceof Error?failure.message:failure),retainedAssetIds:[...new Set(retainedAssets.map(x=>x.asset.id))],retainedPaths:[...retainedPaths]};
   const dest=join(root,'failed-import.json'),temp=dest+'.tmp';
   await writeFile(temp,JSON.stringify(marker,null,2),'utf8');await rename(temp,dest);
  } else await rmdir(root).catch(()=>{});
 }
 private isWithin(root:string,path:string) {
  const rel=relative(resolve(root),resolve(path));
  return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel));
 }
 private makeDraft(m:TaskPackageManifest,model:Model,accountId:string,seg:TaskPackageManifest['segments'][number],binding:Record<string,string>,prompt:string,assets:Map<string,Asset>,syntax:string) {
  const refs=Object.entries(binding);
  const order=m.shared.reference_order;
  if(order)refs.sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
  else refs.sort((a,b)=>({image:0,video:1,audio:2}[assets.get(a[1])!.kind]-{image:0,video:1,audio:2}[assets.get(b[1])!.kind]));
  const slots=new Map<string,string>(),counts={image:0,video:0,audio:0};
  const mapping:PreparedTask['mapping']=[];
  const bindings=refs.map(([alias,id])=>{
   const item=assets.get(id);
   if(!item)throw new Error('缺少参考素材 '+alias);
   const role:AssetRole=item.kind==='image'?'reference_image':item.kind==='video'?'reference_video':'reference_audio';
   const prefix=item.kind==='image'?'Image':item.kind==='video'?'Video':'Audio';
   const slot='@'+prefix+(++counts[item.kind]);slots.set(alias,slot);
   const meta=m.assets.find(a=>a.id===id)!;
   mapping.push({alias:syntax==='1.0-at'?alias:'@'+alias,assetId:item.id,file:meta.path,slot,kind:item.kind});
   return {assetId:item.id,role,bindingId:randomUUID(),userRole:alias.replace(/^@/,'')};
  });
  const tokenized=this.compileSemantic(prompt,slots,syntax);
  const params={...m.shared.params,duration:seg.duration_seconds};
  const draft:Draft={name:`${m.task_name} · ${seg.id}`,modelId:model.id,accountId,projectId:null,
   prompt:tokenized,mentions:[],params,assets:bindings,outputDir:this.app.settings().outputDir};
  return {draft,mapping};
 }
 private compileSemantic(prompt:string,slots:Map<string,string>,version:string) {
  validatePromptBindings(prompt,Object.fromEntries([...slots.keys()].map(k=>[k,k])),version);
  return prompt.replace(/(^|[^@])(@[\p{L}\p{N}_-]+)/gu,(whole,prefix:string,token:string)=>{
   const slot=slots.get(version==='1.0-at'?token:token.slice(1));
   if(!slot)throw new Error('未绑定 Prompt 素材：'+token);
   return prefix+slot;
  }).replace(/@@/g,'＠'); // visually equivalent literal at-sign; cannot be auto-bound as a Wan reference
 }
 async update(sessionId:string,segmentId:string,patch:{prompt?:string;params?:Record<string,unknown>}) {
  return this.withSessionMutation(sessionId,async()=>{
  const s=this.get(sessionId);
  if(s.state!=='ready'||this.submitting.has(sessionId))throw new Error('当前会话正在提交或状态未知，禁止编辑');
  const index=s.tasks.findIndex(x=>x.id===segmentId);
  if(index<0)throw new Error('片段不存在：'+segmentId);
  const next=structuredClone(s) as PackageSession;
  const t=next.tasks[index];
  if(patch.prompt!==undefined) {
   if(typeof patch.prompt!=='string'||!patch.prompt.trim()||[...patch.prompt].length>20000)throw new Error('Prompt 必须为 1–20000 字符');
   t.prompt=patch.prompt;
  }
  if(patch.params!==undefined) {
   if(!patch.params||typeof patch.params!=='object'||Array.isArray(patch.params))throw new Error('输出参数必须是对象');
   const params={...t.draft.params};
   for(const [key,v] of Object.entries(patch.params)) {
    if(!['duration','audio','ratio','resolution','seed','watermark','prompt_extend'].includes(key))throw new Error('不支持修改参数：'+key);
    if(key==='duration'&&(!Number.isInteger(v)||Number(v)<2||Number(v)>30))throw new Error('输出时长必须为 2–30 的整数');
    if(key==='ratio'&&!['adaptive','16:9','9:16','1:1','4:3','3:4'].includes(String(v)))throw new Error('不支持的画幅');
    if(key==='resolution'&&!['480P','720P','1080P'].includes(String(v)))throw new Error('不支持的分辨率');
    if(key==='seed'&&(!Number.isInteger(v)||Number(v)< -1||Number(v)>2147483647))throw new Error('seed 不合法');
    if(['audio','watermark','prompt_extend'].includes(key)&&typeof v!=='boolean')throw new Error(key+' 必须是布尔值');
    params[key]=v as number|string|boolean;
   }
   t.draft.params=params;
  }
  if(t.prompt===s.tasks[index].prompt&&JSON.stringify(t.draft.params)===JSON.stringify(s.tasks[index].draft.params))return this.view(s);
  t.revision++;t.checkedRevision=0;t.issue='已修改，必须重新预检及估价';
  next.confirmedRevision=0;next.confirmedHash=undefined;
  await this.persist(next); // only publish the new revision after the atomic disk rename succeeds
  this.sessions.set(sessionId,next);
  return this.view(next);
  });
 }
 async preflight(sessionId:string, forSubmit=false) {
  if(this.submitting.has(sessionId)&&!forSubmit)throw new Error('会话正在提交，不能同时发起独立预检');
  const source=this.get(sessionId);
  if(source.state!=='ready')throw new Error('会话当前状态不允许预检：'+source.state);
  const work=structuredClone(source) as PackageSession;
  const model=this.app.models().find(m=>m.id===work.tasks[0]?.draft.modelId&&m.enabled);
  if(!model)throw new Error('当前 Wan 模型已失效，请到设置页检查');
  await writableDirectory(this.app.settings().outputDir);
  for(const t of work.tasks) {
   try {
    const slots=new Map(t.mapping.map(m=>[work.schemaVersion==='1.0-at'?m.alias:m.alias.slice(1),m.slot]));
    validateNoOverlayInstructions(t.prompt);
    t.draft.prompt=this.compileSemantic(t.prompt,slots,work.schemaVersion);
    t.draft.outputDir=this.app.settings().outputDir;
    const available=await Promise.all(t.draft.assets.map(async b=>({...await this.app.assets.refreshMetadata(b.assetId),role:b.role})));
    if(available.some(a=>a.missing))throw new Error('关联素材不可用，请检查素材路径');
    const options=durationOptions(model,t.draft.params,available);
    if(!options.includes(Number(t.draft.params.duration)))throw new Error('输出时长 '+t.draft.params.duration+' 秒不在当前模型合法时长内，允许：'+options.join('/'));
    const check=wanPreflight(model,t.draft,available);
    const issue=check.issues.find(i=>i.severity==='error');
    if(issue)throw new Error(formatWanIssue(issue));
    compilePrompt(autoBindMentions(t.draft,available),available,model.adapter);
    t.cost=this.app.tasks.estimate(t.draft);
    t.issue=undefined;t.checkedRevision=t.revision;
   } catch(e){t.issue=String(e instanceof Error?e.message:e);t.checkedRevision=0;}
  }
  return this.withSessionMutation(sessionId,async()=>{
   if(this.submitting.has(sessionId)&&!forSubmit)throw new Error('预检期间会话开始提交，旧预检结果已丢弃');
   const current=this.get(sessionId);
   if(current!==source)return this.view(current);
   await this.persist(work);
   this.sessions.set(sessionId,work);
   return this.view(work);
  });
 }
 async confirm(sessionId:string,revision:number) {
  return this.withSessionMutation(sessionId,async()=>{
   const current=this.get(sessionId);
   if(this.submitting.has(sessionId)||current.state!=='ready'||current.tasks.some(t=>t.issue||t.checkedRevision!==t.revision))throw new Error('当前版本未通过全部预检查或正在提交');
   if(Math.max(...current.tasks.map(t=>t.revision))!==revision)throw new Error('确认版本已过期');
   const next=structuredClone(current) as PackageSession;
   next.confirmedRevision=revision;next.confirmedHash=this.snapshot(next);
   await this.persist(next);this.sessions.set(sessionId,next);return this.view(next);
  });
 }
 async submit(sessionId:string):Promise<Array<{segmentId:string;taskId:string}>> {
  const initial=this.get(sessionId);
  if(this.submitting.has(sessionId)||initial.state!=='ready')throw new Error('任务包正在提交、已经提交或状态不明，不能重复扣费');
  this.submitting.add(sessionId); // synchronous exclusive gate, before the first await
  try {
  const initialRevision=Math.max(...initial.tasks.map(t=>t.revision));
  const initialHash=this.snapshot(initial);
  await this.preflight(sessionId,true);
  const s=this.get(sessionId);
  if(s.state!=='ready'||Math.max(...s.tasks.map(t=>t.revision))!==initialRevision||this.snapshot(s)!==initialHash)throw new Error('预检期间草稿已改变，请重新确认');
  if(s.tasks.some(t=>t.issue||t.checkedRevision!==t.revision))throw new Error('提交前预检未通过：'+s.tasks.filter(t=>t.issue).map(t=>t.id+':'+t.issue).join('；'));
  const revision=Math.max(...s.tasks.map(t=>t.revision));
  if(s.confirmedRevision!==revision||!s.confirmedHash||s.confirmedHash!==this.snapshot(s))throw new Error('尚未确认或已修改冻结方案，请重新确认当前草稿快照');
  s.state='submitting';
  try {await this.persist(s);} catch(e){s.state='ready';throw e;}
  const created:PackageSession['results']=[];
  try {
   // Every task is still a non-billable Draft until ALL are safely persisted.
   for(const t of s.tasks) {
    const stableRequest='package:'+createHash('sha256').update(s.taskId+':'+s.packageHash+':'+s.confirmedHash+':'+t.id+':'+t.revision).digest('hex').slice(0,40);
    const row=await this.app.tasks.create(t.draft,stableRequest,undefined,true);
    if(row.status!=='Draft')throw new Error('片段 '+t.id+' 已经提交过（'+row.id+'）；禁止重复付费');
    created.push({segmentId:t.id,taskId:row.id});s.results=[...created];await this.persist(s);
   }
   for(const item of created)this.app.tasks.resume(item.taskId);
   s.results=created;s.state='submitted';await this.persist(s);
   return created;
  } catch(e) {
   s.state='blocked';s.results=created;await this.persist(s);
   throw new Error('本批次已锁定重试；已准备 '+created.length+'/'+s.tasks.length+' 段。请在任务页核对，禁止自动重发。根因：'+String(e));
  }  } finally {this.submitting.delete(sessionId);}
 }
}
