"""Summarize REA Interface Builder evidence for the Procreate UI into readable anatomy notes.

Reads the exported evidence bundle, and for every decoded document prints:
  - class vocabulary (objects by class)
  - outlets (name -> destination class)
  - target-action selectors
  - accessibility identifiers / labels
  - text, titles and image names

Standard library only. Reads a local JSON Evidence bundle; nothing is executed.
"""
import collections
import json
import re
import sys

BUNDLE = sys.argv[1] if len(sys.argv) > 1 else "evidence-ui.json"

DOC_RE = re.compile(r'^ib:"([^"]+)":')


def doc_of(node_id: str) -> str:
    m = DOC_RE.match(node_id or "")
    return m.group(1) if m else "?"


def short(node_id: str) -> str:
    return (node_id or "").split(":")[-1]


def main() -> None:
    data = json.load(open(BUNDLE, encoding="utf-8"))
    for rec in data["records"]:
        if rec.get("operation") != "decode_interface_builder":
            continue
        graph = rec["normalized_result"]["graph"]
        nodes = {n["id"]: n for n in graph["nodes"]}
        by_doc = collections.defaultdict(list)
        for n in graph["nodes"]:
            by_doc[doc_of(n["id"])].append(n)

        print("=" * 100)
        print("EVIDENCE", rec["evidence_id"])
        print("=" * 100)
        for doc in sorted(by_doc):
            ns = by_doc[doc]
            classes = collections.Counter(
                n.get("attributes", {}).get("class_name") or n.get("name") or n["kind"]
                for n in ns
                if n["kind"] in ("view", "control", "view_controller", "unknown")
            )
            print(f"\n### {doc}   ({len(ns)} nodes)")
            print("  classes: " + ", ".join(f"{k}[{v}]" for k, v in classes.most_common()))

            # accessibility + text + images straight off nodes
            for n in ns:
                attrs = n.get("attributes", {}).get("nibValues", {}) or {}
                interesting = []
                for key in ("UIAccessibilityIdentifier", "UIAccessibilityLabel", "UIText",
                            "UIButtonTitle", "UIPlaceholder", "UIImage", "UISegmentedControlItems",
                            "UIPrompt", "UIKeyboardType", "UIStackViewSpacing"):
                    if key in attrs and attrs[key] not in (None, "", []):
                        interesting.append(f"{key}={attrs[key]}")
                if interesting:
                    cls = n.get("attributes", {}).get("class_name") or n["kind"]
                    print(f"    [{cls}] " + "; ".join(str(i)[:160] for i in interesting))

            # connections
            for e in graph["edges"]:
                if doc_of(e["from"]) != doc:
                    continue
                if e["relation"] == "outlet_to":
                    src = nodes.get(e["from"], {})
                    dst = nodes.get(e["to"], {})
                    name = (src.get("name") or "").split(".")[-1]
                    print(f"    outlet {name!r:32} -> {dst.get('attributes',{}).get('class_name') or dst.get('name')}")
                elif e["relation"] == "target_action":
                    src = nodes.get(e["from"], {})
                    dst = nodes.get(e["to"], {})
                    sel = src.get("name") or dst.get("name") or ""
                    print(f"    action {sel!r:40} <- {src.get('attributes',{}).get('class_name','?')}")
        print()


if __name__ == "__main__":
    main()
