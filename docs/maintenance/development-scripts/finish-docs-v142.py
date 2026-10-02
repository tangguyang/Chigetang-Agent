from pathlib import Path
import subprocess,json,re
root=Path.cwd();mapping=json.loads(Path('docs/maintenance/document-archive-map.json').read_text(encoding='utf-8'))
for name in ['吃个糖Agent-v1.0.4-实际测试报告.md','吃个糖Agent-v1.0.4-使用与升级说明.md','README-USER.md']:
 p=Path(name);target=Path('docs/archive/readmes')/name
 if p.exists():target.parent.mkdir(parents=True,exist_ok=True);subprocess.run(['git','mv',str(p),str(target)],check=True);mapping[name]=target.as_posix()
for name in ['ARCHITECTURE.md','DEVELOPMENT.md','ACCEPTANCE.md','KNOWN-ISSUES.md','ADAPTER-GUIDE.md','API-RESEARCH.md']:
 p=Path('docs')/name;target=Path('docs/archive/legacy')/name
 if p.exists():target.parent.mkdir(parents=True,exist_ok=True);subprocess.run(['git','mv',str(p),str(target)],check=True);mapping[p.as_posix()]=target.as_posix()
Path('docs/maintenance/document-archive-map.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2),encoding='utf-8')
p=Path('CHANGELOG.md');old=p.read_text(encoding='utf-8');p.write_text('''# v1.4.2（2026-10-02）

新增控制面 Token Saver：capability.search / describe、jobs.wait、compact 默认结果与本地详细结果文件；MCP 默认仅公开5个发现/调度入口。生成输入、Provider adapter 和任务包业务语义不变。

真人口播新 Plan 输入默认清空，保存后清空预览与确认；历史任务和音频保留。资产库改为视频/图片/音频/隐藏，原生FFmpeg缩略图缓存可重试，音频互斥播放、保存位置快捷按钮、可恢复隐藏、项目上传/生成筛选。

统一 VERSION/package.json/brand/口播/MCP/绿色包版本；归档旧入口与历史设计、更新测试和脚本引用。盘点后清理明确重复构建与解压副本，保护生产库、凭据、素材和历史交付。真实付费验收继续暂停，四项均保持 PARTIAL PASS。

# v1.4.1

单写启动协调、残留writer备份恢复与队列暂停；现有视频生产能力后台预提交验收。源码基线 commit 2b184762814cfb6b464cecebeaa74cec2f96360e。

'''+old,encoding='utf-8')
scripts=[]
pkg=json.loads(Path('package.json').read_text(encoding='utf-8'))
for p in sorted(Path('scripts').iterdir()):
 if not p.is_file() or p.name.startswith('.'):continue
 name=p.name
 category='maintenance' if any(x in name for x in ['maintenance','cleanup','archive','export','restore','finish']) else 'build' if any(x in name for x in ['build','package','delivery','icon','verify-package']) else 'dev' if name=='dev.mjs' else 'test' if any(x in name for x in ['test','run-','prepare-test']) else 'legacy/manual'
 refs=[k for k,v in pkg['scripts'].items() if name in v]
 scripts.append(f'| {name} | {category} | {", ".join(refs) or "间接引用或人工工具，保留"} |')
Path('docs/current/SCRIPT_INDEX.md').write_text('# 脚本索引\n\n脚本保持原路径以避免破坏CI/测试；付费 spike 只能人工批准后执行。\n\n|脚本|类别|npm入口/用途|\n|---|---|---|\n'+'\n'.join(scripts)+'\n',encoding='utf-8')
# Current discovery document is the authority; old documents remain archived evidence.
Path('docs/README_文档版本说明.md').write_text('# 当前文档入口\n\nv1.4.2：以根AGENTS.md及 docs/current 为权威入口；docs/archive 是历史证据，不作为开发目标。运行时 resources/docs 与 resources/real-speech-v2 文档受镜像校验保护。\n',encoding='utf-8')
Path('resources/docs/README_文档版本说明.md').write_text(Path('docs/README_文档版本说明.md').read_text(encoding='utf-8'),encoding='utf-8')
