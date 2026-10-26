"""Battery dispatch backtest: is the (small) basis prediction worth money?

A daily plan is optimized from day-ahead (DA) prices by dynamic programming (battery starts and ends the
day empty). Each planned buy/sell hour can then settle at DA or at the real-time (RT) hourly mean. The
strategies differ ONLY in that venue choice: always-DA, always-RT, habit (7-day same-hour basis),
a 'habit' rule (same-hour basis averaged over the last 7 days), the walk-forward model (p > 0.5), and a hindsight oracle (upper bound, unattainable).

TIMING RULE: the venue choice must be made before the day-ahead market closes, so the model and the
baselines may use only information available at the DA cutoff (13:00 local the day before): the day's DA
prices and RT history up to then. A first version of this backtest used RT prices from just before each
hour and showed +$17.5/day over always-DA; that was not achievable (look-ahead in decision time) and was
replaced by this causal version.

Assumptions (all simplifications, stated so they can be challenged): price-taker, no grid fees or
ancillary revenue, fixed degradation cost per MWh discharged, no RT price impact or forecast error in
the DA plan, 1-hour steps, fixed UTC-7 day windows.

Research tool only (needs numpy). Usage: python -m desk.battery [data_dir] [node]
"""
import sys
from dataclasses import dataclass
from datetime import timedelta
import numpy as np


@dataclass(frozen=True)
class Battery:
    power_mw: float = 1.0
    energy_mwh: float = 2.0
    eff_roundtrip: float = 0.85
    degr_usd_mwh: float = 3.0     # assumed wear cost per MWh discharged (not from data)
    soc_step: float = 0.25

    @property
    def eta(self):                # one-way efficiency (charge = discharge)
        return self.eff_roundtrip ** 0.5


def plan_day(prices, b: Battery = Battery()):
    """prices: 24 hourly $/MWh. Returns grid MWh per hour: +x = sold (delivered), -x = bought (drawn)."""
    n_s = int(round(b.energy_mwh / b.soc_step)) + 1
    max_d = int(round(1.0 / b.soc_step))                       # stored MWh change cap per hour
    acts = []
    for d in range(-max_d, max_d + 1):
        delta = d * b.soc_step                                  # stored-energy change
        grid = -delta / b.eta if delta > 0 else -delta * b.eta  # signed grid MWh (+ sell)
        if abs(grid) <= b.power_mw + 1e-9:
            acts.append((d, grid))
    H = len(prices)
    V = np.full((H + 1, n_s), -np.inf); V[H, 0] = 0.0           # must end empty
    best = np.zeros((H, n_s), dtype=int)
    for h in range(H - 1, -1, -1):
        for s in range(n_s):
            for k, (d, g) in enumerate(acts):
                s2 = s + d
                if 0 <= s2 < n_s and V[h + 1, s2] > -np.inf:
                    v = g * prices[h] - b.degr_usd_mwh * max(g, 0) + V[h + 1, s2]
                    if v > V[h, s]:
                        V[h, s], best[h, s] = v, k
    s, out = 0, []
    for h in range(H):
        d, g = acts[best[h, s]]
        out.append(g); s += d
    return out


def revenue(x, price, b: Battery = Battery()):
    return np.asarray(x) * price - b.degr_usd_mwh * np.maximum(x, 0)


def backtest(data_dir="data/caiso", node="TH_NP15_GEN-APND"):
    from .power_research import _load, build_dataset_da, walk_forward, NAMES_DA
    from .research import block_bootstrap
    b = Battery()
    rt, da = _load(f"{data_dir}/{node}_RTM.csv"), _load(f"{data_dir}/{node}_DAM.csv")
    ds = build_dataset_da(rt, da)
    idx, pm, _, _, yt = walk_forward(ds["X"], ds["y_basis"], ds["hour"])
    p_of = {ds["t"][i]: p for i, p in zip(idx, pm)}
    pers_of = {ds["t"][i]: ds["X"][i, NAMES_DA.index("basis_hour7")] for i in idx}
    off = timedelta(hours=-7)
    days = {}
    for t in ds["t"]:
        days.setdefault((t + off).date(), []).append(t)
    rows = []   # per OOS planned hour: day, x, da, rt, p, pers
    for day, ts in sorted(days.items()):
        ts = sorted(ts)
        if len(ts) != 24 or any(t not in da for t in ts):
            continue
        x = plan_day([da[t] for t in ts], b)
        for t, xi in zip(ts, x):
            if t in p_of and xi != 0:
                rows.append((day, xi, da[t], np.mean([rt[t + timedelta(minutes=5 * k)] for k in range(12)]), p_of[t], pers_of[t]))
    day_ids = sorted({r[0] for r in rows}); di = {d: i for i, d in enumerate(day_ids)}
    arr = {k: np.array([r[i] for r in rows]) for k, i in (("x", 1), ("da", 2), ("rt", 3), ("p", 4), ("pers", 5))}
    dayidx = np.array([di[r[0]] for r in rows])
    x, da_p, rt_p = arr["x"], arr["da"], arr["rt"]
    sell = x > 0
    use_rt = {
        "always DA": np.zeros(len(x), bool),
        "always RT": np.ones(len(x), bool),
        "habit (7d basis)": np.where(sell, arr["pers"] > 0, arr["pers"] < 0),
        "model": np.where(sell, arr["p"] > 0.5, arr["p"] < 0.5),
        "oracle (hindsight)": np.where(sell, rt_p > da_p, rt_p < da_p),
    }
    daily = {}
    for name, m in use_rt.items():
        r = revenue(x, np.where(m, rt_p, da_p), b)
        daily[name] = np.bincount(dayidx, r, minlength=len(day_ids))
    nd = len(day_ids)
    print(f"{nd} out-of-sample days, {len(x)} planned dispatch hours "
          f"({sell.sum()} sells, {(~sell).sum()} buys); 1 MW / 2 MWh, {b.eff_roundtrip:.0%} round trip, ${b.degr_usd_mwh}/MWh wear")
    base = daily["always DA"]
    print(f"\n{'strategy':22s} {'total $':>10s} {'$/day':>8s} {'vs always-DA $/day [95% CI]':>34s}")
    for name, d in daily.items():
        diff = d - base
        ci = block_bootstrap(lambda i: diff[i].mean(), nd, block=7)
        print(f"{name:22s} {d.sum():10.0f} {d.mean():8.2f} {diff.mean():+12.2f} [{ci[0]:+.2f},{ci[1]:+.2f}]")
    for a, c in (("model", "habit (7d basis)"),):
        diff = daily[a] - daily[c]
        ci = block_bootstrap(lambda i: diff[i].mean(), nd, block=7)
        print(f"\nmodel vs habit: {diff.mean():+.2f} $/day [{ci[0]:+.2f},{ci[1]:+.2f}]")
    return daily


if __name__ == "__main__":
    backtest(*sys.argv[1:3])
