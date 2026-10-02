from pathlib import Path
import shutil,json
source=Path('acceptance/v1.4.1-video-2026-10-02');target=Path('acceptance/v1.4.2-video-2026-10-02')
target.mkdir(parents=True,exist_ok=True);(target/'logs').mkdir(exist_ok=True);(target/'inputs').mkdir(exist_ok=True)
for name in ['seed.ts','payload.ts']:shutil.copyfile(source/name,target/name)
for p in (source/'inputs').iterdir():
 if p.is_file() and p.name!='compiled-final.zip':shutil.copyfile(p,target/'inputs'/p.name)
pack=json.loads(Path('tmp/agent-control-package.json').read_text(encoding='utf-8'))['directory']
code=(source/'run.cjs').read_text(encoding='utf-8').replace("JSON.parse(fs.readFileSync('tmp/v141-archive-report.json')).extracted",json.dumps(pack,ensure_ascii=False)).replace('v141','v142').replace("'1.4.1'","'1.4.2'").replace('JSON.stringify({capability,params,confirm})','JSON.stringify({capability,params,confirm,responseMode:"debug"})')
(target/'run.cjs').write_text(code,encoding='utf-8')
print(target)
