"""Build NSIS installer from the exact packaged tree. Usage: python scripts/build-installer.py /path/to/makensis"""
from pathlib import Path
import os,subprocess,sys
root=Path(__file__).resolve().parent.parent
app=root/'release/吃个糖Agent-win32-x64'
files=sorted(p for p in app.rglob('*') if p.is_file())
if not files:raise RuntimeError('Package Windows first')
lines=[]
for p in files:
 rel=str(p.relative_to(app)).replace('/','\\').replace('$','$$').replace('"','$\\"')
 lines.append(f'  Delete "$INSTDIR\\{rel}"')
for p in sorted((p for p in app.rglob('*') if p.is_dir()),key=lambda p:len(p.parts),reverse=True):
 rel=str(p.relative_to(app)).replace('/','\\').replace('$','$$')
 lines.append(f'  RMDir "$INSTDIR\\{rel}"')
(root/'scripts/installer-delete-files.nsh').write_text('\n'.join(lines)+'\n',encoding='utf-8')
out=root/'release/吃个糖Agent-v1.2.9-Setup.exe'
# compile to a unique temporary output, publish only after successful compilation
import uuid
built=out.with_name('setup-'+uuid.uuid4().hex+'.tmp.exe')
subprocess.run([sys.argv[1] if len(sys.argv)>1 else 'makensis','-V2',f'-DAPPDIR={app}',f'-DOUTPUT={built}',str(root/'scripts/installer.nsi')],check=True,cwd=root)
assert built.read_bytes()[:2]==b'MZ'
built.replace(out)
print('NSIS installer built:',out,out.stat().st_size)
