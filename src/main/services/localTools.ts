import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,writeFile,mkdir,stat,rm,rename } from 'node:fs/promises';
import { basename,dirname,extname,join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ffmpegBinary } from './transcode.ts';
const exec=promisify(execFile);
export class LocalTools {
 private outputs=new Set<string>();
 private jobs=new Map<string,{folder:string;format:'png'|'jpg';pages:number[]}>();
 private ffmpeg:()=>string|undefined;
 constructor(ffmpeg:()=>string|undefined){this.ffmpeg=ffmpeg;}
 async input(path:string,extensions:string[]){if(!extensions.includes(extname(path).toLowerCase()))throw new Error('文件格式不支持');const s=await stat(path);if(!s.isFile()||!s.size)throw new Error('文件为空或无法读取');return resolve(path);}
 async audio(path:string,format:string,directory?:string){
 if(!['mp3','wav'].includes(format))throw new Error('请选择 MP3 或 WAV');const input=await this.input(path,['.mp4','.mov','.mkv']);const dir=resolve(directory||dirname(input));await mkdir(dir,{recursive:true});
 const folder=await this.outputFolder(dir,basename(input,extname(input))+'-音频');const output=join(folder,basename(input,extname(input))+'.'+format);const temp=join(folder,'processing.'+format);
 try{await exec(ffmpegBinary(this.ffmpeg()),['-nostdin','-v','error','-n','-i',input,'-map','0:a:0','-vn',...(format==='mp3'?['-c:a','libmp3lame','-q:a','2']:['-c:a','pcm_s16le']),temp],{windowsHide:true,timeout:60*60*1000,maxBuffer:1024*1024});await rename(temp,output);this.outputs.add(folder);return {folder,files:[output]};}
 catch(e){await rm(folder,{recursive:true,force:true});throw new Error('音频提取失败：请确认视频含可解码音轨、输出目录可写及 FFmpeg 可用。');}
 }
 async pdfRead(path:string){const input=await this.input(path,['.pdf']);if((await stat(input)).size>200*1024*1024)throw new Error('PDF 超过 200MB');return new Uint8Array(await readFile(input));}
 async pdfStart(path:string,format:string,directory?:string){if(!['png','jpg'].includes(format))throw new Error('请选择 PNG 或 JPG');const input=await this.input(path,['.pdf']);const folder=await this.outputFolder(resolve(directory||dirname(input)),basename(input,extname(input))+'-图片');const id=randomUUID();this.jobs.set(id,{folder,format:format as 'png'|'jpg',pages:[]});return {id,folder};}
 async pdfPage(id:string,page:number,bytes:Uint8Array){const job=this.jobs.get(id);if(!job||!Number.isInteger(page)||page<1||page>100000||job.pages.includes(page))throw new Error('转换状态无效');const buffer=Buffer.from(bytes);if(buffer.length>100*1024*1024||buffer.length<8||(job.format==='png'?!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):buffer[0]!==255||buffer[1]!==216))throw new Error('图片数据无效');await writeFile(join(job.folder,`page_${String(page).padStart(3,'0')}.${job.format}`),buffer,{flag:'wx'});job.pages.push(page);}
 async pdfFinish(id:string,success:boolean){const job=this.jobs.get(id);if(!job)throw new Error('转换任务不存在');this.jobs.delete(id);if(!success||!job.pages.length){await rm(job.folder,{recursive:true,force:true});return null;}this.outputs.add(job.folder);return {folder:job.folder,count:job.pages.length};}
 async open(folder:string,openPath:(p:string)=>Promise<string>){if(!this.outputs.has(folder))throw new Error('输出目录不存在或任务未完成');const error=await openPath(folder);if(error)throw new Error(error);}
 private async outputFolder(dir:string,name:string){await mkdir(dir,{recursive:true});for(let n=0;n<1000;n++){const folder=join(dir,name+(n?'_'+n:''));try{await mkdir(folder);return folder;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}}throw new Error('输出目录名称冲突');}
}
