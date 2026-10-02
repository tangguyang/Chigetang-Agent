import os,json,subprocess, pathlib,datetime
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'docs/maintenance';out.mkdir(parents=True,exist_ok=True)
sizes={};total=0
for base,dirs,files in os.walk(root):
 size=sum(os.path.getsize(os.path.join(base,f)) for f in files if os.path.isfile(os.path.join(base,f)))
 total+=size
 rel=pathlib.Path(base).relative_to(root)
 for n in range(1,len(rel.parts)+1):
  k='/'.join(rel.parts[:n]);sizes[k]=sizes.get(k,0)+size
phase=os.environ.get('CTG_INVENTORY_PHASE','before')
(out/f'local-space-{phase}.txt').write_text(f'Timestamp: {datetime.datetime.now().isoformat()}\nTotal bytes: {total}\n'+ '\n'.join(f'{v:15d} {k}' for k,v in sorted(sizes.items(),key=lambda x:x[1],reverse=True)[:30]),encoding='utf-8')
if phase=='before':
 for args,name in [(['git','status','--short'],'git-status-before.txt'),(['git','status','--ignored','--short'],'git-status-ignored-before.txt')]:
  (out/name).write_bytes(subprocess.check_output(args,cwd=root))
 (out/'PROTECTED_PATHS.md').write_text('''# 数据保护清单
生产根目录：D:\\吃个糖Agent数据库-v1.3.0（整目录禁止清理）。SQLite、config/凭据/Chromium Local State、assets、outputs、任务历史均受保护。
历史根目录：D:\\吃个糖Agent数据库（保留）。
工程内 acceptance/、口播课程_导出/、一键复刻的导入任务包模板/ 含真实素材或用户文件，整体保留。
resources/、node_modules/ 为运行/开发依赖，保留；release/deliverables 保留历史交付ZIP。
只清理清单明确标记为旧构建 staging、绿色包重复解压副本的 release 子目录；删除前解析绝对路径并排除 SQLite、UserData、账户及生成输出。
''',encoding='utf-8')
