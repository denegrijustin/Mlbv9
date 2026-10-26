"""Platt scaling for judge probabilities, fit from the decision log, scored out of sample.

Recalibration fixes overconfidence. It cannot create skill: if the raw signal carries no information
the calibrated output collapses to the base rate (Brier ~ base-rate Brier), which is the honest answer.

Usage: python -m desk.calibrate desk_log.jsonl [question_id=buy_pressure] [train_frac=0.7] [out.json]
"""
import json, math, sys


def _logit(p):
    p = min(max(p, 1e-3), 1 - 1e-3)
    return math.log(p / (1 - p))


def _sig(z):
    return 1 / (1 + math.exp(-max(min(z, 30), -30)))


def brier(pairs):
    return sum((p - o) ** 2 for p, o in pairs) / len(pairs)


class Platt:
    """p' = sigmoid(a * logit(p) + b), fit by Newton's method with a tiny ridge on a for stability."""
    def __init__(self, a=1.0, b=0.0):
        self.a, self.b = a, b

    def fit(self, pairs, iters=100, ridge=1e-3):
        """Damped Newton: every accepted step must lower the (lightly ridged) log-loss; steps are capped."""
        xs = [_logit(p) for p, _ in pairs]; ys = [o for _, o in pairs]

        def loss(a, b):
            t = 0.0
            for x, y in zip(xs, ys):
                p = min(max(_sig(a * x + b), 1e-12), 1 - 1e-12)
                t -= y * math.log(p) + (1 - y) * math.log(1 - p)
            return t / len(xs) + ridge * ((a - 1) ** 2 + b ** 2) / 2

        a, b = 1.0, 0.0
        cur = loss(a, b)
        n = len(xs)
        for _ in range(iters):
            ps = [_sig(a * x + b) for x in xs]
            ga = sum((p - y) * x for p, y, x in zip(ps, ys, xs)) / n + ridge * (a - 1)
            gb = sum(p - y for p, y in zip(ps, ys)) / n + ridge * b
            w = [p * (1 - p) for p in ps]
            haa = sum(wi * x * x for wi, x in zip(w, xs)) / n + ridge
            hab = sum(wi * x for wi, x in zip(w, xs)) / n
            hbb = sum(w) / n + ridge
            det = haa * hbb - hab * hab
            if det < 1e-12:
                break
            da, db = (hbb * ga - hab * gb) / det, (haa * gb - hab * ga) / det
            m = max(abs(da), abs(db))
            if m > 5:
                da, db = da * 5 / m, db * 5 / m
            step, moved = 1.0, False
            while step > 1e-6:
                na, nb = a - step * da, b - step * db
                new = loss(na, nb)
                if new < cur:
                    a, b, cur, moved = na, nb, new, True
                    break
                step /= 2
            if not moved or max(abs(da), abs(db)) * step < 1e-8:
                break
        self.a, self.b = a, b
        return self

    def __call__(self, p):
        return _sig(self.a * _logit(p) + self.b)

    def to_json(self):
        return {"a": self.a, "b": self.b}


class CalibratedJudge:
    """Wraps any judge; maps the Noul probability of listed questions through a fitted calibrator."""
    def __init__(self, judge, calibrators):
        self.judge, self.cal = judge, calibrators
        self.version = f"{judge.version}+platt"

    def ask(self, state, battery):
        resp = self.judge.ask(state, battery)
        for qid, c in self.cal.items():
            a = resp["answers"].get(qid)
            if a and "p" in a:
                a["p_raw"], a["p"] = a["p"], c(a["p"])
        resp["version"] = self.version   # thresholds tuned on calibrated output: pin the pair
        return resp


def load_pairs(log_path, qid="buy_pressure"):
    out = []
    for line in open(log_path):
        r = json.loads(line)
        if r.get("event") == "outcome" and r.get("q") == qid:
            out.append((r["p"], r["outcome"]))
    return out


def evaluate(pairs, train_frac=0.7):
    cut = int(len(pairs) * train_frac)
    train, test = pairs[:cut], pairs[cut:]
    cal = Platt().fit(train)
    base = sum(o for _, o in train) / len(train)
    return {
        "n_train": len(train), "n_test": len(test), "a": cal.a, "b": cal.b,
        "test_brier_raw": brier(test),
        "test_brier_platt": brier([(cal(p), o) for p, o in test]),
        "test_brier_base_rate": brier([(base, o) for _, o in test]),
    }, cal


if __name__ == "__main__":
    a = sys.argv[1:]
    qid = a[1] if len(a) > 1 else "buy_pressure"
    res, cal = evaluate(load_pairs(a[0], qid), float(a[2]) if len(a) > 2 else 0.7)
    for k, v in res.items():
        print(f"{k:22s} {v:.4f}" if isinstance(v, float) else f"{k:22s} {v}")
    if len(a) > 3:
        json.dump(cal.to_json(), open(a[3], "w"))
