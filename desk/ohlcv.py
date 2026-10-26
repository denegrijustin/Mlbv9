"""Convert an OHLCV bar file into the replay format (mid,spread,bid_size,ask_size).

Bars have no order book, so two fields are PROXIES, not observed data:
  spread    = close * spread_bps / 1e4        (you set it to the instrument's typical quoted spread)
  bid/ask   = volume split by close location value, CLV = (close-low)/(high-low)
              bid_size = volume * CLV, ask_size = volume * (1-CLV); flat bars split 50/50.
So 'imbalance' means 'where the bar closed in its range', weighted by volume. Treat shadow-mode
calibration on this data as a plumbing check and a rough prior, not as evidence about a real book.

Usage: python -m desk.ohlcv bars.csv out.csv [--spread-bps 5]
Accepts headers in any case: open/high/low/close/volume (a date column is ignored; rows must be oldest first).
"""
import csv, sys


def bars_to_ticks(path, spread_bps=5.0):
    with open(path, newline="") as f:
        rd = csv.DictReader(f)
        cols = {(c or "").strip().lower(): c for c in rd.fieldnames or []}
        missing = [k for k in ("open", "high", "low", "close", "volume") if k not in cols]
        if missing:
            raise ValueError(f"missing columns: {missing}; found {list(cols)}")
        for r in rd:
            try:
                h, l, c, v = (float(r[cols[k]]) for k in ("high", "low", "close", "volume"))
            except (ValueError, TypeError):
                continue  # blank/short/placeholder row (e.g. holiday): skip, never fill
            if not (c > 0 and h >= l > 0):
                continue
            v = max(v, 1.0)
            clv = 0.5 if h == l else (c - l) / (h - l)
            clv = min(max(clv, 0.01), 0.99)
            yield c, c * spread_bps / 1e4, v * clv, v * (1 - clv)


def main(argv):
    from .replay import write_csv
    spread = float(argv[argv.index("--spread-bps") + 1]) if "--spread-bps" in argv else 5.0
    rows = list(bars_to_ticks(argv[0], spread))
    write_csv(argv[1], rows)
    print(f"wrote {len(rows)} ticks to {argv[1]}")


if __name__ == "__main__":
    main(sys.argv[1:])
