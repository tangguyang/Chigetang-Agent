import { readFileSync,existsSync,mkdtempSync,copyFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { renderPdfPages,pageNumbers } from '../src/renderer/tools/pdf.ts';
import { LocalTools } from '../src/main/services/localTools.ts';
const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;

const require=createRequire(import.meta.url);const canvas=require(runtime?join(runtime,'@napi-rs/canvas'):'@napi-rs/canvas');
Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});
const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
const tools=new LocalTools(()=>undefined);const input=join(mkdtempSync('/tmp/中文PDF测试-'),'多页中文.pdf');copyFileSync(process.argv[2]||'tests/fixtures/中文多页.pdf',input);
const resources=resolve('node_modules/pdfjs-dist');
for(const format of ['png','jpg'] as const){for(const range of ['', '2-3']){
 const pdf=await pdfjs.getDocument({data:await tools.pdfRead(input),cMapUrl:resources+'/cmaps/',cMapPacked:true,standardFontDataUrl:resources+'/standard_fonts/',wasmUrl:resources+'/wasm/',isEvalSupported:false}).promise;
 assert.equal(pdf.numPages,3);const job=await tools.pdfStart(input,format);const pages=pageNumbers(range,pdf.numPages);
 await renderPdfPages(pdf,pages,format,()=>canvas.createCanvas(1,1),async(page,bytes)=>tools.pdfPage(job.id,page,bytes));const result=await tools.pdfFinish(job.id,true);assert(result);assert.equal(result.count,pages.length);
 for(const p of pages){const path=join(result.folder,`page_${String(p).padStart(3,'0')}.${format}`);const im=await canvas.loadImage(readFileSync(path));assert(im.width>1600&&im.height>2200);}
 if(range)assert.equal(existsSync(join(result.folder,'page_001.'+format)),false);
 let opened='';await tools.open(result.folder,async p=>{opened=p;return '';});assert.equal(opened,result.folder);await pdf.destroy();console.log('PASS',format,range||'全部页面',result.folder);
}}
await assert.rejects(pdfjs.getDocument({data:new Uint8Array(Buffer.from('broken pdf'))}).promise);
console.log('PASS 错误 PDF 可捕获，不崩溃');
