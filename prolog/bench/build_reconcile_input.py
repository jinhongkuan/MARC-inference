"""Adds a model-free reference to a scenario 1 input file, for scenario 2 ("Ensure credits and replacements reconcile").

    python3 prolog/bench/build_reconcile_input.py prolog/out/dev-input.json prolog/out/dev-reconcile-input.json

For each order it reads, with a strict pattern, the adjustment rows printed under its lines: a credited
spot (amount in brackets) or a replacement (a row whose note says "MG for"). Nothing is planted and no
model is involved. The reference is then, per agency, station and client, the credited and replacement
value across that client's current orders.
"""

import collections
import json
import re
import sys

num = lambda s: float(s.replace(",", ""))
START = re.compile(r"(?m)^\s*(?:[A-Z]\s+)?(\d+)\s+[A-Z][A-Z0-9-]{2,7}\s+\d\d/\d\d/\d\d\s+\d\d/\d\d/\d\d\s")
SPOT = re.compile(
    r"(?m)^\s*(\d+)\s+[A-Z][A-Z0-9-]{2,7}\s+(\d\d/\d\d/\d\d)-\d\d/\d\d/\d\d[^\n]*?(\(?)\$([\d,]+\.\d\d)(\)?)\s+[\d.]+\s+\w+\s*$"
    r"((?:\n(?!\s*(?:[A-Z]\s+)?\d+\s+[A-Z][A-Z0-9-]{2,7}\s+\d\d/)[^\n]*){0,3})"
)


def adjustments(text: str) -> list:
    starts = list(START.finditer(text))
    blocks = collections.OrderedDict()
    for a, b in zip(starts, starts[1:] + [None]):
        blocks[a.group(1)] = blocks.get(a.group(1), "") + "\n" + text[a.start(): b.start() if b else len(text)]
    out = []
    for line, block in blocks.items():
        seen = set()
        for m in SPOT.finditer(block):
            row = (m.group(1), m.group(2), m.group(4), bool(m.group(3)))
            if row in seen:
                continue  # the same row reprinted after a page break
            seen.add(row)
            if m.group(3):
                out.append(dict(line=int(line), kind="credited", amount=num(m.group(4))))
            elif re.search(r"\bMG for\b", m.group(6)):
                out.append(dict(line=int(line), kind="replacement", amount=num(m.group(4))))
    return out


def main() -> None:
    src = json.load(open(sys.argv[1]))
    docs = [dict(id=d["id"], station=d["station"], owner=d["owner"], account=d["account"], superseded_by=d["superseded_by"],
                 text=d["text"], ref_adjustments=adjustments(d["text"])) for d in src["docs"]]
    accounts = collections.defaultdict(lambda: dict(credited=0.0, replaced=0.0, docs=0))
    for d in docs:
        if d["superseded_by"]:
            continue
        a = accounts[(d["station"], d["owner"], d["account"])]
        a["docs"] += 1
        a["credited"] += sum(x["amount"] for x in d["ref_adjustments"] if x["kind"] == "credited")
        a["replaced"] += sum(x["amount"] for x in d["ref_adjustments"] if x["kind"] == "replacement")
    reference = [dict(station=s, owner=o, account=acc, **v, under_delivered=v["credited"] > 0 and v["replaced"] < 0.9 * v["credited"] - 0.005)
                 for (s, o, acc), v in sorted(accounts.items())]
    json.dump(dict(docs=docs, reference=reference), open(sys.argv[2], "w"))
    print(f"orders {len(docs)} | clients {len(reference)} | with any credit {sum(1 for r in reference if r['credited'] > 0)} | under-delivered in the reference {sum(1 for r in reference if r['under_delivered'])}"
          f" | credited ${sum(r['credited'] for r in reference):,.0f} | replaced ${sum(r['replaced'] for r in reference):,.0f}")


if __name__ == "__main__":
    main()
