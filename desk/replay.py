"""Replay recorded market data through the same loops the simulations use.

CSV columns: mid,spread,bid_size,ask_size   (one row per decision tick, oldest first; header required)
Usage: python -m desk.replay data.csv [gambler|house] [shadow|paper|none|guard|judge]
       python -m desk.replay --demo       # writes + replays a synthetic file to check the plumbing
"""
import csv, sys


def ticks_from_csv(path):
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            row = (float(r["mid"]), float(r["spread"]), float(r["bid_size"]), float(r["ask_size"]))
            if not all(x == x and x > 0 for x in row[:1] + row[2:]):  # NaN / non-positive: refuse, don't guess
                raise ValueError(f"bad row: {r}")
            yield row


def write_csv(path, ticks):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["mid", "spread", "bid_size", "ask_size"])
        w.writerows(ticks)


def main(argv):
    from .run import run_gambler, gen_ticks
    from .run_house import run_house, gen_house_ticks
    from .logs import Log
    from .report import calibration
    if argv and argv[0] == "--demo":
        write_csv("demo_ticks.csv", gen_ticks(2000))
        argv = ["demo_ticks.csv", "gambler", "paper"]
    path, bot = argv[0], (argv[1] if len(argv) > 1 else "gambler")
    arg = argv[2] if len(argv) > 2 else ("shadow" if bot == "gambler" else "guard")
    if bot == "gambler":
        open("desk_log.jsonl", "w").close()
        print(f"gambler/{arg} paper pnl: {run_gambler(ticks_from_csv(path), arg, log=Log()):.2f}")
        print(calibration())
    else:
        first = next(ticks_from_csv(path))[0]
        eq, rt = run_house(ticks_from_csv(path), arg, center=first)
        print(f"house/{arg} equity={eq:.2f} round_trips={rt}")


if __name__ == "__main__":
    main(sys.argv[1:])
