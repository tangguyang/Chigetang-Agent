"""Create a complete source ZIP without dependencies or user data.

Run after npm run build / npm run verify. An optional output directory may be
passed as the first argument; the default is release/.
"""
from pathlib import Path
import hashlib
import json
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / "release"
output.mkdir(parents=True, exist_ok=True)
name = f"吃个糖Agent-v{version}-Source"
files = [p for p in root.iterdir() if p.is_file() and
         (p.suffix == ".md" or p.name in {
             "package.json", "package-lock.json", "tsconfig.json",
             "vite.config.ts", "VERSION", ".gitignore", "legacy-v124-sha256.json"})]
for folder in ("src", "scripts", "tests", "resources", "docs", "licenses", "examples", "dist"):
    files.extend(p for p in (root / folder).rglob("*") if p.is_file()
                 and not any(part.startswith(".") or part == "__pycache__"
                             for part in p.relative_to(root / folder).parts)
                 and p.suffix not in {".pyc", ".sqlite", ".db", ".part"})
manifest = {}
archive = output / f"{name}.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for p in sorted(set(files)):
        relative = p.relative_to(root).as_posix()
        manifest[relative] = hashlib.sha256(p.read_bytes()).hexdigest()
        z.write(p, f"{name}/{relative}")
    z.writestr(f"{name}/SOURCE-SHA256.json",
               json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
with zipfile.ZipFile(archive) as z:
    bad = z.testzip()
    if bad:
        raise RuntimeError(f"ZIP CRC failed: {bad}")
print(json.dumps({"file": str(archive), "source_files": len(files),
                  "size_bytes": archive.stat().st_size,
                  "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()},
                 ensure_ascii=False))
