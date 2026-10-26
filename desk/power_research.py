"""Does anything knowable at the top of the hour predict next-hour real-time power prices vs day-ahead?

Design fixed up front (no fishing). Decision point: each hour start t. Known at t: all RT 5-min prices
before t, and day-ahead (DA) hourly prices (published the day before). Two targets for the hour [t, t+1h):
  basis : mean RT over the hour > DA price for that hour
  spike : max RT 5-min price in the hour > DA + SPIKE_USD
Baselines: the global base rate AND the hour-of-day base rate (power prices have strong daily shape, so
beating only a flat guess would prove nothing). Model: ridge logistic, walk-forward, retrained every
RETRAIN samples, expanding window, purge of 2 samples; 95% CIs by block bootstrap over days.

Research tool only (needs numpy). Usage: python -m desk.power_research [data_dir] [node]
"""
import csv, sys
from datetime import datetime, timedelta
import numpy as np
from .research import fit_logit, auc, block_bootstrap

SPIKE_USD = 100.0
WARMUP = 24 * 90      # samples before first prediction
RETRAIN = 24 * 14
PURGE = 2
NAMES = ["da_next", "rt_last", "rt_mean_prev", "rt_std_prev", "rt_max_prev", "basis_prev", "basis_prev3",
         "da_shape", "da_vs_day", "rt_vs_da_now", "h_sin", "h_cos", "weekend"]


def _load(path):
    with open(path, newline="") as f:
        return {datetime.strptime(r["ts_utc"], "%Y-%m-%dT%H:%M:%SZ"): float(r["price"]) for r in csv.DictReader(f)}


def build_dataset(rt, da, tz_offset_hours=-7):
    """rt: {datetime_utc: $/MWh} 5-min; da: {datetime_utc: $/MWh} hourly. Returns dict of arrays.
    Hours with any missing input are dropped (never imputed). Local hour uses a fixed offset (PDT)."""
    five, hour = timedelta(minutes=5), timedelta(hours=1)
    rows = []
    for t in sorted(da):
        prev = [rt.get(t - k * five) for k in range(1, 13)]
        nxt = [rt.get(t + k * five) for k in range(12)]
        if None in prev or None in nxt:
            continue
        d = [da.get(t - k * hour) for k in range(0, 25)]
        if None in d:
            continue
        prev, nxt = np.array(prev[::-1]), np.array(nxt)           # prev oldest->newest
        da_now, da_p1 = d[0], d[1]
        basis_prev = prev.mean() - da_p1
        b3 = []
        for k in (1, 2, 3):
            seg = [rt.get(t - k * hour + j * five) for j in range(12)]
            if None in seg:
                b3 = None; break
            b3.append(np.mean(seg) - d[k])
        if b3 is None:
            continue
        lh = (t + timedelta(hours=tz_offset_hours)).hour
        rows.append((t, [da_now, prev[-1], prev.mean(), prev.std(), prev.max(), basis_prev, np.mean(b3),
                         da_now - np.mean(d[1:4]), da_now - np.mean(d[1:25]), prev[-1] - da_now,
                         np.sin(2 * np.pi * lh / 24), np.cos(2 * np.pi * lh / 24),
                         float((t + timedelta(hours=tz_offset_hours)).weekday() >= 5)],
                     float(nxt.mean() > da_now), float(nxt.max() > da_now + SPIKE_USD), lh))
    return {"t": [r[0] for r in rows], "X": np.array([r[1] for r in rows]),
            "y_basis": np.array([r[2] for r in rows]), "y_spike": np.array([r[3] for r in rows]),
            "hour": np.array([r[4] for r in rows])}


def walk_forward(X, y, hour):
    idx, pm, pg, ph, yt = [], [], [], [], []
    n = len(y)
    for s in range(WARMUP, n, RETRAIN):
        tr = np.arange(0, s - PURGE)
        te = np.arange(s, min(s + RETRAIN, n))
        if y[tr].min() == y[tr].max():
            continue
        model = fit_logit(X[tr], y[tr])
        gm = y[tr].mean()
        hm = np.array([y[tr][hour[tr] == h].mean() if (hour[tr] == h).any() else gm for h in range(24)])
        idx += list(te); pm += list(model(X[te])); pg += [gm] * len(te); ph += list(hm[hour[te]]); yt += list(y[te])
    return np.array(idx), np.array(pm), np.array(pg), np.array(ph), np.array(yt)


def evaluate(X, y, hour, label):
    """Also scores a persistence baseline (logistic on the single feature rt_vs_da_now: 'the last RT price
    vs this hour's DA price'). Added after a first run showed AUC ~0.9: that signal is trivially known to any
    real-time dispatcher, so beating flat/hour-of-day baselines alone proves nothing."""
    idx, pm, pg, ph, yt = walk_forward(X, y, hour)
    _, pp, _, _, _ = walk_forward(X[:, [NAMES.index("rt_vs_da_now")]], y, hour)
    bp = (pp - yt) ** 2
    bm, bg, bh = (pm - yt) ** 2, (pg - yt) ** 2, (ph - yt) ** 2
    block = 24
    g_ci = block_bootstrap(lambda i: bg[i].mean() - bm[i].mean(), len(yt), block=block)
    h_ci = block_bootstrap(lambda i: bh[i].mean() - bm[i].mean(), len(yt), block=block)
    a_ci = block_bootstrap(lambda i: auc(pm[i], yt[i]), len(yt), block=block)
    p_ci = block_bootstrap(lambda i: bp[i].mean() - bm[i].mean(), len(yt), block=block)
    print(f"{label:6s} persistence baseline: brier={bp.mean():.4f} AUC={auc(pp, yt):.3f} | "
          f"model gain vs persistence {bp.mean() - bm.mean():+.4f} [{p_ci[0]:+.4f},{p_ci[1]:+.4f}]")
    print(f"{label:6s} n={len(yt)} base-rate={yt.mean():.3f} | brier model={bm.mean():.4f} flat={bg.mean():.4f} hour-of-day={bh.mean():.4f}")
    print(f"       gain vs flat {bg.mean() - bm.mean():+.4f} [{g_ci[0]:+.4f},{g_ci[1]:+.4f}]   "
          f"gain vs hour-of-day {bh.mean() - bm.mean():+.4f} [{h_ci[0]:+.4f},{h_ci[1]:+.4f}]   "
          f"AUC {auc(pm, yt):.3f} [{a_ci[0]:.3f},{a_ci[1]:.3f}]")
    return {"gain_flat": bg.mean() - bm.mean(), "gain_hour": bh.mean() - bm.mean(), "hour_ci": h_ci, "auc": auc(pm, yt),
            "gain_persist": bp.mean() - bm.mean(), "persist_ci": p_ci, "auc_persist": auc(pp, yt)}


def main(data_dir="data/caiso", node="TH_NP15_GEN-APND"):
    ds = build_dataset(_load(f"{data_dir}/{node}_RTM.csv"), _load(f"{data_dir}/{node}_DAM.csv"))
    n = len(ds["t"])
    print(f"{n} usable hours {ds['t'][0]}..{ds['t'][-1]}  features={len(NAMES)}")
    print("real skill = gain vs PERSISTENCE with a CI excluding 0 (the other baselines are too easy)\n")
    for tgt in ("y_basis", "y_spike"):
        evaluate(ds["X"], ds[tgt], ds["hour"], tgt[2:])


if __name__ == "__main__":
    main(*sys.argv[1:3])
