"""Intraday real-time battery dispatch: does a model beat a plain persistence rule, causally?

Rules fixed before running (see commit): a decision every 5-minute step using ONLY prices from earlier
steps (the interval's own price settles the trade but is never visible when the battery acts).
  schedule    : the day-ahead plan (battery.plan_day) executed in RT, settled at RT prices (baseline)
  persistence : discharge if last price >= q_hi of the trailing 7-day RT prices, charge if <= q_lo, else hold;
                never trades if the band can't cover efficiency losses + wear
  model       : persistence AND a walk-forward model agrees on the next-hour direction
                (charge needs p_up > 0.5, discharge needs p_up < 0.5)
Band sensitivity (0.1/0.9, 0.2/0.8, 0.3/0.7) is reported in full; none is selected.
Same battery and assumptions as desk.battery (price-taker, no fees, $3/MWh wear). Unused energy at the
end is valued at zero for every strategy. Research tool only (needs numpy).
Usage: python -m desk.intraday [data_dir] [node]
"""
import sys
from datetime import datetime, timedelta
import numpy as np
from .battery import Battery, plan_day

STEPS_H = 12            # 5-minute steps per hour
TRAIL = 7 * 24 * STEPS_H
WARMUP_DAYS = 120
RETRAIN = 14 * 24 * STEPS_H
PURGE = STEPS_H


def band_thresholds(prices, k, q_lo, q_hi, trail=TRAIL):
    """Thresholds at step k from prices[:k] only."""
    w = prices[max(0, k - trail):k]
    return np.quantile(w, q_lo), np.quantile(w, q_hi)


def spread_ok(lo, hi, b: Battery):
    return hi * b.eta - lo / b.eta - b.degr_usd_mwh * b.eta > 0   # delivered MWh per MWh drawn, net of wear


def run_policy(prices, decide, start, end, b: Battery = Battery()):
    """decide(k, soc) -> -1 charge / 0 hold / +1 discharge, allowed to read prices[:k] only.
    Returns per-step revenue array for steps [start, end)."""
    g = b.power_mw / STEPS_H
    soc, rev = 0.0, np.zeros(end - start)
    for k in range(start, end):
        a = decide(k, soc)
        if a < 0 and soc < b.energy_mwh - 1e-12:
            draw = min(g, (b.energy_mwh - soc) / b.eta)
            soc += draw * b.eta
            rev[k - start] = -draw * prices[k]
        elif a > 0 and soc > 1e-12:
            out = min(g, soc * b.eta)
            soc -= out / b.eta
            rev[k - start] = out * prices[k] - b.degr_usd_mwh * out
    return rev


def persistence_rule(prices, q_lo, q_hi, b: Battery = Battery()):
    cache = {}

    def decide(k, soc):
        h = k // STEPS_H
        if h not in cache:                                   # thresholds refreshed hourly from prices[:k_hour]
            cache[h] = band_thresholds(prices, h * STEPS_H, q_lo, q_hi)
        lo, hi = cache[h]
        if not spread_ok(lo, hi, b):
            return 0
        last = prices[k - 1]
        return 1 if last >= hi else -1 if last <= lo else 0
    return decide


def model_rule(prices, p_up, q_lo, q_hi, b: Battery = Battery()):
    base = persistence_rule(prices, q_lo, q_hi, b)

    def decide(k, soc):
        a = base(k, soc)
        if a < 0 and p_up[k] > 0.5:
            return -1
        if a > 0 and p_up[k] < 0.5:
            return 1
        return 0
    return decide


def step_features(prices, da_h, k):
    """Features for the decision at step k: prices[:k] and DA (known the day before). Vectorizable by caller."""
    L = prices[k - 1]
    w = prices[k - 12:k]
    h = k // STEPS_H
    hr = (h % 24)
    return [np.arcsinh(L / 10), np.arcsinh((L - w.mean()) / 10), np.arcsinh(w.std() / 10),
            np.arcsinh((L - da_h[h]) / 10), np.arcsinh((da_h[min(h + 1, len(da_h) - 1)] - da_h[h]) / 10),
            np.sin(2 * np.pi * hr / 24), np.cos(2 * np.pi * hr / 24)]


def model_probabilities(prices, da_h, first):
    """Walk-forward P(next-hour mean RT > last price) for steps >= first. Trained on steps < s - PURGE."""
    from .research import fit_logit
    n = len(prices)
    ks = np.arange(TRAIL // 7, n - STEPS_H)      # need >= 1 day of history for features
    X = np.array([step_features(prices, da_h, k) for k in ks])
    y = np.array([float(prices[k:k + STEPS_H].mean() > prices[k - 1]) for k in ks])
    p_up = np.full(n, 0.5)
    ys, ps = [], []
    for s in range(first, n - STEPS_H, RETRAIN):
        tr = (ks < s - PURGE)
        te = (ks >= s) & (ks < min(s + RETRAIN, n - STEPS_H))
        if te.sum() == 0:
            continue
        m = fit_logit(X[tr], y[tr])
        pr = m(X[te])
        p_up[ks[te]] = pr
        ys += list(y[te]); ps += list(pr)
    return p_up, np.array(ps), np.array(ys)


def main(data_dir="data/caiso", node="TH_NP15_GEN-APND"):
    from .power_research import _load
    from .research import block_bootstrap, auc
    rt, da = _load(f"{data_dir}/{node}_RTM.csv"), _load(f"{data_dir}/{node}_DAM.csv")
    t0 = min(rt)
    n = len(rt)
    assert all(t0 + timedelta(minutes=5 * k) in rt for k in range(n)), "RT series has gaps; refusing to impute"
    prices = np.array([rt[t0 + timedelta(minutes=5 * k)] for k in range(n)])
    nh = n // STEPS_H
    da_h = np.array([da[t0 + timedelta(hours=h)] for h in range(nh)])
    b = Battery()
    first = WARMUP_DAYS * 24 * STEPS_H
    end = n - STEPS_H
    p_up, ps, ys = model_probabilities(prices, da_h, first)
    print(f"{(end - first) / 288:.0f} out-of-sample days; model next-hour-direction AUC = {auc(ps, ys):.3f} "
          f"(base rate up = {ys.mean():.3f})")
    day_of = np.array([((t0 + timedelta(minutes=5 * k) + timedelta(hours=-7)).date()) for k in range(first, end)])
    uniq = sorted(set(day_of)); di = {d: i for i, d in enumerate(uniq)}
    didx = np.array([di[d] for d in day_of]); nd = len(uniq)

    # schedule baseline: DA plan per local day, executed in RT
    sched = np.zeros(end - first)
    hours_by_day = {}
    for h in range(nh):
        hours_by_day.setdefault((t0 + timedelta(hours=h) + timedelta(hours=-7)).date(), []).append(h)
    for d, hs in hours_by_day.items():
        if len(hs) != 24:
            continue
        x = plan_day([da_h[h] for h in hs], b)
        for h, xi in zip(hs, x):
            for k in range(h * STEPS_H, (h + 1) * STEPS_H):
                if first <= k < end:
                    sched[k - first] = xi / STEPS_H * prices[k] - b.degr_usd_mwh * max(xi, 0) / STEPS_H
    daily = lambda r: np.bincount(didx, r, minlength=nd)
    s_day = daily(sched)
    print(f"\n{'strategy':26s} {'$/day':>8s} {'vs schedule [95% CI]':>28s} {'model-minus-persistence [95% CI]':>36s}")
    print(f"{'schedule (DA plan in RT)':26s} {s_day.mean():8.2f}")
    for q_lo, q_hi in ((0.1, 0.9), (0.2, 0.8), (0.3, 0.7)):
        pers = daily(run_policy(prices, persistence_rule(prices, q_lo, q_hi, b), first, end, b))
        mod = daily(run_policy(prices, model_rule(prices, p_up, q_lo, q_hi, b), first, end, b))
        for name, d in ((f"persistence {q_lo:.1f}/{q_hi:.1f}", pers), (f"model       {q_lo:.1f}/{q_hi:.1f}", mod)):
            diff = d - s_day
            ci = block_bootstrap(lambda i: diff[i].mean(), nd, block=7)
            extra = ""
            if name.startswith("model"):
                dm = mod - pers
                c2 = block_bootstrap(lambda i: dm[i].mean(), nd, block=7)
                extra = f"{dm.mean():+12.2f} [{c2[0]:+.2f},{c2[1]:+.2f}]"
            print(f"{name:26s} {d.mean():8.2f} {diff.mean():+9.2f} [{ci[0]:+.2f},{ci[1]:+.2f}] {extra:>36s}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
