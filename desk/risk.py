"""Hard vetoes, deterministic, checked before every order. No model gets a vote."""
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


class RiskEngine:
    def __init__(self, limits: Limits):
        self.l = limits
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
