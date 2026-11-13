"""Dump printable strings inside a byte window of a file.

Usage: python window.py <file> <start> <length> [min_len]
"""
import re
import sys

path = sys.argv[1]
start = int(sys.argv[2], 0)
length = int(sys.argv[3], 0)
min_len = int(sys.argv[4]) if len(sys.argv) > 4 else 5

with open(path, "rb") as f:
    f.seek(max(0, start))
    data = f.read(length)

for m in re.finditer(rb"[\x20-\x7e]{%d,}" % min_len, data):
    print(f"{start + m.start():10d} {m.group().decode('latin-1')[:200]}")
