"""Extract and parse every English .strings table from a local .ipa.

Standard library only; reads the archive, decodes UTF-16 or UTF-8 tables, writes one TSV per app.
"""
import re
import sys
import zipfile
from pathlib import Path

PAIR = re.compile(r'"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;', re.S)


def parse(raw: bytes):
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = raw.decode("utf-16", "replace")
    else:
        text = raw.decode("utf-8", "replace")
    return [(m.group(1), m.group(2)) for m in PAIR.finditer(text)]


def main(ipa: str, out_tsv: str) -> None:
    rows = []
    with zipfile.ZipFile(ipa) as z:
        for info in z.infolist():
            name = info.filename
            if not name.endswith(".strings"):
                continue
            if not ("/en.lproj/" in name or "/Base.lproj/" in name or name.endswith("/Localizable.strings")):
                continue
            if "/en.lproj/" not in name and "/Base.lproj/" not in name:
                continue
            pairs = parse(z.read(name))
            rel = name.split(".app/", 1)[-1].rsplit("/", 1)[0]
            for k, v in pairs:
                rows.append((rel, k, v))
    with open(out_tsv, "w", encoding="utf-8", newline="\n") as f:
        f.write("table\tkey\tvalue\n")
        for r in rows:
            f.write("\t".join(x.replace("\t", " ") for x in r) + "\n")
    tables = sorted({r[0] for r in rows})
    print(f"{len(rows)} pairs from {len(tables)} tables -> {out_tsv}")
    for t in tables:
        print("  ", t)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
