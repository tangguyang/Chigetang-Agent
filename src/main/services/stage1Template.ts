/** User-replaceable stage-one guide. Stored in the existing user data root, never in the installation. */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile, copyFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { packageGuide } from '../../shared/taskPackageDocs.ts';
import { SafeTaskZip } from './taskPackage.ts';

const LEGACY_DEFAULT_VERSION='1.2.0', MAX_BYTES=10*1024*1024;
const decode=(bytes:Buffer)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');
function entities(text:string) {return text.replace(/&(?:amp|lt|gt|quot|apos|#x[\da-fA-F]+|#\d+);/g,v=>{
 const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
 if(v in named)return named[v]; const number=v[2]?.toLowerCase()==='x'?parseInt(v.slice(3,-1),16):parseInt(v.slice(2,-1),10);
 return Number.isInteger(number)&&number>=0&&number<=0x10ffff?String.fromCodePoint(number):v;
 });}
/** DOCX XML text and table cells, preserving document order without renaming the binary to .md. */
export function convertDocx(bytes:Buffer):string {
 const zip=new SafeTaskZip(bytes,'docx');
 if(!zip.has('[Content_Types].xml')||!zip.has('word/document.xml'))throw new Error('不是有效的 Word DOCX 文档');
 const xml=decode(zip.read('word/document.xml'));
 if(!/<w:document\b/.test(xml)||!/<w:body\b/.test(xml))throw new Error('DOCX 缺少可读取的正文');
 let result='',row=false,cell=false;
 for(const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tr(?:\s[^>]*)?>|<w:tc(?:\s[^>]*)?>|<\/w:tc>|<\/w:tr>|<\/w:p>|<w:tab\s*\/?>|<w:br(?:\s[^>]*)?\/>/g)) {
  const token=match[0];
  if(token.startsWith('<w:t'))result+=entities(match[1]||'');
  else if(token.startsWith('<w:tr')){row=true;result+='\n';}
  else if(token.startsWith('<w:tc')){if(cell)result+=' | ';cell=true;}
  else if(token==='</w:tc>'){cell=false;result+=' | ';}
  else if(token==='</w:tr>'){row=false;result+='\n';}
  else if(token==='<w:tab/>')result+='\t';
  else if(token.startsWith('<w:br'))result+='\n';
  else if(token==='</w:p>')result+=row?' ':'\n';
 }
 const body=result.replace(/\s*\|\s*(?=\n)/g,'').replace(/\n{3,}/g,'\n\n').trim();
 if(body.length<200)throw new Error('DOCX 正文过短或未能完整提取，请检查文件内容');
 return body+'\n';
}
export function validateStageOne(content:string) {
 if(content.length<500||content.length>200000)throw new Error('第一阶段指令正文长度应为 500–200000 字符');
 for(const [label,expr] of [
  ['第一阶段',/第一阶段/],['参考视频',/参考视频/],['克隆音频',/克隆音频|配音/],
  ['Prompt',/Prompt|提示词/i],['时间确认',/时间.{0,8}确认|确认.{0,8}时间/],
  ['无字幕',/字幕/],['分镜',/分镜|镜头表|镜头拆解/]
 ] as const)if(!expr.test(content))throw new Error('第一阶段指令缺少核心内容：'+label);
 return {version:content.match(/(?:^|[^\d])v(\d+\.\d+(?:\.\d+)?)/i)?.[1]||'未注明',length:content.length};
}
export class Stage1TemplateService {
 private base:string;
 private version:string;
 private defaultContent:string;
 private defaultName:string;
 private pending=new Map<string,{name:string;content:string;source:Buffer;ext:string;version:string}>();
 constructor(root:string,defaults?:{version:string;content:string;name:string}){
  this.base=join(root,'settings','stage1-template');
  this.version=defaults?.version??LEGACY_DEFAULT_VERSION;
  this.defaultContent=defaults?.content??packageGuide('stage1');
  this.defaultName=defaults?.name??'v1.2.0 默认模板';
 }
 current() {
  const file=join(this.base,'current.md');
  const custom=existsSync(file);
  const content=custom?readFileSync(file,'utf8'):this.defaultContent;
  let metadata:{sourceVersion?:string;name?:string}={};
  if(custom)try{metadata=JSON.parse(readFileSync(join(this.base,'metadata.json'),'utf8'));}catch{/* old custom templates have no metadata */}
  const sourceVersion=custom?(metadata.sourceVersion||validateStageOne(content).version):this.version;
  return {custom,version:this.version,sourceVersion,sourceName:custom?(metadata.name||'历史自定义文档'):this.defaultName,content,preview:content.slice(0,1800),previousAvailable:existsSync(join(this.base,'previous.md'))};
 }
 async inspect(path:string) {
  const ext=extname(path).toLowerCase();if(!['.md','.docx'].includes(ext))throw new Error('仅支持 .md 或 .docx 文件');
  const bytes=await readFile(path);if(bytes.length<100||bytes.length>MAX_BYTES)throw new Error('文档大小须在 100 字节至 10MiB 之间');
  const content=ext==='.docx'?convertDocx(bytes):decode(bytes);
  const {version,length}=validateStageOne(content);
  const token=randomUUID();this.pending.clear();this.pending.set(token,{name:path.split(/[\\/]/).pop()||'文档',content,source:bytes,ext,version});
  const old=this.current();
  return {token,name:path.split(/[\\/]/).pop(),version,length,preview:content.slice(0,1800),currentPreview:old.preview,currentCustom:old.custom,requiresLegacyConfirmation:version!==this.version};
 }
 async apply(token:string,allowLegacy:boolean){
  const choice=this.pending.get(token);if(!choice)throw new Error('替换预览已过期，请重新选择文档');
  if(choice.version!==this.version&&!allowLegacy)throw new Error('文档标记为 '+choice.version+'，与当前默认指令版本 '+this.version+' 不一致；请明确确认使用该内容');
  await mkdir(this.base,{recursive:true});
  const dest=join(this.base,'current.md'),previous=join(this.base,'previous.md');
  if(existsSync(dest))await copyFile(dest,previous);
  const tmp=dest+'.tmp';await writeFile(tmp,choice.content,'utf8');await rename(tmp,dest);
  await writeFile(join(this.base,'source'+choice.ext),choice.source); // preserve the source file for traceability
  await writeFile(join(this.base,'metadata.json'),JSON.stringify({name:choice.name,sourceVersion:choice.version,appVersion:this.version,updatedAt:new Date().toISOString()}),'utf8');
  this.pending.delete(token);return this.current();
 }
 async restore(){
  await mkdir(this.base,{recursive:true});
  const dest=join(this.base,'current.md'),previous=join(this.base,'previous.md');
  if(existsSync(dest))await copyFile(dest,previous);
  // Default is represented by the absence of current.md; preserve previous.md and original sources.
  await rm(dest,{force:true});
  await writeFile(join(this.base,'metadata.json'),JSON.stringify({name:this.defaultName,sourceVersion:this.version,appVersion:this.version,updatedAt:new Date().toISOString()}),'utf8');
  return this.current();
 }
}
