import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SafeTaskZip } from '../src/main/services/taskPackage.ts';
import { validateTaskPackage, taskPackageTokens } from '../src/shared/taskPackage.ts';
import { packageGuide } from '../src/shared/taskPackageDocs.ts';

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for(let k=0;k<8;k++) crc = crc&1 ? (crc>>>1)^0xedb88320:crc>>>1; }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: Record<string,Buffer|string>) {
  const locals:Buffer[] = [], centrals:Buffer[] = [];
  let offset=0, count=0;
  for (const [name, source] of Object.entries(files)) {
    const bytes=Buffer.isBuffer(source)?source:Buffer.from(source);
    const label=Buffer.from(name);
    const crc=crc32(bytes);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(label.length,26);
    locals.push(local,label,bytes);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);
    central.writeUInt16LE(label.length,28);central.writeUInt32LE(offset,42);
    centrals.push(central,label);
    offset+=local.length+label.length+bytes.length;count++;
  }
  const index=Buffer.concat(centrals);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);
  end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,index,end]);
}
function fixture(two=false) {
  const person=Buffer.from('mock image content');
  const motion=Buffer.from('mock video content');
  const voice=Buffer.from('mock audio content');
  const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
  const assets = [
    {id:'person.main',type:'image',path:'assets/person/main.jpg',usage:'wan_reference',sha256:hash(person)},
    {id:'motion.001',type:'video',path:'assets/video/001.mp4',usage:'wan_reference',sha256:hash(motion)},
    {id:'voice.001',type:'audio',path:'assets/audio/001.wav',usage:'wan_reference',sha256:hash(voice)}
  ];
  const seg = (order:number) => ({id:`segment_${String(order).padStart(3,'0')}`,order,prompt_file:`prompts/${String(order).padStart(3,'0')}.txt`,duration_seconds:19,bindings:{'@动作视频':'motion.001','@克隆音频':'voice.001'}});
  const manifest = {schema_version:'1.0',package_type:'chigetang.wan-task',task_id:'test-001',task_name:'测试复刻',engine:'wan3',assets,shared:{params:{duration:20,resolution:'1080P',ratio:'9:16',audio:false,seed:-1},bindings:{'@人物母图':'person.main'},reference_order:['@人物母图','@动作视频','@克隆音频']},segments:two?[seg(1),seg(2)]:[seg(1)]};
  const prompt='参考 @人物母图 和 @动作视频，依据 @克隆音频 表演；手部无美甲、无戒指、无手镯。';
  const files:Record<string,Buffer|string>={'manifest.json':JSON.stringify(manifest),'assets/person/main.jpg':person,'assets/video/001.mp4':motion,'assets/audio/001.wav':voice,'prompts/001.txt':prompt};
  if(two) files['prompts/002.txt']=prompt;
  return {manifest,files};
}

test('v112 single and multi-segment packages have exact real @asset bindings',()=>{
  for (const count of [false,true]) {
    const data=zip(fixture(count).files), reader=new SafeTaskZip(data);
    const m=validateTaskPackage(JSON.parse(reader.read('manifest.json').toString()),p=>reader.has(p),p=>reader.read(p).toString());
    assert.equal(m.segments.length,count?2:1);
    assert.deepEqual(taskPackageTokens(reader.read('prompts/001.txt').toString()),['@人物母图','@动作视频','@克隆音频']);
  }
});

test('v112 rejects unbound semantic @asset before paid submission',()=>{
  const {files}=fixture();files['prompts/001.txt']='参考 @人物母图 和 @未知素材';
  const reader=new SafeTaskZip(zip(files));
  assert.throws(()=>validateTaskPackage(JSON.parse(reader.read('manifest.json').toString()),p=>reader.has(p),p=>reader.read(p).toString()),/未绑定/);
});

test('v112 rejects path traversal, duplicate ZIP entries and CRC tampering',()=>{
  assert.throws(()=>new SafeTaskZip(zip({'../escape.txt':'unsafe'})),/非法|路径/);
  const data=zip({'assets/one.txt':'original'});
  const broken=Buffer.from(data);broken[30+Buffer.byteLength('assets/one.txt')] ^= 1;
  assert.throws(()=>new SafeTaskZip(broken).read('assets/one.txt'),/完整性/);
});

test('v112 exported ChatGPT instructions and schema share contract and hand restrictions',()=>{
  const spec=packageGuide('spec'), instruction=packageGuide('instruction');
  assert(spec.includes('chigetang.wan-task'));
  assert(spec.includes('schema_version'));
  assert(spec.includes('source_range_ms'));
  assert(instruction.includes('本次任务填写区'));
  assert(instruction.includes('不写逐字台词'));
  assert(instruction.includes('不要有美甲'));
  assert(instruction.includes('本次任务填写区'));
  assert(packageGuide('stage2').includes('第二阶段｜用户确认后制作标准 ZIP'));
  assert(instruction.includes('软件规范与优先级'));
  assert(packageGuide('stage2').includes('原片绝对时间与片段相对时间'));
  assert(packageGuide('stage2').includes('真实文件字节'));
  assert(packageGuide('stage2').includes('无美甲、无长指甲、无戒指'));
  assert(instruction.includes('用户明确确认后'));
  assert(!instruction.includes('本次仅完成第一阶段。'));
});

test('v112 imported two segments bind distinct references and queue only after both are prepared', async()=>{
  const {TaskPackageService}=await import('../src/main/services/taskPackage.ts');
  const {models}=await import('../src/shared/catalog.ts');
  const {mkdtempSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const root=mkdtempSync(join(tmpdir(),'ctg-v112-'));
  const fixtureData=fixture(true), person=Buffer.from('mock image content'), motion=Buffer.from('mock video content'), voice=Buffer.from('mock audio content');
  const otherMotion=Buffer.from('second motion content'),otherVoice=Buffer.from('second voice content');
  const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
  fixtureData.manifest.assets.push({id:'motion.002',type:'video',path:'assets/video/002.mp4',usage:'wan_reference',sha256:hash(otherMotion)});
  fixtureData.manifest.assets.push({id:'voice.002',type:'audio',path:'assets/audio/002.wav',usage:'wan_reference',sha256:hash(otherVoice)});
  fixtureData.files['assets/video/002.mp4']=otherMotion;
  fixtureData.files['assets/audio/002.wav']=otherVoice;
  fixtureData.manifest.segments[1].bindings['@动作视频']='motion.002';
  fixtureData.manifest.segments[1].bindings['@克隆音频']='voice.002';
  fixtureData.files['manifest.json']=JSON.stringify(fixtureData.manifest);
  const archive=join(root,'task.zip');writeFileSync(archive,zip(fixtureData.files));
  const registry=new Map<string,any>(); const snapshots:any[]=[]; const enqueued:string[]=[]; const requestRecords=new Map<string,{id:string;status:string}>();
  const fakeApp:any = {
    root,
    models:()=>[structuredClone(models.find(m=>m.id==='wan3')!)],
    credentials:{list:()=>[{id:'account',enabled:true,providerId:'alibaba'}]},
    assets:{
      import:async(path:string)=>{
        const {readFileSync}=await import('node:fs');const {extname,basename}=await import('node:path');
        const bytes=readFileSync(path);const id=hash(bytes);
        const kind=extname(path).toLowerCase()==='.jpg'?'image':extname(path).toLowerCase()==='.mp4'?'video':'audio';
        const asset={id,name:basename(path),kind,originalPath:path,managedPath:null,size:bytes.length,mime:kind==='image'?'image/jpeg':kind==='video'?'video/mp4':'audio/wav',hash:id,createdAt:new Date().toISOString(),lastUsedAt:null,tags:[],folder:'',projectId:null,favorite:false,width:720,height:1280,fps:30,duration:kind==='video'?7:kind==='audio'?10:undefined,metadata:{detectedFormat:extname(path).slice(1)}};
        registry.set(id,asset);return {asset,duplicate:false};
      },
      refreshMetadata:async(id:string)=>registry.get(id),
      get:(id:string)=>registry.get(id)
    },
    settings:()=>({outputDir:root}),
    tasks:{
      estimate:()=>({cost:{amount:1,currency:'CNY',kind:'estimate',note:''},breakdown:[]}),
      create:async(draft:any,requestId:string,_snapshot:any,deferQueue:boolean)=>{
        assert(deferQueue);const existing=requestRecords.get(requestId);if(existing)return existing;snapshots.push({draft,requestId});const row={id:'task'+snapshots.length,status:'Draft'};requestRecords.set(requestId,row);return row;
      },
      resume:(id:string)=>{assert.equal(snapshots.length,2,'never enqueue before all drafts were created');enqueued.push(id);for (const row of requestRecords.values())if(row.id===id)row.status='Queued';}
    }
  };
  const service=new TaskPackageService(fakeApp);
  const preview=await service.importZip(archive);
  assert.equal(preview.segments.length,2);
  assert.equal(preview.segments[0].duration,19);
  await assert.rejects(service.submit(preview.sessionId),/尚未确认/);
  await service.confirm(preview.sessionId,preview.revision);
  const result=await service.submit(preview.sessionId);
  assert.deepEqual(result.map(x=>x.taskId),['task1','task2']);
  assert.deepEqual(enqueued,['task1','task2']);
  assert.match(snapshots[0].draft.prompt,/@Image1/);
  assert.match(snapshots[0].draft.prompt,/@Video1/);
  assert.match(snapshots[0].draft.prompt,/@Audio1/);
  assert.notEqual(snapshots[0].draft.assets.find((b:any)=>b.role==='reference_video').assetId,snapshots[1].draft.assets.find((b:any)=>b.role==='reference_video').assetId);
  assert.notEqual(snapshots[0].draft.assets.find((b:any)=>b.role==='reference_audio').assetId,snapshots[1].draft.assets.find((b:any)=>b.role==='reference_audio').assetId);
  await assert.rejects(service.submit(preview.sessionId),/已经提交/);
  const nextRound=await service.importZip(archive);
  assert.equal(nextRound.renewedTaskId,true);
  assert.notEqual(nextRound.taskId,nextRound.sourceTaskId);
  assert.deepEqual(enqueued,['task1','task2'],'reimport may prepare a new round but must not submit it automatically');
});
