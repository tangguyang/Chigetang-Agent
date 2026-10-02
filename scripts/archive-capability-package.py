import json, hashlib, tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

base = Path.cwd()
runtime = Path(json.loads((base / 'tmp/agent-control-package.json').read_text(encoding='utf-8'))['directory'])
delivery = base / 'release/deliverables/吃个糖Agent-v1.4.0-本地AI执行平台-Windows-x64-绿色版.zip'
delivery.parent.mkdir(parents=True, exist_ok=True)
if delivery.exists():
    raise RuntimeError('Existing delivery must be preserved')
def digest_file(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()
files = sorted(p for p in runtime.rglob('*') if p.is_file())
forbidden = {'node_modules', 'UserData', '.git', 'database', 'credentials.json', 'secrets.json', '.env'}
for path in files:
    if forbidden.intersection(path.relative_to(runtime).parts):
        raise RuntimeError('Forbidden runtime entry: ' + str(path))
manifest = {str(Path(runtime.name) / p.relative_to(runtime)).replace('\\', '/'): digest_file(p) for p in files}
with ZipFile(delivery, 'x', ZIP_DEFLATED, compresslevel=6) as archive:
    for p in files:
        archive.write(p, str(Path(runtime.name) / p.relative_to(runtime)))
extract_base = base / 'release/portable-acceptance'
extract_base.mkdir(parents=True, exist_ok=True)
extracted = Path(tempfile.mkdtemp(prefix='v140-', dir=extract_base))
with ZipFile(delivery) as archive:
    if set(archive.namelist()) != set(manifest):
        raise RuntimeError('Archive manifest mismatch')
    for entry in archive.infolist():
        h = hashlib.sha256()
        with archive.open(entry) as stream:
            for chunk in iter(lambda: stream.read(1048576), b''):
                h.update(chunk)
        if h.hexdigest() != manifest[entry.filename]:
            raise RuntimeError('Archive hash mismatch: ' + entry.filename)
    archive.extractall(extracted)
sha = digest_file(delivery)
delivery.with_suffix('.zip.sha256.txt').write_text(sha + '  ' + delivery.name + '\n', encoding='utf-8')
report = {'archive': str(delivery), 'sha256': sha, 'bytes': delivery.stat().st_size, 'files': len(files), 'crcAndHashes': 'PASS', 'extracted': str(extracted/runtime.name)}
(base/'tmp/v140-archive-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
