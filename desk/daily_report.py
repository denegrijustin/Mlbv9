"""Day-by-day aggregate report from the desk log: progress, risk and evidence in one place.

Reads desk_log.jsonl (events: day_close, fill, veto, decision, outcome) and optional gaps logs, writes
<out>/daily_report.md and <out>/daily_report.csv. Works the same for shadow, paper and replay runs.

Usage: python -m desk.daily_report desk_log.jsonl [--capital 10000] [--target-pct 5] [--period-days 21]
                                   [--gaps live_LIT.csv.gaps.log] [--out reports]

'Growth' is shown against an optional target path (--target-pct reached after --period-days trading days)
and against buy-and-hold of the same instrument. The report also states how much evidence the PnL
carries: a few weeks of daily PnL cannot separate skill from luck, and the verdict line says so.
"""
import csv, json, os, random, sys
from collections import defaultdict
from datetime import datetime, timezone

MIN_DAYS_FOR_CLAIM = 60


def _day(rec):
    ts = rec.get("ts")
    if ts:
        return str(ts)[:10]
    return datetime.fromtimestamp(rec["t"], timezone.utc).strftime("%Y-%m-%d")


def load_events(path):
    out = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue   # a torn last line from a crash must not kill the report
    return out


def count_gaps(path):
    """Gap lines are '<epoch> <reason>'; returns {date: count}."""
    by = defaultdict(int)
    if path and os.path.exists(path):
        for line in open(path):
            try:
                by[datetime.fromtimestamp(float(line.split()[0]), timezone.utc).strftime("%Y-%m-%d")] += 1
            except (ValueError, IndexError):
                continue
    return by


def build_daily(events, capital=10_000.0, target_pct=None, period_days=21, gaps=None):
    closes = {e["date"]: e for e in events if e.get("event") == "day_close"}
    if not closes:
        return []
    by_day = defaultdict(lambda: defaultdict(list))
    for e in events:
        if e.get("event") in ("fill", "veto", "decision"):
            by_day[_day(e)][e["event"]].append(e)
    gaps = gaps or {}
    rows, peak, prev_eq, first_price = [], capital, 0.0, None
    for i, d in enumerate(sorted(closes)):
        c = closes[d]
        eq = c["equity"]
        value = capital + eq
        peak = max(peak, value)
        first_price = first_price or c["price"]
        sells = [f for f in by_day[d]["fill"] if f.get("side") == "sell"]
        nets = [f["net"] for f in sells if "net" in f]
        row = {
            "date": d, "equity_usd": round(value, 2), "day_pnl": round(eq - prev_eq, 2),
            "cum_return_pct": round(eq / capital * 100, 3), "drawdown_pct": round((value - peak) / peak * 100, 3),
            "benchmark_pct": round((c["price"] / first_price - 1) * 100, 3),
            "trades_closed": len(sells), "wins": sum(n > 0 for n in nets), "realized_net": round(sum(nets), 2),
            "signals": sum(x.get("action") == "long" for x in by_day[d]["decision"]),
            "vetoes": len(by_day[d]["veto"]), "data_gaps": gaps.get(d, 0),
        }
        if target_pct is not None:
            path = target_pct * min((i + 1) / period_days, 1.0)
            row["target_path_pct"] = round(path, 3)
            row["vs_path_pct"] = round(row["cum_return_pct"] - path, 3)
        rows.append(row)
        prev_eq = eq
    return rows


def bootstrap_ci(xs, reps=2000, seed=0):
    if len(xs) < 2:
        return None
    rng = random.Random(seed)
    means = sorted(sum(rng.choice(xs) for _ in xs) / len(xs) for _ in range(reps))
    return means[int(0.025 * reps)], means[int(0.975 * reps) - 1]


def calibration_to_date(events):
    pairs = [(e["p"], e["outcome"]) for e in events if e.get("event") == "outcome"]
    if len(pairs) < 20:
        return None
    base = sum(o for _, o in pairs) / len(pairs)
    bm = sum((p - o) ** 2 for p, o in pairs) / len(pairs)
    bb = sum((base - o) ** 2 for _, o in pairs) / len(pairs)
    return len(pairs), bm, bb


def summarize(rows, events, target_pct=None):
    if not rows:
        return {"days": 0}
    pnls = [r["day_pnl"] for r in rows]
    n = len(pnls)
    ci = bootstrap_ci(pnls)
    trades = sum(r["trades_closed"] for r in rows)
    wins = sum(r["wins"] for r in rows)
    if n < MIN_DAYS_FOR_CLAIM:
        verdict = (f"Only {n} trading days: too few to separate skill from luck (need {MIN_DAYS_FOR_CLAIM}+ and a CI that "
                   f"excludes 0). Treat this as operational data, not evidence of edge.")
    elif ci and ci[0] > 0:
        verdict = "Mean daily PnL CI excludes 0. Still requires confirmation on data collected after the code was frozen."
    else:
        verdict = "No evidence of edge: the CI of mean daily PnL includes 0."
    s = {"days": n, "start": rows[0]["date"], "end": rows[-1]["date"], "total_return_pct": rows[-1]["cum_return_pct"],
         "max_drawdown_pct": min(r["drawdown_pct"] for r in rows), "benchmark_pct": rows[-1]["benchmark_pct"],
         "mean_day_pnl": sum(pnls) / n, "ci": ci, "trades": trades,
         "win_rate": (wins / trades) if trades else None, "vetoes": sum(r["vetoes"] for r in rows),
         "data_gaps": sum(r["data_gaps"] for r in rows), "calibration": calibration_to_date(events), "verdict": verdict}
    if target_pct is not None:
        s["target_status"] = "ahead of" if rows[-1]["vs_path_pct"] >= 0 else "behind"
        s["vs_path_pct"] = rows[-1]["vs_path_pct"]
    return s


def sparkline(vals):
    bars = "▁▂▃▄▅▆▇█"
    lo, hi = min(vals), max(vals)
    if hi == lo:
        return bars[0] * len(vals)
    return "".join(bars[int((v - lo) / (hi - lo) * (len(bars) - 1))] for v in vals)


def render_markdown(rows, s, capital, target_pct=None, period_days=21, max_rows=45):
    if not rows:
        return "# Daily report\n\nNo `day_close` events in the log yet (runs need market timestamps).\n"
    L = ["# Desk daily report", "", f"{s['start']} to {s['end']} · {s['days']} trading days · starting capital ${capital:,.0f}", ""]
    L += [f"**Equity:** `{sparkline([r['equity_usd'] for r in rows[-60:]])}`", "",
          "| Metric | Value |", "|---|---|",
          f"| Total return | {s['total_return_pct']:+.2f}% |",
          f"| Buy-and-hold, same instrument | {s['benchmark_pct']:+.2f}% |",
          f"| Max drawdown | {s['max_drawdown_pct']:.2f}% |",
          f"| Mean daily PnL | ${s['mean_day_pnl']:+.2f}" + (f" (95% CI ${s['ci'][0]:+.2f} to ${s['ci'][1]:+.2f})" if s["ci"] else "") + " |",
          f"| Trades closed / win rate | {s['trades']} / " + (f"{s['win_rate']:.0%}" if s["win_rate"] is not None else "n/a") + " |",
          f"| Risk vetoes / data gaps | {s['vetoes']} / {s['data_gaps']} |"]
    if target_pct is not None:
        L.append(f"| Target path ({target_pct:+g}% over {period_days} days) | {s['target_status']} path by {abs(s['vs_path_pct']):.2f} pts |")
    if s["calibration"]:
        n, bm, bb = s["calibration"]
        L.append(f"| Calibration to date (n={n}) | Brier {bm:.4f} vs base-rate {bb:.4f} ({'better' if bm < bb else 'worse'}) |")
    L += ["", f"> {s['verdict']}", "", f"## Last {min(max_rows, len(rows))} days", ""]
    cols = ["date", "equity_usd", "day_pnl", "cum_return_pct", "drawdown_pct", "benchmark_pct", "trades_closed", "wins", "signals", "vetoes", "data_gaps"]
    if target_pct is not None:
        cols += ["vs_path_pct"]
    L += ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in rows[-max_rows:]:
        L.append("| " + " | ".join(str(r[c]) for c in cols) + " |")
    return "\n".join(L) + "\n"


def main(argv):
    opt = lambda k, d: type(d)(argv[argv.index(k) + 1]) if k in argv else d
    capital, period = opt("--capital", 10_000.0), opt("--period-days", 21)
    target = float(argv[argv.index("--target-pct") + 1]) if "--target-pct" in argv else None
    out = opt("--out", "reports")
    events = load_events(argv[0])
    rows = build_daily(events, capital, target, period, count_gaps(opt("--gaps", "") or None))
    s = summarize(rows, events, target)
    os.makedirs(out, exist_ok=True)
    open(f"{out}/daily_report.md", "w").write(render_markdown(rows, s, capital, target, period))
    if rows:
        with open(f"{out}/daily_report.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    print(f"{len(rows)} days -> {out}/daily_report.md")


if __name__ == "__main__":
    main(sys.argv[1:])
