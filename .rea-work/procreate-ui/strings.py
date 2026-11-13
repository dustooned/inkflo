"""Decode an Apple .strings file into an ordered list of (key, value).

Handles UTF-16 BOM and UTF-8, comments, and escaped quotes. Standard library only.
"""
import re
import sys

PAIR = re.compile(r'"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;', re.S)


def load(path: str):
    raw = open(path, "rb").read()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = raw.decode("utf-16")
    else:
        text = raw.decode("utf-8", "replace")
    return [(m.group(1), m.group(2)) for m in PAIR.finditer(text)]


if __name__ == "__main__":
    pairs = load(sys.argv[1])
    print(f"{len(pairs)} pairs")
    for k, v in pairs:
        print(f"{k}\t{v}")
