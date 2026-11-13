"""Summarize palettes and view settings named in a CSP workspace placement blob."""
import collections
import re
import sqlite3
import sys
from pathlib import Path

for name in sys.argv[1:]:
    path = Path(name)
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True)
    row = con.execute("select workspaceplacement from workspaceplacement").fetchone()
    blob = row[0] if row else b""
    runs = [m.group().decode("latin-1") for m in re.finditer(rb"[\x20-\x7e]{4,}", blob)]
    palettes = collections.Counter(r for r in runs if r.startswith("palettekind"))
    placements = collections.Counter(r for r in runs if r.startswith("dockplacement"))
    views = collections.Counter(r for r in runs if r.endswith("viewinfo") or "viewinfo" in r)
    print(f"\n{path.name}: blob {len(blob)}B, {len(runs)} strings")
    print(f"  palettes ({len(palettes)}): " + ", ".join(sorted(palettes)))
    print(f"  placements: " + ", ".join(sorted(placements)))
    print(f"  view-info keys ({len(views)}): " + ", ".join(sorted(views)[:12]))
    try:
        items = con.execute("select count(*) from workspacetoolbaritem").fetchone()[0]
        shortcuts = con.execute("select count(*) from workspaceshortcutmenu").fetchone()[0]
        tools = con.execute("select count(*) from workspaceshortcuttool").fetchone()[0]
        info = con.execute("select workspaceinfomationname from workspaceinfomation").fetchone()
        print(f"  info={info[0] if info else None!r} toolbar_items={items} shortcuts={shortcuts} tool_shortcuts={tools}")
    except sqlite3.DatabaseError as exc:
        print("  tables:", exc)
