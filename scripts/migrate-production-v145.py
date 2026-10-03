"""Offline, backup-first v1.4.5 reconciliation. Originals are never opened writable.
Run with --apply only after inspecting the JSON plan. No credentials are decoded.
"""
import argparse, datetime, hashlib, json, os, re, shutil, sqlite3
from pathlib import Path

OLD=Path(r'D:\吃个糖Agent数据库')
PRIMARY=Path(r'D:\吃个糖Agent数据库-v1.3.0')
TARGET=Path(r'D:\吃个糖Agent软件数据库')
ACTIVE=['database/ai-video.sqlite','real-speech/real_speech.db','real-speech-v2/real_speech_v2.db']
report={'tables':{},'conflicts':[],'fileConflicts':[],'pathReplacements':0,'oldOnlyFiles':[],'missingReferences':[]}
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()
def rewrite(v):
    if isinstance(v,str):
        try:
            j=json.loads(v)
            if isinstance(j,(dict,list,str)):return json.dumps(rewrite(j),ensure_ascii=False,separators=(',',':'))
        except (ValueError,TypeError):pass
        for r in [PRIMARY,OLD]:
            # Longest prefix first; only actual root boundaries, including JSON paths.
            pat=re.compile(re.escape(str(r))+r'(?=[\\/]|$)',re.I)
            v,n=pat.subn(lambda _:str(TARGET),v);report['pathReplacements']+=n
        return v
    if isinstance(v,list):return [rewrite(x) for x in v]
    if isinstance(v,dict):return {k:rewrite(x) for k,x in v.items()}
    return v
def decoded(row):
    out={}
    for k,v in row.items():
        if isinstance(v,str):
            try:v=json.loads(v)
            except ValueError:pass
        out[k]=v
    return rewrite(out)
def changed(a,b,p=''):
    if isinstance(a,dict) and isinstance(b,dict):
        return sum([changed(a.get(k),b.get(k),p+'.'+k) for k in set(a)|set(b)],[])
    return [] if a==b else [p]
def latest(row):
    d=row.get('data',{});d=d if isinstance(d,dict) else {}
    return max([str(row.get('updated_at') or ''),str(d.get('updatedAt') or ''),str(d.get('deletedAt') or '')])
def ro(p):
    # Read the logical database, including committed WAL pages. Sources are verified backups.
    c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;return c
args=argparse.ArgumentParser();args.add_argument('--apply',action='store_true');opts=args.parse_args()
backup=json.loads(Path('tmp/v145-unification/backup-result.json').read_text(encoding='utf-8'))
sources={x['source']:Path(x['backup']) for x in backup['roots']}
if TARGET.exists():raise RuntimeError('Target already exists; never overwrite')
plans=[]
for rel in ACTIVE:
    p=sources[str(PRIMARY)]/rel;o=sources[str(OLD)]/rel
    if not p.exists():raise RuntimeError('Missing primary DB '+rel)
    pc=ro(p);oc=ro(o) if o.exists() else None
    schema=pc.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='table' DESC").fetchall()
    selected={}
    for obj in schema:
        if obj['type']!='table':continue
        t=obj['name'];cols=pc.execute('PRAGMA table_info("'+t+'")').fetchall();pk=[x['name'] for x in sorted(cols,key=lambda x:x['pk']) if x['pk']]
        pm={tuple(r[k] for k in pk):dict(r) for r in pc.execute('SELECT * FROM "'+t+'"')}
        om={tuple(r[k] for k in pk):dict(r) for r in oc.execute('SELECT * FROM "'+t+'"')} if oc else {}
        stats={'primary':len(pm),'old':len(om),'identical':0,'primaryNewer':0,'oldNewer':0,'oldOnly':0}
        for key,a in om.items():
            if key not in pm:pm[key]=a;stats['oldOnly']+=1;continue
            b=pm[key];na=decoded(a);nb=decoded(b);paths=changed(na,nb)
            if not paths:stats['identical']+=1;continue
            safe=(t=='models' and all(x=='.data.adapterVersion' for x in paths)) or (t=='assets' and all(x=='.data.thumbnailPath' for x in paths) and not na['data'].get('thumbnailPath')) or (t=='settings' and key[0] in ['settings','rootOrigins']) or (t=='billing_records' and paths==['.data.deletedAt'] and nb['data'].get('deletedAt'))
            if safe or latest(nb)>latest(na):stats['primaryNewer']+=1
            elif latest(na)>latest(nb):pm[key]=a;stats['oldNewer']+=1
            elif all(x=='.updated_at' for x in paths):stats['identical']+=1
            else:report['conflicts'].append({'database':rel,'table':t,'id':list(key),'fields':paths,'reason':'No reliable revision order'})
        if t=='settings':
            pm[('rootPath',)]={'key':'rootPath','data':json.dumps(str(TARGET),ensure_ascii=False)}
            pm[('rootOrigins',)]={'key':'rootOrigins','data':'[]'}
        selected[t]=list(pm.values());stats['merged']=len(pm);report['tables'][rel+':'+t]=stats
    user_version=pc.execute('PRAGMA user_version').fetchone()[0]
    report.setdefault('schemaVersions',{})[rel]=user_version
    plans.append((rel,schema,selected,user_version));pc.close()
    if oc:oc.close()
files={}; hashes={}
for root in [PRIMARY,OLD]:
    src=sources[str(root)]
    for x in next(x for x in backup['roots'] if x['source']==str(root))['files']:
        rel=x['path'];r=rel.replace('\\','/')
        if any(r==a or r.startswith(a+'-') for a in ACTIVE):continue
        if r in ['config/agent-control-runtime.json','config/real-speech-v2-writer.lock']:continue
        if root==OLD and (r.startswith('config/chromium/') or r.startswith('logs/')):continue
        if rel in files:
            previous=files[rel]
            if previous[2]==x['sha256']:continue
            if r.startswith(('outputs/','voices/','models/','projects/','task-packages/','real-speech/','real-speech-v2/')) and not r.endswith(('.db','.db-wal','.db-shm','.json')):
                report['fileConflicts'].append({'path':rel,'reason':'Same relative business path, different SHA256'})
            # Preserve both differing files. Old originals remain in verified backup too.
            rel=str(Path('backups/legacy-file-variants')/rel)
        elif root==OLD:report['oldOnlyFiles'].append(rel)
        files[rel]=(src/x['path'],x['bytes'],x['sha256']);hashes.setdefault(x['sha256'],rel)
report['fileCount']=len(files);report['bytes']=sum(x[1] for x in files.values())
report['backupRoot']=backup['backupRoot'];report['target']=str(TARGET)
Path('tmp/v145-unification/merge-plan.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ['tables','oldOnlyFiles']},ensure_ascii=False),flush=True)
if report['conflicts'] or report['fileConflicts']:raise RuntimeError('UNRESOLVED CONFLICTS: target untouched')
if not opts.apply:raise SystemExit(0)
report['normalizationReferences']=report['pathReplacements'];report['pathReplacements']=0
TARGET.mkdir()
for rel,(s,size,h) in files.items():
    d=TARGET/rel;d.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(s,d)
    if digest(d)!=h:raise RuntimeError('Destination mismatch '+rel)
for rel,schema,selected,user_version in plans:
    p=TARGET/rel;p.parent.mkdir(parents=True,exist_ok=True);c=sqlite3.connect(p)
    try:
        c.execute('BEGIN')
        for obj in schema:
            if obj['type']=='table':c.execute(obj['sql'])
        for t,rows in selected.items():
            for row in rows:
                row={k:rewrite(v) for k,v in row.items()}
                if t=='assets':
                    d=json.loads(row['data']);path=d.get('originalPath')
                    if path and path.startswith(str(TARGET)) and not Path(path).exists() and row.get('hash') in hashes:
                        d['originalPath']=str(TARGET/hashes[row['hash']]);row['data']=json.dumps(d,ensure_ascii=False);report.setdefault('hashRecoveredAssets',[]).append(row['id'])
                names=list(row);q='INSERT INTO "'+t+'" ('+','.join('"'+k+'"' for k in names)+') VALUES ('+','.join('?' for k in names)+')'
                c.execute(q,[row[k] for k in names])
        for obj in schema:
            if obj['type']!='table':c.execute(obj['sql'])
        c.execute('PRAGMA user_version='+str(user_version))
        c.commit()
        if c.execute('PRAGMA integrity_check').fetchall()!=[('ok',)]:raise RuntimeError('Integrity check failed')
        fk=c.execute('PRAGMA foreign_key_check').fetchall()
        if fk:raise RuntimeError('Foreign key violations '+str(fk))
    finally:c.close()
report['status']='MIGRATED_AND_VERIFIED'
Path('tmp/v145-unification/merge-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('MIGRATED_AND_VERIFIED',flush=True)
