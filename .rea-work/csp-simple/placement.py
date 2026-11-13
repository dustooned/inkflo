"""Dump the keys and strings inside a CSP workspace placement blob (binary, keyed format)."""
import re
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1])
con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True)
blob = con.execute("select workspaceplacement from workspaceplacement limit 1").fetchone()[0]
print(f"{path.name}: placement blob {len(blob)} bytes")

# ASCII keys/values: runs of printable bytes
runs = [(m.start(), m.group().decode("latin-1")) for m in re.finditer(rb"[\x20-\x7e]{3,}", blob)]
print(f"{len(runs)} printable runs; first 60:")
for offset, text in runs[:60]:
    print(f"  {offset:6d} {text[:160]}")

words = [t for _, t in runs]
print("\nlongest 20 runs:")
for offset, text in sorted(runs, key=lambda r: -len(r[1]))[:20]:
    print(f"  {offset:6d} len={len(text):4d} {text[:200]}")
