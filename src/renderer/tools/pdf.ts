import type { PDFDocumentProxy } from 'pdfjs-dist';
export function pageNumbers(value:string,count:number){
 if(!value.trim())return Array.from({length:count},(_,i)=>i+1);
 const pages=new Set<number>();for(const part of value.replaceAll('，',',').split(',')){const m=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw new Error('页码格式示例：1-3,5');const a=Number(m[1]),b=Number(m[2]||m[1]);if(a<1||b<a||b>count)throw new Error(`页码须在 1–${count} 内，且起始页不大于结束页`);for(let i=a;i<=b;i++)pages.add(i);}return [...pages].sort((a,b)=>a-b);
}
export async function renderPdfPages(pdf:PDFDocumentProxy,pages:number[],format:'png'|'jpg',makeCanvas:()=>HTMLCanvasElement,save:(page:number,bytes:Uint8Array)=>Promise<void>){
 for(const number of pages){const page=await pdf.getPage(number);const viewport=page.getViewport({scale:200/72});if(viewport.width*viewport.height>40000000)throw new Error('此页尺寸过大，无法安全转换');const canvas=makeCanvas();canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d')!;
 try{await page.render({canvas,canvasContext:context,viewport,background:'rgb(255,255,255)'}).promise;const data=canvas.toDataURL(format==='png'?'image/png':'image/jpeg',0.94).split(',')[1];await save(number,Uint8Array.from(atob(data),c=>c.charCodeAt(0)));}finally{page.cleanup();canvas.width=canvas.height=0;}
 }
}
