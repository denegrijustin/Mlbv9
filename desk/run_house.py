"""Paper run of the House (grid) bot through a range followed by a breakout.
Usage: python -m desk.run_house  -> compares no protection / range guard / guard + judge."""
import random
from .state import Tape, build_state
from .questions import BATTERIES
from .judge import MockJudge
from . import policy
from .risk import range_guard
from .grid import Grid
from .logs import Log


def simulate_house(variant="judge", range_ticks=1500, break_ticks=300, seed=3, log=None):
    """variant: 'none' | 'guard' | 'judge'. Returns (equity, round_trips)."""
    rng, tape, judge = random.Random(seed), Tape(), MockJudge()
    grid, price, prev = Grid(100.0, 0.25), 100.0, 100.0
    for t in range(range_ticks + break_ticks):
        breaking = t >= range_ticks
        drift = -0.0007 if breaking else -(price - 100) / 100 * 0.05   # breakout vs mean reversion
        price *= 1 + drift + rng.gauss(0, 0.0008)
        flow = max(-0.9, min(0.9, drift * 600 + rng.gauss(0, 0.2)))
        tape.push(price, price * 0.0005, 100 * (1 + flow), 100 * (1 - flow))
        if len(tape.mids) < 61:
            prev = price
            continue
        quote = True
        if variant == "judge" and grid.active:
            ans = judge.ask(build_state(tape, 0, 0), BATTERIES["house"])["answers"]
            action = policy.house(ans)
            if log: log("house_decision", t=t, action=action, answers=ans)
            if action == "pull":
                grid.flatten(price); quote = False
            elif action == "pause":
                quote = False
        if variant != "none" and grid.active and range_guard(price, grid.low, grid.high, tol=grid.step):
            grid.stop(price)
            if log: log("range_guard", t=t, price=price)
        grid.on_price(prev, price, quote)
        prev = price
    return grid.equity(price), grid.round_trips


if __name__ == "__main__":
    for v in ("none", "guard", "judge"):
        eq, rt = simulate_house(v)
        print(f"{v:6s} equity={eq:8.2f}  round_trips={rt}")
