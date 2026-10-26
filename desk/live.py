"""Live quote recorder (read-only). Polls Alpaca's free IEX feed and appends replay-format rows.

Setup: create a free Alpaca account, generate an API key, then export
  ALPACA_KEY_ID=...   ALPACA_SECRET=...
Read-only market data needs no funding and the key never goes in code or logs.
Usage: python -m desk.live LIT live_LIT.csv [--every 5] [--rows 100000]

Notes:
- IEX is one exchange: sizes and quotes are partial, and outside market hours the quote doesn't change.
  A row is written only when the quote's own timestamp changes, so stale quotes never become fake data.
- Errors and skipped quotes go to <out>.gaps.log; gaps are never filled in.
- The CSV has an extra 'ts' column; desk.replay ignores it.
"""
import csv, json, os, sys, time, urllib.request, urllib.error

URL = "https://data.alpaca.markets/v2/stocks/quotes/latest?symbols={sym}&feed=iex"


def parse_quote(payload, symbol):
    """Return ((ts, mid, spread, bid_size, ask_size), None) or (None, reason)."""
    q = (payload.get("quotes") or {}).get(symbol)
    if not q:
        return None, "no_quote"
    try:
        bp, ap, bs, as_ = float(q["bp"]), float(q["ap"]), float(q["bs"]), float(q["as"])
    except (KeyError, TypeError, ValueError):
        return None, "malformed"
    if bp <= 0 or ap <= 0 or bs <= 0 or as_ <= 0:
        return None, "empty_side"
    if ap < bp:
        return None, "crossed"
    return (q.get("t"), (bp + ap) / 2, ap - bp, bs, as_), None


def alpaca_fetch(symbol):
    try:
        headers = {"APCA-API-KEY-ID": os.environ["ALPACA_KEY_ID"], "APCA-API-SECRET-KEY": os.environ["ALPACA_SECRET"]}
    except KeyError as e:
        raise SystemExit(f"set {e.args[0]} in the environment (free Alpaca key, read-only)")
    with urllib.request.urlopen(urllib.request.Request(URL.format(sym=symbol), headers=headers), timeout=10) as r:
        return json.load(r)


def record(symbol, out, every=5.0, rows=100_000, fetch=alpaca_fetch, sleep=time.sleep):
    new = not os.path.exists(out) or os.path.getsize(out) == 0
    last_ts, written, backoff = None, 0, every
    with open(out, "a", newline="") as f, open(out + ".gaps.log", "a") as gaps:
        w = csv.writer(f)
        if new:
            w.writerow(["mid", "spread", "bid_size", "ask_size", "ts"])
        while written < rows:
            try:
                row, why = parse_quote(fetch(symbol), symbol)
                backoff = every
            except urllib.error.HTTPError as e:   # 429 etc.: back off, never retry-spam
                row, why, backoff = None, f"http_{e.code}", min(backoff * 2, 300)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                row, why, backoff = None, f"error_{type(e).__name__}", min(backoff * 2, 300)
            if row is None:
                gaps.write(f"{time.time():.0f} {why}\n"); gaps.flush()
            elif row[0] != last_ts:                # new quote only
                ts, mid, spread, bs, as_ = row
                w.writerow([mid, spread, bs, as_, ts]); f.flush()
                last_ts, written = ts, written + 1
            sleep(backoff)
    return written


if __name__ == "__main__":
    a = sys.argv[1:]
    opt = lambda k, d: type(d)(a[a.index(k) + 1]) if k in a else d
    print(f"recorded {record(a[0], a[1], opt('--every', 5.0), opt('--rows', 100_000))} rows")
