"""Structural probe of a local iOS .ipa: bundle identity, interface members, Mach-O sections.

Standard library only. Reads the ZIP and the executable's headers/tables; never executes anything
and never writes outside the paths it is told to.

Usage:
  python probe.py <ipa> [--json out.json]
"""
import argparse
import hashlib
import json
import plistlib
import struct
import zipfile
from pathlib import Path


def find_app_prefix(names):
    prefixes = {n.split("/")[0] + "/" + n.split("/")[1] + "/" for n in names if n.count("/") >= 2}
    apps = [p for p in prefixes if p.endswith(".app/")]
    if not apps:
        raise ValueError("no Payload/*.app in archive")
    return sorted(apps, key=len)[0]


def macho_summary(binary):
    """Return header facts for a thin or fat Mach-O (no symbol work)."""
    magic = struct.unpack_from(">I", binary, 0)[0]
    if magic in (0xCAFEBABE, 0xCAFEBABF):
        count = struct.unpack_from(">I", binary, 4)[0]
        slices = []
        for i in range(count):
            cpu, subtype, offset, size, align = struct.unpack_from(">iiIII", binary, 8 + i * 20)
            slices.append({"cpu": hex(cpu & 0xFFFFFFFF), "offset": offset, "size": size})
        return {"fat": True, "slices": slices}
    magic_le = struct.unpack_from("<I", binary, 0)[0]
    if magic_le != 0xFEEDFACF:
        return {"fat": False, "magic": hex(magic_le), "supported": False}
    cpu, subtype, file_type, ncmds, command_bytes, flags, _ = struct.unpack_from("<7I", binary, 4)
    segments, sections = [], []
    at = 32
    for _ in range(ncmds):
        command, size = struct.unpack_from("<II", binary, at)
        if command == 0x19:
            name = binary[at + 8:at + 24].rstrip(b"\0").decode("latin-1")
            vmaddr, vmsize, fileoff, filesize = struct.unpack_from("<4Q", binary, at + 24)
            segments.append({"name": name, "address": vmaddr, "size": vmsize,
                             "file_offset": fileoff, "file_size": filesize})
            count = struct.unpack_from("<I", binary, at + 64)[0]
            for i in range(count):
                s = at + 72 + i * 80
                sname = binary[s:s + 16].rstrip(b"\0").decode("latin-1")
                seg = binary[s + 16:s + 32].rstrip(b"\0").decode("latin-1")
                addr, length, offset = struct.unpack_from("<QQI", binary, s + 32)
                sections.append({"name": sname, "segment": seg, "address": addr,
                                 "size": length, "file_offset": offset})
        at += size
    return {"fat": False, "supported": True, "cpu": hex(cpu), "ncmds": ncmds,
            "segments": segments, "sections": sections,
            "objc_classlist": next((s["size"] // 8 for s in sections if s["name"] == "__objc_classlist"), None)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ipa", type=Path)
    ap.add_argument("--json", type=Path)
    args = ap.parse_args()

    with zipfile.ZipFile(args.ipa) as z:
        names = z.namelist()
        prefix = find_app_prefix(names)
        info_bytes = z.read(prefix + "Info.plist")
        info = plistlib.loads(info_bytes)
        exe_name = info.get("CFBundleExecutable")
        exe_member = prefix + exe_name
        exe = z.read(exe_member)
        mem = {"nib": [], "storyboard": set(), "strings": [], "car": [], "bundle": set()}
        for n in names:
            if n.endswith(".nib"):
                mem["nib"].append(n)
            if ".storyboardc/" in n:
                mem["storyboard"].add(n.split(".storyboardc/")[0] + ".storyboardc")
            if n.endswith(".strings"):
                mem["strings"].append(n)
            if n.endswith(".car"):
                mem["car"].append(n)
            if n.endswith(".bundle/"):
                mem["bundle"].add(n)

    report = {
        "ipa": str(args.ipa.resolve()),
        "ipa_bytes": args.ipa.stat().st_size,
        "ipa_sha256": hashlib.sha256(args.ipa.read_bytes()).hexdigest(),
        "members": len(names),
        "app_prefix": prefix,
        "bundle": {k: info.get(k) for k in ("CFBundleIdentifier", "CFBundleName",
                                            "CFBundleShortVersionString", "CFBundleVersion",
                                            "MinimumOSVersion", "UIDeviceFamily")},
        "info_plist": {"bytes": len(info_bytes), "sha256": hashlib.sha256(info_bytes).hexdigest()},
        "executable": {"path": exe_member, "bytes": len(exe), "sha256": hashlib.sha256(exe).hexdigest(),
                       **macho_summary(exe)},
        "counts": {"nib": len(mem["nib"]), "storyboard": len(mem["storyboard"]),
                   "strings": len(mem["strings"]), "car": len(mem["car"])},
        "storyboards": sorted(s.split(prefix)[1] for s in mem["storyboard"]),
        "bundles": sorted(b.split(prefix)[1] for b in mem["bundle"]),
        "nibs": sorted(n.split(prefix)[1] for n in mem["nib"]),
    }
    text = json.dumps(report, indent=1, ensure_ascii=False)
    if args.json:
        args.json.write_text(text, encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("ipa_bytes", "members", "app_prefix", "bundle",
                                             "counts", "executable")}, indent=1)[:2000])
    print("storyboards:", ", ".join(s.split("/")[-1] for s in report["storyboards"]))


if __name__ == "__main__":
    main()
