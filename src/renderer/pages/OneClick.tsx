import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { Asset } from '../../shared/types.ts';
import { api, media, useApp } from '../store.ts';
import { AssetPreview } from './Assets.tsx';
import { WorkbenchTaskSidebar, useWorkbenchTasks } from '../components/WorkbenchTaskSidebar.tsx';
type Mapping={alias:string;assetId:string;file:string;slot:string;kind:string};
type Segment={id:string;name:string;prompt:string;duration:number;originalDuration:number;params:Record<string,unknown>;
 revision:number;checked:boolean;issue?:string;mapping:Mapping[];sourceRangeMs?:[number,number];cost:{cost:{amount:number|null;currency:string}}};
type Pack={sessionId:string;taskId:string;sourceTaskId:string;renewedTaskId:boolean;name:string;folder:string;revision:number;state:string;confirmed:boolean;requiresReconfirmation:boolean;
 results:Array<{segmentId:string;taskId:string}>;segments:Segment[]};
function CompactAudio({asset}:{asset:Asset}){
 const ref=useRef<HTMLAudioElement>(null);const [playing,setPlaying]=useState(false);
 const toggle=()=>{const player=ref.current;if(!player)return;if(player.paused)void player.play();else player.pause();};
 return <div className="oneclick-audio"><audio ref={ref} hidden src={media('asset',asset.id)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}/><button type="button" onClick={toggle}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?'暂停':'播放'}</button><small>{asset.duration!==undefined?`${asset.duration}秒`:'时长未知'}</small></div>;
}
export function OneClickPage(){
 const {message,setTask}=useApp();const {tasks,refresh}=useWorkbenchTasks();
 const [pack,setPack]=useState<Pack|null>(null),[activeId,setActiveId]=useState('');
 const [params,setParams]=useState<Record<string,unknown>>({});const [media,setMedia]=useState<Record<string,Asset>>({});
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const locked=useRef(false);
 const active=pack?.segments.find(s=>s.id===activeId)??pack?.segments[0];
 useEffect(()=>{if(!active)return;setParams({...active.params});},[activeId,active?.revision,pack?.sessionId]);
 useEffect(()=>{if(!pack)return;const ids=[...new Set(pack.segments.flatMap(s=>s.mapping.map(m=>m.assetId)))];let cancelled=false;
  void Promise.all(ids.map(id=>api<Asset>('assets.inspect',{id}).then(a=>[id,a] as const).catch(()=>null))).then(rows=>{if(!cancelled)setMedia(Object.fromEntries(rows.filter((a):a is readonly [string,Asset]=>Boolean(a))));});
  return()=>{cancelled=true;};
 },[pack?.sessionId]);
 const invoke=async(fn:()=>Promise<void>)=>{if(locked.current)return;locked.current=true;setBusy(true);try{await fn();}catch(e){setStatus(String(e));message(String(e));}finally{locked.current=false;setBusy(false);}};
 const importPack=()=>void invoke(async()=>{const row=await api<Pack|null>('packages.import');if(row){setPack(row);setActiveId(row.segments[0]?.id??'');setStatus(row.renewedTaskId?`检测到旧轮次已提交，已自动生成新 task_id：${row.taskId}。请检查后提交新一轮。`:'ZIP 已导入草稿。请检查每段的素材、Prompt 与参数，重新预检并确认。');}else setStatus('已取消导入');});
 const clearPack=()=>void invoke(async()=>{if(!pack)return;const result=await api<{removed:boolean}|null>('packages.discard',{sessionId:pack.sessionId});if(!result){setStatus('已取消清空');return;}setPack(null);setActiveId('');setParams({});setMedia({});setStatus('当前导入的任务包草稿已清空。');});
 const persistChanges=async()=>{if(!pack||!active)return;
  const editableParams=Object.fromEntries(['duration','audio','ratio','resolution','seed','watermark','prompt_extend']
   .filter(key=>params[key]!==undefined&&params[key]!==active.params[key]).map(key=>[key,params[key]]));
  const row=await api<Pack>('packages.update',{sessionId:pack.sessionId,segmentId:active.id,patch:{params:editableParams}});setPack(row);setStatus('输出配置已保存；此前预检和费用估算已失效。');};
 const preflight=()=>void invoke(async()=>{if(!pack)return;
  // Output controls live in the right sidebar while the explicit save button is
  // below the prompt editor.  Persist dirty controls here so changing resolution,
  // ratio, duration or seed never leaves the user with every workflow button disabled.
  if(hasChanges)await persistChanges();
  const row=await api<Pack>('packages.preflight',{sessionId:pack.sessionId});setPack(row);setStatus(row.segments.some(s=>s.issue)?'部分片段未通过，请按错误信息修复后重新预检。':'已保存当前修改，并完成当前修订号的预检与估价。请明确确认。');});
 const confirm=()=>void invoke(async()=>{if(!pack)return;const row=await api<Pack>('packages.confirm',{sessionId:pack.sessionId,revision:pack.revision});setPack(row);setStatus('当前修订号已确认；提交前系统仍将再次检查。');});
 const submit=()=>void invoke(async()=>{if(!pack)return;const results=await api<Array<{segmentId:string;taskId:string}>>('packages.submit',{sessionId:pack.sessionId});
  setStatus(`已安全受理 ${results.length} 段；工作区已初始化，任务仍保留在左侧。`);setPack(null);setActiveId('');setParams({});setMedia({});await refresh();});
 const hasChanges=Boolean(active&&Object.keys(params).some(k=>params[k]!==active.params[k]));
 const allValid=Boolean(pack&&pack.segments.every(s=>s.checked&&!s.issue));
 const costs=pack?.segments.map(s=>s.cost.cost)??[];const total=costs.every(c=>typeof c.amount==='number')?costs.reduce((v,c)=>v+(c.amount??0),0):null;
 const focusIds=pack?.results.map(r=>r.taskId)??[];
 const confirmed=Boolean(pack?.confirmed);
 return <div className="oneclick-workbench">
  <WorkbenchTaskSidebar tasks={tasks} focusIds={focusIds}/>
  <main className="oneclick-main">
   <div className="page-title"><div><h1 className="oneclick-title">一键生成<button type="button" className="icon-button" aria-label="打开生成视频保存目录" title="打开当前生成视频保存目录" onClick={()=>void api('open',{kind:'output'}).catch(e=>message(`打开保存目录失败：${String(e)}`))}><FolderOpen size={23}/></button></h1><p>①导入 → ②素材检查 → ③预检费用 → ④确认提交</p></div></div>
   <section className="oneclick-import-bar"><button className="primary" disabled={busy} onClick={importPack}>{busy?'处理中…':'导入 ZIP'}</button>{pack&&<button className="danger" disabled={busy||pack.state!=='ready'} onClick={clearPack}><Trash2 size={15}/> 清空任务</button>}</section>
   {pack&&<p className="oneclick-pack-summary">已导入：{pack.name} · {pack.segments.length} 段 · 修订号 {pack.revision} · {pack.state}{pack.renewedTaskId?' · 已开启新轮次':''}</p>}
   {pack&&<><section className="batch-card"><header><strong>片段与真实素材</strong><button onClick={()=>void api('packages.openFolder',{sessionId:pack.sessionId}).catch(e=>message(String(e)))}>打开素材目录</button></header>
    <div className="oneclick-segment-tabs">{pack.segments.map((s,i)=><button className={active?.id===s.id?'active':''} key={s.id} disabled={hasChanges} onClick={()=>setActiveId(s.id)}>{i+1}. {s.id}{s.issue?' ⚠':''}</button>)}</div>
    {active&&<><p className="muted">本段原片来源区间：{active.sourceRangeMs?`${(active.sourceRangeMs[0]/1000).toFixed(3)}–${(active.sourceRangeMs[1]/1000).toFixed(3)} 秒`:'未提供'}</p><div className="oneclick-materials">{active.mapping.map(m=>{const asset=media[m.assetId];return <div className="oneclick-material" key={m.alias}><strong>{m.alias}</strong>
     {!asset?<p className="notice warning">素材失效或加载失败</p>:asset.kind==='audio'?<CompactAudio asset={asset}/>:<><div className="oneclick-preview"><AssetPreview asset={asset} controls={asset.kind==='video'}/></div><small>{asset.kind==='image'?asset.name:asset.duration!==undefined?`${asset.duration}秒`:'时长未知'}</small></>}</div>;})}</div></>}
   </section>
   {active&&<section className="batch-card"><header><strong>当前片段 Prompt · {active.id}</strong></header><pre className="oneclick-prompt-snapshot">{active.prompt}</pre></section>}</>}
  </main>
  <aside className="oneclick-options"><h3>输出配置与安全提交</h3>
   {active?<><label>生成时长（秒）<input type="number" min={2} max={30} value={String(params.duration??active.duration)} onChange={e=>setParams(v=>({...v,duration:Number(e.target.value)}))}/></label>
    <label>画幅<select value={String(params.ratio??'9:16')} onChange={e=>setParams(v=>({...v,ratio:e.target.value}))}>{['adaptive','9:16','16:9','1:1','3:4','4:3'].map(x=><option key={x}>{x}</option>)}</select></label>
    <label>分辨率<select value={String(params.resolution??'1080P')} onChange={e=>setParams(v=>({...v,resolution:e.target.value}))}>{['480P','720P','1080P'].map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Seed<input type="number" min={-1} max={2147483647} value={String(params.seed??-1)} onChange={e=>setParams(v=>({...v,seed:Number(e.target.value)}))}/></label>
    <label className="oneclick-sound-toggle"><input type="checkbox" checked={Boolean(params.audio)} onChange={e=>setParams(v=>({...v,audio:e.target.checked}))}/> 生成声音</label>
    <p>原确认时长：{active.originalDuration} 秒 · 当前：{active.duration} 秒</p>
    {pack?.requiresReconfirmation&&<p className="notice warning">当前时长与原冻结方案不同，必须重新确认。</p>}
    {active.issue&&<p className="notice warning">{active.issue}</p>}
    <p>预计总费用：{!allValid?'当前修订号尚未完成预检':total===null?'未知':`${costs[0]?.currency==='CNY'?'¥':costs[0]?.currency??''}${total.toFixed(2)}`}</p>
    <button disabled={busy||pack?.state!=='ready'} onClick={preflight}><RefreshCw size={15}/> {hasChanges?'保存修改并重新预检':'重新预检与估价'}</button>
    <button disabled={busy||hasChanges||!allValid||pack?.state!=='ready'} onClick={confirm}>确认当前修订号 {pack?.revision}</button>
    <button className="primary" disabled={busy||hasChanges||!allValid||!confirmed||pack?.state!=='ready'} onClick={submit}><Play size={15}/> 安全提交全部片段</button>
    {pack?.state==='blocked'&&<p className="notice warning">部分受理/未知：会话已锁定，禁止自动重发。请核查任务记录。</p>}
    {pack?.results.map(r=><button key={r.taskId} onClick={()=>setTask(r.taskId)}>{r.segmentId} → 查看任务</button>)}
   </>:<p className="muted">请先导入标准 ZIP；模型与账户使用设置页中已配置的唯一默认账户。</p>}
   {status&&<p className="notice oneclick-status" role="status">{status}</p>}
  </aside>
 </div>;
}
