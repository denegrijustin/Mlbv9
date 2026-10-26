"""Thresholds and combination weights live here, in code, reviewable. One threshold per action."""
THRESH = {
    "gambler_enter": 0.65,   # action confidence needed to go long
    "gambler_min_setup": 2,
    "exec_degraded_max": 0.6,
    "house_toxic_pull": 0.7,
    "house_breakout_pause": 0.6,
    "house_min_quote_score": 2,
}


def gambler(ans: dict) -> str:
    """Returns 'long' or 'hold'. Size is never the model's call."""
    if ans["regime"]["choice"] != "trending":
        return "hold"
    if ans["setup"]["score"] < THRESH["gambler_min_setup"]:
        return "hold"
    if ans["exec_degraded"]["p"] > THRESH["exec_degraded_max"]:
        return "hold"
    a = ans["action"]
    return "long" if a["choice"] == "long" and a["p"] >= THRESH["gambler_enter"] else "hold"


def house(ans: dict) -> str:
    """Returns 'quote', 'pause' or 'pull'."""
    if not ans["volume_alive"]["p"] > 0.5 or ans["toxic_flow"]["p"] > THRESH["house_toxic_pull"]:
        return "pull"
    r = ans["range_state"]
    if r["choice"] == "breaking_out" and r["p"] >= THRESH["house_breakout_pause"]:
        return "pause"
    return "quote" if ans["worth_quoting"]["score"] >= THRESH["house_min_quote_score"] else "pause"
