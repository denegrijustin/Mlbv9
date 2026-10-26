"""Hard vetoes, deterministic, checked before every order. No model gets a vote."""
from __future__ import annotations
from dataclasses import dataclass


@dataclass
class Limits:
    max_position_usd: float = 1000.0
    daily_loss_limit_usd: float = 50.0
    max_leverage: float = 1.0
    fee_bps: float = 5.0
    gas_usd: float = 0.0
    min_edge_bps: float = 8.0
    pinned_version: str = "mock-0.1"
    resume_next_day: bool = True   # False = a loss halt stays until a human clears it (use this live)


class RiskEngine:
    def __init__(self, limits: Limits):
        self.l = limits
        self.halted = False

    def new_day(self):
        """Call at each new market day. Clears a loss halt only if the limits allow automatic resume."""
        if self.l.resume_next_day:
            self.halted = False

    def check(self, *, notional, leverage, daily_pnl, expected_edge_bps, model_version, exposure=0.0) -> str | None:
        """Return a veto reason, or None if the order may proceed."""
        l = self.l
        if self.halted or daily_pnl <= -l.daily_loss_limit_usd:
            self.halted = True
            return "daily_loss_halt"
        if model_version != l.pinned_version:
            return "model_version_mismatch"
        if leverage > l.max_leverage:
            return "leverage_cap"
        if exposure + notional > l.max_position_usd:
            return "max_position"
        cost_bps = l.fee_bps * 2 + (l.gas_usd / notional * 1e4 if notional else 0)
        if expected_edge_bps < cost_bps + l.min_edge_bps:
            return "economics"
        return None


def exit_reason(tape, entry_price, *, stop_pct=0.004, liq_floor=0.2, short=6, long=60, max_hold=None, held=0):
    """Exit on a number, final authority. Returns a reason string or None to keep holding.

    Missing data closes the position: a position you can't measure is a position you don't hold.
    """
    if not tape.mids or len(tape.bid_sizes) < long:
        return "no_data"
    if tape.mids[-1] / entry_price - 1 < -stop_pct:
        return "stop"
    depth = [b + a for b, a in zip(tape.bid_sizes, tape.ask_sizes)]
    if sum(depth[-short:]) / short < liq_floor * sum(depth[-long:]) / long:
        return "liquidity_collapse"
    if max_hold is not None and held >= max_hold:
        return "max_hold"
    return None


def range_guard(price, low, high, tol=0.0):
    """True when price has left the grid band (plus tolerance): the grid must stop and flatten."""
    return price < low - tol or price > high + tol
