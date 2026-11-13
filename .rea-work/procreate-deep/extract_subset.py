"""Extract every Interface Builder member of an app (plus its English strings) into a subset bundle.

Usage: python extract_subset.py <ipa> <out-dir>
"""
import os
import plistlib
import shutil
import sys
import zipfile

ipa, out = sys.argv[1], sys.argv[2]
if os.path.isdir(out):
    shutil.rmtree(out)
os.makedirs(out)

with zipfile.ZipFile(ipa) as z:
    names = z.namelist()
    prefix = next(n for n in names if n.endswith(".app/Info.plist")).rsplit("/Info.plist", 1)[0] + "/"
    count = 0
    for info in z.infolist():
        name = info.filename
        if not name.startswith(prefix):
            continue
        rel = name[len(prefix):]
        keep = (
            rel.endswith(".nib")
            or rel.endswith("Info.plist")
            or "/en.lproj/" in rel and rel.endswith(".strings")
        )
        if not keep:
            continue
        target = os.path.join(out, name.replace("/", os.sep))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with z.open(info) as src, open(target, "wb") as dst:
            shutil.copyfileobj(src, dst)
        count += 1
print(f"{count} members -> {out}")
