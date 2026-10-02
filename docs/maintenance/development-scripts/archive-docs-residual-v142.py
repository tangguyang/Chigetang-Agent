from pathlib import Path
import subprocess,json
mapping=json.loads(Path('docs/maintenance/document-archive-map.json').read_text(encoding='utf-8'))
dirs={a.split('/')[1]:'/'.join(b.split('/')[:4]) for a,b in mapping.items() if a.startswith('docs/') and len(a.split('/'))>2}
tracked=[p.decode('utf-8') for p in subprocess.check_output(['git','ls-files','-z']).split(b'\0') if p]
for f in tracked:
 p=Path(f)
 if len(p.parts)>2 and p.parts[0]=='docs' and p.parts[1] in dirs:
  target=Path(dirs[p.parts[1]]).joinpath(*p.parts[2:]);target.parent.mkdir(parents=True,exist_ok=True);subprocess.run(['git','mv',str(p),str(target)],check=True);mapping[f]=target.as_posix()
for folder in ['src','scripts','tests','docs/current']:
 for p in Path(folder).rglob('*'):
  if not p.is_file() or p.suffix not in ['.ts','.tsx','.mjs','.md','.json']:continue
  s=p.read_text(encoding='utf-8');new=s
  for old,target in dirs.items():new=new.replace('docs/'+old+'/',target+'/')
  if s!=new:p.write_text(new,encoding='utf-8')
Path('docs/maintenance/document-archive-map.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2),encoding='utf-8')
print('Total archived',len(mapping))
