"""Summarize a class table: prefix histogram and keyword matches.

Usage: python classify.py pc-classes.tsv [keyword ...]
"""
import collections
import re
import sys

path = sys.argv[1]
keywords = sys.argv[2:]

rows = []
with open(path, encoding="utf-8") as f:
    next(f)
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 3:
            rows.append((parts[0], parts[1], parts[2]))

prefix = collections.Counter()
for name, _super, _count in rows:
    m = re.match(r"_TtC\d+([A-Za-z0-9]+?)\d", name)
    if m:
        prefix["TS:" + m.group(1)] += 1
        continue
    m = re.match(r"([A-Z][a-z0-9]+|[A-Z]{2,})", name)
    prefix[m.group(1) if m else name] += 1

print(f"{len(rows)} classes")
print("prefixes:", ", ".join(f"{k}[{v}]" for k, v in prefix.most_common(40)))

if keywords:
    pattern = re.compile("|".join(keywords), re.I)
    hits = [r for r in rows if pattern.search(r[0])]
    print(f"\n{len(hits)} matches for {keywords}")
    for name, superclass, count in hits:
        print(f"  {name:52} {superclass or '-':30} {count}")
