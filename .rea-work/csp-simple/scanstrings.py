"""Scan a local binary for printable ASCII and UTF-16LE strings matching a regex.

Usage: python scanstrings.py <file> <pattern> [--max N]
Read-only; nothing is executed.
"""
import re
import sys

path, pattern = sys.argv[1], sys.argv[2]
limit = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[3] == "--max" else 60

data = open(path, "rb").read()
rx = re.compile(pattern, re.I)

ascii_rx = re.compile(rb"[\x20-\x7e]{4,}")
utf16_rx = re.compile(rb"(?:[\x20-\x7e]\x00){4,}")

seen = set()
hits = []
for m in ascii_rx.finditer(data):
    text = m.group().decode("latin-1")
    if rx.search(text):
        hits.append((m.start(), "ascii", text))
for m in utf16_rx.finditer(data):
    try:
        text = m.group().decode("utf-16-le")
    except UnicodeDecodeError:
        continue
    if rx.search(text):
        hits.append((m.start(), "utf16", text))

print(f"{len(hits)} matches in {path} ({len(data)} bytes)")
shown = 0
for offset, kind, text in sorted(hits):
    key = (kind, text)
    if key in seen:
        continue
    seen.add(key)
    print(f"{offset:10d} {kind:5} {text[:220]}")
    shown += 1
    if shown >= limit:
        print(f"... (stopped at {limit})")
        break
