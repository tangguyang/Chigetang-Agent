from pathlib import Path
import json,shutil,os
root=Path.cwd().resolve();release=root/'release';report=root/'docs/maintenance/cleanup-manifest.json'
protected={'UserData','database','credentials.json','secrets.json','agent-control-writer.lock','ai-video.sqlite'}
candidates=list(release.glob('agent-control-ipc-*'))+[p for p in release.glob('capability-platform-*') if p.name!='capability-platform-1790907709485']
candidates += [p for p in (release/'portable-acceptance').glob('*') if p.name!='v141-xotsqlyv']
items=[]
for p in candidates:
 p=p.resolve()
 if not p.is_dir() or release.resolve() not in p.parents:raise RuntimeError('Unsafe cleanup target')
 files=[f for f in p.rglob('*') if f.is_file()]
 unsafe=[str(f) for f in files if protected.intersection(f.relative_to(p).parts) or f.suffix in ['.sqlite','.db']]
 items.append({'path':str(p),'bytes':sum(f.stat().st_size for f in files),'decision':'retain' if unsafe else 'delete-rebuildable','reason':'protected runtime data detected' if unsafe else 'obsolete isolated packaging/staging or duplicate extraction; historical delivered ZIP preserved'})
report.write_text(json.dumps({'dryRun':True,'items':items},ensure_ascii=False,indent=2),encoding='utf-8')
if os.environ.get('CTG_CLEANUP_APPLY')=='yes':
 for item in items:
  if item['decision']=='delete-rebuildable':
   target=Path(item['path']).resolve()
   if release.resolve() not in target.parents:raise RuntimeError('Cleanup containment failed')
   shutil.rmtree(target)
 report.write_text(json.dumps({'dryRun':False,'items':items,'deletedBytes':sum(i['bytes'] for i in items if i['decision']=='delete-rebuildable')},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'eligible':sum(i['decision']=='delete-rebuildable' for i in items),'bytes':sum(i['bytes'] for i in items if i['decision']=='delete-rebuildable'),'apply':os.environ.get('CTG_CLEANUP_APPLY')=='yes'}))
