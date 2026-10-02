"""Package the built Windows application, source and documentation.

Usage: npm run pack:win && python scripts/make-delivery.py [output-directory]
"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / "release/deliverables"
output.mkdir(parents=True, exist_ok=True)
app = root / "release/吃个糖Agent-win32-x64"
subprocess.run(["node", "scripts/verify-package.mjs"], cwd=root, check=True)
documents = [
    "README.md", "README-USER.md", "HANDOFF.md", "CHANGELOG.md",
    "THIRD-PARTY-NOTICES.md", "DELIVERY.md",
    f"v{version}-Release-Notes.md", f"v{version}-Upgrade-Guide.md",
]
for filename in documents:
    shutil.copy2(root / filename, app / filename)
for folder in ("docs", "licenses"):
    shutil.copytree(root / folder, app / folder, dirs_exist_ok=True)

def archive_tree(path, entries):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for file, name in entries:
            z.write(file, name)
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad:
            raise RuntimeError(f"ZIP CRC failed: {bad}")

runtime_zip = output / f"吃个糖Agent-v{version}-Windows-x64.zip"
archive_tree(runtime_zip, [(p, f"吃个糖Agent-v{version}/{p.relative_to(app).as_posix()}")
                          for p in sorted(app.rglob("*")) if p.is_file()])
doc_entries = [(root / f, f"吃个糖Agent-v{version}-文档/{f}") for f in documents]
for folder in ("docs", "licenses"):
    doc_entries.extend((p, f"吃个糖Agent-v{version}-文档/{p.relative_to(root).as_posix()}")
                       for p in sorted((root / folder).rglob("*")) if p.is_file())
archive_tree(output / f"吃个糖Agent-v{version}-文档.zip", doc_entries)
shutil.copy2(root / "HANDOFF.md", output / "HANDOFF.md")
shutil.copy2(root / "DELIVERY.md", output / "DELIVERY.md")
standalone = [
    (root / "resources/workflow/阶段1_爆款逆向工程_V2.2.md", output / "阶段1_爆款逆向工程_V2.2.md"),
    (root / "resources/workflow/阶段2_Wan任务生产_V2.2.md", output / "阶段2_Wan任务生产_V2.2.md"),
    (root / "resources/workflow/阶段3_任务包转换_V2.2.md", output / "阶段3_任务包转换_V2.2.md"),
    (root / "resources/workflow/单任务测试模板_V2.2.zip", output / "单任务测试模板_V2.2.zip"),
    (root / "resources/workflow/多任务测试模板_V2.2.zip", output / "多任务测试模板_V2.2.zip"),
    (root / "docs/archive/acceptance/v1.2.2/吃个糖Agent_标准ZIP任务包规范_v1.2.2.md", output / "吃个糖Agent_标准ZIP任务包规范_v1.2.2.md"),
    (root / "docs/archive/acceptance/v1.2.2/TEST-REPORT.md", output / "吃个糖Agent-v1.2.2-自动化测试报告.md"),
    (root / "docs/archive/acceptance/v1.2.2/WINDOWS-ACCEPTANCE.md", output / "吃个糖Agent-v1.2.2-Windows验收清单.md"),
    (root / "docs/archive/acceptance/v1.2.2/CHANGED-FILES.md", output / "吃个糖Agent-v1.2.2-变更清单.md"),
]
for source_file, destination in standalone:
    shutil.copy2(source_file, destination)
# Build the source archive last so later large runtime/document archive writes
# cannot leave a partial source artifact if the delivery volume is interrupted.
subprocess.run([sys.executable, str(root / "scripts/package-source.py"), str(output)],
               cwd=root, check=True)
files = [output / f"吃个糖Agent-v{version}-Source.zip", runtime_zip,
         output / f"吃个糖Agent-v{version}-文档.zip", output / "HANDOFF.md", output / "DELIVERY.md",
         *(destination for _, destination in standalone)]
manifest = [{"file": p.name, "bytes": p.stat().st_size,
             "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
(output / "SHA256SUMS.txt").write_text(
    "".join(f"{m['sha256']}  {m['file']}\n" for m in manifest), encoding="utf-8")
print(json.dumps(manifest, ensure_ascii=False, indent=2))
