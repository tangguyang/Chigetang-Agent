from pathlib import Path
import json,subprocess
def edit(path,old,new):
 p=Path(path);s=p.read_text(encoding='utf-8');assert old in s,(path,old[:70]);p.write_text(s.replace(old,new),encoding='utf-8')
edit('tests/v102.test.ts','assert.equal(app.bootstrap().version, "1.4.1");','assert.equal(app.bootstrap().version, brand.version);')
edit('tests/v128.test.ts','/version: "1\\.4\\.1"/','/version: "1\\.4\\.2"/')
edit('tests/v128.test.ts',"replace('version: \"1.4.1\"'","replace('version: \"1.4.2\"'")
edit('tests/v110.test.ts','v110 missing assets hide reversibly without deleting records or IDs','v142 missing status is distinct from explicit reversible hiding')
edit('tests/v110.test.ts','assert.equal((await app.assets.list({ kind: "image" })).total, 0);\n  const hidden = await app.assets.list({ hidden: true });','assert.equal((await app.assets.list({ kind: "image" })).total, 1);\n  assert.equal((await app.assets.list({ hidden: true })).total, 0);\n  app.assets.removeRecords([asset.id]);\n  const hidden = await app.assets.list({ hidden: true });')
edit('tests/v110.test.ts','writeFileSync(path, bytes);\n  await app.assets.refresh();','writeFileSync(path, bytes);\n  app.assets.save({...app.assets.get(asset.id),libraryDeletedAt:null});\n  await app.assets.refresh();')
edit('scripts/test-capability-runtime.mjs','JSON.stringify({ capability, params, confirm })','JSON.stringify({ capability, params, confirm, responseMode: "debug" })')
edit('src/renderer/pages/Assets.tsx','路径恢复或重新定位成功后，素材会自动回到原分类。','隐藏的媒体保留原文件，可随时恢复。')
edit('src/renderer/pages/Assets.tsx','原始文件不可用 · 已自动隐藏 · 可重新定位','原始文件不可用 · 可重新定位')
edit('src/renderer/pages/Assets.tsx','await api("assets.removeMany", { ids: selected });','if(hidden)await Promise.all(selected.map(id=>api("library.hide",{id,hidden:false})));\n                  else await api("assets.removeMany", { ids: selected });')
edit('src/renderer/pages/Assets.tsx','<Trash2 size={16} /> 批量移除记录（{selected.length}）','<Trash2 size={16} /> {hidden?"恢复":"隐藏"}（{selected.length}）')
edit('src/renderer/pages/Assets.tsx','api("open",{assetId:a.id})','api("open",{assetId:a.id,folder:true})')
edit('src/renderer/pages/Assets.tsx','aria-label="打开原文件" disabled={a.missing}','aria-label="打开保存位置" disabled={a.missing}')
edit('src/renderer/pages/Assets.tsx','''                <button
                  className="asset-visual"
                  onClick={() => (picker ? onPick?.(a) : setDetail(a))}
                >
                  <AssetPreview asset={a} />
                </button>''','''                {a.kind==='audio'&&!picker?<audio controls preload="none" src={media('asset',a.id)} onPlay={e=>document.querySelectorAll('audio').forEach(x=>{if(x!==e.currentTarget)x.pause();})}/>:<button className="asset-visual" onClick={()=>picker?onPick?.(a):setDetail(a)}><AssetPreview asset={a}/></button>}''')
edit('src/renderer/pages/Assets.tsx','src={media(asset.thumbnailPath ? "thumb" : "asset", asset.id)} alt={asset.name} loading="lazy"','src={media(asset.thumbnailPath ? "thumb" : "asset", asset.id)} alt={asset.name} loading="lazy" onError={e=>{if(asset.thumbnailPath)e.currentTarget.src=media("asset",asset.id);}}')
mapping=json.loads(Path('docs/maintenance/document-archive-map.json').read_text(encoding='utf-8'))
prefixes={str(Path(a).parent).replace('\\','/')+'/':str(Path(b).parent).replace('\\','/')+'/' for a,b in mapping.items() if len(Path(a).parts)>2}
for p in list(Path('src').rglob('*'))+list(Path('scripts').rglob('*'))+list(Path('tests').rglob('*')):
 if p.suffix not in ['.ts','.tsx','.mjs','.json'] or not p.is_file():continue
 s=p.read_text(encoding='utf-8');new=s
 for a,b in sorted(prefixes.items(),key=lambda x:len(x[0]),reverse=True):
  if not a.startswith('docs/archive/'):new=new.replace('"'+a,'"'+b).replace("'"+a,"'"+b)
 if new!=s:p.write_text(new,encoding='utf-8')
for p in ['scripts/update-v142.py','scripts/ui-v142.py','scripts/finalize-v142-edits.py','scripts/archive-docs-v142.py']:
 # One-time edit scripts are not authoritative entry points; archive as evidence.
 dest=Path('docs/maintenance/development-scripts')/Path(p).name;dest.parent.mkdir(parents=True,exist_ok=True);Path(p).rename(dest)
