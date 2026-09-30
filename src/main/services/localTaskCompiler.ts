import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { detectFileSignature, hashFile } from './assets.ts';
import { probeMedia } from './media.ts';
import { ffmpegBinary } from './transcode.ts';
import { SafeTaskZip } from './taskPackage.ts';
import { writeTaskZip } from './taskZipWriter.ts';
import { packageDeclaredPaths, TASK_PACKAGE_LIMITS, TASK_PACKAGE_TYPE, TASK_PACKAGE_VERSION, validateTaskPackage, validPackagePath, type PackageAsset, type PackageSegment, type TaskPackageManifest } from '../../shared/taskPackage.ts';

const run=promisify(execFile);
type Picture={alias:string;file:string};
type Segment={id:string;video?:string;source_range_ms:[number,number];audio_range_ms?:[number,number];active_edit_range_ms?:[number,number];shot_ids?:string[];images:Picture[];prompt:string;duration_seconds:number};
type Plan={task_id:string;task_name:string;source_video:string;full_audio?:string;images:Picture[];params:Record<string,unknown>;segments:Segment[]};
const record=(v:unknown,label:string):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(label+' 必须是对象');return v as Record<string,unknown>;};
const keys=(v:Record<string,unknown>,allowed:string[],label:string)=>{for(const key of Object.keys(v))if(!allowed.includes(key))throw new Error(label+' 不支持字段 '+key);};
const identifier=(v:unknown,label:string)=>{if(typeof v!=='string'||!(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/).test(v))throw new Error(label+' 无效');return v;};
const range=(v:unknown,label:string):[number,number]=>{if(!Array.isArray(v)||v.length!==2||!v.every(n=>Number.isInteger(n)&&n>=0)||v[0]>=v[1])throw new Error(label+' 必须是递增的非负毫秒区间');return[v[0],v[1]];};
function pictures(value:unknown,label:string):Picture[]{if(value===undefined)return[];if(!Array.isArray(value))throw new Error(label+' 必须是数组');return value.map((item,i)=>{const p=record(item,`${label}[${i}]`);keys(p,['alias','file'],label);if(typeof p.alias!=='string'||!(/^[\p{L}\p{N}_-]{1,45}$/u).test(p.alias)||typeof p.file!=='string')throw new Error(label+' 别名或路径无效');if(['motion','voice'].includes(p.alias))throw new Error(label+' 图片不能占用视频/音频标准别名');return{alias:p.alias,file:p.file};});}
function parse(input:unknown):Plan{
 const p=record(input,'编译方案');keys(p,['plan_version','approved','task_id','task_name','source_video','full_audio','images','params','segments'],'编译方案');
 if(p.plan_version!=='1.0'||p.approved!==true)throw new Error('仅可编译已确认的 plan_version 1.0 方案（approved: true）');
 const task_id=identifier(p.task_id,'task_id');if(typeof p.task_name!=='string'||!p.task_name.trim()||p.task_name.length>120)throw new Error('task_name 无效');
 if(typeof p.source_video!=='string'||(p.full_audio!==undefined&&typeof p.full_audio!=='string'))throw new Error('源媒体路径无效');
 if(!Array.isArray(p.segments)||!p.segments.length||p.segments.length>TASK_PACKAGE_LIMITS.segments)throw new Error('GEN 任务数须为 1–60');
 const segments:Segment[]=p.segments.map((item,i)=>{
  const s=record(item,`segments[${i}]`);keys(s,['id','video','source_range_ms','audio_range_ms','active_edit_range_ms','shot_ids','images','prompt','duration_seconds'],`segments[${i}]`);
  const id=identifier(s.id,`segments[${i}].id`),source_range_ms=range(s.source_range_ms,id+'.source_range_ms');const seconds=(source_range_ms[1]-source_range_ms[0])/1000;
  if(seconds<3||seconds>15)throw new Error(id+' GEN 参考视频须为 3–15 秒');
  if(!Number.isInteger(s.duration_seconds)||Number(s.duration_seconds)<3||Number(s.duration_seconds)>30||seconds+Number(s.duration_seconds)>30)throw new Error(id+' 输出时长或视频参考+输出时长超限');
  if(typeof s.prompt!=='string'||!s.prompt.trim())throw new Error(id+' Prompt 不能为空');
  if(s.video!==undefined&&typeof s.video!=='string')throw new Error(id+' 视频路径无效');
  const active=s.active_edit_range_ms===undefined?undefined:range(s.active_edit_range_ms,id+'.active_edit_range_ms');
  if(active&&(active[0]<source_range_ms[0]||active[1]>source_range_ms[1]))throw new Error(id+' 真正编辑区间必须在 GEN 来源区间内');
  const audio=s.audio_range_ms===undefined?undefined:range(s.audio_range_ms,id+'.audio_range_ms');
  if(audio&&(!p.full_audio||audio[1]-audio[0]>15000))throw new Error(id+' 参考音频须来自完整配音且不超过 15 秒');
  if(s.shot_ids!==undefined&&(!Array.isArray(s.shot_ids)||!s.shot_ids.every(v=>typeof v==='string'&&/^S\d+$/.test(v))))throw new Error(id+' SHOT 列表无效');
  return{id,video:s.video as string|undefined,source_range_ms,audio_range_ms:audio,active_edit_range_ms:active,shot_ids:s.shot_ids as string[]|undefined,images:pictures(s.images,id+'.images'),prompt:s.prompt,duration_seconds:s.duration_seconds as number};
 });
 if(new Set(segments.map(s=>s.id)).size!==segments.length)throw new Error('GEN ID 重复');
 const params=p.params===undefined?{}:record(p.params,'params');keys(params,['duration','audio','resolution','ratio','seed','watermark','prompt_extend'],'params');
 return{task_id,task_name:p.task_name,source_video:p.source_video,full_audio:p.full_audio as string|undefined,images:pictures(p.images,'images'),params,segments};
}
const hash=async(path:string)=>{const h=createHash('sha256');for await(const part of createReadStream(path))h.update(part as Buffer);return h.digest('hex');};

/** Creates a real v1.2.0 task ZIP from approved intervals. No API request is made. */
export async function compileLocalTask(planPath:string,destination:string,options:{tempRoot:string;wasmPath:string;ffmpegPath?:string}){
 const plan=parse(JSON.parse(await readFile(planPath,'utf8'))),base=await realpath(dirname(planPath));
 const source=async(path:string,kind:'image'|'video'|'audio')=>{
  if(!validPackagePath(path))throw new Error('素材路径必须在方案目录内：'+path);
  const candidate=resolve(base,...path.split('/')),real=await realpath(candidate);
  if(!real.startsWith(base+sep)||!(await lstat(candidate)).isFile()||!(await stat(real)).isFile())throw new Error('素材不是方案目录内的普通文件：'+path);
  if((await detectFileSignature(real)).kind!==kind)throw new Error('素材真实类型不符：'+path);return real;
 };
 const mediaDuration=async(file:string)=>{const d=Number((await probeMedia(file,options.wasmPath)).duration);if(!(d>0))throw new Error('媒体时长无法识别：'+basename(file));return d;};
 await mkdir(options.tempRoot,{recursive:true});const stage=await mkdtemp(join(options.tempRoot,'compile-'));
 const entries:Array<{path:string;file:string}>=[],assets:PackageAsset[]=[],warnings:string[]=[];
 try{
  const ffmpeg=ffmpegBinary(options.ffmpegPath),video=await source(plan.source_video,'video'),audio=plan.full_audio?await source(plan.full_audio,'audio'):undefined;
  const videoLength=await mediaDuration(video),audioLength=audio?await mediaDuration(audio):0;
  const add=async(file:string,type:PackageAsset['type'])=>{
   const assetId='asset.'+String(assets.length+1).padStart(3,'0'),zipPath='assets/'+assetId+extname(file).toLowerCase();
   if((await stat(file)).size>TASK_PACKAGE_LIMITS.entryBytes)throw new Error('单素材超过 200MiB：'+basename(file));
   assets.push({id:assetId,type,path:zipPath,usage:'wan_reference',sha256:await hash(file)});entries.push({path:zipPath,file});return assetId;
  };
  const imageCache=new Map<string,string>();const bindImage=async(p:Picture)=>{const path=await source(p.file,'image');if(imageCache.has(path))return imageCache.get(path)!;const assetId=await add(path,'image');imageCache.set(path,assetId);return assetId;};
  const shared:Record<string,string>={};for(const pic of plan.images){if(shared[pic.alias])throw new Error('共享图片别名重复：'+pic.alias);shared[pic.alias]=await bindImage(pic);}
  const segments:PackageSegment[]=[];
  for(const [index,s] of plan.segments.entries()){
   const src=s.video?await source(s.video,'video'):video,available=src===video?videoLength:await mediaDuration(src);
   if(s.source_range_ms[1]/1000>available+0.05)throw new Error(s.id+' 来源区间超出真实视频时长');
   if(s.audio_range_ms&&s.audio_range_ms[1]/1000>audioLength+0.05)throw new Error(s.id+' 配音区间超出真实音频时长');
   const bindings:Record<string,string>={};for(const pic of s.images){if(bindings[pic.alias])throw new Error(s.id+' 图片别名重复');bindings[pic.alias]=await bindImage(pic);}
   const indexName=String(index+1).padStart(3,'0'),clip=join(stage,'motion-'+indexName+'.mp4');
   const start=(s.source_range_ms[0]/1000).toFixed(3),seconds=((s.source_range_ms[1]-s.source_range_ms[0])/1000).toFixed(3);
   await run(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y','-i',src,'-ss',start,'-t',seconds,'-map','0:v:0','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',clip],{timeout:180000,windowsHide:true,maxBuffer:1024*1024});
   const actual=await mediaDuration(clip);
   if(Math.abs(actual-Number(seconds))>0.15||actual>15)throw new Error(s.id+' 实际参考视频 '+actual.toFixed(3)+' 秒，超过确认区间或 Wan 15 秒限制');
   bindings.motion=await add(clip,'video');
   if(s.audio_range_ms){
    const voice=join(stage,'voice-'+indexName+'.wav'),from=(s.audio_range_ms[0]/1000).toFixed(3),length=((s.audio_range_ms[1]-s.audio_range_ms[0])/1000).toFixed(3);
    await run(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y','-i',audio!,'-ss',from,'-t',length,'-vn','-ac','1','-ar','24000','-c:a','pcm_s16le',voice],{timeout:120000,windowsHide:true,maxBuffer:1024*1024});
    const d=await mediaDuration(voice);if(Math.abs(d-Number(length))>0.1||d>15)throw new Error(s.id+' 实际参考音频超出确认区间或 15 秒限制');
    bindings.voice=await add(voice,'audio');
   }
   const promptPath='prompts/'+s.id+'.txt',promptFile=join(stage,s.id+'.txt');await writeFile(promptFile,s.prompt,'utf8');entries.push({path:promptPath,file:promptFile});
   segments.push({id:s.id,order:index+1,prompt_file:promptPath,duration_seconds:s.duration_seconds,source_range_ms:s.source_range_ms,bindings});
   if(!s.active_edit_range_ms)warnings.push(s.id+' 未标注真正编辑区间，后期请人工核对');
  }
  const timelinePath='analysis/timeline.md',timeline=join(stage,'timeline.md');
  await writeFile(timeline,['# SHOT / GEN 编译记录','',`任务：${plan.task_name}`,'完整配音留在原方案目录，供最终合成。','',...plan.segments.flatMap(s=>[`## ${s.id}`,`SHOT：${(s.shot_ids??[]).join('、')||'未记录'}`,`GEN 来源：${s.source_range_ms.join('–')} ms`, `真正编辑：${s.active_edit_range_ms?.join('–')??'未标注'} ms`,`配音：${s.audio_range_ms?.join('–')??'未使用'} ms`,''])].join('\n'),'utf8');
  entries.push({path:timelinePath,file:timeline});
  const params={duration:-1,audio:false,resolution:'720P',ratio:'adaptive',watermark:false,prompt_extend:false,...plan.params};
  if(params.prompt_extend===true)warnings.push('Prompt 智能改写已开启，提交前请核对');
  const manifest:TaskPackageManifest={schema_version:TASK_PACKAGE_VERSION,package_type:TASK_PACKAGE_TYPE,task_id:plan.task_id,task_name:plan.task_name,engine:'wan3',assets,shared:{params:params as TaskPackageManifest['shared']['params'],bindings:shared},segments,documents:{timeline:timelinePath}};
  const manifestFile=join(stage,'manifest.json');await writeFile(manifestFile,JSON.stringify(manifest,null,2),'utf8');entries.unshift({path:'manifest.json',file:manifestFile});
  validateTaskPackage(manifest,p=>entries.some(e=>e.path===p),p=>plan.segments.find(s=>'prompts/'+s.id+'.txt'===p)?.prompt??'');
  if(assets.length>TASK_PACKAGE_LIMITS.assets||entries.length>TASK_PACKAGE_LIMITS.entries)throw new Error('素材或文件数超出标准包限制');
  const zipFile=join(stage,'result.zip');await writeTaskZip(zipFile,entries);
  const zip=new SafeTaskZip(await readFile(zipFile)),declared=packageDeclaredPaths(manifest);
  for(const path of zip.paths()){if(!declared.has(path))throw new Error('ZIP 有未声明文件 '+path);zip.read(path);}
  for(const a of assets)if(createHash('sha256').update(zip.read(a.path)).digest('hex')!==a.sha256)throw new Error('ZIP 素材哈希不符：'+a.id);
  const digest=await hashFile(zipFile);await mkdir(dirname(destination),{recursive:true});await rename(zipFile,destination);
  return{path:destination,sha256:digest,taskId:plan.task_id,segments:segments.length,warnings};
 }finally{await rm(stage,{recursive:true,force:true});}
}
