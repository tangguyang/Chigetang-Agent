from pathlib import Path
p=Path('src/renderer/pages/Library.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('origin:"upload"})','origin:e.target.value?"upload":""})').replace('搜索名称、任务ID、Prompt／口播文本','搜索名称、任务ID或原始文本')
block='''        <div className="filters">
          <select aria-label="所属项目" value={q.project||""} onChange={e=>patch({project:e.target.value,origin:e.target.value?"upload":""})}><option value="">全部项目</option>{state.boot?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
          {q.project&&[ ["upload","上传"],["generated","生成"] ].map(([origin,label])=><button key={origin} className={q.origin===origin?'selected':''} onClick={()=>patch({origin})}>{label}</button>)}
        </div>
'''
assert s.count(block)==2
start=s.index(block,s.index(block)+len(block));s=s[:start]+s[start:].replace(block,'',1)
p.write_text(s,encoding='utf-8')
