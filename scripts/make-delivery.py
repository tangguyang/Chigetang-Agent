"""Deliver the current Windows x64 portable runtime only; no source/installer ZIP."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parent/'archive-capability-package.py'),run_name='__main__')
