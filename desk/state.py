"""Deterministic snapshot builder. Every field uses only data from before the decision."""
from __future__ import annotations
import math
from dataclasses import dataclass, field

WINDOWS = (5, 20, 60)


@dataclass
class Tape:
    """Rolling market history fed one tick at a time."""
    mids: list[float] = field(default_factory=list)
    spreads: list[float] = field(default_factory=list)
    bid_sizes: list[float] = field(default_factory=list)
    ask_sizes: list[float] = field(default_factory=list)

    def push(self, mid, spread, bid_size, ask_size):
        self.mids.append(mid)
        self.spreads.append(spread)
        self.bid_sizes.append(bid_size)
        self.ask_sizes.append(ask_size)


def _ret(mids, n):
    return None if len(mids) <= n else mids[-1] / mids[-1 - n] - 1


def _vol(mids, n=20):
    if len(mids) <= n:
        return None
    rs = [mids[i] / mids[i - 1] - 1 for i in range(len(mids) - n, len(mids))]
    mean = sum(rs) / n
    return math.sqrt(sum((r - mean) ** 2 for r in rs) / n)


def build_state(tape: Tape, inventory: float, drawdown: float) -> dict:
    """Compact named fields only. A field that is unknown stays None (missing is not neutral)."""
    b, a = tape.bid_sizes[-1], tape.ask_sizes[-1]
    s = {
        "mid": round(tape.mids[-1], 4),
        "spread_bps": round(tape.spreads[-1] / tape.mids[-1] * 1e4, 2),
        "imbalance": round((b - a) / (b + a), 3),
        "realized_vol": None if _vol(tape.mids) is None else round(_vol(tape.mids), 6),
        "inventory": inventory,
        "drawdown": round(drawdown, 4),
    }
    for n in WINDOWS:
        r = _ret(tape.mids, n)
        s[f"ret_{n}"] = None if r is None else round(r, 5)
    return s
