"""Dump every Objective-C class and method selector from a thin ARM64 iOS executable.

Supplementary local structural inspection of a local `.ipa`: class tables and selector names only.
No method bodies are read, nothing is executed, and nothing is written outside the output paths.

Usage:
  python metadata.py <ipa> --names classes.tsv --methods methods.tsv
"""
import argparse
import json
import plistlib
import struct
import zipfile
from pathlib import Path


class MachO:
    def __init__(self, binary: bytes):
        magic, cpu, subtype, file_type, ncmds, command_bytes, flags, _ = struct.unpack_from("<8I", binary)
        if magic != 0xFEEDFACF:
            raise ValueError("expected a thin little-endian 64-bit Mach-O")
        self.binary = binary
        self.segments, self.sections, self.fixups = [], [], []
        at = 32
        for _ in range(ncmds):
            command, size = struct.unpack_from("<II", binary, at)
            if command == 0x19:
                name = binary[at + 8:at + 24].rstrip(b"\0").decode("latin-1")
                vmaddr, vmsize, fileoff, filesize = struct.unpack_from("<4Q", binary, at + 24)
                self.segments.append({"name": name, "address": vmaddr, "size": vmsize})
                count = struct.unpack_from("<I", binary, at + 64)[0]
                for i in range(count):
                    s = at + 72 + i * 80
                    sname = binary[s:s + 16].rstrip(b"\0").decode("latin-1")
                    addr, length, offset = struct.unpack_from("<QQI", binary, s + 32)
                    self.sections.append({"name": sname, "address": addr, "size": length, "file_offset": offset})
            elif command == 0x80000034:
                data_offset, data_size = struct.unpack_from("<II", binary, at + 8)
                header = struct.unpack_from("<7I", binary, data_offset)
                starts = data_offset + header[1]
                count = struct.unpack_from("<I", binary, starts)[0]
                for i in range(count):
                    relative = struct.unpack_from("<I", binary, starts + 4 + 4 * i)[0]
                    if relative:
                        record = starts + relative
                        _, page, fmt = struct.unpack_from("<IHH", binary, record)
                        self.fixups.append({"page_size": page, "pointer_format": fmt})
            at += size
        self.image_base = next(s["address"] for s in self.segments if s["name"] == "__TEXT")
        self.text = next(s for s in self.sections if s["name"] == "__text")

    def file_offset(self, address):
        for s in self.sections:
            if s["file_offset"] and s["address"] <= address < s["address"] + s["size"]:
                return s["file_offset"] + address - s["address"]
        return None

    def pointer(self, value):
        if not value:
            return 0
        if self.file_offset(value) is not None:
            return value
        if value >> 63:
            return None
        target = self.image_base + (value & ((1 << 36) - 1))
        target = (target & ((1 << 56) - 1)) | (((value >> 36) & 0xFF) << 56)
        return target if self.file_offset(target) is not None else None

    def u64(self, address):
        offset = self.file_offset(address)
        return struct.unpack_from("<Q", self.binary, offset)[0] if offset is not None else 0

    def string_at(self, address):
        offset = self.file_offset(address) if address else None
        if offset is None:
            return None
        end = self.binary.find(b"\0", offset, min(len(self.binary), offset + 4096))
        if end < 0:
            return None
        try:
            return self.binary[offset:end].decode("utf-8")
        except UnicodeDecodeError:
            return None

    def methods(self, address):
        offset = self.file_offset(address) if address else None
        if offset is None:
            return None
        bits, count = struct.unpack_from("<II", self.binary, offset)
        entry_size = bits & 0xFFFF
        if count > 40000 or entry_size not in (12, 24):
            return None
        out = []
        for i in range(count):
            entry = address + 8 + i * entry_size
            at = self.file_offset(entry)
            if at is None:
                return None
            if bits & 0x80000000:
                name_delta, _type_delta, imp_delta = struct.unpack_from("<iii", self.binary, at)
                name_address = entry + name_delta
                if not bits & 0x40000000:
                    name_address = self.pointer(self.u64(name_address))
                implementation = entry + 8 + imp_delta
            else:
                name_raw, _type_raw, imp_raw = struct.unpack_from("<QQQ", self.binary, at)
                name_address, implementation = self.pointer(name_raw), self.pointer(imp_raw)
            name = self.string_at(name_address)
            if name is None:
                return None
            in_text = implementation is not None and self.text["address"] <= implementation < self.text["address"] + self.text["size"]
            out.append((name, in_text))
        return out

    def classes(self):
        section = next((s for s in self.sections if s["name"] == "__objc_classlist"), None)
        if not section:
            return []
        out = []
        for i in range(section["size"] // 8):
            raw = struct.unpack_from("<Q", self.binary, section["file_offset"] + i * 8)[0]
            address = self.pointer(raw)
            data = self.pointer(self.u64(address + 32) & ~7) if address else None
            name = self.string_at(self.pointer(self.u64(data + 24))) if data else None
            if not name or not name.isprintable():
                continue
            superclass = self.string_at(self.pointer(self.u64(address + 8)))
            methods = self.methods(self.pointer(self.u64(data + 32)))
            out.append({"name": name, "superclass": superclass,
                        "method_count": None if methods is None else len(methods),
                        "methods": methods})
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ipa", type=Path)
    ap.add_argument("--names", type=Path, required=True)
    ap.add_argument("--methods", type=Path, required=True)
    ap.add_argument("--json", type=Path)
    args = ap.parse_args()

    with zipfile.ZipFile(args.ipa) as z:
        prefix = next(n for n in z.namelist() if n.endswith(".app/Info.plist")).rsplit("/Info.plist", 1)[0] + "/"
        info = plistlib.loads(z.read(prefix + "Info.plist"))
        binary = z.read(prefix + info["CFBundleExecutable"])

    image = MachO(binary)
    classes = image.classes()

    with args.names.open("w", encoding="utf-8", newline="\n") as f:
        f.write("class\tsuperclass\tmethod_count\n")
        for c in classes:
            f.write(f"{c['name']}\t{c['superclass'] or ''}\t{'' if c['method_count'] is None else c['method_count']}\n")

    with args.methods.open("w", encoding="utf-8", newline="\n") as f:
        f.write("class\tselector\tin_text\n")
        for c in classes:
            for selector, in_text in c["methods"] or []:
                f.write(f"{c['name']}\t{selector}\t{'1' if in_text else '0'}\n")

    summary = {
        "ipa": str(args.ipa.resolve()),
        "bundle": {k: info.get(k) for k in ("CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion")},
        "executable_bytes": len(binary),
        "pointer_formats": sorted({f["pointer_format"] for f in image.fixups}),
        "classes": len(classes),
        "unresolved_method_lists": sum(1 for c in classes if c["method_count"] is None),
        "selectors": sum(c["method_count"] or 0 for c in classes),
    }
    if args.json:
        args.json.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
