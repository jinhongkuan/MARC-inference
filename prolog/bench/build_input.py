"""Builds the benchmark input from real 2014 TV political advertising orders. Nothing is planted.

    python3 prolog/bench/build_input.py --draw 19 --seed 20261112 --exclude KNXV-TV --out prolog/out/test-input.json
    python3 prolog/bench/build_input.py --stations KNXV-TV --out prolog/out/dev-input.json

Sources (both public):
  labels  https://github.com/project-deepform/deepform  data/3_year_manifest.csv  (2014 rows, from Alex Byrnes, CC0)
  PDFs    the "2014-pdfs" Google Drive folder the DeepForm README links to

For each chosen station it downloads the orders, extracts their text with pdftotext, and keeps the
orders of agencies that buy for two or more advertisers there. For every order it records the agency
(owner), advertiser (account) and order number from the header, and reads the line rows it can with a
strict pattern. Those pattern-read lines feed the "pattern + rule" arm; no model is involved here.

Needs Python 3.9+ and pdftotext (poppler). Standard library only.
"""

import argparse
import collections
import concurrent.futures
import csv
import datetime
import io
import json
import pathlib
import random
import re
import subprocess
import urllib.request

MANIFEST = "https://raw.githubusercontent.com/project-deepform/deepform/master/data/3_year_manifest.csv"
FOLDER = "https://drive.google.com/embeddedfolderview?id=1aTuir0Y6WdD0P3SRUazo_82u7o8SnVf2#list"
UA = {"User-Agent": "Mozilla/5.0"}
MIN_ORDERS = 40

LINE = re.compile(
    r"(?m)^\s*(?:N\s+)?(\d+)\s+[A-Z][A-Z0-9-]{2,7}\s+(\d\d/\d\d/\d\d)\s+(\d\d/\d\d/\d\d)\s+(?:.*?\s+)?(\S+)\s+(\S+)\s+(\d?:\d\d)\s+(\d+)\s+\$([\d,]+\.\d\d)\s+(P-\d)"
)


def get(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read()


def cached(path: pathlib.Path, url: str) -> bytes:
    if not path.exists():
        path.write_bytes(get(url))
    return path.read_bytes()


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", s.upper())).strip()


def read_lines(text: str) -> list:
    out = []
    for m in LINE.finditer(text):
        day = datetime.datetime.strptime(m.group(2), "%m/%d/%y").date()
        week = day - datetime.timedelta(days=day.weekday())
        mins, secs = m.group(6).split(":")
        out.append(dict(
            n=int(m.group(1)), service=f"{m.group(5)} {m.group(4).lower()} {int(mins or 0) * 60 + int(secs)}s",
            period=week.isoformat(), units=int(m.group(7)), rate=float(m.group(8).replace(",", "")), cls=m.group(9),
        ))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stations", help="comma-separated station ids, e.g. KNXV-TV")
    ap.add_argument("--draw", type=int, help="draw this many stations at random instead")
    ap.add_argument("--seed", type=int, default=20261112)
    ap.add_argument("--exclude", default="", help="comma-separated stations never drawn")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    cache = out.parent / "source"
    (cache / "pdf").mkdir(parents=True, exist_ok=True)

    listing = cached(cache / "drive-folder.html", FOLDER).decode("utf8", "ignore")
    drive = {name[:-4]: fid for fid, name in re.findall(r'https://drive.google.com/file/d/([\w-]+)[^"]*"[^>]*>.*?flip-entry-title">([^<]+)<', listing, re.S)}
    rows = [r for r in csv.DictReader(io.StringIO(cached(cache / "3_year_manifest.csv", MANIFEST).decode("utf8"))) if r["year"] == "2014" and r["file_id"] in drive]
    by_station = collections.defaultdict(list)
    for r in rows:
        by_station[r["file_id"].rsplit("_", 1)[0]].append(r["file_id"])

    if args.stations:
        stations = args.stations.split(",")
    else:
        excluded = set(filter(None, args.exclude.split(",")))
        eligible = sorted(s for s, ids in by_station.items() if len(ids) >= MIN_ORDERS and s not in excluded)
        random.seed(args.seed)
        stations = sorted(random.sample(eligible, args.draw))
        print(f"drew {len(stations)} of {len(eligible)} eligible stations (seed {args.seed}); reserve: {sorted(set(eligible) - set(stations))}")

    wanted = [(s, fid) for s in stations for fid in sorted(by_station[s])]

    def fetch(item):
        station, fid = item
        pdf = cache / "pdf" / f"{fid}.pdf"
        if not pdf.exists():
            try:
                data = get(f"https://drive.google.com/uc?export=download&id={drive[fid]}")
            except Exception:
                return None
            if not data.startswith(b"%PDF"):
                return None
            pdf.write_bytes(data)
        text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True).stdout
        return station, fid, text

    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        fetched = list(ex.map(fetch, wanted))
    failed = sum(1 for f in fetched if f is None)

    docs = []
    for station, fid, text in filter(None, fetched):
        agency = re.search(r"Agency\s+Name:\s+(.+?)(?:\s{2,}|\n)", text)
        advertiser = re.search(r"Advertiser\s+Name:\s+(.+?)(?:\s{2,}|\n)", text)
        order = re.search(r"Order / Rev:\s+(\d+)", text)
        docs.append(dict(
            id=fid, station=station, owner=norm(agency.group(1)) if agency else "", account=norm(advertiser.group(1)) if advertiser else "",
            order=order.group(1) if order else fid, text=text, superseded_by=None, ref_lines=read_lines(text),
        ))

    # Keep agencies that buy for two or more advertisers at a station.
    accounts = collections.defaultdict(set)
    for d in docs:
        if d["owner"] and d["account"]:
            accounts[(d["station"], d["owner"])].add(d["account"])
    keep = {k for k, v in accounts.items() if len(v) >= 2}
    selected = [d for d in docs if (d["station"], d["owner"]) in keep]

    # A later file with the same order number at the same station supersedes the earlier one.
    versions = collections.defaultdict(list)
    for d in selected:
        versions[(d["station"], d["order"])].append(d)
    for group in versions.values():
        group.sort(key=lambda d: d["id"])
        for older, newer in zip(group, group[1:]):
            older["superseded_by"] = newer["id"]

    scopes = sorted({(d["station"], d["owner"]) for d in selected})
    out.write_text(json.dumps(dict(stations=stations, scopes=[dict(station=s, owner=o) for s, o in scopes], docs=selected)))
    per = collections.Counter(d["station"] for d in selected)
    print(f"orders listed {len(wanted)} | downloaded {len(wanted) - failed} | failed {failed} | no header match {sum(1 for d in docs if not d['owner'] or not d['account'])}")
    print(f"kept {len(selected)} orders in {len(scopes)} agency-station scopes | superseded {sum(1 for d in selected if d['superseded_by'])} | pattern-read lines {sum(len(d['ref_lines']) for d in selected)}")
    print("per station:", dict(sorted(per.items())))


if __name__ == "__main__":
    main()
