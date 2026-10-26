"""Simulated paper run of the Gambler. Usage: python -m desk.run [shadow|paper] [ticks]

shadow: judge labels every tick, policy logs what it WOULD do, nothing executes.
paper:  policy executes against the paper broker, after the risk engine.
"""
import random, sys
from .state import Tape, build_state
from .questions import BATTERIES
from .judge import MockJudge
from . import policy
from .risk import RiskEngine, Limits
from .broker import PaperBroker
from .book import Book
from .logs import Log

HORIZON = 5  # ticks until a "buy pressure" prediction is scored


def simulate(mode="shadow", ticks=2000, seed=7):
    rng = random.Random(seed)
    tape, judge, risk, broker, book, log = Tape(), MockJudge(), RiskEngine(Limits()), PaperBroker(), Book(), Log()
    price, drift, pending, hold = 100.0, 0.0, [], 0
    for t in range(ticks):
        if t % 100 == 0:
            drift = rng.choice([-1, 0, 1]) * 0.0004
        price *= 1 + drift + rng.gauss(0, 0.0008)
        flow = drift * 600 + rng.gauss(0, 0.3)
        bid, ask = 100 * (1 + max(-0.9, min(0.9, flow))), 100 * (1 - max(-0.9, min(0.9, flow)))
        tape.push(price, price * 0.0003, bid, ask)
        for p in [x for x in pending if x[0] == t]:
            log("outcome", p=p[1], outcome=int(price > p[2]), q="buy_pressure")
        pending = [x for x in pending if x[0] > t]
        if len(tape.mids) < 61:
            continue
        # exit first: held positions close on a fixed number of ticks (placeholder for a numeric exit rule)
        if book.position and t - book.position >= 30:
            broker.close(price); book.position = None
        if not book.can_scan():
            continue
        state = build_state(tape, broker.qty, min(0, broker.equity(price)))
        resp = judge.ask(state, BATTERIES["gambler"])
        ans = resp["answers"]
        pending.append((t + HORIZON, ans["buy_pressure"]["p"], price))
        action = policy.gambler(ans)
        log("decision", t=t, state=state, answers=ans, version=resp["version"], action=action, mode=mode)
        if action != "long" or mode == "shadow":
            continue
        veto = risk.check(notional=500, leverage=1, daily_pnl=broker.equity(price),
                          expected_edge_bps=25, model_version=resp["version"])
        if veto:
            log("veto", t=t, reason=veto); continue
        broker.buy(price, 500); book.position = t
    broker.close(price)
    return broker.cash_pnl


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "shadow"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 2000
    open("desk_log.jsonl", "w").close()
    pnl = simulate(mode, n)
    print(f"mode={mode} paper pnl after fees: {pnl:.2f}")
    from .report import calibration
    print(calibration())
