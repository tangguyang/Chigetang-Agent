// Local UI acceptance only. Uses existing application/SQLite and a real MP4 fixture.
import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.QA_PLAYWRIGHT_MODULE || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright-core/index.mjs');
const dir=resolve('.visual-v123'), report='docs/v1.2.3';mkdirSync(dir,{recursive:true});mkdirSync(report,{recursive:true});
await build({stdin:{contents:"import './src/renderer/main.tsx';import {useApp} from './src/renderer/store.ts';window.qa=useApp;",resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'esm',outfile:dir+'/app.js',plugins:[{name:'local-media',setup(b){b.onLoad({filter:/store\.ts$/},async({path})=>({contents:readFileSync(path,'utf8').replace('aivideo://local/','http://127.0.0.1:4178/media/'),loader:'ts'}));}}]});
mkdirSync(dir+'/resources',{recursive:true});cpSync('resources/brand.svg',dir+'/resources/brand.svg');
let font='';if(process.env.QA_FONT_DIR){cpSync(process.env.QA_FONT_DIR,dir+'/font',{recursive:true});font='<link rel="stylesheet" href="/font/400.css"><style>:root{font-family:"Noto Sans SC",sans-serif}</style>';}
writeFileSync(dir+'/index.html',`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css">${font}</head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
let serverCode=readFileSync('scripts/visual-server.ts','utf8')
 .replace('name: `视频测试任务 ${i + 1}`','name: `漂亮和气质哪个更重要体重管理复刻任务20260923VeryLongUnbrokenName${i + 1}`')
 .replace('app.tasks.save(t);',"t.downloadStatus='completed';t.outputPath=resolve('tests/fixtures/sample.mp4');app.tasks.save(t);")
 .replace('const a = app.assets.get(url.pathname.split("/").at(-1)!);\n      file = a.managedPath || a.originalPath;',"const id=url.pathname.split('/').at(-1);if(url.pathname.includes('/output/'))file=app.tasks.get(id).outputPath;else {const a=app.assets.get(id);file=a.managedPath||a.originalPath;}")
 .replace('".png": "image/png",', '".png": "image/png", \".svg\": \"image/svg+xml\",')
 .replace('case "assets.get":', 'case "assets.inspect":\n        case "assets.get":')
 .replace('case "bootstrap":', 'case "open": value=true;break;\n        case "bootstrap":');
writeFileSync('scripts/.visual-v123-server.ts',serverCode);
const server=spawn(process.execPath,['--experimental-strip-types','scripts/.visual-v123-server.ts',dir],{stdio:['ignore','pipe','pipe']});
server.stderr.on('data',b=>process.stderr.write(b));
await new Promise((ok,no)=>{server.stdout.on('data',b=>{if(String(b).includes('QA_READY'))ok();});server.once('exit',c=>no(Error('Server exit '+c)));});
let browser;const results=[];
try{
 browser=await chromium.launch({executablePath:process.env.QA_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],headless:true});
 for(const [width,height] of [[1440,960],[1920,1080],[1050,720],[960,540],[740,720]]){
  const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{window.aiVideo={invoke:async(action,payload)=>{const r=await fetch('/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})});const v=await r.json();if(!v.ok)throw Error(v.error);return v.data;},onChange:()=>()=>{},onNavigate:()=>()=>{},filePath:()=>''};});
  await page.goto('http://127.0.0.1:4178');await page.waitForSelector('.queue-item');await page.evaluate(()=>document.fonts.ready);
  const queue=await page.locator('.queue').evaluate(el=>({width:el.getBoundingClientRect().width,client:el.clientWidth,scroll:el.scrollWidth,titleStyle:getComputedStyle(el.querySelector('strong')).whiteSpace}));
  assert.equal(queue.width,290);assert(queue.scroll<=queue.client+1);assert.equal(queue.titleStyle,'normal');
  if(width===1440)await page.screenshot({path:report+'/video-1440.png'});
  await page.getByRole('button',{name:'一键生成',exact:true}).click();await page.waitForSelector('.output-video-duration');
  await page.waitForFunction(()=>[...document.querySelectorAll('.output-video-duration')].every(el=>/视频时长：[\d.]+秒/.test(el.textContent)),null,{timeout:15000});
  const actualDuration=await page.locator('.output-video-duration').first().textContent();assert(!actualDuration.includes('12秒'));
  if(width>740){
   const handle=page.getByRole('separator',{name:'调整任务列表宽度'});const box=await handle.boundingBox();
   const before=await page.locator('.workbench-task-sidebar').evaluate(e=>e.getBoundingClientRect().width);
   await page.mouse.move(box.x+box.width/2,box.y+30);await page.mouse.down();await page.mouse.move(box.x+160,box.y+30);await page.mouse.up();
   assert((await page.locator('.workbench-task-sidebar').evaluate(e=>e.getBoundingClientRect().width))>before);
   await handle.press('End');
  }
  const layout=await page.evaluate(()=>{
   const get=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,right:r.right,bottom:r.bottom,client:e.clientWidth,scroll:e.scrollWidth};};
   return {list:get('.workbench-task-list'),pane:get('.workbench-task-sidebar'),main:get('.oneclick-main'),options:get('.oneclick-options'),root:get('.oneclick-workbench')};
  });
  assert(layout.list.scroll<=layout.list.client+1);assert(layout.root.scroll<=layout.root.client+1);
  if(width>740){assert(layout.main.width>=300);assert(layout.pane.right<=layout.main.x);if(width>1140)assert(layout.main.right<=layout.options.x);}
  await page.screenshot({path:report+`/oneclick-${width}.png`});
  if(width===1440){
   const saved=await page.evaluate(()=>localStorage.getItem('chigetang-oneclick-task-width'));assert.equal(saved,'420');
   await page.getByRole('separator',{name:'调整任务列表宽度'}).press('Home');assert.equal(await page.locator('.workbench-task-sidebar').evaluate(e=>e.getBoundingClientRect().width),180);
   await page.getByRole('button',{name:'打开生成视频保存目录'}).click();
  }
  assert.deepEqual(errors,[]);results.push({width,height,queue,layout,actualDuration,errors});await context.close();
 }
 writeFileSync(report+'/visual-results.json',JSON.stringify(results,null,2));console.log('PASS five viewport layouts, pointer/keyboard resize, actual MP4 metadata, fixed queue, no page errors');
}finally{await browser?.close();server.kill('SIGTERM');}
