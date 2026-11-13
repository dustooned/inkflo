"""Query a strings TSV by regex over key and value.

Usage: python squery.py pc-strings.tsv "pattern" [--table substring] [--max N] [--unique]
"""
import argparse
import re
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tsv")
    ap.add_argument("pattern")
    ap.add_argument("--table", default=None)
    ap.add_argument("--max", type=int, default=400)
    ap.add_argument("--unique", action="store_true")
    ap.add_argument("--values", action="store_true", help="print only values")
    args = ap.parse_args()

    rx = re.compile(args.pattern, re.I)
    seen = set()
    shown = 0
    with open(args.tsv, encoding="utf-8") as f:
        header = next(f)
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            table, key, value = parts[0], parts[1], parts[2]
            if args.table and args.table.lower() not in table.lower():
                continue
            if not (rx.search(key) or rx.search(value)):
                continue
            text = value if args.values else f"{key} = {value}"
            if args.unique:
                if text in seen:
                    continue
                seen.add(text)
            print(f"[{table}] {text}")
            shown += 1
            if shown >= args.max:
                print(f"... (stopped at {args.max})")
                return


if __name__ == "__main__":
    main()
