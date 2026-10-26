"""One battery per bot type. One judgment per question; every Choice has an 'other' option."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Q:
    id: str
    kind: str  # "noul" (p in 0..1) | "choice" | "score"
    text: str
    options: tuple = ()


GAMBLER = (
    Q("regime", "choice", "What regime is this?", ("trending", "mean_reverting", "chaotic", "other")),
    Q("buy_pressure", "noul", "Is buying pressure building right now?"),
    Q("setup", "score", "How well does this match the long setup in the rulebook?", (0, 1, 2, 3)),
    Q("action", "choice", "Best action?", ("long", "short", "hold", "other")),
    Q("exec_degraded", "noul", "Has execution quality degraded in the last minutes?"),
)

HOUSE = (
    Q("range_state", "choice", "Range state?", ("inside", "testing_edge", "breaking_out", "other")),
    Q("toxic_flow", "noul", "Is the incoming flow toxic (informed traders picking us off)?"),
    Q("worth_quoting", "score", "Is this an environment worth quoting into at all?", (0, 1, 2, 3)),
    Q("volume_alive", "noul", "Is volume still flowing through this market?"),
)

SPY = (
    Q("wallet_record", "choice", "This wallet's record looks:", ("skilled", "lucky", "bot_like", "insider_like", "other")),
    Q("consistent", "noul", "Is this move consistent with how this wallet usually trades?"),
    Q("mirror", "choice", "Mirror it:", ("full", "partial", "skip", "other")),
    Q("rug", "noul", "Given the flags code found, does this token look like a rug?"),
)

BATTERIES = {"gambler": GAMBLER, "house": HOUSE, "spy": SPY}
