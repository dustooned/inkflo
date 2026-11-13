import json

inv = json.load(open("ui-inventory.json", encoding="utf-8"))
strip = "Payload/Procreate.app/"
print("STORYBOARDS:")
for s in inv["storyboards"]:
    print("  ", s.replace(strip, ""))
print("\nTOP-LEVEL NIBs (not inside a storyboard):")
for f in inv["files"]:
    p = f["path"]
    if p.endswith(".nib") and ".storyboardc/" not in p:
        print("  %-62s %8d" % (p.replace(strip, ""), f["size"]))
print("\nCARs:")
for c in inv["car"]:
    print("  ", c.replace(strip, ""))
print("\nEN STRINGS:")
sizes = {f["path"]: f["size"] for f in inv["files"]}
for s in inv["lproj_strings"]:
    if "/en.lproj/" in s:
        print("  %-70s %8d" % (s.replace(strip, ""), sizes[s]))
