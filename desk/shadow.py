"""Shadow-only forward test: record live quotes (free, no account), replay the desk over them, report daily.

No broker, no keys, no orders. 'record' is one poll (run it from cron / a scheduler every ~5 minutes during
market hours). 'report' rebuilds each symbol's decision log from the recorded quotes (idempotent: safe to rerun)
and writes day-by-day reports. PnL in these reports is SIMULATED inside the process; nothing is sent anywhere.

Data source: Nasdaq's public quote endpoint (unofficial; may be delayed, may omit bid/ask). Ticks with a real
bid/ask are labelled 'book'; otherwise last price + a tick-rule volume split is used and labelled 'proxy'. The
report prints the book/proxy mix so nobody mistakes proxy ticks for order-book data.

Usage: python -m desk.shadow record LIT:etf ALB SQM [--dir shadow]
       python -m desk.shadow report LIT ALB SQM [--dir shadow] [--capital 10000]
"""
import csv, json, os, sys, time, urllib.request
from datetime import datetime, timezone

URL = "https://api.nasdaq.com/api/quote/{sym}/info?assetclass={ac}"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
COLS = ["fetch_ts", "last", "volume", "bid", "ask", "bid_size", "ask_size", "trade_ts", "real_time"]
SPREAD_BPS_PROXY = 5.0


def _num(s):
    try:
        v = float(str(s).replace("$", "").replace(",", "").strip())
        return v
    except ValueError:
        return None


def is_open(status):
    s = (status or "").lower()
    return "open" in s and not any(w in s for w in ("pre", "after", "closed"))


def parse_quote(payload):
    """Return (quote_dict, None) or (None, reason)."""
    d = (payload or {}).get("data") or {}
    p = d.get("primaryData") or {}
    last = _num(p.get("lastSalePrice"))
    if last is None or last <= 0:
        return None, "no_last"
    if not is_open(d.get("marketStatus")):
        return None, f"not_open:{d.get('marketStatus')}"
    return {"last": last, "volume": _num(p.get("volume")), "bid": _num(p.get("bidPrice")), "ask": _num(p.get("askPrice")),
            "bid_size": _num(p.get("bidSize")), "ask_size": _num(p.get("askSize")),
            "trade_ts": p.get("lastTradeTimestamp"), "real_time": bool(p.get("isRealTime"))}, None


def http_fetch(sym, ac):
    req = urllib.request.Request(URL.format(sym=sym, ac=ac), headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def _iso(now):
    return datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def record_once(symbols, out_dir="shadow", fetch=http_fetch, now=time.time):
    """symbols: ['LIT:etf', 'ALB', ...] (default asset class 'stocks'). Returns {symbol: 'ok' | reason}."""
    os.makedirs(out_dir, exist_ok=True)
    result, t = {}, now()
    for item in symbols:
        sym, _, ac = item.partition(":")
        ac = ac or "stocks"
        path = f"{out_dir}/{sym}_quotes.csv"
        try:
            q, why = parse_quote(fetch(sym, ac))
        except Exception as e:                       # network, HTTP, JSON: log the gap, never fabricate a row
            q, why = None, f"error:{type(e).__name__}"
        if q is None:
            open(f"{out_dir}/gaps.log", "a").write(f"{t:.0f} {sym} {why}\n")
            result[sym] = why
            continue
        new = not os.path.exists(path) or os.path.getsize(path) == 0
        if not new:
            last_row = open(path).read().rstrip("\n").rsplit("\n", 1)[-1].split(",")
            try:
                prev = datetime.strptime(last_row[0], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
                if t - prev < 60:                   # double-run guard
                    result[sym] = "dup_within_60s"
                    continue
            except ValueError:
                pass
        with open(path, "a", newline="") as f:
            w = csv.writer(f)
            if new:
                w.writerow(COLS)
            w.writerow([_iso(t)] + [("" if q[k] is None else q[k]) for k in COLS[1:]])
        result[sym] = "ok"
    return result


def ticks_from_quotes(path):
    """Quote rows -> (mid, spread, bid_size, ask_size, ts) ticks. Returns (ticks, n_book, n_proxy)."""
    ticks, nb, npx, prev_last, prev_vol = [], 0, 0, None, None
    for r in csv.DictReader(open(path, newline="")):
        f = lambda k: _num(r.get(k, "")) if r.get(k, "") != "" else None
        last, vol, bid, ask, bs, as_ = f("last"), f("volume"), f("bid"), f("ask"), f("bid_size"), f("ask_size")
        if last is None or last <= 0:
            continue
        if bid and ask and bs and as_ and bid > 0 and ask >= bid and bs > 0 and as_ > 0:
            ticks.append(((bid + ask) / 2, ask - bid, bs, as_, r["fetch_ts"])); nb += 1
        else:
            dv = max((vol - prev_vol) if (vol is not None and prev_vol is not None and vol >= prev_vol) else 1.0, 1.0)
            up, down = (last > prev_last) if prev_last else False, (last < prev_last) if prev_last else False
            bsz, asz = (dv, 1.0) if up else (1.0, dv) if down else (dv / 2 + 0.5, dv / 2 + 0.5)
            ticks.append((last, last * SPREAD_BPS_PROXY / 1e4, bsz, asz, r["fetch_ts"])); npx += 1
        prev_last, prev_vol = last, vol if vol is not None else prev_vol
    return ticks, nb, npx


def build_report(sym, out_dir="shadow", capital=10_000.0):
    from .run import run_gambler
    from .logs import Log
    from . import daily_report as dr
    q = f"{out_dir}/{sym}_quotes.csv"
    if not os.path.exists(q):
        return f"{sym}: no quotes recorded yet"
    ticks, nb, npx = ticks_from_quotes(q)
    os.makedirs(f"{out_dir}/logs", exist_ok=True)
    log_path = f"{out_dir}/logs/{sym}.jsonl"
    open(log_path, "w").close()                                  # rebuild from scratch: idempotent
    run_gambler(iter(ticks), "paper", log=Log(log_path, wall_clock=False))
    ev = dr.load_events(log_path)
    rows = dr.build_daily(ev, capital, gaps=dr.count_gaps(f"{out_dir}/gaps.log"))
    s = dr.summarize(rows, ev)
    rep = f"{out_dir}/reports/{sym}"
    os.makedirs(rep, exist_ok=True)
    md = dr.render_markdown(rows, s, capital)
    note = (f"\n> **Simulated, no orders sent.** Data mix: {nb} book ticks, {npx} proxy ticks "
            f"({npx / max(nb + npx, 1):.0%} proxy). Proxy ticks use last price and a volume tick-rule, not a real order book.\n")
    open(f"{rep}/daily_report.md", "w").write(md.replace("\n## Last", note + "\n## Last", 1))
    # machine-readable copies for the dashboard (static page reads these)
    if rows:
        with open(f"{rep}/daily.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    summary = dict(s, symbol=sym, book_ticks=nb, proxy_ticks=npx, capital=capital, simulated=True)
    open(f"{rep}/summary.json", "w").write(json.dumps(summary, indent=1))
    return f"{sym}: {len(ticks)} ticks ({nb} book / {npx} proxy), {len(rows)} days -> {rep}/daily_report.md"


def main(argv):
    cmd, rest = argv[0], argv[1:]
    opt = lambda k, d: type(d)(rest[rest.index(k) + 1]) if k in rest else d
    out = opt("--dir", "shadow")
    syms = []
    skip = False
    for i, a in enumerate(rest):
        if skip:
            skip = False
        elif a.startswith("--"):
            skip = True
        else:
            syms.append(a)
    if cmd == "record":
        print(json.dumps(record_once(syms, out)))
    elif cmd == "report":
        for s in syms:
            print(build_report(s.split(":")[0], out, opt("--capital", 10_000.0)))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
