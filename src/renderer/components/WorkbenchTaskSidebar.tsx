import { useEffect, useRef, useState } from 'react';
import type { Page, Task } from '../../shared/types.ts';
import { api, labels, time, useApp } from '../store.ts';
import { OutputVideoDuration } from './OutputVideoDuration.tsx';
/** Read-only local task list. Never invokes tasks.refreshAll or a cloud API. */
export function useWorkbenchTasks(pageSize = 30) {
 const [tasks,setTasks]=useState<Task[]>([]);
 const inFlight=useRef(false);
 const load=async()=>{
  if(inFlight.current)return;
  inFlight.current=true;
  try{setTasks((await api<Page<Task>>('tasks.list',{pageSize})).items);}
  catch{/* existing result stays visible; next event/tick retries */}
  finally{inFlight.current=false;}
 };
 useEffect(()=>{
  let closed=false;let timer:ReturnType<typeof setTimeout>;
  const refresh=async()=>{if(!closed&&document.visibilityState==='visible')await load();};
  const tick=()=>{if(closed)return;void refresh().finally(()=>{if(!closed)timer=setTimeout(tick,5000);});};
  void refresh();timer=setTimeout(tick,5000);
  const off=window.aiVideo.onChange(()=>{void refresh();});
  return ()=>{closed=true;clearTimeout(timer);off();};
 },[pageSize]);
 return {tasks,refresh:load};
}
const WIDTH_KEY = 'chigetang-oneclick-task-width';
export function WorkbenchTaskSidebar({tasks,focusIds=[]}:{tasks:Task[];focusIds?:string[]}) {
 const {setTask}=useApp();const [collapsed,setCollapsed]=useState(false);
 const pane=useRef<HTMLElement>(null);
 const drag=useRef<{pointerId:number;x:number;width:number}|null>(null);
 const [width,setWidth]=useState(()=>{
  try { const saved=Number(localStorage.getItem(WIDTH_KEY));return saved>0&&Number.isFinite(saved)?Math.min(420,Math.max(180,saved)):245; }
  catch { return 245; }
 });
 const [maxWidth,setMaxWidth]=useState(420);
 useEffect(()=>{
  const parent=pane.current?.parentElement;
  if(!parent)return;
  const measure=()=>{
   // Reserve the editor and output controls; shrinking the window clamps only presentation.
   const reserved=window.innerWidth<=1140?342:616;
   setMaxWidth(Math.max(180,Math.min(420,parent.clientWidth-reserved)));
  };
  measure();
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
  observer?.observe(parent);window.addEventListener('resize',measure);
  return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
 },[]);
 const actualWidth=Math.min(width,maxWidth);
 const resize=(next:number)=>{
  const value=Math.round(Math.min(maxWidth,Math.max(180,next)));setWidth(value);
  try{localStorage.setItem(WIDTH_KEY,String(value));}catch{/* layout still works when storage is unavailable */}
 };
 const ordered=[...tasks].sort((a,b)=>Number(focusIds.includes(b.id))-Number(focusIds.includes(a.id)));
 return <aside ref={pane} style={{width:actualWidth}} className={'workbench-task-sidebar '+(collapsed?'collapsed':'')}>
  <header><strong>任务列表 · {tasks.length}</strong><button onClick={()=>setCollapsed(v=>!v)}>{collapsed?'展开':'收起'}</button></header>
  {!collapsed&&<div className="workbench-task-list">{ordered.length===0?<p className="muted">暂无任务。提交后可在这里跟踪进度。</p>:ordered.map(task=><button key={task.id} onClick={()=>setTask(task.id)} className="workbench-task-row"><strong>{task.name}</strong><span>{task.downloadStatus==='failed'?'生成成功 · 下载失败':labels[task.status]??task.status}</span><OutputVideoDuration key={`${task.id}:${task.outputPath}:${task.downloadStatus}:${task.completedAt}`} task={task}/><small>创建时间：{time(task.createdAt)}</small></button>)}</div>}
  <div className="task-list-resizer" role="separator" tabIndex={0} aria-label="调整任务列表宽度" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={maxWidth} aria-valuenow={actualWidth}
   onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();drag.current={pointerId:event.pointerId,x:event.clientX,width:actualWidth};event.currentTarget.setPointerCapture(event.pointerId);}}
   onPointerMove={event=>{const start=drag.current;if(start?.pointerId===event.pointerId)resize(start.width+event.clientX-start.x);}}
   onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
   onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
   onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();resize(event.key==='Home'?180:event.key==='End'?maxWidth:actualWidth+(event.key==='ArrowLeft'?-10:10));}}}/>
 </aside>;
}
