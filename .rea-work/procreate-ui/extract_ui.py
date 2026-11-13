"""Extract only the UI member subset of a Procreate .ipa, plus its English strings.

Keeps the Payload/Procreate.app/... layout so REA can open the result as a bundle.
Standard library only; nothing is executed.
"""
import os
import shutil
import sys
import zipfile

IPA = r"D:\Downloads\Misc\Compressed\Procreate_5.4.9_Pro.ipa"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui-subset")
PREFIX = "Payload/Procreate.app/"

keep_suffix = (".nib", ".storyboardc/Info.plist")
keep_paths = [
    "en.lproj/Localizable.strings",
    "en.lproj/InfoPlist.strings",
    "en.lproj/Brushes.strings",
    "en.lproj/BrushGroups.strings",
    "en.lproj/BrushLibraries.strings",
    "en.lproj/DefaultCanvasSizes.strings",
    "en.lproj/Plurals.strings",
    "en.lproj/URLs.strings",
    "Info.plist",
]


def wanted(name: str) -> bool:
    if not name.startswith(PREFIX):
        return False
    rel = name[len(PREFIX):]
    if rel in keep_paths:
        return True
    if rel.endswith(".storyboardc/Info.plist"):
        return True
    return rel.endswith(".nib")


def main() -> int:
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    n = 0
    with zipfile.ZipFile(IPA) as z:
        for info in z.infolist():
            if not wanted(info.filename):
                continue
            target = os.path.join(OUT, info.filename.replace("/", os.sep))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
            n += 1
    print(f"extracted {n} members into {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
