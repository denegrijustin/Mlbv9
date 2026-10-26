"""Judge interface. Returns raw typed answers; makes no trading decision. The caller owns thresholds.

MockJudge is a deterministic stand-in so the pipeline runs offline. HttpJudge calls the small
judge service that holds the real model key (bots only ever hold DESK_SECRET, never the key).
"""
from __future__ import annotations
import json, os, urllib.request
from .questions import Q

MODEL_VERSION = "mock-0.1"  # always log the exact version string returned, never an alias


def _clip(x):
    return max(0.0, min(1.0, x))


class MockJudge:
    version = MODEL_VERSION

    def ask(self, state: dict, battery: tuple[Q, ...]) -> dict:
        r5, r20 = state.get("ret_5"), state.get("ret_20")
        imb, vol = state["imbalance"], state["realized_vol"]
        out = {}
        for q in battery:
            if q.id == "regime":
                if r20 is None or vol is None:
                    out[q.id] = {"choice": "other", "p": 0.9}
                else:
                    trend = abs(r20) / (vol * 4.5 + 1e-9)
                    out[q.id] = {"choice": "trending" if trend > 1 else "mean_reverting", "p": _clip(0.5 + abs(trend - 1) / 4)}
            elif q.id == "buy_pressure":
                out[q.id] = {"p": _clip(0.5 + imb * 0.5 + (r5 or 0) * 20)}
            elif q.id == "setup":
                out[q.id] = {"score": 3 if imb > 0.3 and (r5 or 0) > 0 else 2 if imb > 0.1 else 1 if imb > -0.1 else 0, "p": 0.7}
            elif q.id == "action":
                out[q.id] = {"choice": "long" if imb > 0.15 and (r5 or 0) > 0 else "hold", "p": _clip(0.5 + abs(imb))}
            elif q.id == "exec_degraded":
                out[q.id] = {"p": _clip(state["spread_bps"] / 40)}
            elif q.id == "range_state":
                out[q.id] = {"choice": "breaking_out" if abs(r20 or 0) > (vol or 1) * 6 else "inside", "p": 0.7}
            elif q.id == "toxic_flow":
                out[q.id] = {"p": _clip(abs(imb) * 1.2)}
            elif q.id == "worth_quoting":
                out[q.id] = {"score": 3 if state["spread_bps"] > 4 else 1, "p": 0.7}
            elif q.id == "volume_alive":
                out[q.id] = {"p": 0.9}
            else:  # spy questions: needs wallet data this skeleton doesn't have
                out[q.id] = {"p": 0.5} if q.kind == "noul" else {"choice": "other", "p": 0.5}
        return {"version": self.version, "answers": out}


class HttpJudge:
    """POST {state, battery} to the judge service; the service owns the model key."""
    def __init__(self, url=None, secret=None, timeout=0.25):
        self.url = url or os.environ["DESK_JUDGE_URL"]
        self.secret = secret or os.environ["DESK_SECRET"]
        self.timeout = timeout  # deadline: if it misses the next block, the caller holds

    def ask(self, state, battery):
        body = json.dumps({"state": state, "battery": [q.__dict__ for q in battery]}).encode()
        req = urllib.request.Request(self.url, body, {"Content-Type": "application/json", "X-Desk-Secret": self.secret})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.load(r)
