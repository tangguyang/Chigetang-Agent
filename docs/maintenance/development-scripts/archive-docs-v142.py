from pathlib import Path
import subprocess,json,re,os
root=Path.cwd()
tracked=[Path(p.decode('utf-8')) for p in subprocess.check_output(['git','ls-files','-z']).split(b'\0') if p]
mapping={}
for p in tracked:
 if p.suffix!='.md':continue
 if len(p.parts)==1:
  if 'Release-Notes' in p.name: mapping[p]=Path('docs/archive/releases')/p.name
  elif 'Upgrade-Guide' in p.name:mapping[p]=Path('docs/archive/upgrades')/p.name
  elif p.name in ['README-v1.2.8.md','README-v1.2.9.md','README-REPAIR2.md','DELIVERY.md','GIT-BASELINE.md','HANDOFF.md']:mapping[p]=Path('docs/archive/readmes')/p.name
 elif p.parts[0]=='docs' and not p.parts[1] in ['current','archive','maintenance','acceptance']:
  folder=p.parts[1]
  if folder.startswith('real-speech-v2-design'):mapping[p]=Path('docs/archive/real-speech-design').joinpath(*p.parts[1:])
  elif folder.startswith('v1') or folder in ['real-speech-v2-phase1','real-speech-v2-production-r3','capabilities-v140','capabilities-v141','agent-control-v1']:mapping[p]=Path('docs/archive/acceptance').joinpath(*p.parts[1:])
  elif folder in ['R3-CHECKPOINT.md','R4-TEST-REPORT.md','TEST-RESULTS.md']:mapping[p]=Path('docs/archive/repairs')/p.name
for p,target in mapping.items():
 target.parent.mkdir(parents=True,exist_ok=True)
 subprocess.run(['git','mv',str(p),str(target)],check=True)
# Exact repository paths in code/tests/scripts and markdown; longest first.
for p0 in tracked:
 p=mapping.get(p0,p0)
 if p.suffix not in ['.md','.ts','.tsx','.mjs','.json','.yml','.yaml','.py']:continue
 if not p.exists():continue
 s=p.read_text(encoding='utf-8');new=s
 for old,target in sorted(mapping.items(),key=lambda x:len(str(x[0])),reverse=True):
  if len(old.parts)>1:new=new.replace(old.as_posix(),target.as_posix())
 # Relative Markdown links, including paths in moved docs.
 def link(m):
  raw=m.group(1);part=raw.split('#')[0];fragment=raw[len(part):]
  if not part or ':' in part or part.startswith('/'):return m.group(0)
  resolved=Path(os.path.normpath(str(p0.parent/part)))
  if resolved in mapping:
   dest=mapping[resolved];return ']('+os.path.relpath(dest,p.parent).replace('\\','/')+fragment+')'
  if p0 in mapping and resolved.exists():return ']('+os.path.relpath(resolved,p.parent).replace('\\','/')+fragment+')'
  return m.group(0)
 if p.suffix=='.md':new=re.sub(r'\]\(([^)]+)\)',link,new)
 if new!=s:p.write_text(new,encoding='utf-8')
Path('docs/maintenance/document-archive-map.json').write_text(json.dumps({p.as_posix():q.as_posix() for p,q in mapping.items()},ensure_ascii=False,indent=2),encoding='utf-8')
print('Archived',len(mapping),'tracked documents with git mv')
