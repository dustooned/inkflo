"""Inspect a Clip Studio Paint .spws workspace (a SQLite database) read-only.

Usage:
  python spws.py <file.spws>                 # schema and row counts
  python spws.py <file.spws> --table NAME    # columns and first rows of one table
"""
import sqlite3
import sys
from pathlib import Path


def connect(path: Path):
    uri = f"file:{path.as_posix()}?mode=ro&immutable=1"
    return sqlite3.connect(uri, uri=True)


def main():
    path = Path(sys.argv[1])
    table = sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--table" else None
    con = connect(path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    tables = [r[0] for r in cur.execute(
        "select name from sqlite_master where type='table' order by name")]
    print(f"{path.name}: {path.stat().st_size} bytes, {len(tables)} tables")
    for name in tables:
        try:
            count = cur.execute(f'select count(*) from "{name}"').fetchone()[0]
        except sqlite3.DatabaseError as exc:
            print(f"  {name:32} unreadable ({exc})")
            continue
        cols = [c[1] for c in cur.execute(f'pragma table_info("{name}")')]
        print(f"  {name:32} rows={count:<6} cols={','.join(cols)[:120]}")
        if table and name == table:
            print("\n  --- rows ---")
            for row in cur.execute(f'select * from "{name}" limit 12'):
                print("   ", {k: (row[k] if not isinstance(row[k], bytes) else f"<{len(row[k])} bytes>")
                              for k in row.keys()})
    con.close()


if __name__ == "__main__":
    main()
