"""Decode UIView frames from REA Interface Builder evidence.

The nib archives store UIBounds/UICenter as a small keyed blob: a one-byte type tag (0x07)
followed by little-endian doubles. This turns them back into point geometry so the chrome's
proportions can be compared with our own.

Standard library only; reads a local JSON Evidence bundle.
"""
import base64
import collections
import json
import struct
import sys

BUNDLE = sys.argv[1] if len(sys.argv) > 1 else "evidence-ui.json"
WANT_DOCS = set(sys.argv[2:]) or None


def decode_pair(blob):
    if isinstance(blob, dict):
        blob = blob.get("$nib_data_base64")
    if not isinstance(blob, str):
        return None
    try:
        raw = base64.b64decode(blob)
    except Exception:
        return None
    if len(raw) < 9 or raw[0] != 0x07:
        return None
    body = raw[1:]
    if len(body) % 8:
        return None
    return [round(v, 2) for v in struct.unpack("<%dd" % (len(body) // 8), body)]


def main() -> None:
    data = json.load(open(BUNDLE, encoding="utf-8"))
    for rec in data["records"]:
        if rec.get("operation") != "decode_interface_builder":
            continue
        graph = rec["normalized_result"]["graph"]
        by_doc = collections.defaultdict(list)
        for n in graph["nodes"]:
            doc = (n["id"].split('"')[1] if n["id"].startswith('ib:"') else "?")
            if WANT_DOCS and doc not in WANT_DOCS:
                continue
            values = n.get("attributes", {}).get("nibValues") or {}
            bounds = decode_pair(values.get("UIBounds", ""))
            centre = decode_pair(values.get("UICenter", ""))
            if not bounds and not centre:
                continue
            by_doc[doc].append((n, values, bounds, centre))

        for doc in sorted(by_doc):
            print(f"\n### {doc}")
            for n, values, bounds, centre in by_doc[doc]:
                cls = n.get("attributes", {}).get("class_name") or n["name"]
                if cls in ("NSLayoutConstraint", "UIFont", "UIColor", "UITraitCollection",
                           "UIRuntimeAccessibilityConfiguration", "UINibKeyValuePair"):
                    continue
                acc = values.get("UIAccessibilityIdentifier", "")
                text = values.get("UIText", "") if isinstance(values.get("UIText"), str) else ""
                hidden = " hidden" if values.get("UIHidden") else ""
                label = f"{cls}"
                if acc:
                    label += f" [{acc}]"
                if text:
                    label += f" text={text!r}"
                print(f"  {label:70} bounds={bounds} centre={centre}{hidden}")


if __name__ == "__main__":
    main()
