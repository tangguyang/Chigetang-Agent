import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compileLocalTask } from '../src/main/services/localTaskCompiler.ts';
import { SafeTaskZip } from '../src/main/services/taskPackage.ts';
import { validateTaskPackage } from '../src/shared/taskPackage.ts';

test('经确认的两段 GEN 实际裁视频与音频，标准 ZIP 能被生产解析器读取',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ctg127-'));
 try{
  execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=128x128:rate=25','-t','8','-c:v','libx264','-pix_fmt','yuv420p',join(root,'original.mp4')]);
  execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=24000','-t','8','-c:a','pcm_s16le',join(root,'clone.wav')]);
  const plan={plan_version:'1.0',approved:true,task_id:'compile-test',task_name:'两段真实参考',source_video:'original.mp4',full_audio:'clone.wav',segments:[
   {id:'G001',source_range_ms:[0,3500],audio_range_ms:[0,3500],active_edit_range_ms:[400,2800],shot_ids:['S001'],duration_seconds:5,prompt:'编辑 @motion，参考 @voice，保留镜头。'},
   {id:'G002',source_range_ms:[3500,7000],audio_range_ms:[3500,7000],active_edit_range_ms:[4200,6500],shot_ids:['S002'],duration_seconds:5,prompt:'编辑 @motion，参考 @voice，保留镜头。'}]};
  const path=join(root,'plan.json'),dest=join(root,'task.zip'),opts={tempRoot:join(root,'tmp'),wasmPath:resolve('resources/MediaInfoModule.wasm')};writeFileSync(path,JSON.stringify(plan));
  const result=await compileLocalTask(path,dest,opts);assert.equal(result.segments,2);assert.match(result.sha256,/^[a-f0-9]{64}$/);
  const zip=new SafeTaskZip(readFileSync(dest)),m=validateTaskPackage(JSON.parse(zip.read('manifest.json').toString()),p=>zip.has(p),p=>zip.read(p).toString());
  assert.deepEqual(m.segments.map(s=>s.source_range_ms),[[0,3500],[3500,7000]]);assert.equal(m.shared.params.prompt_extend,false);
  assert.notEqual(m.segments[0].bindings?.voice,m.segments[1].bindings?.voice);
  assert.notDeepEqual(zip.read(m.assets.find(a=>a.id===m.segments[0].bindings?.motion)!.path),zip.read(m.assets.find(a=>a.id===m.segments[1].bindings?.motion)!.path));
  assert.match(zip.read('analysis/timeline.md').toString(),/S002/);
  writeFileSync(path,JSON.stringify({...plan,approved:false}));await assert.rejects(compileLocalTask(path,join(root,'bad.zip'),opts),/已确认/);
  writeFileSync(path,JSON.stringify({...plan,segments:[{...plan.segments[0],source_range_ms:[0,15001]}]}));await assert.rejects(compileLocalTask(path,join(root,'long.zip'),opts),/3–15/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
