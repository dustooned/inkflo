"""Print selector families for named classes, grouped by property stem.

Usage: python sel.py pc-methods.tsv ValkyrieBrush ValkyrieFilterCurves ...
"""
import collections
import re
import sys

path = sys.argv[1]
wanted = sys.argv[2:]

by_class = collections.defaultdict(list)
with open(path, encoding="utf-8") as f:
    next(f)
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 2:
            by_class[parts[0]].append(parts[1])

GETTER = re.compile(r"^([a-z][A-Za-z0-9]*)$")
SETTER = re.compile(r"^set([A-Z][A-Za-z0-9]*):$")


def stem(sel):
    m = SETTER.match(sel)
    if m:
        return m.group(1)[0].lower() + m.group(1)[1:]
    m = GETTER.match(sel)
    if m:
        return m.group(1)
    return None


for name in wanted:
    selectors = sorted(set(by_class.get(name, [])))
    if not selectors:
        print(f"\n## {name}: no method list (Swift-only or absent)")
        continue
    properties = collections.Counter()
    others = []
    for s in selectors:
        st = stem(s)
        if st:
            properties[st] += 1
        else:
            others.append(s)
    print(f"\n## {name} ({len(selectors)} selectors, {len(properties)} properties)")
    print("  props: " + ", ".join(sorted(properties)))
    for s in others:
        print("   ", s)
