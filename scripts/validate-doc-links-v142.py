from pathlib import Path
import json,re,os
root=Path.cwd();mapping=json.loads((root/'docs/maintenance/document-archive-map.json').read_text(encoding='utf-8'));reverse={b:a for a,b in mapping.items()}
missing=[];fixed=[]
for p in [root/'README.md',root/'AGENTS.md',root/'CHANGELOG.md']+list((root/'docs').rglob('*.md')):
 s=p.read_text(encoding='utf-8');rel=p.relative_to(root).as_posix();old=Path(reverse.get(rel,rel))
 def link(m):
  raw=m.group(1);part=raw.split('#')[0];fragment=raw[len(part):]
  if not part or ':' in part or part.startswith('/') or ' ' in part:return m.group(0)
  target=(p.parent/part).resolve()
  if target.exists():return m.group(0)
  oldtarget=Path(os.path.normpath(str(old.parent/part))).as_posix();dest=mapping.get(oldtarget,oldtarget)
  if not (root/dest).exists():
   # Links rewritten before residual JSON/schema files were moved still contain
   # their former top-level folder. Resolve that folder through the archive map.
   for oldpath,newpath in mapping.items():
    if len(Path(oldpath).parts)>2 and '/'+Path(oldpath).parts[1]+'/' in '/'+part:
     segment=Path(oldpath).parts[1];suffix=part.split(segment+'/',1)[-1]
     folder='/'.join(Path(newpath).parts[:4]);candidate=folder+'/'+suffix
     if (root/candidate).exists():dest=candidate;break
  if (root/dest).exists():
   fixed.append({'document':rel,'oldLink':raw,'target':dest});return ']('+os.path.relpath(root/dest,p.parent).replace('\\','/')+fragment+')'
  missing.append({'document':rel,'link':raw,'historic':rel.startswith('docs/archive/')});return m.group(0)
 new=re.sub(r'\]\(([^)]+)\)',link,s)
 if new!=s:p.write_text(new,encoding='utf-8')
(root/'docs/maintenance/document-link-check.json').write_text(json.dumps({'fixed':fixed,'unresolved':missing},ensure_ascii=False,indent=2),encoding='utf-8')
print('Fixed',len(fixed),'unresolved',len(missing),'current',sum(not x['historic'] for x in missing))
pkg=json.loads((root/'package.json').read_text(encoding='utf-8'));lines=[]
for p in sorted((root/'scripts').rglob('*')):
 if not p.is_file() or p.name.startswith('.') or 'node_modules' in p.parts:continue
 rel=p.relative_to(root/'scripts').as_posix();category='archive (历史，禁止用于当前交付)' if 'archive/' in rel else 'build' if any(x in rel for x in ['build','package','delivery']) else 'test' if any(x in rel for x in ['test','run-','prepare-test']) else 'dev' if rel=='dev.mjs' else 'maintenance/manual'
 refs=[k for k,v in pkg['scripts'].items() if rel in v]
 lines.append(f'| {rel} | {category} | {", ".join(refs) or "间接引用或人工工具"} |')
(root/'docs/current/SCRIPT_INDEX.md').write_text('# 脚本索引\n\n当前打包统一指向package-agent-control-ipc.mjs。旧源码ZIP/多份交付脚本仅历史归档，禁止执行。\n\n|脚本|类别|入口|\n|---|---|---|\n'+'\n'.join(lines)+'\n',encoding='utf-8')
