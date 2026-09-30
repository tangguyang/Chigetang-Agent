import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { TASK_PACKAGE_LIMITS, validPackagePath } from '../../shared/taskPackage.ts';

const table=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crcStep=(crc:number,buffer:Buffer)=>{for(const byte of buffer)crc=table[(crc^byte)&255]^(crc>>>8);return crc>>>0;};
async function checksum(path:string){let c=0xffffffff;for await(const part of createReadStream(path))c=crcStep(c,part as Buffer);return(c^0xffffffff)>>>0;}
async function writeAll(out:Awaited<ReturnType<typeof open>>,bytes:Buffer){let start=0;while(start<bytes.length){const {bytesWritten}=await out.write(bytes,start,bytes.length-start);if(!bytesWritten)throw new Error('ZIP 写入中断');start+=bytesWritten;}}

export async function writeTaskZip(destination:string,entries:Array<{path:string;file:string}>){
 if(!entries.length||entries.length>TASK_PACKAGE_LIMITS.entries)throw new Error('ZIP 条目数量超限');
 const paths=new Set<string>(),rows=[] as Array<{name:Buffer;file:string;length:number;crc:number;path:string}>;let total=22;
 for(const entry of entries){
  if(!validPackagePath(entry.path)||paths.has(entry.path))throw new Error('重复或非法路径：'+entry.path);paths.add(entry.path);
  const name=Buffer.from(entry.path,'utf8'),info=await stat(entry.file);
  if(!info.isFile()||info.size>TASK_PACKAGE_LIMITS.entryBytes||name.length>0xffff)throw new Error('素材无效或超出单文件限制：'+entry.path);
  total+=info.size+76+2*name.length;
  if(total>TASK_PACKAGE_LIMITS.zipBytes)throw new Error('ZIP 超出 200MiB，请减少素材');
  rows.push({...entry,name,length:info.size,crc:await checksum(entry.file)});
 }
 const out=await open(destination,'wx'),central:Buffer[]=[];let offset=0;
 try{
  for(const row of rows){
   const start=offset,h=Buffer.alloc(30+row.name.length);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);
   h.writeUInt32LE(row.crc,14);h.writeUInt32LE(row.length,18);h.writeUInt32LE(row.length,22);h.writeUInt16LE(row.name.length,26);row.name.copy(h,30);
   await writeAll(out,h);offset+=h.length;let copied=0;
   for await(const part of createReadStream(row.file)){await writeAll(out,part as Buffer);copied+=(part as Buffer).length;}
   if(copied!==row.length)throw new Error('编译时文件被修改：'+row.path);offset+=copied;
   const c=Buffer.alloc(46+row.name.length);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);
   c.writeUInt32LE(row.crc,16);c.writeUInt32LE(row.length,20);c.writeUInt32LE(row.length,24);c.writeUInt16LE(row.name.length,28);
   c.writeUInt32LE((0o100644<<16)>>>0,38);c.writeUInt32LE(start,42);row.name.copy(c,46);central.push(c);
  }
  const directory=Buffer.concat(central);await writeAll(out,directory);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(rows.length,8);end.writeUInt16LE(rows.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);await writeAll(out,end);await out.sync();
 }finally{await out.close();}
}
