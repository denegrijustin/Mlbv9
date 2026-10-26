"""Download daily OHLCV history from Nasdaq's public quote API (unofficial, no key; be gentle with it).

Usage: python -m desk.fetch_nasdaq LIT etf data/LIT.csv [years]      (assetclass: etf | stocks)
Writes oldest-first Date,Open,High,Low,Close,Volume, ready for `python -m desk.ohlcv`.
"""
import csv, json, sys, urllib.request
from datetime import date, timedelta

URL = "https://api.nasdaq.com/api/quote/{sym}/historical?assetclass={ac}&fromdate={f}&todate={t}&limit=9999"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"


def _num(s):
    return float(str(s).replace("$", "").replace(",", ""))


def parse_rows(payload):
    """Nasdaq returns newest first with $ and thousands separators; return oldest-first float rows."""
    rows = ((payload.get("data") or {}).get("tradesTable") or {}).get("rows") or []
    out = []
    for r in reversed(rows):
        try:
            m, d, y = r["date"].split("/")
            out.append((f"{y}-{m}-{d}", _num(r["open"]), _num(r["high"]), _num(r["low"]), _num(r["close"]), _num(r["volume"])))
        except (KeyError, ValueError):
            continue  # skip malformed rows, never fill
    return out


def fetch(sym, assetclass="etf", years=5):
    t = date.today()
    req = urllib.request.Request(URL.format(sym=sym, ac=assetclass, f=t - timedelta(days=365 * years), t=t),
                                 headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return parse_rows(json.load(r))


if __name__ == "__main__":
    a = sys.argv[1:]
    rows = fetch(a[0], a[1], int(a[3]) if len(a) > 3 else 5)
    with open(a[2], "w", newline="") as f:
        w = csv.writer(f); w.writerow(["Date", "Open", "High", "Low", "Close", "Volume"]); w.writerows(rows)
    print(f"{a[0]}: {len(rows)} bars {rows[0][0] if rows else '-'} .. {rows[-1][0] if rows else '-'} -> {a[2]}")
