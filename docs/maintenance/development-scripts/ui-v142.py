from pathlib import Path
def edit(path,old,new):
 p=Path(path);s=p.read_text(encoding='utf-8');assert old in s,(path,old[:70]);p.write_text(s.replace(old,new),encoding='utf-8')
Path('src/renderer/components/VideoThumbnail.tsx').write_text('''import {Film} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {Asset} from '../../shared/types.ts';
import {api,media} from '../store.ts';
export function VideoThumbnail({asset}:{asset:Asset}){
 const [ready,setReady]=useState(Boolean(asset.thumbnailPath)),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true;if(!ready)void api<Asset>('assets.thumbnail.ensure',{id:asset.id}).then(a=>{if(live)setReady(Boolean(a.thumbnailPath));}).catch(()=>{});return()=>{live=false;};},[asset.id,ready,retry]);
 return ready?<img src={media('thumb',asset.id)+'?revision='+retry} alt={asset.name} loading="lazy" onError={()=>{if(retry<2){setReady(false);setRetry(x=>x+1);}}}/>:<span className="video-placeholder"><Film size={28}/><button onClick={()=>setRetry(x=>x+1)}>重试缩略图</button></span>;
}
''',encoding='utf-8')
edit('src/renderer/pages/Library.tsx','import { FileText, FolderOpen }','import { FileText, FolderOpen }')
edit('src/renderer/pages/Library.tsx','kind: state.assetKind === "hidden" ? "" : state.assetKind,\n        page: 1,','kind: state.assetKind === "hidden" ? "" : state.assetKind,\n        source: "all", module: "", hidden: state.assetKind === "hidden", showHidden: false,\n        page: 1,')
edit('src/renderer/pages/Library.tsx','source: "tasks"','source: "all"')
edit('src/renderer/pages/Library.tsx','    localStorage.setItem("library-hidden", JSON.stringify(next));','    localStorage.setItem("library-hidden", JSON.stringify(next));\n    void run(()=>api("library.hide",{id,hidden:!(q.hidden||hidden.includes(id))})).then(()=>void load());')
edit('src/renderer/pages/Library.tsx','["", "全部"],\n','')
edit('src/renderer/pages/Library.tsx','["prompt", "脚本／Prompt"],','["hidden", "隐藏"],')
edit('src/renderer/pages/Library.tsx','aria-selected={q.kind === k}','aria-selected={state.assetKind === k}')
edit('src/renderer/pages/Library.tsx','className={q.kind === k ? "selected" : ""}','className={state.assetKind === k ? "selected" : ""}')
edit('src/renderer/pages/Library.tsx','            <option value="all">全部</option>\n            <option value="tasks">生成任务</option>\n            <option value="assets">结果资产／本地素材</option>','            <option value="all">所有媒体</option>\n            <option value="assets">本地媒体文件</option>')
edit('src/renderer/pages/Library.tsx','        <details>','''        <div className="filters">
          <select aria-label="所属项目" value={q.project||""} onChange={e=>patch({project:e.target.value,origin:"upload"})}><option value="">全部项目</option>{state.boot?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
          {q.project&&[ ["upload","上传"],["generated","生成"] ].map(([origin,label])=><button key={origin} className={q.origin===origin?'selected':''} onClick={()=>patch({origin})}>{label}</button>)}
        </div>
        <details>''')
start='''              <button className="asset-visual" onClick={() => showDetail(row)}>'''
end='''              </button>
              <div className="asset-info">'''
p=Path('src/renderer/pages/Library.tsx');s=p.read_text(encoding='utf-8');a=s.index(start);b=s.index(end,a)+len('              </button>');s=s[:a]+'''              {row.kind==='audio'?<audio controls preload="none" aria-label={row.name} src={row.mediaAsset?media('asset',row.mediaAsset.id):row.children?.find(t=>t.outputPath)?media('output',row.children.find(t=>t.outputPath)!.id):undefined} onPlay={e=>document.querySelectorAll('audio').forEach(a=>{if(a!==e.currentTarget)a.pause();})}/>:<button className="asset-visual" onClick={()=>showDetail(row)}>{row.mediaAsset?<AssetPreview asset={row.mediaAsset as Asset}/>:<span>尚无本地媒体</span>}</button>}
''' + s[b:];p.write_text(s,encoding='utf-8')
edit('src/renderer/pages/Library.tsx','api("open", { assetId: row.id })','api("open", { assetId: row.id, folder: true })')
edit('src/renderer/pages/Library.tsx','api("open", { taskId: files[0].id })','api("open", { taskId: files[0].id, folder: true })')
edit('src/renderer/pages/Library.tsx','<FileText size={18} />','<FolderOpen size={18} />')
edit('src/renderer/pages/Library.tsx','aria-label="打开原文件"','aria-label="打开保存位置"')
edit('src/renderer/pages/Library.tsx','aria-label="打开生成结果"','aria-label="打开保存位置"')
edit('src/renderer/pages/Library.tsx','{hidden.includes(row.id) ? "恢复显示" : "隐藏记录"}','{q.hidden||hidden.includes(row.id) ? "恢复" : "隐藏"}')
edit('src/renderer/pages/Library.tsx','· {row.module}','· {row.origin === "upload" ? "上传" : "生成"}')
edit('src/renderer/pages/Library.tsx','{row.createdAt ? time(row.createdAt) : "历史记录"}','{row.createdAt ? time(row.createdAt) : "历史记录"} {row.mediaAsset?.duration ? ` · ${Number(row.mediaAsset.duration).toFixed(1)}秒` : ""}')
