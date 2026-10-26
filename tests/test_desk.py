import unittest
from desk.state import Tape
from desk.risk import RiskEngine, Limits, exit_reason
from desk.run import simulate


def tape(n=60, mid=100.0, size=100.0):
    t = Tape()
    for _ in range(n):
        t.push(mid, 0.03, size, size)
    return t


class ExitTests(unittest.TestCase):
    def test_no_data_closes(self):
        self.assertEqual(exit_reason(Tape(), 100.0), "no_data")

    def test_stop(self):
        t = tape(); t.push(99.0, 0.03, 100, 100)
        self.assertEqual(exit_reason(t, 100.0), "stop")

    def test_liquidity_collapse(self):
        t = tape()
        for _ in range(6): t.push(100.0, 0.03, 1, 1)
        self.assertEqual(exit_reason(t, 100.0), "liquidity_collapse")

    def test_hold(self):
        self.assertIsNone(exit_reason(tape(), 100.0))


class RiskTests(unittest.TestCase):
    def base(self, **kw):
        a = dict(notional=500, leverage=1, daily_pnl=0, expected_edge_bps=25, model_version="mock-0.1")
        a.update(kw); return RiskEngine(Limits()).check(**a)

    def test_ok(self): self.assertIsNone(self.base())
    def test_version(self): self.assertEqual(self.base(model_version="x"), "model_version_mismatch")
    def test_economics(self): self.assertEqual(self.base(expected_edge_bps=5), "economics")
    def test_leverage(self): self.assertEqual(self.base(leverage=5), "leverage_cap")
    def test_loss_halt_latches(self):
        r = RiskEngine(Limits())
        self.assertEqual(r.check(notional=1, leverage=1, daily_pnl=-60, expected_edge_bps=99, model_version="mock-0.1"), "daily_loss_halt")
        self.assertEqual(r.check(notional=1, leverage=1, daily_pnl=0, expected_edge_bps=99, model_version="mock-0.1"), "daily_loss_halt")


class SimTests(unittest.TestCase):
    def test_shadow_never_trades(self):
        self.assertEqual(simulate("shadow", 400), 0.0)


if __name__ == "__main__":
    unittest.main()


class GridTests(unittest.TestCase):
    def test_round_trip_earns_step_minus_fees(self):
        from desk.grid import Grid
        g = Grid(100.0, 1.0, n=2, lot_usd=100.0)
        g.on_price(100.5, 99.5)    # falls through 100 -> buy
        g.on_price(99.5, 100.5)    # rises through 100 -> sell the lot bought at 99? no: lot at level 100 sells at 101
        self.assertEqual(g.round_trips, 0)
        g.on_price(100.5, 101.5)   # rises through 101 -> sell
        self.assertEqual(g.round_trips, 1)
        self.assertGreater(g.realized, 0)

    def test_pause_blocks_new_buys(self):
        from desk.grid import Grid
        g = Grid(100.0, 1.0, n=2)
        g.on_price(100.5, 99.5, quote=False)
        self.assertEqual(g.lots, {})

    def test_stop_flattens_and_halts(self):
        from desk.grid import Grid
        g = Grid(100.0, 1.0, n=2)
        g.on_price(100.5, 99.5)
        g.stop(95.0)
        self.assertEqual((g.lots, g.active), ({}, False))
        self.assertLess(g.realized, 0)

    def test_range_guard(self):
        from desk.risk import range_guard
        self.assertTrue(range_guard(97.0, 98.0, 102.0))
        self.assertFalse(range_guard(100.0, 98.0, 102.0))

    def test_judge_variant_not_worse_than_unprotected(self):
        from desk.run_house import simulate_house
        self.assertGreaterEqual(simulate_house("judge")[0], simulate_house("none")[0])


class ReplayTests(unittest.TestCase):
    def test_csv_roundtrip_matches_live_generator(self):
        import os, tempfile
        from desk.replay import write_csv, ticks_from_csv
        from desk.run import gen_ticks, run_gambler
        from desk.logs import Log
        d = tempfile.mkdtemp(); p = os.path.join(d, "t.csv")
        write_csv(p, gen_ticks(500))
        a = run_gambler(ticks_from_csv(p), "paper", log=Log(os.path.join(d, "a.jsonl")))
        b = run_gambler(gen_ticks(500), "paper", log=Log(os.path.join(d, "b.jsonl")))
        self.assertAlmostEqual(a, b, places=6)

    def test_bad_row_rejected(self):
        import os, tempfile
        from desk.replay import ticks_from_csv
        p = os.path.join(tempfile.mkdtemp(), "bad.csv")
        open(p, "w").write("mid,spread,bid_size,ask_size\n100,0.03,nan,5\n")
        with self.assertRaises(ValueError):
            list(ticks_from_csv(p))

    def test_empty_stream_is_safe(self):
        from desk.run import run_gambler
        from desk.run_house import run_house
        import os, tempfile
        from desk.logs import Log
        self.assertEqual(run_gambler(iter([]), log=Log(os.path.join(tempfile.mkdtemp(), "x"))), 0.0)
        self.assertEqual(run_house(iter([]))[0], 0.0)


class OhlcvTests(unittest.TestCase):
    def _bars(self, rows):
        import os, tempfile
        p = os.path.join(tempfile.mkdtemp(), "bars.csv")
        with open(p, "w") as f:
            f.write("Date,Open,High,Low,Close,Volume\n" + "\n".join(rows) + "\n")
        return p

    def test_clv_split_and_skips_bad_rows(self):
        from desk.ohlcv import bars_to_ticks
        p = self._bars(["2026-01-01,10,12,8,11,1000", "2026-01-02,,,,,", "2026-01-03,10,10,10,10,0"])
        t = list(bars_to_ticks(p, spread_bps=10))
        self.assertEqual(len(t), 2)
        mid, spread, bid, ask = t[0]
        self.assertEqual((mid, round(bid), round(ask)), (11, 750, 250))
        self.assertAlmostEqual(spread, 0.011)
        self.assertEqual(t[1][2], t[1][3])  # flat bar splits evenly

    def test_missing_columns_raises(self):
        from desk.ohlcv import bars_to_ticks
        import os, tempfile
        p = os.path.join(tempfile.mkdtemp(), "nocols.csv")
        open(p, "w").write("Date,Price\n2026-01-01,10\n")
        with self.assertRaises(ValueError):
            list(bars_to_ticks(p))

    def test_short_row_skipped(self):
        from desk.ohlcv import bars_to_ticks
        self.assertEqual(len(list(bars_to_ticks(self._bars(["1,2,3", "2,10,12,8,11,100"])))), 1)

    def test_end_to_end_through_replay(self):
        import os, random, tempfile
        from desk.ohlcv import bars_to_ticks
        from desk.run import run_gambler
        from desk.logs import Log
        rng, px, rows = random.Random(1), 50.0, []
        for i in range(300):
            o = px; px *= 1 + rng.gauss(0.0003, 0.015); h, l = max(o, px) * 1.005, min(o, px) * 0.995
            rows.append(f"{i},{o},{h},{l},{px},{rng.randint(1000, 5000)}")
        d = tempfile.mkdtemp()
        pnl = run_gambler(bars_to_ticks(self._bars(rows)), "shadow", log=Log(os.path.join(d, "l.jsonl")))
        self.assertEqual(pnl, 0.0)
        self.assertTrue(os.path.getsize(os.path.join(d, "l.jsonl")) > 0)


class LiveTests(unittest.TestCase):
    Q = lambda self, bp=10.0, ap=10.02, bs=3, as_=5, t="t1": {"quotes": {"LIT": {"bp": bp, "ap": ap, "bs": bs, "as": as_, "t": t}}}

    def test_parse_good_and_bad(self):
        from desk.live import parse_quote
        row, why = parse_quote(self.Q(), "LIT")
        self.assertEqual((row[1], row[3], row[4], why), (10.01, 3.0, 5.0, None))
        self.assertEqual(parse_quote(self.Q(ap=9.9), "LIT")[1], "crossed")
        self.assertEqual(parse_quote(self.Q(bs=0), "LIT")[1], "empty_side")
        self.assertEqual(parse_quote({"quotes": {}}, "LIT")[1], "no_quote")
        self.assertEqual(parse_quote({"quotes": {"LIT": {"bp": 1}}}, "LIT")[1], "malformed")

    def test_record_dedupes_stale_and_logs_gaps(self):
        import os, tempfile, urllib.error
        from desk.live import record
        seq = iter([self.Q(t="a"), self.Q(t="a"), self.Q(ap=9.0, t="b"), self.Q(t="c")])

        def fetch(sym):
            try:
                return next(seq)
            except StopIteration:
                raise urllib.error.HTTPError("u", 429, "rate", {}, None)

        out = os.path.join(tempfile.mkdtemp(), "live.csv")
        sleeps = []
        n = record("LIT", out, every=1, rows=2, fetch=fetch, sleep=sleeps.append)
        self.assertEqual(n, 2)                                   # 'a' once (dup skipped), 'c'; crossed 'b' is a gap
        self.assertEqual(len(open(out).read().splitlines()), 3)  # header + 2
        self.assertIn("crossed", open(out + ".gaps.log").read())

    def test_backoff_on_429(self):
        import os, tempfile, urllib.error
        from desk.live import record
        calls = {"n": 0}

        def fetch(sym):
            calls["n"] += 1
            if calls["n"] <= 3:
                raise urllib.error.HTTPError("u", 429, "rate", {}, None)
            return self.Q()

        sleeps = []
        record("LIT", os.path.join(tempfile.mkdtemp(), "l.csv"), every=1, rows=1, fetch=fetch, sleep=sleeps.append)
        self.assertEqual(sleeps[:3], [2, 4, 8])

    def test_replay_reads_recorded_file(self):
        import os, tempfile
        from desk.live import record
        from desk.replay import ticks_from_csv
        out = os.path.join(tempfile.mkdtemp(), "l.csv")
        i = iter(range(5))
        record("LIT", out, every=1, rows=5, fetch=lambda s: self.Q(t=str(next(i))), sleep=lambda s: None)
        self.assertEqual(len(list(ticks_from_csv(out))), 5)


class NasdaqParseTests(unittest.TestCase):
    def test_parse_reverses_and_cleans(self):
        from desk.fetch_nasdaq import parse_rows
        p = {"data": {"tradesTable": {"rows": [
            {"date": "10/23/2026", "close": "$60.68", "volume": "170,982", "open": "60.29", "high": "60.97", "low": "60.135"},
            {"date": "bad"},
            {"date": "10/22/2026", "close": "N/A", "volume": "1", "open": "1", "high": "1", "low": "1"},
            {"date": "10/21/2026", "close": "59", "volume": "1,000", "open": "58", "high": "60", "low": "57"}]}}}
        r = parse_rows(p)
        self.assertEqual([x[0] for x in r], ["2026-10-21", "2026-10-23"])
        self.assertEqual(r[1][4:], (60.68, 170982.0))

    def test_parse_empty(self):
        from desk.fetch_nasdaq import parse_rows
        self.assertEqual(parse_rows({}), [])


class CalibrateTests(unittest.TestCase):
    def _pairs(self, skill, n=4000, seed=5):
        import random
        rng = random.Random(seed)
        out = []
        for _ in range(n):
            p = rng.choice([0.02, 0.1, 0.3, 0.5, 0.7, 0.9, 0.98])
            true = 0.5 + skill * (p - 0.5)
            out.append((p, int(rng.random() < true)))
        return out

    def test_shrinks_overconfidence(self):
        from desk.calibrate import evaluate
        r, cal = evaluate(self._pairs(skill=0.3))
        self.assertLess(cal.a, 0.6)
        self.assertLess(r["test_brier_platt"], r["test_brier_raw"])

    def test_no_skill_collapses_to_base_rate(self):
        from desk.calibrate import evaluate
        r, cal = evaluate(self._pairs(skill=0.0))
        self.assertLess(abs(cal.a), 0.25)
        self.assertAlmostEqual(r["test_brier_platt"], r["test_brier_base_rate"], delta=0.01)

    def test_well_calibrated_left_alone(self):
        from desk.calibrate import evaluate
        r, cal = evaluate(self._pairs(skill=1.0))
        self.assertAlmostEqual(cal.a, 1.0, delta=0.25)

    def test_calibrated_judge_wraps_and_pins_version(self):
        from desk.calibrate import CalibratedJudge, Platt
        from desk.judge import MockJudge
        from desk.questions import GAMBLER
        st = {"mid": 100, "spread_bps": 3, "imbalance": 0.9, "realized_vol": 0.001, "inventory": 0, "drawdown": 0,
              "ret_5": 0.01, "ret_20": 0.02, "ret_60": 0.03}
        r = CalibratedJudge(MockJudge(), {"buy_pressure": Platt(0.1, 0.0)}).ask(st, GAMBLER)
        a = r["answers"]["buy_pressure"]
        self.assertIn("p_raw", a)
        self.assertLess(abs(a["p"] - 0.5), abs(a["p_raw"] - 0.5))
        self.assertTrue(r["version"].endswith("+platt"))


class ResearchTests(unittest.TestCase):
    def _closes(self, n=900, seed=2, plant=0.0):
        """Returns = noise + plant * f, f an exogenous persistent AR(1) factor (no feedback, so no runaway)."""
        import numpy as np
        rng = np.random.default_rng(seed)
        f = np.zeros(n)
        for i in range(1, n):
            f[i] = 0.97 * f[i - 1] + rng.normal(0, 0.25)
        r = rng.normal(0, 0.015, n) + plant * f
        lit = 50 * np.exp(np.cumsum(r))
        mk = lambda s: 50 * np.exp(np.cumsum(np.random.default_rng(s).normal(0, 0.012, n)))
        return {"LIT": lit, "ALB": mk(7), "SQM": mk(8), "SPY": mk(9)}

    def test_features_have_no_lookahead(self):
        import numpy as np
        from desk.research import build_features
        c = self._closes()
        _, a = build_features(c)
        c2 = {k: v.copy() for k, v in c.items()}
        for v in c2.values():
            v[600:] *= 1.7                           # change the future after bar 599
        _, b = build_features(c2)
        np.testing.assert_allclose(a[:600], b[:600], equal_nan=True)

    def test_detects_planted_skill(self):
        import numpy as np
        from desk.research import build_features, target, walk_forward, auc
        c = self._closes(n=1800, plant=0.004)
        names, X = build_features(c)
        idx, pm, pb, yt = walk_forward(X[:, [names.index("mom_20")]], target(c["LIT"]))
        self.assertGreater(auc(pm, yt), 0.55)

    def test_pure_noise_shows_no_skill(self):
        from desk.research import build_features, target, walk_forward, auc
        c = self._closes(n=1800, plant=0.0)
        names, X = build_features(c)
        idx, pm, pb, yt = walk_forward(X, target(c["LIT"]))
        self.assertLess(abs(auc(pm, yt) - 0.5), 0.08)

    def test_purge_keeps_labels_out_of_training_window(self):
        import numpy as np
        from desk import research
        c = self._closes()
        names, X = research.build_features(c)
        y = research.target(c["LIT"])
        idx, *_ = research.walk_forward(X, y)
        self.assertGreaterEqual(idx.min(), research.WARMUP)
        self.assertLess(idx.max(), len(y) - research.H)


class CaisoTests(unittest.TestCase):
    def _zip(self, rows):
        import io, zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("x.csv", "INTERVALSTARTTIME_GMT,LMP_TYPE,MW\n" + "\n".join(rows) + "\n")
        return buf.getvalue()

    def test_parse_keeps_lmp_only_and_sorts(self):
        from desk.fetch_caiso import parse_zip
        r = parse_zip(self._zip(["2026-09-01T07:05:00-00:00,LMP,50.8", "2026-09-01T07:00:00-00:00,LMP,50.2",
                                 "2026-09-01T07:00:00-00:00,MCC,1.0", "2026-09-01T07:10:00-00:00,LMP,bad"]))
        self.assertEqual(r, [("2026-09-01T07:00:00Z", 50.2), ("2026-09-01T07:05:00Z", 50.8)])

    def test_parse_rejects_non_zip(self):
        from desk.fetch_caiso import parse_zip
        with self.assertRaises(ValueError):
            parse_zip(b"")

    def test_chunking_covers_range_exactly(self):
        from datetime import date
        from desk.fetch_caiso import chunk_ranges
        c = list(chunk_ranges(date(2026, 1, 1), date(2026, 1, 20), 7))
        self.assertEqual((c[0][0], c[-1][1], len(c)), (date(2026, 1, 1), date(2026, 1, 20), 3))
        self.assertTrue(all(a[1] == b[0] for a, b in zip(c, c[1:])))

    def test_retries_then_gives_up_visibly(self):
        from datetime import date
        from desk.fetch_caiso import fetch_chunk
        sleeps = []
        r = fetch_chunk("RTM", "N", date(2026, 1, 1), date(2026, 1, 2), get=lambda u: b"", sleep=sleeps.append, tries=3)
        self.assertIsNone(r)
        self.assertEqual(sleeps, [10, 20, 40])

    def test_success_after_retry(self):
        from datetime import date
        from desk.fetch_caiso import fetch_chunk
        calls = iter([b"", self._zip(["2026-09-01T07:00:00-00:00,LMP,1.5"])])
        r = fetch_chunk("DAM", "N", date(2026, 1, 1), date(2026, 1, 2), get=lambda u: next(calls), sleep=lambda s: None)
        self.assertEqual(r, [("2026-09-01T07:00:00Z", 1.5)])


class PowerResearchTests(unittest.TestCase):
    def _series(self, days=240, persist=0.0, seed=4):
        """DA hourly with a daily shape; RT 5-min = DA + hourly basis. persist=AR coefficient of the hourly basis."""
        import numpy as np
        from datetime import datetime, timedelta
        rng = np.random.default_rng(seed)
        t0 = datetime(2026, 1, 1)
        da, rt, basis = {}, {}, 0.0
        for h in range(days * 24):
            t = t0 + timedelta(hours=h)
            da[t] = 40 + 25 * np.sin(2 * np.pi * (t.hour - 9) / 24) + rng.normal(0, 4)
            basis = persist * basis + rng.normal(0, 8)
            for k in range(12):
                rt[t + timedelta(minutes=5 * k)] = da[t] + basis + rng.normal(0, 3)
        return rt, da

    def test_no_lookahead_in_features(self):
        import numpy as np
        from datetime import datetime, timedelta
        from desk.power_research import build_dataset
        rt, da = self._series(days=20)
        a = build_dataset(rt, da)
        cut = datetime(2026, 1, 12)
        rt2 = {k: (v + 500 if k >= cut else v) for k, v in rt.items()}
        da2 = {k: (v + 500 if k > cut else v) for k, v in da.items()}
        b = build_dataset(rt2, da2)
        n = sum(1 for t in a["t"] if t <= cut)
        self.assertGreater(n, 100)
        np.testing.assert_allclose(a["X"][:n], b["X"][:n])

    def test_detects_persistent_basis(self):
        from desk.power_research import build_dataset, walk_forward, auc
        ds = build_dataset(*self._series(days=300, persist=0.8))
        idx, pm, pg, ph, yt = walk_forward(ds["X"], ds["y_basis"], ds["hour"])
        self.assertGreater(auc(pm, yt), 0.62)

    def test_independent_noise_has_no_skill(self):
        from desk.power_research import build_dataset, walk_forward, auc
        ds = build_dataset(*self._series(days=300, persist=0.0))
        idx, pm, pg, ph, yt = walk_forward(ds["X"], ds["y_basis"], ds["hour"])
        self.assertLess(abs(auc(pm, yt) - 0.5), 0.06)

    def test_gaps_drop_hours_not_filled(self):
        from datetime import datetime
        from desk.power_research import build_dataset
        rt, da = self._series(days=10)
        full = len(build_dataset(rt, da)["t"])
        del rt[datetime(2026, 1, 5, 12, 30)]
        self.assertLess(len(build_dataset(rt, da)["t"]), full)


class CaisoErrorTests(unittest.TestCase):
    def _err_zip(self, desc):
        import io, zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("r.xml", f"<m:OASISReport><m:ERROR><m:ERR_CODE>1004</m:ERR_CODE><m:ERR_DESC>{desc}</m:ERR_DESC></m:ERROR></m:OASISReport>")
        return buf.getvalue()

    def test_error_xml_raises_oasis_error(self):
        from desk.fetch_caiso import parse_zip, OasisError
        with self.assertRaises(OasisError) as c:
            parse_zip(self._err_zip("Data can be requested for period of 31 days only"))
        self.assertIn("31 days", str(c.exception))

    def test_refusal_is_not_retried(self):
        from datetime import date
        from desk.fetch_caiso import fetch_chunk
        sleeps = []
        r = fetch_chunk("DAM", "N", date(2026, 1, 1), date(2026, 2, 1), get=lambda u: self._err_zip("nope"), sleep=sleeps.append)
        self.assertIsNone(r)
        self.assertEqual(sleeps, [])

    def test_dam_chunks_stay_within_30_days(self):
        from desk.fetch_caiso import SPECS
        self.assertLessEqual(SPECS["DAM"][1], 30)


class BatteryTests(unittest.TestCase):
    def test_flat_prices_do_not_cycle(self):
        from desk.battery import plan_day
        self.assertTrue(all(abs(v) < 1e-9 for v in plan_day([40.0] * 24)))

    def test_spread_charges_low_discharges_high_and_ends_empty(self):
        from desk.battery import plan_day, Battery
        b = Battery()
        prices = [20.0] * 6 + [60.0] * 6 + [100.0] * 6 + [30.0] * 6
        x = plan_day(prices, b)
        soc = 0.0
        for g in x:
            soc += (-g * b.eta) if g < 0 else (-g / b.eta)
            self.assertGreaterEqual(soc, -1e-9)
            self.assertLessEqual(soc, b.energy_mwh + 1e-9)
            self.assertLessEqual(abs(g), b.power_mw + 1e-9)
        self.assertAlmostEqual(soc, 0.0, places=6)
        self.assertGreater(sum(x[12:18]), 0)       # sells in the expensive block
        self.assertLess(sum(x[0:6]), 0)            # buys in the cheap block

    def test_round_trip_energy_matches_efficiency(self):
        from desk.battery import plan_day, Battery
        b = Battery()
        x = plan_day([10.0] * 3 + [200.0] * 3 + [10.0] * 18, b)
        bought, sold = -sum(g for g in x if g < 0), sum(g for g in x if g > 0)
        self.assertAlmostEqual(sold / bought, b.eff_roundtrip, places=3)

    def test_wear_cost_blocks_thin_spreads(self):
        from desk.battery import plan_day
        thin = [40.0] * 12 + [41.0] * 12            # spread smaller than losses + wear
        self.assertTrue(all(abs(v) < 1e-9 for v in plan_day(thin)))

    def test_revenue_signs(self):
        from desk.battery import revenue, Battery
        b = Battery()
        self.assertAlmostEqual(float(revenue(1.0, 100.0, b)), 100 - b.degr_usd_mwh)
        self.assertAlmostEqual(float(revenue(-1.0, 100.0, b)), -100.0)


class CausalDatasetTests(unittest.TestCase):
    def test_da_features_ignore_rt_after_cutoff(self):
        import numpy as np
        from datetime import datetime, timedelta
        from desk.power_research import build_dataset_da
        rt, da = PowerResearchTests()._series(days=30)
        a = build_dataset_da(rt, da)
        # target local day D = Jan 20 (UTC-7): cutoff = Jan 19 13:00 local = Jan 19 20:00 UTC
        cutoff = datetime(2026, 1, 19, 20, 0)
        rt2 = {k: (v + 777 if k >= cutoff else v) for k, v in rt.items()}
        b = build_dataset_da(rt2, da)
        day = [i for i, t in enumerate(a["t"]) if datetime(2026, 1, 20, 7) <= t < datetime(2026, 1, 21, 7)]
        self.assertEqual(len(day), 24)
        bi = {t: i for i, t in enumerate(b["t"])}
        for i in day:
            np.testing.assert_allclose(a["X"][i], b["X"][bi[a["t"][i]]])

    def test_label_does_use_the_target_hour(self):
        from datetime import datetime, timedelta
        from desk.power_research import build_dataset_da
        rt, da = PowerResearchTests()._series(days=30, persist=0.0)
        a = build_dataset_da(rt, da)
        t = datetime(2026, 1, 20, 12)
        rt2 = dict(rt)
        for k in range(12):
            rt2[t + timedelta(minutes=5 * k)] = da[t] + 1000
        b = build_dataset_da(rt2, da)
        ia, ib = a["t"].index(t), b["t"].index(t)
        self.assertEqual(b["y_basis"][ib], 1.0)


class IntradayTests(unittest.TestCase):
    def _prices(self, n=4000, seed=1):
        import numpy as np
        rng = np.random.default_rng(seed)
        return 40 + 30 * np.sin(np.arange(n) / 40.0) + rng.normal(0, 5, n)

    def test_policy_respects_soc_and_power_bounds(self):
        import numpy as np
        from desk.intraday import run_policy, persistence_rule
        from desk.battery import Battery
        p = self._prices(); b = Battery()
        socs = []
        base = persistence_rule(p, 0.2, 0.8, b)

        def decide(k, soc):
            socs.append(soc); return base(k, soc)

        rev = run_policy(p, decide, 2500, 3900, b)
        self.assertTrue(all(-1e-9 <= s <= b.energy_mwh + 1e-9 for s in socs))
        self.assertLessEqual(np.abs(rev / np.maximum(np.abs(p[2500:3900]), 1e-9)).max(), b.power_mw / 12 + 1e-6 + b.degr_usd_mwh)

    def test_decisions_do_not_depend_on_current_or_future_prices(self):
        import numpy as np
        from desk.intraday import persistence_rule
        p = self._prices(); q = p.copy()
        q[3000:] += 500                                        # change prices at/after step 3000
        a, b_ = persistence_rule(p, 0.2, 0.8), persistence_rule(q, 0.2, 0.8)
        for k in range(2500, 3001):                            # decision at 3000 may only see < 3000
            self.assertEqual(a(k, 0.0), b_(k, 0.0))

    def test_spread_guard_blocks_thin_band(self):
        import numpy as np
        from desk.intraday import persistence_rule
        p = 40 + np.random.default_rng(0).normal(0, 0.1, 4000)
        d = persistence_rule(p, 0.2, 0.8)
        self.assertTrue(all(d(k, 1.0) == 0 for k in range(2500, 2700)))

    def test_charge_then_discharge_accounting(self):
        from desk.intraday import run_policy
        from desk.battery import Battery
        import numpy as np
        b = Battery()
        p = np.concatenate([np.full(36, 10.0), np.full(60, 100.0)])
        rev = run_policy(p, lambda k, s: -1 if k < 36 else 1, 0, 96, b)
        bought = -rev[:36].sum() / 10.0                        # MWh drawn from the grid to fill 2 MWh of storage
        self.assertAlmostEqual(bought, b.energy_mwh / b.eta, places=6)
        delivered = (rev[36:].sum() / 1.0 + 0) / 1.0
        # all stored energy leaves: delivered MWh = 2 * eta, each earning 100 - wear
        self.assertAlmostEqual(rev[36:].sum(), b.energy_mwh * b.eta * (100.0 - b.degr_usd_mwh), places=6)

    def test_model_rule_only_acts_on_agreement(self):
        import numpy as np
        from desk.intraday import persistence_rule, model_rule
        p = self._prices()
        pers = persistence_rule(p, 0.2, 0.8)
        up = np.full(len(p), 0.9); down = np.full(len(p), 0.1)
        for k in range(2500, 3000):
            a = pers(k, 0.0)
            self.assertEqual(model_rule(p, up, 0.2, 0.8)(k, 0.0), a if a <= 0 else 0)   # 'up' blocks discharge
            self.assertEqual(model_rule(p, down, 0.2, 0.8)(k, 0.0), a if a >= 0 else 0)  # 'down' blocks charge
