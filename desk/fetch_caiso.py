"""Download CAISO OASIS locational marginal prices (public, no key). Resumable, polite, never fills gaps.

Usage: python -m desk.fetch_caiso [node] [start YYYY-MM-DD] [end YYYY-MM-DD] [out_dir]
Defaults: TH_NP15_GEN-APND, one year back from 2026-10-20, data/caiso
Writes <out_dir>/<node>_RTM.csv (5-minute) and <node>_DAM.csv (hourly): columns ts_utc,price  ($/MWh).
OASIS wants a few seconds between requests; range limits seen in practice: 7 days (RTM), 31 days (DAM).
"""
import csv, io, os, sys, time, urllib.request, zipfile
from datetime import date, datetime, timedelta

URL = ("https://oasis.caiso.com/oasisapi/SingleZip?queryname={q}&startdatetime={a}&enddatetime={b}"
       "&version=1&market_run_id={m}&node={n}&resultformat=6")
SPECS = {"RTM": ("PRC_INTVL_LMP", 7), "DAM": ("PRC_LMP", 31)}


def chunk_ranges(start: date, end: date, days: int):
    d = start
    while d < end:
        e = min(d + timedelta(days=days), end)
        yield d, e
        d = e


def parse_zip(blob: bytes):
    """Return [(ts_utc_iso, price)] for LMP rows only. Raises ValueError if the payload isn't a zip."""
    try:
        z = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        raise ValueError("not a zip (empty body or an error page)")
    out = []
    for name in z.namelist():
        for r in csv.DictReader(io.TextIOWrapper(z.open(name))):
            if r.get("LMP_TYPE") != "LMP":
                continue
            try:
                out.append((r["INTERVALSTARTTIME_GMT"][:19] + "Z", float(r["MW"])))
            except (KeyError, ValueError):
                continue
    return sorted(set(out))


def http_get(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 desk-research"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_chunk(market, node, a: date, b: date, get=http_get, sleep=time.sleep, tries=4):
    q, _ = SPECS[market]
    url = URL.format(q=q, a=a.strftime("%Y%m%dT00:00-0000"), b=b.strftime("%Y%m%dT00:00-0000"), m=market, n=node)
    for k in range(tries):
        try:
            rows = parse_zip(get(url))
            if rows:
                return rows
            err = "no LMP rows"
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
        print(f"  retry {k + 1}/{tries} {market} {a}..{b}: {err}", flush=True)
        sleep(10 * 2 ** k)
    return None   # leave a visible gap; the caller records it


def main(node="TH_NP15_GEN-APND", start="2025-10-20", end="2026-10-20", out="data/caiso", sleep=time.sleep):
    os.makedirs(f"{out}/chunks", exist_ok=True)
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    for market, (_, days) in SPECS.items():
        allrows, gaps = [], []
        for a, b in chunk_ranges(s, e, days):
            cache = f"{out}/chunks/{node}_{market}_{a}_{b}.csv"
            if os.path.exists(cache):
                allrows += [(r[0], float(r[1])) for r in csv.reader(open(cache))]
                continue
            rows = fetch_chunk(market, node, a, b, sleep=sleep)
            sleep(6)
            if rows is None:
                gaps.append((a, b)); print(f"GAP {market} {a}..{b}", flush=True); continue
            csv.writer(open(cache, "w", newline="")).writerows(rows)
            allrows += rows
            print(f"{market} {a}..{b}: {len(rows)} rows", flush=True)
        allrows = sorted(set(allrows))
        with open(f"{out}/{node}_{market}.csv", "w", newline="") as f:
            w = csv.writer(f); w.writerow(["ts_utc", "price"]); w.writerows(allrows)
        print(f"{market}: {len(allrows)} rows, {len(gaps)} gaps {gaps}", flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:5])
