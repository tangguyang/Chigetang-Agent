import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskPackageService } from '../src/main/services/taskPackage.ts';
import { validateNoOverlayInstructions, validateTaskPackage } from '../src/shared/taskPackage.ts';

test('R3 subtitle instruction clauses: conflicting positive action is rejected', () => {
 for (const phrase of ['禁止字幕，请添加字幕。','禁止字幕:必须显示字幕','不要水印，但请生成水印','禁止字幕；在屏幕上叠加文字浮层']) {
  assert.throws(()=>validateNoOverlayInstructions(phrase),/附加字幕/);
 }
 for (const phrase of ['禁止字幕、屏幕文字、水印','不要添加字幕，禁止无关 Logo','保留产品包装原有印字']) {
  assert.doesNotThrow(()=>validateNoOverlayInstructions(phrase));
 }
});

test('R3 default duration boundary strictly accepts -1 and 2-30', () => {
 const manifest:any={schema_version:'1.2.0',package_type:'chigetang.wan-task',task_id:'duration-case',task_name:'时长边界',engine:'wan3',
  assets:[],shared:{params:{duration:17,audio:false,resolution:'720P',ratio:'9:16'}},
  segments:[{id:'s1',order:1,prompt_file:'prompts/s1.txt',duration_seconds:17}]};
 for (const v of [-2,0,1,31,1.5]) {manifest.shared.params.duration=v;assert.throws(()=>validateTaskPackage(manifest,p=>p==='prompts/s1.txt',()=> '只执行普通画面生成。'),/默认时长/);}
 for (const v of [-1,2,17,30]) {manifest.shared.params.duration=v;assert.equal(validateTaskPackage(manifest,p=>p==='prompts/s1.txt',()=> '只执行普通画面生成。').shared.params.duration,v);}
});

test('R3 submit has a synchronous per-session backend lock before preflight await', async () => {
 const root=mkdtempSync(join(tmpdir(),'ctg-r3-lock-'));
 try {
  let release!:()=>void;
  const gate=new Promise<void>(r=>{release=r;});
  let preflightCount=0,createCount=0,resumeCount=0;
  const app:any={root,tasks:{create:async()=>{createCount++;return {id:'task-1',status:'Draft'};},resume:()=>{resumeCount++;}}};
  const svc:any=new TaskPackageService(app);
  const t:any={id:'s1',name:'一段',revision:1,checkedRevision:1,prompt:'画面无字幕',mapping:[],binding:{},draft:{modelId:'wan3',accountId:'a',outputDir:root,params:{duration:17}}};
  const row:any={sessionId:'lock-test',taskId:'same',packageHash:'abc',name:'测试',folder:join(root,'lock-test'),schemaVersion:'1.2.0',state:'ready',results:[],tasks:[t],confirmedRevision:1,createdAt:new Date().toISOString()};
  svc.sessions.set(row.sessionId,row);
  row.confirmedHash=svc.snapshot(row);
  svc.preflight=async()=>{preflightCount++;await gate;return svc.view(row);};
  const first=svc.submit(row.sessionId);
  await assert.rejects(svc.submit(row.sessionId),/正在提交|不能重复/);
  assert.equal(preflightCount,1);
  release();
  const created=await first;
  assert.equal(created.length,1);assert.equal(createCount,1);assert.equal(resumeCount,1);
  assert.equal(svc.detail(row.sessionId).state,'submitted');
 } finally {rmSync(root,{recursive:true,force:true});}
});
