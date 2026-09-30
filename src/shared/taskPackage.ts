/** Single machine contract used by the importer, generator guide and tests. */
export const TASK_PACKAGE_VERSION = '1.2.0';
export const TASK_PACKAGE_PREVIOUS_VERSION = '1.1';
export const TASK_PACKAGE_LEGACY_VERSION = '1.0';
export const TASK_PACKAGE_TYPE = 'chigetang.wan-task';
export const TASK_PACKAGE_MAX_SEGMENTS = 60;
export const TASK_PACKAGE_MAX_ASSETS = 100;
export const TASK_PACKAGE_LIMITS = Object.freeze({zipBytes:200*1024*1024, totalBytes:500*1024*1024, entryBytes:200*1024*1024, entries:500, assets:TASK_PACKAGE_MAX_ASSETS, segments:TASK_PACKAGE_MAX_SEGMENTS});
export const TASK_PACKAGE_PARAMS = ['duration','audio','resolution','ratio','seed','watermark','prompt_extend'] as const;
export const TASK_PACKAGE_ALIASES = ['person','product','motion','voice'] as const;
export interface PackageAsset {
  id:string; type:'image'|'video'|'audio'; path:string;
  usage:'wan_reference'|'analysis_only'|'postproduction_only'; sha256:string;
}
export interface PackageSegment {
  id:string; order:number; prompt_file:string; duration_seconds:number;
  bindings?:Record<string,string>; source_range_ms?:[number,number];
}
export interface TaskPackageManifest {
  schema_version:string; package_type:string; task_id:string; task_name:string;
  engine:'wan3'; assets:PackageAsset[];
  shared:{params:Record<string,string|number|boolean>;bindings?:Record<string,string>;reference_order?:string[]};
  segments:PackageSegment[];
  documents?:{timeline?:string;composition?:string};
  postproduction?:{full_audio_asset_id?:string;segment_order?:string[]};
}
const validId=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;
const validAlias=/^[\p{L}\p{N}_-]{1,45}$/u;
const legacyAlias=/^@[\p{L}\p{N}_-]{1,45}$/u;
const allowedExt:Record<string,string[]>={image:['.jpg','.jpeg','.png','.webp','.bmp'],video:['.mp4','.mov'],audio:['.wav','.mp3','.m4a','.aac','.flac','.ogg']};
const own=(o:unknown,k:string)=>!!o && typeof o==='object' && Object.prototype.hasOwnProperty.call(o,k);
const objectRecord=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const uniqueIssues=(issues:string[])=>[...new Set(issues)];

/**
 * Non-throwing import lint used by the desktop importer so one repair round can
 * address every independently detectable manifest/binding/Prompt problem.
 * The strict validator below remains the authoritative parser after linting.
 */
export function collectTaskPackageIssues(value:unknown,hasFile:(p:string)=>boolean,loadText:(p:string)=>string):string[] {
 const issues:string[]=[];
 const add=(message:string)=>issues.push(message);
 const root=objectRecord(value);
 if(!root)return ['manifest 必须是 JSON 对象'];
 for(const key of Object.keys(root))if(!['schema_version','package_type','task_id','task_name','engine','assets','shared','segments','documents','postproduction'].includes(key))add('不支持字段 manifest.'+key);
 const version=typeof root.schema_version==='string'?root.schema_version:'';
 if(![TASK_PACKAGE_VERSION,TASK_PACKAGE_PREVIOUS_VERSION,TASK_PACKAGE_LEGACY_VERSION].includes(version)||root.package_type!==TASK_PACKAGE_TYPE)add('不支持的协议版本或包类型：'+version);
 if(!validId.test(String(root.task_id??'')))add('任务 ID 无效');
 if(typeof root.task_name!=='string'||!root.task_name.trim()||root.task_name.length>120)add('任务名称无效');
 if(root.engine!=='wan3')add('当前仅支持 Wan 3.0');

 const assets=Array.isArray(root.assets)?root.assets:[];
 if(!Array.isArray(root.assets))add('assets 必须是数组');
 if(assets.length>TASK_PACKAGE_MAX_ASSETS)add('素材数量超过 '+TASK_PACKAGE_MAX_ASSETS);
 const assetIds=new Map<string,{type?:unknown;usage?:unknown;path?:unknown;sha256?:unknown}>();
 const paths=new Set<string>(['manifest.json']);
 for(let index=0;index<assets.length;index++) {
  const a=objectRecord(assets[index]);const label=`assets[${index}]`;
  if(!a){add(label+' 必须是对象');continue;}
  for(const key of Object.keys(a))if(!['id','type','path','usage','sha256'].includes(key))add('不支持字段 '+label+'.'+key);
  const id=String(a.id??'');
  if(!validId.test(id))add(label+'.id 缺失或无效');
  else if(assetIds.has(id))add('素材 ID 重复 '+id);
  else assetIds.set(id,a);
  if(!['image','video','audio'].includes(String(a.type)))add(label+'.type 无效 '+id);
  if(!['wan_reference','analysis_only','postproduction_only'].includes(String(a.usage)))add(label+'.usage 无效 '+id);
  const path=String(a.path??'');
  if(!validPackagePath(path)||!(/^(assets|analysis|postproduction)\//.test(path)))add(label+'.path 无效 '+id);
  else {
   if(paths.has(path))add('文件路径重复 '+path);else paths.add(path);
   if(!hasFile(path))add('素材文件缺失 '+id+' → '+path);
   const type=String(a.type);if(type in allowedExt&&!allowedExt[type].some(ext=>path.toLowerCase().endsWith(ext)))add('素材扩展名与类型不匹配 '+id);
  }
  if(!/^[a-f0-9]{64}$/.test(String(a.sha256??'')))add(label+'.sha256 必须是 64 位小写十六进制 '+id);
 }

 const shared=objectRecord(root.shared);
 if(!shared)add('shared 必须是对象');
 else {
  const legacy=version===TASK_PACKAGE_LEGACY_VERSION;
  for(const key of Object.keys(shared))if(!['params','bindings',...(legacy?['reference_order']:[])].includes(key))add('不支持字段 shared.'+key);
  const params=objectRecord(shared.params);
  if(!params)add('shared.params 必须是对象');
  else {
   for(const key of Object.keys(params))if(!TASK_PACKAGE_PARAMS.includes(key as typeof TASK_PACKAGE_PARAMS[number]))add('不支持参数 shared.params.'+key);
   if(typeof params.duration!=='number'||!Number.isInteger(params.duration)||(params.duration!==-1&&params.duration<2)||Number(params.duration)>30)add('默认时长不合法');
   if(typeof params.audio!=='boolean')add('shared.params.audio 必须为布尔值');
   if(!['480P','720P','1080P'].includes(String(params.resolution)))add('输出分辨率不合法');
   if(!['adaptive','16:9','9:16','1:1','4:3','3:4'].includes(String(params.ratio)))add('输出画幅不合法');
   if('seed' in params&&(!Number.isInteger(params.seed)||Number(params.seed)<-1||Number(params.seed)>2147483647))add('随机种子无效');
   for(const key of ['watermark','prompt_extend'])if(key in params&&typeof params[key]!=='boolean')add('参数 '+key+' 必须为布尔值');
  }
 }

 const segmentRows=Array.isArray(root.segments)?root.segments:[];
 if(!Array.isArray(root.segments))add('segments 必须是数组');
 else if(!segmentRows.length)add('任务包至少需要 1 个片段');
 if(segmentRows.length>TASK_PACKAGE_MAX_SEGMENTS)add('片段数量超过 '+TASK_PACKAGE_MAX_SEGMENTS);
 const sharedBindings=objectRecord(shared?.bindings);
 const allBindingObjects=[sharedBindings,...segmentRows.map(row=>objectRecord(objectRecord(row)?.bindings))].filter((row):row is Record<string,unknown>=>Boolean(row));
 const legacyAt=version===TASK_PACKAGE_LEGACY_VERSION&&allBindingObjects.flatMap(Object.keys).some(alias=>alias.startsWith('@'));
 if(version===TASK_PACKAGE_LEGACY_VERSION&&allBindingObjects.flatMap(Object.keys).some(alias=>alias.startsWith('@')!==legacyAt))add('旧协议 1.0 的 bindings 键混用了带 @ 与不带 @ 的历史方言');
 const syntax=version===TASK_PACKAGE_LEGACY_VERSION?(legacyAt?'1.0-at':'1.0-plain'):version;
 const inspectBindings=(bindings:unknown,label:string)=>{
  if(bindings===undefined)return {} as Record<string,string>;
  const row=objectRecord(bindings);if(!row){add(label+' 必须是对象');return {} as Record<string,string>;}
  for(const [alias,value] of Object.entries(row)) {
   const id=String(value);
   if(!(legacyAt?legacyAlias:validAlias).test(alias))add(label+'.'+alias+' 别名不合法'+(!legacyAt?'；bindings 键不得包含 @':''));
   const asset=assetIds.get(id);
   if(!asset||asset.usage!=='wan_reference')add(label+'.'+alias+' 未匹配可用素材 '+id);
   if(version===TASK_PACKAGE_VERSION&&asset) {
    const standard:Record<string,string>={person:'image',product:'image',motion:'video',voice:'audio'};const plain=alias.toLowerCase();
    if(plain in standard&&alias!==plain)add(label+'.'+alias+' 标准别名区分大小写，请使用 '+plain);
    if(alias in standard&&asset.type!==standard[alias])add(label+'.'+alias+' 标准别名要求 '+standard[alias]+' 素材，实际为 '+String(asset.type));
   }
  }
  return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,String(value)]));
 };
 const baseBindings=inspectBindings(shared?.bindings,'shared.bindings');
 const orders=new Set<number>(),segmentIds=new Set<string>();
 for(let index=0;index<segmentRows.length;index++) {
  const s=objectRecord(segmentRows[index]);const prefix=`segments[${index}]`;
  if(!s){add(prefix+' 必须是对象');continue;}
  for(const key of Object.keys(s))if(!['id','order','prompt_file','duration_seconds','bindings','source_range_ms'].includes(key))add('不支持字段 '+prefix+'.'+key);
  const id=String(s.id??'');const order=Number(s.order);
  if(!validId.test(id)||segmentIds.has(id))add(prefix+' 片段 ID 缺失、无效或重复');else segmentIds.add(id);
  if(!Number.isInteger(order)||order<1||order>segmentRows.length||orders.has(order))add(prefix+' 片段顺序无效');else orders.add(order);
  if(!Number.isInteger(s.duration_seconds)||Number(s.duration_seconds)<2||Number(s.duration_seconds)>30)add(prefix+' 输出时长必须为 2–30 的整数秒');
  const range=s.source_range_ms;
  if(range!==undefined&&(!Array.isArray(range)||range.length!==2||!range.every(n=>Number.isInteger(n)&&n>=0)||Number(range[0])>=Number(range[1])))add(prefix+' 源时间范围无效');
  const segmentBindings=inspectBindings(s.bindings,`segments.${id||index}.bindings`);
  const promptPath=String(s.prompt_file??'');
  if(!validPackagePath(promptPath)||!promptPath.startsWith('prompts/')||!promptPath.endsWith('.txt'))add(prefix+' Prompt 路径无效');
  else if(!hasFile(promptPath))add(prefix+' Prompt 文件缺失 '+promptPath);
  else {
   if(paths.has(promptPath))add('文件路径重复 '+promptPath);else paths.add(promptPath);
   try {
    const prompt=loadText(promptPath);
    if(!prompt.trim()||[...prompt].length>20000)add(prefix+' Prompt 为空或超出长度');
    else {
     try{validateNoOverlayInstructions(prompt);}catch(e){add(prefix+' '+String(e instanceof Error?e.message:e));}
     try{validatePromptBindings(prompt,{...baseBindings,...segmentBindings},syntax);}catch(e){add(prefix+' '+String(e instanceof Error?e.message:e).replace(/^任务包无效：/,''));}
    }
   } catch(e){add(prefix+' Prompt 无法读取：'+String(e instanceof Error?e.message:e));}
  }
 }
 return uniqueIssues(issues);
}

export function formatTaskPackageIssues(issues:string[]) {
 const rows=uniqueIssues(issues);
 return `任务包共发现 ${rows.length} 项问题，请一次修复后重新导入：\n${rows.map((issue,index)=>`${index+1}. ${issue}`).join('\n')}`;
}
export function validPackagePath(path:unknown):path is string {
 return typeof path==='string' && path.length>0 && path.length<=240 && !path.includes('\\') && !path.startsWith('/') && !path.includes(':') && path.split('/').every(x=>x!==''&&x!=='.'&&x!=='..'&&!/[\x00-\x1f]/.test(x));
}
/** @@ is a literal escaped @. An alias must be followed by punctuation or whitespace. */
export function taskPackageTokens(prompt:string):string[] {
 return [...prompt.matchAll(/(^|[^@])(@[\p{L}\p{N}_-]+)/gu)].map(m=>m[2]);
}
/** Catch unambiguous, positive instructions to put added text into the generated frames. */
export function validateNoOverlayInstructions(prompt:string) {
 const clauses=prompt.split(/[。；;，,：:\n]|但(?:是)?|然而|同时|并且|以及|或者|且|或|\b(?:but|and|or)\b/iu);
 for(const line of clauses) {
  // Evaluate each action clause separately: a negative clause cannot authorize a later positive one.
  const positiveChinese=/(?:(?:请|需要|必须|务必|要求|在画面中|在屏幕上|画面|屏幕).{0,15})?(?:添加|生成|叠加|显示|插入|出现)(?:额外|自动)?(?:字幕|屏幕文字|文字浮层|文字|水印|无关\s*Logo)/i.test(line);
  const positiveEnglish=/(?:add|generate|create|show|display|insert|overlay|burn[ -]?in)\s+(?:on[ -]?screen\s+)?(?:subtitles?|captions?|screen\s*text|text|watermarks?|logos?)/i.test(line);
  if(!positiveChinese&&!positiveEnglish)continue;
  const negativeChinese=/(?:禁止|不得|不要|避免|不能|不允许|无字幕|无水印|不出现)/.test(line);
  const negativeEnglish=/(?:do\s+not|don't|must\s+not|never|no)\s+(?:(?:automatically\s+)?(?:add|generate|create|show|display|insert|overlay|burn[ -]?in)\s+)?(?:subtitles?|captions?|screen\s*text|text|watermarks?|logos?)/i.test(line);
  if(!negativeChinese&&!negativeEnglish)
   throw new Error('Prompt 中存在明确的附加字幕/屏幕文字/水印指令，请删除或确认仅保留产品包装原有文字');
 }
}
export function validatePromptBindings(prompt:string, bindings:Record<string,string>, version=TASK_PACKAGE_VERSION):string[] {
 const tokenList=taskPackageTokens(prompt);
 const keys=Object.keys(bindings);
 const atStyle=version==='1.0' || version==='1.0-at';
 for(const token of tokenList) {
  const alias=atStyle?token:token.slice(1);
  if(!own(bindings,alias)) throw new Error('任务包无效：Prompt 中存在未绑定素材 '+token+'；请检查引用后是否有空格或标点');
 }
 for(const alias of keys) if(!tokenList.includes(atStyle?alias:'@'+alias))
  throw new Error('任务包无效：有声明但未使用的素材引用 '+alias);
 return tokenList;
}
function whitelist(obj:unknown, keys:readonly string[], path:string) {
 if(!obj || typeof obj!=='object' || Array.isArray(obj)) throw new Error('任务包无效：'+path+' 必须是对象');
 for(const key of Object.keys(obj)) if(!keys.includes(key)) throw new Error('任务包无效：不支持字段 '+path+'.'+key);
}
export function validateTaskPackage(value:unknown,hasFile:(p:string)=>boolean,loadText:(p:string)=>string):TaskPackageManifest {
 const fail=(message:string):never=>{throw new Error('任务包无效：'+message);};
 whitelist(value,['schema_version','package_type','task_id','task_name','engine','assets','shared','segments','documents','postproduction'],'manifest');
 const m=value as TaskPackageManifest;
 if(![TASK_PACKAGE_VERSION,TASK_PACKAGE_PREVIOUS_VERSION,TASK_PACKAGE_LEGACY_VERSION].includes(m.schema_version)||m.package_type!==TASK_PACKAGE_TYPE) fail('不支持的协议版本或包类型：'+m.schema_version);
 const legacy=m.schema_version===TASK_PACKAGE_LEGACY_VERSION;
 const allAliases=[...Object.keys(m.shared?.bindings??{}),...(Array.isArray(m.segments)?m.segments.flatMap(s=>Object.keys(s.bindings??{})):[])];
 const legacyAt=legacy&&allAliases.some(x=>x.startsWith('@'));
 if(legacy&&allAliases.some(x=>x.startsWith('@')!==legacyAt))fail('旧协议 1.0 的 bindings 键混用了带 @ 与不带 @ 的历史方言；请统一');
 const syntax=legacy?(legacyAt?'1.0-at':'1.0-plain'):m.schema_version;
 if(!validId.test(m.task_id||'')||typeof m.task_name!=='string'||!m.task_name.trim()||m.task_name.length>120) fail('任务 ID 或名称无效');
 if(m.engine!=='wan3') fail('当前仅支持 Wan 3.0');
 if(!Array.isArray(m.assets)||m.assets.length>TASK_PACKAGE_MAX_ASSETS||!Array.isArray(m.segments)||!m.segments.length||m.segments.length>TASK_PACKAGE_MAX_SEGMENTS) fail('素材或片段数量超限');
 whitelist(m.shared,['params','bindings',...(legacy?['reference_order']:[])],'shared');
 whitelist(m.shared.params,TASK_PACKAGE_PARAMS,'shared.params');
 const params=m.shared.params;
 if(typeof params.duration!=='number'||!Number.isInteger(params.duration)||(params.duration!==-1&&params.duration<2)||params.duration>30) fail('默认时长不合法');
 if(typeof params.audio!=='boolean'||!['480P','720P','1080P'].includes(String(params.resolution))||!['adaptive','16:9','9:16','1:1','4:3','3:4'].includes(String(params.ratio))) fail('输出参数不合法');
 if('seed' in params&&(!Number.isInteger(params.seed)||Number(params.seed)< -1||Number(params.seed)>2147483647)) fail('随机种子无效');
 for(const key of ['watermark','prompt_extend'] as const) if(key in params&&typeof params[key]!=='boolean') fail('参数 '+key+' 必须为布尔值');
 const assetIds=new Map<string,PackageAsset>();const paths=new Set<string>(['manifest.json']);
 for(const a of m.assets) {
  whitelist(a,['id','type','path','usage','sha256'],'assets[]');
  if(!validId.test(a.id||'')||assetIds.has(a.id)) fail('素材 ID 缺失或重复 '+a.id);
  if(!['image','video','audio'].includes(a.type)||!['wan_reference','analysis_only','postproduction_only'].includes(a.usage)) fail('素材类型或用途无效 '+a.id);
  if(!validPackagePath(a.path)||!(/^(assets|analysis|postproduction)\//.test(a.path))) fail('素材路径无效 '+a.id);
  if(!allowedExt[a.type].some(ext=>a.path.toLowerCase().endsWith(ext))) fail('素材扩展名不匹配 '+a.id);
  if(!/^[a-f0-9]{64}$/.test(a.sha256||'')||!hasFile(a.path)) fail('素材缺失或哈希格式错误 '+a.id);
  if(paths.has(a.path)) fail('文件路径重复 '+a.path);
  paths.add(a.path);assetIds.set(a.id,a);
 }
 const readBindings=(bindings:Record<string,string>|undefined,path:string)=>{
  if(bindings===undefined)return;
  if(!bindings||typeof bindings!=='object'||Array.isArray(bindings))fail(path+' 必须是对象');
  for(const [alias,id] of Object.entries(bindings)) {
   if(!(legacyAt?legacyAlias:validAlias).test(alias))fail(path+'.'+alias+' 别名不合法'+(!legacyAt?'；bindings 键不得包含 @':''));
   if(!assetIds.has(id)||assetIds.get(id)?.usage!=='wan_reference')fail(path+'.'+alias+' 未匹配可用素材 '+id);
   if(m.schema_version===TASK_PACKAGE_VERSION) {
    const standard:Record<string,PackageAsset['type']>={person:'image',product:'image',motion:'video',voice:'audio'};
    const plain=alias.toLowerCase();
    if(plain in standard&&alias!==plain)fail(path+'.'+alias+' 标准别名区分大小写，请使用 '+plain);
    if(alias in standard&&assetIds.get(id)?.type!==standard[alias])fail(path+'.'+alias+' 标准别名要求 '+standard[alias]+' 素材，实际为 '+assetIds.get(id)?.type);
   }
  }
 };
 readBindings(m.shared.bindings,'shared.bindings');
 const orders=new Set<number>(),segments=new Set<string>();
 for(const s of m.segments) {
  whitelist(s,['id','order','prompt_file','duration_seconds','bindings','source_range_ms'],'segments[]');
  if(!validId.test(s.id||'')||segments.has(s.id)||!Number.isInteger(s.order)||s.order<1||s.order>m.segments.length||orders.has(s.order)) fail('片段 ID 或顺序无效');
  segments.add(s.id);orders.add(s.order);
  if(!validPackagePath(s.prompt_file)||!s.prompt_file.startsWith('prompts/')||!s.prompt_file.endsWith('.txt')||!hasFile(s.prompt_file)||paths.has(s.prompt_file))fail('Prompt 文件缺失或重复 '+s.id);
  paths.add(s.prompt_file);
  if(!Number.isInteger(s.duration_seconds)||s.duration_seconds<2||s.duration_seconds>30)fail('输出时长错误 '+s.id);
  if(s.source_range_ms&&(!Array.isArray(s.source_range_ms)||s.source_range_ms.length!==2||!s.source_range_ms.every(n=>Number.isInteger(n)&&n>=0)||s.source_range_ms[0]>=s.source_range_ms[1]))fail('源时间范围无效 '+s.id);
  readBindings(s.bindings,'segments.'+s.id+'.bindings');
  const binding={...m.shared.bindings,...s.bindings};
  const prompt=loadText(s.prompt_file);
  if(!prompt.trim()||[...prompt].length>20000)fail('Prompt 为空或超出长度 '+s.id);
  validateNoOverlayInstructions(prompt);
  validatePromptBindings(prompt,binding,syntax);
  if(legacy&&m.shared.reference_order!==undefined) {
   if(!legacyAt)fail('旧协议 1.0 不带 @ 的历史方言不支持 reference_order');
   if(!Array.isArray(m.shared.reference_order)||new Set(m.shared.reference_order).size!==m.shared.reference_order.length||Object.keys(binding).some(alias=>!m.shared.reference_order!.includes(alias)))fail('旧版 reference_order 不完整');
  }
 }
 if(m.documents!==undefined) {
  whitelist(m.documents,['timeline','composition'],'documents');
  for(const k of ['timeline','composition'] as const){const p=m.documents[k];if(p!==undefined){if(!validPackagePath(p)||!hasFile(p)||paths.has(p))fail('说明文件缺失或重复 '+k);paths.add(p);}}
 }
 if(m.postproduction!==undefined) {
  whitelist(m.postproduction,['full_audio_asset_id','segment_order'],'postproduction');
  if(m.postproduction.full_audio_asset_id&& (assetIds.get(m.postproduction.full_audio_asset_id)?.usage!=='postproduction_only'||assetIds.get(m.postproduction.full_audio_asset_id)?.type!=='audio'))fail('完整配音资产必须是 postproduction_only 音频');
  if(m.postproduction.segment_order&&(!Array.isArray(m.postproduction.segment_order)||m.postproduction.segment_order.length!==m.segments.length||m.postproduction.segment_order.some((id,i)=>id!==[...m.segments].sort((a,b)=>a.order-b.order)[i].id)))fail('后期片段顺序不一致');
 }
 return m;
}
export function packageDeclaredPaths(m:TaskPackageManifest):Set<string> {
 return new Set(['manifest.json',...m.assets.map(a=>a.path),...m.segments.map(s=>s.prompt_file),...Object.values(m.documents??{}).filter((v):v is string=>typeof v==='string')]);
}
