import base64
import collections
import json

d = json.load(open("evidence-ui.json", encoding="utf-8"))
for r in d["records"]:
    if r["operation"] != "decode_interface_builder":
        continue
    g = r["normalized_result"]["graph"]
    print(r["evidence_id"][:12], "nodes", len(g["nodes"]))
    n = g["nodes"][0]
    print("  id:", n["id"])
    print("  keys:", list(n))
    withvals = [x for x in g["nodes"] if (x.get("attributes") or {}).get("nibValues")]
    print("  nodes with nibValues:", len(withvals))
    for x in withvals[:3]:
        v = x["attributes"]["nibValues"]
        print("   ", x["id"][:60], list(v)[:6])
    raw = base64.b64decode("BwAAAAAAAAAAAAAAAAAAAAAAAAAAAABGQAAAAAAAAEZA")
    print("  blob len", len(raw), raw[0], len(raw) - 1)
