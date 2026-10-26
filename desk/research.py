"""Does anything in the free daily data predict LIT's next-5-day direction? Walk-forward, out of sample.

Design fixed up front (no fishing): one target (LIT close[t+5] > close[t]), three feature groups,
expanding-window ridge logistic regression retrained every 21 days, a 5-day purge between the training
labels and the prediction period. Reports Brier vs the base rate and AUC with block-bootstrap 95% CIs
(overlapping 5-day targets are autocorrelated, so naive error bars would be too narrow).

Research tool only (needs numpy). Usage: python -m desk.research [data_dir]
"""
import csv, sys
import numpy as np

H = 5            # forecast horizon, bars
WARMUP = 500     # bars before the first prediction
STEP = 21        # retrain cadence
GROUPS = {
    "momentum": ["mom_5", "mom_20", "mom_60", "mom_120", "ma_dist_50", "vol_ratio"],
    "cross_asset": ["rel_alb_20", "rel_sqm_20", "alb_5", "sqm_5"],
    "market": ["mkt_20", "rel_mkt_20"],
}


def load_closes(data_dir, syms=("LIT", "ALB", "SQM", "SPY")):
    cols = {}
    for s in syms:
        with open(f"{data_dir}/{s}.csv", newline="") as f:
            cols[s] = {r["Date"]: float(r["Close"]) for r in csv.DictReader(f)}
    dates = sorted(set.intersection(*(set(c) for c in cols.values())))
    return dates, {s: np.array([cols[s][d] for d in dates]) for s in syms}


def _mom(c, n):
    out = np.full(len(c), np.nan)
    out[n:] = np.log(c[n:] / c[:-n])
    return out


def build_features(closes):
    """Feature i uses closes[: i+1] only. Returns (names, matrix[n, k])."""
    lit = closes["LIT"]
    f = {f"mom_{n}": _mom(lit, n) for n in (5, 20, 60, 120)}
    ma50 = np.full(len(lit), np.nan)
    cs = np.cumsum(np.insert(lit, 0, 0.0))
    ma50[49:] = (cs[50:] - cs[:-50]) / 50
    f["ma_dist_50"] = np.log(lit / ma50)
    r = np.diff(np.log(lit), prepend=np.nan)
    v20 = np.array([np.std(r[i - 19:i + 1]) if i >= 20 else np.nan for i in range(len(r))])
    v60 = np.array([np.std(r[i - 59:i + 1]) if i >= 60 else np.nan for i in range(len(r))])
    f["vol_ratio"] = v20 / v60
    f["rel_alb_20"] = f["mom_20"] - _mom(closes["ALB"], 20)
    f["rel_sqm_20"] = f["mom_20"] - _mom(closes["SQM"], 20)
    f["alb_5"], f["sqm_5"] = _mom(closes["ALB"], 5), _mom(closes["SQM"], 5)
    f["mkt_20"] = _mom(closes["SPY"], 20)
    f["rel_mkt_20"] = f["mom_20"] - f["mkt_20"]
    names = list(f)
    return names, np.column_stack([f[k] for k in names])


def target(lit):
    y = np.full(len(lit), np.nan)
    y[:-H] = (lit[H:] > lit[:-H]).astype(float)
    return y


def fit_logit(X, y, ridge=5.0, iters=50):
    """Ridge logistic regression via IRLS on standardized X. Returns predict(Xnew)."""
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = np.column_stack([np.ones(len(X)), (X - mu) / sd])
    w = np.zeros(Z.shape[1])
    P = ridge * np.eye(Z.shape[1]); P[0, 0] = 0.0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-np.clip(Z @ w, -30, 30)))
        g = Z.T @ (p - y) / len(y) * len(y) + P @ w
        Hs = (Z * (p * (1 - p))[:, None]).T @ Z + P + 1e-9 * np.eye(len(w))
        step = np.linalg.solve(Hs, g)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return lambda Xn: 1 / (1 + np.exp(-np.clip(np.column_stack([np.ones(len(Xn)), (Xn - mu) / sd]) @ w, -30, 30)))


def walk_forward(X, y):
    """Returns (index, p_model, p_base, y_true) arrays for every out-of-sample bar."""
    ok = ~np.isnan(X).any(1)
    idx, pm, pb, yt = [], [], [], []
    n = len(y)
    for s in range(WARMUP, n - H, STEP):
        tr = np.where(ok[:s - H] & ~np.isnan(y[:s - H]))[0]   # purge: label j needs close[j+H] < s
        te = np.arange(s, min(s + STEP, n - H))
        te = te[ok[te]]
        if len(tr) < 100 or len(te) == 0:
            continue
        model = fit_logit(X[tr], y[tr])
        idx += list(te); pm += list(model(X[te])); pb += [y[tr].mean()] * len(te); yt += list(y[te])
    return np.array(idx), np.array(pm), np.array(pb), np.array(yt)


def auc(p, y):
    if y.min() == y.max():
        return float("nan")
    order = p.argsort(kind="mergesort")
    ranks = np.empty(len(p)); ranks[order] = np.arange(1, len(p) + 1)
    n1 = y.sum(); n0 = len(y) - n1
    return (ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)


def block_bootstrap(stat, n, block=10, reps=1000, seed=0):
    rng = np.random.default_rng(seed)
    starts_n = int(np.ceil(n / block))
    vals = []
    for _ in range(reps):
        idx = np.concatenate([(rng.integers(0, n - block + 1) + np.arange(block)) for _ in range(starts_n)])[:n]
        vals.append(stat(idx))
    return np.percentile(vals, [2.5, 97.5])


def evaluate(X, y, label):
    idx, pm, pb, yt = walk_forward(X, y)
    bm, bb = (pm - yt) ** 2, (pb - yt) ** 2
    d_ci = block_bootstrap(lambda i: bb[i].mean() - bm[i].mean(), len(yt))
    a_ci = block_bootstrap(lambda i: auc(pm[i], yt[i]), len(yt))
    print(f"{label:12s} n={len(yt):4d}  brier model={bm.mean():.4f} base={bb.mean():.4f}  "
          f"gain={bb.mean() - bm.mean():+.4f} [{d_ci[0]:+.4f},{d_ci[1]:+.4f}]  "
          f"AUC={auc(pm, yt):.3f} [{a_ci[0]:.3f},{a_ci[1]:.3f}]")
    return {"gain": bb.mean() - bm.mean(), "gain_ci": d_ci, "auc": auc(pm, yt), "auc_ci": a_ci}


def main(data_dir="data"):
    dates, closes = load_closes(data_dir)
    names, X = build_features(closes)
    y = target(closes["LIT"])
    print(f"{len(dates)} aligned bars {dates[0]}..{dates[-1]}; base rate up={np.nanmean(y):.3f}")
    print("gain>0 and CI excluding 0 / AUC CI excluding 0.5 = real out-of-sample skill\n")
    for g, cols in GROUPS.items():
        evaluate(X[:, [names.index(c) for c in cols]], y, g)
    evaluate(X, y, "all")


if __name__ == "__main__":
    main(*sys.argv[1:2])
