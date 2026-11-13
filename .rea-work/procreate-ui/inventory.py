"""Inventory the UI/interface members of a Procreate .ipa without executing it.

Standard library only. Reads the ZIP central directory, writes a JSON listing and
extracts selected members into a subset .app so REA's Interface Builder decoder can
read them.

Usage:
  python inventory.py "D:\\Downloads\\Misc\\Compressed\\Procreate_5.4.9_Pro.ipa" --list-only
  python inventory.py <ipa> --extract-ui  <out-dir>
"""
import argparse
import json
import os
import sys
import zipfile

UI_SUFFIXES = (".nib", ".strings", ".car")
UI_PREFIX_PARTS = ("storyboardc", "Assets.car", "Info.plist")


def is_ui(name: str) -> bool:
    if name.endswith(UI_SUFFIXES):
        return True
    return any(part in name for part in UI_PREFIX_PARTS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ipa")
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--extract-ui")
    ap.add_argument("--out", default="ui-inventory.json")
    args = ap.parse_args()

    with zipfile.ZipFile(args.ipa) as z:
        infos = z.infolist()
        ui = [i for i in infos if is_ui(i.filename)]
        inventory = {
            "ipa": os.path.abspath(args.ipa),
            "total_members": len(infos),
            "ui_members": len(ui),
            "nib": sum(1 for i in ui if i.filename.endswith(".nib")),
            "storyboards": sorted(
                {i.filename.split(".storyboardc/")[0] + ".storyboardc"
                 for i in ui if ".storyboardc/" in i.filename}
            ),
            "lproj_strings": [i.filename for i in ui if i.filename.endswith(".strings")],
            "car": [i.filename for i in ui if i.filename.endswith(".car")],
            "files": [
                {"path": i.filename, "size": i.file_size, "crc": i.CRC, "method": i.compress_type}
                for i in ui
            ],
        }
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(inventory, f, indent=1)
        print(f"{len(infos)} members, {len(ui)} UI members -> {args.out}")
        print(f"{inventory['nib']} nibs, {len(inventory['storyboards'])} storyboards, "
              f"{len(inventory['lproj_strings'])} .strings, {len(inventory['car'])} .car")

        if args.list_only:
            return 0

        out = args.extract_ui
        if not out:
            print("--extract-ui <dir> required unless --list-only", file=sys.stderr)
            return 2
        os.makedirs(out, exist_ok=True)
        count = 0
        for info in ui:
            # keep the Payload/ prefix so the result is a valid bundle layout
            target = os.path.join(out, info.filename.replace("/", os.sep))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(info) as src, open(target, "wb") as dst:
                dst.write(src.read())
            count += 1
        print(f"extracted {count} UI members into {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
