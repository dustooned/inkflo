"""Dump the meaningful rows of a CSP .spws workspace, decoding text where possible."""
import sqlite3
import sys
from pathlib import Path


def show(value, limit=400):
    if isinstance(value, bytes):
        text = None
        for enc in ("utf-8", "utf-16-le"):
            try:
                candidate = value.decode(enc)
            except UnicodeDecodeError:
                continue
            if sum(1 for ch in candidate if ch.isprintable() or ch in "\r\n\t") > len(candidate) * 0.9:
                text = candidate
                break
        if text is not None:
            return f"<{len(value)}B text> {text[:limit]!r}"
        return f"<{len(value)}B binary> {value[:48].hex()}"
    return value


def main():
    path = Path(sys.argv[1])
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    for table in ("workspaceinfomation", "workspacepreference", "workspacetoolbardatamode",
                  "workspaceplacement", "workspacetoolbaritem"):
        print(f"\n=== {table} ===")
        try:
            rows = cur.execute(f'select * from "{table}"').fetchall()
        except sqlite3.DatabaseError as exc:
            print("  unreadable:", exc)
            continue
        for row in rows[:30]:
            print("  " + ", ".join(f"{k}={show(row[k])}" for k in row.keys()))


if __name__ == "__main__":
    main()
