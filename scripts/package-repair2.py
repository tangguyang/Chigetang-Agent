"""Package verified repair2 source and Windows test build without user data."""
from pathlib import Path
import hashlib, json, subprocess, zipfile

root = Path(__file__).resolve().parent.parent
out = root / "release/deliverables"
out.mkdir(parents=True, exist_ok=True)
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root).decode().strip()
files = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode("utf-8").split("\0")
files = [name for name in files if name and not name.startswith(("node_modules/", "dist/", "release/", "data/", "logs/", "outputs/"))]
metadata = {"version": "v1.2.9 修复版2", "commit": commit, "files": [{"file": name, "sha256": hashlib.sha256((root/name).read_bytes()).hexdigest()} for name in files]}

def archive(path, entries, extra=None):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for file, name in entries:
            z.write(file, name)
        if extra:
            z.writestr("REPAIR2-SOURCE-SHA256.json", json.dumps(extra, ensure_ascii=False, indent=2))
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad: raise RuntimeError("ZIP CRC failure: " + bad)

source = out / "吃个糖-Agent-v1.2.9-修复版2-源码包-2026-10-01.zip"
archive(source, [(root/name, name) for name in files], metadata)
app = root / "release/吃个糖Agent-win32-x64"
runtime = out / "吃个糖-Agent-v1.2.9-修复版2-Windows-x64-测试包-2026-10-01.zip"
archive(runtime, [(file, "吃个糖-Agent-v1.2.9-修复版2/"+file.relative_to(app).as_posix()) for file in sorted(app.rglob("*")) if file.is_file()])
manifest = [{"file": file.name, "bytes": file.stat().st_size, "sha256": hashlib.sha256(file.read_bytes()).hexdigest(), "commit": commit} for file in (source, runtime)]
(out/"SHA256SUMS.txt").write_text("".join(f"{item['sha256']}  {item['file']}\n" for item in manifest), encoding="utf-8")
(out/"DELIVERY-MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(manifest, ensure_ascii=False, indent=2))
